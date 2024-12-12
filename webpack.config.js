const path = require('path')

module.exports = {
  mode: 'production',
  entry: './dist/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'tabix-bundle.js',
    library: 'gmodTABIX',
    libraryTarget: 'window',
  },
}
