module.exports = {
  longToNumber(long) {
    if (
      long.greaterThan(Number.MAX_SAFE_INTEGER) ||
      long.lessThan(Number.MIN_SAFE_INTEGER)
    ) {
      throw new Error('integer overflow')
    }
    return long.toNumber()
  },

  /**
   * @ignore
   * properly check if the given AbortSignal is aborted.
   * per the standard, if the signal reads as aborted,
   * this function throws either a DOMException AbortError, or a regular error
   * with a `code` attribute set to `ERR_ABORTED`.
   *
   * for convenience, passing `undefined` is a no-op
   *
   * @param {AbortSignal} [signal]
   * @returns nothing
   */
  checkAbortSignal(signal) {
    if (!signal) return

    if (signal.aborted) {
      // console.warn('tabix operation aborted')
      if (typeof DOMException !== 'undefined') {
        // eslint-disable-next-line no-undef
        throw new DOMException('aborted', 'AbortError')
      } else {
        const e = new Error('aborted')
        e.code = 'ERR_ABORTED'
        throw e
      }
    }
  },

  canMergeBlocks(block1, block2) {
    return (
      block1.minv.blockPosition === block1.maxv.blockPosition &&
      block1.maxv.blockPosition === block2.minv.blockPosition &&
      block2.minv.blockPosition === block2.maxv.blockPosition
    )
  },
}
