// const { Parser } = require('binary-parser')
const promisify = require('util.promisify')
const VirtualOffset = require('./virtualOffset')
const gunzip = promisify(require('zlib').gunzip)

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
   */
  constructor(minv, maxv, bin) {
    this.minv = minv
    this.maxv = maxv
    this.bin = bin
  }
  toUniqueString() {
    return `${this.minv}..${this.maxv} (bin ${this.bin})`
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
    return this.maxv.blockPosition + (1 << 16) - this.minv.blockPosition + 1
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

  // async _detectEndianness() {
  //   const buf = Buffer.allocUnsafe(4)
  //   await this.filehandle.read(buf, 0, 4, 0)
  //   if (buf.readInt32LE(0) === TBI_MAGIC) {
  //     this.isBigEndian = false
  //   } else if (buf.readInt32BE(0) === TBI_MAGIC) {
  //     this.isBigEndian = true
  //     throw new Error('big endian TBI files not yet supported')
  //     // need a little more work to support these,
  //     // not sure they actually occur in the wild
  //   } else {
  //     throw new Error('not a TBI file')
  //   }
  // }

  // async _getParser(name) {
  //   const parser = (await this._getParsers())[name]
  //   if (!parser) throw new Error(`parser ${name} not found`)
  //   return parser
  // }

  // // memoize
  // async _getParsers() {
  //   await this._detectEndianness()
  //   const endianess = this.isBigEndian ? 'big' : 'little'

  //   return {
  //     file: new Parser()
  //       .endianess(endianess)
  //       .string('magic', { length: 4 })
  //       .uint32('numRef')
  //       .uint32('format')
  //       .uint32('seqNameColumn')
  //       .uint32('startColumn')
  //       .uint32('endColumn')
  //       .uint32('metaCharacter')
  //       .uint32('skipLines')
  //       .uint32('seqNamesLength')
  //       .string('names', {
  //         length: 'seqNamesLength',
  //         formatter: names => {
  //           const arr = names.split('\u0000')
  //           if (arr[arr.length - 1] === '') arr.pop()
  //           return arr
  //         },
  //       })
  //       .array('indices', {
  //         length: 'numRef',
  //         type: new Parser()
  //           .endianess(endianess)
  //           .int32('numBins', { assert: v => v >= 0 })
  //           .array('bins', {
  //             length: 'numBins',
  //             type: new Parser()
  //               .endianess(endianess)
  //               .uint32('binNumber')
  //               .uint32('numChunks')
  //               .array('chunks', {
  //                 length: 'numChunks',
  //                 type: new Parser()
  //                   .endianess(endianess)
  //                   .buffer('start', { length: 8 })
  //                   .buffer('end', { length: 8 }),
  //               }),
  //           })
  //           .int32('numIntervals', { assert: v => v >= 0 })
  //           .array('intervals', {
  //             length: 'numIntervals',
  //             type: new Parser()
  //               .endianess(endianess)
  //               .buffer('offset', { length: 8 }),
  //           }),
  //       }),
  //   }
  // }

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
   * `{ columnNumbers, metaChar, skipLines, refIdToName, refNameToId }`
   */
  async getMetadata() {
    const {
      columnNumbers,
      metaChar,
      skipLines,
      refIdToName,
      refNameToId,
    } = await this.parse()
    return {
      columnNumbers,
      metaChar,
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
    const refCount = bytes.readInt32LE(4)
    data.presetType = bytes.readInt32LE(8)
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
    data.indices = new Array(refCount)
    let currOffset = 36 + nameSectionLength
    for (let i = 0; i < refCount; i += 1) {
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

// class TabixIndex {
//   constructor(args) {
//     this.browser = args.browser
//     this.blob = args.blob
//     this.load()
//   }

//   // fetch and parse the index
//   _parseIndex(bytes, deferred) {
//     this._littleEndian = true
//     let data = new jDataView(bytes, 0, undefined, this._littleEndian)

//     // check TBI magic numbers
//     if (data.getInt32() != 21578324 /* "TBI\1" */) {
//       // try the other endianness if no magic
//       this._littleEndian = false
//       data = new jDataView(bytes, 0, undefined, this._littleEndian)
//       if (data.getInt32() != 21578324 /* "TBI\1" */) {
//         console.error('Not a TBI file')
//         deferred.reject('Not a TBI file')
//         return
//       }
//     }

//     // number of reference sequences in the index
//     const refCount = data.getInt32()
//     this.presetType = data.getInt32()
//     this.columnNumbers = {
//       ref: data.getInt32(),
//       start: data.getInt32(),
//       end: data.getInt32(),
//     }
//     this.metaValue = data.getInt32()
//     this.metaChar = this.metaValue ? String.fromCharCode(this.metaValue) : null
//     this.skipLines = data.getInt32()

//     // read sequence dictionary
//     this._refIDToName = new Array(refCount)
//     this._refNameToID = {}
//     const nameSectionLength = data.getInt32()
//     this._parseNameBytes(data.getBytes(nameSectionLength, undefined, false))

//     // read the per-reference-sequence indexes
//     this._indices = new Array(refCount)
//     for (let i = 0; i < refCount; i += 1) {
//       // the binning index
//       const binCount = data.getInt32()
//       const idx = (this._indices[i] = { binIndex: {} })
//       for (let j = 0; j < binCount; j += 1) {
//         const bin = data.getInt32()
//         const chunkCount = data.getInt32()
//         const chunks = new Array(chunkCount)
//         for (var k = 0; k < chunkCount; k += 1) {
//           const u = new VirtualOffset(data.getBytes(8))
//           const v = new VirtualOffset(data.getBytes(8))
//           this._findFirstData(u)
//           chunks[k] = new Chunk(u, v, bin)
//         }
//         idx.binIndex[bin] = chunks
//       }
//       // the linear index
//       const linearCount = data.getInt32()
//       const linear = (idx.linearIndex = new Array(linearCount))
//       for (var k = 0; k < linearCount; k += 1) {
//         linear[k] = new VirtualOffset(data.getBytes(8))
//         this._findFirstData(linear[k])
//       }
//     }
//     deferred.resolve({ success: true })
//   }

//   _findFirstData(virtualOffset) {
//     const fdl = this.firstDataLine
//     this.firstDataLine = fdl
//       ? fdl.compareTo(virtualOffset) > 0
//         ? virtualOffset
//         : fdl
//       : virtualOffset
//   }

//   _parseNameBytes(namesBytes) {
//     let offset = 0

//     function getChar() {
//       const b = namesBytes[offset++]
//       return b ? String.fromCharCode(b) : null
//     }

//     function getString() {
//       let c,
//         s = ''
//       while ((c = getChar())) s += c
//       return s.length ? s : null
//     }

//     let refName,
//       refID = 0
//     for (; (refName = getString()); refID++) {
//       this._refIDToName[refID] = refName
//       this._refNameToID[this.browser.regularizeReferenceName(refName)] = refID
//     }
//   }

//   /**
//    * Interrogate whether a store has data for a given reference
//    * sequence.  Calls the given callback with either true or false.
//    *
//    * Implemented as a binary interrogation because some stores are
//    * smart enough to regularize reference sequence names, while
//    * others are not.
//    */
//   hasRefSeq(seqName, callback, errorCallback) {
//     const thisB = this
//     seqName = thisB.browser.regularizeReferenceName(seqName)
//     thisB.load().then(() => {
//       if (seqName in thisB._refNameToID) {
//         callback(true)
//         return
//       }
//       callback(false)
//     })
//   }

//   getRefId(refName) {
//     refName = this.browser.regularizeReferenceName(refName)
//     return this._refNameToID[refName]
//   }

//   const TAD_LIDX_SHIFT = 14

//   featureCount(refName) {
//     const tid = this.getRefId(refName)
//     const indexes = this._indices[tid]
//     if (!indexes) return -1
//     const ret = indexes.binIndex[this._bin_limit() + 1]
//     return ret ? ret[ret.length - 1].minv.offset : -1
//   }

//   blocksForRange(refName, beg, end) {
//     if (beg < 0) beg = 0

//     const tid = this.getRefId(refName)
//     const indexes = this._indices[tid]
//     if (!indexes) return []

//     let linearIndex = indexes.linearIndex,
//       binIndex = indexes.binIndex

//     const bins = this._reg2bins(beg, end)

//     const minOffset = linearIndex.length
//       ? linearIndex[
//           beg >> this.TAD_LIDX_SHIFT >= linearIndex.length
//             ? linearIndex.length - 1
//             : beg >> this.TAD_LIDX_SHIFT
//         ]
//       : new VirtualOffset(0, 0)

//     let i,
//       l,
//       numOffsets = 0
//     for (i = 0; i < bins.length; i += 1) {
//       numOffsets += (binIndex[bins[i]] || []).length
//     }

//     if (numOffsets == 0) return []

//     let off = []

//     let chunks
//     for (i = numOffsets = 0; i < bins.length; i += 1)
//       if ((chunks = binIndex[bins[i]]))
//         for (let j = 0; j < chunks.length; j += 1)
//           if (minOffset.compareTo(chunks[j].maxv) < 0)
//             off[numOffsets++] = new Chunk(
//               chunks[j].minv,
//               chunks[j].maxv,
//               chunks[j].bin,
//             )

//     if (!off.length) return []

//     off = off.sort((a, b) => a.compareTo(b))

//     // resolve completely contained adjacent blocks
//     for (i = 1, l = 0; i < numOffsets; i += 1) {
//       if (off[l].maxv.compareTo(off[i].maxv) < 0) {
//         ++l
//         off[l].minv = off[i].minv
//         off[l].maxv = off[i].maxv
//       }
//     }
//     numOffsets = l + 1

//     // resolve overlaps between adjacent blocks; this may happen due to the merge in indexing
//     for (i = 1; i < numOffsets; i += 1)
//       if (off[i - 1].maxv.compareTo(off[i].minv) >= 0)
//         off[i - 1].maxv = off[i].minv
//     // merge adjacent blocks
//     for (i = 1, l = 0; i < numOffsets; i += 1) {
//       if (off[l].maxv.block == off[i].minv.block) off[l].maxv = off[i].maxv
//       else {
//         ++l
//         off[l].minv = off[i].minv
//         off[l].maxv = off[i].maxv
//       }
//     }
//     numOffsets = l + 1

//     return off.slice(0, numOffsets)
//   }

//   /* calculate bin given an alignment covering [beg,end) (zero-based, half-close-half-open) */
//   _reg2bin(beg, end) {
//     --end
//     if (beg >> 14 == end >> 14) return ((1 << 15) - 1) / 7 + (beg >> 14)
//     if (beg >> 17 == end >> 17) return ((1 << 12) - 1) / 7 + (beg >> 17)
//     if (beg >> 20 == end >> 20) return ((1 << 9) - 1) / 7 + (beg >> 20)
//     if (beg >> 23 == end >> 23) return ((1 << 6) - 1) / 7 + (beg >> 23)
//     if (beg >> 26 == end >> 26) return ((1 << 3) - 1) / 7 + (beg >> 26)
//     return 0
//   }

//   /* calculate the list of bins that may overlap with region [beg,end) (zero-based) */
//   _reg2bins(beg, end) {
//     let k,
//       list = []
//     --end
//     list.push(0)
//     for (k = 1 + (beg >> 26); k <= 1 + (end >> 26); k += 1) list.push(k)
//     for (k = 9 + (beg >> 23); k <= 9 + (end >> 23); k += 1) list.push(k)
//     for (k = 73 + (beg >> 20); k <= 73 + (end >> 20); k += 1) list.push(k)
//     for (k = 585 + (beg >> 17); k <= 585 + (end >> 17); k += 1) list.push(k)
//     for (k = 4681 + (beg >> 14); k <= 4681 + (end >> 14); k += 1) list.push(k)
//     return list
//   }
//   _bin_limit(min_shift, depth = 5) {
//     return ((1 << ((depth + 1) * 3)) - 1) / 7
//   }
// }

module.exports = TabixIndex
