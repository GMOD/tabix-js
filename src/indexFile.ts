import type Chunk from './chunk.ts'
import type VirtualOffset from './virtualOffset.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

export interface Options {
  signal?: AbortSignal
}

export interface RefIndex {
  binIndex: Record<number, Chunk[]>
  stats?: { lineCount: number }
  linearIndex?: VirtualOffset[]
}

export interface IndexData {
  refNameToId: Record<string, number>
  refIdToName: string[]
  metaChar: string | undefined
  columnNumbers: { ref: number; start: number; end: number }
  coordinateType: string
  format: string
  indices: (refId: number) => RefIndex | undefined
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

  protected abstract _parse(opts: Options): Promise<IndexData>

  /** @internal */
  public async lineCount(refName: string, opts: Options = {}) {
    const indexData = await this.parse(opts)
    const refId = indexData.refNameToId[refName]
    if (refId === undefined) {
      return -1
    }
    return indexData.indices(refId)?.stats?.lineCount ?? -1
  }

  /** @internal */
  public async getMetadata(opts: Options = {}) {
    const { indices: _indices, ...rest } = await this.parse(opts)
    return rest
  }

  /** @internal */
  public abstract blocksForRange(
    refName: string,
    start: number,
    end: number,
    opts: Options,
  ): Promise<Chunk[]>

  /** @internal */
  async parse(opts: Options = {}) {
    this.parseP ??= this._parse(opts).catch((error: unknown) => {
      this.parseP = undefined
      throw error
    })
    return this.parseP
  }

  /** @internal */
  async hasRefSeq(seqId: number, opts: Options = {}) {
    const idx = await this.parse(opts)
    return !!idx.indices(seqId)?.binIndex
  }
}
