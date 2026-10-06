/**
 * three.js シーンと編集操作の本体。Vue からは公開メソッドと onChange だけを使う。
 * オブジェクトの真のデータは Mesh（transform）+ userData（形状・色）で、
 * toData()/restore() で SceneObjectData[] と相互変換する（保存・Undo 共通）。
 */
import {
  AmbientLight,
  Box3,
  BoxHelper,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  MOUSE,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { GRID, GRID_EXTENT, ROT_STEP, snapValue } from './constants'
import { History } from './history'
import { createDoc, exportGlb } from './io'
import { mergeObjects } from './merge'
import { geometryFromMeshData, setSingleColor, triangleCount } from './meshData'
import { DEFAULT_COLOR, paletteMaterials } from './palette'
import { buildPrimitiveGeometry, getPrimitive } from './primitives'
import type { MeshData, SceneDoc, SceneObjectData, Vec3, Quat } from './types'

export type TransformMode = 'translate' | 'rotate' | 'scale'

export interface EditorState {
  objectCount: number
  triangles: number
  selection: string[]
  selectionTriangles: number
  /** 選択物がすべて同じ単色ならその色ID */
  selectionColor: number | null
  currentColor: number
  mode: TransformMode
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
  readonly transform: TransformControls

  private readonly objectRoot = new Object3D()
  private readonly pivot = new Object3D()
  private readonly helpers = new Map<string, BoxHelper>()
  private readonly history = new History()
  private readonly raycaster = new Raycaster()
  private readonly groundPlane = new Plane(new Vector3(0, 1, 0), 0)
  private selection: string[] = []
  private mode: TransformMode = 'translate'
  /** 新規オブジェクトの色（パレットで最後に選んだ色） */
  private currentColor = DEFAULT_COLOR
  private frame = 0
  private resizeObserver: ResizeObserver
  private pointerDown: { x: number; y: number; onGizmo: boolean } | null = null

  onChange: (s: EditorState) => void = () => {}

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)
    this.scene.background = new Color('#dfe4ea')

    this.camera.position.set(1.2, 1.1, 1.6)
    this.setupLightsAndGround()
    this.scene.add(this.objectRoot, this.pivot)

    // 中ボタン=パン、右ボタン=回転、ホイール=ズーム。左は選択・ギズモ用に空ける
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }
    this.orbit.target.set(0, 0.1, 0)
    this.orbit.enableDamping = false
    this.orbit.update()

    this.transform = new TransformControls(this.camera, this.renderer.domElement)
    this.transform.setRotationSnap(ROT_STEP)
    this.transform.setSize(0.9)
    this.scene.add(this.transform.getHelper())
    this.transform.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !e.value
      if (!e.value) this.commit()
    })
    this.transform.addEventListener('objectChange', () => this.snapAttached())

    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointerup', this.onPointerUp)
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
    this.transform.dispose()
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

    const minor = new GridHelper(GRID_EXTENT, Math.round(GRID_EXTENT / GRID), '#9aa5b1', '#b8c1cb')
    const major = new GridHelper(GRID_EXTENT, GRID_EXTENT, '#5c6b7a', '#7f8c99')
    minor.position.y = -0.0005
    for (const g of [minor, major]) {
      g.raycast = () => {}
      this.scene.add(g)
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

  /** 複数選択時は pivot にまとめてギズモを付ける（移動・回転のみ） */
  private attachTransform(): void {
    const sel = this.selection.map((id) => this.meshById(id)!).filter(Boolean)
    if (sel.length === 0) {
      this.transform.detach()
      return
    }
    if (sel.length === 1) {
      this.transform.attach(sel[0])
    } else {
      const box = new Box3()
      for (const m of sel) box.expandByObject(m, true)
      box.getCenter(this.pivot.position)
      this.pivot.quaternion.identity()
      this.pivot.scale.set(1, 1, 1)
      this.pivot.updateMatrixWorld()
      for (const m of sel) this.pivot.attach(m)
      this.transform.attach(this.pivot)
      if (this.mode === 'scale') this.mode = 'translate'
    }
    this.transform.setMode(this.mode)
    this.transform.setSpace(this.mode === 'translate' ? 'world' : 'local')
  }

  private releasePivot(): void {
    for (const c of [...this.pivot.children]) this.objectRoot.attach(c)
  }

  setMode(mode: TransformMode): void {
    if (mode === 'scale' && this.selection.length > 1) return
    this.mode = mode
    this.transform.setMode(mode)
    this.transform.setSpace(mode === 'translate' ? 'world' : 'local')
    this.emit()
  }

  // ------------------------------------------------------------ snapping

  /** ギズモ操作中の対象をグリッドにスナップ（拡縮はサイズを 10cm 単位、位置はバウンディングボックス最小点） */
  private snapAttached(): void {
    const obj = this.transform.object
    if (!obj) return
    if (this.mode === 'scale' && obj instanceof Mesh) {
      const s0 = obj.geometry.boundingBox!.getSize(new Vector3())
      for (const axis of ['x', 'y', 'z'] as const) {
        if (s0[axis] < 1e-6) continue
        const size = Math.max(GRID, snapValue(s0[axis] * Math.abs(obj.scale[axis])))
        obj.scale[axis] = size / s0[axis]
      }
    }
    this.snapBoxMin(obj)
  }

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
    const obj = this.transform.object
    if (!obj) return
    obj.position.add(new Vector3(dx, dy, dz).multiplyScalar(GRID))
    this.snapBoxMin(obj)
    this.commit()
  }

  /** 選択物を指定軸まわりに 45° 回転 */
  rotateSelected(axis: 'x' | 'y' | 'z', dir = 1): void {
    const obj = this.transform.object
    if (!obj) return
    const v = new Vector3()
    v[axis] = 1
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

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return
    this.pointerDown = { x: e.clientX, y: e.clientY, onGizmo: this.transform.axis !== null }
  }

  private onPointerUp = (e: PointerEvent): void => {
    const d = this.pointerDown
    this.pointerDown = null
    if (e.button !== 0 || !d || d.onGizmo) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return
    const hit = this.pick(e.clientX, e.clientY)
    const id = hit ? (hit.object.userData as ObjUserData).id : null
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (!id) return
      this.setSelection(this.selection.includes(id) ? this.selection.filter((s) => s !== id) : [...this.selection, id])
    } else this.setSelection(id ? [id] : [])
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
      mode: this.mode,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    }
  }

  private emit(): void {
    this.onChange(this.currentState())
  }
}
