import { LocalFile } from 'generic-filehandle2'
import { expect, test, vi } from 'vitest'

import TBI from '../src/tbi.ts'
import VirtualOffset from '../src/virtualOffset.ts'

test('loads', async () => {
  const ti = new TBI({
    filehandle: new LocalFile(
      new URL('data/volvox.test.vcf.gz.tbi', import.meta.url).pathname,
    ),
  })
  const indexData = await ti.parse()
  expect(indexData.columnNumbers.start).toEqual(2)
  expect(indexData.columnNumbers.ref).toEqual(1)
  expect(indexData.columnNumbers.end).toEqual(0)
  // console.log( ti );
  const blocks = await ti.blocksForRange('contigA', 1, 4000)
  expect(blocks.length).toEqual(1)
  expect(blocks[0].minv.blockPosition).toEqual(0)
  expect(blocks[0].minv.dataPosition).toEqual(10_431)
  // console.log( blocks );

  const metadata = await ti.getMetadata()
  expect(metadata).toEqual({
    columnNumbers: { end: 0, ref: 1, start: 2 },
    coordinateType: '1-based-closed',
    format: 'VCF',
    metaChar: '#',
    maxBinNumber: 37_449,
    firstDataLine: new VirtualOffset(0, 10_431),
    refIdToName: ['contigA'],
    refNameToId: { contigA: 0 },
    maxBlockSize: 1 << 16,
    skipLines: 0,
    maxRefLength: 536_870_912,
  })
  console.warn = vi.fn()
  expect(
    await ti.blocksForRange('contigA', 7_334_998_796, 8_104_229_566),
  ).toEqual([])
  expect(console.warn).toHaveBeenCalledWith(
    'querying outside of possible tabix range',
  )
})
test('failing tabix', async () => {
  const ti = new TBI({
    filehandle: new LocalFile(
      new URL('data/failing_tabix.vcf.gz.tbi', import.meta.url).pathname,
    ),
  })

  await expect(ti.parse()).rejects.toThrow(/too many bins/)
})
