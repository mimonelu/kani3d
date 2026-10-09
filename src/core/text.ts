/** フォントの輪郭 → three.js の Shape（1 em = 1、Y 上向き）。押し出しは primitives.ts */
import ClipperLib from 'clipper-lib'
import { Shape, ShapeUtils, Vector2 } from 'three'
import type { Font } from 'opentype.js'

type Contour = Vector2[]

/** Clipper は整数座標なので 1 em をこの値にする */
const SCALE = 1e5
/** 和集合の後に内側へ縮める量（em）。1 点で接する輪郭を離す（押し出すと側面の辺を 4 面が共有して非多様体になるため） */
const SHRINK = 1e-4
/** これより近い頂点はまとめる（em）。細かすぎる曲線の点は三角形分割・溶接で潰れて隙間の元になる */
const MIN_EDGE = 5e-4

/**
 * 文字列の輪郭を Shape にする。曲線は segments 分割の折れ線。
 * 輪郭どうしが重なったり辺で接したりするフォント（日本語に多い）があり、そのまま押し出すと内部面や隙間ができるので、
 * 非ゼロ規則で和集合を取ってから外周と穴に分ける（巻き方向が TrueType と CFF で逆でも同じ結果になる）。
 * 一直線上に並んだ穴の辺で三角形分割が作る T 字の隙間は primitives.ts の cleanTriangles で閉じる
 */
export function textShapes(font: Font, text: string, segments: number): Shape[] {
  const paths = pathContours(font, text, segments).map((c) => c.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })))
  const clipper = new ClipperLib.Clipper()
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true)
  const union: ClipperLib.Paths = []
  clipper.Execute(ClipperLib.ClipType.ctUnion, union, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)
  const offset = new ClipperLib.ClipperOffset(10, 0)
  offset.AddPaths(union, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon)
  const tree = new ClipperLib.PolyTree()
  offset.Execute(tree, -SHRINK * SCALE)
  const shapes: Shape[] = []
  const toContour = (path: ClipperLib.IntPoint[], outer: boolean) =>
    ccw(clean(ClipperLib.Clipper.CleanPolygon(path, MIN_EDGE * SCALE).map((p) => new Vector2(p.X / SCALE, p.Y / SCALE))), outer)
  const visit = (node: ClipperLib.PolyNode) => {
    for (const outer of node.Childs()) {
      const c = toContour(outer.Contour(), true)
      if (c.length < 3) continue
      const shape = new Shape(c)
      for (const hole of outer.Childs()) {
        const h = toContour(hole.Contour(), false)
        if (h.length >= 3) shape.holes.push(new Shape(h))
        visit(hole) // 穴の中の島
      }
      shapes.push(shape)
    }
  }
  visit(tree)
  return shapes
}

function pathContours(font: Font, text: string, segments: number): Contour[] {
  const out: Contour[] = []
  let cur: Contour = []
  let last = new Vector2()
  const flush = () => {
    const c = clean(cur)
    if (c.length >= 3 && Math.abs(ShapeUtils.area(c)) > 1e-8) out.push(c)
    cur = []
  }
  // opentype のパスは Y 下向き → 反転
  const pt = (x: number, y: number) => new Vector2(x, -y)
  for (const cmd of glyphPath(font, text).commands) {
    if (cmd.type === 'M') {
      flush()
      last = pt(cmd.x, cmd.y)
      cur.push(last)
    } else if (cmd.type === 'L') {
      last = pt(cmd.x, cmd.y)
      cur.push(last)
    } else if (cmd.type === 'Q') {
      const c = pt(cmd.x1, cmd.y1)
      const e = pt(cmd.x, cmd.y)
      const s = last
      for (let k = 1; k <= segments; k++) {
        const t = k / segments
        const u = 1 - t
        cur.push(new Vector2(u * u * s.x + 2 * u * t * c.x + t * t * e.x, u * u * s.y + 2 * u * t * c.y + t * t * e.y))
      }
      last = e
    } else if (cmd.type === 'C') {
      const c1 = pt(cmd.x1, cmd.y1)
      const c2 = pt(cmd.x2, cmd.y2)
      const e = pt(cmd.x, cmd.y)
      const s = last
      for (let k = 1; k <= segments; k++) {
        const t = k / segments
        const u = 1 - t
        const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t
        cur.push(new Vector2(a * s.x + b * c1.x + c * c2.x + d * e.x, a * s.y + b * c1.y + c * c2.y + d * e.y))
      }
      last = e
    } else if (cmd.type === 'Z') flush()
  }
  flush()
  return out
}

/** カーニング付きのパス（カーニング情報の無いフォントでは opentype.js が例外を出すので無しで） */
function glyphPath(font: Font, text: string) {
  try {
    return font.getPath(text, 0, 0, 1, { kerning: true })
  } catch {
    return font.getPath(text, 0, 0, 1, { kerning: false })
  }
}

/** 連続する重複点・閉じる点・一直線上の点を除く */
function clean(c: Contour): Contour {
  const eps = 1e-6
  let pts = c.filter((p, i) => i === 0 || p.distanceTo(c[i - 1]) > eps)
  while (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) <= eps) pts = pts.slice(0, -1)
  return pts.filter((p, i) => {
    const a = pts[(i + pts.length - 1) % pts.length]
    const b = pts[(i + 1) % pts.length]
    return Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) > 1e-10
  })
}

/** 外側は反時計回り、穴は時計回りに揃える */
function ccw(c: Contour, outer: boolean): Contour {
  return ShapeUtils.isClockWise(c) === outer ? [...c].reverse() : c
}
