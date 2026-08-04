import LRU from '@jbrowse/quick-lru'

import Chunk from './chunk.ts'
import { longFromBytesToUnsigned } from './long.ts'
import VirtualOffset from './virtualOffset.ts'

// SYNC: ~/src/gmod/bam-js/src/util.ts optimizeChunks
export function optimizeChunks(chunks: Chunk[], lowest?: VirtualOffset) {
  const n = chunks.length
  if (n === 0) {
    return chunks
  }

  // Pre-filter before sorting: discard chunks whose maxv is at or before
  // `lowest` (the linear-index floor). Avoids sorting chunks that will be
  // dropped anyway — significant win when the linear index prunes most bins.
  let filtered: Chunk[]
  if (lowest) {
    const lowestBlock = lowest.blockPosition
    const lowestData = lowest.dataPosition
    filtered = []
    for (let i = 0; i < n; i++) {
      const chunk = chunks[i]!
      const cmp =
        chunk.maxv.blockPosition - lowestBlock ||
        chunk.maxv.dataPosition - lowestData
      if (cmp > 0) {
        filtered.push(chunk)
      }
    }
    if (filtered.length === 0) {
      return filtered
    }
  } else {
    filtered = chunks
  }

  filtered.sort((c0, c1) => {
    const dif = c0.minv.blockPosition - c1.minv.blockPosition
    return dif === 0 ? c0.minv.dataPosition - c1.minv.dataPosition : dif
  })

  // Merge adjacent/overlapping chunks. Track min/max blockPositions in locals
  // to avoid repeated property-chain reads in the hot loop.
  // Chunks are never mutated — merging produces a new Chunk instance.
  const mergedChunks: Chunk[] = [filtered[0]!]
  let lastMinBlock = filtered[0]!.minv.blockPosition
  let lastMaxBlock = filtered[0]!.maxv.blockPosition

  for (let i = 1; i < filtered.length; i++) {
    const chunk = filtered[i]!
    const chunkMinBlock = chunk.minv.blockPosition
    const chunkMaxBlock = chunk.maxv.blockPosition
    if (
      chunkMinBlock - lastMaxBlock < 65_000 &&
      chunkMaxBlock - lastMinBlock < 5_000_000
    ) {
      const lastChunk = mergedChunks.at(-1)!
      const cmp =
        chunkMaxBlock - lastMaxBlock ||
        chunk.maxv.dataPosition - lastChunk.maxv.dataPosition
      if (cmp > 0) {
        mergedChunks[mergedChunks.length - 1] = new Chunk(
          lastChunk.minv,
          chunk.maxv,
          lastChunk.bin,
          chunk.endPosition,
        )
        lastMaxBlock = chunkMaxBlock
      }
    } else {
      mergedChunks.push(chunk)
      lastMinBlock = chunkMinBlock
      lastMaxBlock = chunkMaxBlock
    }
  }

  return makeDisjoint(mergedChunks)
}

// SYNC: ~/src/gmod/bam-js/src/util.ts makeDisjoint
/**
 * Trim any chunk that starts before its predecessor ends, so the spans a query
 * reads never overlap.
 *
 * Merging alone does not guarantee this. Two chunks from different bins can
 * overlap inside a single BGZF block while the merge above still declines to
 * join them, because the combined span would exceed its 5MB cap. The shared
 * bytes are then fetched, decompressed and decoded by both chunks, and every
 * line in the overlap is returned TWICE from getLines — a duplicated VCF
 * record or GFF feature, with a duplicated fileOffset.
 *
 * Safe because a chunk's `maxv` is the virtual offset just past its last
 * record — a record boundary — so no record begins inside the trimmed span and
 * the union of the chunks is unchanged.
 *
 * No fixture here reproduces it (@gmod/bam found it on an 18MB BAM, where
 * out.bam returned 5 of its 6551 records twice); this keeps the two copies of
 * optimizeChunks in step and pins the invariant.
 */
function makeDisjoint(chunks: Chunk[]) {
  const out: Chunk[] = [chunks[0]!]
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i]!
    const prevMax = out.at(-1)!.maxv
    const cmp =
      chunk.minv.blockPosition - prevMax.blockPosition ||
      chunk.minv.dataPosition - prevMax.dataPosition
    if (cmp >= 0) {
      out.push(chunk)
      continue
    }
    const stillHasData =
      chunk.maxv.blockPosition - prevMax.blockPosition ||
      chunk.maxv.dataPosition - prevMax.dataPosition
    if (stillHasData > 0) {
      out.push(new Chunk(prevMax, chunk.maxv, chunk.bin, chunk.endPosition))
    }
  }
  return out
}

// Tighten each chunk's endPosition (default: a full max-size BGZF block past
// maxv) down to the next known block boundary. Every chunk min/maxv blockPosition
// and every extraBoundary (e.g. linear-index entries) is a real BGZF block start;
// since blocks don't overlap, the first boundary strictly greater than a chunk's
// maxv.blockPosition is an upper bound on where that final block ends — always at
// least the true block end, so the clamped fetch still contains the whole block.
// Shrinks both the byte estimate and the actual fetch with no extra I/O.
export function clampChunkEnds(
  chunks: Chunk[],
  extraBoundaries: number[] = [],
) {
  // Array#sort with a comparator beats a Float64Array numeric sort here:
  // extraBoundaries (the linear index) arrives already sorted and TimSort
  // exploits the existing run, which introsort cannot.
  const boundaries = [...extraBoundaries]
  for (const c of chunks) {
    boundaries.push(c.minv.blockPosition, c.maxv.blockPosition)
  }
  boundaries.sort((a, b) => a - b)

  for (const c of chunks) {
    const max = c.maxv.blockPosition
    // first boundary strictly greater than max
    let lo = 0
    let hi = boundaries.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (boundaries[mid]! > max) {
        hi = mid
      } else {
        lo = mid + 1
      }
    }
    if (lo < boundaries.length) {
      c.endPosition = Math.min(c.endPosition, boundaries[lo]!)
    }
  }
}

/**
 * The smallest of `current` and the `count` packed virtual offsets starting at
 * `offset`, allocating at most one VirtualOffset rather than one per entry.
 *
 * The index first pass exists only to find this minimum, and it visits every
 * linear-index entry in the file to do it — 301k of them on
 * test/data/failing_tabix.vcf.gz.tbi against 19k bin chunks. Building a
 * VirtualOffset per entry to compare and discard it is the bulk of that pass.
 */
export function minVirtualOffset(
  bytes: Uint8Array,
  offset: number,
  count: number,
  current: VirtualOffset | undefined,
) {
  let minBlock = current ? current.blockPosition : Infinity
  let minData = current ? current.dataPosition : 0
  let found = false
  for (let i = 0; i < count; i++) {
    const p = offset + i * 8
    const block =
      bytes[p + 7]! * 0x1_00_00_00_00_00 +
      bytes[p + 6]! * 0x1_00_00_00_00 +
      bytes[p + 5]! * 0x1_00_00_00 +
      bytes[p + 4]! * 0x1_00_00 +
      bytes[p + 3]! * 0x1_00 +
      bytes[p + 2]!
    const data = (bytes[p + 1]! << 8) | bytes[p]!
    if (block < minBlock || (block === minBlock && data < minData)) {
      minBlock = block
      minData = data
      found = true
    }
  }
  return found ? new VirtualOffset(minBlock, minData) : current
}

export function parseNameBytes(namesBytes: Uint8Array) {
  const decoder = new TextDecoder('utf-8')
  const refIdToName: string[] = []
  const refNameToId: Record<string, number> = {}
  let currRefId = 0
  let pos = 0
  while (pos < namesBytes.length) {
    const end = namesBytes.indexOf(0, pos)
    if (end === -1) {
      break
    }
    if (end > pos) {
      const refName = decoder.decode(namesBytes.subarray(pos, end))
      refIdToName[currRefId] = refName
      refNameToId[refName] = currRefId
    }
    pos = end + 1
    currRefId++
  }
  return { refNameToId, refIdToName }
}

const tabixFormats: Record<number, string> = {
  0: 'generic',
  1: 'SAM',
  2: 'VCF',
}

export function parseAuxData(bytes: Uint8Array, offset: number) {
  const dataView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  )
  const formatFlags = dataView.getInt32(offset, true)
  const coordinateType =
    formatFlags & 0x1_00_00 ? 'zero-based-half-open' : '1-based-closed'
  const format = tabixFormats[formatFlags & 0xf]
  if (!format) {
    throw new Error(`invalid Tabix preset format flags ${formatFlags}`)
  }
  const columnNumbers = {
    ref: dataView.getInt32(offset + 4, true),
    start: dataView.getInt32(offset + 8, true),
    end: dataView.getInt32(offset + 12, true),
  }
  const metaValue = dataView.getInt32(offset + 16, true)
  const metaChar = metaValue ? String.fromCharCode(metaValue) : undefined
  const skipLines = dataView.getInt32(offset + 20, true)
  const nameSectionLength = dataView.getInt32(offset + 24, true)
  const { refIdToName, refNameToId } = parseNameBytes(
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

export function parsePseudoBin(bytes: Uint8Array, offset: number) {
  return { lineCount: longFromBytesToUnsigned(bytes, offset) }
}

// SYNC: ~/src/gmod/bam-js/src/indexFile.ts memoizeByRefId
export function memoizeByRefId<T>(
  getIndices: (refId: number) => T | undefined,
  maxSize = 5,
): (refId: number) => T | undefined {
  const lru = new LRU<number, T>({ maxSize })
  return (refId: number) => {
    const cached = lru.get(refId)
    if (cached !== undefined) {
      return cached
    }
    const result = getIndices(refId)
    if (result !== undefined) {
      lru.set(refId, result)
    }
    return result
  }
}
