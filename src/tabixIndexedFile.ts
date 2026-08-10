import { unzip, unzipChunkSlice } from '@gmod/bgzf-filehandle'
import { SharedReadCache } from '@gmod/shared-read-cache'
import { LocalFile, RemoteFile } from 'generic-filehandle2'

import CSI from './csi.ts'
import TBI from './tbi.ts'
import { optimizeChunks } from './util.ts'

import type Chunk from './chunk.ts'
import type IndexFile from './indexFile.ts'
import type { Options } from './indexFile.ts'
import type { ChunkSlice } from '@gmod/bgzf-filehandle'
import type { SharedBudget } from '@gmod/shared-read-cache'
import type { GenericFilehandle } from 'generic-filehandle2'

const TAB = 9
const NEWLINE = 10
const CARRIAGE_RETURN = 13
const SEMICOLON = 59

// Ceiling on how many chunk reads getLines keeps in flight ahead of the one it
// is parsing. Six is the HTTP/1.1 per-host connection cap browsers enforce, so
// going much above it buys nothing on the transport that matters.
const MAX_READ_AHEAD_CHUNKS = 6

// SYNC: ~/src/gmod/bam-js/src/bamFile.ts DEFAULT_MAX_CACHE_BYTES
//
// We fetch compressed and cache decompressed, and an entry is a whole chunk, so
// entry count says nothing about memory. How little is easy to underestimate:
// a dense VCF (test/data/1kg.chr1.subset.vcf.gz — 213MB over 600kb of chr1)
// has single index bins of 17MB compressed, 120MB decompressed. Panning it
// under the old 80-entry cache peaked at 2GB RSS.
//
// That 120MB figure is also why this is no longer 100MB. A budget below one
// query's working set does not cache less, it caches NOTHING: each entry is
// evicted before the next pan can reuse it, so the hit rate is zero and the
// decompress is paid again every time. On that same fixture, a six-window 50kb
// pan measured 17 refills out of 17 — a total miss — at 100MB, against 0 at
// 800MB, and 2596ms against 600ms. The working set plateaus at 497MB held, so
// 1GB clears it with headroom and nothing above 800MB buys anything.
//
// Affordable as a ceiling only because of the idle timeout below: it is a peak
// under panning, not a level a parked consumer holds. A small file is
// unaffected either way, this being a ceiling and not an allocation.
const DEFAULT_CHUNK_CACHE_BYTES = 1024 * 2 ** 20

// SYNC: ~/src/gmod/bam-js/src/bamFile.ts DEFAULT_CACHE_IDLE_TIMEOUT_MS
//
// Drop a chunk nothing has looked at for three minutes. The budget above is
// only applied when a read settles, so it does nothing at all for a consumer
// sitting still — and a genome browser holds one of these per track for as long
// as the track is open. Timed from the last read, not the fetch, so panning
// back and forth over one region never expires it.
const DEFAULT_CHUNK_CACHE_IDLE_TIMEOUT_MS = 3 * 60 * 1000

type GetLinesCallback = (
  line: string,
  fileOffset: number,
  start: number,
  end: number,
) => void

interface GetLinesOpts {
  signal?: AbortSignal
  lineCallback: GetLinesCallback
  /**
   * Called as the compressed data blocks covering the query are fetched, with
   * cumulative downloaded bytes and the total bytes to fetch. Reported at block
   * granularity (one tick per chunk, including instant ticks for cache hits),
   * which is the natural unit since chunk byte sizes are known up front from
   * the index. Lets callers render a determinate download progress bar.
   */
  onProgress?: (bytesDownloaded: number, totalBytes?: number) => void
}

// The decompressed chunk plus its block offsets, as @gmod/bgzf-filehandle
// returns them: cpositions/dpositions are Float64Arrays, which is what the
// wasm decompressor produces, and only indexed reads and `.length` are used
// here. Taken from the package rather than restated so the two can't drift.
type ReadChunk = ChunkSlice

function resolveFilehandle(
  filehandle?: GenericFilehandle,
  path?: string,
  url?: string,
) {
  if (filehandle) {
    return filehandle
  }
  if (path) {
    return new LocalFile(path)
  }
  if (url) {
    return new RemoteFile(url)
  }
  throw new TypeError('must provide either filehandle, path, or url')
}

// An explicitly supplied index always wins over the `<path>.tbi` /
// `<url>.tbi` names derived from the data file, whichever kind it is.
function resolveIndex({
  tbiFilehandle,
  csiFilehandle,
  tbiPath,
  csiPath,
  tbiUrl,
  csiUrl,
  path,
  url,
}: {
  tbiFilehandle?: GenericFilehandle
  csiFilehandle?: GenericFilehandle
  tbiPath?: string
  csiPath?: string
  tbiUrl?: string
  csiUrl?: string
  path?: string
  url?: string
}) {
  if (tbiFilehandle) {
    return new TBI({ filehandle: tbiFilehandle })
  }
  if (csiFilehandle) {
    return new CSI({ filehandle: csiFilehandle })
  }
  if (tbiPath) {
    return new TBI({ filehandle: new LocalFile(tbiPath) })
  }
  if (csiPath) {
    return new CSI({ filehandle: new LocalFile(csiPath) })
  }
  if (csiUrl) {
    return new CSI({ filehandle: new RemoteFile(csiUrl) })
  }
  if (tbiUrl) {
    return new TBI({ filehandle: new RemoteFile(tbiUrl) })
  }
  if (path) {
    return new TBI({ filehandle: new LocalFile(`${path}.tbi`) })
  }
  if (url) {
    return new TBI({ filehandle: new RemoteFile(`${url}.tbi`) })
  }
  throw new TypeError(
    'must provide one of tbiFilehandle, tbiPath, csiFilehandle, csiPath, tbiUrl, csiUrl',
  )
}

function calculateFileOffset(
  cpositions: ArrayLike<number>,
  dpositions: ArrayLike<number>,
  pos: number,
  blockStart: number,
  minvDataPosition: number,
) {
  return (
    cpositions[pos]! * (1 << 8) +
    (blockStart - dpositions[pos]!) +
    minvDataPosition +
    1
  )
}

function getVcfEnd(
  buffer: Uint8Array,
  startCoordinate: number,
  refStart: number,
  refEnd: number,
  infoStart: number,
  infoEnd: number,
) {
  const refLen = refEnd - refStart
  let endCoordinate = startCoordinate + refLen

  // INFO is '.', no fields to check
  if (buffer[infoStart] === 46) {
    return endCoordinate
  }

  // Single pass over semicolon-delimited fields checking prefixes.
  // Avoids repeated indexOf scans for common bytes like 'S' and 'E'
  // that produce many false positives in typical INFO fields.
  let fieldStart = infoStart
  for (let i = infoStart; i <= infoEnd; i++) {
    if (i === infoEnd || buffer[i] === SEMICOLON) {
      const fieldLen = i - fieldStart
      if (
        fieldLen >= 10 &&
        buffer[fieldStart] === 83 && // S
        buffer[fieldStart + 1] === 86 && // V
        buffer[fieldStart + 2] === 84 && // T
        buffer[fieldStart + 3] === 89 && // Y
        buffer[fieldStart + 4] === 80 && // P
        buffer[fieldStart + 5] === 69 && // E
        buffer[fieldStart + 6] === 61 && // =
        buffer[fieldStart + 7] === 84 && // T
        buffer[fieldStart + 8] === 82 && // R
        buffer[fieldStart + 9] === 65 // A
      ) {
        return startCoordinate + 1
      }
      if (
        fieldLen >= 4 &&
        buffer[fieldStart] === 69 && // E
        buffer[fieldStart + 1] === 78 && // N
        buffer[fieldStart + 2] === 68 && // D
        buffer[fieldStart + 3] === 61 // =
      ) {
        endCoordinate = parseIntFromBytes(buffer, fieldStart + 4, i)
      }
      fieldStart = i + 1
    }
  }
  return endCoordinate
}

const textDecoder = new TextDecoder()

/**
 * The leading run of meta-character lines — what `tabix -H` prints. Everything
 * from the first line that doesn't begin with the meta character is dropped.
 */
function trimToMetaLines(bytes: Uint8Array, metaChar: string) {
  let lastNewline = -1
  const metaByte = metaChar.charCodeAt(0)

  for (let i = 0, l = bytes.length; i < l; i++) {
    const byte = bytes[i]
    if (i === lastNewline + 1 && byte !== metaByte) {
      break
    }
    if (byte === NEWLINE) {
      lastNewline = i
    }
  }
  return bytes.subarray(0, lastNewline + 1)
}

/**
 * The first `count` lines. Scans for the count-th newline and decodes only that
 * far, rather than decoding and splitting the whole buffer to keep its first
 * few lines — the buffer runs to the first data line, which for a file with a
 * long commented preamble above its counted rows can be megabytes.
 */
function firstLines(bytes: Uint8Array, count: number) {
  let end = 0
  for (let i = 0; i < count; i++) {
    const n = bytes.indexOf(NEWLINE, end)
    if (n === -1) {
      end = bytes.length
      break
    }
    end = n + 1
  }
  return textDecoder
    .decode(bytes.subarray(0, end))
    .split(/\r?\n/)
    .slice(0, count)
}

function parseIntFromBytes(buffer: Uint8Array, start: number, end: number) {
  let val = 0
  for (let i = start; i < end; i++) {
    const c = buffer[i]!
    if (c >= 48 && c <= 57) {
      val = val * 10 + (c - 48)
    } else {
      break
    }
  }
  return val
}

/**
 * Reads Tabix-indexed files (bgzipped), supporting both .tbi and .csi index formats.
 */
export default class TabixIndexedFile {
  private filehandle: GenericFilehandle
  private index: IndexFile
  public chunkCache: SharedReadCache<Chunk, ReadChunk>
  /**
   * The parsed header, as a shared read — see {@link getParsedHeader}. One
   * entry, never evicted, which is what a memo is.
   */
  private headerCache = new SharedReadCache<
    string,
    { header: string; skippedLines: string[] }
  >({})

  constructor({
    path,
    filehandle,
    url,
    tbiPath,
    tbiUrl,
    tbiFilehandle,
    csiPath,
    csiUrl,
    csiFilehandle,
    chunkCacheSize = DEFAULT_CHUNK_CACHE_BYTES,
    chunkCacheIdleTimeoutMs = DEFAULT_CHUNK_CACHE_IDLE_TIMEOUT_MS,
    chunkCacheBudget,
  }: {
    path?: string
    filehandle?: GenericFilehandle
    url?: string
    tbiPath?: string
    tbiUrl?: string
    tbiFilehandle?: GenericFilehandle
    csiPath?: string
    csiUrl?: string
    csiFilehandle?: GenericFilehandle
    /**
     * Budget for the decompressed chunk cache, in bytes. Default 1GB.
     *
     * **The unit changed in v3.5.2** (ADR 0001). Before that this was divided
     * by 64KB to get an entry count, so a caller passing `50 * 2**20` was
     * asking for 800 whole decompressed chunks — unbounded in practice. It now
     * means 50MB, twenty times under the default, and the name did not change
     * so nothing warns. jbrowse still passes exactly that in nine adapters:
     * measured on `test/data/1kg.chr1.subset.vcf.gz` it is a **total miss**,
     * 47 refills out of 47 on the warm pass against 0 at the default, holding
     * 82.7MB in a single entry — over the budget it was given, because the last
     * settled entry is kept whatever the budget. If you pinned a value here
     * before v3.5.2, it does not mean what it did.
     *
     * A retention bound, not a bound on peak memory: reads in flight are never
     * evicted and the last settled entry is kept whatever the budget. Size it
     * to hold several queries — below one query's working set the hit rate
     * drops to zero while the memory is retained anyway, so a number between
     * the two is the worst available choice.
     */
    chunkCacheSize?: number
    /**
     * Drop a cached chunk once nothing has read it for this many milliseconds.
     * Default 3 minutes; `0` keeps chunks until `chunkCacheSize` evicts them.
     *
     * The only thing that lowers the cache while nothing is happening, and what
     * makes the budget above a peak rather than a resting level.
     */
    chunkCacheIdleTimeoutMs?: number
    /**
     * A budget shared with other files — any `@gmod/shared-read-cache`
     * consumer, so `@gmod/bam` and `@gmod/cram` can join the same one — so
     * that the ceiling applies to their sum rather than to each of them.
     *
     * {@link chunkCacheSize} is per file, which is not a bound on a consumer
     * that opens one file per track. @gmod/bam measured the shape: six tracks
     * browsing six windows retained 1442 MB with every cache still under its
     * own ceiling, so the ceiling was not holding the line and nothing else
     * was. The idle timeout cannot help there — it does nothing while the
     * reader is browsing, which is the whole case.
     *
     * Dividing {@link chunkCacheSize} by the track count instead reintroduces
     * the cliff it exists to avoid. A shared budget does not, because a member
     * yields only what is globally least-recently-used: files nobody is
     * reading hand their space to the one being panned.
     */
    chunkCacheBudget?: SharedBudget
  }) {
    this.filehandle = resolveFilehandle(filehandle, path, url)
    this.index = resolveIndex({
      tbiFilehandle,
      csiFilehandle,
      tbiPath,
      csiPath,
      tbiUrl,
      csiUrl,
      path,
      url,
    })

    this.chunkCache = new SharedReadCache<Chunk, ReadChunk>({
      maxSize: chunkCacheSize,
      // decompressed bytes, not entry count: we fetch compressed and cache
      // decompressed, and an entry is a whole chunk
      sizeOf: read => read.buffer.byteLength,
      cacheKey: chunk => chunk.toString(),
      idleTimeoutMs: chunkCacheIdleTimeoutMs,
      budget: chunkCacheBudget,
      fill: (chunk, signal) => this.readChunk(chunk, { signal }),
    })
  }

  /**
   * Drops every decompressed chunk held by the cache, and stops the idle sweep
   * until something is cached again.
   *
   * `chunkCacheIdleTimeoutMs` reclaims a view the user has wandered away from;
   * this is for a consumer that knows it is finished — a closed track, a
   * changed assembly — and should not have to wait it out.
   */
  clearChunkCache() {
    this.chunkCache.clear()
  }

  /**
   * Estimates the compressed byte size of the index chunks covering the given
   * regions. Useful for byte budgeting before issuing a `getLines` call to
   * decide whether a region is too large to fetch.
   */
  async bytesForRegions(
    regions: { refName: string; start: number; end: number }[],
    opts: Options = {},
  ) {
    const all: Chunk[] = []
    for (const { refName, start, end } of regions) {
      const chunks = await this.index.blocksForRange(refName, start, end, opts)
      for (const chunk of chunks) {
        all.push(chunk)
      }
    }
    let bytes = 0
    for (const chunk of optimizeChunks(all)) {
      bytes += chunk.fetchedSize()
    }
    return bytes
  }

  /**
   * @param refName name of the reference sequence
   * @param s start of the region (0-based half-open)
   * @param e end of the region (0-based half-open)
   * @param opts callback invoked for each line, or an options object with `lineCallback` and optional `signal`
   */
  async getLines(
    refName: string,
    s: number | undefined,
    e: number | undefined,
    opts: GetLinesOpts | GetLinesCallback,
  ) {
    let signal: AbortSignal | undefined
    let options: Options = {}
    let callback: GetLinesCallback
    let onProgress: GetLinesOpts['onProgress']

    if (typeof opts === 'function') {
      callback = opts
    } else {
      options = opts
      callback = opts.lineCallback
      signal = opts.signal
      onProgress = opts.onProgress
    }

    const metadata = await this.index.getMetadata(options)
    const start = s ?? 0
    const end = e ?? metadata.maxRefLength
    if (start > end) {
      throw new TypeError(
        'invalid start and end coordinates. start must be less than or equal to end',
      )
    }
    if (start === end) {
      return
    }

    const chunks = await this.index.blocksForRange(refName, start, end, options)

    const isVCF = metadata.format === 'VCF'
    const refCol = metadata.columnNumbers.ref || 0
    const startCol = metadata.columnNumbers.start || 0
    const endCol = isVCF ? 8 : metadata.columnNumbers.end || 0
    const maxColumn = Math.max(refCol, startCol, endCol)
    const metaCharCode = metadata.metaChar?.charCodeAt(0)
    const coordinateOffset =
      metadata.coordinateType === '1-based-closed' ? -1 : 0

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const regionRefNameBytes = encoder.encode(refName)
    // tabs[N] holds the byte offset of the N-th tab on the current line; with
    // the sentinel tabs[0] = blockStart - 1, column N spans tabs[N-1]+1..tabs[N]
    const tabs = new Int32Array(maxColumn + 1)

    let totalBytes = 0
    for (const c of chunks) {
      totalBytes += c.fetchedSize()
    }
    let downloadedBytes = 0
    onProgress?.(0, totalBytes)

    // Read ahead, but only as far as the scan has earned. Every chunk is its
    // own range request, so a query spanning many of them pays a network round
    // trip apiece, serially — for a remote file that dominates, well ahead of
    // decompression (1kg.chr1 over a 1Mb window reads 22 chunks in a row).
    //
    // A fixed window would be wrong, though: blocksForRange offers a chunk per
    // overlapping bin across every level, and on a sparse file the early return
    // below stops the scan inside the first one, leaving the rest untouched
    // (chr22_nanopore_subset offers 7 chunks and reads 1). Prefetching those
    // would multiply the bytes such a query fetches for no gain.
    //
    // Finishing a chunk without hitting the early return proves the next chunk
    // has to be examined, so the window starts at one and doubles per chunk
    // consumed. A query that stops in its first chunk issues exactly the reads
    // a sequential scan did; a long scan reaches full concurrency after three.
    let readAhead = 1
    const reads: Promise<ReadChunk>[] = []
    const ensureReadsStarted = (count: number) => {
      while (reads.length < Math.min(count, chunks.length)) {
        const c = chunks[reads.length]!
        const read = this.chunkCache.get(c, signal)
        void read.catch(() => {
          // a prefetch the early return skips is never awaited, so swallow its
          // rejection here rather than let it surface unhandled
        })
        reads.push(read)
      }
    }
    ensureReadsStarted(1)

    for (let ci = 0, cl = chunks.length; ci < cl; ci++) {
      const c = chunks[ci]!
      const { buffer, cpositions, dpositions } = await reads[ci]!
      downloadedBytes += c.fetchedSize()
      onProgress?.(downloadedBytes, totalBytes)
      const minvDataPosition = c.minv.dataPosition

      let blockStart = 0
      let pos = 0

      while (blockStart < buffer.length) {
        const n = buffer.indexOf(NEWLINE, blockStart)
        if (n === -1) {
          break
        }

        const target = blockStart + minvDataPosition
        while (pos < dpositions.length && target >= dpositions[pos]!) {
          pos++
        }

        // skip meta lines
        if (metaCharCode !== undefined && buffer[blockStart] === metaCharCode) {
          blockStart = n + 1
          continue
        }

        // find tab positions. Columns past the end of the line all get `n`
        // rather than breaking out, which would leave stale offsets from the
        // previous line in the tail of the array.
        tabs[0] = blockStart - 1
        for (let i = 0; i < maxColumn; i++) {
          const prev = tabs[i]!
          const tabPos = prev < n ? buffer.indexOf(TAB, prev + 1) : -1
          tabs[i + 1] = tabPos === -1 || tabPos >= n ? n : tabPos
        }

        // compare ref name bytes directly
        const refStart = tabs[refCol - 1]! + 1
        const refEnd = tabs[refCol]!
        const refLen = refEnd - refStart
        if (refLen !== regionRefNameBytes.length) {
          blockStart = n + 1
          continue
        }
        let isRefMatch = true
        for (let i = 0; i < refLen; i++) {
          if (buffer[refStart + i] !== regionRefNameBytes[i]) {
            isRefMatch = false
            break
          }
        }
        if (!isRefMatch) {
          blockStart = n + 1
          continue
        }

        // parse start coordinate
        const startCoordinate =
          parseIntFromBytes(buffer, tabs[startCol - 1]! + 1, tabs[startCol]!) +
          coordinateOffset

        if (startCoordinate >= end) {
          return
        }

        // parse end coordinate
        let endCoordinate: number
        if (endCol === 0 || endCol === startCol) {
          endCoordinate = startCoordinate + 1
        } else if (isVCF) {
          endCoordinate = getVcfEnd(
            buffer,
            startCoordinate,
            tabs[3]! + 1,
            tabs[4]!,
            tabs[endCol - 1]! + 1,
            tabs[endCol]!,
          )
        } else {
          endCoordinate = parseIntFromBytes(
            buffer,
            tabs[endCol - 1]! + 1,
            tabs[endCol]!,
          )
        }

        if (endCoordinate > start) {
          // trim a CRLF terminator, matching htslib's line reader
          const lineEnd = buffer[n - 1] === CARRIAGE_RETURN ? n - 1 : n
          const line = decoder.decode(buffer.subarray(blockStart, lineEnd))
          callback(
            line,
            calculateFileOffset(
              cpositions,
              dpositions,
              pos,
              blockStart,
              minvDataPosition,
            ),
            startCoordinate,
            endCoordinate,
          )
        }
        blockStart = n + 1
      }

      // every line in this chunk was still inside the query, so the next chunk
      // has to be examined too - widen the window and start the reads for it
      readAhead = Math.min(readAhead * 2, MAX_READ_AHEAD_CHUNKS)
      ensureReadsStarted(ci + 1 + readAhead)
    }
  }

  /** @internal */
  async getMetadata(opts: Options = {}) {
    return this.index.getMetadata(opts)
  }

  /**
   * The file's leading blocks, decompressed: everything from the start through
   * the end of the block holding the first data line.
   */
  private async readHeaderBytes(opts: Options) {
    const { firstDataLine, maxBlockSize } = await this.getMetadata(opts)

    const maxFetch = (firstDataLine?.blockPosition ?? 0) + maxBlockSize
    // TODO: what if we don't have a firstDataLine, and the header actually
    // takes up more than one block? this case is not covered here

    const buf = await this.filehandle.read(maxFetch, 0, opts)
    return unzip(buf)
  }

  /**
   * Both header forms, from one read of the same bytes: the commented block
   * `tabix -H` prints, and the rows `tabix -S N` counted.
   *
   * Memoized, because asking for one and then the other is the normal way to
   * find a header whichever way the file keeps it (see `getHeaderLines`), and
   * that used to fetch and decompress the file's leading blocks twice. Only
   * the parsed results are retained — the decompressed bytes are dropped,
   * which matters for a VCF header that can run to megabytes.
   */
  private async parseHeader(opts: Options) {
    const { metaChar, skipLines = 0 } = await this.getMetadata(opts)
    const bytes = await this.readHeaderBytes(opts)
    return {
      header: textDecoder.decode(
        metaChar ? trimToMetaLines(bytes, metaChar) : bytes,
      ),
      skippedLines: skipLines > 0 ? firstLines(bytes, skipLines) : [],
    }
  }

  /**
   * Parse the header, or join the parse already running.
   *
   * `parseHeader` threads `opts` into both `getMetadata` and the header read,
   * so memoizing it on the first caller's opts put that caller's signal in
   * charge of a read every later caller joins: when it aborted, they failed
   * with its cancellation, their own signals untouched.
   *
   * The same cache the chunk reads use, and the same rule: the parse runs under
   * a signal of its own and is cancelled only once every caller waiting on it
   * has given up, so one caller's abort is reported to that caller alone and a
   * bystander gets the parse already in flight. There is no retry here because
   * there is nothing to retry — the parse a bystander joined is not cancelled by
   * someone else's abort. A rejection is dropped rather than cached, so a
   * transient failure does not poison the header for the life of the file.
   *
   * The fill is per call rather than on the cache, so the caller that starts the
   * parse has its `onProgress` reach the index download inside `getMetadata`.
   *
   * SYNC: ~/src/gmod/bam-js/src/bamFile.ts getHeader — same shape for the same
   * reason, on the header rather than the index.
   */
  private getParsedHeader(opts: Options = {}) {
    return this.headerCache.get('header', opts.signal, signal =>
      this.parseHeader({ ...opts, signal }),
    )
  }

  /**
   * The bytes of the commented header. Deliberately not memoized, unlike the
   * string form: this hands back the buffer, and holding one for the lifetime
   * of the file is the caller's decision to make.
   */
  async getHeaderBuffer(opts: Options = {}) {
    const { metaChar } = await this.getMetadata(opts)
    const bytes = await this.readHeaderBytes(opts)
    return metaChar ? trimToMetaLines(bytes, metaChar) : bytes
  }

  /**
   * The leading lines the index says to skip — `tabix -S N` — which is where a
   * file whose header row is not commented keeps it. Empty when the index
   * records no skipped lines.
   *
   * Deliberately not part of `getHeader`. htslib draws the same distinction:
   * its indexer treats a line as non-data when `lineno <= line_skip` OR it
   * begins with the meta character (tbx.c), while `tabix -H` prints only the
   * leading meta-character lines and never consults line_skip (tabix.c).
   * `getHeader` mirrors `-H`, so a bare header row is absent from it, and
   * callers that need one were left re-reading the file themselves — guessing
   * at a read size, and unable to tell a headerless file from an uncommented
   * one. PLINK `.ld`, bedGraph and BED deflines are all routinely written this
   * way.
   */
  async getSkippedLines(opts: Options = {}) {
    const { skipLines = 0 } = await this.getMetadata(opts)
    // the index already answers this without reading the file at all
    if (skipLines <= 0) {
      return []
    }
    return (await this.getParsedHeader(opts)).skippedLines
  }

  async getHeader(opts: Options = {}) {
    return (await this.getParsedHeader(opts)).header
  }

  /**
   * The file's header lines, however that file keeps them: the meta-character
   * block when there is one, and otherwise the rows the index counted. Empty
   * lines are dropped.
   *
   * The two halves answer different questions (see `getSkippedLines`), but
   * "what are this file's header lines" is nearly always the question a caller
   * actually has, and answering it from `getHeader` alone is wrong in a way
   * that doesn't announce itself: a bare header row comes back as the empty
   * string, indistinguishable from a file that has no header, so callers fall
   * back to an assumed column layout and quietly mis-name columns. Deciding it
   * here also means one read of the leading blocks instead of two.
   */
  async getHeaderLines(opts: Options = {}) {
    const { header, skippedLines } = await this.getParsedHeader(opts)
    return (header ? header.split(/\r?\n/) : skippedLines).filter(Boolean)
  }

  async getReferenceSequenceNames(opts: Options = {}) {
    const metadata = await this.getMetadata(opts)
    return metadata.refIdToName
  }

  /** @param refName reference sequence name */
  async lineCount(refName: string, opts: Options = {}) {
    return this.index.lineCount(refName, opts)
  }

  /** @internal */
  async readChunk(c: Chunk, opts: Options = {}) {
    const ret = await this.filehandle.read(
      c.fetchedSize(),
      c.minv.blockPosition,
      opts,
    )
    return unzipChunkSlice(ret, c)
  }
}
