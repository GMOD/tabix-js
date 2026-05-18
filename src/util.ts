import LRU from '@jbrowse/quick-lru'

import Chunk from './chunk.ts'
import { longFromBytesToUnsigned } from './long.ts'

import type VirtualOffset from './virtualOffset.ts'

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
        )
        lastMaxBlock = chunkMaxBlock
      }
    } else {
      mergedChunks.push(chunk)
      lastMinBlock = chunkMinBlock
      lastMaxBlock = chunkMaxBlock
    }
  }

  return mergedChunks
}

export function findFirstData(
  currentFdl: VirtualOffset | undefined,
  virtualOffset: VirtualOffset,
) {
  return !currentFdl || currentFdl.compareTo(virtualOffset) > 0
    ? virtualOffset
    : currentFdl
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
  const dataView = new DataView(bytes.buffer)
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
