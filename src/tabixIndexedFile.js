const promisify = require('util.promisify')
const zlib = require('zlib')

const gunzip = promisify(zlib.gunzip)
const LocalFile = require('./localFile')
const TBI = require('./tbi')
const CSI = require('./csi')

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
    yieldLimit = 300,
  }) {
    if (filehandle) this.filehandle = filehandle
    else if (path) this.filehandle = new LocalFile(path)
    else throw new TypeError('must provide either filehandle or path')

    if (tbiFilehandle) this.index = new TBI(tbiFilehandle)
    else if (csiFilehandle) this.index = new CSI(csiFilehandle)
    else if (tbiPath) this.index = new TBI(new LocalFile(tbiPath))
    else if (csiPath) this.index = new CSI(new LocalFile(csiPath))
    else if (path) {
      this.index = new TBI(new LocalFile(`${path}.tbi`))
    } else {
      throw new TypeError(
        'must provide one of tbiFilehandle, tbiPath, csiFilehandle, or csiPath',
      )
    }

    this.chunkSizeLimit = chunkSizeLimit
    this.yieldLimit = yieldLimit
  }

  /**
   * @param {string} refName name of the reference sequence
   * @param {number} start start of the region (in 0-based half-open coordinates)
   * @param {number} end end of the region (in 0-based half-open coordinates)
   * @param {function} lineCallback callback called for each line in the region
   * @returns {Promise} resolved when the whole read is finished, rejected on error
   */
  async getLines(refName, start, end, lineCallback) {
    if (refName === undefined)
      throw new TypeError('must provide a reference sequence name')
    if (!(start <= end))
      throw new TypeError(
        'invalid start and end coordinates. must be provided, and start must be less than or equal to end',
      )
    if (!lineCallback) throw new TypeError('line callback must be provided')

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
    let foundStart = false
    for (let chunkNum = 0; chunkNum < chunks.length; chunkNum += 1) {
      const chunkData = await this.readChunk(chunks[chunkNum])
      // go through the data and parse out lines
      let currentLineStart = 0
      for (let i = 0; i < chunkData.length; i += 1) {
        if (chunkData[i] === newLineByte) {
          if (currentLineStart < i) {
            const line = chunkData.toString('utf8', currentLineStart, i).trim()
            // filter the line for whether it is within the requested range
            if (this.lineOverlapsRegion(metadata, refName, start, end, line)) {
              foundStart = true
              lineCallback(line)
            } else if (foundStart) {
              // the lines were overlapping the region, but now have stopped, so
              // we must be at the end of the relevant data and we can stop
              // processing data now
              return
            }

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
      // any partial line at the end of the chunk will be discarded
    }
  }

  /**
   * @param {object} metadata metadata object from the parsed index,
   * containing columnNumbers, metaChar, and maxColumn
   * @param {string} regionRefName
   * @param {number} regionStart region start coordinate (0-based-half-open)
   * @param {number} regionEnd region end coordinate (0-based-half-open)
   * @param {string} line
   * @returns {boolean} whether the line is a data line that overlaps the given region
   */
  lineOverlapsRegion(
    { columnNumbers, metaChar, maxColumn, coordinateType },
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
          let startCoordinate = parseInt(line.slice(currentColumnStart, i), 10)
          // we convert to 0-based-half-open
          if (coordinateType === '1-based-closed') startCoordinate -= 1
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
    const compressedSize = chunk.fetchedSize()
    const compressedData = Buffer.alloc(compressedSize)
    const bytesRead = await this.filehandle.read(
      compressedData,
      0,
      compressedSize,
      chunk.minv.blockPosition,
    )
    // if (bytesRead !== compressedSize) {
    //   debugger
    //   // throw new Error(
    //   //   `failed to read block at ${
    //   //     chunk.minv.blockPosition
    //   //   } (reported length is ${compressedSize}, but ${bytesRead} compressed bytes were read)`,
    //   // )
    // }
    const constantsObject = zlib.constants || zlib
    const uncompressed = await gunzip(compressedData, {
      finishFlush: constantsObject.Z_SYNC_FLUSH,
    }).catch(e => {
      throw new Error(
        `error decompressing block ${e.code} at ${
          chunk.minv.blockPosition
        } (length ${compressedSize})`,
        e,
        compressedData,
      )
    })
    return uncompressed.slice(chunk.minv.dataPosition)
  }
}

module.exports = TabixIndexedFile
