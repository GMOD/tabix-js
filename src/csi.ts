import { unzip } from '@gmod/bgzf-filehandle'

import Chunk from './chunk.ts'
import IndexFile from './indexFile.ts'
import {
  findFirstData,
  memoizeByRefId,
  optimizeChunks,
  parseAuxData,
  parsePseudoBin,
} from './util.ts'
import { fromBytes } from './virtualOffset.ts'

import type { Options, RefIndex } from './indexFile.ts'
import type VirtualOffset from './virtualOffset.ts'
import type { GenericFilehandle } from 'generic-filehandle2'

const CSI1_MAGIC = 21_582_659 // CSI\1
const CSI2_MAGIC = 38_359_875 // CSI\2

// CSI coordinates can exceed 2^31, so bitwise << / >> (which truncate to int32)
// are unsafe here; use multiplication/division instead.
function lshift(num: number, bits: number) {
  return num * 2 ** bits
}
function rshift(num: number, bits: number) {
  return Math.floor(num / 2 ** bits)
}

export default class CSI extends IndexFile {
  private maxBinNumber: number
  private depth: number
  private minShift: number
  constructor(args: { filehandle: GenericFilehandle }) {
    super(args)
    this.maxBinNumber = 0
    this.depth = 0
    this.minShift = 0
  }
  /** @internal */
  indexCov() {
    throw new Error('CSI indexes do not support indexcov')
  }

  /** @internal */
  async _parse(opts: Options = {}) {
    const buf = await this.filehandle.readFile({ signal: opts.signal })
    const bytes = (await unzip(buf)) as Uint8Array
    const dataView = new DataView(bytes.buffer)

    const magic = dataView.getUint32(0, true)
    let csiVersion
    if (magic === CSI1_MAGIC) {
      csiVersion = 1
    } else if (magic === CSI2_MAGIC) {
      csiVersion = 2
    } else {
      throw new Error(`Not a CSI file (magic=${magic})`)
    }

    this.minShift = dataView.getInt32(4, true)
    this.depth = dataView.getInt32(8, true)
    this.maxBinNumber = ((1 << ((this.depth + 1) * 3)) - 1) / 7
    const maxBinNumber = this.maxBinNumber
    const maxRefLength = 2 ** (this.minShift + this.depth * 3)
    const auxLength = dataView.getInt32(12, true)
    const aux =
      auxLength >= 30
        ? parseAuxData(bytes, 16)
        : {
            refIdToName: [] as string[],
            refNameToId: {} as Record<string, number>,
            metaChar: undefined,
            columnNumbers: { ref: 0, start: 1, end: 2 },
            coordinateType: 'zero-based-half-open',
            format: 'generic',
          }
    const refCount = dataView.getInt32(16 + auxLength, true)

    // SYNC: ~/src/gmod/bam-js/src/csi.ts _parse — two-pass structure
    // First pass: record per-refId byte offsets and find firstDataLine via loffsets
    let curr = 16 + auxLength + 4
    let firstDataLine: VirtualOffset | undefined
    const offsets: number[] = []

    for (let i = 0; i < refCount; i++) {
      offsets.push(curr)
      const binCount = dataView.getInt32(curr, true)
      curr += 4
      for (let j = 0; j < binCount; j++) {
        const bin = dataView.getUint32(curr, true)
        curr += 4
        if (bin > maxBinNumber) {
          curr += 28 + 16 // skip pseudo-bin (loffset + nchunk + 2 chunks)
        } else {
          firstDataLine = findFirstData(firstDataLine, fromBytes(bytes, curr))
          curr += 8 // loffset
          const chunkCount = dataView.getInt32(curr, true)
          curr += 4 + 16 * chunkCount
        }
      }
    }

    function getIndices(refId: number): RefIndex | undefined {
      const start = offsets[refId]
      if (start === undefined) {
        return undefined
      }
      let pos = start
      const binCount = dataView.getInt32(pos, true)
      pos += 4
      const binIndex: Record<number, Chunk[]> = {}
      let stats
      for (let j = 0; j < binCount; j++) {
        const bin = dataView.getUint32(pos, true)
        pos += 4
        if (bin > maxBinNumber) {
          stats = parsePseudoBin(bytes, pos + 28)
          pos += 28 + 16
        } else {
          pos += 8 // skip loffset (tracked in first pass)
          const chunkCount = dataView.getInt32(pos, true)
          pos += 4
          const chunks = Array.from<Chunk>({ length: chunkCount })
          for (let k = 0; k < chunkCount; k++) {
            chunks[k] = new Chunk(
              fromBytes(bytes, pos),
              fromBytes(bytes, pos + 8),
              bin,
            )
            pos += 16
          }
          binIndex[bin] = chunks
        }
      }
      return { binIndex, stats }
    }

    return {
      ...aux,
      csi: true,
      refCount,
      maxBlockSize: 1 << 16,
      firstDataLine,
      csiVersion,
      indices: memoizeByRefId(getIndices),
      depth: this.depth,
      maxBinNumber,
      maxRefLength,
    }
  }

  async blocksForRange(
    refName: string,
    min: number,
    max: number,
    opts: Options = {},
  ) {
    if (min < 0) {
      min = 0
    }

    const indexData = await this.parse(opts)
    const refId = indexData.refNameToId[refName]
    if (refId === undefined) {
      return []
    }
    const ba = indexData.indices(refId)
    if (!ba) {
      return []
    }

    // List of bin #s that overlap min, max
    const overlappingBins = this.reg2bins(min, max)
    const chunks: Chunk[] = []

    // Find chunks in overlapping bins.  Leaf bins (< 4681) are not pruned
    for (const [start, end] of overlappingBins) {
      for (let bin = start; bin <= end; bin++) {
        const binChunks = ba.binIndex[bin]
        if (binChunks) {
          for (const c of binChunks) {
            chunks.push(c)
          }
        }
      }
    }

    return optimizeChunks(chunks)
  }

  /** @internal */
  reg2bins(beg: number, end: number) {
    const maxPos = 2 ** (this.minShift + this.depth * 3)
    if (end > maxPos) {
      end = maxPos
    }
    end -= 1
    let l = 0
    let t = 0
    let s = this.minShift + this.depth * 3
    const bins = []
    for (; l <= this.depth; s -= 3, t += lshift(1, l * 3), l += 1) {
      const b = t + rshift(beg, s)
      const e = t + rshift(end, s)
      if (e - b + bins.length > this.maxBinNumber) {
        throw new Error(
          `query ${beg}-${end} is too large for current binning scheme (shift ${this.minShift}, depth ${this.depth}), try a smaller query or a coarser index binning scheme`,
        )
      }
      bins.push([b, e] as const)
    }
    return bins
  }
}
