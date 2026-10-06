import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { mergeObjects } from './merge'
import { setSingleColor } from './meshData'
import { buildPrimitiveGeometry } from './primitives'

const prim = (id: string, color: number, pos: [number, number, number]) => {
  const geometry = setSingleColor(buildPrimitiveGeometry(id), color)
  return { geometry, matrixWorld: new Matrix4().compose(new Vector3(...pos), new Quaternion(), new Vector3(1, 1, 1)) }
}
const tris = (m: { indices: number[] }) => m.indices.length / 3

describe('mergeObjects', () => {
  it('隣接する同色立方体2つは 12 三角形の直方体になる', () => {
    const { mesh, center } = mergeObjects([prim('cube', 1, [0, 0.1, 0]), prim('cube', 1, [0.2, 0.1, 0])])
    expect(tris(mesh)).toBe(12)
    expect(mesh.groups).toHaveLength(1)
    expect(center.x).toBeCloseTo(0.1)
  })

  it('重なった同色立方体は 12 三角形', () => {
    const { mesh } = mergeObjects([prim('cube', 1, [0, 0.1, 0]), prim('cube', 1, [0.1, 0.1, 0])])
    expect(tris(mesh)).toBe(12)
  })

  it('異なる色は group として保持される', () => {
    const { mesh } = mergeObjects([prim('cube', 1, [0, 0.1, 0]), prim('cube', 3, [0.2, 0.1, 0])])
    expect(mesh.groups.map((g) => g.color).sort()).toEqual([1, 3])
    expect(tris(mesh)).toBeLessThanOrEqual(24)
  })

  it('L字配置でも面数が少ない', () => {
    const { mesh } = mergeObjects([
      prim('cube', 0, [0, 0.1, 0]),
      prim('cube', 0, [0.2, 0.1, 0]),
      prim('cube', 0, [0, 0.3, 0]),
    ])
    // L字柱: 側面2枚は各 4 三角形以下、他の面は2三角形
    expect(tris(mesh)).toBeLessThanOrEqual(20)
  })

  it('球と立方体の結合が成功する', () => {
    const { mesh } = mergeObjects([prim('cube', 0, [0, 0.1, 0]), prim('sphere', 2, [0.1, 0.2, 0])])
    expect(tris(mesh)).toBeGreaterThan(0)
    expect(new Set(mesh.groups.map((g) => g.color))).toEqual(new Set([0, 2]))
  })
})
