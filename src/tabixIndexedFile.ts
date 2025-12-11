import AbortablePromiseCache from '@gmod/abortable-promise-cache'
import { unzip, unzipChunkSlice } from '@gmod/bgzf-filehandle'
import { LocalFile, RemoteFile } from 'generic-filehandle2'
import LRU from 'quick-lru'

import Chunk from './chunk.ts'
import CSI from './csi.ts'
import IndexFile, { IndexData, Options } from './indexFile.ts'
import TBI from './tbi.ts'
import { checkAbortSignal } from './util.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

const NO_OVERLAP = { overlaps: false, startCoordinate: undefined } as const
const END_REGEX = /(?:^|;)END=([^;]+)/
const ZERO = '0'.charCodeAt(0)

function parseIntFromSubstring(str: string, start: number, end: number) {
  let result = 0
  for (let i = start; i < end; i++) {
    result = result * 10 + (str.charCodeAt(i) - ZERO)
  }
  return result
}

function substringEquals(
  str: string,
  start: number,
  end: number,
  target: string,
) {
  const len = end - start
  if (len !== target.length) {
    return false
  }
  for (let i = 0; i < len; i++) {
    if (str.charCodeAt(start + i) !== target.charCodeAt(i)) {
      return false
    }
  }
  return true
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
  private renameRefSeqIsIdentity: boolean
  private chunkCache: AbortablePromiseCache<Chunk, ReadChunk>
  public cache = new LRU<string, { buffer: Uint8Array; nextIn: number }>({
    maxSize: 1000,
  })

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
    renameRefSeqs,
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

    this.renameRefSeqIsIdentity = !renameRefSeqs
    this.renameRefSeq = renameRefSeqs ?? (n => n)
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
  private calculateFileOffset(
    cpositions: number[],
    dpositions: number[],
    pos: number,
    blockStart: number,
    minvDataPosition: number,
  ) {
    return (
      cpositions[pos]! * (1 << 8) +
      (blockStart - dpositions[pos]!) +
      minvDataPosition +
      1
    )
  }

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
      // converted to string and processed directly.
      //
      // if it is not ASCII or, we have to decode line by line, as it is
      // otherwise hard to get the right 'fileOffset' based feature IDs
      //
      // we use a basic check for isASCII: string length equals buffer length
      // if it is ASCII...no multi-byte decodings
      const str = decoder.decode(buffer)
      const strIsASCII = buffer.length == str.length
      if (strIsASCII) {
        while (blockStart < str.length) {
          const n = str.indexOf('\n', blockStart)
          if (n === -1) {
            break
          }
          const line = str.slice(blockStart, n)

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (dpositions) {
            const target = blockStart + c.minv.dataPosition
            while (pos < dpositions.length && target >= dpositions[pos]!) {
              pos++
            }
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
              this.calculateFileOffset(
                cpositions,
                dpositions,
                pos,
                blockStart,
                c.minv.dataPosition,
              ),
            )
          } else if (startCoordinate !== undefined && startCoordinate >= end) {
            // the lines were overlapping the region, but now have stopped, so we
            // must be at the end of the relevant data and we can stop processing
            // data now
            return
          }
          blockStart = n + 1
        }
      } else {
        while (blockStart < buffer.length) {
          const n = buffer.indexOf('\n'.charCodeAt(0), blockStart)
          if (n === -1) {
            break
          }
          const b = buffer.slice(blockStart, n)
          const line = decoder.decode(b)

          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (dpositions) {
            const target = blockStart + c.minv.dataPosition
            while (pos < dpositions.length && target >= dpositions[pos]!) {
              pos++
            }
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
              this.calculateFileOffset(
                cpositions,
                dpositions,
                pos,
                blockStart,
                c.minv.dataPosition,
              ),
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

      for (let i = 0, l = bytes.length; i < l; i++) {
        const byte = bytes[i]
        if (i === lastNewline + 1 && byte !== metaByte) {
          break
        }
        if (byte === newlineByte) {
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
    if (metaChar && line.charCodeAt(0) === metaChar.charCodeAt(0)) {
      return NO_OVERLAP
    }

    let { ref, start, end } = columnNumbers
    ref ||= 0
    start ||= 0
    end ||= 0
    if (format === 'VCF') {
      end = 8
    }
    const maxColumn = Math.max(ref, start, end)

    let currentColumnNumber = 1
    let currentColumnStart = 0
    let refSeqStart = 0
    let refSeqEnd = 0
    let startCoordinate = -Infinity
    let i = 0
    const l = line.length

    while (currentColumnNumber <= maxColumn) {
      const nextTab = line.indexOf('\t', i)
      const columnEnd = nextTab === -1 ? l : nextTab

      if (currentColumnNumber === ref) {
        const refMatches = this.renameRefSeqIsIdentity
          ? substringEquals(line, currentColumnStart, columnEnd, regionRefName)
          : this.renameRefSeq(line.slice(currentColumnStart, columnEnd)) ===
            regionRefName
        if (!refMatches) {
          return NO_OVERLAP
        }
      } else if (currentColumnNumber === start) {
        startCoordinate = parseIntFromSubstring(
          line,
          currentColumnStart,
          columnEnd,
        )
        if (coordinateType === '1-based-closed') {
          startCoordinate -= 1
        }
        if (startCoordinate >= regionEnd) {
          return { startCoordinate, overlaps: false }
        }
        if (
          (end === 0 || end === start) &&
          startCoordinate + 1 <= regionStart
        ) {
          return { startCoordinate, overlaps: false }
        }
      } else if (format === 'VCF' && currentColumnNumber === 4) {
        refSeqStart = currentColumnStart
        refSeqEnd = columnEnd
      } else if (currentColumnNumber === end) {
        const endCoordinate =
          format === 'VCF'
            ? this._getVcfEnd(
                startCoordinate,
                refSeqEnd - refSeqStart,
                line.slice(currentColumnStart, columnEnd),
              )
            : parseIntFromSubstring(line, currentColumnStart, columnEnd)
        if (endCoordinate <= regionStart) {
          return NO_OVERLAP
        }
      }

      if (nextTab === -1) {
        break
      }
      currentColumnStart = nextTab + 1
      i = currentColumnStart
      currentColumnNumber += 1
    }

    return { startCoordinate, overlaps: true }
  }

  _getVcfEnd(startCoordinate: number, refSeqLength: number, info: string) {
    let endCoordinate = startCoordinate + refSeqLength
    const isTRA = info.includes('SVTYPE=TRA')
    if (!info.startsWith('.') && !isTRA) {
      const match = END_REGEX.exec(info)
      if (match) {
        endCoordinate = Number.parseInt(match[1]!, 10)
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
    return unzipChunkSlice(ret, c, this.cache)
  }
}
