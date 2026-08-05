import { unzip } from '@gmod/bgzf-filehandle'

import { optimizeChunks, throwIfAborted } from './util.ts'

import type Chunk from './chunk.ts'
import type VirtualOffset from './virtualOffset.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

export interface Options {
  signal?: AbortSignal
  /**
   * Called as the index (.tbi/.csi) is downloaded, with cumulative downloaded
   * bytes and the total. The index is a whole-file read, so this streams real
   * byte progress. Lets callers show a determinate "downloading index" bar.
   */
  onProgress?: (bytesDownloaded: number, totalBytes?: number) => void
}

export interface RefIndex {
  binIndex: Record<number, Chunk[]>
  stats?: { lineCount: number }
  linearIndex?: VirtualOffset[]
  /** CSI only: per-bin loffset, the linear index's equivalent for pruning */
  loffsets?: Record<number, VirtualOffset>
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
  maxBlockSize: number
  firstDataLine?: VirtualOffset
  refCount?: number
  csi?: boolean
  csiVersion?: number
  /**
   * The binning scheme. TBI reports these too, though its own are fixed by the
   * format (minShift 14, depth 5) rather than read from the file: they are the
   * same scheme, and CSI exists to let a file choose other values for them.
   */
  minShift: number
  depth: number
  maxBinNumber: number
}

export default abstract class IndexFile {
  public filehandle: GenericFilehandle
  private parseP?: Promise<IndexData>
  /**
   * The signal `parseP` was started under, while it is still in flight. The
   * index is parsed once and shared by every query against the file, so without
   * this the first query to arrive would own a read all the others depend on —
   * see {@link parse}.
   */
  private parseSignal?: AbortSignal

  constructor({ filehandle }: { filehandle: GenericFilehandle }) {
    this.filehandle = filehandle
  }

  protected abstract _parse(opts: Options): Promise<IndexData>

  /**
   * The bins that may overlap [beg, end), as one inclusive [first, last] range
   * per level of the binning scheme.
   */
  protected abstract reg2bins(
    beg: number,
    end: number,
    indexData: IndexData,
  ): (readonly [number, number])[]

  /**
   * The earliest virtual offset any record overlapping `beg` can have, so that
   * chunks ending at or before it can be dropped. TBI reads it off the linear
   * index; CSI, which has none, off the bins' loffsets.
   */
  protected abstract lowestOffset(
    ref: RefIndex,
    beg: number,
    indexData: IndexData,
  ): VirtualOffset | undefined

  /**
   * The whole index file, decompressed, with a DataView over it. Both .tbi and
   * .csi are bgzf-compressed and read whole, so both parsers start here.
   */
  protected async readIndexBytes(opts: Options) {
    const buf = await this.filehandle.readFile({
      signal: opts.signal,
      onProgress: opts.onProgress,
    })
    const bytes = await unzip(buf)
    return {
      bytes,
      dataView: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    }
  }

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

  /**
   * The chunks of the data file that may hold records overlapping the region.
   * The two index formats differ only in their binning scheme and in where
   * they keep the pruning floor, which is what the two hooks above supply.
   *
   * @internal
   */
  public async blocksForRange(
    refName: string,
    min: number,
    max: number,
    opts: Options = {},
  ) {
    const indexData = await this.parse(opts)
    const refId = indexData.refNameToId[refName]
    if (refId === undefined) {
      return []
    }
    const ba = indexData.indices(refId)
    if (!ba) {
      return []
    }

    // Find chunks in overlapping bins. Leaf bins are not pruned.
    const chunks: Chunk[] = []
    for (const [start, end] of this.reg2bins(min, max, indexData)) {
      for (let bin = start; bin <= end; bin++) {
        const binChunks = ba.binIndex[bin]
        if (binChunks) {
          for (const c of binChunks) {
            chunks.push(c)
          }
        }
      }
    }

    return optimizeChunks(chunks, this.lowestOffset(ba, min, indexData))
  }

  /**
   * Parse the index, or join the parse already running.
   *
   * The index is downloaded and parsed once for the life of this object, so it
   * is the one read here that is shared between queries — and therefore the one
   * place a cancellation can leak from the query that asked for it to a query
   * that did not. `_parse` hands `opts` straight to `readIndexBytes`, so
   * without this the first query to arrive owns a read every other query
   * depends on: when it pans away, every concurrent query fails with its abort.
   *
   * A caller that joined someone else's parse and saw it fail because *they*
   * aborted starts over rather than inheriting the failure — once, then
   * propagates. Bounding it at one attempt is what jbrowse's
   * `RemoteFileWithRangeCache.joinChunk` does with the same retry one layer
   * down, and for the reason it gives: the pathological case becomes one
   * duplicate parse rather than a recursion whose depth depends on how the
   * aborts interleave.
   *
   * A retry rather than the reference count `chunkCache` gets from
   * `@gmod/abortable-promise-cache`, because the index is parsed once for the
   * life of the object: there is no repeated waste to recover, and this is a
   * dozen lines against restructuring the memo. `@gmod/bam`'s `IndexFile` and
   * `@gmod/cram`'s `CraiIndex` make the same split for the same reason.
   *
   * @internal
   */
  async parse(opts: Options = {}, retried = false): Promise<IndexData> {
    throwIfAborted(opts.signal)
    const pending = this.parseP
    if (!pending) {
      return this.startParse(opts)
    }

    // read before awaiting: the owner is forgotten as soon as the parse settles
    const ownerSignal = this.parseSignal
    try {
      return await pending
    } catch (e) {
      if (retried || !ownerSignal?.aborted || opts.signal?.aborted) {
        throw e
      }
      return this.parse(opts, true)
    }
  }

  private startParse(opts: Options) {
    const pending = this._parse(opts)
    this.parseP = pending
    this.parseSignal = opts.signal
    // Drop a rejection rather than keeping it, so one transient failure does not
    // poison the index for the lifetime of the file. Identity-checked so a retry
    // started after this settles is not cleared by the attempt it replaced.
    //
    // Written as one try/catch rather than `.then(onFulfilled, onRejected)`
    // because `unicorn/prefer-then-catch` rewrites the two-argument form to
    // `.then(...).catch(...)`, which is not the same thing — that catch would
    // also swallow anything the fulfilment handler threw.
    void (async () => {
      let failed = false
      try {
        await pending
      } catch {
        failed = true
      }
      if (this.parseP === pending) {
        if (failed) {
          this.parseP = undefined
        }
        this.parseSignal = undefined
      }
    })()
    return pending
  }

  /** @internal */
  async hasRefSeq(seqId: number, opts: Options = {}) {
    const idx = await this.parse(opts)
    return !!idx.indices(seqId)?.binIndex
  }
}
