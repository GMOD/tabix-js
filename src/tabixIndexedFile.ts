import AbortablePromiseCache from '@gmod/abortable-promise-cache'
import { unzip, unzipChunkSlice } from '@gmod/bgzf-filehandle'
import LRU from '@jbrowse/quick-lru'
import { LocalFile, RemoteFile } from 'generic-filehandle2'

import Chunk from './chunk.ts'
import CSI from './csi.ts'
import IndexFile, { Options } from './indexFile.ts'
import TBI from './tbi.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

type GetLinesCallback = (
  line: string,
  fileOffset: number,
  start: number,
  end: number,
) => void

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

const TAB = 9
const NEWLINE = 10

export default class TabixIndexedFile {
  private filehandle: GenericFilehandle
  private index: IndexFile
  private chunkCache: AbortablePromiseCache<Chunk, ReadChunk>
  public cache = new LRU<
    string,
    { bytesRead: number; buffer: Uint8Array; nextIn: number }
  >({
    maxSize: 1000,
  })

  /**
   * @param {object} args
   * @param {string} [args.path]
   * @param {filehandle} [args.filehandle]
   * @param {string} [args.tbiPath]
   * @param {filehandle} [args.tbiFilehandle]
   * @param {string} [args.csiPath]
   * @param {filehandle} [args.csiFilehandle]
   * @param {url} [args.url]
   * @param {csiUrl} [args.csiUrl]
   * @param {tbiUrl} [args.tbiUrl]
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
      this.index = new TBI({ filehandle: tbiFilehandle })
    } else if (csiFilehandle) {
      this.index = new CSI({ filehandle: csiFilehandle })
    } else if (tbiPath) {
      this.index = new TBI({ filehandle: new LocalFile(tbiPath) })
    } else if (csiPath) {
      this.index = new CSI({ filehandle: new LocalFile(csiPath) })
    } else if (path) {
      this.index = new TBI({ filehandle: new LocalFile(`${path}.tbi`) })
    } else if (csiUrl) {
      this.index = new CSI({ filehandle: new RemoteFile(csiUrl) })
    } else if (tbiUrl) {
      this.index = new TBI({ filehandle: new RemoteFile(tbiUrl) })
    } else if (url) {
      this.index = new TBI({ filehandle: new RemoteFile(`${url}.tbi`) })
    } else {
      throw new TypeError(
        'must provide one of tbiFilehandle, tbiPath, csiFilehandle, csiPath, tbiUrl, csiUrl',
      )
    }

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
    let callback: GetLinesCallback

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
    const encoder = new TextEncoder()

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

    const regionRefNameBytes = encoder.encode(refName)

    for (const c of chunks) {
      const { buffer, cpositions, dpositions } = await this.chunkCache.get(
        c.toString(),
        c,
        signal,
      )

      let blockStart = 0
      let pos = 0

      while (blockStart < buffer.length) {
        const n = buffer.indexOf(NEWLINE, blockStart)
        if (n === -1) {
          break
        }

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (dpositions) {
          const target = blockStart + c.minv.dataPosition
          while (pos < dpositions.length && target >= dpositions[pos]!) {
            pos++
          }
        }

        const result = this.checkLineBytes(
          buffer,
          blockStart,
          n,
          regionRefNameBytes,
          start,
          end,
          columnNumbersEffective.ref,
          columnNumbersEffective.start,
          columnNumbersEffective.end,
          maxColumn,
          metaCharCode,
          coordinateOffset,
          isVCF,
        )

        if (result === null) {
          return
        }
        if (result !== undefined) {
          const line = decoder.decode(buffer.subarray(blockStart, n))
          callback(
            line,
            this.calculateFileOffset(
              cpositions,
              dpositions,
              pos,
              blockStart,
              c.minv.dataPosition,
            ),
            result.start,
            result.end,
          )
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
   * in the file.
   */
  async getReferenceSequenceNames(opts: Options = {}) {
    const metadata = await this.getMetadata(opts)
    return metadata.refIdToName
  }

  checkLineBytes(
    buffer: Uint8Array,
    lineStart: number,
    lineEnd: number,
    regionRefNameBytes: Uint8Array,
    regionStart: number,
    regionEnd: number,
    refColumn: number,
    startColumn: number,
    endColumn: number,
    maxColumn: number,
    metaCharCode: number | undefined,
    coordinateOffset: number,
    isVCF: boolean,
  ): { start: number; end: number } | null | undefined {
    if (metaCharCode !== undefined && buffer[lineStart] === metaCharCode) {
      return
    }

    // Find tab positions using indexOf (V8 optimizes this)
    let prev = lineStart - 1
    const tabs = [lineStart - 1]
    for (let i = 0; i < maxColumn; i++) {
      const pos = buffer.indexOf(TAB, prev + 1)
      if (pos === -1 || pos >= lineEnd) {
        tabs.push(lineEnd)
        break
      }
      tabs.push(pos)
      prev = pos
    }

    // Compare ref bytes directly
    const refStart = tabs[refColumn - 1]! + 1
    const refEnd = tabs[refColumn]!
    const refLen = refEnd - refStart
    if (refLen !== regionRefNameBytes.length) {
      return
    }
    for (let i = 0; i < refLen; i++) {
      if (buffer[refStart + i] !== regionRefNameBytes[i]) {
        return
      }
    }

    // Parse start coordinate from bytes
    let startCoordinate = 0
    for (let i = tabs[startColumn - 1]! + 1; i < tabs[startColumn]!; i++) {
      const c = buffer[i]!
      if (c >= 48 && c <= 57) {
        startCoordinate = startCoordinate * 10 + (c - 48)
      }
    }
    startCoordinate += coordinateOffset

    if (startCoordinate >= regionEnd) {
      return null
    }

    // Parse end coordinate
    let endCoordinate: number
    if (endColumn === 0 || endColumn === startColumn) {
      endCoordinate = startCoordinate + 1
    } else if (isVCF) {
      endCoordinate = this._getVcfEndBytes(
        buffer,
        startCoordinate,
        tabs[3]! + 1,
        tabs[4]!,
        tabs[endColumn - 1]! + 1,
        tabs[endColumn]!,
      )
    } else {
      endCoordinate = 0
      for (let i = tabs[endColumn - 1]! + 1; i < tabs[endColumn]!; i++) {
        const c = buffer[i]!
        if (c >= 48 && c <= 57) {
          endCoordinate = endCoordinate * 10 + (c - 48)
        }
      }
    }

    if (endCoordinate <= regionStart) {
      return
    }

    return { start: startCoordinate, end: endCoordinate }
  }

  _getVcfEndBytes(
    buffer: Uint8Array,
    startCoordinate: number,
    refStart: number,
    refEnd: number,
    infoStart: number,
    infoEnd: number,
  ) {
    const refLen = refEnd - refStart
    let endCoordinate = startCoordinate + refLen

    // Check for SVTYPE=TRA - look for 'S' (83) then verify
    const S = 83
    let pos = infoStart
    while (pos <= infoEnd - 10) {
      const idx = buffer.indexOf(S, pos)
      if (idx === -1 || idx > infoEnd - 10) {
        break
      }
      if (
        buffer[idx + 1] === 86 && // V
        buffer[idx + 2] === 84 && // T
        buffer[idx + 3] === 89 && // Y
        buffer[idx + 4] === 80 && // P
        buffer[idx + 5] === 69 && // E
        buffer[idx + 6] === 61 && // =
        buffer[idx + 7] === 84 && // T
        buffer[idx + 8] === 82 && // R
        buffer[idx + 9] === 65 // A
      ) {
        return startCoordinate + 1
      }
      pos = idx + 1
    }

    // Check for END=
    if (buffer[infoStart] !== 46) {
      // not '.'
      const E = 69
      const SEMICOLON = 59
      pos = infoStart
      while (pos <= infoEnd - 4) {
        const idx = buffer.indexOf(E, pos)
        if (idx === -1 || idx > infoEnd - 4) {
          break
        }
        if (
          (idx === infoStart || buffer[idx - 1] === SEMICOLON) &&
          buffer[idx + 1] === 78 && // N
          buffer[idx + 2] === 68 && // D
          buffer[idx + 3] === 61 // =
        ) {
          endCoordinate = 0
          for (let k = idx + 4; k < infoEnd; k++) {
            const c = buffer[k]!
            if (c >= 48 && c <= 57) {
              endCoordinate = endCoordinate * 10 + (c - 48)
            } else if (c === SEMICOLON) {
              break
            }
          }
          break
        }
        pos = idx + 1
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
