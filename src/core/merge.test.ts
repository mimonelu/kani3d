import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { mergeObjects } from './merge'
import { geometryFromMeshData, setSingleColor } from './meshData'
import { buildPrimitiveGeometry } from './primitives'

const prim = (id: string, color: number, pos: [number, number, number], rotY = 0) => {
  const geometry = setSingleColor(buildPrimitiveGeometry(id), color)
  return { geometry, matrixWorld: new Matrix4().compose(
      new Vector3(...pos),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotY),
      new Vector3(1, 1, 1),
    ), }
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

  it('45°回転した立方体との結合で面数が増えすぎない', () => {
    const { mesh } = mergeObjects([prim('cube', 0, [0, 0.1, 0]), prim('cube', 0, [0.1, 0.1, 0], Math.PI / 4)])
    // 上下面は各1ポリゴン（数三角形）、側面は 4+4 面程度
    expect(tris(mesh)).toBeLessThanOrEqual(30)
  })

  it('結合結果をさらに結合できる', () => {
    const first = mergeObjects([prim('cube', 0, [0, 0.1, 0]), prim('cube', 0, [0.2, 0.1, 0])])
    const g = geometryFromMeshData(first.mesh)
    const m = new Matrix4().makeTranslation(first.center.x, first.center.y, first.center.z)
    const { mesh } = mergeObjects([{ geometry: g, matrixWorld: m }, prim('cube', 0, [0.4, 0.1, 0])])
    expect(tris(mesh)).toBe(12)
  })
})
