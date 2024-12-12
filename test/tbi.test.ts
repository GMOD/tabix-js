import { vi, expect, test } from 'vitest'
import { LocalFile } from 'generic-filehandle2'
import VirtualOffset from '../src/virtualOffset'
import TBI from '../src/tbi'

test('loads', async () => {
  const ti = new TBI({
    filehandle: new LocalFile(require.resolve('./data/volvox.test.vcf.gz.tbi')),
  })
  const indexData = await ti.parse()
  expect(indexData.columnNumbers.start).toEqual(2)
  expect(indexData.columnNumbers.ref).toEqual(1)
  expect(indexData.columnNumbers.end).toEqual(0)
  // console.log( ti );
  const blocks = await ti.blocksForRange('contigA', 1, 4000)
  expect(blocks.length).toEqual(1)
  expect(blocks[0].minv.blockPosition).toEqual(0)
  expect(blocks[0].minv.dataPosition).toEqual(10431)
  // console.log( blocks );

  const metadata = await ti.getMetadata()
  expect(metadata).toEqual({
    columnNumbers: { end: 0, ref: 1, start: 2 },
    coordinateType: '1-based-closed',
    format: 'VCF',
    metaChar: '#',
    maxBinNumber: 37449,
    firstDataLine: new VirtualOffset(0, 10431),
    refIdToName: ['contigA'],
    refNameToId: { contigA: 0 },
    maxBlockSize: 1 << 16,
    skipLines: 0,
    maxRefLength: 536870912,
  })
  console.warn = vi.fn()
  expect(await ti.blocksForRange('contigA', 7334998796, 8104229566)).toEqual([])
  expect(console.warn).toHaveBeenCalledWith(
    'querying outside of possible tabix range',
  )
})
test('failing tabix', async () => {
  const ti = new TBI({
    filehandle: new LocalFile(
      require.resolve('./data/failing_tabix.vcf.gz.tbi'),
    ),
  })

  await expect(ti.parse()).rejects.toThrow(/too many bins/)
})
