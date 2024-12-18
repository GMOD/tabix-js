import Chunk from './chunk'
import VirtualOffset from './virtualOffset'

class AbortError extends Error {
  public code: string | undefined
}
/**
 * Properly check if the given AbortSignal is aborted. Per the standard, if the
 * signal reads as aborted, this function throws either a DOMException
 * AbortError, or a regular error with a `code` attribute set to `ERR_ABORTED`.
 *
 * For convenience, passing `undefined` is a no-op
 *
 * @param {AbortSignal} [signal] an AbortSignal, or anything with an `aborted`
 * attribute
 *
 * @returns nothing
 */
export function checkAbortSignal(signal?: AbortSignal) {
  if (!signal) {
    return
  }

  if (signal.aborted) {
    if (typeof DOMException !== 'undefined') {
      throw new DOMException('aborted', 'AbortError')
    } else {
      const e = new AbortError('aborted')
      e.code = 'ERR_ABORTED'
      throw e
    }
  }
}

/**
 * Skips to the next tick, then runs `checkAbortSignal`.
 * Await this to inside an otherwise synchronous loop to
 * provide a place to break when an abort signal is received.
 * @param {AbortSignal} signal
 */
export async function abortBreakPoint(signal?: AbortSignal) {
  await Promise.resolve()
  checkAbortSignal(signal)
}

export function canMergeBlocks(chunk1: Chunk, chunk2: Chunk) {
  return (
    chunk2.minv.blockPosition - chunk1.maxv.blockPosition < 65000 &&
    chunk2.maxv.blockPosition - chunk1.minv.blockPosition < 5000000
  )
}

export function optimizeChunks(chunks: Chunk[], lowest?: VirtualOffset) {
  const mergedChunks: Chunk[] = []
  let lastChunk: Chunk | null = null

  if (chunks.length === 0) {
    return chunks
  }

  chunks.sort(function (c0, c1) {
    const dif = c0.minv.blockPosition - c1.minv.blockPosition
    return dif !== 0 ? dif : c0.minv.dataPosition - c1.minv.dataPosition
  })

  chunks.forEach(chunk => {
    if (!lowest || chunk.maxv.compareTo(lowest) > 0) {
      if (lastChunk === null) {
        mergedChunks.push(chunk)
        lastChunk = chunk
      } else {
        if (canMergeBlocks(lastChunk, chunk)) {
          if (chunk.maxv.compareTo(lastChunk.maxv) > 0) {
            lastChunk.maxv = chunk.maxv
          }
        } else {
          mergedChunks.push(chunk)
          lastChunk = chunk
        }
      }
    }
  })

  return mergedChunks
}
