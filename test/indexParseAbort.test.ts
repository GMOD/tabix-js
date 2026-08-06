import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'
import TBI from '../src/tbi.ts'

import type {
  BufferEncoding,
  FilehandleOptions,
  GenericFilehandle,
} from 'generic-filehandle2'

// A fixture that is TRACKED IN GIT. test/data/1kg.chr1.subset.vcf.gz* is
// gitignored — it exists locally but not in CI, where the read is an ENOENT
// rather than the parked read these tests are about.
const TBI_PATH = 'test/data/CNVtest.vcf.gz.tbi'

// A filehandle that honours the signal — LocalFile does not — and can park its
// reads, so a shared parse can be caught mid-flight. Gates `read` as well as
// `readFile`, since the header parse goes through the former and the index
// parse through the latter.
//
// SYNC: ~/src/gmod/bam-js/test/cache.test.ts GatedFile — same harness.
class GatedFile implements GenericFilehandle {
  reads = 0
  private inner: LocalFile
  private waiting: (() => void)[] = []
  private held = true

  constructor(path: string) {
    this.inner = new LocalFile(path)
  }

  open() {
    this.held = false
    const waiting = this.waiting
    this.waiting = []
    for (const resume of waiting) {
      resume()
    }
  }

  // The overload pair rather than one signature, because GenericFilehandle's
  // readFile is overloaded on `encoding` and a single-signature override does
  // not satisfy it. `pnpm typecheck` covers test/ where `pnpm build` does not,
  // so this is caught here rather than in CI.
  readFile(
    options?: Omit<FilehandleOptions, 'encoding'>,
  ): Promise<Uint8Array<ArrayBuffer>>
  readFile(
    options:
      | BufferEncoding
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: BufferEncoding }),
  ): Promise<string>
  async readFile(
    options?: BufferEncoding | FilehandleOptions,
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    this.reads++
    await this.gate(typeof options === 'string' ? undefined : options?.signal)
    return this.inner.readFile()
  }

  async read(length: number, position: number, opts?: FilehandleOptions) {
    this.reads++
    await this.gate(opts?.signal)
    return this.inner.read(length, position)
  }

  /**
   * Resolves once at least `n` reads have been issued.
   *
   * The reason the header tests wait on this rather than on a `setTimeout(0)`:
   * a read is only parked once the code under test reaches it, and getting
   * there runs real `LocalFile` I/O for the index parse first. One macrotask is
   * not a bound on that, so waiting a tick and hoping raced — with the index
   * warm the whole header parse finished before the abort landed, and the
   * assertion that the owner rejects failed.
   */
  async waitForReads(n: number) {
    while (this.reads < n) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  private async gate(signal?: AbortSignal) {
    if (this.held) {
      await new Promise<void>((resolve, reject) => {
        this.waiting.push(resolve)
        signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    }
  }
  stat() {
    return this.inner.stat()
  }
  close() {
    return Promise.resolve()
  }
}

// lets queued microtasks and timers run, so a joining caller reaches the
// in-flight parse before we abort the owner
function tick() {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

// The .tbi is parsed once and shared by every query against the file, so the
// first caller to arrive owns a read all the others depend on.
test('a bystander survives the index parse owner aborting', async () => {
  const fh = new GatedFile(TBI_PATH)
  const tbi = new TBI({ filehandle: fh })

  const starter = new AbortController()
  const bystander = new AbortController()

  const starterP = tbi.parse({ signal: starter.signal })
  const bystanderP = tbi.parse({ signal: bystander.signal })
  void Promise.allSettled([starterP, bystanderP])
  await tick()
  expect(fh.reads).toBe(1)

  starter.abort()
  fh.open()

  await expect(starterP).rejects.toThrow(/abort/i)
  // The bystander never asked to be cancelled. Before this was handled it
  // inherited the starter's abort, so one pan failed every concurrent query.
  expect(bystander.signal.aborted).toBe(false)
  expect((await bystanderP).refNameToId).toBeDefined()
  // the retry is bounded at one attempt, so the parse ran exactly twice
  expect(fh.reads).toBe(2)
})

// Takes three callers, because the bound only bites when a caller that has
// already retried joins someone else's retry and *that* is abandoned too. With
// two, the retrying caller always starts its own parse and never re-enters the
// join path at all.
test('the index parse retry is bounded at one attempt', async () => {
  const fh = new GatedFile(TBI_PATH)
  const tbi = new TBI({ filehandle: fh })

  const a = new AbortController()
  const b = new AbortController()
  const c = new AbortController()

  // a owns read 1; b and c join it, b's handler registered ahead of c's
  const aP = tbi.parse({ signal: a.signal })
  const bP = tbi.parse({ signal: b.signal })
  const cP = tbi.parse({ signal: c.signal })
  void Promise.allSettled([aP, bP, cP])
  await tick()
  expect(fh.reads).toBe(1)

  // a gives up: b retries first and becomes the owner of read 2, and c, running
  // right behind it, joins that retry rather than starting a third
  a.abort()
  await tick()
  expect(fh.reads).toBe(2)

  // now b gives up too. c has already spent its one retry, so it propagates
  // rather than going round again — a third round would be a recursion whose
  // depth is set by how the aborts happen to interleave.
  b.abort()
  fh.open()

  await expect(aP).rejects.toThrow(/abort/i)
  await expect(bP).rejects.toThrow(/abort/i)
  await expect(cP).rejects.toThrow(/abort/i)
  expect(fh.reads).toBe(2)
})

test('a signal without throwIfAborted still cancels', async () => {
  const tbi = new TBI({ filehandle: new LocalFile(TBI_PATH) })

  // Consumers pass duck-typed signals, and so does any browser older than
  // Safari 15.4, where throwIfAborted and reason do not exist. Calling the
  // missing method would be a TypeError rather than the cancellation asked for.
  const signal = { aborted: true } as AbortSignal

  const e = await tbi
    .parse({ signal })
    .then(() => undefined)
    .catch((err: unknown) => err)
  // Asserted by type, not by message: calling the missing method throws
  // "signal?.throwIfAborted is not a function", whose text matches /abort/i
  // perfectly well, so a message check passes on the very bug it should catch.
  expect(e).toBeInstanceOf(DOMException)
  expect((e as DOMException).name).toBe('AbortError')
})

// The header is parsed once and shared by every caller, so it is the second
// shared read in this package after the index parse. parseHeader threads opts
// into both getMetadata and the header read.
test('a bystander survives the header parse owner aborting', async () => {
  const fh = new GatedFile('test/data/volvox.test.vcf.gz')
  const tbi = new TabixIndexedFile({
    filehandle: fh,
    tbiFilehandle: new LocalFile('test/data/volvox.test.vcf.gz.tbi'),
  })

  const starter = new AbortController()
  const bystander = new AbortController()

  const starterP = tbi.getHeader({ signal: starter.signal })
  const bystanderP = tbi.getHeader({ signal: bystander.signal })
  void Promise.allSettled([starterP, bystanderP])
  // the header read itself, parked — not a tick and a hope
  await fh.waitForReads(1)

  starter.abort()
  fh.open()

  await expect(starterP).rejects.toThrow(/abort/i)
  // the bystander never asked to be cancelled
  expect(bystander.signal.aborted).toBe(false)
  expect(typeof (await bystanderP)).toBe('string')
})
