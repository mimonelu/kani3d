/**
 * ポリゴン単位のペイント。
 * - 色は「三角形ごとの色」から index を色順に並べ替え、groups（materialIndex = 色ID）を作り直して表す
 * - ポリゴン = ペイント単位。プリミティブは生成時の番号（userData.polyIds）、結合物は同一平面でつながった三角形
 */
import type { BufferGeometry } from 'three'
import type { MeshData } from './types'

/** 同一平面でつながった三角形に同じ番号を振る。vert(t, k) は三角形 t の k 番目の頂点座標 */
export function coplanarGroups(triCount: number, vert: (t: number, k: number) => [number, number, number]): Int32Array {
  const key = (v: [number, number, number]) => `${Math.round(v[0] * 1e6)},${Math.round(v[1] * 1e6)},${Math.round(v[2] * 1e6)}`
  const planes: number[][] = []
  const keys: string[][] = []
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = [vert(t, 0), vert(t, 1), vert(t, 2)]
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    const len = Math.hypot(n[0], n[1], n[2]) || 1
    const nn = n.map((x) => x / len)
    planes.push([...nn, nn[0] * a[0] + nn[1] * a[1] + nn[2] * a[2]])
    keys.push([key(a), key(b), key(c)])
  }
  const parent = Array.from({ length: triCount }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const owner = new Map<string, number[]>()
  for (let t = 0; t < triCount; t++) {
    for (let e = 0; e < 3; e++) {
      const a = keys[t][e], b = keys[t][(e + 1) % 3]
      const ek = a < b ? `${a}|${b}` : `${b}|${a}`
      const list = owner.get(ek) ?? []
      for (const u of list) {
        const A = planes[t], B = planes[u]
        if (A[0] * B[0] + A[1] * B[1] + A[2] * B[2] > 1 - 1e-6 && Math.abs(A[3] - B[3]) < 1e-6) parent[find(t)] = find(u)
      }
      list.push(t)
      owner.set(ek, list)
    }
  }
  const ids = new Int32Array(triCount)
  const remap = new Map<number, number>()
  for (let t = 0; t < triCount; t++) {
    const r = find(t)
    if (!remap.has(r)) remap.set(r, remap.size)
    ids[t] = remap.get(r)!
  }
  return ids
}

/** 三角形ごとの色に従って index を色順に並べ替え、groups を作り直す（polyIds も同じ順に並べ替える） */
export function applyTriangleColors(g: BufferGeometry, triColors: ArrayLike<number>): void {
  const idx = g.index!
  const n = idx.count / 3
  const order = Array.from({ length: n }, (_, t) => t).sort((a, b) => triColors[a] - triColors[b] || a - b)
  const src = Array.from(idx.array as ArrayLike<number>)
  const polyIds = g.userData.polyIds as Int32Array | undefined
  const out = new (idx.array.constructor as new (n: number) => Uint16Array | Uint32Array)(src.length)
  const newPoly = polyIds ? new Int32Array(n) : undefined
  order.forEach((t, i) => {
    out[i * 3] = src[t * 3]
    out[i * 3 + 1] = src[t * 3 + 1]
    out[i * 3 + 2] = src[t * 3 + 2]
    if (newPoly) newPoly[i] = polyIds![t]
  })
  g.setIndex(Array.from(out))
  if (newPoly) g.userData = { ...g.userData, polyIds: newPoly }
  g.clearGroups()
  let start = 0
  for (let i = 1; i <= n; i++) {
    if (i === n || triColors[order[i]] !== triColors[order[start]]) {
      g.addGroup(start * 3, (i - start) * 3, triColors[order[start]])
      start = i
    }
  }
}

/** プリミティブの三角形ごとの色（基本色＋ポリゴン別の塗り） */
export function primitiveTriColors(polyIds: Int32Array, base: number, faceColors?: Record<number, number>): number[] {
  return Array.from(polyIds, (p) => faceColors?.[p] ?? base)
}

/** MeshData の三角形ごとの色 */
export function meshTriColors(m: MeshData): number[] {
  const colors = new Array<number>(m.indices.length / 3).fill(0)
  for (const g of m.groups) for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) colors[t] = g.color
  return colors
}

const meshPolyCache = new WeakMap<MeshData, Int32Array>()

/** 結合物のポリゴン（同一平面でつながった三角形）。MeshData は不変なので参照でキャッシュ */
export function meshPolygons(m: MeshData): Int32Array {
  let ids = meshPolyCache.get(m)
  if (!ids) {
    const v = (t: number, k: number): [number, number, number] => {
      const i = m.indices[t * 3 + k] * 3
      return [m.positions[i], m.positions[i + 1], m.positions[i + 2]]
    }
    meshPolyCache.set(m, (ids = coplanarGroups(m.indices.length / 3, v)))
  }
  return ids
}

/** 結合物のポリゴン poly を color で塗った新しい MeshData（三角形を色順に並べ替える） */
export function paintMeshData(m: MeshData, poly: number, color: number): MeshData {
  const polys = meshPolygons(m)
  const colors = meshTriColors(m)
  let changed = false
  polys.forEach((p, t) => {
    if (p === poly && colors[t] !== color) {
      colors[t] = color
      changed = true
    }
  })
  if (!changed) return m
  const n = colors.length
  const order = Array.from({ length: n }, (_, t) => t).sort((a, b) => colors[a] - colors[b] || a - b)
  const indices: number[] = []
  const groups: MeshData['groups'] = []
  for (const t of order) {
    const last = groups[groups.length - 1]
    if (!last || last.color !== colors[t]) groups.push({ start: indices.length, count: 0, color: colors[t] })
    indices.push(m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2])
    groups[groups.length - 1].count += 3
  }
  const out = { ...m, indices, groups }
  // 並べ替え後のポリゴン番号も引き継ぐ（同じ形なので再計算不要）
  meshPolyCache.set(out, Int32Array.from(order, (t) => polys[t]))
  return out
}
