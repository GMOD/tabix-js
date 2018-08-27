// const { Parser } = require('binary-parser')
const promisify = require('util.promisify')
const zlib = require('zlib')

const VirtualOffset = require('./virtualOffset')

const gunzip = promisify(zlib.gunzip)

const TBI_MAGIC = 21578324 // TBI\1
const TAD_LIDX_SHIFT = 14

/**
 * calculate the list of bins that may overlap with region [beg,end) (zero-based half-open)
 * @returns {Array[number]}
 */
function reg2bins(beg, end) {
  end -= 1
  const list = [0]
  for (let k = 1 + (beg >> 26); k <= 1 + (end >> 26); k += 1) list.push(k)
  for (let k = 9 + (beg >> 23); k <= 9 + (end >> 23); k += 1) list.push(k)
  for (let k = 73 + (beg >> 20); k <= 73 + (end >> 20); k += 1) list.push(k)
  for (let k = 585 + (beg >> 17); k <= 585 + (end >> 17); k += 1) list.push(k)
  for (let k = 4681 + (beg >> 14); k <= 4681 + (end >> 14); k += 1) list.push(k)
  return list
}

// little class representing a chunk in the index
class Chunk {
  /**
   * @param {VirtualOffset} minv
   * @param {VirtualOffset} maxv
   * @param {number} bin
   * @param {number} [fetchedSize]
   */
  constructor(minv, maxv, bin, fetchedSize) {
    this.minv = minv
    this.maxv = maxv
    this.bin = bin
    this._fetchedSize = fetchedSize
  }
  toUniqueString() {
    return `${this.minv}..${this.maxv} (bin ${this.bin}, fetchedSize ${
      this.fetchedSize
    })`
  }
  toString() {
    return this.toUniqueString()
  }
  compareTo(b) {
    return (
      this.minv.compareTo(b.minv) ||
      this.maxv.compareTo(b.maxv) ||
      this.bin - b.bin
    )
  }
  fetchedSize() {
    if (this._fetchedSize !== undefined) return this._fetchedSize
    return this.maxv.blockPosition + (1 << 16) - this.minv.blockPosition
  }
}

class TabixIndex {
  /**
   * @param {filehandle} filehandle
   */
  constructor(filehandle) {
    this.filehandle = filehandle
    this.isBigEndian = undefined
  }

  _findFirstData(virtualOffset) {
    const currentFdl = this.firstDataLine
    if (currentFdl) {
      this.firstDataLine =
        currentFdl.compareTo(virtualOffset) > 0 ? virtualOffset : currentFdl
    } else {
      this.firstDataLine = virtualOffset
    }
  }

  async lineCount(refName) {
    const indexData = await this.parse()
    if (!indexData) return []
    const refId = indexData.refNameToId[refName]
    const indexes = indexData.indices[refId]
    if (!indexes) return -1
    const depth = 5
    const binLimit = ((1 << ((depth + 1) * 3)) - 1) / 7
    const ret = indexes.binIndex[binLimit + 1]
    return ret ? ret[ret.length - 1].minv.dataPosition : -1
  }

  /**
   * @returns {Promise} for an object like
   * `{ columnNumbers, metaChar, skipLines, refIdToName, refNameToId, coordinateType, format }`
   */
  async getMetadata() {
    const {
      columnNumbers,
      metaChar,
      format,
      coordinateType,
      skipLines,
      refIdToName,
      refNameToId,
    } = await this.parse()
    return {
      columnNumbers,
      metaChar,
      format,
      coordinateType,
      skipLines,
      refIdToName,
      refNameToId,
    }
  }

  // memoize
  // fetch and parse the index
  async parse() {
    const data = {}
    const bytes = await gunzip(await this.filehandle.readFile())

    // check TBI magic numbers
    if (bytes.readUInt32LE(0) !== TBI_MAGIC /* "TBI\1" */) {
      throw new Error('Not a TBI file')
      // TODO: do we need to support big-endian TBI files?
    }

    // number of reference sequences in the index
    data.refCount = bytes.readInt32LE(4)
    data.formatFlags = bytes.readInt32LE(8)
    data.coordinateType =
      data.formatFlags & 0x10000 ? 'zero-based-half-open' : '1-based-closed'
    data.format = { 0: 'generic', 1: 'SAM', 2: 'VCF' }[data.formatFlags & 0xf]
    if (!data.format)
      throw new Error(`invalid Tabix preset format flags ${data.formatFlags}`)
    data.columnNumbers = {
      ref: bytes.readInt32LE(12),
      start: bytes.readInt32LE(16),
      end: bytes.readInt32LE(20),
    }
    data.metaValue = bytes.readInt32LE(24)
    data.metaChar = data.metaValue ? String.fromCharCode(data.metaValue) : null
    data.skipLines = bytes.readInt32LE(28)

    // read sequence dictionary
    const nameSectionLength = bytes.readInt32LE(32)
    const names = this._parseNameBytes(bytes.slice(36, 36 + nameSectionLength))
    Object.assign(data, names)

    // read the indexes for each reference sequence
    data.indices = new Array(data.refCount)
    let currOffset = 36 + nameSectionLength
    for (let i = 0; i < data.refCount; i += 1) {
      // the binning index
      const binCount = bytes.readInt32LE(currOffset)
      currOffset += 4
      const binIndex = {}
      for (let j = 0; j < binCount; j += 1) {
        const bin = bytes.readUInt32LE(currOffset)
        const chunkCount = bytes.readInt32LE(currOffset + 4)
        const chunks = new Array(chunkCount)
        currOffset += 8
        for (let k = 0; k < chunkCount; k += 1) {
          const u = VirtualOffset.fromBytes(bytes, currOffset)
          const v = VirtualOffset.fromBytes(bytes, currOffset + 8)
          currOffset += 16
          this._findFirstData(u)
          chunks[k] = new Chunk(u, v, bin)
        }
        binIndex[bin] = chunks
      }

      // the linear index
      const linearCount = bytes.readInt32LE(currOffset)
      currOffset += 4
      const linearIndex = new Array(linearCount)
      for (let k = 0; k < linearCount; k += 1) {
        linearIndex[k] = VirtualOffset.fromBytes(bytes, currOffset)
        currOffset += 8
        this._findFirstData(linearIndex[k])
      }

      data.indices[i] = { binIndex, linearIndex }
    }

    return data
  }

  _parseNameBytes(namesBytes) {
    let currRefId = 0
    let currNameStart = 0
    const refIdToName = []
    const refNameToId = {}
    for (let i = 0; i < namesBytes.length; i += 1) {
      if (!namesBytes[i]) {
        if (currNameStart < i) {
          const refName = namesBytes.toString('utf8', currNameStart, i)
          refIdToName[currRefId] = refName
          refNameToId[refName] = currRefId
        }
        currNameStart = i + 1
        currRefId += 1
      }
    }
    return { refNameToId, refIdToName }
  }

  async blocksForRange(refName, beg, end) {
    if (beg < 0) beg = 0

    const indexData = await this.parse()
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
    for (let i = 1; i < numOffsets; i += 1)
      if (off[i - 1].maxv.compareTo(off[i].minv) >= 0)
        off[i - 1].maxv = off[i].minv
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

// this is the stupidest possible memoization, ignores arguments.
function tinyMemoize(_class, methodName) {
  const method = _class.prototype[methodName]
  if (!method)
    throw new Error(`no method ${methodName} found in class ${_class.name}`)
  const memoAttrName = `_memo_${methodName}`
  _class.prototype[methodName] = function _tinyMemoized() {
    if (!(memoAttrName in this)) this[memoAttrName] = method.call(this)
    return this[memoAttrName]
  }
}
// memoize index.parse()
tinyMemoize(TabixIndex, 'parse')

module.exports = TabixIndex
