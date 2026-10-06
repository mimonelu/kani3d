import { describe, expect, it } from 'vitest'
import { createDoc, parseDoc, stringifyDoc } from './io'
import type { SceneObjectData } from './types'

const cube: SceneObjectData = {
  id: 'a',
  kind: 'primitive',
  primitive: 'cube',
  color: 3,
  position: [0, 0.1, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
}

describe('parseDoc', () => {
  it('往復で同じ内容になる', () => {
    const doc = createDoc([cube])
    expect(parseDoc(stringifyDoc(doc))).toEqual(doc)
  })
  it('不正な色IDは既定色に丸める', () => {
    const doc = parseDoc(stringifyDoc(createDoc([{ ...cube, color: 999 }])))
    expect((doc.objects[0] as typeof cube).color).not.toBe(999)
  })
  it('未知の形式・プリミティブ・範囲外インデックスはエラー', () => {
    expect(() => parseDoc('{"format":"x"}')).toThrow()
    expect(() => parseDoc(stringifyDoc(createDoc([{ ...cube, primitive: 'teapot' }])))).toThrow()
    const bad = { ...cube, kind: 'mesh', mesh: { positions: [0, 0, 0], normals: [0, 1, 0], indices: [0, 0, 5], groups: [] } }
    expect(() => parseDoc(JSON.stringify(createDoc([bad as never])))).toThrow()
  })
})
