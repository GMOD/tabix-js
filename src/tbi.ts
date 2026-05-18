import { unzip } from '@gmod/bgzf-filehandle'

import Chunk from './chunk.ts'
import IndexFile from './indexFile.ts'
import { longFromBytesToUnsigned } from './long.ts'
import { optimizeChunks } from './util.ts'
import { fromBytes } from './virtualOffset.ts'

import type { Options } from './indexFile.ts'
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
    const idx = indexData.indices[refId]
    if (!idx) {
      return -1
    }
    return idx.stats?.lineCount ?? -1
  }

  // fetch and parse the index
  async _parse(opts: Options = {}) {
    const buf = await this.filehandle.readFile({ signal: opts.signal })
    const bytes = (await unzip(buf)) as Uint8Array
    const dataView = new DataView(bytes.buffer)

    const magic = dataView.getUint32(0, true)
    if (magic !== TBI_MAGIC /* "TBI\1" */) {
      throw new Error('Not a TBI file')
    }

    // number of reference sequences in the index
    const refCount = dataView.getUint32(4, true)
    const { header, namesEnd } = this._parseTabixHeader(bytes, 8)
    const depth = 5
    const maxBinNumber = ((1 << ((depth + 1) * 3)) - 1) / 7
    const maxRefLength = 2 ** (14 + depth * 3)

    // read the indexes for each reference sequence
    let currOffset = namesEnd
    let firstDataLine: VirtualOffset | undefined
    const indices = Array.from({ length: refCount }, () => {
      // the binning index
      const binCount = dataView.getInt32(currOffset, true)
      currOffset += 4
      const binIndex: Record<number, Chunk[]> = {}
      let stats
      for (let j = 0; j < binCount; j += 1) {
        const bin = dataView.getUint32(currOffset, true)
        currOffset += 4
        if (bin > maxBinNumber + 1) {
          throw new Error(
            'tabix index contains too many bins, please use a CSI index',
          )
        } else if (bin === maxBinNumber + 1) {
          const chunkCount = dataView.getInt32(currOffset, true)
          currOffset += 4
          if (chunkCount === 2) {
            stats = this.parsePseudoBin(bytes, currOffset)
          }
          currOffset += 16 * chunkCount
        } else {
          const chunkCount = dataView.getInt32(currOffset, true)
          currOffset += 4
          const chunks = Array.from<Chunk>({ length: chunkCount })
          for (let k = 0; k < chunkCount; k += 1) {
            const u = fromBytes(bytes, currOffset)
            const v = fromBytes(bytes, currOffset + 8)
            currOffset += 16
            firstDataLine = this._findFirstData(firstDataLine, u)
            chunks[k] = new Chunk(u, v, bin)
          }
          binIndex[bin] = chunks
        }
      }

      // the linear index
      const linearCount = dataView.getInt32(currOffset, true)
      currOffset += 4
      const linearIndex = Array.from<VirtualOffset>({ length: linearCount })
      for (let k = 0; k < linearCount; k += 1) {
        const lv = fromBytes(bytes, currOffset)
        linearIndex[k] = lv
        currOffset += 8
        firstDataLine = this._findFirstData(firstDataLine, lv)
      }
      return {
        binIndex,
        linearIndex,
        stats,
      }
    })

    return {
      ...header,
      indices,
      maxBinNumber,
      maxRefLength,
      firstDataLine,
      maxBlockSize: 1 << 16,
    }
  }

  parsePseudoBin(bytes: Uint8Array, offset: number) {
    return {
      lineCount: longFromBytesToUnsigned(bytes, offset + 16),
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
    const ba = indexData.indices[refId]
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

    // Use the linear index to find minimum file position of chunks that could
    // contain alignments in the region
    const nintv = linearIndex.length
    let lowest: VirtualOffset | undefined
    const minLin = Math.min(min >> 14, nintv - 1)
    const maxLin = Math.min(max >> 14, nintv - 1)
    for (let i = minLin; i <= maxLin; ++i) {
      const vp = linearIndex[i]
      if (vp && (!lowest || vp.compareTo(lowest) < 0)) {
        lowest = vp
      }
    }

    return optimizeChunks(chunks, lowest)
  }
}
