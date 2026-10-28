import fs from 'node:fs'
import { gunzipSync } from 'node:zlib'

import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'
import TBI from '../src/tbi.ts'

// ~1Mb of chr1 in five BGZF blocks, indexed by `tabix -p bed`. htslib folds
// every bin under 64KB into its parent, so one 1Mb bin and one chunk hold the
// whole file, and without the clamp every query reads it from the first record.
const path = new URL('data/folded_bins.bed.gz', import.meta.url).pathname

function overlapping(start: number, end: number) {
  return gunzipSync(fs.readFileSync(path))
    .toString()
    .split('\n')
    .filter(line => {
      const [, s, e] = line.split('\t')
      return line !== '' && Number(s) < end && Number(e) > start
    })
}

test.each([
  [0, 1000],
  [130_000, 140_000],
  [524_288, 524_290],
  [600_000, 610_000],
  [655_359, 655_361],
  [1_000_000, 1_048_576],
])(
  'a query clamped to its 128kb window returns every line overlapping [%i, %i)',
  async (start, end) => {
    const f = new TabixIndexedFile({ path, tbiPath: `${path}.tbi` })
    const lines: string[] = []
    await f.getLines('chr1', start, end, line => {
      lines.push(line)
    })
    expect(lines.length).toBeGreaterThan(0)
    expect(lines).toEqual(overlapping(start, end))
  },
)

test('the clamp starts the fetch at the 128kb floor, and holds across that window', async () => {
  const tbi = new TBI({ filehandle: new LocalFile(`${path}.tbi`) })
  const { binIndex, linearIndex } = (await tbi.parse()).indices(0)!
  const [whole, ...rest] = Object.values(binIndex).flat()
  expect(rest).toEqual([])

  const a = await tbi.blocksForRange('chr1', 600_000, 610_000)
  const b = await tbi.blocksForRange('chr1', 640_000, 650_000)
  expect(a[0]!.minv).toEqual(linearIndex![(600_000 >> 17) << 3])
  expect(a[0]!.minv.blockPosition).toBeGreaterThan(whole!.minv.blockPosition)
  expect(a[0]!.fetchedSize()).toBeLessThan(whole!.fetchedSize())
  expect(b.map(String)).toEqual(a.map(String))
})
