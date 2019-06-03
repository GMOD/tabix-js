const LRU = require('quick-lru')
const { LocalFile } = require('generic-filehandle')
const { unzip, unzipChunk } = require('./unzip')

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
   * @param {function} [args.renameRefSeqs] optional function with sig `string => string` to transform
   * reference sequence names for the purpose of indexing and querying. note that the data that is returned is
   * not altered, just the names of the reference sequences that are used for querying.
   * @param {number} [args.chunkCacheSize] maximum size in bytes of the chunk cache. default 5MB
   * @param {number} [args.blockCacheSize] maximum size in bytes of the block cache. default 5MB
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
    renameRefSeqs = n => n,
    chunkCacheSize = 5 * 2 ** 20,
    blockCacheSize = 5 * 2 ** 20,
  }) {
    if (filehandle) this.filehandle = filehandle
    else if (path) this.filehandle = new LocalFile(path)
    else throw new TypeError('must provide either filehandle or path')

    if (tbiFilehandle)
      this.index = new TBI({ filehandle: tbiFilehandle, renameRefSeqs })
    else if (csiFilehandle)
      this.index = new CSI({ filehandle: csiFilehandle, renameRefSeqs })
    else if (tbiPath)
      this.index = new TBI({
        filehandle: new LocalFile(tbiPath),
        renameRefSeqs,
      })
    else if (csiPath)
      this.index = new CSI({
        filehandle: new LocalFile(csiPath),
        renameRefSeqs,
      })
    else if (path) {
      this.index = new TBI({ filehandle: new LocalFile(`${path}.tbi`) })
    } else {
      throw new TypeError(
        'must provide one of tbiFilehandle, tbiPath, csiFilehandle, or csiPath',
      )
    }

    this.chunkSizeLimit = chunkSizeLimit
    this.yieldLimit = yieldLimit
    this.renameRefSeqCallback = renameRefSeqs
    this.chunkCache = new LRU({
      maxSize: Math.floor(chunkCacheSize / (1 << 16)),
    })
    this.blockCache = new LRU({
      maxSize: Math.floor(blockCacheSize / (1 << 16)),
    })
  }

  /**
   * @param {string} refName name of the reference sequence
   * @param {number} start start of the region (in 0-based half-open coordinates)
   * @param {number} end end of the region (in 0-based half-open coordinates)
   * @param {function} lineCallback callback called for each line in the region, called as (line, fileOffset)
   * @returns {Promise} resolved when the whole read is finished, rejected on error
   */
  async getLines(refName, start, end, lineCallback) {
    if (refName === undefined)
      throw new TypeError('must provide a reference sequence name')
    if (!lineCallback) throw new TypeError('line callback must be provided')
    if (!(start <= end))
      throw new TypeError(
        'invalid start and end coordinates. must be provided, and start must be less than or equal to end',
      )
    else if (start === end) return

    const chunks = await this.index.blocksForRange(refName, start, end)
    const metadata = await this.index.getMetadata()

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
    for (let chunkNum = 0; chunkNum < chunks.length; chunkNum += 1) {
      const chunk = chunks[chunkNum]
      const currentLineStart = chunk.minv.dataPosition
      const fileOffset = chunk.minv.blockPosition * 2 ** 16
      await this.readChunk(chunk, {
        refName,
        start,
        end,
        metadata,
        fileOffset,
        currentLineStart,
        lineCallback,
      })
    }
  }

  async getMetadata() {
    return this.index.getMetadata()
  }

  /**
   * get a buffer containing the "header" region of
   * the file, which are the bytes up to the first
   * non-meta line
   *
   * @returns {Promise} for a buffer
   */
  async getHeaderBuffer() {
    const { firstDataLine, metaChar, maxBlockSize } = await this.getMetadata()
    const maxFetch =
      firstDataLine && firstDataLine.blockPosition
        ? firstDataLine.blockPosition + maxBlockSize
        : maxBlockSize
    // TODO: what if we don't have a firstDataLine, and the header
    // actually takes up more than one block? this case is not covered here

    let bytes = await this._readRegion(0, maxFetch)
    try {
      bytes = unzip(bytes)
    } catch (e) {
      console.log(e)
      throw new Error(
        `error decompressing block ${e.code} at 0 (length ${maxFetch})`,
        e,
      )
    }

    // trim off lines after the last non-meta line
    if (metaChar) {
      // trim backward from the end
      let lastNewline = -1
      const newlineByte = '\n'.charCodeAt(0)
      const metaByte = metaChar.charCodeAt(0)
      for (let i = 0; i < bytes.length; i += 1) {
        if (i === lastNewline + 1 && bytes[i] !== metaByte) break
        if (bytes[i] === newlineByte) lastNewline = i
      }
      bytes = bytes.slice(0, lastNewline + 1)
    }
    return bytes
  }

  /**
   * get a string containing the "header" region of the
   * file, is the portion up to the first non-meta line
   *
   * @returns {Promise} for a string
   */
  async getHeader() {
    const bytes = await this.getHeaderBuffer()
    return bytes.toString('utf8')
  }

  /**
   * get an array of reference sequence names, in the order in which
   * they occur in the file.
   *
   * reference sequence renaming is not applied to these names.
   *
   * @returns {Promise} for an array of string sequence names
   */
  async getReferenceSequenceNames() {
    const metadata = await this.getMetadata()
    return metadata.refIdToName
  }

  renameRefSeq(refName) {
    if (this._renameRefSeqCache && this._renameRefSeqCache.from === refName)
      return this._renameRefSeqCache.to

    const renamed = this.renameRefSeqCallback(refName)
    this._renameRefSeqCache = { from: refName, to: renamed }
    return renamed
  }

  /**
   * @param {object} metadata metadata object from the parsed index,
   * containing columnNumbers, metaChar, and format
   * @param {string} regionRefName
   * @param {number} regionStart region start coordinate (0-based-half-open)
   * @param {number} regionEnd region end coordinate (0-based-half-open)
   * @param {array[string]} line
   * @returns {object} like `{startCoordinate, overlaps}`. overlaps is boolean,
   * true if line is a data line that overlaps the given region
   */
  checkLine(
    { columnNumbers, metaChar, coordinateType, format },
    regionRefName,
    regionStart,
    regionEnd,
    line,
  ) {
    // skip meta lines
    if (line[0] === metaChar.charCodeAt(0)) return { overlaps: false }

    // check ref/start/end using column metadata from index
    let { ref, start, end } = columnNumbers
    if (!ref) ref = 0
    if (!start) start = 0
    if (!end) end = 0

    if (format === 'VCF') end = 8
    const maxColumn = Math.max(ref, start, end)

    let currNumTabs = 0
    let currPos = 0
    const tab = '\t'.charCodeAt(0)
    const nl = '\n'.charCodeAt(0)
    const cr = '\r'.charCodeAt(0)

    for (; currPos < line.byteLength && currNumTabs < maxColumn; currPos += 1) {
      if (line[currPos] === tab) currNumTabs += 1
      if (line[currPos] === nl || line[currPos] === cr) break
    }
    const fields = line
      .slice(0, currPos - 1)
      .toString('ascii')
      .split('\t')

    if (fields.length < maxColumn) {
      console.error('incomplete line')
      return { overlaps: false }
    }

    if (this.renameRefSeq(fields[ref - 1]) !== regionRefName) {
      return { overlaps: false }
    }

    let startCoordinate = parseInt(fields[start - 1], 10)
    if (coordinateType === '1-based-closed') startCoordinate -= 1
    if (startCoordinate >= regionEnd) {
      return { startCoordinate, overlaps: false }
    }

    if (end === 0) {
      // if we have no end, we assume the feature is 1 bp long
      if (startCoordinate + 1 <= regionStart) {
        return { startCoordinate, overlaps: false }
      }
    }

    const endCoordinate =
      format === 'VCF'
        ? this._getVcfEnd(startCoordinate, fields[4], fields[7])
        : parseInt(fields[end - 1], 10)

    if (endCoordinate <= regionStart) {
      return { overlaps: false }
    }

    return { startCoordinate, overlaps: true }
  }

  _getVcfEnd(startCoordinate, refSeq, info) {
    let endCoordinate = startCoordinate + refSeq.length
    if (info[0] !== '.') {
      let prevChar = ';'
      for (let j = 0; j < info.length; j += 1) {
        if (prevChar === ';' && info.slice(j, j + 4) === 'END=') {
          let valueEnd = info.indexOf(';', j)
          if (valueEnd === -1) valueEnd = info.length
          endCoordinate = parseInt(info.slice(j + 4, valueEnd), 10)
          break
        }
        prevChar = info[j]
      }
    }
    return endCoordinate
  }

  /**
   * return the approximate number of data lines in the given reference sequence
   * @param {string} refSeq reference sequence name
   * @returns {Promise} for number of data lines present on that reference sequence
   */
  async lineCount(refSeq) {
    return this.index.lineCount(refSeq)
  }

  _cacheWith(cache, cacheKey, fillCallback) {
    const cachedPromise = cache.get(cacheKey)
    if (cachedPromise) return cachedPromise

    const freshPromise = fillCallback()
    cache.set(cacheKey, freshPromise)
    return freshPromise
  }

  async _readRegion(position, compressedSize) {
    // console.log(`reading region ${position} / ${compressedSize}`)
    const { size: fileSize } = await this.filehandle.stat()
    if (position + compressedSize > fileSize)
      compressedSize = fileSize - position

    const compressedData = Buffer.alloc(compressedSize)

    /* const bytesRead = */ await this.filehandle.read(
      compressedData,
      0,
      compressedSize,
      position,
    )

    return compressedData
  }

  /**
   * read and uncompress the data in a chunk (composed of one or more
   * contiguous bgzip blocks) of the file
   * @param {Chunk} chunk
   * @returns {Promise} for a string chunk of the file
   */
  async readChunk(
    chunk,
    {
      refName,
      start,
      end,
      metadata,
      currentLineStart,
      fileOffset,
      lineCallback,
    },
  ) {
    const uncompressed = await this._cacheWith(
      this.chunkCache,
      chunk.toString(),
      async () => {
        // fetch the uncompressed data, uncompress carefully a block at a time,
        // and stop when done

        const compressedData = await this._readRegion(
          chunk.minv.blockPosition,
          chunk.fetchedSize(),
        )
        let uncom
        try {
          uncom = unzipChunk(compressedData, chunk)
        } catch (e) {
          // this is uncaught by our code
          throw new Error(`error decompressing chunk ${chunk.toString()}`)
        }
        return uncom
      },
    )

    let currBuffer = uncompressed
    let previousStartCoordinate = -Infinity

    let linesSinceLastYield = 0
    // eslint-disable-next-line no-cond-assign
    while (true) {
      const currEndLinePos = currBuffer.indexOf('\n')
      if (currEndLinePos === -1) break
      const prevLineStart = currentLineStart
      currentLineStart += currEndLinePos + 1
      const { startCoordinate, overlaps } = this.checkLine(
        metadata,
        refName,
        start,
        end,
        currBuffer,
      )
      const line = currBuffer.slice(0, currEndLinePos).toString('utf8')
      currBuffer = currBuffer.slice(currEndLinePos + 1)
      // do a small check just to make sure that the lines are really sorted by start coordinate
      if (previousStartCoordinate > startCoordinate)
        throw new Error(
          `Lines not sorted by start coordinate (${previousStartCoordinate} > ${startCoordinate}), this file is not usable with Tabix.`,
        )
      previousStartCoordinate = startCoordinate

      if (overlaps) {
        lineCallback(line, fileOffset + prevLineStart)
      } else if (startCoordinate >= end) {
        break
      }
      linesSinceLastYield += 1
      if (linesSinceLastYield >= this.yieldLimit) {
        await timeout(1)
        linesSinceLastYield = 0
      }
    }
  }
}

module.exports = TabixIndexedFile
