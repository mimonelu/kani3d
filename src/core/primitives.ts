/**
 * パラメータ付きプリミティブ。形状は params（分割数・角数など）から毎回生成し、
 * バウンディングボックスを size(params) に正規化する（移動・拡縮スナップと揃えるため）。
 */
import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  DodecahedronGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  OctahedronGeometry,
  Path,
  Shape,
  TetrahedronGeometry,
  TorusGeometry,
  Vector2,
} from 'three'
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BASE_SIZE } from './constants'

export type PrimitiveCategory = '基本' | '柱・錐' | '特殊'
export type ParamValue = number | boolean
export type PrimitiveParams = Record<string, ParamValue>

export type ParamDef =
  | { key: string; label: string; type: 'int'; min: number; max: number; default: number }
  | { key: string; label: string; type: 'ratio'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: 'bool'; default: boolean }
  | { key: string; label: string; type: 'enum'; options: { value: number; label: string }[]; default: number }

export interface PrimitiveDef {
  id: string
  label: string
  category: PrimitiveCategory
  params: ParamDef[]
  /** 正規化後のバウンディングボックス (m) */
  size: (p: PrimitiveParams) => [number, number, number]
  /** 出力法線を滑らかにするか（クリース角 60°） */
  smooth: (p: PrimitiveParams) => boolean
  create: (p: PrimitiveParams) => BufferGeometry
}

const S = BASE_SIZE
const H = S / 2
const cube = (): [number, number, number] => [S, S, S]
const num = (p: PrimitiveParams, k: string) => p[k] as number
/** この角数以上なら曲面として滑らかに */
const SMOOTH_SIDES = 10

// ---------------------------------------------------------------- 形状ビルダー

function extrude(shape: Shape, depth: number): BufferGeometry {
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 })
}

const polar = (r: number, a: number) => new Vector2(Math.cos(a) * r, Math.sin(a) * r)

/** 正多角形の頂点（1 辺が水平になる向き）。half なら上半分（直径の辺を含む） */
function polygon(sides: number, r = 1, half = false): Vector2[] {
  const start = -Math.PI / 2 + Math.PI / sides
  if (!half) return Array.from({ length: sides }, (_, i) => polar(r, start + (i * 2 * Math.PI) / sides))
  const n = Math.max(1, Math.ceil(sides / 2))
  return Array.from({ length: n + 1 }, (_, i) => polar(r, (i * Math.PI) / n))
}

/** 柱: 正多角形を Y 方向へ押し出し（半分なら D 字断面） */
function prismGeometry(p: PrimitiveParams): BufferGeometry {
  return extrude(new Shape(polygon(num(p, 'sides'), 1, !!p.half)), 2).rotateX(-Math.PI / 2)
}

/** 錐 */
function coneGeometry(p: PrimitiveParams): BufferGeometry {
  const sides = num(p, 'sides')
  return new ConeGeometry(1, 2, sides, 1, false, Math.PI / sides)
}

/** 球（半球なら底面あり） */
function sphereGeometry(p: PrimitiveParams): BufferGeometry {
  const w = num(p, 'widthSegments')
  const h = num(p, 'heightSegments')
  const half = !!p.half
  const rows = half ? Math.max(1, Math.ceil(h / 2)) : h
  const end = half ? Math.PI / 2 : Math.PI
  const pts: Vector2[] = []
  for (let i = 0; i <= rows; i++) {
    const a = (end * i) / rows
    pts.push(new Vector2(Math.sin(a), Math.cos(a)))
  }
  if (half) pts.push(new Vector2(0, 0))
  return new LatheGeometry(pts, w, Math.PI / w)
}

/** パイプ */
function pipeGeometry(p: PrimitiveParams): BufferGeometry {
  const sides = num(p, 'sides')
  const s = new Shape(polygon(sides, 1))
  s.holes.push(new Path(polygon(sides, 1 - num(p, 'thickness')).reverse()))
  return extrude(s, 2).rotateX(-Math.PI / 2)
}

/** ドーナツ（thickness = 管の太さ / 外径） */
function torusGeometry(p: PrimitiveParams): BufferGeometry {
  const t = num(p, 'thickness')
  return new TorusGeometry(1 - t, t, num(p, 'radialSegments'), num(p, 'tubularSegments')).rotateX(Math.PI / 2)
}

/** 星形の板 */
function starGeometry(p: PrimitiveParams): BufferGeometry {
  const n = num(p, 'points')
  const pts: Vector2[] = []
  for (let i = 0; i < n * 2; i++) pts.push(polar(i % 2 ? num(p, 'innerRatio') : 1, Math.PI / 2 + (i * Math.PI) / n))
  return extrude(new Shape(pts), 0.5).rotateX(-Math.PI / 2)
}

/** くさび（直角三角形の断面を Z 方向へ押し出し） */
function wedgeGeometry(): BufferGeometry {
  return extrude(new Shape([new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1)]), 1)
}

function polyhedronGeometry(p: PrimitiveParams): BufferGeometry {
  switch (num(p, 'faces')) {
    case 4:
      return new TetrahedronGeometry(1, 0)
    case 8:
      return new OctahedronGeometry(1, 0)
    case 12:
      return new DodecahedronGeometry(1, 0)
    default:
      return new IcosahedronGeometry(1, 0)
  }
}

// ---------------------------------------------------------------- 一覧

const sides = (def: number): ParamDef => ({ key: 'sides', label: '角数', type: 'int', min: 3, max: 32, default: def })
const half = (label: string): ParamDef => ({ key: 'half', label, type: 'bool', default: false })

export const PRIMITIVES: readonly PrimitiveDef[] = [
  { id: 'cube', label: '立方体', category: '基本', params: [], size: cube, smooth: () => false, create: () => new BoxGeometry(2, 2, 2) },
  {
    id: 'sphere',
    label: '球体',
    category: '基本',
    params: [
      { key: 'widthSegments', label: '横の分割数', type: 'int', min: 3, max: 32, default: 12 },
      { key: 'heightSegments', label: '縦の分割数', type: 'int', min: 2, max: 16, default: 8 },
      half('半球'),
    ],
    size: (p) => [S, p.half ? H : S, S],
    smooth: () => true,
    create: sphereGeometry,
  },
  { id: 'wedge', label: 'くさび', category: '基本', params: [], size: cube, smooth: () => false, create: wedgeGeometry },

  {
    id: 'prism',
    label: '柱',
    category: '柱・錐',
    params: [sides(16), half('半分（D 字断面）')],
    size: (p) => [S, S, p.half ? H : S],
    smooth: (p) => num(p, 'sides') >= SMOOTH_SIDES,
    create: prismGeometry,
  },
  {
    id: 'cone',
    label: '錐',
    category: '柱・錐',
    params: [sides(16)],
    size: cube,
    smooth: (p) => num(p, 'sides') >= SMOOTH_SIDES,
    create: coneGeometry,
  },
  {
    id: 'pipe',
    label: 'パイプ',
    category: '柱・錐',
    params: [sides(16), { key: 'thickness', label: '肉厚', type: 'ratio', min: 0.1, max: 0.9, step: 0.05, default: 0.4 }],
    size: cube,
    smooth: (p) => num(p, 'sides') >= SMOOTH_SIDES,
    create: pipeGeometry,
  },

  {
    id: 'torus',
    label: 'ドーナツ',
    category: '特殊',
    params: [
      { key: 'tubularSegments', label: '周の分割数', type: 'int', min: 3, max: 32, default: 12 },
      { key: 'radialSegments', label: '管の分割数', type: 'int', min: 3, max: 16, default: 6 },
      { key: 'thickness', label: '太さ', type: 'ratio', min: 0.1, max: 0.5, step: 0.05, default: 0.35 },
    ],
    // 高さはスナップ単位（5cm）に揃える
    size: (p) => [S, num(p, 'thickness') > 0.375 ? S : H, S],
    smooth: () => true,
    create: torusGeometry,
  },
  {
    id: 'star',
    label: '星',
    category: '特殊',
    params: [
      { key: 'points', label: '角の数', type: 'int', min: 3, max: 12, default: 5 },
      { key: 'innerRatio', label: 'くぼみ', type: 'ratio', min: 0.2, max: 0.9, step: 0.05, default: 0.45 },
    ],
    size: (): [number, number, number] => [S, H, S],
    smooth: () => false,
    create: starGeometry,
  },
  {
    id: 'polyhedron',
    label: '多面体',
    category: '特殊',
    params: [
      {
        key: 'faces',
        label: '面数',
        type: 'enum',
        options: [
          { value: 4, label: '正四面体' },
          { value: 8, label: '正八面体' },
          { value: 12, label: '正十二面体' },
          { value: 20, label: '正二十面体' },
        ],
        default: 20,
      },
    ],
    size: cube,
    smooth: () => false,
    create: polyhedronGeometry,
  },
]

const byId = new Map(PRIMITIVES.map((p) => [p.id, p]))
export const getPrimitive = (id: string): PrimitiveDef | undefined => byId.get(id)

/** 既定値で補い、範囲・型を正規化したパラメータ（未知のキーは捨てる） */
export function resolveParams(id: string, raw: Partial<PrimitiveParams> = {}): PrimitiveParams {
  const out: PrimitiveParams = {}
  for (const d of getPrimitive(id)?.params ?? []) {
    const v = raw[d.key]
    if (d.type === 'bool') out[d.key] = typeof v === 'boolean' ? v : d.default
    else if (d.type === 'enum') out[d.key] = d.options.some((o) => o.value === v) ? (v as number) : d.default
    else if (typeof v !== 'number' || !Number.isFinite(v)) out[d.key] = d.default
    else {
      const c = Math.min(d.max, Math.max(d.min, v))
      out[d.key] = d.type === 'int' ? Math.round(c) : Math.round(Math.round(c / d.step) * d.step * 1e6) / 1e6
    }
  }
  return out
}

/** 既定値と異なるものだけ（保存用）。すべて既定なら undefined */
export function compactParams(id: string, p: PrimitiveParams): PrimitiveParams | undefined {
  const out: PrimitiveParams = {}
  for (const d of getPrimitive(id)?.params ?? []) if (p[d.key] !== undefined && p[d.key] !== d.default) out[d.key] = p[d.key]
  return Object.keys(out).length ? out : undefined
}

/**
 * 旧形式（パラメータ導入前）のプリミティブ ID の変換表。
 * scaleY: 旧サイズを保つための Y 拡大率（旧「四角柱」は 10×20×10cm だった）
 */
export const LEGACY_PRIMITIVES: Record<string, { id: string; params?: PrimitiveParams; scaleY?: number }> = {
  hemisphere: { id: 'sphere', params: { half: true } },
  'square-prism': { id: 'cube', scaleY: 2 },
  'tri-prism': { id: 'prism', params: { sides: 3 } },
  'hex-prism': { id: 'prism', params: { sides: 6 } },
  'oct-prism': { id: 'prism', params: { sides: 8 } },
  cylinder: { id: 'prism', params: { sides: 16 } },
  'half-cylinder': { id: 'prism', params: { sides: 16, half: true } },
  'tri-pyramid': { id: 'cone', params: { sides: 3 } },
  'square-pyramid': { id: 'cone', params: { sides: 4 } },
  'hex-pyramid': { id: 'cone', params: { sides: 6 } },
  icosahedron: { id: 'polyhedron', params: { faces: 20 } },
  octahedron: { id: 'polyhedron', params: { faces: 8 } },
  // 削除したプリミティブは立方体に置き換える
  stairs: { id: 'cube' },
  arch: { id: 'cube' },
}

// ---------------------------------------------------------------- 正規化

/** 非インデックスの三角形から面積ゼロのものを除き、外向きの巻き方向に揃える */
function cleanTriangles(g: BufferGeometry): BufferGeometry {
  const p = g.getAttribute('position').array
  const out: number[] = []
  let volume = 0
  for (let i = 0; i < p.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = Array.prototype.slice.call(p, i, i + 9) as number[]
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    if (Math.hypot(nx, ny, nz) < 1e-12) continue
    volume += ax * nx + ay * ny + az * nz
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz)
  }
  if (volume < 0) {
    for (let i = 0; i < out.length; i += 9) {
      for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]]
    }
  }
  const r = new BufferGeometry()
  r.setAttribute('position', new Float32BufferAttribute(out, 3))
  return r
}

const cache = new Map<string, BufferGeometry>()

/**
 * 正規化済みのプリミティブ形状（position/normal のみ、インデックス付き、group なし）。
 * 戻り値は毎回 clone なので呼び出し側で groups を書き換えてよい。
 */
export function buildPrimitiveGeometry(id: string, rawParams?: Partial<PrimitiveParams>): BufferGeometry {
  const def = getPrimitive(id)
  if (!def) throw new Error(`unknown primitive: ${id}`)
  const params = resolveParams(id, rawParams)
  const key = `${id}|${JSON.stringify(params)}`
  let base = cache.get(key)
  if (!base) {
    const src = def.create(params)
    let g = cleanTriangles(src.index ? src.toNonIndexed() : src)
    src.dispose()
    // バウンディングボックスを中心原点・指定サイズへ正規化
    g.computeBoundingBox()
    const bb = g.boundingBox!
    const sz = bb.getSize(bb.max.clone())
    g.translate(-bb.min.x - sz.x / 2, -bb.min.y - sz.y / 2, -bb.min.z - sz.z / 2)
    const size = def.size(params)
    g.scale(size[0] / sz.x, size[1] / sz.y, size[2] / sz.z)
    // 法線: 曲面は 60° 未満の折れを滑らかに、それ以外はフラット
    g = toCreasedNormals(g, def.smooth(params) ? Math.PI / 3 : 0.01)
    g = mergeVertices(g, 1e-6)
    g.computeBoundingBox()
    base = g
    if (cache.size > 200) cache.clear() // スライダー操作で無制限に増えないように
    cache.set(key, base)
  }
  const out = base.clone()
  out.clearGroups()
  return out
}
