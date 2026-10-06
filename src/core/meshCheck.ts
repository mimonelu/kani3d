/**
 * 結合結果の健全性チェック（位置で溶接した辺の共有状況を見る）。
 *   open:        1 枚の面にしか属さない辺 → 穴（T 字接合の隙間も含む）
 *   nonManifold: 3 枚以上の面が共有する辺 → 内部に面が残っている等
 *   flipped:     2 枚の面が同じ向きで共有する辺 → 隣り合う面の表裏が食い違う
 */
import type { MeshData } from './types'

export interface MeshIssues {
  open: number
  nonManifold: number
  flipped: number
  /** 問題のある辺の線分（ローカル座標、x1,y1,z1,x2,y2,z2 …） */
  segments: number[]
}

export function checkMesh(m: Pick<MeshData, 'positions' | 'indices'>): MeshIssues {
  // 位置で溶接（法線違いで分かれた頂点を同一視）
  const ids = new Map<string, number>()
  const rep: number[] = []
  const vid = (i: number) => {
    const k = `${Math.round(m.positions[i * 3] * 1e5)},${Math.round(m.positions[i * 3 + 1] * 1e5)},${Math.round(m.positions[i * 3 + 2] * 1e5)}`
    let id = ids.get(k)
    if (id === undefined) {
      ids.set(k, (id = rep.length))
      rep.push(i)
    }
    return id
  }
  // 無向辺ごとに [a→b の数, b→a の数]
  const edges = new Map<string, [number, number, number, number]>()
  for (let t = 0; t < m.indices.length; t += 3) {
    const v = [vid(m.indices[t]), vid(m.indices[t + 1]), vid(m.indices[t + 2])]
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3]
      const lo = Math.min(a, b), hi = Math.max(a, b)
      const key = `${lo}_${hi}`
      const e = edges.get(key) ?? [lo, hi, 0, 0]
      e[a === lo ? 2 : 3]++
      edges.set(key, e)
    }
  }
  const issues: MeshIssues = { open: 0, nonManifold: 0, flipped: 0, segments: [] }
  const p = (id: number) => {
    const i = rep[id]
    return [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]
  }
  for (const [lo, hi, fwd, back] of edges.values()) {
    const n = fwd + back
    if (n === 2 && fwd === 1) continue
    if (n === 1) issues.open++
    else if (n > 2) issues.nonManifold++
    else issues.flipped++
    issues.segments.push(...p(lo), ...p(hi))
  }
  return issues
}
