import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'

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

// blocksForRange offers a chunk per overlapping bin across every level, and on
// a sparse file the scan stops inside the first one. Reading ahead must not
// turn those untouched chunks into range requests.
test('a query that stops in its first chunk reads only that chunk', async () => {
  const { f, filehandle } = open('chr22_nanopore_subset.bed.gz')
  // @ts-expect-error reaching into the index to see what was on offer
  const chunks = await f.index.blocksForRange('22', 16e6, 16.02e6, {})
  expect(chunks.length).toBe(7)
  await count(f, '22', 16e6, 16.02e6)
  expect(filehandle.reads).toBe(1)
})

// the other direction: a scan that consumes chunk after chunk should widen its
// window and have several reads in flight at once
test('a query that consumes many chunks overlaps their reads', async () => {
  const { f, filehandle } = open('ncbi_human.sorted.gff.gz')
  const lines = await count(f, 'NC_000001.11', 45e6, 46e6)
  expect(lines).toBe(2785)
  // five chunks hold the query; the window overshoots by the three it had
  // speculatively started when the scan ended
  expect(filehandle.reads).toBe(8)
  expect(filehandle.maxConcurrent).toBeGreaterThan(1)
})
