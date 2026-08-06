// Differential test against the htslib `tabix` CLI, over every indexed file in
// test/data: headers, then randomized region queries. Catches the class of bug
// the unit tests miss, where our answer is self-consistent but not htslib's.
//
// Run with `pnpm differential` (needs tabix on PATH).
import { execFileSync } from 'child_process'
import { readdirSync } from 'fs'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'

const dir = new URL('../test/data/', import.meta.url).pathname

// files with no data file, or a fixture that is meant to throw
const SKIP = new Set([
  'failing_tabix.vcf.gz',
  'volvox.sort.bed.gz',
  'volvox.sort.gff3.gz',
])

// deterministic LCG, so a failing query is reproducible
let seed = 42
const rand = () =>
  (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

function open(idx, chunkCacheSize) {
  const base = idx.replace(/\.(tbi|csi)$/, '')
  const path = `${dir}${base}`
  return idx.endsWith('.csi')
    ? new TabixIndexedFile({ path, csiPath: `${dir}${idx}`, chunkCacheSize })
    : new TabixIndexedFile({ path, tbiPath: `${dir}${idx}`, chunkCacheSize })
}

function htslib(args) {
  try {
    return execFileSync('tabix', args, {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return undefined
  }
}

const indexes = readdirSync(dir)
  .filter(f => /\.(tbi|csi)$/.test(f))
  .filter(f => !SKIP.has(f.replace(/\.(tbi|csi)$/, '')))
  .sort()

let bad = 0

// firstDataLine sizes the header read, so a bad minimum shows up as truncation
let headers = 0
for (const idx of indexes) {
  const base = idx.replace(/\.(tbi|csi)$/, '')
  const theirs = htslib(['-H', `${dir}${base}`])
  if (theirs === undefined) {
    continue
  }
  const ours = await open(idx).getHeader()
  headers++
  // htslib strips the CR of a CRLF header line; we keep it
  if (ours.replaceAll('\r\n', '\n') !== theirs) {
    bad++
    console.log(
      `DIFF header ${base}: ours=${ours.length}b htslib=${theirs.length}b`,
    )
  }
}
console.log(`${headers} headers compared`)

// a deliberately tiny cache budget, so every query churns through eviction
let queries = 0
for (const idx of indexes) {
  const base = idx.replace(/\.(tbi|csi)$/, '')
  const f = open(idx, 1 << 16)
  let refs
  try {
    refs = await f.getReferenceSequenceNames()
  } catch {
    continue
  }
  for (const ref of refs.filter(Boolean).slice(0, 4)) {
    for (let i = 0; i < 12; i++) {
      const start = Math.floor(rand() * 250_000_000)
      const end = start + Math.floor(rand() * 2_000_000) + 1
      const theirs = htslib([`${dir}${base}`, `${ref}:${start + 1}-${end}`])
      if (theirs === undefined) {
        continue
      }
      const ours = []
      await f.getLines(ref, start, end, { lineCallback: l => ours.push(l) })
      const want = theirs === '' ? [] : theirs.replace(/\n$/, '').split('\n')
      queries++
      if (ours.length !== want.length || ours.some((l, j) => l !== want[j])) {
        bad++
        console.log(
          `DIFF query ${base} ${ref}:${start}-${end} ours=${ours.length} htslib=${want.length}`,
        )
      }
    }
  }
}
console.log(`${queries} queries compared`)

console.log(bad === 0 ? '\nno differences from htslib' : `\n${bad} MISMATCHES`)
process.exit(bad === 0 ? 0 : 1)
