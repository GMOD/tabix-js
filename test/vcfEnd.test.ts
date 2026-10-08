import { execFileSync } from 'child_process'

import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'

const path = require.resolve('./data/sv_svlen.vcf.gz')

async function ids(start: number, end: number) {
  const f = new TabixIndexedFile({ path })
  const out: string[] = []
  await f.getLines('chr1', start, end, line => {
    out.push(line.split('\t')[2]!)
  })
  return out
}

test('a <DEL> with SVLEN and no END spans its SVLEN', async () => {
  expect(await ids(3000, 4000)).toEqual(['delsvlen'])
  expect(await ids(5999, 6000)).toEqual([])
})

test('an END at or before POS is ignored', async () => {
  expect(await ids(1199, 1200)).toEqual(['delsvlen', 'insbadend'])
})

test('SVLEN is a reference length only for the alleles it spans', async () => {
  expect(await ids(11000, 12000)).toEqual([])
  expect(await ids(32000, 33000)).toEqual(['multi'])
  expect(await ids(51000, 52000)).toEqual(['dup'])
  expect(await ids(22000, 23000)).toEqual(['delend'])
})

function htslibIds(start: number, end: number) {
  try {
    return execFileSync('tabix', [path, `chr1:${start + 1}-${end}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean)
      .map(line => line.split('\t')[2]!)
  } catch {
    return undefined
  }
}

// htslib computes these spans since 1.22
test('every window agrees with the htslib tabix on PATH', async ctx => {
  if (htslibIds(3000, 4000)?.[0] !== 'delsvlen') {
    ctx.skip()
  }
  for (let start = 0; start < 60000; start += 999) {
    for (const width of [1, 3000]) {
      expect(await ids(start, start + width), `${start}+${width}`).toEqual(
        htslibIds(start, start + width),
      )
    }
  }
}, 60_000)
