import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'

function vcf() {
  return new TabixIndexedFile({
    path: new URL('data/volvox.test.vcf.gz', import.meta.url).pathname,
    tbiPath: new URL('data/volvox.test.vcf.gz.tbi', import.meta.url).pathname,
  })
}

interface Emitted {
  line: string
  fileOffset: number
  start: number
  end: number
}

async function collectStrings(
  f: TabixIndexedFile,
  refName: string,
  s: number,
  e: number,
) {
  const out: Emitted[] = []
  await f.getLines(refName, s, e, {
    lineCallback: (line, fileOffset, start, end) => {
      out.push({ line, fileOffset, start, end })
    },
  })
  return out
}

async function collectBytes(
  f: TabixIndexedFile,
  refName: string,
  s: number,
  e: number,
) {
  const out: Emitted[] = []
  const decoder = new TextDecoder()
  await f.getLines(refName, s, e, {
    lineBytesCallback: (buffer, lineStart, lineEnd, fileOffset, start, end) => {
      out.push({
        line: decoder.decode(buffer.subarray(lineStart, lineEnd)),
        fileOffset,
        start,
        end,
      })
    },
  })
  return out
}

test('lineBytesCallback yields the same lines the string callback does', async () => {
  const strings = await collectStrings(vcf(), 'contigA', 1000, 4000)
  const bytes = await collectBytes(vcf(), 'contigA', 1000, 4000)
  expect(bytes.length).toBe(8)
  expect(bytes).toEqual(strings)
})

test('lineBytesCallback trims a CRLF terminator like the string callback', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/CrlfOffsetTest.vcf.gz', import.meta.url).pathname,
    tbiPath: new URL('data/CrlfOffsetTest.vcf.gz.tbi', import.meta.url)
      .pathname,
  })
  const bytes = await collectBytes(f, 'contigA', 0, 50000)
  expect(bytes.length).toBeGreaterThan(0)
  for (const { line } of bytes) {
    expect(line.endsWith('\r')).toBe(false)
    expect(line.includes('\n')).toBe(false)
  }
  const f2 = new TabixIndexedFile({
    path: new URL('data/CrlfOffsetTest.vcf.gz', import.meta.url).pathname,
    tbiPath: new URL('data/CrlfOffsetTest.vcf.gz.tbi', import.meta.url)
      .pathname,
  })
  expect(bytes).toEqual(await collectStrings(f2, 'contigA', 0, 50000))
})

// The buffer is the reader's own block, handed over without a copy, so the
// documented contract is that it is only valid during the call. Reading the
// range inside the callback is what a consumer is expected to do; this pins
// that the range is the line and nothing else.
test('the byte range covers exactly the line, no separator', async () => {
  const seen: number[] = []
  await vcf().getLines('contigA', 1000, 4000, {
    lineBytesCallback: (buffer, lineStart, lineEnd) => {
      expect(lineEnd).toBeGreaterThan(lineStart)
      expect(buffer[lineStart]).not.toBe(10)
      expect(buffer[lineEnd - 1]).not.toBe(10)
      expect(buffer[lineEnd - 1]).not.toBe(13)
      seen.push(lineEnd - lineStart)
    },
  })
  expect(seen.length).toBe(8)
})

test('getLines rejects an options object carrying neither callback', async () => {
  await expect(
    // @ts-expect-error deliberately omitting both callbacks
    vcf().getLines('contigA', 1000, 4000, {}),
  ).rejects.toThrow(/lineCallback or a lineBytesCallback/)
})
