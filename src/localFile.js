const promisify = require('util.promisify')

// don't load fs native module if running in webpacked code
const fs = typeof __webpack_require__ !== 'function' ? require('fs') : null // eslint-disable-line camelcase

const fsOpen = fs && promisify(fs.open)
const fsRead = fs && promisify(fs.read)
const fsFStat = fs && promisify(fs.fstat)
const fsReadFile = fs && promisify(fs.readFile)

class LocalFile {
  constructor(source) {
    this.position = 0
    this.filename = source
    this.fd = fsOpen(this.filename, 'r')
  }

  async read(buffer, offset = 0, length, position) {
    let readPosition = position
    if (readPosition === null) {
      readPosition = this.position
      this.position += length
    }
    return fsRead(await this.fd, buffer, offset, length, position)
  }

  async readFile() {
    // const fd = await this.fd
    // return new Promise((resolve,reject) => {
    //   fs.readFile(fd, null, (err,buffer) => {
    //     if (err) reject(err)
    //     else resolve(buffer)
    //   })
    // })
    return fsReadFile(this.filename)
  }

  async stat() {
    if (!this._stat) {
      this._stat = await fsFStat(await this.fd)
    }
    return this._stat
  }
}

module.exports = LocalFile
