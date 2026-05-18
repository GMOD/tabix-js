import LRU from '@jbrowse/quick-lru'

import Chunk from './chunk.ts'
import { longFromBytesToUnsigned } from './long.ts'

import type VirtualOffset from './virtualOffset.ts'

export function canMergeBlocks(chunk1: Chunk, chunk2: Chunk) {
  return (
    chunk2.minv.blockPosition - chunk1.maxv.blockPosition < 65_000 &&
    chunk2.maxv.blockPosition - chunk1.minv.blockPosition < 5_000_000
  )
}

export function optimizeChunks(chunks: Chunk[], lowest?: VirtualOffset) {
  if (chunks.length === 0) {
    return chunks
  }

  chunks.sort(function (c0, c1) {
    const dif = c0.minv.blockPosition - c1.minv.blockPosition
    return dif === 0 ? c0.minv.dataPosition - c1.minv.dataPosition : dif
  })

  const mergedChunks: Chunk[] = []
  let lastChunk: Chunk | undefined

  for (const chunk of chunks) {
    if (!lowest || chunk.maxv.compareTo(lowest) > 0) {
      if (lastChunk && canMergeBlocks(lastChunk, chunk)) {
        if (chunk.maxv.compareTo(lastChunk.maxv) > 0) {
          // produce a new merged Chunk rather than mutating, so callers can
          // safely pass cached Chunk objects without risk of corruption
          lastChunk = new Chunk(lastChunk.minv, chunk.maxv, lastChunk.bin)
          mergedChunks[mergedChunks.length - 1] = lastChunk
        }
      } else {
        mergedChunks.push(chunk)
        lastChunk = chunk
      }
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
