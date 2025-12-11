import Chunk from './chunk.ts'
import VirtualOffset from './virtualOffset.ts'

import type { GenericFilehandle } from 'generic-filehandle2'

export interface Options {
  signal?: AbortSignal
}

export interface IndexData {
  refNameToId: Record<string, number>
  refIdToName: string[]
  metaChar: string | undefined
  metaCharCode: number
  columnNumbers: { ref: number; start: number; end: number }
  coordinateType: string
  format: string
  [key: string]: any
}

export default abstract class IndexFile {
  public filehandle: GenericFilehandle
  private parseP?: Promise<IndexData>

  constructor({ filehandle }: { filehandle: GenericFilehandle }) {
    this.filehandle = filehandle
  }

  public abstract lineCount(refName: string, args: Options): Promise<number>

  protected abstract _parse(opts: Options): Promise<IndexData>

  public async getMetadata(opts: Options = {}) {
    const { indices: _indices, ...rest } = await this.parse(opts)
    return rest
  }

  public abstract blocksForRange(
    refName: string,
    start: number,
    end: number,
    opts: Options,
  ): Promise<Chunk[]>

  _findFirstData(
    currentFdl: VirtualOffset | undefined,
    virtualOffset: VirtualOffset,
  ) {
    if (currentFdl) {
      return currentFdl.compareTo(virtualOffset) > 0
        ? virtualOffset
        : currentFdl
    } else {
      return virtualOffset
    }
  }

  async parse(opts: Options = {}) {
    if (!this.parseP) {
      this.parseP = this._parse(opts).catch((error: unknown) => {
        this.parseP = undefined
        throw error
      })
    }
    return this.parseP
  }

  async hasRefSeq(seqId: number, opts: Options = {}) {
    const idx = await this.parse(opts)
    return !!idx.indices[seqId]?.binIndex
  }

  _parseNameBytes(namesBytes: Uint8Array) {
    let currRefId = 0
    let currNameStart = 0
    const refIdToName: string[] = []
    const refNameToId: Record<string, number> = {}
    const decoder = new TextDecoder('utf8')
    for (let i = 0; i < namesBytes.length; i += 1) {
      if (!namesBytes[i]) {
        if (currNameStart < i) {
          const refName = decoder.decode(namesBytes.subarray(currNameStart, i))
          refIdToName[currRefId] = refName
          refNameToId[refName] = currRefId
        }
        currNameStart = i + 1
        currRefId += 1
      }
    }
    return {
      refNameToId,
      refIdToName,
    }
  }
}
