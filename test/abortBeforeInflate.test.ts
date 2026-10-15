import { unzipChunkSlice } from '@gmod/bgzf-filehandle'
import { LocalFile } from 'generic-filehandle2'
import { expect, test, vi } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'

import type * as Bgzf from '@gmod/bgzf-filehandle'

vi.mock('@gmod/bgzf-filehandle', async importOriginal => {
  const mod = await importOriginal<typeof Bgzf>()
  return { ...mod, unzipChunkSlice: vi.fn(mod.unzipChunkSlice) }
})

// SYNC: ~/src/gmod/bam-js/test/cache.test.ts "an abandoned chunk is not
// inflated or decoded"
test('a chunk every waiter abandoned is not inflated', async () => {
  const dir = new URL('data/', import.meta.url).pathname
  const filehandle = new LocalFile(`${dir}chr22_nanopore_subset.bed.gz`)
  const f = new TabixIndexedFile({
    filehandle,
    tbiFilehandle: new LocalFile(`${dir}chr22_nanopore_subset.bed.gz.tbi`),
  })
  await f.getHeader()

  let reading!: () => void
  const firstRead = new Promise<void>(resolve => {
    reading = resolve
  })
  let release!: () => void
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  let readDone!: () => void
  const delivered = new Promise<void>(resolve => {
    readDone = resolve
  })
  const innerRead = filehandle.read.bind(filehandle)
  filehandle.read = async (length: number, position: number) => {
    reading()
    await released
    const bytes = await innerRead(length, position)
    readDone()
    return bytes
  }

  const a = new AbortController()
  const b = new AbortController()
  const lines = (signal: AbortSignal) =>
    f.getLines('22', 16e6, 16.02e6, {
      lineCallback: () => undefined,
      signal,
    })
  const pa = lines(a.signal)
  const pb = lines(b.signal)
  void Promise.allSettled([pa, pb])
  await firstRead

  // both callers give up while the read is in flight, so the shared signal
  // fires, but the filehandle ignores it and hands the bytes over anyway
  a.abort()
  b.abort()
  vi.mocked(unzipChunkSlice).mockClear()
  release()
  await expect(pa).rejects.toThrow(/abort/i)
  await expect(pb).rejects.toThrow(/abort/i)
  await delivered
  await new Promise(resolve => setTimeout(resolve, 0))

  expect(unzipChunkSlice).not.toHaveBeenCalled()
})
