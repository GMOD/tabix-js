import Chunk from './chunk.ts'

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
