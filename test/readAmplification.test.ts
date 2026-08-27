import { LocalFile } from 'generic-filehandle2'
import { describe, expect, it, vi } from 'vitest'

import { TabixIndexedFile } from '../src/index.ts'

// Counts what a query actually pulls off disk, because over HTTP every one of
// these is a range request. The numbers here are the ones the README quotes.
class CountingFile extends LocalFile {
  reads: { position: number; length: number }[] = []

  override async read(length: number, position = 0) {
    const data = await super.read(length, position)
    this.reads.push({ position, length: data.length })
    return data
  }

  get bytes() {
    return this.reads.reduce((sum, r) => sum + r.length, 0)
  }
}

const BED = 'test/data/chr22_nanopore_subset.bed.gz'

function openFiles() {
  const data = new CountingFile(BED)
  const tbi = new CountingFile(`${BED}.tbi`)
  const readIndex = vi.spyOn(tbi, 'readFile')
  return {
    data,
    file: new TabixIndexedFile({ filehandle: data, tbiFilehandle: tbi }),
    readIndex,
    tbi,
  }
}

describe('what a query reads', () => {
  it('fetches the index whole, once, rather than as scattered reads of it', async () => {
    const { file, readIndex, tbi } = openFiles()
    let lines = 0
    const count = () => {
      lines++
    }
    await file.getLines('22', 16400000, 16410000, count)
    await file.getLines('22', 16500000, 16510000, count)

    expect(lines).toBeGreaterThan(0)
    expect(readIndex).toHaveBeenCalledTimes(1)
    expect(tbi.reads).toEqual([])
  })

  it('re-reads the same blocks as a window pans across them', async () => {
    const { data, file } = openFiles()
    await file.getHeader()
    data.reads = []

    const width = 20000
    let lines = 0
    for (let i = 0; i < 20; i++) {
      const start = 16400000 + (i * width) / 2
      await file.getLines('22', start, start + width, () => {
        lines++
      })
    }

    expect(lines).toBe(1065)
    expect(data.reads).toHaveLength(10)

    // the pan reads three times the whole file, which is the case for putting
    // a byte-range cache underneath
    expect(data.bytes).toBe(10987872)
    const { size } = await data.stat()
    expect(data.bytes).toBeGreaterThan(size * 3)
  })
})
