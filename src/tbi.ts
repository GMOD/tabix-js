import Chunk from './chunk.ts'
import IndexFile from './indexFile.ts'
import {
  clampChunkEnds,
  memoizeByRefId,
  minVirtualOffset,
  parseAuxData,
  parsePseudoBin,
} from './util.ts'
import { fromBytes } from './virtualOffset.ts'

import type { Options, RefIndex } from './indexFile.ts'
import type VirtualOffset from './virtualOffset.ts'

const TBI_MAGIC = 21_578_324 // TBI\1

// TBI is always the fixed depth-5, 14-bit-leaf binning scheme
const TBI_DEPTH = 5
const TBI_MIN_SHIFT = 14
const TBI_MAX_REF_LENGTH = 2 ** (TBI_MIN_SHIFT + TBI_DEPTH * 3)

// Clamp a query coordinate into the binning scheme's range. Past 2**31 the
// int32 shifts below truncate and go negative, which would silently yield no
// bins.
function clampToRefLength(pos: number) {
  return Math.min(Math.max(pos, 0), TBI_MAX_REF_LENGTH)
}

export default class TabixIndex extends IndexFile {
  /**
   * The bins that may overlap [beg, end) (zero-based half-open). TBI's scheme
   * is CSI's with minShift/depth fixed, so this is CSI's reg2bins with the
   * levels unrolled and its float shifts replaced by int32 ones.
   */
  protected reg2bins(beg: number, end: number) {
    if (beg > TBI_MAX_REF_LENGTH) {
      console.warn('querying outside of possible tabix range')
    }
    const b = clampToRefLength(beg)
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

  /**
   * The linear index is monotonically non-decreasing, so the minimum virtual
   * offset for chunks that could overlap [beg, ...) is its entry for beg.
   * SYNC: ~/src/gmod/bam-js/src/bai.ts getLowestChunk
   */
  protected lowestOffset(ref: RefIndex, beg: number) {
    const linearIndex = ref.linearIndex
    return linearIndex?.[
      Math.min(clampToRefLength(beg) >> TBI_MIN_SHIFT, linearIndex.length - 1)
    ]
  }

  /** @internal */
  async _parse(opts: Options = {}) {
    const { bytes, dataView } = await this.readIndexBytes(opts)

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

    // SYNC: ~/src/gmod/bam-js/src/bai.ts _parse — two-pass structure
    // First pass: record per-refId byte offsets and find firstDataLine.
    //
    // Only the linear index is consulted. Its entry for a window is the
    // smallest virtual offset of any record overlapping that window, so the
    // minimum over the linear index is already the minimum over the bin chunks
    // — walking the chunks too only re-derives it. Checked against every .tbi
    // in test/data: same answer on all 23, and no ref has bins without a
    // linear index.
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
        }
        curr += 16 * chunkCount
      }
      const linearCount = dataView.getInt32(curr, true)
      curr += 4
      firstDataLine = minVirtualOffset(bytes, curr, linearCount, firstDataLine)
      curr += 8 * linearCount
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
      minShift: TBI_MIN_SHIFT,
      depth: TBI_DEPTH,
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
}
