import { unzip } from '@gmod/bgzf-filehandle'

import VirtualOffset, { fromBytes } from './virtualOffset'
import Chunk from './chunk'
import { optimizeChunks } from './util'

import IndexFile, { Options } from './indexFile'
import { longFromBytesToUnsigned } from './long'

const CSI1_MAGIC = 21582659 // CSI\1
const CSI2_MAGIC = 38359875 // CSI\2

const formats = {
  0: 'generic',
  1: 'SAM',
  2: 'VCF',
}

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
  constructor(args: any) {
    super(args)
    this.maxBinNumber = 0
    this.depth = 0
    this.minShift = 0
  }
  async lineCount(refName: string, opts: Options = {}): Promise<number> {
    const indexData = await this.parse(opts)
    const refId = indexData.refNameToId[refName]
    if (refId === undefined) {
      return -1
    }
    const idx = indexData.indices[refId]
    if (!idx) {
      return -1
    }
    const { stats } = indexData.indices[refId]
    if (stats) {
      return stats.lineCount
    }
    return -1
  }

  indexCov() {
    throw new Error('CSI indexes do not support indexcov')
  }

  parseAuxData(bytes: Uint8Array, offset: number) {
    const dataView = new DataView(bytes.buffer)
    const formatFlags = dataView.getInt32(offset, true)
    const coordinateType =
      formatFlags & 0x10000 ? 'zero-based-half-open' : '1-based-closed'
    const format = formats[(formatFlags & 0xf) as 0 | 1 | 2]
    if (!format) {
      throw new Error(`invalid Tabix preset format flags ${formatFlags}`)
    }
    const columnNumbers = {
      ref: dataView.getInt32(offset + 4, true),
      start: dataView.getInt32(offset + 8, true),
      end: dataView.getInt32(offset + 12, true),
    }
    const metaValue = dataView.getInt32(offset + 16, true)
    const metaChar = metaValue ? String.fromCharCode(metaValue) : null
    const skipLines = dataView.getInt32(offset + 20, true)
    const nameSectionLength = dataView.getInt32(offset + 24, true)

    const { refIdToName, refNameToId } = this._parseNameBytes(
      bytes.subarray(offset + 28, offset + 28 + nameSectionLength),
    )

    return {
      refIdToName,
      refNameToId,
      skipLines,
      metaChar,
      columnNumbers,
      format,
      coordinateType,
    }
  }

  _parseNameBytes(namesBytes: Uint8Array) {
    let currRefId = 0
    let currNameStart = 0
    const refIdToName = []
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

  // fetch and parse the index

  async _parse(opts: Options = {}) {
    const bytes = await unzip(await this.filehandle.readFile(opts))
    const dataView = new DataView(bytes.buffer)

    // check TBI magic numbers
    let csiVersion
    if (dataView.getUint32(0, true) === CSI1_MAGIC) {
      csiVersion = 1
    } else if (dataView.getUint32(0, true) === CSI2_MAGIC) {
      csiVersion = 2
    } else {
      throw new Error('Not a CSI file')
    }

    this.minShift = dataView.getInt32(4, true)
    this.depth = dataView.getInt32(8, true)
    this.maxBinNumber = ((1 << ((this.depth + 1) * 3)) - 1) / 7
    const maxRefLength = 2 ** (this.minShift + this.depth * 3)
    const auxLength = dataView.getInt32(12, true)
    const aux =
      auxLength && auxLength >= 30
        ? this.parseAuxData(bytes, 16)
        : {
            refIdToName: [],
            refNameToId: {},
            metaChar: null,
            columnNumbers: { ref: 0, start: 1, end: 2 },
            coordinateType: 'zero-based-half-open',
            format: 'generic',
          }
    const refCount = dataView.getInt32(16 + auxLength, true)

    // read the indexes for each reference sequence
    let firstDataLine: VirtualOffset | undefined
    let currOffset = 16 + auxLength + 4
    const indices = new Array(refCount).fill(0).map(() => {
      const binCount = dataView.getInt32(currOffset, true)
      currOffset += 4
      const binIndex: Record<string, Chunk[]> = {}
      let stats
      for (let j = 0; j < binCount; j += 1) {
        const bin = dataView.getUint32(currOffset, true)
        if (bin > this.maxBinNumber) {
          // this is a fake bin that actually has stats information about the
          // reference sequence in it
          stats = this.parsePseudoBin(bytes, currOffset + 4)
          currOffset += 4 + 8 + 4 + 16 + 16
        } else {
          const loffset = fromBytes(bytes, currOffset + 4)
          firstDataLine = this._findFirstData(firstDataLine, loffset)
          const chunkCount = dataView.getInt32(currOffset + 12, true)
          currOffset += 16
          const chunks = new Array(chunkCount)
          for (let k = 0; k < chunkCount; k += 1) {
            const u = fromBytes(bytes, currOffset)
            const v = fromBytes(bytes, currOffset + 8)
            currOffset += 16
            chunks[k] = new Chunk(u, v, bin)
          }
          binIndex[bin] = chunks
        }
      }

      return { binIndex, stats }
    })

    return {
      ...aux,
      csi: true,
      refCount,
      maxBlockSize: 1 << 16,
      firstDataLine,
      csiVersion,
      indices,
      depth: this.depth,
      maxBinNumber: this.maxBinNumber,
      maxRefLength,
    }
  }

  parsePseudoBin(bytes: Uint8Array, offset: number) {
    return {
      lineCount: longFromBytesToUnsigned(bytes, offset + 28),
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

    // List of bin #s that overlap min, max
    const overlappingBins = this.reg2bins(min, max)
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

    return optimizeChunks(chunks, new VirtualOffset(0, 0))
  }

  /**
   * calculate the list of bins that may overlap with region [beg,end) (zero-based half-open)
   */
  reg2bins(beg: number, end: number) {
    beg -= 1 // < convert to 1-based closed
    if (beg < 1) {
      beg = 1
    }
    if (end > 2 ** 50) {
      end = 2 ** 34
    } // 17 GiB ought to be enough for anybody
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
