import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'

class CountingFile extends LocalFile {
  public reads = 0
  override async read(length: number, position?: number) {
    this.reads++
    return super.read(length, position)
  }
}

function open(file: string, chunkCacheSize?: number) {
  const dir = new URL('data/', import.meta.url).pathname
  const filehandle = new CountingFile(`${dir}${file}`)
  return {
    filehandle,
    f: new TabixIndexedFile({
      filehandle,
      tbiFilehandle: new LocalFile(`${dir}${file}.tbi`),
      chunkCacheSize,
    }),
  }
}

async function count(f: TabixIndexedFile, ref: string, s: number, e: number) {
  let lines = 0
  await f.getLines(ref, s, e, {
    lineCallback: () => {
      lines++
    },
  })
  return lines
}

const MANY_CHUNKS = ['ncbi_human.sorted.gff.gz', 'NC_000001.11', 45e6, 46e6] as const
const ONE_CHUNK = ['chr22_nanopore_subset.bed.gz', '22', 16e6, 16.02e6] as const

test('a budget that fits the query caches every chunk it read', async () => {
  const [file, ref, s, e] = MANY_CHUNKS
  const { f, filehandle } = open(file, 50 * 2 ** 20)
  expect(await count(f, ref, s, e)).toBe(2785)
  const first = filehandle.reads
  expect(await count(f, ref, s, e)).toBe(2785)
  expect(filehandle.reads).toBe(first)
})

// The point of budgeting by decompressed bytes. This query is 8 chunks holding
// 3.69MB decompressed, so a 2MB budget has to evict — where the old
// count-based LRU read the same number as "2MB / 64KB = 32 entries" and cached
// all 8, using 3.69MB against a budget it believed was 2MB.
test('a budget smaller than the query evicts and forces a re-read', async () => {
  const [file, ref, s, e] = MANY_CHUNKS
  const { f, filehandle } = open(file, 2 * 2 ** 20)
  expect(await count(f, ref, s, e)).toBe(2785)
  const first = filehandle.reads
  expect(await count(f, ref, s, e)).toBe(2785)
  expect(filehandle.reads).toBeGreaterThan(first)
})

// the size > 1 guard: one chunk over budget is still worth keeping, since
// dropping it only buys a re-download the caller immediately pays for
test('a single chunk larger than the whole budget is still cached', async () => {
  const [file, ref, s, e] = ONE_CHUNK
  const { f, filehandle } = open(file, 1)
  await count(f, ref, s, e)
  expect(filehandle.reads).toBe(1)
  await count(f, ref, s, e)
  expect(filehandle.reads).toBe(1)
})
