import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { MeshData } from './types'

const round = (v: number) => Math.round(v * 1e5) / 1e5

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

/** インデックス付き BufferGeometry → MeshData（座標は 0.01mm 単位に丸めて保存サイズを抑える） */
export function meshDataFromGeometry(g: BufferGeometry): MeshData {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  if (!g.index) throw new Error('indexed geometry required')
  return {
    positions: Array.from(pos.array as ArrayLike<number>, round),
    normals: Array.from(nor.array as ArrayLike<number>, (v) => Math.round(v * 1e4) / 1e4),
    indices: Array.from(g.index.array as ArrayLike<number>),
    groups: g.groups.map((gr) => ({ start: gr.start, count: gr.count, color: gr.materialIndex ?? 0 })),
  }
}

export const triangleCount = (g: BufferGeometry): number =>
  (g.index ? g.index.count : g.getAttribute('position').count) / 3

/** 全面を1色にする（count に Infinity を使うと three-bvh-csg が停止するため実数を入れる） */
export function setSingleColor(g: BufferGeometry, color: number): BufferGeometry {
  g.clearGroups()
  g.addGroup(0, g.index ? g.index.count : g.getAttribute('position').count, color)
  return g
}
