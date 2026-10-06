import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  SphereGeometry,
} from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BASE_SIZE } from './constants'

export interface PrimitiveDef {
  id: string
  label: string
  /** バウンディングボックスがこのサイズ (m) になるよう正規化される */
  size: [number, number, number]
  /** true なら全面フラットシェーディング（角柱など少角数の形状） */
  flat: boolean
  create: () => BufferGeometry
}

const S = BASE_SIZE
const R = S / 2

/** くさび（直角三角形の断面を Z 方向へ押し出し） */
function wedgeGeometry(): BufferGeometry {
  const h = R
  // prettier-ignore
  const v = [
    [-h, -h, -h], [h, -h, -h], [-h, h, -h], // 手前 (z-)
    [-h, -h, h], [h, -h, h], [-h, h, h],    // 奥 (z+)
  ]
  // prettier-ignore
  const faces = [
    [0, 2, 1], [3, 4, 5],             // 三角面
    [0, 1, 4], [0, 4, 3],             // 底面
    [0, 3, 5], [0, 5, 2],             // 背面 (x-)
    [1, 2, 5], [1, 5, 4],             // 斜面
  ]
  const pos: number[] = []
  for (const f of faces) for (const i of f) pos.push(...v[i])
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  return g
}

export const PRIMITIVES: readonly PrimitiveDef[] = [
  { id: 'cube', label: '立方体', size: [S, S, S], flat: true, create: () => new BoxGeometry(S, S, S) },
  { id: 'sphere', label: '球体', size: [S, S, S], flat: false, create: () => new SphereGeometry(R, 12, 8) },
  { id: 'tri-pyramid', label: '三角錐', size: [S, S, S], flat: true, create: () => new ConeGeometry(R, S, 3) },
  { id: 'tri-prism', label: '三角柱', size: [S, S, S], flat: true, create: () => new CylinderGeometry(R, R, S, 3) },
  {
    id: 'square-pyramid',
    label: '四角錐',
    size: [S, S, S],
    flat: true,
    create: () => new ConeGeometry(R, S, 4).rotateY(Math.PI / 4),
  },
  {
    id: 'square-prism',
    label: '四角柱',
    size: [S, S * 2, S],
    flat: true,
    create: () => new BoxGeometry(S, S * 2, S),
  },
  { id: 'cone', label: '円錐', size: [S, S, S], flat: false, create: () => new ConeGeometry(R, S, 16) },
  { id: 'cylinder', label: '円柱', size: [S, S, S], flat: false, create: () => new CylinderGeometry(R, R, S, 16) },
  { id: 'wedge', label: 'くさび', size: [S, S, S], flat: true, create: wedgeGeometry },
]

const byId = new Map(PRIMITIVES.map((p) => [p.id, p]))
export const getPrimitive = (id: string): PrimitiveDef | undefined => byId.get(id)

const cache = new Map<string, BufferGeometry>()

/**
 * 正規化済みのプリミティブ形状（position/normal のみ、インデックス付き、group 1つ）。
 * 戻り値は毎回 clone なので呼び出し側で groups を書き換えてよい。
 */
export function buildPrimitiveGeometry(id: string): BufferGeometry {
  let base = cache.get(id)
  if (!base) {
    const def = getPrimitive(id)
    if (!def) throw new Error(`unknown primitive: ${id}`)
    let g = def.create()
    g.deleteAttribute('uv')
    if (def.flat) {
      g = g.index ? g.toNonIndexed() : g
      g.deleteAttribute('normal')
    }
    // バウンディングボックスを中心原点・指定サイズへ正規化
    g.computeBoundingBox()
    const bb = g.boundingBox!
    const c = bb.getCenter(bb.min.clone())
    g.translate(-c.x, -c.y, -c.z)
    const sz = bb.getSize(c)
    g.scale(def.size[0] / sz.x, def.size[1] / sz.y, def.size[2] / sz.z)
    // flat はここで面法線を生成。smooth 形状は元々 bbox≒サイズなので既存法線をそのまま使う
    if (def.flat) g.computeVertexNormals()
    g = mergeVertices(g, 1e-6) // 同一頂点（UV継ぎ目など）を溶接
    g.clearGroups()
    g.computeBoundingBox()
    base = g
    cache.set(id, base)
  }
  const out = base.clone()
  out.clearGroups()
  return out
}
