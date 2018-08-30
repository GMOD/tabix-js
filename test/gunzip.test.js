const fs = require('fs')
const { inflateBrowser, inflateZlib } = require('../src/gunzip')

const { data } = require('./data/pako_error_buffer.json')

describe('zlib native', () => {
  const gunzip = inflateZlib
  it('native impl can gunzip the buffer that pako cannot', async () => {
    expect(data.length).toEqual(45565)
    const buf = Buffer.from(data)
    const unzipped = await gunzip(buf)
    // const unzipped = await gunzip(buf)
    expect(unzipped.length).toEqual(1922918)
  })

  it('native impl can gunzip the whole volvox.test.vcf.gz', async () => {
    const buf = fs.readFileSync(require.resolve('./data/volvox.test.vcf.gz'))
    const unzipped = await gunzip(buf)
    expect(unzipped.length).toEqual(1922918)
  })
})

describe('zlib browser', () => {
  const gunzip = inflateBrowser
  it('browser impl can gunzip the buffer that pako cannot', async () => {
    expect(data.length).toEqual(45565)
    const buf = Buffer.from(data)
    const unzipped = await gunzip(buf)
    // const unzipped = await gunzip(buf)
    expect(unzipped.length).toEqual(1922918)
  })

  it('browser impl can gunzip the whole volvox.test.vcf.gz', async () => {
    const buf = fs.readFileSync(require.resolve('./data/volvox.test.vcf.gz'))
    const unzipped = await gunzip(buf)
    expect(unzipped.length).toEqual(1922918)
  })
})