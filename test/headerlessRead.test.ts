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

function open(path: string) {
  const data = new CountingFile(path)
  const index = path.endsWith('.csi') ? 'csi' : 'tbi'
  const dataPath = path.replace(/\.(tbi|csi)$/, '')
  const file = new TabixIndexedFile({
    filehandle: new CountingFile(dataPath),
    ...(index === 'csi' ? { csiFilehandle: data } : { tbiFilehandle: data }),
  })
  return { file, dataPath }
}

describe('the header of a file that opens on a data line', () => {
  it('is read without touching the file', async () => {
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
})

// The skip trusts the index's first data line. On every fixture it sits at
// 0:0 exactly when the file's first line is a data line.
const indexes = fs
  .readdirSync('test/data')
  .filter(f => /\.(tbi|csi)$/.test(f))
  .map(f => `test/data/${f}`)
  .filter(f => fs.existsSync(f.replace(/\.(tbi|csi)$/, '')))

describe.each(indexes)('%s', path => {
  it('puts the first data line at 0:0 only when the file opens on one', async () => {
    const { file, dataPath } = open(path)
    const { firstDataLine, metaChar, skipLines = 0 } = await file.getMetadata()
    const text = gunzipSync(fs.readFileSync(dataPath))
    const opensOnData =
      text.length > 0 &&
      skipLines === 0 &&
      String.fromCharCode(text[0]!) !== metaChar
    const atStart =
      firstDataLine?.blockPosition === 0 && firstDataLine.dataPosition === 0
    expect(atStart).toBe(opensOnData)
  })
})
