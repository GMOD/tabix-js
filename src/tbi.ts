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

const TBI_MAGIC = 21_578_324 // TBI\1

/**
 * calculate the list of bins that may overlap with region [beg,end)
 * (zero-based half-open)
 */
function reg2bins(beg: number, end: number) {
  beg += 1 // < convert to 1-based closed
  end -= 1
  return [
    [0, 0],
    [1 + (beg >> 26), 1 + (end >> 26)],
    [9 + (beg >> 23), 9 + (end >> 23)],
    [73 + (beg >> 20), 73 + (end >> 20)],
    [585 + (beg >> 17), 585 + (end >> 17)],
    [4681 + (beg >> 14), 4681 + (end >> 14)],
  ] as const
}

export default class TabixIndex extends IndexFile {
  async lineCount(refName: string, opts: Options = {}) {
    const indexData = await this.parse(opts)
    const refId = indexData.refNameToId[refName]
    if (refId === undefined) {
      return -1
    }
    return indexData.indices(refId)?.stats?.lineCount ?? -1
  }

  // fetch and parse the index
  async _parse(opts: Options = {}) {
    const buf = await this.filehandle.readFile({ signal: opts.signal })
    const bytes = (await unzip(buf)) as Uint8Array
    const dataView = new DataView(bytes.buffer)

    if (dataView.getUint32(0, true) !== TBI_MAGIC) {
      throw new Error('Not a TBI file')
    }

    const refCount = dataView.getUint32(4, true)
    const depth = 5
    const maxBinNumber = ((1 << ((depth + 1) * 3)) - 1) / 7
    const maxRefLength = 2 ** (14 + depth * 3)

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
      return { binIndex, linearIndex, stats }
    }

    return {
      indices: memoizeByRefId(getIndices),
      metaChar,
      maxBinNumber,
      maxRefLength,
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

    const linearIndex = ba.linearIndex ?? []
    // min >= 2**31 overflows int32 and produces a negative >> 14 result —
    // query is well beyond the indexed range
    if (linearIndex.length > 0 && min >= 2 ** 31) {
      console.warn('querying outside of possible tabix range')
    }

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
    const lowest = linearIndex[Math.min(min >> 14, linearIndex.length - 1)]

    return optimizeChunks(chunks, lowest)
  }
}
