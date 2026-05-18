import type Chunk from './chunk.ts'
import type VirtualOffset from './virtualOffset.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

const FORMATS: Record<number, string> = {
  0: 'generic',
  1: 'SAM',
  2: 'VCF',
}

export interface Options {
  signal?: AbortSignal
}

export interface IndexData {
  refNameToId: Record<string, number>
  refIdToName: string[]
  metaChar: string | undefined
  columnNumbers: { ref: number; start: number; end: number }
  coordinateType: string
  format: string
  indices: {
    binIndex: Record<number | string, Chunk[]>
    stats?: { lineCount: number }
    linearIndex?: VirtualOffset[]
  }[]
  maxRefLength: number
  skipLines?: number
  maxBinNumber?: number
  maxBlockSize: number
  firstDataLine?: VirtualOffset
  refCount?: number
  csi?: boolean
  csiVersion?: number
  depth?: number
}

export default abstract class IndexFile {
  public filehandle: GenericFilehandle
  private parseP?: Promise<IndexData>

  constructor({ filehandle }: { filehandle: GenericFilehandle }) {
    this.filehandle = filehandle
  }

  public abstract lineCount(refName: string, args: Options): Promise<number>

  protected abstract _parse(opts: Options): Promise<IndexData>

  public async getMetadata(opts: Options = {}) {
    const { indices: _indices, ...rest } = await this.parse(opts)
    return rest
  }

  public abstract blocksForRange(
    refName: string,
    start: number,
    end: number,
    opts: Options,
  ): Promise<Chunk[]>

  _findFirstData(
    currentFdl: VirtualOffset | undefined,
    virtualOffset: VirtualOffset,
  ) {
    return !currentFdl || currentFdl.compareTo(virtualOffset) > 0
      ? virtualOffset
      : currentFdl
  }

  async parse(opts: Options = {}) {
    this.parseP ??= this._parse(opts).catch((error: unknown) => {
      this.parseP = undefined
      throw error
    })
    return this.parseP
  }

  async hasRefSeq(seqId: number, opts: Options = {}) {
    const idx = await this.parse(opts)
    return !!idx.indices[seqId]?.binIndex
  }

  // Parses the 28-byte tabix header block (format flags, column numbers,
  // metaChar, skipLines, nameSectionLength) plus the name section that follows.
  // `offset` points to the formatFlags int32. Layout is shared between TBI and
  // CSI aux data — see https://samtools.github.io/hts-specs/.
  _parseTabixHeader(bytes: Uint8Array, offset: number) {
    const dataView = new DataView(bytes.buffer)
    const formatFlags = dataView.getInt32(offset, true)
    const format = FORMATS[formatFlags & 0xf]
    if (!format) {
      throw new Error(`invalid Tabix preset format flags ${formatFlags}`)
    }
    const metaValue = dataView.getInt32(offset + 16, true)
    const nameSectionLength = dataView.getInt32(offset + 24, true)
    const namesEnd = offset + 28 + nameSectionLength
    return {
      header: {
        format,
        coordinateType:
          formatFlags & 0x1_00_00 ? 'zero-based-half-open' : '1-based-closed',
        columnNumbers: {
          ref: dataView.getInt32(offset + 4, true),
          start: dataView.getInt32(offset + 8, true),
          end: dataView.getInt32(offset + 12, true),
        },
        metaChar: metaValue ? String.fromCharCode(metaValue) : undefined,
        skipLines: dataView.getInt32(offset + 20, true),
        ...this._parseNameBytes(bytes.subarray(offset + 28, namesEnd)),
      },
      namesEnd,
    }
  }

  _parseNameBytes(namesBytes: Uint8Array) {
    let currRefId = 0
    let currNameStart = 0
    const refIdToName: string[] = []
    const refNameToId: Record<string, number> = {}
    const decoder = new TextDecoder('utf-8')
    for (let i = 0; i < namesBytes.length; i += 1) {
      if (!namesBytes[i]) {
        if (currNameStart < i) {
          const refName = decoder.decode(namesBytes.subarray(currNameStart, i))
          refIdToName[currRefId] = refName
          refNameToId[refName] = currRefId
        }
        currNameStart = i + 1
        currRefId += 1
      }
    }
    return {
      refNameToId,
      refIdToName,
    }
  }
}
