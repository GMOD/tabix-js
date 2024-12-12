import { GenericFilehandle } from 'generic-filehandle2'
import VirtualOffset from './virtualOffset'
import Chunk from './chunk'

export interface Options {
  // support having some unknown parts of the options
  [key: string]: unknown
  signal?: AbortSignal
}

export interface IndexData {
  refNameToId: Record<string, number>
  refIdToName: string[]
  metaChar: string | null
  columnNumbers: { ref: number; start: number; end: number }
  coordinateType: string
  format: string
  [key: string]: any
}

export default abstract class IndexFile {
  public filehandle: GenericFilehandle
  public renameRefSeq: (arg0: string) => string
  private parseP?: Promise<IndexData>

  constructor({
    filehandle,
    renameRefSeqs = (n: string) => n,
  }: {
    filehandle: GenericFilehandle
    renameRefSeqs?: (a: string) => string
  }) {
    this.filehandle = filehandle
    this.renameRefSeq = renameRefSeqs
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
    if (currentFdl) {
      return currentFdl.compareTo(virtualOffset) > 0
        ? virtualOffset
        : currentFdl
    } else {
      return virtualOffset
    }
  }

  async parse(opts: Options = {}) {
    if (!this.parseP) {
      this.parseP = this._parse(opts).catch((e: unknown) => {
        this.parseP = undefined
        throw e
      })
    }
    return this.parseP
  }

  async hasRefSeq(seqId: number, opts: Options = {}) {
    const idx = await this.parse(opts)
    return !!idx.indices[seqId]?.binIndex
  }
}
