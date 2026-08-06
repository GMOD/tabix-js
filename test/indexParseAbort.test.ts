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
  // ONE read: the parse the bystander joined is not cancelled by the starter's
  // abort, so there is nothing to start over. This used to be 2, because the
  // parse ran under the starter's own signal and a bystander could only recover
  // by re-reading the whole index.
  expect(fh.reads).toBe(1)
})

// The other half of the rule: a parse nobody is waiting on any more IS
// cancelled, rather than left running to fill a cache no caller will read.
test('the index parse is cancelled once every caller has given up', async () => {
  const fh = new GatedFile(TBI_PATH)
  const tbi = new TBI({ filehandle: fh })

  const a = new AbortController()
  const b = new AbortController()

  const aP = tbi.parse({ signal: a.signal })
  const bP = tbi.parse({ signal: b.signal })
  void Promise.allSettled([aP, bP])
  await tick()
  expect(fh.reads).toBe(1)

  // a alone is not everyone: the read is neither cancelled nor restarted, and
  // `aP` is still pending — a caller learns of its own abort when the read it
  // was waiting on settles, not the moment it aborts
  a.abort()
  await tick()
  expect(fh.reads).toBe(1)

  // ...and now it is. The read is never released — the abort is what unblocks
  // it, so this test hanging is the failure mode.
  b.abort()
  await expect(aP).rejects.toThrow(/abort/i)
  await expect(bP).rejects.toThrow(/abort/i)
  expect(fh.reads).toBe(1)

  // the rejection was dropped rather than cached, so a later caller starts over
  fh.open()
  expect((await tbi.parse()).refNameToId).toBeDefined()
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
  // one read, not a re-parse: see the equivalent index-parse assertion
  expect(fh.reads).toBe(1)
})

// The case 'a signal without throwIfAborted still cancels' above does not
// cover, and the one that was broken until @gmod/shared-read-cache 1.4.3: a
// duck-typed signal that has NOT aborted gets past every throwIfAborted and
// reaches the point where the cache subscribes to it, which on a bare
// `{ aborted }` was `signal.addEventListener is not a function`. Now that the
// header and index parses go through the cache too, they need it as much as the
// chunk reads do.
test('a duck-typed signal that has not aborted still reads', async () => {
  const tbi = new TabixIndexedFile({
    filehandle: new LocalFile('test/data/volvox.test.vcf.gz'),
    tbiFilehandle: new LocalFile('test/data/volvox.test.vcf.gz.tbi'),
  })
  const signal = { aborted: false } as AbortSignal

  expect(typeof (await tbi.getHeader({ signal }))).toBe('string')
  const lines: string[] = []
  await tbi.getLines('contigA', 3000, 4000, {
    signal,
    lineCallback: l => lines.push(l),
  })
  expect(lines.length).toBeGreaterThan(0)
})
