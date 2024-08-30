const path = require('path')

module.exports = {
  mode: 'production',
  entry: './dist/index.js',
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/'),
    },
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'tabix-bundle.js',
    library: 'gmodTABIX',
    libraryTarget: 'window',
  },
}
