import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { parseDoc } from './io'
import { mergeObjects } from './merge'
import { checkMesh } from './meshCheck'
import { geometryFromMeshData, setSingleColor } from './meshData'
import { applyTriangleColors, primitiveTriColors } from './paint'
import { buildPrimitiveGeometry, polyIdsOf } from './primitives'
import type { SceneObjectData } from './types'

/** 実際に作られたシーンでの回帰テスト（src/core/__fixtures__） */
const load = (name: string) => parseDoc(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'))

const toInput = (d: SceneObjectData) => {
  let geometry
  if (d.kind === 'primitive') {
    geometry = buildPrimitiveGeometry(d.primitive, d.params)
    if (d.faceColors) applyTriangleColors(geometry, primitiveTriColors(polyIdsOf(geometry), d.color, d.faceColors))
    else setSingleColor(geometry, d.color)
  } else geometry = geometryFromMeshData(d.mesh)
  const matrixWorld = new Matrix4().compose(new Vector3(...d.position), new Quaternion(...d.quaternion), new Vector3(...d.scale))
  return { geometry, matrixWorld }
}

describe('fixtures', () => {
  it('crab-blocks: 面で接するブロック 35 個（float32 由来の微小誤差あり）を結合しても問題が出ない', () => {
    const doc = load('crab-blocks.kani')
    const { mesh } = mergeObjects(doc.objects.map(toInput))
    const r = checkMesh(mesh)
    expect([r.open, r.nonManifold, r.flipped]).toEqual([0, 0, 0])
    // 塗り分けた色はすべて残る
    const colors = new Set(doc.objects.flatMap((o) => (o.kind === 'primitive' ? [o.color, ...Object.values(o.faceColors ?? {})] : [])))
    expect(new Set(mesh.groups.map((g) => g.color))).toEqual(colors)
  }, 60_000)
})
