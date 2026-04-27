import AbortablePromiseCache from '@gmod/abortable-promise-cache'
import { unzip, unzipChunkSlice } from '@gmod/bgzf-filehandle'
import LRU from '@jbrowse/quick-lru'
import { LocalFile, RemoteFile } from 'generic-filehandle2'

import CSI from './csi.ts'
import TBI from './tbi.ts'

import type Chunk from './chunk.ts'
import type IndexFile from './indexFile.ts'
import type { Options } from './indexFile.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

const TAB = 9
const NEWLINE = 10
const SEMICOLON = 59

const decoder = new TextDecoder('utf-8')
const encoder = new TextEncoder()

type GetLinesCallback = (
  line: string,
  fileOffset: number,
  start: number,
  end: number,
) => void

interface GetLinesOpts {
  signal?: AbortSignal
  lineCallback: GetLinesCallback
}

interface ReadChunk {
  buffer: Uint8Array
  cpositions: number[]
  dpositions: number[]
}

function resolveFilehandle(
  filehandle?: GenericFilehandle,
  path?: string,
  url?: string,
) {
  if (filehandle) {
    return filehandle
  }
  if (path) {
    return new LocalFile(path)
  }
  if (url) {
    return new RemoteFile(url)
  }
  throw new TypeError('must provide either filehandle, path, or url')
}

function calculateFileOffset(
  cpositions: number[],
  dpositions: number[],
  pos: number,
  blockStart: number,
  minvDataPosition: number,
) {
  return (
    cpositions[pos] * (1 << 8) +
    (blockStart - dpositions[pos]) +
    minvDataPosition +
    1
  )
}

function getVcfEnd(
  buffer: Uint8Array,
  startCoordinate: number,
  refStart: number,
  refEnd: number,
  infoStart: number,
  infoEnd: number,
) {
  const refLen = refEnd - refStart
  let endCoordinate = startCoordinate + refLen

  // INFO is '.', no fields to check
  if (buffer[infoStart] === 46) {
    return endCoordinate
  }

  // Single pass over semicolon-delimited fields checking prefixes.
  // Avoids repeated indexOf scans for common bytes like 'S' and 'E'
  // that produce many false positives in typical INFO fields.
  let fieldStart = infoStart
  for (let i = infoStart; i <= infoEnd; i++) {
    if (i === infoEnd || buffer[i] === SEMICOLON) {
      const fieldLen = i - fieldStart
      if (
        fieldLen >= 10 &&
        buffer[fieldStart] === 83 && // S
        buffer[fieldStart + 1] === 86 && // V
        buffer[fieldStart + 2] === 84 && // T
        buffer[fieldStart + 3] === 89 && // Y
        buffer[fieldStart + 4] === 80 && // P
        buffer[fieldStart + 5] === 69 && // E
        buffer[fieldStart + 6] === 61 && // =
        buffer[fieldStart + 7] === 84 && // T
        buffer[fieldStart + 8] === 82 && // R
        buffer[fieldStart + 9] === 65 // A
      ) {
        return startCoordinate + 1
      }
      if (
        fieldLen >= 4 &&
        buffer[fieldStart] === 69 && // E
        buffer[fieldStart + 1] === 78 && // N
        buffer[fieldStart + 2] === 68 && // D
        buffer[fieldStart + 3] === 61 // =
      ) {
        endCoordinate = 0
        for (let k = fieldStart + 4; k < i; k++) {
          const c = buffer[k]
          if (c >= 48 && c <= 57) {
            endCoordinate = endCoordinate * 10 + (c - 48)
          } else {
            break
          }
        }
      }
      fieldStart = i + 1
    }
  }
  return endCoordinate
}

function parseIntFromBytes(buffer: Uint8Array, start: number, end: number) {
  let val = 0
  for (let i = start; i < end; i++) {
    const c = buffer[i]
    if (c >= 48 && c <= 57) {
      val = val * 10 + (c - 48)
    }
  }
  return val
}

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
   * @param {object} [args.filehandle]
   * @param {string} [args.url]
   * @param {string} [args.tbiPath]
   * @param {string} [args.tbiUrl]
   * @param {object} [args.tbiFilehandle]
   * @param {string} [args.csiPath]
   * @param {string} [args.csiUrl]
   * @param {object} [args.csiFilehandle]
   * @param {number} [args.chunkCacheSize]
   * @param {number} [args.yieldTime] yield to main thread after N milliseconds if reading features is taking a long time to avoid hanging main thread
   * @param {Function} [args.renameRefSeqs] optional function with sig `string => string` to transform reference sequence names for the purpose of indexing and querying. note that the data that is returned is not altered, just the names of the reference sequences that are used for querying.
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
    this.filehandle = resolveFilehandle(filehandle, path, url)

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
   * @param {string} refName name of the reference sequence
   * @param {number|undefined} start start of the region (0-based half-open)
   * @param {number|undefined} end end of the region (0-based half-open)
   * @param {GetLinesOpts|GetLinesCallback} opts callback invoked for each line, or an options object with `lineCallback` and optional `signal`
   * @returns {Promise} promise that is resolved when the whole read is finished, rejected on error
   */
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

    const isVCF = metadata.format === 'VCF'
    const refCol = metadata.columnNumbers.ref || 0
    const startCol = metadata.columnNumbers.start || 0
    const endCol = isVCF ? 8 : metadata.columnNumbers.end || 0
    const maxColumn = Math.max(refCol, startCol, endCol)
    const metaCharCode = metadata.metaChar?.charCodeAt(0)
    const coordinateOffset =
      metadata.coordinateType === '1-based-closed' ? -1 : 0

    const regionRefNameBytes = encoder.encode(refName)
    const tabs = Array.from<number>({ length: maxColumn + 1 })

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
          while (pos < dpositions.length && target >= dpositions[pos]) {
            pos++
          }
        }

        // skip meta lines
        if (metaCharCode !== undefined && buffer[blockStart] === metaCharCode) {
          blockStart = n + 1
          continue
        }

        // find tab positions
        tabs[0] = blockStart - 1
        let prev = blockStart - 1
        for (let i = 0; i < maxColumn; i++) {
          const tabPos = buffer.indexOf(TAB, prev + 1)
          if (tabPos === -1 || tabPos >= n) {
            tabs[i + 1] = n
            break
          }
          tabs[i + 1] = tabPos
          prev = tabPos
        }

        // compare ref name bytes directly
        const refStart = tabs[refCol - 1] + 1
        const refEnd = tabs[refCol]
        const refLen = refEnd - refStart
        if (refLen !== regionRefNameBytes.length) {
          blockStart = n + 1
          continue
        }
        let refMatch = true
        for (let i = 0; i < refLen; i++) {
          if (buffer[refStart + i] !== regionRefNameBytes[i]) {
            refMatch = false
            break
          }
        }
        if (!refMatch) {
          blockStart = n + 1
          continue
        }

        // parse start coordinate
        const startCoordinate =
          parseIntFromBytes(buffer, tabs[startCol - 1] + 1, tabs[startCol]) +
          coordinateOffset

        if (startCoordinate >= end) {
          return
        }

        // parse end coordinate
        let endCoordinate: number
        if (endCol === 0 || endCol === startCol) {
          endCoordinate = startCoordinate + 1
        } else if (isVCF) {
          endCoordinate = getVcfEnd(
            buffer,
            startCoordinate,
            tabs[3] + 1,
            tabs[4],
            tabs[endCol - 1] + 1,
            tabs[endCol],
          )
        } else {
          endCoordinate = parseIntFromBytes(
            buffer,
            tabs[endCol - 1] + 1,
            tabs[endCol],
          )
        }

        if (endCoordinate > start) {
          const line = decoder.decode(buffer.subarray(blockStart, n))
          callback(
            line,
            calculateFileOffset(
              cpositions,
              dpositions,
              pos,
              blockStart,
              c.minv.dataPosition,
            ),
            startCoordinate,
            endCoordinate,
          )
        }
        blockStart = n + 1
      }
    }
  }

  async getMetadata(opts: Options = {}) {
    return this.index.getMetadata(opts)
  }

  async getHeaderBuffer(opts: Options = {}) {
    const { firstDataLine, metaChar, maxBlockSize } =
      await this.getMetadata(opts)

    const maxFetch = (firstDataLine?.blockPosition ?? 0) + maxBlockSize
    // TODO: what if we don't have a firstDataLine, and the header actually
    // takes up more than one block? this case is not covered here

    const buf = await this.filehandle.read(maxFetch, 0, opts)
    const bytes = (await unzip(buf)) as Uint8Array

    // trim off lines after the last meta line
    if (metaChar) {
      let lastNewline = -1
      const metaByte = metaChar.charCodeAt(0)

      for (let i = 0, l = bytes.length; i < l; i++) {
        const byte = bytes[i]
        if (i === lastNewline + 1 && byte !== metaByte) {
          break
        }
        if (byte === NEWLINE) {
          lastNewline = i
        }
      }
      return bytes.subarray(0, lastNewline + 1)
    }
    return bytes
  }

  async getHeader(opts: Options = {}) {
    const bytes = await this.getHeaderBuffer(opts)
    return decoder.decode(bytes)
  }

  async getReferenceSequenceNames(opts: Options = {}) {
    const metadata = await this.getMetadata(opts)
    return metadata.refIdToName
  }

  /**
   * return the number of data lines in the given reference sequence
   * @param {string} refName reference sequence name
   * @returns {number} number of data lines present on that reference sequence
   */
  async lineCount(refName: string, opts: Options = {}) {
    return this.index.lineCount(refName, opts)
  }

  async readChunk(c: Chunk, opts: Options = {}) {
    const ret = await this.filehandle.read(
      c.fetchedSize(),
      c.minv.blockPosition,
      opts,
    )
    return unzipChunkSlice(ret, c, this.cache)
  }
}
