import { expect, test } from 'vitest'

import Chunk from '../src/chunk.ts'
import TabixIndexedFile from '../src/tabixIndexedFile.ts'
import { clampChunkEnds } from '../src/util.ts'
import VirtualOffset from '../src/virtualOffset.ts'

const block = 1 << 16

test('clamps tail to next known block boundary', () => {
  // two chunks whose blocks are adjacent: the second chunk's minv is the next
  // boundary after the first chunk's maxv, so the first chunk's end is clamped
  const c1 = new Chunk(new VirtualOffset(0, 0), new VirtualOffset(1000, 0), 0)
  const c2 = new Chunk(new VirtualOffset(2000, 0), new VirtualOffset(5000, 0), 1)
  expect(c1.fetchedSize()).toEqual(1000 + block)

  clampChunkEnds([c1, c2])

  // c1.maxv=1000, next boundary > 1000 is c2.minv=2000 → end clamped to 2000
  expect(c1.endPosition).toEqual(2000)
  expect(c1.fetchedSize()).toEqual(2000)
  // c2 has no boundary beyond its maxv (5000) → keeps full-block padding
  expect(c2.endPosition).toEqual(5000 + block)
})

test('never clamps below the true block end (no nearby boundary)', () => {
  // next boundary is more than a max block away → padding cap retained
  const c1 = new Chunk(new VirtualOffset(0, 0), new VirtualOffset(0, 0), 0)
  const c2 = new Chunk(
    new VirtualOffset(block * 5, 0),
    new VirtualOffset(block * 5, 0),
    1,
  )
  clampChunkEnds([c1, c2])
  expect(c1.endPosition).toEqual(block) // 0 + 65536, unchanged
})

test('extra (linear-index) boundaries tighten the estimate', () => {
  const c = new Chunk(new VirtualOffset(0, 0), new VirtualOffset(100, 0), 0)
  clampChunkEnds([c], [500, 300, 50])
  // smallest extra boundary > 100 is 300
  expect(c.endPosition).toEqual(300)
})

test('clamped estimate still fetches correct lines', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/ncbi_human.sorted.gff.gz', import.meta.url).pathname,
    tbiPath: new URL('data/ncbi_human.sorted.gff.gz.tbi', import.meta.url)
      .pathname,
  })
  let n = 0
  await f.getLines('NC_000001.11', 0, 1_000_000, () => {
    n++
  })
  expect(n).toEqual(1209)

  const est = await f.bytesForRegions([
    { refName: 'NC_000001.11', start: 0, end: 1_000_000 },
  ])
  // clamped estimate is well under the naive 7-chunk * 64KB worst case
  expect(est).toBeLessThan(7 * block)
})
