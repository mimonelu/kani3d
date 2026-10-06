import type { SceneObjectData } from './types'

/** スナップショット方式の Undo/Redo。MeshData は不変なので参照共有され、メモリは transform 分のみ増える */
export class History {
  private stack: SceneObjectData[][] = []
  private index = -1
  private keys: string[] = []

  constructor(private readonly limit = 100) {}

  reset(snapshot: SceneObjectData[]): void {
    this.stack = [snapshot]
    this.keys = [keyOf(snapshot)]
    this.index = 0
  }

  /** 直前と変化があれば積む。積んだら true */
  push(snapshot: SceneObjectData[]): boolean {
    const key = keyOf(snapshot)
    if (key === this.keys[this.index]) return false
    this.stack.splice(this.index + 1)
    this.keys.splice(this.index + 1)
    this.stack.push(snapshot)
    this.keys.push(key)
    if (this.stack.length > this.limit) {
      this.stack.shift()
      this.keys.shift()
    }
    this.index = this.stack.length - 1
    return true
  }

  undo(): SceneObjectData[] | null {
    return this.index > 0 ? this.stack[--this.index] : null
  }

  redo(): SceneObjectData[] | null {
    return this.index < this.stack.length - 1 ? this.stack[++this.index] : null
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1
  }

  get current(): SceneObjectData[] {
    return this.stack[this.index]
  }
}

const meshIds = new WeakMap<object, number>()
let meshSeq = 0

/** 比較用キー。MeshData は同一参照なら同一とみなす */
function keyOf(s: SceneObjectData[]): string {
  return JSON.stringify(s, (k, v) => {
    if (k === 'mesh' && v && typeof v === 'object') {
      if (!meshIds.has(v)) meshIds.set(v, meshSeq++)
      return `#${meshIds.get(v)}`
    }
    return v
  })
}
