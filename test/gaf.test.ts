import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'

function open(name: string, index: 'tbi' | 'csi' = 'tbi') {
  const path = new URL(`data/${name}`, import.meta.url).pathname
  return index === 'csi'
    ? new TabixIndexedFile({ path, csiPath: `${path}.csi` })
    : new TabixIndexedFile({ path })
}

async function query(
  f: TabixIndexedFile,
  start: number,
  end: number,
  refName = 'anything',
) {
  const reads: { name: string; path: string; start: number; end: number }[] = []
  await f.getLines(refName, start, end, (line, _offset, s, e) => {
    const cols = line.split('\t')
    reads.push({ name: cols[0]!, path: cols[5]!, start: s, end: e })
  })
  return reads
}

test.each(['tbi', 'csi'] as const)(
  'reads GAF metadata from a %s index',
  async index => {
    const f = open('cactus_shifted.gaf.gz', index)
    const metadata = await f.getMetadata()
    expect(metadata.format).toBe('GAF')
    expect(metadata.columnNumbers).toEqual({ ref: 1, start: 6, end: 0 })
    expect(metadata.metaChar).toBe('#')
    expect(await f.getReferenceSequenceNames()).toEqual([])
  },
)

test('ignores the reference name', async () => {
  const f = open('cactus_sample.gaf.gz')
  expect(await f.lineCount('chr1')).toBe(341)
  expect(await f.lineCount('')).toBe(341)
  const a = await query(f, 180, 220, 'chr1')
  const b = await query(f, 180, 220, '{node}')
  expect(a.length).toBeGreaterThan(0)
  expect(b).toEqual(a)
})

test('a read spans its lowest to its highest node, inclusive', async () => {
  const f = open('cactus_sample.gaf.gz')
  const read = { path: '<189<188<186', start: 186, end: 190 }
  for (const [s, e] of [
    [186, 187],
    [187, 188],
    [189, 190],
  ] as const) {
    expect(await query(f, s, e)).toContainEqual(expect.objectContaining(read))
  }
  expect(await query(f, 190, 191)).not.toContainEqual(
    expect.objectContaining(read),
  )
  expect(await query(f, 185, 186)).not.toContainEqual(
    expect.objectContaining(read),
  )
})

test('a single-node read is returned by a query covering that node', async () => {
  const f = open('cactus_sample.gaf.gz')
  expect(await query(f, 200, 201)).toEqual([
    {
      name: 'ERR194148.651236041/1',
      path: '<200',
      start: 200,
      end: 201,
    },
  ])
  expect(await query(f, 199, 200)).not.toContainEqual(
    expect.objectContaining({ path: '<200' }),
  )
})

// htslib indexes a single-node read as the empty [n, n), so on a bin edge it
// lands in a coarser bin and sets no linear-index entry for n
test.each(['tbi', 'csi'] as const)(
  'finds a single-node read on a bin edge through a %s index',
  async index => {
    const f = open('cactus_shifted.gaf.gz', index)
    expect(await query(f, 131_072, 131_073)).toEqual([
      {
        name: 'ERR194148.651236651/1',
        path: '<131072',
        start: 131_072,
        end: 131_073,
      },
    ])
  },
)

test('reads the whole file in order', async () => {
  const f = open('cactus_shifted.gaf.gz')
  const reads = await query(f, 0, 1_000_000)
  expect(reads.length).toBe(await f.lineCount('x'))
  for (let i = 1; i < reads.length; i++) {
    expect(reads[i]!.start).toBeGreaterThanOrEqual(reads[i - 1]!.start)
  }
})

test('skips a path that is a stable sequence name', async () => {
  const f = open('stable_name.gaf.gz')
  // htslib counts it, and returns it for any query touching nodes 0..38
  expect(await f.lineCount('x')).toBe(21)
  const reads = await query(f, 0, 1_000_000)
  expect(reads.length).toBe(20)
  expect(reads.map(r => r.name)).not.toContain('stable_name_read')
})
