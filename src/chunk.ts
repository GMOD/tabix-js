import VirtualOffset from './virtualOffset.ts'

// little class representing a chunk in the index
export default class Chunk {
  public minv: VirtualOffset
  public maxv: VirtualOffset
  public bin: number
  public _fetchedSize?: number

  constructor(
    minv: VirtualOffset,
    maxv: VirtualOffset,
    bin: number,
    fetchedSize?: number,
  ) {
    this.minv = minv
    this.maxv = maxv
    this.bin = bin
    this._fetchedSize = fetchedSize
  }

  toUniqueString() {
    return `${this.minv}..${this.maxv} (bin ${
      this.bin
    }, fetchedSize ${this.fetchedSize()})`
  }

  toString() {
    return this.toUniqueString()
  }

  compareTo(b: Chunk) {
    return (
      this.minv.compareTo(b.minv) ||
      this.maxv.compareTo(b.maxv) ||
      this.bin - b.bin
    )
  }

  fetchedSize() {
    if (this._fetchedSize !== undefined) {
      return this._fetchedSize
    }
    return this.maxv.blockPosition + (1 << 16) - this.minv.blockPosition
  }
}
