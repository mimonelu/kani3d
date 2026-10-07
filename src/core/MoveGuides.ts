/**
 * 移動中のガイド表示（見た目のみ。スナップ挙動は変えない）
 *   A. 接地点: 真下に落ちる位置（床か、真下にあるオブジェクトの天面）に外枠の足跡と、そこまでの縦線
 *   C. 接触面: 別のオブジェクトの面に接したら、接している範囲を薄く塗り、その面の中心を通る縦横の線と輪郭
 * 判定は外枠（AABB）で行う。他のオブジェクトの外枠はドラッグ開始時に一度だけ計算する。
 */
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineDashedMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Object3D,
} from 'three'

const FOOT_COLOR = '#4dd2ff'
const CONTACT_COLOR = '#ffcf33'
/** 面が接しているとみなす距離 (m) */
const TOUCH_EPS = 1e-3

const overlay = { depthTest: false, depthWrite: false, transparent: true }

export class MoveGuides {
  readonly root = new Group()
  private others: Box3[] = []
  private readonly footLines: LineSegments
  private readonly dropLine: LineSegments
  private readonly contactLines: LineSegments
  private readonly contactFill: Mesh

  constructor() {
    this.root.name = 'move-guides'
    this.footLines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: FOOT_COLOR, ...overlay, opacity: 0.9 }))
    this.dropLine = new LineSegments(
      new BufferGeometry(),
      new LineDashedMaterial({ color: FOOT_COLOR, dashSize: 0.04, gapSize: 0.03, ...overlay, opacity: 0.9 }),
    )
    this.contactLines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: CONTACT_COLOR, ...overlay }))
    this.contactFill = new Mesh(
      new BufferGeometry(),
      new MeshBasicMaterial({ color: CONTACT_COLOR, ...overlay, opacity: 0.28, side: DoubleSide }),
    )
    for (const o of [this.footLines, this.dropLine, this.contactLines, this.contactFill]) {
      o.renderOrder = 990
      o.raycast = () => {}
      o.frustumCulled = false
      this.root.add(o)
    }
    this.root.visible = false
  }

  /** ドラッグ開始: 動かないオブジェクトの外枠を控える */
  begin(others: Object3D[]): void {
    this.others = others.map((o) => new Box3().setFromObject(o, true))
  }

  end(): void {
    this.root.visible = false
    this.others = []
  }

  /** 移動中のオブジェクト（単体または pivot）の現在位置でガイドを更新 */
  update(target: Object3D): void {
    target.updateMatrixWorld(true)
    const box = new Box3().setFromObject(target, true)
    if (box.isEmpty()) return
    this.root.visible = true
    this.updateFootprint(box)
    this.updateContacts(box)
  }

  // ------------------------------------------------------------ A. 接地点

  private updateFootprint(box: Box3): void {
    // 真下で一番高い天面（外枠が XZ で重なり、底面以下にあるもの）。無ければ床
    let land = 0
    for (const o of this.others) {
      const overlapXZ =
        o.min.x < box.max.x - TOUCH_EPS &&
        o.max.x > box.min.x + TOUCH_EPS &&
        o.min.z < box.max.z - TOUCH_EPS &&
        o.max.z > box.min.z + TOUCH_EPS
      if (overlapXZ && o.max.y <= box.min.y + TOUCH_EPS) land = Math.max(land, o.max.y)
    }
    if (box.min.y < -TOUCH_EPS) land = Math.min(land, box.min.y) // 床より下にあるときはその高さ
    const y = land + 0.002
    const { min, max } = box
    const c = box.getCenter(new Vector3())
    // 足跡（外枠の底面の輪郭）＋中心の十字
    const s = Math.min(max.x - min.x, max.z - min.z) * 0.15
    setLines(this.footLines, [
      [min.x, y, min.z], [max.x, y, min.z], [max.x, y, min.z], [max.x, y, max.z],
      [max.x, y, max.z], [min.x, y, max.z], [min.x, y, max.z], [min.x, y, min.z],
      [c.x - s, y, c.z], [c.x + s, y, c.z], [c.x, y, c.z - s], [c.x, y, c.z + s],
    ])
    // 底面の中心から接地点までの縦線（接地しているときは消える）
    setLines(this.dropLine, min.y - land > TOUCH_EPS ? [[c.x, min.y, c.z], [c.x, y, c.z]] : [])
    this.dropLine.computeLineDistances()
  }

  // ------------------------------------------------------------ C. 接触面

  private updateContacts(box: Box3): void {
    const lines: number[][] = []
    const quads: number[][] = []
    for (const o of this.others) {
      for (const axis of ['x', 'y', 'z'] as const) {
        // 面が接している向き（移動物の max が相手の min、または min が相手の max）
        const plane =
          Math.abs(box.max[axis] - o.min[axis]) < TOUCH_EPS
            ? o.min[axis]
            : Math.abs(box.min[axis] - o.max[axis]) < TOUCH_EPS
              ? o.max[axis]
              : null
        if (plane === null) continue
        const [u, v] = (['x', 'y', 'z'] as const).filter((a) => a !== axis)
        // 接している範囲（残り 2 軸の重なり）
        const u0 = Math.max(box.min[u], o.min[u]), u1 = Math.min(box.max[u], o.max[u])
        const v0 = Math.max(box.min[v], o.min[v]), v1 = Math.min(box.max[v], o.max[v])
        if (u1 - u0 <= TOUCH_EPS || v1 - v0 <= TOUCH_EPS) continue
        const P = (pu: number, pv: number): number[] => {
          const p = new Vector3()
          p[axis] = plane
          p[u] = pu
          p[v] = pv
          return p.toArray()
        }
        quads.push(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v0), P(u1, v1), P(u0, v1))
        // 相手の面の中心を通る縦横の線（面に固定した目印。移動物の位置には追従しない）
        const cu = (o.min[u] + o.max[u]) / 2
        const cv = (o.min[v] + o.max[v]) / 2
        lines.push(P(o.min[u], cv), P(o.max[u], cv), P(cu, o.min[v]), P(cu, o.max[v]))
        // 相手の面の輪郭
        lines.push(
          P(o.min[u], o.min[v]), P(o.max[u], o.min[v]), P(o.max[u], o.min[v]), P(o.max[u], o.max[v]),
          P(o.max[u], o.max[v]), P(o.min[u], o.max[v]), P(o.min[u], o.max[v]), P(o.min[u], o.min[v]),
        )
      }
    }
    setLines(this.contactLines, lines)
    this.contactFill.geometry.dispose()
    this.contactFill.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(quads.flat(), 3))
  }

  /** テスト・デバッグ用: 表示中のガイドの要約 */
  debugState(): { visible: boolean; footprintY: number | null; drop: boolean; contacts: number } {
    const fp = this.footLines.geometry.getAttribute('position')
    return {
      visible: this.root.visible,
      footprintY: fp && fp.count ? fp.getY(0) : null,
      drop: (this.dropLine.geometry.getAttribute('position')?.count ?? 0) > 0,
      contacts: (this.contactFill.geometry.getAttribute('position')?.count ?? 0) / 6,
    }
  }
}

function setLines(obj: LineSegments, pts: number[][]): void {
  obj.geometry.dispose()
  obj.geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(pts.flat(), 3))
}
