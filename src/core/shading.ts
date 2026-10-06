/** MeshData の法線を再計算してシェーディングを切り替える */
import { Vector3 } from 'three'
import { soupToMeshData, type Soup } from './merge'
import type { MeshData, Shading } from './types'

/** グローシェーディング時、これ未満の折れ角は滑らかにつなぐ（プリミティブと同じ 60°） */
export const CREASE_ANGLE = Math.PI / 3

export function reshadeMeshData(m: MeshData, shading: Shading): MeshData {
  const triCount = m.indices.length / 3
  const color = new Array<number>(triCount).fill(0)
  for (const g of m.groups) for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) color[t] = g.color

  // 位置で溶接した頂点ID と面法線（面積重み付きのため正規化前の外積も保持）
  const key = (i: number) => `${m.positions[i * 3]},${m.positions[i * 3 + 1]},${m.positions[i * 3 + 2]}`
  const ids = new Map<string, number>()
  const corner: number[] = m.indices.map((i) => {
    const k = key(i)
    let id = ids.get(k)
    if (id === undefined) ids.set(k, (id = ids.size))
    return id
  })
  const p = (i: number) => new Vector3(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2])
  const faceRaw: Vector3[] = []
  const faceN: Vector3[] = []
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => p(m.indices[t * 3 + k]))
    const n = b.sub(a).cross(c.sub(a))
    faceRaw.push(n)
    faceN.push(n.clone().normalize())
  }
  const facesOf: number[][] = Array.from({ length: ids.size }, () => [])
  corner.forEach((v, i) => facesOf[v].push(Math.floor(i / 3)))

  const cos = Math.cos(CREASE_ANGLE)
  const soup: Soup = { pos: [], nor: [], color }
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = m.indices[t * 3 + k]
      soup.pos.push(m.positions[vi * 3], m.positions[vi * 3 + 1], m.positions[vi * 3 + 2])
      let n = faceN[t]
      if (shading === 'smooth') {
        const sum = new Vector3()
        for (const f of facesOf[corner[t * 3 + k]]) if (faceN[f].dot(faceN[t]) >= cos) sum.add(faceRaw[f])
        if (sum.lengthSq() > 0) n = sum.normalize()
      }
      soup.nor.push(n.x, n.y, n.z)
    }
  }
  return soupToMeshData(soup)
}
