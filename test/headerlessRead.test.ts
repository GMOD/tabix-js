import fs from 'node:fs'
import { gunzipSync } from 'node:zlib'

import { LocalFile } from 'generic-filehandle2'
import { describe, expect, it } from 'vitest'

import { TabixIndexedFile } from '../src/index.ts'

class CountingFile extends LocalFile {
  reads = 0

  override async read(length: number, position = 0) {
    this.reads++
    return super.read(length, position)
  }
}

function firstBlock(path: string) {
  const fd = fs.openSync(path, 'r')
  try {
    const head = Buffer.alloc(18)
    fs.readSync(fd, head, 0, 18, 0)
    const block = Buffer.alloc(head.readUInt16LE(16) + 1)
    fs.readSync(fd, block, 0, block.length, 0)
    return gunzipSync(block)
  } finally {
    fs.closeSync(fd)
  }
}

describe('getHeader', () => {
  it('reads nothing of a file that opens on a data line', async () => {
    const data = new CountingFile('test/data/chr22_nanopore_subset.bed.gz')
    const file = new TabixIndexedFile({
      filehandle: data,
      tbiPath: 'test/data/chr22_nanopore_subset.bed.gz.tbi',
    })
    expect(await file.getHeader()).toBe('')
    expect(await file.getHeaderLines()).toEqual([])
    expect(data.reads).toBe(0)
  })

  it('still reads a header that is there', async () => {
    const data = new CountingFile('test/data/out.bed.gz')
    const file = new TabixIndexedFile({
      filehandle: data,
      tbiPath: 'test/data/out.bed.gz.tbi',
    })
    expect(await file.getHeader()).toMatch(/^#/)
    expect(data.reads).toBeGreaterThan(0)
  })

  // standalone tabix 0.2.5 leaves a contig's index windows before its first
  // record at 0, so its linear index reads 0:0 under this file's header
  it('keeps the header of a file standalone tabix 0.2 indexed', async () => {
    const file = new TabixIndexedFile({ path: 'test/data/tabix_0.2.5.vcf.gz' })
    expect(await file.getHeader()).toMatch(/#CHROM\tPOS.*sampleB\n$/)
  })
})

// The header skip trusts the index's first data line, so check it against
// every indexed fixture: 0:0 exactly when the file's first line is data.
const indexes = fs
  .readdirSync('test/data')
  .filter(f => /\.(tbi|csi)$/.test(f))
  .map(f => `test/data/${f}`)
  .filter(f => fs.existsSync(f.replace(/\.(tbi|csi)$/, '')))

describe.each(indexes)('%s', index => {
  it('puts the first data line at 0:0 only when the file opens on one', async () => {
    const path = index.replace(/\.(tbi|csi)$/, '')
    const file = new TabixIndexedFile({
      path,
      ...(index.endsWith('.csi') ? { csiPath: index } : { tbiPath: index }),
    })
    const { firstDataLine, metaChar, skipLines = 0 } = await file.getMetadata()
    const text = firstBlock(path)
    const opensOnData =
      text.length > 0 &&
      skipLines === 0 &&
      String.fromCharCode(text[0]!) !== metaChar
    const atStart =
      firstDataLine?.blockPosition === 0 && firstDataLine.dataPosition === 0
    expect(atStart).toBe(opensOnData)
  })
})
