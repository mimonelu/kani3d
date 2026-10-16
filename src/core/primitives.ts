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
  Vector3,
} from 'three'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BASE_SIZE, SNAP, snapValue } from './constants'
import { getFont, isFontLoaded, resolveFontName } from './fonts'
import { fixTJunctions } from './merge'
import { coplanarGroups } from './paint'
import { textShapes } from './text'

export type PrimitiveCategory = '基本' | '柱・錐' | '特殊'
export type ParamValue = number | boolean | string
export type PrimitiveParams = Record<string, ParamValue>

export type ParamDef =
  | { key: string; label: string; type: 'int'; min: number; max: number; default: number }
  | { key: string; label: string; type: 'ratio'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; type: 'bool'; default: boolean }
  | { key: string; label: string; type: 'enum'; options: { value: number; label: string }[]; default: number }
  /** 1 行の文字列。空白だけ・空は既定値 */
  | { key: string; label: string; type: 'text'; maxLength: number; default: string }
  /** ローカルフォントの PostScript 名（'' は自動。core/fonts.ts） */
  | { key: string; label: string; type: 'font'; default: string }
  /** 長さ (m)。5cm 単位 */
  | { key: string; label: string; type: 'length'; min: number; max: number; default: number }
  /** 乱数の種（整数。UI に振り直しボタン） */
  | { key: string; label: string; type: 'seed'; min: number; max: number; default: number }

export interface PrimitiveDef {
  id: string
  label: string
  category: PrimitiveCategory
  params: ParamDef[]
  /** 正規化後のバウンディングボックス (m)。natural は create した形状の大きさ */
  size: (p: PrimitiveParams, natural: [number, number, number]) => [number, number, number]
  /** 出力法線を滑らかにするか（クリース角 60°） */
  smooth: (p: PrimitiveParams) => boolean
  create: (p: PrimitiveParams) => BufferGeometry
  /** 形状が外部の状態（読み込み済みフォント）にも依存するとき、キャッシュのキーに足す値 */
  cacheKey?: (p: PrimitiveParams) => string
  /**
   * ペイント単位のポリゴンの決め方。
   * coplanar（既定）: 同一平面でつながった三角形をまとめる（側面の四角形・上下の多角形面など）
   * pairs: 生成順に 2 枚ずつ（分割した立方体のマス目）
   */
  polygons?: 'coplanar' | 'pairs'
  /**
   * 寸法を形状オプションに持つ（ローカル X/Y/Z の length パラメータのキー）。
   * 拡縮ハンドルの結果は scale ではなくこの寸法に移して作り直す（引き伸ばさない。Editor.bakeScale）
   */
  dims?: [string, string, string]
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

/**
 * 文字: XY 平面の輪郭を +Z へ押し出し（1 em = BASE_SIZE、正面が +Z）。
 * フォントが未読み込み（読み込み中・許可なし）の間は文字数ぶんの板で代用し、読み込み後に Editor が作り直す
 */
function textGeometry(p: PrimitiveParams): BufferGeometry {
  const text = p.text as string
  const depth = num(p, 'thickness') * S
  const font = getFont(p.font as string)
  let shapes: Shape[] = []
  try {
    if (font) shapes = textShapes(font, text, num(p, 'curveSegments'))
  } catch (e) {
    console.warn('text outline failed', e)
  }
  if (!shapes.length) {
    const g = new BoxGeometry(Math.max(0.6, [...text].length * 0.6) * S, 0.7 * S, depth)
    g.userData.placeholder = true
    return g
  }
  return new ExtrudeGeometry(shapes, { depth, bevelEnabled: false, curveSegments: 1 }).scale(S, S, 1)
}

/** 0〜1 の擬似乱数列（seed が同じなら同じ列。形状は params から毎回作り直すので Math.random は使えない） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 岩: 楕円体の表面にほぼ等間隔に点を置いて面を張り、頂点をランダムにずらす。
 * 寸法の比で引き伸ばさないよう点は楕円体の上でならし、揺れ幅は点の間隔を基準にする（どの縦横比でも面の大きさ・凸凹がそろう）。
 * 面のつながりはずらす前の点（凸な楕円体の上なのですべて凸包の頂点になる）で決めるので、点が無駄にならず、へこみも作れる。
 * 点の数・乱数列は寸法に依存しないので、寸法を変えても同じ岩がなめらかに伸び縮みする。
 * 半分なら楕円体の上半分（高さ＝半径）に点を置き、底の縁（y=0 の楕円）にも点を並べて、底面は中心からの扇形で平らに張る
 */
function rockGeometry(p: PrimitiveParams): BufferGeometry {
  const half = !!p.half
  const r = [num(p, 'width') / 2, num(p, 'height') / (half ? 1 : 2), num(p, 'depth') / 2]
  const n = num(p, 'detail')
  const rand = mulberry32(num(p, 'seed') * 0x9e3779b1)
  // 楕円体の表面積（Knud Thomsen の近似）→ 点 1 つあたりの間隔
  const k = 1.6075
  const [a, b, c] = r.map((v) => Math.pow(v, k))
  const area = (half ? 2 : 4) * Math.PI * Math.pow((a * b + a * c + b * c) / 3, 1 / k)
  const spacing = Math.sqrt(area / n)
  const project = (v: Vector3) => v.divideScalar(Math.hypot(v.x / r[0], v.y / r[1], v.z / r[2]))
  const normalAt = (v: Vector3) => new Vector3(v.x / r[0] ** 2, v.y / r[1] ** 2, v.z / r[2] ** 2).normalize()
  // フィボナッチ球を楕円体へ写した初期配置
  const golden = Math.PI * (3 - Math.sqrt(5))
  const pts = Array.from({ length: n }, (_, i) => {
    const y = 1 - ((half ? 1 : 2) * (i + 0.5)) / n
    const s = Math.sqrt(1 - y * y)
    return new Vector3(Math.cos(i * golden) * s * r[0], y * r[1], Math.sin(i * golden) * s * r[2])
  })
  // 半分: 底の縁の点（角度順。数は細かさだけで決める＝半球なら上の点とほぼ同じ間隔になる数）
  const rimCount = half ? Math.max(3, Math.round(Math.sqrt(2 * Math.PI * n))) : 0
  for (let j = 0; j < rimCount; j++) {
    const a = (2 * Math.PI * (j + 0.5)) / rimCount
    pts.push(new Vector3(Math.cos(a) * r[0], 0, Math.sin(a) * r[2]))
  }
  const isRim = (i: number) => i >= n
  const total = pts.length
  // 近い点どうしを接平面の方向に押し離して楕円体の上に戻す（回数固定・なめらかな力なので寸法に対して連続）。
  // 距離には法線の違いも足す（薄い形で表と裏の点が厚み越しに押し合うと、全部が縁に集まって平らな輪になるため）
  const reach = spacing * 2
  const d = new Vector3()
  for (let it = 0; it < RELAX_STEPS; it++) {
    const push = pts.map(() => new Vector3())
    const nrms = pts.map(normalAt)
    for (let i = 0; i < total; i++) {
      for (let j = i + 1; j < total; j++) {
        d.subVectors(pts[i], pts[j])
        const len = Math.hypot(d.length(), nrms[i].distanceTo(nrms[j]) * spacing)
        if (len >= reach || len < 1e-12) continue
        const f = (1 - len / reach) ** 2 / len
        push[i].addScaledVector(d, f)
        push[j].addScaledVector(d, -f)
      }
    }
    for (let i = 0; i < total; i++) {
      const nrm = nrms[i]
      push[i].addScaledVector(nrm, -push[i].dot(nrm))
      if (isRim(i)) push[i].y = 0 // 縁の点は縁に沿ってだけ動く
      const q = pts[i].addScaledVector(push[i], spacing * RELAX_RATE)
      if (half && q.y < 0) q.y = isRim(i) ? 0 : -q.y
      project(q)
    }
  }
  // 面のつながり
  const index = new Map(pts.map((q, i) => [q, i]))
  const tris: number[] = []
  for (const f of new ConvexHull().setFromPoints(pts).faces) {
    const loop: number[] = []
    let e = f.edge
    do {
      loop.push(index.get(e.head().point)!)
      e = e.next
    } while (e !== f.edge)
    if (loop.every(isRim)) continue // 底面は下で張る
    for (let i = 1; i + 1 < loop.length; i++) tris.push(loop[0], loop[i], loop[i + 1])
  }
  // 半分: 底面は中心の点からの扇形（縁を揺らしても、扇が裏返らない限り重ならない）。
  // 縁の点はならす間に（細長い楕円では特に）追い越し合うことがあるので、角度順に並べ直してから張る
  if (half) {
    const rim = Array.from({ length: rimCount }, (_, j) => n + j)
    rim.sort((i, j) => Math.atan2(pts[i].z / r[2], pts[i].x / r[0]) - Math.atan2(pts[j].z / r[2], pts[j].x / r[0]))
    const center = pts.push(new Vector3()) - 1
    for (let j = 0; j < rimCount; j++) tris.push(center, rim[j], rim[(j + 1) % rimCount])
  }
  // 揺らす: 接線方向（面の形を不揃いに）と法線方向（凸凹）。
  // 薄い軸の方向の揺れは厚みに合わせて抑える（表と裏がすれ違って裏返らないように）
  const rough = num(p, 'roughness') * ROCK_ROUGH * spacing
  const jitter = num(p, 'jitter') * ROCK_JITTER * spacing
  const thin = new Vector3(...r.map((v) => Math.min(1, (v * 0.3) / spacing)))
  // 半分では底が平らなまま・上の点が底より下に出ないように: 縁の点は水平にだけ、上の点は下へは高さの半分まで
  const offset = pts.map((q, i) => {
    const v = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1)
    const h = rand() * 2 - 1
    if (i >= total) return new Vector3() // 底面の中心
    const nrm = normalAt(q)
    v.addScaledVector(nrm, -v.dot(nrm))
    const o = v.multiplyScalar(jitter).addScaledVector(nrm, h * rough).multiply(thin)
    if (isRim(i)) o.y = 0
    else if (half) o.y = Math.max(o.y, -q.y / 2)
    return o
  })
  // 揺らす前から大きく傾いた（裏返り・折れ返りかけた）面があれば、その頂点の揺れを半分にして繰り返す（細い三角形のそばなど）
  const faceNormal = (v: (i: number) => Vector3, t: number) =>
    new Vector3().subVectors(v(tris[t + 1]), v(tris[t])).cross(new Vector3().subVectors(v(tris[t + 2]), v(tris[t]))).normalize()
  const baseNormals = Array.from({ length: tris.length / 3 }, (_, t) => faceNormal((i) => pts[i], t * 3))
  const moved = pts.map((q, i) => q.clone().add(offset[i]))
  for (let it = 0; it < 20; it++) {
    const shrink = new Set<number>()
    for (let t = 0; t < tris.length; t += 3) {
      if (faceNormal((i) => moved[i], t).dot(baseNormals[t / 3]) < MAX_TILT_COS) for (let k = 0; k < 3; k++) shrink.add(tris[t + k])
    }
    if (!shrink.size) break
    for (const i of shrink) moved[i].copy(pts[i]).addScaledVector(offset[i].multiplyScalar(0.5), 1)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(moved.flatMap((q) => q.toArray()), 3))
  g.setIndex(tris)
  return g
}
const RELAX_STEPS = 60
const RELAX_RATE = 0.2
/** 揺れ幅（点の間隔に対する割合）の上限 */
const ROCK_ROUGH = 0.6
const ROCK_JITTER = 0.35
/** 揺らした面の傾きの上限（揺らす前の面の向きとの cos） */
const MAX_TILT_COS = 0.3

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
  {
    id: 'cube',
    label: '立方体',
    category: '基本',
    params: [
      { key: 'segX', label: '分割数 X', type: 'int', min: 1, max: 16, default: 1 },
      { key: 'segY', label: '分割数 Y', type: 'int', min: 1, max: 16, default: 1 },
      { key: 'segZ', label: '分割数 Z', type: 'int', min: 1, max: 16, default: 1 },
    ],
    size: cube,
    smooth: () => false,
    create: (p) => new BoxGeometry(2, 2, 2, num(p, 'segX'), num(p, 'segY'), num(p, 'segZ')),
    polygons: 'pairs',
  },
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
    params: [sides(16), half('半分')],
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
  {
    id: 'rock',
    label: '岩',
    category: '特殊',
    params: [
      { key: 'width', label: '幅', type: 'length', min: SNAP, max: 10, default: S },
      { key: 'height', label: '高さ', type: 'length', min: SNAP, max: 10, default: S },
      { key: 'depth', label: '奥行き', type: 'length', min: SNAP, max: 10, default: S },
      { key: 'detail', label: '細かさ', type: 'int', min: 6, max: 120, default: 24 },
      { key: 'roughness', label: '凸凹', type: 'ratio', min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: 'jitter', label: '不揃い', type: 'ratio', min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: 'seed', label: '乱数', type: 'seed', min: 1, max: 9999, default: 1 },
      half('半分'),
    ],
    size: (p) => [num(p, 'width'), num(p, 'height'), num(p, 'depth')],
    smooth: () => false,
    create: rockGeometry,
    dims: ['width', 'height', 'depth'],
  },
  {
    id: 'text',
    label: '文字',
    category: '特殊',
    params: [
      { key: 'text', label: '文字列', type: 'text', maxLength: 64, default: 'Text' },
      { key: 'font', label: 'フォント', type: 'font', default: '' },
      { key: 'thickness', label: '厚み', type: 'ratio', min: 0.05, max: 1, step: 0.05, default: 0.2 },
      { key: 'curveSegments', label: '曲線の分割数', type: 'int', min: 1, max: 8, default: 3 },
    ],
    // 文字の縦横比を保ったまま各辺を 5cm 単位に
    size: (_p, natural) => natural.map((v) => Math.max(SNAP, snapValue(v))) as [number, number, number],
    smooth: () => true,
    create: textGeometry,
    cacheKey: (p) => (isFontLoaded(p.font as string) ? resolveFontName(p.font as string) : '(placeholder)'),
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
    else if (d.type === 'text') {
      // 改行・制御文字は空白に。空白だけなら何も表示されないので既定値
      const t = typeof v === 'string' ? [...v.replace(/[\x00-\x1f\x7f]/g, ' ')].slice(0, d.maxLength).join('') : ''
      out[d.key] = t.trim() ? t : d.default
    } else if (d.type === 'font') out[d.key] = typeof v === 'string' ? v : d.default
    else if (d.type === 'enum') out[d.key] = d.options.some((o) => o.value === v) ? (v as number) : d.default
    else if (typeof v !== 'number' || !Number.isFinite(v)) out[d.key] = d.default
    else {
      const c = Math.min(d.max, Math.max(d.min, v))
      out[d.key] =
        d.type === 'int' || d.type === 'seed'
          ? Math.round(c)
          : d.type === 'length'
            ? Math.max(d.min, snapValue(c))
            : Math.round(Math.round(c / d.step) * d.step * 1e6) / 1e6
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

/**
 * 非インデックスの三角形から面積ゼロのものを除き、外向きの巻き方向に揃える。
 * 一直線上に並んだ穴の辺（文字に多い）では三角形分割が面積ゼロの三角形でつないでいるので、除いた後の T 字の隙間を分割して閉じる
 */
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
  const fixed = fixTJunctions({ pos: out, nor: new Array(out.length).fill(0), color: new Array(out.length / 9).fill(0) }).pos
  const r = new BufferGeometry()
  r.setAttribute('position', new Float32BufferAttribute(fixed, 3))
  return r
}

/** 同一平面でつながった三角形に同じ番号を振る（非インデックスの position から） */
function coplanarPolygons(g: BufferGeometry): Int32Array {
  const p = g.getAttribute('position').array
  return coplanarGroups(p.length / 9, (t, k) => [p[t * 9 + k * 3], p[t * 9 + k * 3 + 1], p[t * 9 + k * 3 + 2]])
}

/** 三角形 → ポリゴン番号（ペイント単位）。geometry.userData.polyIds に入る */
export const polyIdsOf = (g: BufferGeometry): Int32Array => g.userData.polyIds as Int32Array

const cache = new Map<string, BufferGeometry>()

/**
 * 正規化済みのプリミティブ形状（position/normal のみ、インデックス付き、group なし）。
 * userData.polyIds に三角形ごとのポリゴン番号（ペイント単位）を持つ。
 * 戻り値は毎回 clone なので呼び出し側で groups・index を書き換えてよい（polyIds は共有なので書き換えない）。
 */
export function buildPrimitiveGeometry(id: string, rawParams?: Partial<PrimitiveParams>): BufferGeometry {
  const def = getPrimitive(id)
  if (!def) throw new Error(`unknown primitive: ${id}`)
  const params = resolveParams(id, rawParams)
  const key = `${id}|${JSON.stringify(params)}|${def.cacheKey?.(params) ?? ''}`
  let base = cache.get(key)
  if (!base) {
    const src = def.create(params)
    const placeholder = !!src.userData.placeholder
    let g = cleanTriangles(src.index ? src.toNonIndexed() : src)
    src.dispose()
    // バウンディングボックスを中心原点・指定サイズへ正規化
    g.computeBoundingBox()
    const bb = g.boundingBox!
    const sz = bb.getSize(bb.max.clone())
    g.translate(-bb.min.x - sz.x / 2, -bb.min.y - sz.y / 2, -bb.min.z - sz.z / 2)
    const size = def.size(params, [sz.x, sz.y, sz.z])
    g.scale(size[0] / sz.x, size[1] / sz.y, size[2] / sz.z)
    // ポリゴン番号（三角形の順序は以降の法線計算・溶接でも保たれる）
    const triCount = g.getAttribute('position').count / 3
    const polyIds =
      def.polygons === 'pairs' ? Int32Array.from({ length: triCount }, (_, t) => t >> 1) : coplanarPolygons(g)
    // 法線: 曲面は 60° 未満の折れを滑らかに、それ以外はフラット
    g = toCreasedNormals(g, def.smooth(params) ? Math.PI / 3 : 0.01)
    g = mergeVertices(g, 1e-6)
    g.computeBoundingBox()
    g.userData.polyIds = polyIds
    if (placeholder) g.userData.placeholder = true
    base = g
    if (cache.size > 200) cache.clear() // スライダー操作で無制限に増えないように
    // 代用形状はキャッシュしない（次の呼び出しでフォントの読み込みを再び試みるため）
    if (!placeholder) cache.set(key, base)
  }
  const out = base.clone()
  out.clearGroups()
  return out
}
