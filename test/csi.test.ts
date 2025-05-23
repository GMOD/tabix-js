import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import CSI from '../src/csi'
import VirtualOffset from '../src/virtualOffset'

test('loads test.gff3.gz.csi', async () => {
  const ti = new CSI({
    filehandle: new LocalFile(require.resolve('./data/test.gff3.gz.csi')),
  })
  const indexData = await ti.parse()
  expect(indexData.columnNumbers.start).toEqual(4)
  expect(indexData.columnNumbers.ref).toEqual(1)
  expect(indexData.columnNumbers.end).toEqual(5)
  // console.log( ti );
  let blocks = await ti.blocksForRange('1', 1, 4000)
  expect(blocks.length).toEqual(0)
  blocks = await ti.blocksForRange('1', 0, 2000046092)
  expect(blocks.length).toEqual(1)
  expect(blocks[0].minv.blockPosition).toEqual(0)
  expect(blocks[0].minv.dataPosition).toEqual(130)
  // console.log( blocks );

  const metadata = await ti.getMetadata()
  expect(metadata).toEqual({
    columnNumbers: { end: 5, ref: 1, start: 4 },
    csi: true,
    csiVersion: 1,
    depth: 6,
    refCount: 2,
    coordinateType: '1-based-closed',
    format: 'generic',
    firstDataLine: new VirtualOffset(0, 130),
    metaChar: '#',
    refIdToName: ['1', 'ctgB'],
    refNameToId: { 1: 0, ctgB: 1 },
    skipLines: 0,
    maxBlockSize: 1 << 16,
    maxBinNumber: 299593,
    maxRefLength: 4294967296,
  })
})
test('loads test.vcf.gz.csi', async () => {
  const ti = new CSI({
    filehandle: new LocalFile(require.resolve('./data/test.vcf.gz.csi')),
  })
  const indexData = await ti.parse()
  expect(indexData.columnNumbers.start).toEqual(2)
  expect(indexData.columnNumbers.ref).toEqual(1)
  expect(indexData.columnNumbers.end).toEqual(0)
  // console.log( ti );
  let blocks = await ti.blocksForRange('1', 1, 4000)
  expect(blocks.length).toEqual(0)
  blocks = await ti.blocksForRange('1', 0, 2000046092)
  expect(blocks.length).toEqual(1)
  expect(blocks[0].minv.blockPosition).toEqual(0)
  expect(blocks[0].minv.dataPosition).toEqual(2560)
  // console.log( blocks );

  expect(await ti.lineCount('1')).toEqual(37)

  const metadata = await ti.getMetadata()
  expect(metadata).toEqual({
    csi: true,
    csiVersion: 1,
    depth: 6,
    refCount: 1,
    columnNumbers: { end: 0, ref: 1, start: 2 },
    coordinateType: '1-based-closed',
    format: 'VCF',
    metaChar: '#',
    firstDataLine: new VirtualOffset(0, 2560),
    refIdToName: ['1'],
    refNameToId: { 1: 0 },
    maxBlockSize: 1 << 16,
    skipLines: 0,
    maxBinNumber: 299593,
    maxRefLength: 4294967296,
  })
})
