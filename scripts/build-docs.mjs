import { readFileSync, writeFileSync } from 'node:fs'

const header = readFileSync('docs/header.md', 'utf8')
const footer = readFileSync('docs/footer.md', 'utf8')

// TypeDoc prepends a module-level preamble before the first ## heading.
// Strip everything up to and including the top-level "# @gmod/tabix" line.
const raw = readFileSync('docs/api/api.md', 'utf8')
const apiBody = raw.replace(/^[\s\S]*?^# [^\n]+\n/m, '')

const readme = `${header.trimEnd()}\n\n## API Reference\n${apiBody.trimStart()}\n${footer}`
writeFileSync('README.md', readme)
console.log('README.md written')
