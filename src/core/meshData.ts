import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { MeshData } from './types'

/** MeshData → BufferGeometry（groups.materialIndex = 色ID） */
export function geometryFromMeshData(m: MeshData): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(m.positions, 3))
  g.setAttribute('normal', new Float32BufferAttribute(m.normals, 3))
  g.setIndex(m.indices)
  for (const gr of m.groups) g.addGroup(gr.start, gr.count, gr.color)
  g.computeBoundingBox()
  return g
}

export const triangleCount = (g: BufferGeometry): number =>
  (g.index ? g.index.count : g.getAttribute('position').count) / 3

/** 全面を1色にする（count に Infinity を使うと three-bvh-csg が停止するため実数を入れる） */
export function setSingleColor(g: BufferGeometry, color: number): BufferGeometry {
  g.clearGroups()
  g.addGroup(0, g.index ? g.index.count : g.getAttribute('position').count, color)
  return g
}
