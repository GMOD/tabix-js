const promisify = require('util.promisify')
const gunzip = promisify(require('zlib').gunzip)
const LRU = require('lru-cache')
const LocalFile = require('./localFile')
const TBI = require('./tbi')
// const CSI = require('./csi')

function timeout(time) {
  return new Promise(resolve => {
    setTimeout(resolve, time)
  })
}

class TabixIndexedFile {
  /**
   * @param {object} args
   * @param {string} [args.path]
   * @param {filehandle} [args.filehandle]
   * @param {string} [args.tbiPath]
   * @param {filehandle} [args.tbiFilehandle]
   * @param {string} [args.csiPath]
   * @param {filehandle} [args.csiFilehandle]
   * @param {number} [args.chunkSizeLimit] maximum number of bytes to fetch in a single `getLines` call.
   * default 2MiB
   * @param {number} [args.cacheLines] maximum number of lines to cache. default 50000.
   * @param {number} [args.yieldLimit] maximum number of lines to parse without yielding.
   * this avoids having a large read prevent any other work getting done on the thread.  default 300 lines.
   */
  constructor({
    path,
    filehandle,
    tbiPath,
    tbiFilehandle,
    csiPath,
    csiFilehandle,
    chunkSizeLimit = 2000000,
    cacheLines = 50000,
    yieldLimit = 300,
  }) {
    if (filehandle) this.filehandle = filehandle
    else if (path) this.filehandle = new LocalFile(path)
    else throw new TypeError('must provide either filehandle or path')

    if (tbiFilehandle) this.index = new TBI(tbiFilehandle)
    else if (csiFilehandle) this.index = new CSI(csiFilehandle)
    else if (tbiPath) this.index = new TBI(new LocalFile(tbiPath))
    else if (csiPath) this.index = new CSI(new LocalFile(csiPath))
    else
      throw new TypeError(
        'must provide one of tbiFilehandle, tbiPath, csiFilehandle, or csiPath',
      )

    this.chunkSizeLimit = chunkSizeLimit
    this.yieldLimit = yieldLimit

    this.chunkLinesCache = LRU({ max: cacheLines })
  }

  /**
   * @param {string} refName name of the reference sequence
   * @param {number} start start of the region (in native coordinates for the file)
   * @param {number} end end of the region (in native coordinates for the file)
   * @param {function} lineCallback callback called for each line in the region
   * @returns {Promise} resolved when the whole read is finished, rejected on error
   */
  async getLines(refName, start, end, lineCallback) {
    const chunks = await this.index.blocksForRange(refName, start, end)
    const metadata = await this.index.getMetadata()
    metadata.maxColumn = Math.max(
      metadata.columnNumbers.ref || 0,
      metadata.columnNumbers.start || 0,
      metadata.columnNumbers.end || 0,
    )

    // check the chunks for any that are over the size limit.  if
    // any are, don't fetch any of them
    for (let i = 0; i < chunks.length; i += 1) {
      const size = chunks[i].fetchedSize()
      if (size > this.chunkSizeLimit) {
        throw new Error(
          `Too much data. Chunk size ${size.toLocaleString()} bytes exceeds chunkSizeLimit of ${this.chunkSizeLimit.toLocaleString()}.`,
        )
      }
    }

    // now go through each chunk and parse and filter the lines out of it
    let linesSinceLastYield = 0
    const newLineByte = '\n'.charCodeAt(0)
    for (let chunkNum = 0; chunkNum < chunks.length; chunkNum += 1) {
      const chunkData = await this.readChunk(chunks[chunkNum])
      // go through the data and parse out lines
      let currentLineStart = 0
      for (let i = 0; i < chunkData.length; i += 1) {
        if (chunkData[i] === newLineByte) {
          if (currentLineStart < i) {
            const line = chunkData.toString('utf8', currentLineStart, i).trim()
            // filter the line for whether it is within the requested range
            if (this.lineOverlapsRegion(metadata, refName, start, end, line))
              lineCallback(line)

            // yield if we have emitted beyond the yield limit
            linesSinceLastYield += 1
            if (linesSinceLastYield >= this.yieldLimit) {
              await timeout(1)
              linesSinceLastYield = 0
            }
          }
          currentLineStart = i + 1
        }
      }
    }
  }

  /**
   * @param {object} metadata metadata object from the parsed index,
   * containing columnNumbers, metaChar, and maxColumn
   * @param {string} regionRefName
   * @param {number} regionStart
   * @param {number} regionEnd
   * @param {string} line
   * @returns {boolean} whether the line is a data line that overlaps the given region
   */
  lineOverlapsRegion(
    { columnNumbers, metaChar, maxColumn },
    regionRefName,
    regionStart,
    regionEnd,
    line,
  ) {
    // skip meta lines
    if (line.charAt(0) === metaChar) return false

    // check ref/start/end using column metadata from index
    let { ref, start, end } = columnNumbers
    if (!ref) ref = 0
    if (!start) start = 0
    if (!end) end = 0

    // this code is kind of complex, but it is fairly fast.
    // basically, we want to avoid doing a split, because if the lines are really long
    // that could lead to us allocating a bunch of extra memory, which is slow

    let currentColumnNumber = 1 // cols are numbered starting at 1 in the index metadata
    let currentColumnStart = 0
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === '\t') {
        if (currentColumnNumber > maxColumn) break
        if (currentColumnNumber === ref) {
          const refName = line.slice(currentColumnStart, i)
          if (refName !== regionRefName) return false
        } else if (currentColumnNumber === start) {
          const startCoordinate = parseInt(
            line.slice(currentColumnStart, i),
            10,
          )
          if (startCoordinate >= regionEnd) return false
          if (end === 0) {
            // if we have no end, we assume the feature is 1 bp long
            if (startCoordinate + 1 <= regionStart) return false
          }
        } else if (currentColumnNumber === end) {
          // this will never match if there is no end column
          const endCoordinate = parseInt(line.slice(currentColumnStart, i), 10)
          if (endCoordinate <= regionStart) return false
        }
        currentColumnStart = i + 1
        currentColumnNumber += 1
      }
    }
    return true
  }

  /**
   * return the approximate number of data lines in the given reference sequence
   * @param {string} refSeq reference sequence name
   * @returns {Promise} for number of data lines present on that reference sequence
   */
  async lineCount(refSeq) {
    return this.index.lineCount(refSeq)
  }

  /**
   * read and uncompress the data in a chunk (composed of one or more
   * contiguous bgzip blocks) of the file
   * @param {Chunk} chunk
   * @returns {Promise} for a Buffer of uncompressed data
   */
  async readChunk(chunk) {
    const compressedSize = chunk.maxv.blockPosition - chunk.minv.blockPosition
    const compressedData = Buffer.allocUnsafe(compressedSize)
    const bytesRead = await this.filehandle.read(
      compressedData,
      0,
      compressedSize,
      chunk.minv.blockPosition,
    )
    if (bytesRead !== compressedSize)
      throw new Error(
        `failed to read block at ${
          chunk.minv.blockPosition
        } (length ${compressedSize})`,
      )
    return gunzip(compressedData).catch(e => {
      throw new Error(
        `error decompressing block at ${
          chunk.minv.blockPosition
        } (length ${compressedSize})`,
        e,
      )
    })
  }
}

module.exports = TabixIndexedFile

//   getLines(ref, min, max, itemCallback, finishCallback, errorCallback) {
//     errorCallback =
//       errorCallback ||
//       function(e) {
//         console.error(e, e.stack)
//       }

//     const chunks = this.index.blocksForRange(ref, min, max)
//     if (!chunks) {
//       errorCallback(`Error in index fetch (${[ref, min, max].join(',')})`)
//       return
//     }

//     // toString function is used by the cache for making cache keys
//     chunks.toString = chunks.toUniqueString = function() {
//       return this.join(', ')
//     }

//     // check the chunks for any that are over the size limit.  if
//     // any are, don't fetch any of them
//     for (let i = 0; i < chunks.length; i++) {
//       const size = chunks[i].fetchedSize()
//       if (size > this.chunkSizeLimit) {
//         errorCallback(
//           new Errors.DataOverflow(
//             `Too much data. Chunk size ${Util.commifyNumber(
//               size,
//             )} bytes exceeds chunkSizeLimit of ${Util.commifyNumber(
//               this.chunkSizeLimit,
//             )}.`,
//           ),
//         )
//         return
//       }
//     }

//     let fetchError
//     try {
//       this._fetchChunkData(
//         chunks,
//         ref,
//         min,
//         max,
//         itemCallback,
//         finishCallback,
//         errorCallback,
//       )
//     } catch (e) {
//       errorCallback(e)
//     }
//   }

//   _fetchChunkData(
//     chunks,
//     ref,
//     min,
//     max,
//     itemCallback,
//     endCallback,
//     errorCallback,
//   ) {
//     const thisB = this

//     if (!chunks.length) {
//       endCallback()
//       return
//     }

//     const allItems = []
//     let chunksProcessed = 0

//     const cache = (this.chunkCache =
//       this.chunkCache ||
//       new LRUCache({
//         name: 'TabixIndexedFileChunkedCache',
//         fillCallback: dojo.hitch(this, '_readChunkItems'),
//         sizeFunction(chunkItems) {
//           return chunkItems.length
//         },
//         maxSize: 100000, // cache up to 100,000 items
//       }))

//     const regRef = this.browser.regularizeReferenceName(ref)

//     let haveError
//     array.forEach(chunks, c => {
//       cache.get(c, (chunkItems, e) => {
//         if (e && !haveError) errorCallback(e)
//         if ((haveError = haveError || e)) {
//           return
//         }

//         for (let i = 0; i < chunkItems.length; i++) {
//           const item = chunkItems[i]
//           if (item._regularizedRef == regRef) {
//             // on the right ref seq
//             if (item.start > max)
//               // past end of range, can stop iterating
//               break
//             else if (item.end >= min)
//               // must be in range
//               itemCallback(item)
//           }
//         }
//         if (++chunksProcessed == chunks.length) {
//           endCallback()
//         }
//       })
//     })
//   }

//   _readChunkItems(chunk, callback) {
//     const items = []
//     this.data.read(
//       chunk.minv.block,
//       chunk.maxv.block - chunk.minv.block + 1,
//       data => {
//         data = new Uint8Array(data)
//         // console.log( 'reading chunk %d compressed, %d uncompressed', chunk.maxv.block-chunk.minv.block+65536, data.length );
//         const lineIterator = new TextIterator.FromBytes({
//           bytes: data,
//           offset: 0,
//         })
//         try {
//           this._parseItems(
//             lineIterator,
//             i => {
//               items.push(i)
//             },
//             () => {
//               callback(items)
//             },
//           )
//         } catch (e) {
//           callback(null, e)
//         }
//       },
//       e => {
//         callback(null, e)
//       },
//     )
//   }

//   _parseItems(lineIterator, itemCallback, finishCallback) {
//     const that = this
//     let itemCount = 0

//     const maxItemsWithoutYielding = 300
//     while (true) {
//       // if we've read no more than a certain number of items this cycle, read another one
//       if (itemCount <= maxItemsWithoutYielding) {
//         const item = this.parseItem(lineIterator)
//         if (item) {
//           itemCallback(item)
//           itemCount++
//         } else {
//           finishCallback()
//           return
//         }
//       }
//       // if we're not done but we've read a good chunk of
//       // items, schedule the rest of our work in a timeout to continue
//       // later, avoiding blocking any UI stuff that needs to be done
//       else {
//         window.setTimeout(() => {
//           that._parseItems(lineIterator, itemCallback, finishCallback)
//         }, 1)
//         return
//       }
//     }
//   }

//   parseItem(iterator) {
//     const metaChar = this.index.metaChar
//     let line, item, fileOffset
//     do {
//       fileOffset = iterator.getOffset()
//       line = iterator.getline()
//     } while (
//       line &&
//       (line.charAt(0) == metaChar || // meta line, skip
//       line.charAt(line.length - 1) != '\n' || // no newline at the end, incomplete
//         !(item = this.tryParseLine(line, fileOffset))) // line could not be parsed
//     )

//     if (line && item) return item

//     return null
//   }

//   tryParseLine(line, fileOffset) {
//     try {
//       return this.parseLine(line, fileOffset)
//     } catch (e) {
//       // console.warn('parse failed: "'+line+'"');
//       return null
//     }
//   }

//   parseLine(line, fileOffset) {
//     const fields = line.split('\t')
//     fields[fields.length - 1] = fields[fields.length - 1].replace(/\n$/, '') // trim off the newline
//     const item = {
//       // note: index column numbers are 1-based
//       ref: fields[this.index.columnNumbers.ref - 1],
//       _regularizedRef: this.browser.regularizeReferenceName(
//         fields[this.index.columnNumbers.ref - 1],
//       ),
//       start: parseInt(fields[this.index.columnNumbers.start - 1]),
//       end: parseInt(fields[this.index.columnNumbers.end - 1]),
//       fields,
//       fileOffset,
//     }
//     return item
//   }
// }
