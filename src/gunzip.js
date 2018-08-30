const promisify = require('util.promisify')
const zlib =
  typeof __webpack_require__ !== 'function' ? require('zlib') : undefined
const browserifyZlib = require('browserify-zlib')

async function inflateZlib(buf) {
  const gunzip = promisify(zlib.gunzip)
  const unzipped = await gunzip(buf)
  return unzipped
}

async function inflateBrowser(buf) {
  const gunzip = promisify(browserifyZlib.gunzip)
  const unzipped = await gunzip(buf)
  return unzipped
}

module.exports = {
  gunzip: zlib ? inflateZlib : inflateBrowser,
  inflateZlib,
  inflateBrowser,
}
