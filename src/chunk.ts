import type VirtualOffset from './virtualOffset.ts'

// little class representing a chunk in the index
export default class Chunk {
  public minv: VirtualOffset
  public maxv: VirtualOffset
  public bin: number

  constructor(minv: VirtualOffset, maxv: VirtualOffset, bin: number) {
    this.minv = minv
    this.maxv = maxv
    this.bin = bin
  }

  toString() {
    return `${this.minv.toString()}..${this.maxv.toString()} (bin ${
      this.bin
    }, fetchedSize ${this.fetchedSize()})`
  }

  fetchedSize() {
    return this.maxv.blockPosition + (1 << 16) - this.minv.blockPosition
  }
}
