import { expect, test } from 'vitest'

import Chunk from '../src/chunk.ts'
import { maxOffset } from '../src/indexFile.ts'
import VirtualOffset from '../src/virtualOffset.ts'

function chunkAt(blockPosition: number, bin: number) {
  return new Chunk(
    new VirtualOffset(blockPosition, 0),
    new VirtualOffset(blockPosition + 1, 0),
    bin,
  )
}

// minShift 4 and depth 1 or 2 keep the bin numbers small: at depth 1 the leaves
// are bins 1-8, 16bp each; at depth 2 they are 9-72 under parents 1-8.
test('maxOffset takes the lowest chunk of the first bin right of the query', () => {
  // end 20 is in leaf 2; leaf 3 is absent, so leaf 4 answers
  expect(
    maxOffset({ 4: [chunkAt(50, 4), chunkAt(40, 4)] }, 20, 4, 1),
  ).toMatchObject({ blockPosition: 40 })
  // leaf 17 is the first child of bin 2, so the walk steps up to bin 2 before
  // looking at any of its children
  expect(
    maxOffset({ 2: [chunkAt(70, 2)], 18: [chunkAt(60, 18)] }, 120, 4, 2),
  ).toMatchObject({ blockPosition: 70 })
})

test('maxOffset has no answer with nothing right of the query', () => {
  expect(maxOffset({ 1: [chunkAt(10, 1)] }, 20, 4, 1)).toBeUndefined()
  // the last leaf, whose right neighbour would be past the scheme
  expect(maxOffset({ 1: [chunkAt(10, 1)] }, 128, 4, 1)).toBeUndefined()
  expect(maxOffset({ 8: [chunkAt(10, 8)] }, 200, 4, 1)).toBeUndefined()
})
