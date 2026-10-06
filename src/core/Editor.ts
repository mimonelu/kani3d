/**
 * three.js シーンと編集操作の本体。Vue からは公開メソッドと onChange だけを使う。
 * オブジェクトの真のデータは Mesh（transform）+ userData（形状・色）で、
 * toData()/restore() で SceneObjectData[] と相互変換する（保存・Undo 共通）。
 */
import {
  AmbientLight,
  CanvasTexture,
  Box3,
  BoxHelper,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  MOUSE,
  MeshBasicMaterial,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Plane,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GRID, GRID_EXTENT, ROT_STEP, snapValue } from './constants'
import { AXIS_COLOR, Gizmo } from './Gizmo'
import { History } from './history'
import { createDoc, exportGlb } from './io'
import { mergeObjects } from './merge'
import { geometryFromMeshData, setSingleColor, triangleCount } from './meshData'
import { DEFAULT_COLOR, paletteMaterials } from './palette'
import { buildPrimitiveGeometry, getPrimitive } from './primitives'
import type { MeshData, SceneDoc, SceneObjectData, Vec3, Quat } from './types'

export interface EditorState {
  objectCount: number
  triangles: number
  selection: string[]
  selectionTriangles: number
  /** 選択物がすべて同じ単色ならその色ID */
  selectionColor: number | null
  /** 選択物全体のサイズ (m) */
  selectionSize: Vec3 | null
  currentColor: number
  /** ドラッグ中の寸法・角度など（HUD 表示用） */
  dragInfo: string
  canUndo: boolean
  canRedo: boolean
}

type ObjUserData = { id: string; kind: 'primitive'; primitive: string } | { id: string; kind: 'mesh'; mesh: MeshData }

let idSeq = 0
const newId = () => `o${Date.now().toString(36)}${(idSeq++).toString(36)}`

export class Editor {
  readonly scene = new Scene()
  readonly camera = new PerspectiveCamera(45, 1, 0.01, 200)
  readonly renderer: WebGLRenderer
  readonly orbit: OrbitControls
  readonly gizmo: Gizmo

  private readonly objectRoot = new Object3D()
  private readonly pivot = new Object3D()
  private readonly helpers = new Map<string, BoxHelper>()
  private readonly history = new History()
  private readonly raycaster = new Raycaster()
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0)
  private selection: string[] = []
  /** 新規オブジェクトの色（パレットで最後に選んだ色） */
  private currentColor = DEFAULT_COLOR
  private frame = 0
  private resizeObserver: ResizeObserver
  /** 左ボタン押下中の状態。clickId は「動かさずに離したら単独選択にする」対象 */
  private pointer: { x: number; y: number; dragging: boolean; clickId: string | null } | null = null
  private dragInfo = ''

  onChange: (s: EditorState) => void = () => {}

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)
    this.scene.background = new Color('#1b1f24')

    this.camera.position.set(0.75, 0.7, 1.0)
    this.setupLightsAndGround()
    this.scene.add(this.objectRoot, this.pivot)

    // 中ボタン=パン、右ボタン=回転、ホイール=ズーム。左は選択・ギズモ用に空ける
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }
    this.orbit.target.set(0, 0.1, 0)
    this.orbit.enableDamping = false
    this.orbit.update()

    this.gizmo = new Gizmo(this.camera, (o) => this.snapBoxMin(o))
    this.scene.add(this.gizmo.root)

    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointercancel', this.onPointerUp)
    el.addEventListener('contextmenu', (e) => e.preventDefault())

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.history.reset(this.toData())
    this.loop()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.orbit.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  // ------------------------------------------------------------ setup

  private setupLightsAndGround(): void {
    this.scene.add(new HemisphereLight('#ffffff', '#8090a0', 1.6))
    this.scene.add(new AmbientLight('#ffffff', 0.3))
    const dir = new DirectionalLight('#ffffff', 1.6)
    dir.position.set(3, 5, 2)
    this.scene.add(dir)

    const minor = new GridHelper(GRID_EXTENT, Math.round(GRID_EXTENT / GRID), '#2e353e', '#2e353e')
    const major = new GridHelper(GRID_EXTENT, GRID_EXTENT, '#4a5562', '#4a5562')
    minor.position.y = -0.0005
    for (const g of [minor, major]) {
      g.raycast = () => {}
      this.scene.add(g)
    }
    // 原点から +X / +Z 方向の軸ライン（細い板で太さを出す）
    const half = GRID_EXTENT / 2
    for (const axis of ['x', 'z'] as const) {
      const w = 0.006
      const geo = new PlaneGeometry(axis === 'x' ? half : w, axis === 'x' ? w : half).rotateX(-Math.PI / 2)
      const line = new Mesh(geo, new MeshBasicMaterial({ color: AXIS_COLOR[axis], depthWrite: false }))
      line.position.set(axis === 'x' ? half / 2 : 0, 0.0008, axis === 'z' ? half / 2 : 0)
      line.raycast = () => {}
      line.renderOrder = 1
      this.scene.add(line)
      const label = axisLabel(axis === 'x' ? '+X' : '+Z', AXIS_COLOR[axis])
      label.position.set(axis === 'x' ? half + 0.12 : 0, 0.02, axis === 'z' ? half + 0.12 : 0)
      this.scene.add(label)
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop)
    for (const h of this.helpers.values()) h.update()
    this.gizmo.viewportHeight = this.renderer.domElement.clientHeight || 1
    this.gizmo.update()
    this.renderer.render(this.scene, this.camera)
  }

  // ------------------------------------------------------------ data <-> mesh

  private get meshes(): Mesh[] {
    const out: Mesh[] = []
    // pivot に一時的に付け替えられたものも含める
    for (const root of [this.objectRoot, this.pivot]) for (const c of root.children) if (c instanceof Mesh) out.push(c)
    return out
  }

  private meshById(id: string): Mesh | undefined {
    return this.meshes.find((m) => (m.userData as ObjUserData).id === id)
  }

  private buildMesh(d: SceneObjectData): Mesh {
    let geometry: BufferGeometry
    let ud: ObjUserData
    if (d.kind === 'primitive') {
      geometry = setSingleColor(buildPrimitiveGeometry(d.primitive), d.color)
      ud = { id: d.id, kind: 'primitive', primitive: d.primitive }
    } else {
      geometry = geometryFromMeshData(d.mesh)
      ud = { id: d.id, kind: 'mesh', mesh: d.mesh }
    }
    geometry.computeBoundingBox()
    const mesh = new Mesh(geometry, paletteMaterials())
    mesh.name = d.kind === 'primitive' ? (getPrimitive(d.primitive)?.label ?? d.primitive) : '結合オブジェクト'
    mesh.userData = ud
    mesh.position.fromArray(d.position)
    mesh.quaternion.fromArray(d.quaternion)
    mesh.scale.fromArray(d.scale)
    return mesh
  }

  private meshToData(m: Mesh): SceneObjectData {
    m.updateWorldMatrix(true, false)
    const p = new Vector3(), q = m.quaternion.clone(), s = new Vector3()
    m.matrixWorld.decompose(p, q, s)
    const r = (v: number) => Math.round(v * 1e6) / 1e6
    const t = {
      position: p.toArray().map(r) as Vec3,
      quaternion: q.toArray().map(r) as Quat,
      scale: s.toArray().map(r) as Vec3,
    }
    const ud = m.userData as ObjUserData
    if (ud.kind === 'primitive') {
      return { id: ud.id, kind: 'primitive', primitive: ud.primitive, color: m.geometry.groups[0]?.materialIndex ?? 0, ...t }
    }
    return { id: ud.id, kind: 'mesh', mesh: ud.mesh, ...t }
  }

  toData(): SceneObjectData[] {
    return this.meshes.map((m) => this.meshToData(m))
  }

  toDoc(): SceneDoc {
    return createDoc(this.toData())
  }

  /** データからシーンを再構築（読み込み・Undo/Redo） */
  private restore(data: SceneObjectData[], selection: string[] = []): void {
    this.releasePivot()
    for (const m of this.meshes) {
      m.removeFromParent()
      m.geometry.dispose()
    }
    for (const d of data) this.objectRoot.add(this.buildMesh(d))
    this.setSelection(selection.filter((id) => data.some((d) => d.id === id)))
  }

  loadDoc(doc: SceneDoc): void {
    this.restore(doc.objects)
    this.history.reset(this.toData())
    this.emit()
  }

  newScene(): void {
    this.loadDoc(createDoc([]))
  }

  // ------------------------------------------------------------ history

  private commit(): void {
    if (this.history.push(this.toData())) this.emit()
  }

  undo(): void {
    const d = this.history.undo()
    if (d) this.restore(d, this.selection)
    this.emit()
  }

  redo(): void {
    const d = this.history.redo()
    if (d) this.restore(d, this.selection)
    this.emit()
  }

  // ------------------------------------------------------------ selection

  getSelection(): string[] {
    return [...this.selection]
  }

  setSelection(ids: string[]): void {
    this.releasePivot()
    this.selection = ids.filter((id) => this.meshById(id))
    for (const h of this.helpers.values()) {
      h.removeFromParent()
      h.dispose()
    }
    this.helpers.clear()
    for (const id of this.selection) {
      const h = new BoxHelper(this.meshById(id)!, '#ff8a00')
      h.raycast = () => {}
      this.helpers.set(id, h)
      this.scene.add(h)
    }
    this.attachTransform()
    this.emit()
  }

  selectAll(): void {
    this.setSelection(this.meshes.map((m) => (m.userData as ObjUserData).id))
  }

  /** 操作対象: 単独選択ならそのメッシュ、複数なら pivot */
  private get transformTarget(): Object3D | null {
    if (this.selection.length === 0) return null
    return this.selection.length === 1 ? (this.meshById(this.selection[0]) ?? null) : this.pivot
  }

  /** 複数選択時は pivot にまとめてハンドルを付ける（移動・回転のみ。拡縮は単独選択時） */
  private attachTransform(): void {
    const sel = this.selection.map((id) => this.meshById(id)!).filter(Boolean)
    if (sel.length === 0) {
      this.gizmo.detach()
      return
    }
    if (sel.length === 1) {
      this.gizmo.attach(sel[0], sel[0].geometry.boundingBox!, true)
    } else {
      const box = new Box3()
      for (const m of sel) box.expandByObject(m, true)
      box.getCenter(this.pivot.position)
      this.pivot.quaternion.identity()
      this.pivot.scale.set(1, 1, 1)
      this.pivot.updateMatrixWorld()
      for (const m of sel) this.pivot.attach(m)
      this.gizmo.attach(this.pivot, box.translate(this.pivot.position.clone().negate()), false)
    }
  }

  private releasePivot(): void {
    for (const c of [...this.pivot.children]) this.objectRoot.attach(c)
  }

  // ------------------------------------------------------------ snapping

  /** バウンディングボックス最小点を 10cm 格子へ（原点基準ではないので奇数サイズや回転後も面が格子に揃う） */
  private snapBoxMin(obj: Object3D): void {
    obj.updateMatrixWorld(true)
    const box = new Box3().setFromObject(obj, true)
    if (box.isEmpty()) return
    obj.position.x += snapValue(box.min.x) - box.min.x
    obj.position.y += snapValue(box.min.y) - box.min.y
    obj.position.z += snapValue(box.min.z) - box.min.z
    obj.updateMatrixWorld(true)
  }

  // ------------------------------------------------------------ editing

  /** プリミティブを追加。at 未指定なら選択物の上、無ければ注視点の床に置く */
  addPrimitive(primitive: string, at?: Vector3): string {
    const id = newId()
    const mesh = this.buildMesh({
      id,
      kind: 'primitive',
      primitive,
      color: this.currentColor,
      position: [0, 0, 0],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    })
    let base = at
    if (!base) {
      const sel = this.selection.map((i) => this.meshById(i)!).filter(Boolean)
      if (sel.length) {
        const box = new Box3()
        for (const m of sel) box.expandByObject(m, true)
        base = new Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2)
      } else base = new Vector3(this.orbit.target.x, 0, this.orbit.target.z)
    }
    const bb = mesh.geometry.boundingBox!
    mesh.position.set(base.x, base.y - bb.min.y, base.z)
    this.objectRoot.add(mesh)
    this.snapBoxMin(mesh)
    this.setSelection([id])
    this.commit()
    return id
  }

  deleteSelected(): void {
    if (!this.selection.length) return
    this.releasePivot()
    for (const id of this.selection) {
      const m = this.meshById(id)
      m?.removeFromParent()
      m?.geometry.dispose()
    }
    this.setSelection([])
    this.commit()
  }

  duplicateSelected(): void {
    if (!this.selection.length) return
    this.releasePivot()
    const copies = this.selection.map((id) => {
      const d = { ...this.meshToData(this.meshById(id)!), id: newId() }
      d.position = [d.position[0] + GRID * 2, d.position[1], d.position[2] + GRID * 2]
      this.objectRoot.add(this.buildMesh(d))
      return d.id
    })
    this.setSelection(copies)
    this.commit()
  }

  setColor(color: number): void {
    this.currentColor = color
    this.emit()
    if (!this.selection.length) return
    for (const id of this.selection) {
      const m = this.meshById(id)!
      const ud = m.userData as ObjUserData
      if (ud.kind === 'mesh') {
        ud.mesh = { ...ud.mesh, groups: [{ start: 0, count: ud.mesh.indices.length, color }] }
      }
      setSingleColor(m.geometry, color)
    }
    this.commit()
  }

  /** 選択物を移動（矢印キー用）。delta はグリッド単位 */
  nudge(dx: number, dy: number, dz: number): void {
    const obj = this.transformTarget
    if (!obj) return
    obj.position.add(new Vector3(dx, dy, dz).multiplyScalar(GRID))
    this.snapBoxMin(obj)
    this.commit()
  }

  /** 選択物を指定軸まわりに 45° 回転 */
  rotateSelected(axis: 'x' | 'y' | 'z', dir = 1): void {
    const obj = this.transformTarget
    if (!obj) return
    const v = new Vector3()
    v[axis] = 1
    // ボックス中心まわりに回転
    const c = new Box3().setFromObject(obj, true).getCenter(new Vector3())
    obj.position.sub(c).applyAxisAngle(v, ROT_STEP * dir).add(c)
    obj.rotateOnWorldAxis(v, ROT_STEP * dir)
    this.snapBoxMin(obj)
    this.commit()
  }

  /** 選択物を CSG 和集合で1つのメッシュに結合 */
  mergeSelected(): string | null {
    if (this.selection.length < 2) return null
    this.releasePivot()
    const sel = this.selection.map((id) => this.meshById(id)!)
    for (const m of sel) m.updateMatrixWorld(true)
    const { mesh, center } = mergeObjects(sel.map((m) => ({ geometry: m.geometry, matrixWorld: m.matrixWorld })))
    for (const m of sel) {
      m.removeFromParent()
      m.geometry.dispose()
    }
    const id = newId()
    this.objectRoot.add(
      this.buildMesh({ id, kind: 'mesh', mesh, position: center.toArray() as Vec3, quaternion: [0, 0, 0, 1], scale: [1, 1, 1] }),
    )
    this.setSelection([id])
    this.commit()
    return id
  }

  /** 選択物全体のワールド AABB */
  selectionBounds(): { min: Vec3; max: Vec3 } | null {
    const box = new Box3()
    for (const id of this.selection) box.expandByObject(this.meshById(id)!, true)
    if (box.isEmpty()) return null
    const r = (v: Vector3) => v.toArray().map((x) => Math.round(x * 1e4) / 1e4) as Vec3
    return { min: r(box.min), max: r(box.max) }
  }

  /** 選択物にカメラ注視点を合わせる */
  focusSelection(): void {
    const sel = this.selection.map((id) => this.meshById(id)!)
    const box = new Box3()
    for (const m of sel.length ? sel : this.meshes) box.expandByObject(m, true)
    if (box.isEmpty()) return
    const c = box.getCenter(new Vector3())
    this.camera.position.add(c.clone().sub(this.orbit.target))
    this.orbit.target.copy(c)
    this.orbit.update()
  }

  exportGlb(): Promise<ArrayBuffer> {
    this.releasePivot()
    const p = exportGlb(this.meshes)
    this.attachTransform()
    return p
  }

  // ------------------------------------------------------------ picking

  private ndc(clientX: number, clientY: number): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
  }

  private pick(clientX: number, clientY: number) {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera)
    return this.raycaster.intersectObjects(this.meshes, false)[0]
  }

  /** ドロップ位置: オブジェクト上ならその天面、そうでなければ床 */
  dropPoint(clientX: number, clientY: number): Vector3 | null {
    const hit = this.pick(clientX, clientY)
    if (hit) {
      const box = new Box3().setFromObject(hit.object, true)
      return new Vector3(hit.point.x, box.max.y, hit.point.z)
    }
    return this.raycaster.ray.intersectPlane(this.groundPlane, new Vector3())
  }

  /** テスト・デバッグ用: ハンドルのクライアント座標 */
  debugHandleScreen(): Record<string, { x: number; y: number }> {
    const r = this.renderer.domElement.getBoundingClientRect()
    const out: Record<string, { x: number; y: number }> = {}
    for (const { name, world } of this.gizmo.debugHandles()) {
      const p = world.project(this.camera)
      out[name] = { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }
    }
    return out
  }

  private setRay(e: PointerEvent): void {
    this.raycaster.setFromCamera(this.ndc(e.clientX, e.clientY), this.camera)
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    this.setRay(e)
    this.pointer = { x: e.clientX, y: e.clientY, dragging: false, clickId: null }
    // 1) ハンドル
    const handle = this.gizmo.pick(this.raycaster)
    if (handle) {
      this.gizmo.beginHandleDrag(handle, this.raycaster.ray)
      this.startDrag(e)
      return
    }
    // 2) オブジェクト: Shift/Ctrl は選択の追加・解除のみ。通常は選択してそのまま床と平行に移動
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0]
    if (!hit) return
    const id = (hit.object.userData as ObjUserData).id
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      this.setSelection(this.selection.includes(id) ? this.selection.filter((s) => s !== id) : [...this.selection, id])
      this.pointer = null
      return
    }
    if (!this.selection.includes(id)) this.setSelection([id])
    else this.pointer.clickId = id
    this.gizmo.beginMove(hit.point)
    this.startDrag(e)
  }

  private startDrag(e: PointerEvent): void {
    this.pointer!.dragging = true
    this.orbit.enabled = false
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* 合成イベントなど */
    }
  }

  private onPointerMove = (e: PointerEvent): void => {
    this.setRay(e)
    if (this.pointer?.dragging && this.gizmo.dragging) {
      const info = this.gizmo.updateDrag(this.raycaster.ray, e.shiftKey)
      if (info !== this.dragInfo) {
        this.dragInfo = info
        this.emit()
      }
      return
    }
    if (this.pointer) return
    const h = this.gizmo.pick(this.raycaster)
    this.gizmo.setHover(h)
    const overObject = !h && this.raycaster.intersectObjects(this.meshes, false).length > 0
    this.renderer.domElement.style.cursor = h ? 'grab' : overObject ? 'move' : ''
  }

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.pointer
    this.pointer = null
    if (!p || e.button !== 0) return
    const clicked = Math.hypot(e.clientX - p.x, e.clientY - p.y) <= 4
    if (p.dragging) {
      this.orbit.enabled = true
      const changed = this.gizmo.endDrag()
      this.dragInfo = ''
      if (changed) this.commit()
      else if (clicked && p.clickId && this.selection.length > 1) this.setSelection([p.clickId])
      this.emit()
      return
    }
    if (clicked) this.setSelection([])
  }

  // ------------------------------------------------------------ state

  currentState(): EditorState {
    const meshes = this.meshes
    const sel = this.selection.map((id) => this.meshById(id)).filter((m): m is Mesh => !!m)
    const colors = new Set(sel.flatMap((m) => m.geometry.groups.map((g) => g.materialIndex ?? 0)))
    return {
      objectCount: meshes.length,
      triangles: meshes.reduce((n, m) => n + triangleCount(m.geometry), 0),
      selection: [...this.selection],
      selectionTriangles: sel.reduce((n, m) => n + triangleCount(m.geometry), 0),
      selectionColor: colors.size === 1 ? [...colors][0] : null,
      currentColor: this.currentColor,
      selectionSize: (() => {
        const b = this.selectionBounds()
        return b ? (b.max.map((v, i) => Math.round((v - b.min[i]) * 1e4) / 1e4) as Vec3) : null
      })(),
      dragInfo: this.dragInfo,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    }
  }

  private emit(): void {
    this.onChange(this.currentState())
  }
}

/** 地面に置く軸ラベル（スプライト） */
function axisLabel(text: string, color: string): Sprite {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.font = 'bold 44px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = color
  ctx.fillText(text, 64, 32)
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(c), depthWrite: false }))
  sprite.scale.set(0.2, 0.1, 1)
  sprite.raycast = () => {}
  return sprite
}
