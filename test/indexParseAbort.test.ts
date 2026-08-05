import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import TBI from '../src/tbi.ts'

import type { FilehandleOptions } from 'generic-filehandle2'


const TBI_PATH = 'test/data/1kg.chr1.subset.vcf.gz.tbi'

// A filehandle that honours the signal — LocalFile does not — and can park its
// readFile, so the shared index parse can be caught mid-flight.
class GatedIndexFile extends LocalFile {
  reads = 0
  private waiting: (() => void)[] = []
  private held = true

  open() {
    this.held = false
    const waiting = this.waiting
    this.waiting = []
    for (const resume of waiting) {
      resume()
    }
  }

  override async readFile(opts?: FilehandleOptions) {
    this.reads++
    if (this.held) {
      await new Promise<void>((resolve, reject) => {
        this.waiting.push(resolve)
        opts?.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    }
    return super.readFile()
  }
}

function tick() {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

// The .tbi is parsed once and shared by every query against the file, so the
// first caller to arrive owns a read all the others depend on.
test('a bystander survives the index parse owner aborting', async () => {
  const fh = new GatedIndexFile(TBI_PATH)
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
  const fh = new GatedIndexFile(TBI_PATH)
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
