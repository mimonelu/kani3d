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

describe('結合元 (sources)', () => {
  it('入れ子の sources も往復できる', () => {
    const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2], groups: [{ start: 0, count: 3, color: 1 }] }
    const t = { position: cube.position, quaternion: cube.quaternion, scale: cube.scale }
    const inner: SceneObjectData = { id: 'm1', kind: 'mesh', mesh, sources: [cube], ...t }
    const doc = createDoc([{ id: 'm2', kind: 'mesh', mesh, sources: [inner, cube], ...t }])
    expect(parseDoc(stringifyDoc(doc))).toEqual(doc)
  })
})

describe('parseDoc の検証強化', () => {
  const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2] }
  const t = { position: [0, 0, 0], quaternion: [0, 0, 0, 2], scale: [1, 1, 1] }
  const doc = (objects: unknown[]) => JSON.stringify({ format: 'kani3d', version: 1, objects })

  it('重複・欠落 ID は振り直し、回転は正規化', () => {
    const d = parseDoc(doc([{ ...cube, id: 'x' }, { ...cube, id: 'x' }, { ...cube, id: '' }]))
    expect(new Set(d.objects.map((o) => o.id)).size).toBe(3)
    expect(parseDoc(doc([{ ...cube, ...t }])).objects[0].quaternion).toEqual([0, 0, 0, 1])
  })
  it('scale 0・ゼロ長回転・不正な groups・3 の倍数でない indices はエラー', () => {
    expect(() => parseDoc(doc([{ ...cube, scale: [0, 1, 1] }]))).toThrow()
    expect(() => parseDoc(doc([{ ...cube, quaternion: [0, 0, 0, 0] }]))).toThrow()
    expect(() => parseDoc(doc([{ id: 'm', kind: 'mesh', ...t, mesh: { ...mesh, groups: [{ start: 0, count: 6, color: 0 }] } }]))).toThrow()
    expect(() => parseDoc(doc([{ id: 'm', kind: 'mesh', ...t, mesh: { ...mesh, indices: [0, 1], groups: [] } }]))).toThrow()
    expect(() => parseDoc(doc([null]))).toThrow()
  })
  it('groups が空なら全体を既定色にする', () => {
    const d = parseDoc(doc([{ id: 'm', kind: 'mesh', ...t, mesh: { ...mesh, groups: [] } }]))
    expect((d.objects[0] as { mesh: { groups: unknown[] } }).mesh.groups).toHaveLength(1)
  })
})
