export default class VirtualOffset {
  public blockPosition: number
  public dataPosition: number
  constructor(blockPosition: number, dataPosition: number) {
    this.blockPosition = blockPosition // < offset of the compressed data block
    this.dataPosition = dataPosition // < offset into the uncompressed data
  }

  toString() {
    return `${this.blockPosition}:${this.dataPosition}`
  }

  compareTo(b: VirtualOffset) {
    return (
      this.blockPosition - b.blockPosition || this.dataPosition - b.dataPosition
    )
  }
}
export function fromBytes(bytes: Uint8Array, offset = 0) {
  return new VirtualOffset(
    bytes[offset + 7] * 0x1_00_00_00_00_00 +
      bytes[offset + 6] * 0x1_00_00_00_00 +
      bytes[offset + 5] * 0x1_00_00_00 +
      bytes[offset + 4] * 0x1_00_00 +
      bytes[offset + 3] * 0x1_00 +
      bytes[offset + 2],
    (bytes[offset + 1] << 8) | bytes[offset],
  )
}
