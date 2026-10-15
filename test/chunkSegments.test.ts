// A chunk in segments has to scan to the lines, and the file offsets, that the
// joined chunk gives, wherever the seams fall.
import { gunzipSync } from 'node:zlib'

import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'
import { forEachLinePiece } from '../src/util.ts'

import type {
  BgzfBlockInfo,
  BgzfWorkerPool,
  PoolInput,
} from '@gmod/bgzf-filehandle'

/** every complete line as [offset in the joined chunk, text] */
function linesOf(segments: Uint8Array[]) {
  const out: [number, string][] = []
  const decoder = new TextDecoder()
  forEachLinePiece(segments, (buffer, base) => {
    expect(buffer.at(-1)).toBe(10)
    let start = 0
    for (
      let nl = buffer.indexOf(10);
      nl !== -1;
      nl = buffer.indexOf(10, start)
    ) {
      out.push([base + start, decoder.decode(buffer.subarray(start, nl))])
      start = nl + 1
    }
    return false
  })
  return out
}

function split(bytes: Uint8Array, cuts: number[]) {
  const segments: Uint8Array[] = []
  let at = 0
  for (const cut of [...cuts, bytes.length]) {
    segments.push(bytes.slice(at, cut))
    at = cut
  }
  return segments
}

test('pieces give the joined chunk its lines and offsets', () => {
  const text =
    'a\tone\r\n\nshort\n' +
    'x'.repeat(5000) +
    '\nb\tline\nc\tline\ntrailing partial'
  const bytes = new TextEncoder().encode(text)
  const expected = linesOf([bytes])
  expect(expected.map(([, l]) => l.length)).toEqual([6, 0, 5, 5000, 6, 6])

  const nl = [...bytes.keys()].filter(i => bytes[i] === 10)
  const cutsBy: Record<string, number[]> = {
    'right after each newline': nl.map(i => i + 1),
    'right before each newline': nl,
    'a long line over many segments': [16, 100, 1000, 2000, 3000, 4000, 5000],
    'every 7 bytes': Array.from(
      { length: Math.floor(bytes.length / 7) },
      (_, i) => (i + 1) * 7,
    ),
    'one byte each': Array.from({ length: bytes.length - 1 }, (_, i) => i + 1),
    'empty segments': [3, 3, 3, 20, 20],
  }
  for (const [label, cuts] of Object.entries(cutsBy)) {
    expect(linesOf(split(bytes, cuts)), label).toEqual(expected)
  }
})

test('a visit that returns true stops the walk', () => {
  const bytes = new TextEncoder().encode('one\ntwo\nthree\n')
  let visits = 0
  const stopped = forEachLinePiece(split(bytes, [2, 6, 9]), () => {
    visits++
    return true
  })
  expect(stopped).toBe(true)
  expect(visits).toBe(1)
})

// every block in a buffer of its own, so each block boundary is a seam
function perBlockPool(): BgzfWorkerPool & { calls: number } {
  const pool = {
    calls: 0,
    decompressBlocks(input: PoolInput, blocks: BgzfBlockInfo[]) {
      pool.calls++
      return Promise.resolve({
        blocks: blocks.map(
          b =>
            new Uint8Array(
              gunzipSync(
                input.subarray(b.inputOffset, b.inputOffset + b.compressedSize),
              ),
            ),
        ),
      })
    },
    destroy: () => undefined,
  }
  return pool
}

// the GAF fixture is too small to reach the pool, so it checks only that a
// single segment scans as the joined buffer did
const QUERIES = [
  ['ncbi_human.sorted.gff.gz', 'NC_000001.11', 45e6, 46e6, true],
  ['chr22_nanopore_subset.bed.gz', '22', 16e6, 18e6, true],
  ['volvox.test.vcf.gz', 'contigA', 0, 50_000, true],
  ['cactus_shifted.gaf.gz', 'anything', 0, 1e9, false],
] as const

test.each(QUERIES)(
  'a pooled read in segments gives every line and offset: %s',
  async (file, ref, start, end, reachesPool) => {
    const dir = new URL('data/', import.meta.url).pathname
    const run = async (bgzfWorkerPool?: BgzfWorkerPool) => {
      const f = new TabixIndexedFile({
        filehandle: new LocalFile(`${dir}${file}`),
        tbiFilehandle: new LocalFile(`${dir}${file}.tbi`),
        bgzfWorkerPool,
      })
      const out: string[] = []
      await f.getLines(ref, start, end, {
        lineCallback: (line, fileOffset, s, e) => {
          out.push(`${fileOffset}|${s}|${e}|${line}`)
        },
      })
      return out
    }
    const pool = perBlockPool()
    const [pooled, plain] = await Promise.all([run(pool), run()])
    expect(plain.length).toBeGreaterThan(0)
    expect(pooled).toEqual(plain)
    expect(pool.calls > 0).toBe(reachesPool)
  },
)
