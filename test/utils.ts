//@ts-nocheck
//eslint-disable-next-line @typescript-eslint/camelcase
const fs = typeof __webpack_require__ !== 'function' ? require('fs') : null // eslint-disable-line camelcase

const REWRITE_EXPECTED_DATA =
  typeof process !== 'undefined' &&
  process.env.TABIXJS_REWRITE_EXPECTED_DATA &&
  process.env.TABIXJS_REWRITE_EXPECTED_DATA !== '0' &&
  process.env.TABIXJS_REWRITE_EXPECTED_DATA !== 'false'

module.exports = {
  REWRITE_EXPECTED_DATA,
  fs,
}
