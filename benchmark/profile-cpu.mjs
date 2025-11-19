import { TabixIndexedFile } from './esm/index.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import inspector from 'inspector'
import fs from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function runBenchmark() {
  const f = new TabixIndexedFile({
    path: join(__dirname, 'test/data/1kg.chr1.subset.vcf.gz'),
  })

  let totalLines = 0
  const iterations = 100

  const session = new inspector.Session()
  session.connect()

  session.post('Profiler.enable', () => {
    session.post('Profiler.start', async () => {
      for (let iter = 0; iter < iterations; iter++) {
        let count = 0
        await f.getLines('chr1', 10109, 11000, () => {
          count++
        })
        totalLines += count
      }

      console.log(`Total lines processed: ${totalLines}`)

      session.post('Profiler.stop', (err, { profile }) => {
        if (!err) {
          fs.writeFileSync('profile.cpuprofile', JSON.stringify(profile))
          console.log('CPU profile written to profile.cpuprofile')
          console.log('View with: npx speedscope profile.cpuprofile')
        }
        session.disconnect()
      })
    })
  })
}

runBenchmark().catch(console.error)
