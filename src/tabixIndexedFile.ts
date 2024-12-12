import AbortablePromiseCache from '@gmod/abortable-promise-cache'
import LRU from 'quick-lru'
import { GenericFilehandle, RemoteFile, LocalFile } from 'generic-filehandle2'
import { unzip, unzipChunkSlice } from '@gmod/bgzf-filehandle'
import { checkAbortSignal } from './util'
import IndexFile, { Options, IndexData } from './indexFile'

import Chunk from './chunk'
import TBI from './tbi'
import CSI from './csi'

function isASCII(str: string) {
  // eslint-disable-next-line no-control-regex
  return /^[\u0000-\u007F]*$/.test(str)
}

type GetLinesCallback = (line: string, fileOffset: number) => void

interface GetLinesOpts {
  [key: string]: unknown
  signal?: AbortSignal
  lineCallback: GetLinesCallback
}

interface ReadChunk {
  buffer: Uint8Array
  cpositions: number[]
  dpositions: number[]
}

export default class TabixIndexedFile {
  private filehandle: GenericFilehandle
  private index: IndexFile
  private renameRefSeq: (n: string) => string
  private chunkCache: AbortablePromiseCache<Chunk, ReadChunk>

  /**
   * @param {object} args
   *
   * @param {string} [args.path]
   *
   * @param {filehandle} [args.filehandle]
   *
   * @param {string} [args.tbiPath]
   *
   * @param {filehandle} [args.tbiFilehandle]
   *
   * @param {string} [args.csiPath]
   *
   * @param {filehandle} [args.csiFilehandle]
   *
   * @param {url} [args.url]
   *
   * @param {csiUrl} [args.csiUrl]
   *
   * @param {tbiUrl} [args.tbiUrl]
   *
   * @param {function} [args.renameRefSeqs] optional function with sig `string
   * => string` to transform reference sequence names for the purpose of
   * indexing and querying. note that the data that is returned is not altered,
   * just the names of the reference sequences that are used for querying.
   */
  constructor({
    path,
    filehandle,
    url,
    tbiPath,
    tbiUrl,
    tbiFilehandle,
    csiPath,
    csiUrl,
    csiFilehandle,
    renameRefSeqs = n => n,
    chunkCacheSize = 5 * 2 ** 20,
  }: {
    path?: string
    filehandle?: GenericFilehandle
    url?: string
    tbiPath?: string
    tbiUrl?: string
    tbiFilehandle?: GenericFilehandle
    csiPath?: string
    csiUrl?: string
    csiFilehandle?: GenericFilehandle
    renameRefSeqs?: (n: string) => string
    chunkCacheSize?: number
  }) {
    if (filehandle) {
      this.filehandle = filehandle
    } else if (path) {
      this.filehandle = new LocalFile(path)
    } else if (url) {
      this.filehandle = new RemoteFile(url)
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
    } else if (csiUrl) {
      this.index = new CSI({
        filehandle: new RemoteFile(csiUrl),
      })
    } else if (tbiUrl) {
      this.index = new TBI({
        filehandle: new RemoteFile(tbiUrl),
      })
    } else if (url) {
      this.index = new TBI({
        filehandle: new RemoteFile(`${url}.tbi`),
      })
    } else {
      throw new TypeError(
        'must provide one of tbiFilehandle, tbiPath, csiFilehandle, csiPath, tbiUrl, csiUrl',
      )
    }

    this.renameRefSeq = renameRefSeqs
    this.chunkCache = new AbortablePromiseCache<Chunk, ReadChunk>({
      cache: new LRU({ maxSize: Math.floor(chunkCacheSize / (1 << 16)) }),
      fill: (args: Chunk, signal?: AbortSignal) =>
        this.readChunk(args, { signal }),
    })
  }

  /**
   * @param refName name of the reference sequence
   *
   * @param start start of the region (in 0-based half-open coordinates)
   *
   * @param end end of the region (in 0-based half-open coordinates)
   *
   * @param opts callback called for each line in the region. can also pass a
   * object param containing obj.lineCallback, obj.signal, etc
   *
   * @returns promise that is resolved when the whole read is finished,
   * rejected on error
   */
  async getLines(
    refName: string,
    s: number | undefined,
    e: number | undefined,
    opts: GetLinesOpts | GetLinesCallback,
  ) {
    let signal: AbortSignal | undefined
    let options: Options = {}
    let callback: (line: string, lineOffset: number) => void

    if (typeof opts === 'function') {
      callback = opts
    } else {
      options = opts
      callback = opts.lineCallback
      signal = opts.signal
    }

    const metadata = await this.index.getMetadata(options)
    checkAbortSignal(signal)
    const start = s ?? 0
    const end = e ?? metadata.maxRefLength
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
    const decoder = new TextDecoder('utf8')

    // now go through each chunk and parse and filter the lines out of it
    for (const c of chunks) {
      const { buffer, cpositions, dpositions } = await this.chunkCache.get(
        c.toString(),
        c,
        signal,
      )

      checkAbortSignal(signal)
      let blockStart = 0
      let pos = 0

      // fast path, Buffer is just ASCII chars and not gigantor, can be
      // converted to string and processed directly. if it is not ASCII or
      // gigantic (chrome max str len is 512Mb), we have to decode line by line
      const str = decoder.decode(buffer)
      const strIsASCII = isASCII(str)
      while (blockStart < str.length) {
        let line: string
        let n: number
        if (strIsASCII) {
          n = str.indexOf('\n', blockStart)
          if (n === -1) {
            break
          }
          line = str.slice(blockStart, n)
        } else {
          n = buffer.indexOf('\n'.charCodeAt(0), blockStart)
          if (n === -1) {
            break
          }
          const b = buffer.slice(blockStart, n)
          line = decoder.decode(b)
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (dpositions) {
          while (blockStart + c.minv.dataPosition >= dpositions[pos++]!) {}
          pos--
        }

        // filter the line for whether it is within the requested range
        const { startCoordinate, overlaps } = this.checkLine(
          metadata,
          refName,
          start,
          end,
          line,
        )

        if (overlaps) {
          callback(
            line,
            // cpositions[pos] refers to actual file offset of a bgzip block
            // boundaries
            //
            // we multiply by (1 <<8) in order to make sure each block has a
            // "unique" address space so that data in that block could never
            // overlap
            //
            // then the blockStart-dpositions is an uncompressed file offset
            // from that bgzip block boundary, and since the cpositions are
            // multiplied by (1 << 8) these uncompressed offsets get a unique
            // space
            cpositions[pos]! * (1 << 8) +
              (blockStart - dpositions[pos]!) +
              c.minv.dataPosition +
              1,
          )
        } else if (startCoordinate !== undefined && startCoordinate >= end) {
          // the lines were overlapping the region, but now have stopped, so we
          // must be at the end of the relevant data and we can stop processing
          // data now
          return
        }
        blockStart = n + 1
      }
    }
  }

  async getMetadata(opts: Options = {}) {
    return this.index.getMetadata(opts)
  }

  /**
   * get a buffer containing the "header" region of the file, which are the
   * bytes up to the first non-meta line
   */
  async getHeaderBuffer(opts: Options = {}) {
    const { firstDataLine, metaChar, maxBlockSize } =
      await this.getMetadata(opts)

    checkAbortSignal(opts.signal)

    const maxFetch = (firstDataLine?.blockPosition || 0) + maxBlockSize
    // TODO: what if we don't have a firstDataLine, and the header actually
    // takes up more than one block? this case is not covered here

    const buf = await this.filehandle.read(maxFetch, 0, opts)
    const bytes = await unzip(buf)

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
      return bytes.subarray(0, lastNewline + 1)
    }
    return bytes
  }

  /**
   * get a string containing the "header" region of the file, is the portion up
   * to the first non-meta line
   *
   * @returns {Promise} for a string
   */
  async getHeader(opts: Options = {}) {
    const decoder = new TextDecoder('utf8')
    const bytes = await this.getHeaderBuffer(opts)
    return decoder.decode(bytes)
  }

  /**
   * get an array of reference sequence names, in the order in which they occur
   * in the file. reference sequence renaming is not applied to these names.
   */
  async getReferenceSequenceNames(opts: Options = {}) {
    const metadata = await this.getMetadata(opts)
    return metadata.refIdToName
  }

  /**
   * @param {object} metadata metadata object from the parsed index, containing
   * columnNumbers, metaChar, and format
   *
   * @param {string} regionRefName
   *
   * @param {number} regionStart region start coordinate (0-based-half-open)
   *
   * @param {number} regionEnd region end coordinate (0-based-half-open)
   *
   * @param {array[string]} line
   *
   * @returns {object} like `{startCoordinate, overlaps}`. overlaps is boolean,
   * true if line is a data line that overlaps the given region
   */
  checkLine(
    metadata: IndexData,
    regionRefName: string,
    regionStart: number,
    regionEnd: number,
    line: string,
  ) {
    const { columnNumbers, metaChar, coordinateType, format } = metadata
    // skip meta lines
    if (metaChar && line.startsWith(metaChar)) {
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

    // this code is kind of complex, but it is fairly fast. basically, we want
    // to avoid doing a split, because if the lines are really long that could
    // lead to us allocating a bunch of extra memory, which is slow

    let currentColumnNumber = 1 // cols are numbered starting at 1 in the index metadata
    let currentColumnStart = 0
    let refSeq = ''
    let startCoordinate = -Infinity
    const l = line.length
    for (let i = 0; i < l + 1; i++) {
      if (line[i] === '\t' || i === l) {
        if (currentColumnNumber === ref) {
          if (
            this.renameRefSeq(line.slice(currentColumnStart, i)) !==
            regionRefName
          ) {
            return {
              overlaps: false,
            }
          }
        } else if (currentColumnNumber === start) {
          startCoordinate = parseInt(line.slice(currentColumnStart, i), 10)
          // we convert to 0-based-half-open
          if (coordinateType === '1-based-closed') {
            startCoordinate -= 1
          }
          if (startCoordinate >= regionEnd) {
            return {
              startCoordinate,
              overlaps: false,
            }
          }
          if (end === 0 || end === start) {
            // if we have no end, we assume the feature is 1 bp long
            if (startCoordinate + 1 <= regionStart) {
              return {
                startCoordinate,
                overlaps: false,
              }
            }
          }
        } else if (format === 'VCF' && currentColumnNumber === 4) {
          refSeq = line.slice(currentColumnStart, i)
        } else if (currentColumnNumber === end) {
          // this will never match if there is no end column
          const endCoordinate =
            format === 'VCF'
              ? this._getVcfEnd(
                  startCoordinate,
                  refSeq,
                  line.slice(currentColumnStart, i),
                )
              : Number.parseInt(line.slice(currentColumnStart, i), 10)
          if (endCoordinate <= regionStart) {
            return {
              overlaps: false,
            }
          }
        }
        currentColumnStart = i + 1
        currentColumnNumber += 1
        if (currentColumnNumber > maxColumn) {
          break
        }
      }
    }
    return {
      startCoordinate,
      overlaps: true,
    }
  }

  _getVcfEnd(startCoordinate: number, refSeq: string, info: any) {
    let endCoordinate = startCoordinate + refSeq.length
    // ignore TRA features as they specify CHR2 and END as being on a different
    // chromosome
    //
    // if CHR2 is on the same chromosome, still ignore it because there should
    // be another pairwise feature at the end of this one
    const isTRA = info.includes('SVTYPE=TRA')
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
   * return the approximate number of data lines in the given reference
   * sequence
   *
   * @param refSeq reference sequence name
   *
   * @returns number of data lines present on that reference sequence
   */
  async lineCount(refName: string, opts: Options = {}) {
    return this.index.lineCount(refName, opts)
  }

  /**
   * read and uncompress the data in a chunk (composed of one or more
   * contiguous bgzip blocks) of the file
   */
  async readChunk(c: Chunk, opts: Options = {}) {
    const ret = await this.filehandle.read(
      c.fetchedSize(),
      c.minv.blockPosition,
      opts,
    )
    return unzipChunkSlice(ret, c)
  }
}
