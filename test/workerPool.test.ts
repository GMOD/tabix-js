import { gunzipSync } from 'zlib'

import { LocalFile } from 'generic-filehandle2'
import { expect, test, vi } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'

import type {
  BgzfBlockInfo,
  BgzfWorkerPool,
  PoolInput,
} from '@gmod/bgzf-filehandle'

// A stand-in for a real worker pool that inflates each block in process with
// node's zlib — a BGZF block is an ordinary gzip member, so this produces
// exactly what the workers would. It exists because vitest runs under node,
// where getSharedWorkerPool() returns undefined and the pooled branch of
// unzipChunkSlice would otherwise never be reached by any test here.
function fakePool() {
  return {
    decompressBlocks: vi.fn((input: PoolInput, blocks: BgzfBlockInfo[]) =>
      Promise.resolve({
        blocks: blocks.map(
          b =>
            new Uint8Array(
              gunzipSync(
                input.subarray(b.inputOffset, b.inputOffset + b.compressedSize),
              ),
            ),
        ),
      }),
    ),
    destroy: vi.fn(),
  } satisfies BgzfWorkerPool
}

// The same query chunkcache.test.ts uses for its multi-chunk case. It has to
// span more than one BGZF block per chunk or unzipChunkSlice declines the pool
// — one block is not worth a round trip — and the assertions below would then
// pass against the in-process path.
const [FILE, REF, START, END] = [
  'ncbi_human.sorted.gff.gz',
  'NC_000001.11',
  45e6,
  46e6,
] as const

function open(
  bgzfWorkerPool?: BgzfWorkerPool | Promise<BgzfWorkerPool | undefined>,
) {
  const dir = new URL('data/', import.meta.url).pathname
  return new TabixIndexedFile({
    filehandle: new LocalFile(`${dir}${FILE}`),
    tbiFilehandle: new LocalFile(`${dir}${FILE}.tbi`),
    bgzfWorkerPool,
  })
}

async function lines(f: TabixIndexedFile) {
  const out: string[] = []
  await f.getLines(REF, START, END, {
    lineCallback: line => {
      out.push(line)
    },
  })
  return out
}

test('a pooled read returns exactly what an in-process read does', async () => {
  const pool = fakePool()
  const [pooled, unpooled] = await Promise.all([
    lines(open(pool)),
    lines(open()),
  ])

  expect(pool.decompressBlocks).toHaveBeenCalled()
  expect(pooled.length).toBeGreaterThan(0)
  expect(pooled).toEqual(unpooled)
})

test('the pending promise getSharedWorkerPool returns is accepted', async () => {
  const pool = fakePool()
  // Not awaited before construction: a caller whose own construction is
  // synchronous hands the pending pool straight over, and it is awaited at the
  // point of use.
  const observed = await lines(open(Promise.resolve(pool)))

  expect(pool.decompressBlocks).toHaveBeenCalled()
  expect(observed).toEqual(await lines(open()))
})

test('a pool promise resolving to undefined keeps the in-process path', async () => {
  // What getSharedWorkerPool() gives back under node, or anywhere Workers
  // cannot be created — so passing it unconditionally has to be safe.
  const observed = await lines(open(Promise.resolve(undefined)))

  expect(observed).toEqual(await lines(open()))
})
