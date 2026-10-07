/**
 * Tinkercad 風の統合操作ハンドル。選択対象のバウンディングボックス上に
 *   - 拡縮ハンドル（縦の中央の高さの四隅・四面、天面中央）: 反対側を固定して 5cm 単位で伸縮
 *   - 持ち上げハンドル（天面上の矢印）: Y 方向移動
 *   - 回転ハンドル（X/Y/Z 軸の円弧）: 中心まわりに 45° 刻みで回転
 * を表示する。本体ドラッグ（床と平行な移動）も beginMove で扱う。
 * 対象の親はワールド原点（identity）である前提。
 */
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Ray,
  Raycaster,
  TorusGeometry,
  Vector3,
} from 'three'
import { ROT_STEP, SNAP, snapValue } from './constants'

type Axis = 'x' | 'y' | 'z'
const AXES: Axis[] = ['x', 'y', 'z']

type HandleInfo =
  /** at: ボックス上の位置（-1=min, 0=中央, 1=max）、dir: 伸縮する軸と向き */
  | { kind: 'scale'; at: Vector3; dir: Vector3 }
  | { kind: 'lift' }
  | { kind: 'rotate'; axis: Axis }

export const AXIS_COLOR: Record<Axis, string> = { x: '#ff5f57', y: '#4cd964', z: '#3d8bff' }
const HOVER_COLOR = '#ffb020'
/** ハンドルの画面上サイズ (px) */
const HANDLE_PX = 16
const ARC_SWEEP = Math.PI / 3
/** ハンドルを並べる枠の画面上の最小サイズ (px) */
const MIN_BOX_PX = 100

const overlay = (color: string) =>
  new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true })
const hitMaterial = new MeshBasicMaterial({ visible: false })

interface Handle {
  group: Group
  visual: Mesh
  hit: Mesh
  info: HandleInfo
  baseColor: string
  /** 回転円弧のジオメトリ再生成判定用 */
  arcKey?: string
}

type Drag =
  | { kind: 'scale'; h: Handle & { info: { kind: 'scale' } }; plane: Plane; q0: Vector3; anchorLocal: Vector3; anchorWorld: Vector3 }
  | { kind: 'lift'; plane: Plane; y0: number }
  | { kind: 'rotate'; axis: Axis; plane: Plane; center: Vector3; a0: number; last: number; total: number }
  | { kind: 'move'; plane: Plane; p0: Vector3 }

interface StartState {
  pos: Vector3
  quat: Quaternion
  scale: Vector3
}

export class Gizmo {
  readonly root = new Group()
  private target: Object3D | null = null
  /** 対象ローカル座標（スケール前）のバウンディングボックス */
  private readonly box = new Box3()
  /** ハンドル配置用（box を画面上の最小サイズまで広げたもの） */
  private readonly display = new Box3()
  private allowScale = true
  private readonly handles: Handle[] = []
  private hovered: Handle | null = null
  private drag: Drag | null = null
  private start: StartState | null = null
  private readonly protractor = new Group()
  private readonly needle: LineSegments
  viewportHeight = 1

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly snapToGrid: (o: Object3D) => void,
  ) {
    this.root.name = 'gizmo'
    this.root.renderOrder = 1000
    // 拡縮: 縦の中央の高さに四隅（縦の辺の中点）・四面の中心、加えて天面中央
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) this.addScale(new Vector3(x, 0, z), new Vector3(x, 0, z))
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) this.addScale(new Vector3(x, 0, z), new Vector3(x, 0, z))
    this.addScale(new Vector3(0, 1, 0), new Vector3(0, 1, 0))
    // 持ち上げ
    const cone = new ConeGeometry(0.45, 1.1, 16).translate(0, 0.55, 0)
    this.addHandle({ kind: 'lift' }, cone, new ConeGeometry(0.8, 1.6, 8).translate(0, 0.6, 0), '#f2f2f2')
    // 回転
    for (const axis of AXES) this.addHandle({ kind: 'rotate', axis }, new BufferGeometry(), new BufferGeometry(), AXIS_COLOR[axis])

    // 分度器（回転ドラッグ中のみ）
    const ring: number[] = []
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2, b = ((i + 1) / 64) * Math.PI * 2
      ring.push(Math.cos(a), Math.sin(a), 0, Math.cos(b), Math.sin(b), 0)
    }
    for (let i = 0; i < 8; i++) {
      const a = i * ROT_STEP
      ring.push(Math.cos(a) * 0.85, Math.sin(a) * 0.85, 0, Math.cos(a) * 1.08, Math.sin(a) * 1.08, 0)
    }
    const lineMat = new LineBasicMaterial({ color: '#ffffff', depthTest: false, transparent: true, opacity: 0.8 })
    this.protractor.add(new LineSegments(new BufferGeometry().setAttribute('position', new Float32BufferAttribute(ring, 3)), lineMat))
    this.needle = new LineSegments(
      new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3)),
      new LineBasicMaterial({ color: HOVER_COLOR, depthTest: false, transparent: true }),
    )
    this.protractor.add(this.needle)
    this.protractor.visible = false
    this.protractor.traverse((o) => (o.renderOrder = 1000))
    this.root.add(this.protractor)
    this.root.visible = false
  }

  private addScale(at: Vector3, dir: Vector3): void {
    const g = new BoxGeometry(1, 1, 1)
    const h = this.addHandle({ kind: 'scale', at, dir }, g, new BoxGeometry(2, 2, 2), '#ffffff')
    const edges = new LineSegments(new EdgesGeometry(g), new LineBasicMaterial({ color: '#222831', depthTest: false, transparent: true }))
    edges.renderOrder = 1001
    h.group.add(edges)
  }

  private addHandle(info: HandleInfo, visualGeo: BufferGeometry, hitGeo: BufferGeometry, color: string): Handle {
    const group = new Group()
    const visual = new Mesh(visualGeo, overlay(color))
    visual.renderOrder = 1000
    const hit = new Mesh(hitGeo, hitMaterial)
    group.add(visual, hit)
    this.root.add(group)
    const h: Handle = { group, visual, hit, info, baseColor: color }
    hit.userData.handle = h
    this.handles.push(h)
    return h
  }

  // ------------------------------------------------------------ attach

  attach(target: Object3D, localBox: Box3, allowScale: boolean): void {
    this.target = target
    this.box.copy(localBox)
    this.allowScale = allowScale
    this.root.visible = true
  }

  detach(): void {
    this.target = null
    this.drag = null
    this.root.visible = false
  }

  get dragging(): boolean {
    return this.drag !== null
  }

  // ------------------------------------------------------------ per frame

  private worldPerPixel(p: Vector3): number {
    const dist = this.camera.position.distanceTo(p)
    return (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / this.viewportHeight
  }

  private boxPoint(at: Vector3, box: Box3 = this.box): Vector3 {
    const { min, max } = box
    const pick = (a: number, lo: number, hi: number) => (a < 0 ? lo : a > 0 ? hi : (lo + hi) / 2)
    return new Vector3(pick(at.x, min.x, max.x), pick(at.y, min.y, max.y), pick(at.z, min.z, max.z))
  }

  /** 対象のワールド AABB（ローカル箱の8隅から） */
  private worldBox(box: Box3 = this.box): Box3 {
    const b = new Box3()
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1])
      b.expandByPoint(this.target!.localToWorld(this.boxPoint(new Vector3(x, y, z), box)))
    return b
  }

  /**
   * ハンドルを並べる表示用の枠。画面上で MIN_BOX_PX 未満の軸は中心から広げる
   * （小さな物体でもズームせずにハンドルを掴めるように）。拡縮・回転の計算は実際の this.box を使う
   */
  private updateDisplayBox(): void {
    const t = this.target!
    const ws = t.getWorldScale(new Vector3())
    const center = this.box.getCenter(new Vector3())
    const wpp = this.worldPerPixel(t.localToWorld(center.clone()))
    const size = this.box.getSize(new Vector3())
    const half = new Vector3()
    for (const a of AXES) half[a] = Math.max(size[a] / 2, (MIN_BOX_PX * wpp) / 2 / Math.max(Math.abs(ws[a]), 1e-9))
    this.display.set(center.clone().sub(half), center.clone().add(half))
  }

  update(): void {
    const t = this.target
    if (!t) return
    t.updateMatrixWorld(true)
    const wq = t.getWorldQuaternion(new Quaternion())
    this.updateDisplayBox()
    const wbox = this.worldBox(this.display)
    const center = wbox.getCenter(new Vector3())
    const px = this.worldPerPixel(center) * HANDLE_PX

    for (const h of this.handles) {
      const { info, group } = h
      if (info.kind === 'scale') {
        group.visible = this.allowScale && !(this.drag && this.drag.kind !== 'scale')
        group.position.copy(t.localToWorld(this.boxPoint(info.at, this.display)))
        group.quaternion.copy(wq)
        group.scale.setScalar(this.worldPerPixel(group.position) * HANDLE_PX * 0.75)
      } else if (info.kind === 'lift') {
        group.visible = !(this.drag && this.drag.kind !== 'lift')
        const top = t.localToWorld(this.boxPoint(new Vector3(0, 1, 0), this.display))
        const s = this.worldPerPixel(top) * HANDLE_PX
        group.position.copy(top).y += s * 1.6
        group.scale.setScalar(s * 1.4)
      } else {
        const d = this.drag
        group.visible = !d || (d.kind === 'rotate' && d.axis === info.axis)
        this.updateArc(h, info.axis, wbox, center, px)
      }
    }
  }

  /** 軸に垂直な平面の基底 (u × v = axis) */
  private static basis(axis: Axis): [Vector3, Vector3, Vector3] {
    const X = new Vector3(1, 0, 0), Y = new Vector3(0, 1, 0), Z = new Vector3(0, 0, 1)
    return axis === 'x' ? [Y, Z, X] : axis === 'y' ? [Z, X, Y] : [X, Y, Z]
  }

  private arcCenter(axis: Axis, wbox: Box3, center: Vector3): Vector3 {
    // Y 回転の円弧は床面の高さに置く（Tinkercad と同様）
    return axis === 'y' ? new Vector3(center.x, wbox.min.y, center.z) : center.clone()
  }

  private updateArc(h: Handle, axis: Axis, wbox: Box3, center: Vector3, px: number): void {
    const [u, v, n] = Gizmo.basis(axis)
    const half = wbox.getSize(new Vector3()).multiplyScalar(0.5)
    const r = Math.hypot(half.dot(u), half.dot(v)) + px * 1.5
    const tube = px * 0.22
    const key = `${r.toPrecision(3)}|${tube.toPrecision(2)}`
    if (h.arcKey !== key) {
      h.arcKey = key
      h.visual.geometry.dispose()
      h.hit.geometry.dispose()
      h.visual.geometry = new TorusGeometry(r, tube, 6, 24, ARC_SWEEP)
      h.hit.geometry = new TorusGeometry(r, tube * 3, 4, 12, ARC_SWEEP)
    }
    const c = this.arcCenter(axis, wbox, center)
    const cam = this.camera.position.clone().sub(c)
    const theta = Math.atan2(cam.dot(v), cam.dot(u))
    const q = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(u, v, n))
    q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), theta - ARC_SWEEP / 2))
    h.group.position.copy(c)
    h.group.quaternion.copy(q)
    h.group.scale.setScalar(1)
  }

  // ------------------------------------------------------------ picking / hover

  pick(raycaster: Raycaster): Handle | null {
    if (!this.target) return null
    const hits = raycaster.intersectObjects(
      this.handles.filter((h) => h.group.visible).map((h) => h.hit),
      false,
    )
    // ハンドルは常に手前に描画されるので奥行きではなく「画面上の近さ」で選ぶ。
    // 点状のハンドルは中心からのピクセル距離、円弧は当たった時点で一定値
    let best: Handle | null = null
    let bestScore = Infinity
    for (const hit of hits) {
      const h = hit.object.userData.handle as Handle
      let score = HANDLE_PX * 0.5
      if (h.info.kind !== 'rotate') {
        const c = h.group.getWorldPosition(new Vector3())
        score = raycaster.ray.distanceToPoint(c) / this.worldPerPixel(c)
        // 小さな物体ではハンドル同士・本体と重なるので、中心付近だけを反応範囲にする
        if (score > HANDLE_PX * 0.8) continue
      }
      if (score < bestScore) [best, bestScore] = [h, score]
    }
    return best
  }

  /** 回転中心: ローカル箱の中心のワールド座標（物体に固定された点なので回転しても動かない） */
  rotationCenter(): Vector3 | null {
    if (!this.target) return null
    this.target.updateMatrixWorld(true)
    return this.target.localToWorld(this.box.getCenter(new Vector3()))
  }

  /** テスト・デバッグ用: 表示中ハンドルの識別名とワールド座標（回転円弧は中央点） */
  debugHandles(): { name: string; world: Vector3 }[] {
    this.update()
    return this.handles
      .filter((h) => h.group.visible)
      .map((h) => {
        const i = h.info
        const name =
          i.kind === 'scale' ? `scale:${i.at.x},${i.at.y},${i.at.z}` : i.kind === 'lift' ? 'lift' : `rotate:${i.axis}`
        h.group.updateMatrixWorld(true)
        let world = h.group.position.clone()
        if (i.kind === 'rotate') {
          const r = (h.visual.geometry as TorusGeometry).parameters.radius
          world = new Vector3(Math.cos(ARC_SWEEP / 2) * r, Math.sin(ARC_SWEEP / 2) * r, 0).applyMatrix4(h.group.matrixWorld)
        } else if (i.kind === 'lift') world.y += h.group.scale.y * 0.5
        return { name, world }
      })
  }

  setHover(h: Handle | null): void {
    if (this.hovered === h) return
    if (this.hovered) (this.hovered.visual.material as MeshBasicMaterial).color.set(this.hovered.baseColor)
    this.hovered = h
    if (h) (h.visual.material as MeshBasicMaterial).color.set(HOVER_COLOR)
  }

  // ------------------------------------------------------------ drag

  private saveStart(): void {
    const t = this.target!
    this.start = { pos: t.position.clone(), quat: t.quaternion.clone(), scale: t.scale.clone() }
  }

  /** カメラ方向に向いた、axis を含む平面 */
  private facingPlane(axis: Vector3, through: Vector3): Plane {
    const view = this.camera.position.clone().sub(through)
    const n = view.sub(axis.clone().multiplyScalar(view.dot(axis))).normalize()
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0)
    return new Plane().setFromNormalAndCoplanarPoint(n, through)
  }

  beginHandleDrag(h: Handle, ray: Ray): void {
    const t = this.target
    if (!t) return
    this.saveStart()
    const info = h.info
    if (info.kind === 'scale') {
      const up = new Vector3(0, 1, 0).applyQuaternion(t.quaternion)
      this.updateDisplayBox()
      const handleWorld = t.localToWorld(this.boxPoint(info.at, this.display))
      const plane = info.dir.y !== 0 ? this.facingPlane(up, handleWorld) : new Plane().setFromNormalAndCoplanarPoint(up, handleWorld)
      // 反対側（固定点）。伸縮しない軸は中央、ただし高さは常に底面（Shift 等倍時も接地を保つ）
      const anchorLocal = this.boxPoint(info.dir.clone().negate().setY(info.dir.y === 0 ? -1 : -info.dir.y))
      const q0 = this.toFrame(ray.intersectPlane(plane, new Vector3()) ?? handleWorld)
      this.drag = { kind: 'scale', h: h as never, plane, q0, anchorLocal, anchorWorld: t.localToWorld(anchorLocal.clone()) }
    } else if (info.kind === 'lift') {
      const plane = this.facingPlane(new Vector3(0, 1, 0), this.worldBox().getCenter(new Vector3()))
      this.drag = { kind: 'lift', plane, y0: (ray.intersectPlane(plane, new Vector3()) ?? t.position).y }
    } else {
      const wbox = this.worldBox()
      const center = this.arcCenter(info.axis, wbox, wbox.getCenter(new Vector3()))
      const [, , n] = Gizmo.basis(info.axis)
      const plane = new Plane().setFromNormalAndCoplanarPoint(n, center)
      const a = this.angleOn(info.axis, center, ray, plane) ?? 0
      // 回転中心はローカル箱の中心（Y 回転円弧は床面に描くが回転軸は中心を通る）
      this.drag = { kind: 'rotate', axis: info.axis, plane, center: this.rotationCenter()!, a0: a, last: a, total: 0 }
      const r = (h.visual.geometry as TorusGeometry).parameters?.radius ?? 0.2
      const [u, v] = Gizmo.basis(info.axis)
      this.protractor.position.copy(center)
      this.protractor.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(u, v, n))
      this.protractor.scale.setScalar(r)
      this.protractor.visible = true
      this.updateNeedle(a)
    }
  }

  /** 床と平行な面上で本体をドラッグ移動 */
  beginMove(grabPoint: Vector3): void {
    if (!this.target) return
    this.saveStart()
    this.drag = { kind: 'move', plane: new Plane(new Vector3(0, 1, 0), -grabPoint.y), p0: grabPoint.clone() }
  }

  /** 回転・平行移動のみの座標系（スケールなし）へ */
  private toFrame(world: Vector3): Vector3 {
    const s = this.start!
    return world.clone().sub(s.pos).applyQuaternion(s.quat.clone().invert())
  }

  private angleOn(axis: Axis, center: Vector3, ray: Ray, plane: Plane): number | null {
    const p = ray.intersectPlane(plane, new Vector3())
    if (!p) return null
    const [u, v] = Gizmo.basis(axis)
    p.sub(center)
    return Math.atan2(p.dot(v), p.dot(u))
  }

  private updateNeedle(angle: number): void {
    const attr = this.needle.geometry.getAttribute('position') as Float32BufferAttribute
    attr.setXYZ(1, Math.cos(angle), Math.sin(angle), 0)
    attr.needsUpdate = true
  }

  /** ドラッグ更新。HUD 用の説明文を返す */
  updateDrag(ray: Ray, uniform: boolean): string {
    const t = this.target, d = this.drag, s = this.start
    if (!t || !d || !s) return ''
    const hit = ray.intersectPlane(d.plane, new Vector3())

    if (d.kind === 'move') {
      if (hit) t.position.set(s.pos.x + hit.x - d.p0.x, s.pos.y, s.pos.z + hit.z - d.p0.z)
      this.snapToGrid(t)
      const b = this.worldBox()
      return `X ${cm(b.min.x)} / Z ${cm(b.min.z)} cm`
    }
    if (d.kind === 'lift') {
      if (hit) t.position.set(s.pos.x, s.pos.y + hit.y - d.y0, s.pos.z)
      this.snapToGrid(t)
      return `高さ ${cm(this.worldBox().min.y)} cm`
    }
    if (d.kind === 'rotate') {
      const a = this.angleOn(d.axis, d.center, ray, d.plane)
      if (a !== null) {
        let delta = a - d.last
        if (delta > Math.PI) delta -= Math.PI * 2
        if (delta < -Math.PI) delta += Math.PI * 2
        d.total += delta
        d.last = a
      }
      const snapped = Math.round(d.total / ROT_STEP) * ROT_STEP
      const [, , n] = Gizmo.basis(d.axis)
      const qa = new Quaternion().setFromAxisAngle(n, snapped)
      t.quaternion.copy(qa).multiply(s.quat)
      // 回転中心（ローカル箱の中心＝物体に固定された点）は動かさない。
      // ここで bbox スナップすると非対称形状で中心がずれていくのでしない
      t.position.copy(s.pos).sub(d.center).applyQuaternion(qa).add(d.center)
      this.updateNeedle(d.a0 + snapped)
      return `${d.axis.toUpperCase()} 軸 ${Math.round((snapped * 180) / Math.PI)}°`
    }

    // scale
    const { info } = d.h
    const q = this.toFrame(hit ?? new Vector3())
    const s0 = this.box.getSize(new Vector3())
    const newScale = s.scale.clone()
    if (hit) {
      const ratios: { axis: Axis; ratio: number }[] = []
      for (const axis of AXES) {
        if (info.dir[axis] === 0 || s0[axis] < 1e-9) continue
        const startSize = s0[axis] * Math.abs(s.scale[axis])
        const size = Math.max(SNAP, snapValue(startSize + (q[axis] - d.q0[axis]) * info.dir[axis]))
        newScale[axis] = size / s0[axis]
        ratios.push({ axis, ratio: size / startSize })
      }
      if (uniform && ratios.length) {
        // Shift: 全軸を同じ比率で（変化の大きい軸のサイズをグリッドに合わせる）
        const drive = ratios.reduce((a, b) => (Math.abs(b.ratio - 1) > Math.abs(a.ratio - 1) ? b : a))
        for (const axis of AXES) newScale[axis] = s.scale[axis] * drive.ratio
      }
    }
    t.scale.copy(newScale)
    // 固定点がワールドで動かないよう位置を補正
    const anchorScaled = d.anchorLocal.clone().multiply(newScale).applyQuaternion(s.quat)
    t.position.copy(d.anchorWorld).sub(anchorScaled)
    t.updateMatrixWorld(true)
    const size = s0.multiply(newScale)
    return `${cm(size.x)} × ${cm(size.y)} × ${cm(size.z)} cm`
  }

  /** ドラッグを取り消して開始時の状態に戻す */
  cancelDrag(): void {
    const t = this.target, s = this.start
    this.drag = null
    this.protractor.visible = false
    if (!t || !s) return
    t.position.copy(s.pos)
    t.quaternion.copy(s.quat)
    t.scale.copy(s.scale)
    t.updateMatrixWorld(true)
  }

  /** ドラッグ終了。変化があれば true */
  endDrag(): boolean {
    const t = this.target, s = this.start
    this.drag = null
    this.protractor.visible = false
    if (!t || !s) return false
    return !t.position.equals(s.pos) || !t.quaternion.equals(s.quat) || !t.scale.equals(s.scale)
  }
}

const cm = (m: number) => +(m * 100).toFixed(1)
