import path from 'path'
import { fileURLToPath } from 'url'

// Get the directory name equivalent to __dirname in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default {
  mode: 'production',
  entry: './dist/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'tabix-bundle.js',
    library: 'gmodTABIX',
    libraryTarget: 'window',
  },
}
