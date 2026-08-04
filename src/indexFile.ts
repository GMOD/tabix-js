import { unzip } from '@gmod/bgzf-filehandle'

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
  private parseP?: Promise<IndexData>

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
