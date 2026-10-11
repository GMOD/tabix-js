import fs from 'node:fs'
import { gunzipSync, gzipSync } from 'node:zlib'

import { BlobFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import { TabixIndexedFile } from '../src/index.ts'

// test.vcf.gz.csi with its aux block cut out, which is the shape of an index
// samtools or bcftools writes for a BAM or BCF
function csiWithoutAux() {
  const bytes = gunzipSync(fs.readFileSync('test/data/test.vcf.gz.csi'))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const auxLength = view.getInt32(12, true)
  const out = new Uint8Array(bytes.length - auxLength)
  out.set(bytes.subarray(0, 16))
  out.set(bytes.subarray(16 + auxLength), 16)
  new DataView(out.buffer).setInt32(12, 0, true)
  return new BlobFile(new Blob([gzipSync(out)]))
}

test('a CSI with no tabix header is rejected', async () => {
  const file = new TabixIndexedFile({
    path: 'test/data/test.vcf.gz',
    csiFilehandle: csiWithoutAux(),
  })
  const lines: string[] = []
  await expect(
    file.getLines('ctgA', 0, 1000, line => lines.push(line)),
  ).rejects.toThrow(/no tabix header/)
  expect(lines).toEqual([])
})
