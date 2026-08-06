import { LocalFile } from 'generic-filehandle2'
import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'

// lets queued microtasks and timers run, so a joining caller reaches the
// in-flight read before we abort the owner
function tick() {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

class CountingFile extends LocalFile {
  public reads = 0
  override async read(length: number, position?: number) {
    this.reads++
    return super.read(length, position)
  }
}

function open(file: string, chunkCacheSize?: number) {
  const dir = new URL('data/', import.meta.url).pathname
  const filehandle = new CountingFile(`${dir}${file}`)
  return {
    filehandle,
    f: new TabixIndexedFile({
      filehandle,
      tbiFilehandle: new LocalFile(`${dir}${file}.tbi`),
      chunkCacheSize,
    }),
  }
}

async function count(f: TabixIndexedFile, ref: string, s: number, e: number) {
  let lines = 0
  await f.getLines(ref, s, e, {
    lineCallback: () => {
      lines++
    },
  })
  return lines
}

const MANY_CHUNKS = [
  'ncbi_human.sorted.gff.gz',
  'NC_000001.11',
  45e6,
  46e6,
] as const
const ONE_CHUNK = ['chr22_nanopore_subset.bed.gz', '22', 16e6, 16.02e6] as const

test('a budget that fits the query caches every chunk it read', async () => {
  const [file, ref, s, e] = MANY_CHUNKS
  const { f, filehandle } = open(file, 50 * 2 ** 20)
  expect(await count(f, ref, s, e)).toBe(2785)
  const first = filehandle.reads
  expect(await count(f, ref, s, e)).toBe(2785)
  expect(filehandle.reads).toBe(first)
})

// The point of budgeting by decompressed bytes. This query is 8 chunks holding
// 3.69MB decompressed, so a 2MB budget has to evict — where the old
// count-based LRU read the same number as "2MB / 64KB = 32 entries" and cached
// all 8, using 3.69MB against a budget it believed was 2MB.
test('a budget smaller than the query evicts and forces a re-read', async () => {
  const [file, ref, s, e] = MANY_CHUNKS
  const { f, filehandle } = open(file, 2 * 2 ** 20)
  expect(await count(f, ref, s, e)).toBe(2785)
  const first = filehandle.reads
  expect(await count(f, ref, s, e)).toBe(2785)
  expect(filehandle.reads).toBeGreaterThan(first)
})

// the size > 1 guard: one chunk over budget is still worth keeping, since
// dropping it only buys a re-download the caller immediately pays for
test('a single chunk larger than the whole budget is still cached', async () => {
  const [file, ref, s, e] = ONE_CHUNK
  const { f, filehandle } = open(file, 1)
  await count(f, ref, s, e)
  expect(filehandle.reads).toBe(1)
  await count(f, ref, s, e)
  expect(filehandle.reads).toBe(1)
})

// The chunk read is shared: a row of adjacent blocks in a genome browser
// collapses onto very few chunk keys, so one read serves several queries. That
// makes its cancellation a shared resource too, and the rule is the one
// @gmod/bam's ADR 0007 sets out — a read is cancelled only once *every* caller
// waiting on it has given up.
//
// These used to be the responsibility of @gmod/abortable-promise-cache. The
// logic now lives in ChunkCache, so the tests come with it.
//
// SYNC: ~/src/gmod/bam-js/test/cache.test.ts hangFirstRead — same harness.
//
// `honourAbort: false` models a filehandle that ignores the signal, which is
// what LocalFile does: the read keeps running after its cancellation, so it is
// still sitting in the cache when the next query arrives.
function hangFirstRead(f: TabixIndexedFile, { honourAbort = true } = {}) {
  // parkedCancelled is what makes these load-bearing. Asserting only that the
  // callers' promises reject proves nothing: a cancelled caller rejects on its
  // own throwIfAborted whatever the parked read does.
  const stats = { reads: 0, parkedCancelled: false }
  const inner = f.readChunk.bind(f)
  let started!: () => void
  const firstStarted = new Promise<void>(resolve => {
    started = resolve
  })
  let release!: () => void
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  f.readChunk = async (c, opts) => {
    stats.reads++
    if (stats.reads === 1) {
      started()
      // Parked until the test lets it go, or until the read is cancelled. The
      // signal here is the *shared* one, which fires only once every caller
      // waiting on this read has aborted.
      await new Promise<void>((resolve, reject) => {
        void released.then(resolve)
        opts?.signal?.addEventListener('abort', () => {
          stats.parkedCancelled = true
          if (honourAbort) {
            reject(new Error('aborted'))
          }
        })
      })
    }
    return inner(c, opts)
  }
  return {
    stats,
    firstStarted,
    release: () => {
      release()
    },
  }
}

function lines(
  f: TabixIndexedFile,
  [, ref, s, e]: typeof ONE_CHUNK,
  signal?: AbortSignal,
) {
  return f.getLines(ref, s, e, {
    lineCallback: () => {
      // the lines themselves are not what these tests are about
    },
    signal,
  })
}

test('a waiter survives the chunk read owner aborting', async () => {
  const { f } = open(ONE_CHUNK[0])
  await f.getHeader()
  const { stats, firstStarted, release } = hangFirstRead(f)

  const owner = new AbortController()
  const waiter = new AbortController()
  const ownerP = lines(f, ONE_CHUNK, owner.signal)
  await firstStarted
  const waiterP = lines(f, ONE_CHUNK, waiter.signal)
  void Promise.allSettled([ownerP, waiterP])
  await tick()

  owner.abort()
  // the waiter has not given up, so the read it joined is not cancelled and is
  // still sitting there waiting to be let go
  release()

  await expect(ownerP).rejects.toThrow(/abort/i)
  await expect(waiterP).resolves.toBeUndefined()
  expect(waiter.signal.aborted).toBe(false)
  expect(stats.parkedCancelled).toBe(false)
})

test('a chunk read is cancelled once every waiter has aborted', async () => {
  const { f } = open(ONE_CHUNK[0])
  await f.getHeader()
  const { stats, firstStarted } = hangFirstRead(f)

  const owner = new AbortController()
  const waiter = new AbortController()
  const ownerP = lines(f, ONE_CHUNK, owner.signal)
  await firstStarted
  const waiterP = lines(f, ONE_CHUNK, waiter.signal)
  void Promise.allSettled([ownerP, waiterP])
  await tick()

  // nobody is left who wants these bytes, so the read is cancelled rather than
  // run to completion and thrown away. It is never released here — the abort is
  // what unblocks it.
  owner.abort()
  waiter.abort()
  await tick()
  expect(stats.parkedCancelled).toBe(true)

  await expect(ownerP).rejects.toThrow(/abort/i)
  await expect(waiterP).rejects.toThrow(/abort/i)
})

test('a signal-free caller pins the chunk read', async () => {
  const { f } = open(ONE_CHUNK[0])
  await f.getHeader()
  const { stats, firstStarted, release } = hangFirstRead(f)

  const owner = new AbortController()
  const ownerP = lines(f, ONE_CHUNK, owner.signal)
  await firstStarted
  // No signal at all, so this caller cannot give up and there is no set of
  // aborts that should stop the read it joined. The cost is on the same line:
  // one signal-free query makes that chunk uncancellable for everyone joined to
  // it. Pinned here so it stays a decision rather than becoming an accident.
  const pinnerP = lines(f, ONE_CHUNK)
  void Promise.allSettled([ownerP, pinnerP])
  await tick()
  owner.abort()
  await tick()

  expect(stats.parkedCancelled).toBe(false)

  // released before either is awaited: the read is pinned, so nothing else can
  // unblock it, and the owner is waiting on it too
  release()
  await expect(pinnerP).resolves.toBeUndefined()
  await expect(ownerP).rejects.toThrow(/abort/i)
})

test('a query does not join a chunk read every waiter has abandoned', async () => {
  const { f } = open(ONE_CHUNK[0])
  await f.getHeader()
  // the read ignores its cancellation, as LocalFile does, so it is still
  // discoverable when the next query arrives
  const { stats, firstStarted } = hangFirstRead(f, { honourAbort: false })

  const owner = new AbortController()
  const ownerP = lines(f, ONE_CHUNK, owner.signal)
  void ownerP.catch(() => undefined)
  await firstStarted
  owner.abort()
  await tick()
  expect(stats.parkedCancelled).toBe(true)

  // A query arriving now must start its own read rather than join one already
  // doomed — joining it means inheriting a cancellation that has nothing to do
  // with this query.
  await expect(lines(f, ONE_CHUNK)).resolves.toBeUndefined()
})
