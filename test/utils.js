const fs = typeof __webpack_require__ !== 'function' ? require('fs') : null // eslint-disable-line camelcase

let extended = xit
try {
  if (fs.existsSync(require.resolve(`./extended_data/out.sorted.gff.gz`)))
    extended = it
} catch (e) {
  // ignore
  console.warn(
    'extended tests disabled, download the extended test dataset and fix all the symlinks in test/extended_data to enable them',
  )
}

const REWRITE_EXPECTED_DATA =
  typeof process !== 'undefined' &&
  process.env.TABIXJS_REWRITE_EXPECTED_DATA &&
  process.env.TABIXJS_REWRITE_EXPECTED_DATA !== '0' &&
  process.env.TABIXJS_REWRITE_EXPECTED_DATA !== 'false'

module.exports = {
  extended,
  REWRITE_EXPECTED_DATA,
  fs,
}
