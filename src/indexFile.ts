import AbortablePromiseCache from 'abortable-promise-cache'
import QuickLRU from 'quick-lru'
import { GenericFilehandle } from 'generic-filehandle'
import VirtualOffset from './virtualOffset'
import Chunk from './chunk'

export default abstract class IndexFile {
  public filehandle: GenericFilehandle
  public renameRefSeq: Function
  private _parseCache: any

  /**
   * @param {filehandle} filehandle
   * @param {function} [renameRefSeqs]
   */
  constructor({
    filehandle,
    renameRefSeq = (n: string) => n,
  }: {
    filehandle: GenericFilehandle
    renameRefSeq?: (a: string) => string
  }) {
    this.filehandle = filehandle
    this.renameRefSeq = renameRefSeq
  }
  public abstract async lineCount(refName: string, args: { signal?: AbortSignal }): Promise<number>
  protected abstract async _parse(opts: {
    signal?: AbortSignal
  }): Promise<{
    refNameToId: { [key: string]: number }
    refIdToName: string[]
  }>

  public async getMetadata(opts: { signal?: AbortSignal } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { indices, ...rest } = await this.parse(opts)
    return rest
  }

  public abstract async blocksForRange(
    refName: string,
    start: number,
    end: number,
    opts: { signal?: AbortSignal },
  ): Promise<Chunk[]>

  _findFirstData(currentFdl: VirtualOffset | undefined, virtualOffset: VirtualOffset) {
    if (currentFdl) {
      return currentFdl.compareTo(virtualOffset) > 0 ? virtualOffset : currentFdl
    } else {
      return virtualOffset
    }
  }

  async parse(opts: { signal?: AbortSignal } = {}) {
    if (!this._parseCache)
      this._parseCache = new AbortablePromiseCache({
        cache: new QuickLRU({ maxSize: 1 }),
        fill: () => this._parse(opts),
      })
    return this._parseCache.get('index', null, opts.signal)
  }

  /**
   * @param {number} seqId
   * @param {AbortSignal} [abortSignal]
   * @returns {Promise} true if the index contains entries for
   * the given reference sequence ID, false otherwise
   */
  async hasRefSeq(seqId: number, opts: { signal?: AbortSignal } = {}) {
    return !!((await this.parse(opts)).indices[seqId] || {}).binIndex
  }
}
