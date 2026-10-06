import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  OctahedronGeometry,
  Path,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from 'three'
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BASE_SIZE } from './constants'
import { CREASE_ANGLE } from './shading'
import type { Shading } from './types'

export type PrimitiveCategory = '基本' | '角柱・円柱' | '錐' | '特殊'

export interface PrimitiveDef {
  id: string
  label: string
  category: PrimitiveCategory
  /** バウンディングボックスがこのサイズ (m) になるよう正規化される */
  size: [number, number, number]
  /** 既定のシェーディング。true なら曲面を滑らかに（クリース角 60°）、false なら全面フラット */
  smooth: boolean
  create: () => BufferGeometry
}

const S = BASE_SIZE
const R = S / 2
const H = S / 2

// ---------------------------------------------------------------- 形状ビルダー

/** くさび（直角三角形の断面を Z 方向へ押し出し） */
function wedgeGeometry(): BufferGeometry {
  const s = new Shape([new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1)])
  return extrude(s, 1)
}

function extrude(shape: Shape, depth: number, curveSegments = 12): BufferGeometry {
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments })
}

/** 半円柱（かまぼこ型）: 断面が半円、Z 方向へ押し出し */
function halfCylinderGeometry(): BufferGeometry {
  const s = new Shape()
  s.moveTo(1, 0)
  s.absarc(0, 0, 1, 0, Math.PI, false)
  s.lineTo(1, 0)
  return extrude(s, 2, 8)
}

/** 階段（3段） */
function stairsGeometry(): BufferGeometry {
  const steps = 3
  const pts = [new Vector2(0, 0), new Vector2(steps, 0)]
  for (let i = steps; i > 0; i--) pts.push(new Vector2(i, steps - i + 1), new Vector2(i - 1, steps - i + 1))
  return extrude(new Shape(pts), steps)
}

/** アーチ（直方体から半円をくり抜いた形） */
function archGeometry(): BufferGeometry {
  const s = new Shape()
  s.moveTo(-1, 0)
  s.lineTo(-0.5, 0)
  s.absarc(0, 0, 0.5, Math.PI, 0, true)
  s.lineTo(1, 0)
  s.lineTo(1, 1)
  s.lineTo(-1, 1)
  s.lineTo(-1, 0)
  return extrude(s, 1, 8)
}

/** パイプ（中空の円柱） */
function pipeGeometry(): BufferGeometry {
  const s = new Shape()
  s.absarc(0, 0, 1, 0, Math.PI * 2, false)
  const hole = new Path()
  hole.absarc(0, 0, 0.6, 0, Math.PI * 2, true)
  s.holes.push(hole)
  return extrude(s, 2, 16).rotateX(-Math.PI / 2)
}

/** 星形の板（5角） */
function starGeometry(): BufferGeometry {
  const pts: Vector2[] = []
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 ? 0.45 : 1
    pts.push(new Vector2(Math.cos(a) * r, Math.sin(a) * r))
  }
  return extrude(new Shape(pts), 0.5).rotateX(-Math.PI / 2)
}

/** 半球（底面あり） */
function hemisphereGeometry(): BufferGeometry {
  const pts: Vector2[] = []
  const n = 4
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI / 2) * (i / n)
    pts.push(new Vector2(Math.sin(a), Math.cos(a)))
  }
  pts.push(new Vector2(0, 0))
  return new LatheGeometry(pts, 12)
}

/** 角錐・円錐（底面の辺が軸に揃うよう回転） */
const pyramid = (sides: number) => () => new ConeGeometry(R, S, sides).rotateY(sides === 4 ? Math.PI / 4 : 0)
const prism = (sides: number) => () =>
  new CylinderGeometry(R, R, S, sides).rotateY(sides === 8 ? Math.PI / 8 : 0)

// ---------------------------------------------------------------- 一覧

export const PRIMITIVES: readonly PrimitiveDef[] = [
  { id: 'cube', label: '立方体', category: '基本', size: [S, S, S], smooth: false, create: () => new BoxGeometry(S, S, S) },
  { id: 'sphere', label: '球体', category: '基本', size: [S, S, S], smooth: true, create: () => new SphereGeometry(R, 12, 8) },
  { id: 'hemisphere', label: '半球', category: '基本', size: [S, H, S], smooth: true, create: hemisphereGeometry },
  { id: 'wedge', label: 'くさび', category: '基本', size: [S, S, S], smooth: false, create: wedgeGeometry },

  { id: 'square-prism', label: '四角柱', category: '角柱・円柱', size: [S, S * 2, S], smooth: false, create: () => new BoxGeometry(S, S * 2, S) },
  { id: 'tri-prism', label: '三角柱', category: '角柱・円柱', size: [S, S, S], smooth: false, create: prism(3) },
  { id: 'hex-prism', label: '六角柱', category: '角柱・円柱', size: [S, S, S], smooth: false, create: prism(6) },
  { id: 'oct-prism', label: '八角柱', category: '角柱・円柱', size: [S, S, S], smooth: false, create: prism(8) },
  { id: 'cylinder', label: '円柱', category: '角柱・円柱', size: [S, S, S], smooth: true, create: () => new CylinderGeometry(R, R, S, 16) },
  { id: 'half-cylinder', label: '半円柱', category: '角柱・円柱', size: [S, H, S], smooth: true, create: halfCylinderGeometry },
  { id: 'pipe', label: 'パイプ', category: '角柱・円柱', size: [S, S, S], smooth: true, create: pipeGeometry },

  { id: 'tri-pyramid', label: '三角錐', category: '錐', size: [S, S, S], smooth: false, create: pyramid(3) },
  { id: 'square-pyramid', label: '四角錐', category: '錐', size: [S, S, S], smooth: false, create: pyramid(4) },
  { id: 'hex-pyramid', label: '六角錐', category: '錐', size: [S, S, S], smooth: false, create: pyramid(6) },
  { id: 'cone', label: '円錐', category: '錐', size: [S, S, S], smooth: true, create: () => new ConeGeometry(R, S, 16) },

  { id: 'stairs', label: '階段', category: '特殊', size: [S, S, S], smooth: false, create: stairsGeometry },
  { id: 'arch', label: 'アーチ', category: '特殊', size: [S, H, S], smooth: true, create: archGeometry },
  { id: 'torus', label: 'ドーナツ', category: '特殊', size: [S, H, S], smooth: true, create: () => new TorusGeometry(0.065, 0.035, 6, 12).rotateX(Math.PI / 2) },
  { id: 'star', label: '星', category: '特殊', size: [S, H, S], smooth: false, create: starGeometry },
  { id: 'icosahedron', label: '二十面体', category: '特殊', size: [S, S, S], smooth: false, create: () => new IcosahedronGeometry(R, 0) },
  { id: 'octahedron', label: '八面体', category: '特殊', size: [S, S, S], smooth: false, create: () => new OctahedronGeometry(R, 0) },
]

const byId = new Map(PRIMITIVES.map((p) => [p.id, p]))
export const getPrimitive = (id: string): PrimitiveDef | undefined => byId.get(id)

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
export function buildPrimitiveGeometry(id: string, shading?: Shading): BufferGeometry {
  const def0 = getPrimitive(id)
  const smooth = shading ? shading === 'smooth' : !!def0?.smooth
  const cacheKey = `${id}|${smooth}`
  let base = cache.get(cacheKey)
  if (!base) {
    const def = getPrimitive(id)
    if (!def) throw new Error(`unknown primitive: ${id}`)
    const src = def.create()
    let g = cleanTriangles(src.index ? src.toNonIndexed() : src)
    src.dispose()
    // バウンディングボックスを中心原点・指定サイズへ正規化
    g.computeBoundingBox()
    const bb = g.boundingBox!
    const sz = bb.getSize(bb.max.clone())
    g.translate(-bb.min.x - sz.x / 2, -bb.min.y - sz.y / 2, -bb.min.z - sz.z / 2)
    g.scale(def.size[0] / sz.x, def.size[1] / sz.y, def.size[2] / sz.z)
    // 法線: 曲面は 60° 未満の折れを滑らかに、それ以外はフラット
    g = toCreasedNormals(g, smooth ? CREASE_ANGLE : 0.01)
    g = mergeVertices(g, 1e-6)
    g.computeBoundingBox()
    base = g
    cache.set(cacheKey, base)
  }
  const out = base.clone()
  out.clearGroups()
  return out
}
