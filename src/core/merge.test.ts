import { describe, expect, it } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { mergeObjects } from './merge'
import { checkMesh } from './meshCheck'
import { geometryFromMeshData, setSingleColor } from './meshData'
import { PRIMITIVES, buildPrimitiveGeometry } from './primitives'

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
    const { mesh, center } = mergeObjects([prim('cube', 1, [0, 0.05, 0]), prim('cube', 1, [0.1, 0.05, 0])])
    expect(tris(mesh)).toBe(12)
    expect(mesh.groups).toHaveLength(1)
    expect(center.x).toBeCloseTo(0.05)
  })

  it('重なった同色立方体は 12 三角形', () => {
    const { mesh } = mergeObjects([prim('cube', 1, [0, 0.05, 0]), prim('cube', 1, [0.05, 0.05, 0])])
    expect(tris(mesh)).toBe(12)
  })

  it('異なる色は group として保持される', () => {
    const { mesh } = mergeObjects([prim('cube', 1, [0, 0.05, 0]), prim('cube', 3, [0.1, 0.05, 0])])
    expect(mesh.groups.map((g) => g.color).sort()).toEqual([1, 3])
    expect(tris(mesh)).toBeLessThanOrEqual(24)
  })

  it('L字配置でも面数が少ない', () => {
    const { mesh } = mergeObjects([
      prim('cube', 0, [0, 0.05, 0]),
      prim('cube', 0, [0.1, 0.05, 0]),
      prim('cube', 0, [0, 0.15, 0]),
    ])
    // L字柱: 側面2枚は各 4 三角形以下、他の面は2三角形
    expect(tris(mesh)).toBeLessThanOrEqual(20)
  })

  it('球と立方体の結合が成功する', () => {
    const { mesh } = mergeObjects([prim('cube', 0, [0, 0.05, 0]), prim('sphere', 2, [0.05, 0.1, 0])])
    expect(tris(mesh)).toBeGreaterThan(0)
    expect(new Set(mesh.groups.map((g) => g.color))).toEqual(new Set([0, 2]))
  })

  it('45°回転した立方体との結合で面数が増えすぎない', () => {
    const { mesh } = mergeObjects([prim('cube', 0, [0, 0.05, 0]), prim('cube', 0, [0.05, 0.05, 0], Math.PI / 4)])
    // 上下面は各1ポリゴン（数三角形）、側面は 4+4 面程度
    expect(tris(mesh)).toBeLessThanOrEqual(30)
  })

  it('結合結果をさらに結合できる', () => {
    const first = mergeObjects([prim('cube', 0, [0, 0.05, 0]), prim('cube', 0, [0.1, 0.05, 0])])
    const g = geometryFromMeshData(first.mesh)
    const m = new Matrix4().makeTranslation(first.center.x, first.center.y, first.center.z)
    const { mesh } = mergeObjects([{ geometry: g, matrixWorld: m }, prim('cube', 0, [0.2, 0.05, 0])])
    expect(tris(mesh)).toBe(12)
  })

  it('結合結果に穴・裏返りがない（全プリミティブ × 4 種 × 4 配置）', () => {
    const report: string[] = []
    let nonManifold = 0
    for (const a of PRIMITIVES) {
      for (const b of ['cube', 'sphere', 'cylinder', 'stairs']) {
        for (const [pos, rot] of [
          [[0.04, 0.07, 0.03], Math.PI / 4],
          [[0.05, 0.05, 0], 0], // 底面・天面が同一平面
          [[0.02, 0.1, -0.03], Math.PI / 2],
          [[0.03, 0.05, 0.02], Math.PI / 4], // 底面が同一平面で斜め
        ] as const) {
          const { mesh } = mergeObjects([prim(a.id, 0, [0, 0.05, 0]), prim(b, 1, [...pos], rot)])
          const r = checkMesh(mesh)
          if (r.open || r.flipped) report.push(`${a.id}+${b}@${pos}: open ${r.open} flip ${r.flipped}`)
          if (r.nonManifold) nonManifold++
        }
      }
    }
    expect(report).toEqual([])
    // 辺だけで接する配置（パイプの内壁など）は幾何学的に非多様体になり得る。336 中ごく少数のみ
    expect(nonManifold).toBeLessThanOrEqual(3)
  })

  it('checkMesh は穴を検出する', () => {
    const { mesh } = mergeObjects([prim('cube', 0, [0, 0.05, 0]), prim('cube', 0, [0.1, 0.05, 0])])
    const r = checkMesh({ positions: mesh.positions, indices: mesh.indices.slice(3) })
    expect(r.open).toBe(3)
  })
})
