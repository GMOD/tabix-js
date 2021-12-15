import AbortablePromiseCache from 'abortable-promise-cache'
import LRU from 'quick-lru'
import { GenericFilehandle, LocalFile } from 'generic-filehandle'
import { unzip, unzipChunkSlice } from '@gmod/bgzf-filehandle'
import { checkAbortSignal } from './util'
import IndexFile, { Options } from './indexFile'

import Chunk from './chunk'
import TBI from './tbi'
import CSI from './csi'

type GetLinesCallback = (line: string, fileOffset: number) => void

interface GetLinesOpts {
  [key: string]: unknown
  signal?: AbortSignal
  lineCallback: GetLinesCallback
}

function timeout(time: number) {
  return new Promise(resolve => {
    setTimeout(resolve, time)
  })
}
export default class TabixIndexedFile {
  private filehandle: GenericFilehandle
  private index: IndexFile
  private chunkSizeLimit: number
  private renameRefSeq: (n: string) => string
  private chunkCache: any
  /**
   * @param {object} args
   * @param {string} [args.path]
   * @param {filehandle} [args.filehandle]
   * @param {string} [args.tbiPath]
   * @param {filehandle} [args.tbiFilehandle]
   * @param {string} [args.csiPath]
   * @param {filehandle} [args.csiFilehandle]
   * @param {chunkSizeLimit} default 50MiB
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
    chunkSizeLimit = 50000000,
    renameRefSeqs = n => n,
    chunkCacheSize = 5 * 2 ** 20,
  }: {
    path?: string
    filehandle?: GenericFilehandle
    tbiPath?: string
    tbiFilehandle?: GenericFilehandle
    csiPath?: string
    csiFilehandle?: GenericFilehandle
    chunkSizeLimit?: number
    renameRefSeqs?: (n: string) => string
    chunkCacheSize?: number
  }) {
    if (filehandle) {
      this.filehandle = filehandle
    } else if (path) {
      this.filehandle = new LocalFile(path)
    } else {
      throw new TypeError('must provide either filehandle or path')
    }

    if (tbiFilehandle) {
      this.index = new TBI({
        filehandle: tbiFilehandle,
        renameRefSeqs,
      })
    } else if (csiFilehandle) {
      this.index = new CSI({
        filehandle: csiFilehandle,
        renameRefSeqs,
      })
    } else if (tbiPath) {
      this.index = new TBI({
        filehandle: new LocalFile(tbiPath),
        renameRefSeqs,
      })
    } else if (csiPath) {
      this.index = new CSI({
        filehandle: new LocalFile(csiPath),
        renameRefSeqs,
      })
    } else if (path) {
      this.index = new TBI({
        filehandle: new LocalFile(`${path}.tbi`),
        renameRefSeqs,
      })
    } else {
      throw new TypeError(
        'must provide one of tbiFilehandle, tbiPath, csiFilehandle, or csiPath',
      )
    }

    this.chunkSizeLimit = chunkSizeLimit
    this.renameRefSeq = renameRefSeqs
    this.chunkCache = new AbortablePromiseCache({
      cache: new LRU({
        maxSize: Math.floor(chunkCacheSize / (1 << 16)),
      }),

      fill: this.readChunk.bind(this),
    })
  }

  /**
   * @param {string} refName name of the reference sequence
   * @param {number} start start of the region (in 0-based half-open coordinates)
   * @param {number} end end of the region (in 0-based half-open coordinates)
   * @param {function|object} lineCallback callback called for each line in the region. can also pass a object param containing obj.lineCallback, obj.signal, etc
   * @returns {Promise} resolved when the whole read is finished, rejected on error
   */
  async getLines(
    refName: string,
    start: number,
    end: number,
    opts: GetLinesOpts | GetLinesCallback,
  ) {
    let signal: AbortSignal | undefined
    let options: Options = {}
    let callback: (line: string, lineOffset: number) => void
    if (typeof opts === 'undefined') {
      throw new TypeError('line callback must be provided')
    }
    if (typeof opts === 'function') {
      callback = opts
    } else {
      options = opts
      callback = opts.lineCallback
    }
    if (refName === undefined) {
      throw new TypeError('must provide a reference sequence name')
    }
    if (!callback) {
      throw new TypeError('line callback must be provided')
    }

    const metadata = await this.index.getMetadata(options)
    checkAbortSignal(signal)
    if (!start) {
      start = 0
    }
    if (!end) {
      end = metadata.maxRefLength
    }
    if (!(start <= end)) {
      throw new TypeError(
        'invalid start and end coordinates. start must be less than or equal to end',
      )
    }
    if (start === end) {
      return
    }

    const chunks = await this.index.blocksForRange(refName, start, end, options)
    checkAbortSignal(signal)

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
    let last = Date.now()
    for (let chunkNum = 0; chunkNum < chunks.length; chunkNum += 1) {
      let previousStartCoordinate: number | undefined
      const c = chunks[chunkNum]
      const { buffer, cpositions, dpositions } = await this.chunkCache.get(
        c.toString(),
        c,
        signal,
      )

      const lines = (
        typeof TextDecoder !== 'undefined'
          ? new TextDecoder('utf-8').decode(buffer)
          : buffer.toString()
      ).split('\n')
      lines.pop()

      checkAbortSignal(signal)
      let blockStart = c.minv.dataPosition
      let pos

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]

        for (pos = 0; blockStart >= dpositions[pos]; pos += 1) {}

        // filter the line for whether it is within the requested range
        const { startCoordinate, overlaps } = this.checkLine(
          metadata,
          refName,
          start,
          end,
          line,
        )

        // do a small check just to make sure that the lines are really sorted by start coordinate
        if (
          previousStartCoordinate !== undefined &&
          startCoordinate !== undefined &&
          previousStartCoordinate > startCoordinate
        ) {
          throw new Error(
            `Lines not sorted by start coordinate (${previousStartCoordinate} > ${startCoordinate}), this file is not usable with Tabix.`,
          )
        }
        previousStartCoordinate = startCoordinate

        if (overlaps) {
          callback(
            line.trim(),
            // cpositions[pos] refers to actual file offset of a bgzip block boundaries
            //
            // we multiply by (1 <<8) in order to make sure each block has a "unique"
            // address space so that data in that block could never overlap
            //
            // then the blockStart-dpositions is an uncompressed file offset from
            // that bgzip block boundary, and since the cpositions are multiplied by
            // (1 << 8) these uncompressed offsets get a unique space
            cpositions[pos] * (1 << 8) + (blockStart - dpositions[pos]),
          )
        } else if (startCoordinate !== undefined && startCoordinate >= end) {
          // the lines were overlapping the region, but now have stopped, so
          // we must be at the end of the relevant data and we can stop
          // processing data now
          return
        }
        blockStart += line.length + 1

        // yield if we have emitted beyond the yield limit
        if (last - Date.now() > 500) {
          last = Date.now()
          checkAbortSignal(signal)
          await timeout(1)
        }
      }
    }
  }

  async getMetadata(opts: Options = {}) {
    return this.index.getMetadata(opts)
  }

  /**
   * get a buffer containing the "header" region of
   * the file, which are the bytes up to the first
   * non-meta line
   *
   * @returns {Promise} for a buffer
   */
  async getHeaderBuffer(opts: Options = {}) {
    const { firstDataLine, metaChar, maxBlockSize } = await this.getMetadata(
      opts,
    )
    checkAbortSignal(opts.signal)
    const maxFetch =
      firstDataLine && firstDataLine.blockPosition
        ? firstDataLine.blockPosition + maxBlockSize
        : maxBlockSize
    // TODO: what if we don't have a firstDataLine, and the header
    // actually takes up more than one block? this case is not covered here

    let bytes = await this._readRegion(0, maxFetch, opts)
    checkAbortSignal(opts.signal)
    try {
      bytes = await unzip(bytes)
    } catch (e) {
      console.error(e)
      throw new Error(
        //@ts-ignore
        `error decompressing block ${e.code} at 0 (length ${maxFetch}) ${e}`,
      )
    }

    // trim off lines after the last non-meta line
    if (metaChar) {
      // trim backward from the end
      let lastNewline = -1
      const newlineByte = '\n'.charCodeAt(0)
      const metaByte = metaChar.charCodeAt(0)
      for (let i = 0; i < bytes.length; i += 1) {
        if (i === lastNewline + 1 && bytes[i] !== metaByte) {
          break
        }
        if (bytes[i] === newlineByte) {
          lastNewline = i
        }
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
  async getHeader(opts: Options = {}) {
    const bytes = await this.getHeaderBuffer(opts)
    checkAbortSignal(opts.signal)
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
  async getReferenceSequenceNames(opts: Options = {}) {
    const metadata = await this.getMetadata(opts)
    return metadata.refIdToName
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
    {
      columnNumbers,
      metaChar,
      coordinateType,
      format,
    }: {
      columnNumbers: { ref: number; start: number; end: number }
      metaChar: string
      coordinateType: string
      format: string
    },
    regionRefName: string,
    regionStart: number,
    regionEnd: number,
    line: string,
  ) {
    // skip meta lines
    if (line.charAt(0) === metaChar) {
      return { overlaps: false }
    }

    // check ref/start/end using column metadata from index
    let { ref, start, end } = columnNumbers
    if (!ref) {
      ref = 0
    }
    if (!start) {
      start = 0
    }
    if (!end) {
      end = 0
    }
    if (format === 'VCF') {
      end = 8
    }
    const maxColumn = Math.max(ref, start, end)

    // this code is kind of complex, but it is fairly fast.
    // basically, we want to avoid doing a split, because if the lines are really long
    // that could lead to us allocating a bunch of extra memory, which is slow

    let currentColumnNumber = 1 // cols are numbered starting at 1 in the index metadata
    let currentColumnStart = 0
    let refSeq = ''
    let startCoordinate = -Infinity
    for (let i = 0; i < line.length + 1; i += 1) {
      if (line[i] === '\t' || i === line.length) {
        if (currentColumnNumber === ref) {
          if (
            this.renameRefSeq(line.slice(currentColumnStart, i)) !==
            regionRefName
          ) {
            return { overlaps: false }
          }
        } else if (currentColumnNumber === start) {
          startCoordinate = parseInt(line.slice(currentColumnStart, i), 10)
          // we convert to 0-based-half-open
          if (coordinateType === '1-based-closed') {
            startCoordinate -= 1
          }
          if (startCoordinate >= regionEnd) {
            return { startCoordinate, overlaps: false }
          }
          if (end === 0 || end === start) {
            // if we have no end, we assume the feature is 1 bp long
            if (startCoordinate + 1 <= regionStart) {
              return { startCoordinate, overlaps: false }
            }
          }
        } else if (format === 'VCF' && currentColumnNumber === 4) {
          refSeq = line.slice(currentColumnStart, i)
        } else if (currentColumnNumber === end) {
          let endCoordinate
          // this will never match if there is no end column
          if (format === 'VCF') {
            endCoordinate = this._getVcfEnd(
              startCoordinate,
              refSeq,
              line.slice(currentColumnStart, i),
            )
          } else {
            endCoordinate = parseInt(line.slice(currentColumnStart, i), 10)
          }
          if (endCoordinate <= regionStart) {
            return { overlaps: false }
          }
        }
        currentColumnStart = i + 1
        currentColumnNumber += 1
        if (currentColumnNumber > maxColumn) {
          break
        }
      }
    }
    return { startCoordinate, overlaps: true }
  }

  _getVcfEnd(startCoordinate: number, refSeq: string, info: any) {
    let endCoordinate = startCoordinate + refSeq.length
    // ignore TRA features as they specify CHR2 and END
    // as being on a different chromosome
    // if CHR2 is on the same chromosome, still ignore it
    // because there should be another pairwise feature
    // at the end of this one
    const isTRA = info.indexOf('SVTYPE=TRA') !== -1
    if (info[0] !== '.' && !isTRA) {
      let prevChar = ';'
      for (let j = 0; j < info.length; j += 1) {
        if (prevChar === ';' && info.slice(j, j + 4) === 'END=') {
          let valueEnd = info.indexOf(';', j)
          if (valueEnd === -1) {
            valueEnd = info.length
          }
          endCoordinate = parseInt(info.slice(j + 4, valueEnd), 10)
          break
        }
        prevChar = info[j]
      }
    } else if (isTRA) {
      return startCoordinate + 1
    }
    return endCoordinate
  }

  /**
   * return the approximate number of data lines in the given reference sequence
   * @param {string} refSeq reference sequence name
   * @returns {Promise} for number of data lines present on that reference sequence
   */
  async lineCount(refName: string, opts: Options = {}) {
    return this.index.lineCount(refName, opts)
  }

  async _readRegion(
    position: number,
    compressedSize: number,
    opts: Options = {},
  ) {
    const { bytesRead, buffer } = await this.filehandle.read(
      Buffer.alloc(compressedSize),
      0,
      compressedSize,
      position,
      opts,
    )

    return bytesRead < compressedSize ? buffer.slice(0, bytesRead) : buffer
  }

  /**
   * read and uncompress the data in a chunk (composed of one or more
   * contiguous bgzip blocks) of the file
   * @param {Chunk} chunk
   * @returns {Promise} for a string chunk of the file
   */
  async readChunk(chunk: Chunk, opts: Options = {}) {
    // fetch the uncompressed data, uncompress carefully a block at a time,
    // and stop when done

    const compressedData = await this._readRegion(
      chunk.minv.blockPosition,
      chunk.fetchedSize(),
      opts,
    )
    try {
      return unzipChunkSlice(compressedData, chunk)
    } catch (e) {
      throw new Error(`error decompressing chunk ${chunk.toString()} ${e}`)
    }
  }
}
