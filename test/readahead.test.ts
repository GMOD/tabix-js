import { LocalFile } from 'generic-filehandle2'
import { expect, test, vi } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'
import { optimizeChunks } from '../src/util.ts'

import type IndexFile from '../src/indexFile.ts'

// counts range requests, and makes each one settle a tick late so a read-ahead
// window has to be genuinely concurrent to overlap with anything
class CountingFile extends LocalFile {
  public reads = 0
  public concurrent = 0
  public maxConcurrent = 0
  override async read(length: number, position?: number) {
    this.reads++
    this.concurrent++
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent)
    try {
      await new Promise(r => setTimeout(r, 1))
      return await super.read(length, position)
    } finally {
      this.concurrent--
    }
  }
}

function open(file: string) {
  const dir = new URL('data/', import.meta.url).pathname
  const filehandle = new CountingFile(`${dir}${file}`)
  return {
    filehandle,
    f: new TabixIndexedFile({
      filehandle,
      tbiFilehandle: new LocalFile(`${dir}${file}.tbi`),
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

// The scan can stop inside the first chunk it is offered, and reading ahead
// must not turn the chunks after it into range requests. max_off now drops
// those before the scan sees them, so this offers them anyway: all of bin 88,
// which is what blocksForRange returned for this window before it.
test('a query that stops in its first chunk reads only that chunk', async () => {
  const { f, filehandle } = open('chr22_nanopore_subset.bed.gz')
  // @ts-expect-error reaching into the index to offer it chunks
  const index: IndexFile = f.index
  const { refNameToId, indices } = await index.parse()
  const offered = optimizeChunks(indices(refNameToId['22']!)!.binIndex[88]!)
  expect(offered).toHaveLength(7)
  vi.spyOn(index, 'blocksForRange').mockResolvedValue(offered)
  await count(f, '22', 16e6, 16.02e6)
  expect(filehandle.reads).toBe(1)
})

// the other direction: a scan that consumes chunk after chunk should widen its
// window and have several reads in flight at once
test('a query that consumes many chunks overlaps their reads', async () => {
  const { f, filehandle } = open('ncbi_human.sorted.gff.gz')
  const lines = await count(f, 'NC_000001.11', 45e6, 46e6)
  expect(lines).toBe(2785)
  // five chunks hold the query, and max_off leaves none past it to overshoot
  // into
  expect(filehandle.reads).toBe(5)
  expect(filehandle.maxConcurrent).toBeGreaterThan(1)
})
