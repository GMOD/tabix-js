import AbortablePromiseCache from 'abortable-promise-cache'
import QuickLRU from 'quick-lru'
import { GenericFilehandle } from 'generic-filehandle'
import VirtualOffset from './virtualOffset'
import Chunk from './chunk'

export interface Options {
  // support having some unknown parts of the options
  [key: string]: unknown
  signal?: AbortSignal
}

export default abstract class IndexFile {
  public filehandle: GenericFilehandle
  public renameRefSeq: (arg0: string) => string
  private _parseCache: any

  /**
   * @param {filehandle} filehandle
   * @param {function} [renameRefSeqs]
   */
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

  protected abstract _parse(opts: Options): Promise<{
    refNameToId: { [key: string]: number }
    refIdToName: string[]
  }>

  public async getMetadata(opts: Options = {}) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { indices, ...rest } = await this.parse(opts)
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
    if (!this._parseCache) {
      this._parseCache = new AbortablePromiseCache({
        cache: new QuickLRU({ maxSize: 1 }),
        fill: () => this._parse(opts),
      })
    }
    return this._parseCache.get('index', null, undefined)
  }

  async hasRefSeq(seqId: number, opts: Options = {}) {
    return !!((await this.parse(opts)).indices[seqId] || {}).binIndex
  }
}
