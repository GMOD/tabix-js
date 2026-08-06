import { unzip } from '@gmod/bgzf-filehandle'
import { SharedReadCache } from '@gmod/shared-read-cache'

import { optimizeChunks } from './util.ts'

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
  /**
   * The parsed index, as a shared read — see {@link parse}. One entry, never
   * evicted, which is what a memo is.
   */
  private parseCache = new SharedReadCache<string, IndexData>({})

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

  // SYNC: ~/src/gmod/bam-js/src/indexFile.ts parse — same shape and the same
  // reasoning below.
  /**
   * Parse the index, or join the parse already running.
   *
   * The index is downloaded and parsed once for the life of this object, so it
   * is the one read here that is shared between queries — and therefore the one
   * place a cancellation can leak from the query that asked for it to a query
   * that did not. `_parse` hands `opts` straight to `readIndexBytes`, so a bare
   * memoized promise makes the first query to arrive the owner of a read every
   * other query depends on: when it pans away, every concurrent query fails
   * with its abort.
   *
   * The same cache `ChunkCache` uses, for the same reason and with the same
   * rule: the parse runs under a signal of its own and is cancelled only once
   * every caller waiting on it has given up, so one query's abort is reported
   * to that query alone and a bystander gets the parse already in flight rather
   * than having to re-read the index. A rejection is dropped rather than
   * cached, so a transient failure does not poison the index for the life of
   * the file.
   *
   * The fill is per call rather than on the cache so that the caller who starts
   * the parse has its `onProgress` reach `readIndexBytes` — the index is a
   * whole-file read, and a determinate "downloading index" bar is what that
   * callback exists for.
   *
   * @internal
   */
  parse(opts: Options = {}): Promise<IndexData> {
    return this.parseCache.get('index', opts.signal, signal =>
      this._parse({ ...opts, signal }),
    )
  }

  /** @internal */
  async hasRefSeq(seqId: number, opts: Options = {}) {
    const idx = await this.parse(opts)
    return !!idx.indices(seqId)?.binIndex
  }
}
