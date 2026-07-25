import { unzip } from '@gmod/bgzf-filehandle'

import Chunk from './chunk.ts'
import IndexFile from './indexFile.ts'
import {
  clampChunkEnds,
  findFirstData,
  memoizeByRefId,
  optimizeChunks,
  parseAuxData,
  parsePseudoBin,
} from './util.ts'
import { fromBytes } from './virtualOffset.ts'

import type { Options, RefIndex } from './indexFile.ts'
import type VirtualOffset from './virtualOffset.ts'

const TBI_MAGIC = 21_578_324 // TBI\1

// TBI is always the fixed depth-5, 14-bit-leaf binning scheme
const TBI_DEPTH = 5
const TBI_MAX_REF_LENGTH = 2 ** (14 + TBI_DEPTH * 3)

/**
 * calculate the list of bins that may overlap with region [beg,end)
 * (zero-based half-open)
 */
function reg2bins(beg: number, end: number) {
  // Clamp into the binning scheme's range. Past 2**31 the shifts below
  // truncate to int32 and go negative, which would silently yield no bins.
  const b = Math.min(Math.max(beg, 0), TBI_MAX_REF_LENGTH)
  const e = Math.min(end, TBI_MAX_REF_LENGTH) - 1
  const bins: (readonly [number, number])[] = []
  if (b <= e) {
    bins.push(
      [0, 0],
      [1 + (b >> 26), 1 + (e >> 26)],
      [9 + (b >> 23), 9 + (e >> 23)],
      [73 + (b >> 20), 73 + (e >> 20)],
      [585 + (b >> 17), 585 + (e >> 17)],
      [4681 + (b >> 14), 4681 + (e >> 14)],
    )
  }
  return bins
}

export default class TabixIndex extends IndexFile {
  /** @internal */
  async _parse(opts: Options = {}) {
    const buf = await this.filehandle.readFile({
      signal: opts.signal,
      onProgress: opts.onProgress,
    })
    const bytes = (await unzip(buf)) as Uint8Array
    const dataView = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    )

    if (dataView.getUint32(0, true) !== TBI_MAGIC) {
      throw new Error('Not a TBI file')
    }

    const refCount = dataView.getUint32(4, true)
    const maxBinNumber = ((1 << ((TBI_DEPTH + 1) * 3)) - 1) / 7

    // TBI header layout matches CSI aux data; parseAuxData handles both
    const {
      refNameToId,
      refIdToName,
      coordinateType,
      format,
      columnNumbers,
      metaChar,
      skipLines,
    } = parseAuxData(bytes, 8)
    // nameSectionLength is at TBI offset 32; re-read to find where bin data starts
    const nameSectionLength = dataView.getInt32(32, true)

    // SYNC: ~/src/gmod/bam-js/src/csi.ts _parse — two-pass structure
    // First pass: record per-refId byte offsets and find firstDataLine
    let curr = 36 + nameSectionLength
    let firstDataLine: VirtualOffset | undefined
    const offsets: number[] = []

    for (let i = 0; i < refCount; i++) {
      offsets.push(curr)
      const binCount = dataView.getInt32(curr, true)
      curr += 4
      for (let j = 0; j < binCount; j++) {
        const bin = dataView.getUint32(curr, true)
        curr += 4
        const chunkCount = dataView.getInt32(curr, true)
        curr += 4
        if (bin > maxBinNumber + 1) {
          throw new Error(
            'tabix index contains too many bins, please use a CSI index',
          )
        } else if (bin === maxBinNumber + 1) {
          curr += 16 * chunkCount
        } else {
          for (let k = 0; k < chunkCount; k++) {
            firstDataLine = findFirstData(firstDataLine, fromBytes(bytes, curr))
            curr += 16
          }
        }
      }
      const linearCount = dataView.getInt32(curr, true)
      curr += 4
      for (let k = 0; k < linearCount; k++) {
        firstDataLine = findFirstData(firstDataLine, fromBytes(bytes, curr))
        curr += 8
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
        if (bin > maxBinNumber + 1) {
          throw new Error(
            'tabix index contains too many bins, please use a CSI index',
          )
        } else if (bin === maxBinNumber + 1) {
          const chunkCount = dataView.getInt32(pos, true)
          pos += 4
          if (chunkCount === 2) {
            stats = parsePseudoBin(bytes, pos + 16)
          }
          pos += 16 * chunkCount
        } else {
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
      const linearCount = dataView.getInt32(pos, true)
      pos += 4
      const linearIndex = Array.from<VirtualOffset>({ length: linearCount })
      for (let k = 0; k < linearCount; k++) {
        linearIndex[k] = fromBytes(bytes, pos)
        pos += 8
      }
      clampChunkEnds(
        Object.values(binIndex).flat(),
        linearIndex.map(v => v.blockPosition),
      )
      return { binIndex, linearIndex, stats }
    }

    return {
      indices: memoizeByRefId(getIndices),
      metaChar,
      maxBinNumber,
      maxRefLength: TBI_MAX_REF_LENGTH,
      skipLines,
      firstDataLine,
      columnNumbers,
      coordinateType,
      format,
      refIdToName,
      refNameToId,
      maxBlockSize: 1 << 16,
    }
  }

  async blocksForRange(
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

    if (min > TBI_MAX_REF_LENGTH) {
      console.warn('querying outside of possible tabix range')
    }
    // clamp before the >> 14 below, which would truncate to int32 and go
    // negative past 2**31
    const beg = Math.min(Math.max(min, 0), TBI_MAX_REF_LENGTH)
    const overlappingBins = reg2bins(min, max) // List of bin #s that overlap min, max
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

    // The linear index is monotonically non-decreasing, so the minimum virtual
    // offset for chunks that could overlap [min, ...) is at index minLin.
    // SYNC: ~/src/gmod/bam-js/src/bai.ts getLowestChunk
    const linearIndex = ba.linearIndex
    const lowest = linearIndex?.[Math.min(beg >> 14, linearIndex.length - 1)]

    return optimizeChunks(chunks, lowest)
  }
}
