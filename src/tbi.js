const Long = require('long')
const { Parser } = require('@gmod/binary-parser')

const VirtualOffset = require('./virtualOffset')
const Chunk = require('./chunk')

const { unzip } = require('./unzip')

const TAD_LIDX_SHIFT = 14

const { longToNumber } = require('./util')

/**
 * calculate the list of bins that may overlap with region [beg,end) (zero-based half-open)
 * @returns {Array[number]}
 */
function reg2bins(beg, end) {
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

class TabixIndex {
  /**
   * @param {filehandle} filehandle
   * @param {function} [renameRefSeqs]
   */
  constructor({ filehandle, renameRefSeqs = n => n }) {
    this.filehandle = filehandle
    this.renameRefSeq = renameRefSeqs
  }

  async lineCount(refName) {
    const indexData = await this.parse()
    if (!indexData) return -1
    const refId = indexData.refNameToId[refName]
    const idx = indexData.indices[refId]
    if (!idx) return -1
    const { stats } = indexData.indices[refId]
    if (stats) return stats.lineCount
    return -1
  }

  /**
   * @returns {Promise} for an object like
   * `{ columnNumbers, metaChar, skipLines, refIdToName, refNameToId, coordinateType, format }`
   */
  getMetadata() {
    return this.parse()
  }

  // memoize
  // fetch and parse the index
  async parse() {
    const bytes = await unzip(await this.filehandle.readFile())
    const depth = 5
    const maxBinNumber = ((1 << ((depth + 1) * 3)) - 1) / 7
    const p = new Parser()
      .uint32('magic', { assert: val => val === 21578324 /* TBI\1 */ })
      .int32('refCount')
      .int32('formatFlags')
      .int32('ref')
      .int32('start')
      .int32('end')
      .int32('metaValue')
      .int32('skipLines')
      .int32('nameSectionLength')
      .buffer('names', { length: 'nameSectionLength' })
      .array('indices', {
        length: 'refCount',
        type: new Parser()
          .int32('binCount')
          .array('bins', {
            length: 'binCount',
            type: new Parser().uint32('bin').choice('binContents', {
              tag: 'bin',
              choices: {
                [maxBinNumber + 1]: new Parser()
                  .int32('chunkCount')
                  .buffer('pseudoBin', {
                    length: 32,
                  }),
              },
              defaultChoice: new Parser().int32('chunkCount').array('chunks', {
                length: 'chunkCount',
                type: new Parser()
                  .buffer('u', { length: 8 })
                  .buffer('v', { length: 8 }),
              }),
            }),
          })
          .int32('linearCount')
          .array('linearIndex', {
            length: 'linearCount',
            type: new Parser().buffer('offset', { length: 8 }),
          }),
      })

    const data = p.parse(bytes).result
    Object.assign(data, this._parseNameBytes(data.names))

    data.maxBlockSize = 1 << 16
    data.metaChar = data.metaValue ? String.fromCharCode(data.metaValue) : null
    data.columnNumbers = { ref: data.ref, start: data.start, end: data.end }
    console.log(data.indices[0].bins.filter(b => b.bin == maxBinNumber+1))

    if (data.indices)
      data.indices.forEach(ret => {
        ret.linearIndex = new VirtualOffset(ret.linearIndex)
        if (ret.bins)
          ret.bins.forEach(bin => {
            if(bin.bin == maxBinNumber+1) {
              const lineCount = longToNumber(
                Long.fromBytesLE(bin.binContents.pseudoBin.slice(16, 24), true),
              )
              ret.stats = { lineCount }
            }
            else if (bin.chunks)
              bin.chunks.forEach(chunk => {
                chunk.u = new VirtualOffset(chunk.u)
                chunk.v = new VirtualOffset(chunk.v)
              })
          })
      })
    console.log(data)

    //     // read the indexes for each reference sequence
    //     data.indices = new Array(data.refCount)
    //     let currOffset = 36 + nameSectionLength
    //     for (let i = 0; i < data.refCount; i += 1) {
    //       // the binning index
    //       const binCount = bytes.readInt32LE(currOffset)
    //       currOffset += 4
    //       const binIndex = {}
    //       let stats
    //       for (let j = 0; j < binCount; j += 1) {
    //         const bin = bytes.readUInt32LE(currOffset)
    //         const chunkCount = bytes.readInt32LE(currOffset + 4)
    //         console.log(chunkCount, bin>data.maxBinNumber)

    //         const chunks = new Array(chunkCount)
    //         currOffset += 8
    //         for (let k = 0; k < chunkCount; k += 1) {
    //           const u = VirtualOffset.fromBytes(bytes, currOffset)
    //           const v = VirtualOffset.fromBytes(bytes, currOffset + 8)
    //           currOffset += 16
    //           data.firstDataLine = VirtualOffset.min(data.firstDataLine, u)
    //           chunks[k] = new Chunk(u, v, bin)
    //         }
    //         binIndex[bin] = chunks
    //       }
    //       // the linear index
    //       const linearCount = bytes.readInt32LE(currOffset)
    //       currOffset += 4
    //       const linearIndex = new Array(linearCount)
    //       for (let k = 0; k < linearCount; k += 1) {
    //         linearIndex[k] = VirtualOffset.fromBytes(bytes, currOffset)
    //         currOffset += 8
    //         data.firstDataLine = VirtualOffset.min(
    //           data.firstDataLine,
    //           linearIndex[k],
    //         )
    //       }

    //       data.indices[i] = { binIndex, linearIndex, stats }
    //     }

    return data // data
  }

  parsePseudoBin(bytes, offset) {
    // const one = Long.fromBytesLE(bytes.slice(offset + 4, offset + 12), true)
    // const two = Long.fromBytesLE(bytes.slice(offset + 12, offset + 20), true)
    const lineCount = longToNumber(
      Long.fromBytesLE(bytes.slice(offset + 20, offset + 28), true),
    )
    // const four = Long.fromBytesLE(bytes.slice(offset + 28, offset + 36), true)
    return { lineCount }
  }

  _parseNameBytes(namesBytes) {
    let currRefId = 0
    let currNameStart = 0
    const refIdToName = []
    const refNameToId = {}
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

  async blocksForRange(refName, beg, end) {
    if (beg < 0) beg = 0

    const indexData = await this.parse()
    if (!indexData) return []
    const refId = indexData.refNameToId[refName]
    const indexes = indexData.indices[refId]
    if (!indexes) return []
    console.log(indexes)
    return []

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
