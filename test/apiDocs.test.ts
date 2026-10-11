import fs from 'node:fs'

import ts from 'typescript'
import { expect, test } from 'vitest'

const api = fs.readFileSync('docs/api.md', 'utf8')

const undocumented: Record<string, Record<string, string>> = {
  TabixIndexedFile: {
    chunkCache: 'internal state; caching.md describes the cache',
    readChunk: 'the chunk cache fills through it',
  },
  IndexFile: {
    blocksForRange: 'getLines and bytesForRegions resolve regions with it',
    parse: 'the other methods share one index parse through it',
    hasRefSeq: 'marked @internal; TabixIndexedFile never calls it',
  },
}

function source(file: string) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
}

function publicNames(members: ts.NodeArray<ts.ClassElement | ts.TypeElement>) {
  const names: string[] = []
  for (const member of members) {
    const hidden = (
      ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : []
    ).some(
      m =>
        m.kind === ts.SyntaxKind.PrivateKeyword ||
        m.kind === ts.SyntaxKind.ProtectedKeyword,
    )
    const name = member.name?.getText()
    if (
      name &&
      !hidden &&
      !name.startsWith('_') &&
      !ts.isConstructorDeclaration(member)
    ) {
      names.push(name)
    }
  }
  return names
}

// a class's members, plus the keys of its constructor's inline options type
function publicMembers(file: string, name: string) {
  const decl = source(file).statements.find(
    (s): s is ts.ClassDeclaration | ts.InterfaceDeclaration =>
      (ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s)) &&
      s.name?.text === name,
  )
  if (!decl) {
    throw new Error(`no ${name} in ${file}`)
  }
  const names = publicNames(decl.members)
  if (ts.isClassDeclaration(decl)) {
    const options = decl.members.find(ts.isConstructorDeclaration)
      ?.parameters[0]?.type
    if (options && ts.isTypeLiteralNode(options)) {
      names.push(...publicNames(options.members))
    }
  }
  return [...new Set(names)]
}

function inDocs(name: string) {
  return new RegExp(`\`([\\w.]*\\.)?${name}\\b`).test(api)
}

test.each([
  ['src/tabixIndexedFile.ts', 'TabixIndexedFile'],
  ['src/tabixIndexedFile.ts', 'GetLinesOpts'],
  ['src/indexFile.ts', 'Options'],
  ['src/indexFile.ts', 'IndexFile'],
  ['src/tbi.ts', 'TabixIndex'],
  ['src/csi.ts', 'CSI'],
  ['src/virtualOffset.ts', 'VirtualOffset'],
])('docs/api.md covers every public member of %s %s', (file, name) => {
  const skip = undocumented[name] ?? {}
  const members = publicMembers(file, name)
  expect(
    members.filter(m => !(m in skip) && !inDocs(m)),
    'document these in docs/api.md, or list them as undocumented with a reason',
  ).toEqual([])
  expect(
    Object.keys(skip).filter(m => !members.includes(m)),
    'these undocumented entries no longer exist',
  ).toEqual([])
})

test('docs/api.md covers every export', () => {
  const exported: string[] = []
  for (const statement of source('src/index.ts').statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        exported.push(element.name.text)
      }
    }
  }
  expect(exported.length).toBeGreaterThan(0)
  expect(exported.filter(name => !inDocs(name))).toEqual([])
})
