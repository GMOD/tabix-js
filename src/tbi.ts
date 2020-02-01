import Long from 'long'
import VirtualOffset, { fromBytes } from './virtualOffset'
import Chunk from './chunk'
import { unzip } from '@gmod/bgzf-filehandle'
import { longToNumber, checkAbortSignal } from './util'
import IndexFile, { Options } from './indexFile'

const TBI_MAGIC = 21578324 // TBI\1
const TAD_LIDX_SHIFT = 14

/**
 * calculate the list of bins that may overlap with region [beg,end) (zero-based half-open)
 * @returns {Array[number]}
 */
function reg2bins(beg: number, end: number) {
  beg += 1 // < convert to 1-based closed
  end -= 1
  const list = [0]
  for (let k = 1 + (beg >> 26); k <= 1 + (end >> 26); k += 1) list.push(k)
  for (let k = 9 + (beg >> 23); k <= 9 + (end >> 23); k += 1) list.push(k)
  for (let k = 73 + (beg >> 20); k <= 73 + (end >> 20); k += 1) list.push(k)
  for (let k = 585 + (beg >> 17); k <= 585 + (end >> 17); k += 1) list.push(k)
  for (let k = 4681 + (beg >> 14); k <= 4681 + (end >> 14); k += 1) list.push(k)
  return list
}

export default class TabixIndex extends IndexFile {
  async lineCount(refName: string, opts: Options = {}) {
    const indexData = await this.parse(opts)
    if (!indexData) return -1
    const refId = indexData.refNameToId[refName]
    const idx = indexData.indices[refId]
    if (!idx) return -1
    const { stats } = indexData.indices[refId]
    if (stats) return stats.lineCount
    return -1
  }

  // memoize
  // fetch and parse the index
  async _parse(opts: Options = {}) {
    const bytes = await unzip((await this.filehandle.readFile(opts)) as Buffer)
    checkAbortSignal(opts.signal)

    // check TBI magic numbers
    if (bytes.readUInt32LE(0) !== TBI_MAGIC /* "TBI\1" */) {
      throw new Error('Not a TBI file')
      // TODO: do we need to support big-endian TBI files?
    }

    // number of reference sequences in the index
    const refCount = bytes.readInt32LE(4)
    const formatFlags = bytes.readInt32LE(8)
    const coordinateType =
      formatFlags & 0x10000 ? 'zero-based-half-open' : '1-based-closed'
    const formatOpts: { [key: number]: string } = {
      0: 'generic',
      1: 'SAM',
      2: 'VCF',
    }
    const format = formatOpts[formatFlags & 0xf]
    if (!format)
      throw new Error(`invalid Tabix preset format flags ${formatFlags}`)
    const columnNumbers = {
      ref: bytes.readInt32LE(12),
      start: bytes.readInt32LE(16),
      end: bytes.readInt32LE(20),
    }
    const metaValue = bytes.readInt32LE(24)
    const depth = 5
    const maxBinNumber = ((1 << ((depth + 1) * 3)) - 1) / 7
    const maxRefLength = 2 ** (14 + depth * 3)
    const metaChar = metaValue ? String.fromCharCode(metaValue) : null
    const skipLines = bytes.readInt32LE(28)

    // read sequence dictionary
    const nameSectionLength = bytes.readInt32LE(32)
    const { refNameToId, refIdToName } = this._parseNameBytes(
      bytes.slice(36, 36 + nameSectionLength),
    )

    // read the indexes for each reference sequence
    let currOffset = 36 + nameSectionLength
    let firstDataLine: VirtualOffset | undefined
    const indices = new Array(refCount).fill(0).map(() => {
      // the binning index
      const binCount = bytes.readInt32LE(currOffset)
      currOffset += 4
      const binIndex: { [key: number]: Chunk[] } = {}
      let stats
      for (let j = 0; j < binCount; j += 1) {
        const bin = bytes.readUInt32LE(currOffset)
        currOffset += 4
        if (bin > maxBinNumber + 1) {
          throw new Error(
            'tabix index contains too many bins, please use a CSI index',
          )
        } else if (bin === maxBinNumber + 1) {
          const chunkCount = bytes.readInt32LE(currOffset)
          currOffset += 4
          if (chunkCount === 2) {
            stats = this.parsePseudoBin(bytes, currOffset)
          }
          currOffset += 16 * chunkCount
        } else {
          const chunkCount = bytes.readInt32LE(currOffset)
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
      const linearCount = bytes.readInt32LE(currOffset)
      currOffset += 4
      const linearIndex = new Array(linearCount)
      for (let k = 0; k < linearCount; k += 1) {
        linearIndex[k] = fromBytes(bytes, currOffset)
        currOffset += 8
        firstDataLine = this._findFirstData(firstDataLine, linearIndex[k])
      }
      return { binIndex, linearIndex, stats }
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

  parsePseudoBin(bytes: Buffer, offset: number) {
    const lineCount = longToNumber(
      Long.fromBytesLE(
        (bytes.slice(offset + 16, offset + 24) as unknown) as number[],
        true,
      ),
    )
    return { lineCount }
  }

  _parseNameBytes(namesBytes: Buffer) {
    let currRefId = 0
    let currNameStart = 0
    const refIdToName: string[] = []
    const refNameToId: { [key: string]: number } = {}
    for (let i = 0; i < namesBytes.length; i += 1) {
      if (!namesBytes[i]) {
        if (currNameStart < i) {
          let refName = namesBytes.toString('utf8', currNameStart, i)
          refName = this.renameRefSeq(refName)
          refIdToName[currRefId] = refName
          refNameToId[refName] = currRefId
        }
        currNameStart = i + 1
        currRefId += 1
      }
    }
    return { refNameToId, refIdToName }
  }

  async blocksForRange(
    refName: string,
    beg: number,
    end: number,
    opts: Options = {},
  ) {
    if (beg < 0) beg = 0

    const indexData = await this.parse(opts)
    if (!indexData) return []
    const refId = indexData.refNameToId[refName]
    const indexes = indexData.indices[refId]
    if (!indexes) return []

    const { linearIndex, binIndex } = indexes

    const bins = reg2bins(beg, end)

    const minOffset = linearIndex.length
      ? linearIndex[
          beg >> TAD_LIDX_SHIFT >= linearIndex.length
            ? linearIndex.length - 1
            : beg >> TAD_LIDX_SHIFT
        ]
      : new VirtualOffset(0, 0)
    if (!minOffset) {
      console.warn('querying outside of possible tabix range')
      return []
    }

    let l
    let numOffsets = 0
    for (let i = 0; i < bins.length; i += 1) {
      if (binIndex[bins[i]]) numOffsets += binIndex[bins[i]].length
    }

    if (numOffsets === 0) return []

    let off = []
    numOffsets = 0
    for (let i = 0; i < bins.length; i += 1) {
      const chunks = binIndex[bins[i]]
      if (chunks)
        for (let j = 0; j < chunks.length; j += 1)
          if (minOffset.compareTo(chunks[j].maxv) < 0) {
            off[numOffsets] = new Chunk(
              chunks[j].minv,
              chunks[j].maxv,
              chunks[j].bin,
            )
            numOffsets += 1
          }
    }

    if (!off.length) return []

    off = off.sort((a, b) => a.compareTo(b))

    // resolve completely contained adjacent blocks
    l = 0
    for (let i = 1; i < numOffsets; i += 1) {
      if (off[l].maxv.compareTo(off[i].maxv) < 0) {
        l += 1
        off[l].minv = off[i].minv
        off[l].maxv = off[i].maxv
      }
    }
    numOffsets = l + 1

    // resolve overlaps between adjacent blocks; this may happen due to the merge in indexing
    for (let i = 1; i < numOffsets; i += 1) {
      if (off[i - 1].maxv.compareTo(off[i].minv) >= 0) {
        off[i - 1].maxv = off[i].minv
      }
    }

    // merge adjacent blocks
    l = 0
    for (let i = 1; i < numOffsets; i += 1) {
      if (off[l].maxv.blockPosition === off[i].minv.blockPosition)
        off[l].maxv = off[i].maxv
      else {
        l += 1
        off[l].minv = off[i].minv
        off[l].maxv = off[i].maxv
      }
    }
    numOffsets = l + 1

    return off.slice(0, numOffsets)
  }
}
