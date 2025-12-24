import { bench, describe } from 'vitest'

// Sample GFF3 lines for benchmarking
const sampleLines = [
  'NC_000001.11\tBestRefSeq\tgene\t11874\t14409\t.\t+\t.\tID=gene-DDX11L1;Name=DDX11L1',
  'NC_000001.11\tBestRefSeq\tmRNA\t11874\t14409\t.\t+\t.\tID=rna-NR_046018.2;Parent=gene-DDX11L1',
  'NC_000001.11\tBestRefSeq\texon\t11874\t12227\t.\t+\t.\tID=exon-NR_046018.2-1;Parent=rna-NR_046018.2',
  'NC_000001.11\tBestRefSeq\texon\t12613\t12721\t.\t+\t.\tID=exon-NR_046018.2-2;Parent=rna-NR_046018.2',
  'NC_000001.11\tBestRefSeq\texon\t13221\t14409\t.\t+\t.\tID=exon-NR_046018.2-3;Parent=rna-NR_046018.2',
  'NC_000002.12\tBestRefSeq\tgene\t38814\t46588\t.\t-\t.\tID=gene-FAM110C;Name=FAM110C',
  'NC_000002.12\tBestRefSeq\tmRNA\t38814\t46588\t.\t-\t.\tID=rna-NM_001077710.3;Parent=gene-FAM110C',
  'chr1\tRefSeq\tgene\t100000\t200000\t.\t+\t.\tID=gene-TEST;Name=TEST',
  'chr1\tRefSeq\texon\t100000\t110000\t.\t+\t.\tID=exon-TEST-1;Parent=gene-TEST',
  'chr1\tRefSeq\texon\t150000\t160000\t.\t+\t.\tID=exon-TEST-2;Parent=gene-TEST',
]

// Typical GFF column config: ref=1, start=4, end=5
const refColumn = 1
const startColumn = 4
const endColumn = 5
const maxColumn = 5
const metaCharCode = '#'.charCodeAt(0)
const coordinateOffset = -1 // 1-based to 0-based
const regionRefName = 'NC_000001.11'
const regionStart = 10000
const regionEnd = 15000

// Current implementation (inline charCodeAt comparison + inline parseInt)
function checkLineCurrentImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  let currentColumnNumber = 1
  let currentColumnStart = 0
  let startCoordinate = -Infinity
  let endCoordinate = -Infinity
  const l = line.length
  let tabPos = line.indexOf('\t', currentColumnStart)

  while (currentColumnNumber <= maxColumn) {
    const columnEnd = tabPos === -1 ? l : tabPos

    if (currentColumnNumber === refColumn) {
      const colLen = columnEnd - currentColumnStart
      if (colLen !== regionRefName.length) {
        return
      }
      let match = true
      for (let i = 0; i < colLen; i++) {
        if (
          line.charCodeAt(currentColumnStart + i) !==
          regionRefName.charCodeAt(i)
        ) {
          match = false
          break
        }
      }
      if (!match) {
        return
      }
    } else if (currentColumnNumber === startColumn) {
      startCoordinate = coordinateOffset
      for (let i = currentColumnStart; i < columnEnd; i++) {
        const c = line.charCodeAt(i)
        if (c >= 48 && c <= 57) {
          startCoordinate = startCoordinate * 10 + (c - 48)
        }
      }
      if (startCoordinate >= regionEnd) {
        return null
      }
      if (endColumn === 0 || endColumn === startColumn) {
        endCoordinate = startCoordinate + 1
        if (endCoordinate <= regionStart) {
          return
        }
      }
    } else if (currentColumnNumber === endColumn) {
      endCoordinate = 0
      for (let i = currentColumnStart; i < columnEnd; i++) {
        const c = line.charCodeAt(i)
        if (c >= 48 && c <= 57) {
          endCoordinate = endCoordinate * 10 + (c - 48)
        }
      }
      if (endCoordinate <= regionStart) {
        return
      }
    }

    if (currentColumnNumber === maxColumn) {
      break
    }

    currentColumnStart = columnEnd + 1
    currentColumnNumber += 1
    tabPos = line.indexOf('\t', currentColumnStart)
  }
  return { start: startCoordinate, end: endCoordinate }
}

// Alternative: slice + comparison (original approach)
function checkLineSliceImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  let currentColumnNumber = 1
  let currentColumnStart = 0
  let startCoordinate = -Infinity
  let endCoordinate = -Infinity
  const l = line.length
  let tabPos = line.indexOf('\t', currentColumnStart)

  while (currentColumnNumber <= maxColumn) {
    const columnEnd = tabPos === -1 ? l : tabPos

    if (currentColumnNumber === refColumn) {
      if (line.slice(currentColumnStart, columnEnd) !== regionRefName) {
        return
      }
    } else if (currentColumnNumber === startColumn) {
      startCoordinate =
        Number.parseInt(line.slice(currentColumnStart, columnEnd), 10) +
        coordinateOffset
      if (startCoordinate >= regionEnd) {
        return null
      }
      if (endColumn === 0 || endColumn === startColumn) {
        endCoordinate = startCoordinate + 1
        if (endCoordinate <= regionStart) {
          return
        }
      }
    } else if (currentColumnNumber === endColumn) {
      endCoordinate = Number.parseInt(
        line.slice(currentColumnStart, columnEnd),
        10,
      )
      if (endCoordinate <= regionStart) {
        return
      }
    }

    if (currentColumnNumber === maxColumn) {
      break
    }

    currentColumnStart = columnEnd + 1
    currentColumnNumber += 1
    tabPos = line.indexOf('\t', currentColumnStart)
  }
  return { start: startCoordinate, end: endCoordinate }
}

// Alternative: split-based (simplest but creates array)
function checkLineSplitImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  const fields = line.split('\t')
  const ref = fields[refColumn - 1]
  if (ref !== regionRefName) {
    return
  }

  const startCoordinate = +fields[startColumn - 1]! + coordinateOffset
  if (startCoordinate >= regionEnd) {
    return null
  }

  const endCoordinate = +fields[endColumn - 1]!
  if (endCoordinate <= regionStart) {
    return
  }

  return { start: startCoordinate, end: endCoordinate }
}

// Alternative: find all tabs first, then index
function checkLinePreIndexImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  // Find tab positions for columns we need (up to maxColumn)
  const tabs: number[] = [-1]
  let pos = 0
  for (let i = 0; i < maxColumn && pos !== -1; i++) {
    pos = line.indexOf('\t', tabs[i]! + 1)
    tabs.push(pos === -1 ? line.length : pos)
  }

  // Check ref (column 1)
  const refStart = tabs[0]! + 1
  const refEnd = tabs[1]!
  const colLen = refEnd - refStart
  if (colLen !== regionRefName.length) {
    return
  }
  for (let i = 0; i < colLen; i++) {
    if (line.charCodeAt(refStart + i) !== regionRefName.charCodeAt(i)) {
      return
    }
  }

  // Parse start (column 4)
  const startStart = tabs[3]! + 1
  const startEnd = tabs[4]!
  let startCoordinate = coordinateOffset
  for (let i = startStart; i < startEnd; i++) {
    const c = line.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      startCoordinate = startCoordinate * 10 + (c - 48)
    }
  }
  if (startCoordinate >= regionEnd) {
    return null
  }

  // Parse end (column 5)
  const endStart = tabs[4]! + 1
  const endEnd = tabs[5] ?? line.length
  let endCoordinate = 0
  for (let i = endStart; i < endEnd; i++) {
    const c = line.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      endCoordinate = endCoordinate * 10 + (c - 48)
    }
  }
  if (endCoordinate <= regionStart) {
    return
  }

  return { start: startCoordinate, end: endCoordinate }
}

// Alternative: Use substring instead of slice
function checkLineSubstringImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  let currentColumnNumber = 1
  let currentColumnStart = 0
  let startCoordinate = -Infinity
  let endCoordinate = -Infinity
  const l = line.length
  let tabPos = line.indexOf('\t', currentColumnStart)

  while (currentColumnNumber <= maxColumn) {
    const columnEnd = tabPos === -1 ? l : tabPos

    if (currentColumnNumber === refColumn) {
      if (line.substring(currentColumnStart, columnEnd) !== regionRefName) {
        return
      }
    } else if (currentColumnNumber === startColumn) {
      startCoordinate =
        +line.substring(currentColumnStart, columnEnd) + coordinateOffset
      if (startCoordinate >= regionEnd) {
        return null
      }
      if (endColumn === 0 || endColumn === startColumn) {
        endCoordinate = startCoordinate + 1
        if (endCoordinate <= regionStart) {
          return
        }
      }
    } else if (currentColumnNumber === endColumn) {
      endCoordinate = +line.substring(currentColumnStart, columnEnd)
      if (endCoordinate <= regionStart) {
        return
      }
    }

    if (currentColumnNumber === maxColumn) {
      break
    }

    currentColumnStart = columnEnd + 1
    currentColumnNumber += 1
    tabPos = line.indexOf('\t', currentColumnStart)
  }
  return { start: startCoordinate, end: endCoordinate }
}

// Hybrid: indexOf chain + slice === + unary plus (avoids splitting long lines)
function checkLineHybridImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  // Find tab positions up to maxColumn (avoids splitting long attribute columns)
  const tabs: number[] = [-1]
  for (let i = 0; i < maxColumn; i++) {
    const pos = line.indexOf('\t', tabs[i]! + 1)
    if (pos === -1) {
      tabs.push(line.length)
      break
    }
    tabs.push(pos)
  }

  // Check ref column (use slice === for comparison)
  const ref = line.slice(tabs[refColumn - 1]! + 1, tabs[refColumn]!)
  if (ref !== regionRefName) {
    return
  }

  // Parse start coordinate (use +slice for parsing)
  const startCoordinate =
    +line.slice(tabs[startColumn - 1]! + 1, tabs[startColumn]!) +
    coordinateOffset
  if (startCoordinate >= regionEnd) {
    return null
  }

  // Parse end coordinate
  const endCoordinate = +line.slice(tabs[endColumn - 1]! + 1, tabs[endColumn]!)
  if (endCoordinate <= regionStart) {
    return
  }

  return { start: startCoordinate, end: endCoordinate }
}

// Hybrid with inline tab finding (no array allocation)
function checkLineHybridInlineImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  // Find tabs inline without array
  const t0 = line.indexOf('\t')
  const t1 = line.indexOf('\t', t0 + 1)
  const t2 = line.indexOf('\t', t1 + 1)
  const t3 = line.indexOf('\t', t2 + 1)
  const t4 = line.indexOf('\t', t3 + 1)
  const t5 = t4 === -1 ? line.length : line.indexOf('\t', t4 + 1)

  // Check ref (column 1: 0 to t0)
  const ref = line.slice(0, t0)
  if (ref !== regionRefName) {
    return
  }

  // Parse start (column 4: t3+1 to t4)
  const startCoordinate = +line.slice(t3 + 1, t4) + coordinateOffset
  if (startCoordinate >= regionEnd) {
    return null
  }

  // Parse end (column 5: t4+1 to t5)
  const endCoordinate = +line.slice(t4 + 1, t5 === -1 ? line.length : t5)
  if (endCoordinate <= regionStart) {
    return
  }

  return { start: startCoordinate, end: endCoordinate }
}

// Final implementation: indexOf chain with dynamic columns via small array
function checkLineFinalImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  // Find tab positions up to maxColumn using indexOf chain
  let prev = -1
  const tabs = [-1]
  for (let i = 0; i < maxColumn; i++) {
    const pos = line.indexOf('\t', prev + 1)
    if (pos === -1) {
      tabs.push(line.length)
      break
    }
    tabs.push(pos)
    prev = pos
  }

  // Check ref column
  const ref = line.slice(tabs[refColumn - 1]! + 1, tabs[refColumn])
  if (ref !== regionRefName) {
    return
  }

  // Parse start coordinate
  const startCoordinate =
    +line.slice(tabs[startColumn - 1]! + 1, tabs[startColumn]) +
    coordinateOffset
  if (startCoordinate >= regionEnd) {
    return null
  }

  // Parse end coordinate
  const endCoordinate = +line.slice(tabs[endColumn - 1]! + 1, tabs[endColumn])
  if (endCoordinate <= regionStart) {
    return
  }

  return { start: startCoordinate, end: endCoordinate }
}

// Length-based fast path: split for short lines, indexOf for long lines
function checkLineLengthBasedImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  if (line.length < 500) {
    // Fast path for short lines - use split
    const fields = line.split('\t')
    const ref = fields[refColumn - 1]!
    if (ref !== regionRefName) {
      return
    }
    const startCoordinate = +fields[startColumn - 1]! + coordinateOffset
    if (startCoordinate >= regionEnd) {
      return null
    }
    const endCoordinate = +fields[endColumn - 1]!
    if (endCoordinate <= regionStart) {
      return
    }
    return { start: startCoordinate, end: endCoordinate }
  }

  // Long lines - use indexOf chain (avoids parsing long attribute column)
  const t0 = line.indexOf('\t')
  const t1 = line.indexOf('\t', t0 + 1)
  const t2 = line.indexOf('\t', t1 + 1)
  const t3 = line.indexOf('\t', t2 + 1)
  const t4 = line.indexOf('\t', t3 + 1)
  const t5 = t4 === -1 ? line.length : line.indexOf('\t', t4 + 1)

  const ref = line.slice(0, t0)
  if (ref !== regionRefName) {
    return
  }

  const startCoordinate = +line.slice(t3 + 1, t4) + coordinateOffset
  if (startCoordinate >= regionEnd) {
    return null
  }

  const endCoordinate = +line.slice(t4 + 1, t5 === -1 ? line.length : t5)
  if (endCoordinate <= regionStart) {
    return
  }

  return { start: startCoordinate, end: endCoordinate }
}

// Limited split - only split up to maxColumn (avoids long attribute column)
function checkLineLimitedSplitImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  // Split only up to maxColumn + 1 fields (avoids parsing long attribute column)
  const fields = line.split('\t', maxColumn + 1)

  // Check ref column
  const ref = fields[refColumn - 1]!
  if (ref !== regionRefName) {
    return
  }

  // Parse start coordinate
  const startCoordinate = +fields[startColumn - 1]! + coordinateOffset
  if (startCoordinate >= regionEnd) {
    return null
  }

  // Parse end coordinate
  const endCoordinate = +fields[endColumn - 1]!
  if (endCoordinate <= regionStart) {
    return
  }

  return { start: startCoordinate, end: endCoordinate }
}

// Inline t0-t9, then array lookup (no loop, no push)
function checkLineInlineLookupImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  // Inline indexOf chain for first 10 columns (covers 99.9% of cases)
  const t0 = line.indexOf('\t')
  const t1 = line.indexOf('\t', t0 + 1)
  const t2 = line.indexOf('\t', t1 + 1)
  const t3 = line.indexOf('\t', t2 + 1)
  const t4 = line.indexOf('\t', t3 + 1)
  const t5 = line.indexOf('\t', t4 + 1)
  const t6 = line.indexOf('\t', t5 + 1)
  const t7 = line.indexOf('\t', t6 + 1)
  const t8 = line.indexOf('\t', t7 + 1)
  const t9 = line.indexOf('\t', t8 + 1)

  // Lookup array (no loop, no push - just array literal)
  const tabs = [-1, t0, t1, t2, t3, t4, t5, t6, t7, t8, t9]

  // Check ref column
  const ref = line.slice(tabs[refColumn - 1]! + 1, tabs[refColumn])
  if (ref !== regionRefName) {
    return
  }

  // Parse start coordinate
  const startCoordinate =
    +line.slice(tabs[startColumn - 1]! + 1, tabs[startColumn]) +
    coordinateOffset
  if (startCoordinate >= regionEnd) {
    return null
  }

  // Parse end coordinate
  const endCoordinate = +line.slice(tabs[endColumn - 1]! + 1, tabs[endColumn])
  if (endCoordinate <= regionStart) {
    return
  }

  return { start: startCoordinate, end: endCoordinate }
}

// Original implementation with slice + parseInt (for comparison)
function checkLineSliceParsIntImpl(
  line: string,
): { start: number; end: number } | null | undefined {
  if (line.charCodeAt(0) === metaCharCode) {
    return
  }

  const t0 = line.indexOf('\t')
  const t1 = line.indexOf('\t', t0 + 1)
  const t2 = line.indexOf('\t', t1 + 1)
  const t3 = line.indexOf('\t', t2 + 1)
  const t4 = line.indexOf('\t', t3 + 1)
  const t5 = t4 === -1 ? line.length : line.indexOf('\t', t4 + 1)

  // Check ref (column 1: 0 to t0)
  if (line.slice(0, t0) !== regionRefName) {
    return
  }

  // Parse start (column 4: t3+1 to t4)
  const startCoordinate =
    Number.parseInt(line.slice(t3 + 1, t4), 10) + coordinateOffset
  if (startCoordinate >= regionEnd) {
    return null
  }

  // Parse end (column 5: t4+1 to t5)
  const endCoordinate = Number.parseInt(
    line.slice(t4 + 1, t5 === -1 ? line.length : t5),
    10,
  )
  if (endCoordinate <= regionStart) {
    return
  }

  return { start: startCoordinate, end: endCoordinate }
}

describe('checkLine implementations', () => {
  bench('current (charCodeAt + inline parseInt)', () => {
    for (const line of sampleLines) {
      checkLineCurrentImpl(line)
    }
  })

  bench('slice + parseInt (loop)', () => {
    for (const line of sampleLines) {
      checkLineSliceImpl(line)
    }
  })

  bench('split-based', () => {
    for (const line of sampleLines) {
      checkLineSplitImpl(line)
    }
  })

  bench('pre-index tabs (array)', () => {
    for (const line of sampleLines) {
      checkLinePreIndexImpl(line)
    }
  })

  bench('substring + unary plus', () => {
    for (const line of sampleLines) {
      checkLineSubstringImpl(line)
    }
  })

  bench('hybrid (array + slice + unary)', () => {
    for (const line of sampleLines) {
      checkLineHybridImpl(line)
    }
  })

  bench('hybrid inline (no array)', () => {
    for (const line of sampleLines) {
      checkLineHybridInlineImpl(line)
    }
  })

  bench('inline indexOf + slice + parseInt', () => {
    for (const line of sampleLines) {
      checkLineSliceParsIntImpl(line)
    }
  })

  bench('FINAL (dynamic cols + indexOf chain + small array)', () => {
    for (const line of sampleLines) {
      checkLineFinalImpl(line)
    }
  })

  bench('INLINE LOOKUP (t0-t9 inline + array literal)', () => {
    for (const line of sampleLines) {
      checkLineInlineLookupImpl(line)
    }
  })

  bench('LIMITED SPLIT (split with limit)', () => {
    for (const line of sampleLines) {
      checkLineLimitedSplitImpl(line)
    }
  })

  bench('LENGTH-BASED (split if <500, indexOf if long)', () => {
    for (const line of sampleLines) {
      checkLineLengthBasedImpl(line)
    }
  })
})

// Long lines with large attribute columns (realistic GFF3)
const longAttrBase =
  'ID=gene-TEST;Name=TEST;Dbxref=GeneID:123,HGNC:456;Description='
const longDescription =
  'This is a very long description that contains lots of text '.repeat(100)
const longLines = [
  `NC_000001.11\tBestRefSeq\tgene\t11874\t14409\t.\t+\t.\t${longAttrBase}${longDescription}`,
  `NC_000001.11\tBestRefSeq\tmRNA\t11874\t14409\t.\t+\t.\t${longAttrBase}${longDescription}`,
  `NC_000001.11\tBestRefSeq\texon\t11874\t12227\t.\t+\t.\t${longAttrBase}${longDescription}`,
  `NC_000002.12\tBestRefSeq\tgene\t38814\t46588\t.\t-\t.\t${longAttrBase}${longDescription}`,
  `chr1\tRefSeq\tgene\t100000\t200000\t.\t+\t.\t${longAttrBase}${longDescription}`,
]

describe('checkLine with LONG lines (~6KB each)', () => {
  bench('split-based', () => {
    for (const line of longLines) {
      checkLineSplitImpl(line)
    }
  })

  bench('hybrid inline (no array)', () => {
    for (const line of longLines) {
      checkLineHybridInlineImpl(line)
    }
  })

  bench('current (charCodeAt + inline parseInt)', () => {
    for (const line of longLines) {
      checkLineCurrentImpl(line)
    }
  })

  bench('inline indexOf + slice + parseInt', () => {
    for (const line of longLines) {
      checkLineSliceParsIntImpl(line)
    }
  })

  bench('FINAL (dynamic cols + indexOf chain + small array)', () => {
    for (const line of longLines) {
      checkLineFinalImpl(line)
    }
  })

  bench('INLINE LOOKUP (t0-t9 inline + array literal)', () => {
    for (const line of longLines) {
      checkLineInlineLookupImpl(line)
    }
  })

  bench('LIMITED SPLIT (split with limit)', () => {
    for (const line of longLines) {
      checkLineLimitedSplitImpl(line)
    }
  })

  bench('LENGTH-BASED (split if <500, indexOf if long)', () => {
    for (const line of longLines) {
      checkLineLengthBasedImpl(line)
    }
  })
})

describe('Individual operations', () => {
  const testLine = sampleLines[0]!

  describe('Tab finding', () => {
    bench('indexOf chain', () => {
      const t0 = testLine.indexOf('\t')
      const t1 = testLine.indexOf('\t', t0 + 1)
      const t2 = testLine.indexOf('\t', t1 + 1)
      const t3 = testLine.indexOf('\t', t2 + 1)
      const t4 = testLine.indexOf('\t', t3 + 1)
      void t4
    })

    bench('split then access', () => {
      const fields = testLine.split('\t')
      void fields[4]
    })
  })

  describe('String comparison', () => {
    const start = 0
    const end = testLine.indexOf('\t')

    bench('slice ===', () => {
      const result = testLine.slice(start, end) === regionRefName
      void result
    })

    bench('charCodeAt loop', () => {
      const colLen = end - start
      let match = colLen === regionRefName.length
      if (match) {
        for (let i = 0; i < colLen; i++) {
          if (testLine.charCodeAt(start + i) !== regionRefName.charCodeAt(i)) {
            match = false
            break
          }
        }
      }
      void match
    })

    bench('substring ===', () => {
      const result = testLine.substring(start, end) === regionRefName
      void result
    })
  })

  describe('Integer parsing', () => {
    const numStr = '11874'
    const start = 0
    const end = numStr.length

    bench('parseInt', () => {
      const result = Number.parseInt(numStr, 10)
      void result
    })

    bench('unary plus', () => {
      const result = +numStr
      void result
    })

    bench('charCodeAt loop', () => {
      let result = 0
      for (let i = start; i < end; i++) {
        const c = numStr.charCodeAt(i)
        if (c >= 48 && c <= 57) {
          result = result * 10 + (c - 48)
        }
      }
      void result
    })

    bench('Number()', () => {
      const result = Number(numStr)
      void result
    })
  })
})
