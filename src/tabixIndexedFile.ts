import AbortablePromiseCache from '@gmod/abortable-promise-cache'
import { unzip, unzipChunkSlice } from '@gmod/bgzf-filehandle'
import LRU from '@jbrowse/quick-lru'
import { LocalFile, RemoteFile } from 'generic-filehandle2'

import Chunk from './chunk.ts'
import CSI from './csi.ts'
import IndexFile, { Options } from './indexFile.ts'
import TBI from './tbi.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

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
  private hasCustomRenameRefSeq: boolean
  private chunkCache: AbortablePromiseCache<Chunk, ReadChunk>
  public cache = new LRU<
    string,
    { bytesRead: number; buffer: Uint8Array; nextIn: number }
  >({
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
    renameRefSeqs: renameRefSeqsPre,
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
    const renameRefSeqs = renameRefSeqsPre ?? (arg => arg)
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
    this.hasCustomRenameRefSeq = renameRefSeqsPre !== undefined
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
    const decoder = new TextDecoder('utf8')

    const isVCF = metadata.format === 'VCF'
    const columnNumbersEffective = {
      ref: metadata.columnNumbers.ref || 0,
      start: metadata.columnNumbers.start || 0,
      end: isVCF ? 8 : metadata.columnNumbers.end || 0,
    }
    const maxColumn = Math.max(
      columnNumbersEffective.ref,
      columnNumbersEffective.start,
      columnNumbersEffective.end,
    )
    const metaCharCode = metadata.metaChar?.charCodeAt(0)
    const coordinateOffset =
      metadata.coordinateType === '1-based-closed' ? -1 : 0
    const isIdentityRename = !this.hasCustomRenameRefSeq

    // now go through each chunk and parse and filter the lines out of it
    for (const c of chunks) {
      const { buffer, cpositions, dpositions } = await this.chunkCache.get(
        c.toString(),
        c,
        signal,
      )

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
          const result = this.checkLine(
            refName,
            start,
            end,
            line,
            columnNumbersEffective,
            maxColumn,
            metaCharCode,
            coordinateOffset,
            isVCF,
            isIdentityRename,
          )

          if (result === null) {
            // the lines were overlapping the region, but now have stopped, so we
            // must be at the end of the relevant data and we can stop processing
            // data now
            return
          } else if (result !== undefined) {
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
          const result = this.checkLine(
            refName,
            start,
            end,
            line,
            columnNumbersEffective,
            maxColumn,
            metaCharCode,
            coordinateOffset,
            isVCF,
            isIdentityRename,
          )

          if (result === null) {
            // the lines were overlapping the region, but now have stopped, so we
            // must be at the end of the relevant data and we can stop processing
            // data now
            return
          } else if (result !== undefined) {
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
   * @param {string} regionRefName
   *
   * @param {number} regionStart region start coordinate (0-based-half-open)
   *
   * @param {number} regionEnd region end coordinate (0-based-half-open)
   *
   * @param {string} line
   *
   * @param {object} columnNumbersEffective pre-calculated column numbers
   *
   * @param {number} maxColumn pre-calculated max column
   *
   * @param {number} metaCharCode pre-calculated metaChar code
   *
   * @param {number} coordinateOffset 0 or -1 for coordinate adjustment
   *
   * @param {boolean} isVCF whether this is VCF format
   *
   * @param {boolean} isIdentityRename whether renameRefSeq is the identity function
   *
   * @returns {number | null | undefined} startCoordinate if overlapping, null if should stop processing, undefined otherwise
   */
  checkLine(
    regionRefName: string,
    regionStart: number,
    regionEnd: number,
    line: string,
    columnNumbersEffective: { ref: number; start: number; end: number },
    maxColumn: number,
    metaCharCode: number | undefined,
    coordinateOffset: number,
    isVCF: boolean,
    isIdentityRename: boolean,
  ) {
    if (metaCharCode !== undefined && line.charCodeAt(0) === metaCharCode) {
      return
    }

    let currentColumnNumber = 1
    let currentColumnStart = 0
    let refSeq = ''
    let startCoordinate = -Infinity
    const l = line.length
    let tabPos = line.indexOf('\t', currentColumnStart)

    while (currentColumnNumber <= maxColumn) {
      const columnEnd = tabPos === -1 ? l : tabPos

      if (currentColumnNumber === columnNumbersEffective.ref) {
        const refMatch = isIdentityRename
          ? line.slice(currentColumnStart, columnEnd) === regionRefName
          : this.renameRefSeq(line.slice(currentColumnStart, columnEnd)) ===
            regionRefName
        if (!refMatch) {
          return
        }
      } else if (currentColumnNumber === columnNumbersEffective.start) {
        startCoordinate =
          Number.parseInt(line.slice(currentColumnStart, columnEnd), 10) +
          coordinateOffset
        if (startCoordinate >= regionEnd) {
          return null
        }
        if (
          (columnNumbersEffective.end === 0 ||
            columnNumbersEffective.end === columnNumbersEffective.start) &&
          startCoordinate + 1 <= regionStart
        ) {
          return
        }
      } else if (isVCF && currentColumnNumber === 4) {
        refSeq = line.slice(currentColumnStart, columnEnd)
      } else if (currentColumnNumber === columnNumbersEffective.end) {
        const endCoordinate = isVCF
          ? this._getVcfEnd(
              startCoordinate,
              refSeq,
              line.slice(currentColumnStart, columnEnd),
            )
          : Number.parseInt(line.slice(currentColumnStart, columnEnd), 10)
        if (endCoordinate <= regionStart) {
          return
        }
      }

      if (currentColumnNumber === maxColumn) {
        break
      }

      currentColumnStart = columnEnd + 1
      currentColumnNumber += 1
      tabPos = line.indexOf('\t', currentColumnStart)
    }
    return startCoordinate
  }

  _getVcfEnd(startCoordinate: number, refSeq: string, info: any) {
    let endCoordinate = startCoordinate + refSeq.length
    const isTRA = info.includes('SVTYPE=TRA')
    if (isTRA) {
      return startCoordinate + 1
    }

    if (info[0] !== '.') {
      const endIdx = info.indexOf('END=')
      if (endIdx !== -1 && (endIdx === 0 || info[endIdx - 1] === ';')) {
        const start = endIdx + 4
        let end = info.indexOf(';', start)
        if (end === -1) {
          end = info.length
        }
        endCoordinate = Number.parseInt(info.slice(start, end), 10)
      }
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
