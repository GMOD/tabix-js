import VirtualOffset, { fromBytes } from './virtualOffset'
import Chunk from './chunk'
import { unzip } from '@gmod/bgzf-filehandle'
import { optimizeChunks, checkAbortSignal } from './util'
import IndexFile, { Options } from './indexFile'
import { longFromBytesToUnsigned } from './long'

const TBI_MAGIC = 21578324 // TBI\1
const TAD_LIDX_SHIFT = 14

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
    return indexData.indices[refId].stats?.lineCount ?? -1
  }

  // fetch and parse the index
  async _parse(opts: Options = {}) {
    const buf = await this.filehandle.readFile(opts)
    const bytes = await unzip(buf)
    checkAbortSignal(opts.signal)
    const dataView = new DataView(bytes.buffer)

    const magic = dataView.getUint32(0, true)
    if (magic !== TBI_MAGIC /* "TBI\1" */) {
      throw new Error('Not a TBI file')
    }

    // number of reference sequences in the index
    const refCount = dataView.getUint32(4, true)
    const formatFlags = dataView.getUint32(8, true)
    const coordinateType =
      formatFlags & 0x10000 ? 'zero-based-half-open' : '1-based-closed'
    const formatOpts: Record<number, string> = {
      0: 'generic',
      1: 'SAM',
      2: 'VCF',
    }
    const format = formatOpts[formatFlags & 0xf]
    if (!format) {
      throw new Error(`invalid Tabix preset format flags ${formatFlags}`)
    }
    const columnNumbers = {
      ref: dataView.getInt32(12, true),
      start: dataView.getInt32(16, true),
      end: dataView.getInt32(20, true),
    }
    const metaValue = dataView.getInt32(24, true)
    const depth = 5
    const maxBinNumber = ((1 << ((depth + 1) * 3)) - 1) / 7
    const maxRefLength = 2 ** (14 + depth * 3)
    const metaChar = metaValue ? String.fromCharCode(metaValue) : null
    const skipLines = dataView.getInt32(28, true)

    // read sequence dictionary
    const nameSectionLength = dataView.getInt32(32, true)
    const { refNameToId, refIdToName } = this._parseNameBytes(
      bytes.slice(36, 36 + nameSectionLength),
    )

    // read the indexes for each reference sequence
    let currOffset = 36 + nameSectionLength
    let firstDataLine: VirtualOffset | undefined
    const indices = new Array(refCount).fill(0).map(() => {
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
          const chunks = new Array(chunkCount)
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
      const linearIndex = new Array(linearCount)
      for (let k = 0; k < linearCount; k += 1) {
        linearIndex[k] = fromBytes(bytes, currOffset)
        currOffset += 8
        firstDataLine = this._findFirstData(firstDataLine, linearIndex[k])
      }
      return {
        binIndex,
        linearIndex,
        stats,
      }
    })

    return {
      indices,
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

  parsePseudoBin(bytes: Uint8Array, offset: number) {
    return {
      lineCount: longFromBytesToUnsigned(bytes, offset + 16),
    }
  }

  _parseNameBytes(namesBytes: Uint8Array) {
    let currRefId = 0
    let currNameStart = 0
    const refIdToName: string[] = []
    const refNameToId: Record<string, number> = {}
    const decoder = new TextDecoder('utf8')
    for (let i = 0; i < namesBytes.length; i += 1) {
      if (!namesBytes[i]) {
        if (currNameStart < i) {
          const refName = this.renameRefSeq(
            decoder.decode(namesBytes.subarray(currNameStart, i)),
          )
          refIdToName[currRefId] = refName
          refNameToId[refName] = currRefId
        }
        currNameStart = i + 1
        currRefId += 1
      }
    }
    return {
      refNameToId,
      refIdToName,
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

    const minOffset = ba.linearIndex.length
      ? ba.linearIndex[
          min >> TAD_LIDX_SHIFT >= ba.linearIndex.length
            ? ba.linearIndex.length - 1
            : min >> TAD_LIDX_SHIFT
        ]
      : new VirtualOffset(0, 0)
    if (!minOffset) {
      console.warn('querying outside of possible tabix range')
    }

    // const { linearIndex, binIndex } = indexes

    const overlappingBins = reg2bins(min, max) // List of bin #s that overlap min, max
    const chunks: Chunk[] = []

    // Find chunks in overlapping bins.  Leaf bins (< 4681) are not pruned
    for (const [start, end] of overlappingBins) {
      for (let bin = start; bin <= end; bin++) {
        if (ba.binIndex[bin]) {
          for (const c of ba.binIndex[bin]) {
            chunks.push(new Chunk(c.minv, c.maxv, bin))
          }
        }
      }
    }

    // Use the linear index to find minimum file position of chunks that could
    // contain alignments in the region
    const nintv = ba.linearIndex.length
    let lowest = null
    const minLin = Math.min(min >> 14, nintv - 1)
    const maxLin = Math.min(max >> 14, nintv - 1)
    for (let i = minLin; i <= maxLin; ++i) {
      const vp = ba.linearIndex[i]
      if (vp) {
        if (!lowest || vp.compareTo(lowest) < 0) {
          lowest = vp
        }
      }
    }

    return optimizeChunks(chunks, lowest)
  }
}
