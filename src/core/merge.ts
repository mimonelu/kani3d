/**
 * オブジェクト結合: CSG 和集合 → 頂点溶接 → 同一平面・同色の面を再三角形化して面数を削減。
 * three.js の描画には依存しない（Node のユニットテストで検証可能）。
 */
import { BufferGeometry, Material, Matrix4, ShapeUtils, Vector2, Vector3 } from 'three'
import { ADDITION, Brush, Evaluator } from 'three-bvh-csg'
import { setSingleColor } from './meshData'
import { paletteMaterials } from './palette'
import type { MeshData } from './types'

export interface MergeInput {
  /** groups[].materialIndex = 色ID のインデックス付きジオメトリ */
  geometry: BufferGeometry
  matrixWorld: Matrix4
}

export interface MergeResult {
  /** center を原点としたローカル座標のメッシュ */
  mesh: MeshData
  center: Vector3
}

/** 入力群の和集合を取り、ワールド座標の三角形スープ（色付き）を返す */
function csgUnion(inputs: MergeInput[], cdt: boolean): Soup {
  const mats = paletteMaterials()
  const evaluator = new Evaluator()
  evaluator.attributes = ['position', 'normal']
  ;(evaluator as unknown as { useCDTClipping: boolean }).useCDTClipping = cdt

  const brushes = inputs.map(({ geometry, matrixWorld }) => {
    const g = geometry.clone()
    if (g.groups.length === 0) setSingleColor(g, 0)
    const b = new Brush(g, mats)
    matrixWorld.decompose(b.position, b.quaternion, b.scale)
    b.updateMatrixWorld()
    return b
  })

  let result = brushes[0]
  for (let i = 1; i < brushes.length; i++) result = evaluator.evaluate(result, brushes[i], ADDITION)

  const g = result.geometry.clone().applyMatrix4(result.matrixWorld)
  const resultMats = (Array.isArray(result.material) ? result.material : [result.material]) as Material[]
  const toColor = (mi: number | undefined) => Math.max(0, mats.indexOf(resultMats[mi ?? 0] as never))
  return soupFromGeometry(g, toColor)
}

/** 三角形スープ。tris は頂点インデックスではなく座標を直接持つ */
interface Soup {
  pos: number[] // 9 per tri
  nor: number[] // 9 per tri
  color: number[] // 1 per tri
}

function soupFromGeometry(g: BufferGeometry, toColor: (materialIndex: number | undefined) => number): Soup {
  const p = g.getAttribute('position')
  const n = g.getAttribute('normal')
  const idx = g.index
  const triCount = (idx ? idx.count : p.count) / 3
  const groups = g.groups.length ? g.groups : [{ start: 0, count: Infinity, materialIndex: 0 }]
  const soup: Soup = { pos: [], nor: [], color: [] }
  for (const gr of groups) {
    const c = toColor(gr.materialIndex)
    const end = Math.min(triCount * 3, gr.start + gr.count)
    for (let k = gr.start; k < end; k++) {
      const v = idx ? idx.getX(k) : k
      soup.pos.push(p.getX(v), p.getY(v), p.getZ(v))
      soup.nor.push(n.getX(v), n.getY(v), n.getZ(v))
      if (k % 3 === 0) soup.color.push(c)
    }
  }
  return soup
}

// ---------------------------------------------------------------- 面数削減

const EPS_POS = 1e-5

/**
 * 同一平面・同色・フラット法線の連結領域を、境界ループから再三角形化する。
 * 失敗した領域（非多様体・面積不一致など）は元の三角形を残す。
 */
export function simplifySoup(soup: Soup): Soup {
  // 頂点溶接
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.round(x / EPS_POS)},${Math.round(y / EPS_POS)},${Math.round(z / EPS_POS)}`
  const vmap = new Map<string, number>()
  const verts: Vector3[] = []
  const vid = (i: number) => {
    const x = soup.pos[i], y = soup.pos[i + 1], z = soup.pos[i + 2]
    const k = keyOf(x, y, z)
    let id = vmap.get(k)
    if (id === undefined) {
      id = verts.length
      vmap.set(k, id)
      verts.push(new Vector3(x, y, z))
    }
    return id
  }

  interface Tri { v: [number, number, number]; color: number; n: Vector3; flat: boolean; src: number }
  const tris: Tri[] = []
  const triCount = soup.color.length
  const e1 = new Vector3(), e2 = new Vector3()
  for (let t = 0; t < triCount; t++) {
    const a = vid(t * 9), b = vid(t * 9 + 3), c = vid(t * 9 + 6)
    if (a === b || b === c || a === c) continue
    e1.subVectors(verts[b], verts[a])
    e2.subVectors(verts[c], verts[a])
    const n = new Vector3().crossVectors(e1, e2)
    const area2 = n.length()
    if (area2 < 1e-12) {
      // 面積ほぼゼロでも頂点が異なる三角形は形状を閉じる役割があるので捨てずにそのまま残す
      tris.push({ v: [a, b, c], color: soup.color[t], n: new Vector3(0, 1, 0), flat: false, src: t })
      continue
    }
    n.divideScalar(area2)
    // フラット判定: 3頂点の法線が一致し、面の向きとも概ね一致。
    // 細長い三角形は外積の誤差が大きいので、平面の法線には頂点法線を使う
    const o = t * 9
    const vn = new Vector3(soup.nor[o], soup.nor[o + 1], soup.nor[o + 2]).normalize()
    let flat = vn.dot(n) > 0.99
    for (let k = 1; k < 3 && flat; k++) {
      const dot = vn.x * soup.nor[o + k * 3] + vn.y * soup.nor[o + k * 3 + 1] + vn.z * soup.nor[o + k * 3 + 2]
      if (dot < 0.99999) flat = false
    }
    tris.push({ v: [a, b, c], color: soup.color[t], n: flat ? vn : n, flat, src: t })
  }

  // 平面キーで分類 → 辺共有で連結成分へ
  const planeKey = (t: Tri) => {
    const d = t.n.dot(verts[t.v[0]])
    const q = (x: number) => Math.round(x * 1e4)
    return `${t.color}|${q(t.n.x)},${q(t.n.y)},${q(t.n.z)},${Math.round(d / EPS_POS / 10)}`
  }
  const buckets = new Map<string, number[]>()
  tris.forEach((t, i) => {
    if (!t.flat) return
    const k = planeKey(t)
    let arr = buckets.get(k)
    if (!arr) buckets.set(k, (arr = []))
    arr.push(i)
  })

  const out: Soup = { pos: [], nor: [], color: [] }
  const emit = (a: Vector3, b: Vector3, c: Vector3, na: Vector3, nb: Vector3, nc: Vector3, color: number) => {
    out.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    out.nor.push(na.x, na.y, na.z, nb.x, nb.y, nb.z, nc.x, nc.y, nc.z)
    out.color.push(color)
  }
  const emitOriginal = (t: Tri) => {
    const o = t.src * 9
    const nv = (k: number) => new Vector3(soup.nor[o + k * 3], soup.nor[o + k * 3 + 1], soup.nor[o + k * 3 + 2])
    emit(verts[t.v[0]], verts[t.v[1]], verts[t.v[2]], nv(0), nv(1), nv(2), t.color)
  }

  // 1) 領域ごとの境界ループ
  interface Region { tris: number[]; loops: number[][] | null; result: V3Tri[] | null }
  const regions: Region[] = []
  const regionOf = new Int32Array(tris.length).fill(-1)
  for (const ids of buckets.values()) {
    for (const r of connectedRegions(ids, tris)) {
      r.forEach((i) => (regionOf[i] = regions.length))
      regions.push({ tris: r, loops: r.length > 1 ? boundaryLoops(r, tris) : null, result: null })
    }
  }

  // 2) 除去可能な頂点 = それを使う全領域で「内部」か「境界上の共線点」
  //    （隣接領域も同時に除去するので T 字接合の隙間ができない）
  const blocked = new Uint8Array(verts.length)
  const markBlocked = (r: Region) => r.tris.forEach((i) => tris[i].v.forEach((v) => (blocked[v] = 1)))
  tris.forEach((t, i) => {
    const r = regionOf[i]
    if (r < 0 || !regions[r].loops) t.v.forEach((v) => (blocked[v] = 1))
  })
  for (const r of regions) {
    if (!r.loops) continue
    for (const loop of r.loops) {
      loop.forEach((v, i) => {
        const p = verts[loop[(i + loop.length - 1) % loop.length]]
        const q = verts[loop[(i + 1) % loop.length]]
        if (!isCollinear(p, verts[v], q)) blocked[v] = 1
      })
    }
  }

  // 3) 再三角形化。失敗した領域の頂点は除去不可にしてやり直す
  const triangulateAll = () => {
    for (let changed = true; changed; ) {
      changed = false
      for (const r of regions) {
        if (!r.loops) continue
        const n = tris[r.tris[0]].n
        r.result = triangulateLoops(r.loops, (v) => !blocked[v], n, verts, regionArea(r.tris, tris, verts))
        if (!r.result) {
          r.loops = null
          markBlocked(r)
          changed = true
        }
      }
    }
  }

  // 4) 出力し、入力より辺の健全性が悪化していたら（極細三角形まわりの重複など）
  //    その辺に関わる領域を元の三角形に戻して繰り返す
  const rawIssues = soupIssueEdges(soup)
  for (let iter = 0; ; iter++) {
    triangulateAll()
    out.pos.length = out.nor.length = out.color.length = 0
    const owner: number[] = []
    regions.forEach((r, ri) => {
      const t0 = tris[r.tris[0]]
      if (r.result) {
        for (const [a, b, c] of r.result) {
          emit(a, b, c, t0.n, t0.n, t0.n, t0.color)
          owner.push(ri)
        }
      } else {
        r.tris.forEach((i) => {
          emitOriginal(tris[i])
          owner.push(-1)
        })
      }
    })
    tris.forEach((t, i) => {
      if (regionOf[i] < 0) {
        emitOriginal(t)
        owner.push(-1)
      }
    })
    if (iter >= 10) break
    const all = soupIssueEdges(out)
    if (all.size <= rawIssues.size && [...all].every((k) => rawIssues.has(k))) break
    // 新たに生じた問題辺。無ければ（件数だけ増えた場合）問題辺すべてを対象に戻す
    const bad = new Set([...all].filter((k) => !rawIssues.has(k)))
    if (!bad.size) for (const k of all) bad.add(k)
    let reverted = false
    owner.forEach((ri, t) => {
      const r = regions[ri]
      if (ri < 0 || !r.loops || !triEdgeKeys(out.pos, t).some((k) => bad.has(k))) return
      r.loops = null
      r.result = null
      markBlocked(r)
      reverted = true
    })
    if (!reverted) break
  }
  return out
}

// ---------------------------------------------------------------- 辺の健全性・T 字接合

const pkey = (p: number[], o: number) =>
  `${Math.round(p[o] / EPS_POS)},${Math.round(p[o + 1] / EPS_POS)},${Math.round(p[o + 2] / EPS_POS)}`
const ekey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function triEdgeKeys(pos: number[], t: number): string[] {
  const k = [pkey(pos, t * 9), pkey(pos, t * 9 + 3), pkey(pos, t * 9 + 6)]
  return [ekey(k[0], k[1]), ekey(k[1], k[2]), ekey(k[2], k[0])]
}

/** 2 枚の面が逆向きで共有していない辺（穴・非多様体・裏返り）のキー集合 */
export function soupIssueEdges(soup: Soup): Set<string> {
  const count = new Map<string, number>() // 正方向 +1 / 逆方向 +1000
  for (let t = 0; t < soup.color.length; t++) {
    const k = [pkey(soup.pos, t * 9), pkey(soup.pos, t * 9 + 3), pkey(soup.pos, t * 9 + 6)]
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue
    for (let i = 0; i < 3; i++) {
      const a = k[i], b = k[(i + 1) % 3]
      const key = ekey(a, b)
      count.set(key, (count.get(key) ?? 0) + (a < b ? 1 : 1000))
    }
  }
  const bad = new Set<string>()
  for (const [k, c] of count) if (c !== 1001) bad.add(k)
  return bad
}

/**
 * 近接頂点の統合: CSG は 0.01mm 程度ずれた「ほぼ同じ頂点」を出すことがあり、
 * 格子丸めの溶接では境界をまたいで別頂点になる。距離 tol 以内を最初の代表点へ寄せ、退化三角形を除く。
 * （形状はすべて 5cm 単位で配置されるので 0.05mm の統合は安全）
 */
export function clusterVertices(soup: Soup, tol = 5e-5): Soup {
  const cells = new Map<string, Vector3[]>()
  const cell = (v: number) => Math.floor(v / tol)
  const rep = (x: number, y: number, z: number): Vector3 => {
    const cx = cell(x), cy = cell(y), cz = cell(z)
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++)
          for (const r of cells.get(`${cx + i},${cy + j},${cz + k}`) ?? [])
            if (Math.abs(r.x - x) <= tol && Math.abs(r.y - y) <= tol && Math.abs(r.z - z) <= tol) return r
    const r = new Vector3(x, y, z)
    const key = `${cx},${cy},${cz}`
    cells.set(key, [...(cells.get(key) ?? []), r])
    return r
  }
  const out: Soup = { pos: [], nor: [], color: [] }
  for (let t = 0; t < soup.color.length; t++) {
    const o = t * 9
    const v = [0, 1, 2].map((i) => rep(soup.pos[o + i * 3], soup.pos[o + i * 3 + 1], soup.pos[o + i * 3 + 2]))
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue
    for (const p of v) out.pos.push(p.x, p.y, p.z)
    for (let k = 0; k < 9; k++) out.nor.push(soup.nor[o + k])
    out.color.push(soup.color[t])
  }
  return out
}

/**
 * T 字接合の修復: 片側にしか無い辺の途中に、別の開いた辺の端点が乗っていたら三角形を分割する。
 * CSG の出力は見た目は閉じていても辺の途中に頂点が乗る（隙間ゼロの穴）ことがある。
 */
export function fixTJunctions(soup: Soup): Soup {
  let cur = soup
  for (let iter = 0; iter < 5; iter++) {
    const bad = soupIssueEdges(cur)
    if (!bad.size) break
    // 開いた辺の端点
    const pts = new Map<string, Vector3>()
    for (const e of bad) for (const k of e.split('|')) pts.set(k, new Vector3(...k.split(',').map((v) => Number(v) * EPS_POS)))
    const out: Soup = { pos: [], nor: [], color: [] }
    let changed = false
    for (let t = 0; t < cur.color.length; t++) {
      const o = t * 9
      const P = [0, 1, 2].map((i) => new Vector3(cur.pos[o + i * 3], cur.pos[o + i * 3 + 1], cur.pos[o + i * 3 + 2]))
      const N = [0, 1, 2].map((i) => new Vector3(cur.nor[o + i * 3], cur.nor[o + i * 3 + 1], cur.nor[o + i * 3 + 2]))
      const keys = triEdgeKeys(cur.pos, t)
      // 分割点の入った辺を1本だけ処理（残りは次の反復で）
      let split: { i: number; inner: { t: number; p: Vector3 }[] } | null = null
      for (let i = 0; i < 3 && !split; i++) {
        if (!bad.has(keys[i])) continue
        const a = P[i], b = P[(i + 1) % 3]
        const ab = b.clone().sub(a)
        const len2 = ab.lengthSq()
        const inner: { t: number; p: Vector3 }[] = []
        for (const p of pts.values()) {
          const u = p.clone().sub(a).dot(ab) / len2
          if (u <= 1e-6 || u >= 1 - 1e-6) continue
          if (a.clone().addScaledVector(ab, u).distanceTo(p) > EPS_POS) continue
          inner.push({ t: u, p })
        }
        if (inner.length) split = { i, inner: inner.sort((x, y) => x.t - y.t) }
      }
      if (!split) {
        for (let k = 0; k < 9; k++) {
          out.pos.push(cur.pos[o + k])
          out.nor.push(cur.nor[o + k])
        }
        out.color.push(cur.color[t])
        continue
      }
      changed = true
      const { i } = split
      const ia = i, ib = (i + 1) % 3, ic = (i + 2) % 3
      const chain = [
        { p: P[ia], n: N[ia] },
        ...split.inner.map(({ t: u, p }) => ({ p, n: N[ia].clone().lerp(N[ib], u).normalize() })),
        { p: P[ib], n: N[ib] },
      ]
      for (let k = 0; k < chain.length - 1; k++) {
        for (const v of [chain[k], chain[k + 1], { p: P[ic], n: N[ic] }]) {
          out.pos.push(v.p.x, v.p.y, v.p.z)
          out.nor.push(v.n.x, v.n.y, v.n.z)
        }
        out.color.push(cur.color[t])
      }
    }
    cur = out
    if (!changed) break
  }
  return cur
}

function connectedRegions(ids: number[], tris: { v: number[] }[]): number[][] {
  const edgeOwner = new Map<string, number[]>()
  const ek = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`)
  for (const i of ids) {
    const [a, b, c] = tris[i].v
    for (const k of [ek(a, b), ek(b, c), ek(c, a)]) {
      let arr = edgeOwner.get(k)
      if (!arr) edgeOwner.set(k, (arr = []))
      arr.push(i)
    }
  }
  const seen = new Set<number>()
  const regions: number[][] = []
  for (const start of ids) {
    if (seen.has(start)) continue
    const region: number[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length) {
      const i = stack.pop()!
      region.push(i)
      const [a, b, c] = tris[i].v
      for (const k of [ek(a, b), ek(b, c), ek(c, a)]) {
        for (const j of edgeOwner.get(k)!) {
          if (!seen.has(j)) {
            seen.add(j)
            stack.push(j)
          }
        }
      }
    }
    regions.push(region)
  }
  return regions
}

type V3Tri = [Vector3, Vector3, Vector3]

function isCollinear(p: Vector3, c: Vector3, q: Vector3): boolean {
  const cr = new Vector3().subVectors(c, p).cross(new Vector3().subVectors(q, c)).length()
  return cr <= 1e-9 * Math.max(p.distanceTo(c) * c.distanceTo(q), 1e-12)
}

function regionArea(region: number[], tris: { v: number[] }[], verts: Vector3[]): number {
  let area = 0
  for (const i of region) {
    const [a, b, c] = tris[i].v
    area += new Vector3().subVectors(verts[b], verts[a]).cross(new Vector3().subVectors(verts[c], verts[a])).length()
  }
  return area
}

/** 領域の境界ループ（頂点ID列、三角形と同じ巻き方向）。非多様体なら null */
function boundaryLoops(region: number[], tris: { v: number[] }[]): number[][] | null {
  const directed = new Set<string>()
  for (const i of region) {
    const [a, b, c] = tris[i].v
    directed.add(`${a}_${b}`).add(`${b}_${c}`).add(`${c}_${a}`)
  }
  const next = new Map<number, number>()
  for (const e of directed) {
    const [a, b] = e.split('_').map(Number)
    if (directed.has(`${b}_${a}`)) continue
    if (next.has(a)) return null
    next.set(a, b)
  }
  const loops: number[][] = []
  const visited = new Set<number>()
  for (const s of next.keys()) {
    if (visited.has(s)) continue
    const loop: number[] = []
    let v = s
    while (!visited.has(v)) {
      visited.add(v)
      loop.push(v)
      const nv = next.get(v)
      if (nv === undefined) return null
      v = nv
    }
    if (v !== s) return null
    loops.push(loop)
  }
  return loops
}

/** ループ群（外周1つ＋穴）を除去可能な頂点を省いて三角形化。検証に失敗したら null */
function triangulateLoops(
  loops: number[][],
  removable: (v: number) => boolean,
  n: Vector3,
  verts: Vector3[],
  origArea: number,
): V3Tri[] | null {
  const u = new Vector3(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize()
  const w = new Vector3().crossVectors(n, u)
  const to2 = (p: Vector3) => new Vector2(p.dot(u), p.dot(w))

  // 面積ゼロのループ（CSG が落とした退化三角形の跡）は無視する
  const cleaned: number[][] = []
  const pts2: Vector2[][] = []
  const areas: number[] = []
  for (const l of loops) {
    const c = l.filter((v) => !removable(v))
    const p = c.map((v) => to2(verts[v]))
    const a = c.length >= 3 ? ShapeUtils.area(p) : 0
    if (Math.abs(a) < 1e-10) continue
    cleaned.push(c)
    pts2.push(p)
    areas.push(a)
  }
  const outerIdx = areas.findIndex((a) => a > 0)
  if (outerIdx < 0 || areas.filter((a) => a > 0).length !== 1) return null
  const holeIdx = areas.map((_, i) => i).filter((i) => i !== outerIdx)

  const faces = ShapeUtils.triangulateShape(
    pts2[outerIdx],
    holeIdx.map((i) => pts2[i]),
  )
  const all = [cleaned[outerIdx], ...holeIdx.map((i) => cleaned[i])].flat()
  if (faces.length !== all.length + 2 * holeIdx.length - 2) return null

  let newArea = 0
  const result: V3Tri[] = []
  for (const [i, j, k] of faces) {
    const a = verts[all[i]]
    let b = verts[all[j]], c = verts[all[k]]
    const cr = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))
    if (cr.dot(n) < 0) [b, c] = [c, b]
    newArea += cr.length()
    result.push([a, b, c])
  }
  if (Math.abs(newArea - origArea) > 1e-6 + origArea * 1e-4) return null
  return result
}

/**
 * 平面上の穴を塞ぐ。CSG は同一平面で重なる面（床に並べた底面など）の一部を落とすことがあるため、
 * 開いた辺が作る閉ループが平面なら三角形化して埋める（色・法線は隣接面から）。
 */
export function fillPlanarHoles(soup: Soup): Soup {
  const bad = soupIssueEdges(soup)
  if (!bad.size) return soup
  // 開いた有向辺 a→b（逆向き b→a が存在しないもの）と、その辺を持つ三角形
  const directed = new Map<string, { b: string; t: number }>()
  const pts = new Map<string, Vector3>()
  const count = new Map<string, number>()
  for (let t = 0; t < soup.color.length; t++) {
    const k = [pkey(soup.pos, t * 9), pkey(soup.pos, t * 9 + 3), pkey(soup.pos, t * 9 + 6)]
    for (let i = 0; i < 3; i++) {
      const a = k[i], b = k[(i + 1) % 3]
      if (!bad.has(ekey(a, b))) continue
      count.set(ekey(a, b), (count.get(ekey(a, b)) ?? 0) + 1)
      directed.set(`${a}>${b}`, { b, t })
      pts.set(a, new Vector3(soup.pos[t * 9 + i * 3], soup.pos[t * 9 + i * 3 + 1], soup.pos[t * 9 + i * 3 + 2]))
    }
  }
  // 穴の縁は「1 回だけ使われた辺」。塞ぐ面は逆向き（b→a）にたどる
  const next = new Map<string, { to: string; t: number }>()
  const branch = new Set<string>()
  for (const [k, v] of directed) {
    const a = k.slice(0, k.indexOf('>'))
    if (count.get(ekey(a, v.b)) !== 1) continue
    if (next.has(v.b)) branch.add(v.b) // 分岐する縁（重なり等）は塞がない
    next.set(v.b, { to: a, t: v.t })
  }
  const out: Soup = { pos: [...soup.pos], nor: [...soup.nor], color: [...soup.color] }
  const visited = new Set<string>()
  for (const start of next.keys()) {
    if (visited.has(start)) continue
    const loop: string[] = []
    let v = start
    let color = -1
    while (!visited.has(v)) {
      visited.add(v)
      loop.push(v)
      const e = next.get(v)
      if (!e) break
      if (color < 0) color = soup.color[e.t]
      v = e.to
    }
    if (v !== start || loop.length < 3 || loop.some((k) => branch.has(k))) continue
    const P = loop.map((k) => pts.get(k)!)
    // ニューエル法で平面法線
    const n = new Vector3()
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length]
      n.x += (a.y - b.y) * (a.z + b.z)
      n.y += (a.z - b.z) * (a.x + b.x)
      n.z += (a.x - b.x) * (a.y + b.y)
    }
    if (n.lengthSq() < 1e-16) continue
    n.normalize()
    const d = n.dot(P[0])
    if (P.some((p) => Math.abs(n.dot(p) - d) > EPS_POS * 2)) continue // 非平面は塞がない
    const u = new Vector3(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).cross(n).normalize()
    const w = new Vector3().crossVectors(n, u)
    const faces = ShapeUtils.triangulateShape(
      P.map((p) => new Vector2(p.dot(u), p.dot(w))),
      [],
    )
    for (const [i, j, k] of faces) {
      let a = P[i], b = P[j], c = P[k]
      if (new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).dot(n) < 0) [b, c] = [c, b]
      out.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
      for (let q = 0; q < 3; q++) out.nor.push(n.x, n.y, n.z)
      out.color.push(Math.max(color, 0))
    }
  }
  return out
}

// ---------------------------------------------------------------- 出力

/** スープ → インデックス付き MeshData（位置+法線で溶接、色ごとに group 化） */
function soupToMeshData(soup: Soup, center: Vector3): MeshData {
  const order = soup.color.map((_, i) => i).sort((a, b) => soup.color[a] - soup.color[b])
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  const groups: MeshData['groups'] = []
  const map = new Map<string, number>()
  const r = (v: number) => Math.round(v * 1e5) / 1e5
  for (const t of order) {
    const color = soup.color[t]
    const last = groups[groups.length - 1]
    if (!last || last.color !== color) groups.push({ start: indices.length, count: 0, color })
    for (let k = 0; k < 3; k++) {
      const o = t * 9 + k * 3
      const x = r(soup.pos[o] - center.x), y = r(soup.pos[o + 1] - center.y), z = r(soup.pos[o + 2] - center.z)
      const nx = Math.round(soup.nor[o] * 1e4) / 1e4
      const ny = Math.round(soup.nor[o + 1] * 1e4) / 1e4
      const nz = Math.round(soup.nor[o + 2] * 1e4) / 1e4
      const key = `${x},${y},${z},${nx},${ny},${nz}`
      let id = map.get(key)
      if (id === undefined) {
        id = positions.length / 3
        map.set(key, id)
        positions.push(x, y, z)
        normals.push(nx, ny, nz)
      }
      indices.push(id)
    }
    groups[groups.length - 1].count += 3
  }
  return { positions, normals, indices, groups }
}

export function mergeObjects(inputs: MergeInput[], opts: { simplify?: boolean } = {}): MergeResult {
  if (inputs.length === 0) throw new Error('nothing to merge')
  // CSG は同一平面の面が重なる配置で稀に穴や重複面を残すので、
  // 分割方式・結合順を変えて試し、辺の問題が最も少ない結果を採用する
  let raw: Soup | null = null
  let best = Infinity
  for (const [cdt, reverse] of [[true, false], [true, true], [false, false], [false, true]] as const) {
    const soup = fillPlanarHoles(fixTJunctions(clusterVertices(csgUnion(reverse ? [...inputs].reverse() : inputs, cdt))))
    const issues = soupIssueEdges(soup).size
    if (issues < best) [raw, best] = [soup, issues]
    if (issues === 0) break
  }
  raw = raw!
  const soup = opts.simplify === false ? raw : simplifySoup(raw)
  const min = new Vector3(Infinity, Infinity, Infinity)
  const max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (let i = 0; i < soup.pos.length; i += 3) {
    min.min(new Vector3(soup.pos[i], soup.pos[i + 1], soup.pos[i + 2]))
    max.max(new Vector3(soup.pos[i], soup.pos[i + 1], soup.pos[i + 2]))
  }
  const center = min.add(max).multiplyScalar(0.5)
  // 中心は 0.05mm 単位に丸め（グリッド上の値を保つ）
  center.set(Math.round(center.x * 2e4) / 2e4, Math.round(center.y * 2e4) / 2e4, Math.round(center.z * 2e4) / 2e4)
  return { mesh: soupToMeshData(soup, center), center }
}
