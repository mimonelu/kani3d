/**
 * three.js シーンと編集操作の本体。Vue からは公開メソッドと onChange だけを使う。
 * オブジェクトの真のデータは Mesh（transform）+ userData（形状・色）で、
 * toData()/restore() で SceneObjectData[] と相互変換する（保存・Undo 共通）。
 */
import {
  AmbientLight,
  BufferAttribute,
  CanvasTexture,
  Box3,
  BoxHelper,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  GridHelper,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  MOUSE,
  MeshBasicMaterial,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
  WireframeGeometry,
  BufferGeometry,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GRID, GRID_EXTENT, ROT_STEP, SNAP, snapValue } from './constants'
import { AXIS_COLOR, Gizmo } from './Gizmo'
import { History } from './history'
import { createDoc, exportGlb } from './io'
import { mergeObjects } from './merge'
import { checkMesh, type MeshIssues } from './meshCheck'
import { geometryFromMeshData, setSingleColor, triangleCount } from './meshData'
import { DEFAULT_COLOR, paletteMaterials } from './palette'
import { buildPrimitiveGeometry, compactParams, getPrimitive, resolveParams, type PrimitiveParams } from './primitives'
import type { MeshData, Quat, SceneDoc, SceneObjectData, Vec3 } from './types'

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
  /** エディタ表示のフラットシェーディング（見た目のみ。GLB の法線には影響しない） */
  flatShading: boolean
  /** X線表示（半透明＋ワイヤーフレーム＋問題辺の強調） */
  xray: boolean
  /** 選択中の結合物の検査結果（合計）。結合物を選択していなければ null */
  selectionIssues: { open: number; nonManifold: number; flipped: number } | null
  /** 単独選択中のプリミティブとその形状オプション（形状オプション UI 用） */
  selectionPrimitive: { primitive: string; params: PrimitiveParams } | null
  /** 選択物に結合解除できるものがある */
  canUnmerge: boolean
  /** ドラッグ中の寸法・角度など（HUD 表示用） */
  dragInfo: string
  canUndo: boolean
  canRedo: boolean
}

type ObjUserData =
  | { id: string; kind: 'primitive'; primitive: string; params: PrimitiveParams }
  | { id: string; kind: 'mesh'; mesh: MeshData; sources?: SceneObjectData[] }

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
  private pointer: { id: number; x: number; y: number; dragging: boolean; clickId: string | null } | null = null
  private dragInfo = ''
  private xray = false

  onChange: (s: EditorState) => void = () => {}

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)
    this.scene.background = new Color('#1b1f24')

    this.setupLightsAndGround()
    this.scene.add(this.objectRoot, this.pivot)

    // 中ボタン=パン、右ボタン=回転、ホイール=ズーム。左は選択・ギズモ用に空ける
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement)
    this.orbit.mouseButtons = { LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }
    this.orbit.enableDamping = false
    this.resetView()

    this.gizmo = new Gizmo(this.camera, (o) => this.snapBoxMin(o))
    this.scene.add(this.gizmo.root)

    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointercancel', this.cancelDrag)
    el.addEventListener('lostpointercapture', this.onLostCapture)
    el.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('blur', this.cancelDrag)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.history.reset(this.toData())
    this.loop()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('pointercancel', this.cancelDrag)
    el.removeEventListener('lostpointercapture', this.onLostCapture)
    el.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('blur', this.cancelDrag)
    this.setSelection([])
    for (const m of this.meshes) disposeMesh(m)
    // グリッド・軸ライン・ギズモなど残りのリソース
    this.scene.traverse((o) => {
      const r = o as Partial<Mesh>
      r.geometry?.dispose()
      const mats = Array.isArray(r.material) ? r.material : r.material ? [r.material] : []
      for (const mat of mats) if (!paletteMaterials().includes(mat as never)) mat.dispose()
    })
    this.orbit.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    el.remove()
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
      geometry = setSingleColor(buildPrimitiveGeometry(d.primitive, d.params), d.color)
      ud = { id: d.id, kind: 'primitive', primitive: d.primitive, params: resolveParams(d.primitive, d.params) }
    } else {
      geometry = geometryFromMeshData(d.mesh)
      ud = { id: d.id, kind: 'mesh', mesh: d.mesh, sources: d.sources }
    }
    geometry.computeBoundingBox()
    const mesh = new Mesh(geometry, paletteMaterials())
    mesh.name = d.kind === 'primitive' ? (getPrimitive(d.primitive)?.label ?? d.primitive) : '結合オブジェクト'
    mesh.userData = ud
    if (this.xray) addOverlays(mesh)
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
      const color = m.geometry.groups[0]?.materialIndex ?? 0
      const params = compactParams(ud.primitive, ud.params)
      return { id: ud.id, kind: 'primitive', primitive: ud.primitive, color, ...t, ...(params && { params }) }
    }
    return { id: ud.id, kind: 'mesh', mesh: ud.mesh, ...t, ...(ud.sources && { sources: ud.sources }) }
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
      disposeMesh(m)
    }
    for (const d of data) this.objectRoot.add(this.buildMesh(d))
    this.setSelection(selection.filter((id) => data.some((d) => d.id === id)))
  }

  /** 読み込み（起動時の自動保存復元を含む）。オブジェクトがあれば全体が映るようカメラを合わせる */
  loadDoc(doc: SceneDoc): void {
    this.restore(doc.objects)
    this.history.reset(this.toData())
    this.revision++
    if (doc.objects.length) this.frameAll()
    else this.resetView()
    this.emit()
  }

  newScene(): void {
    this.loadDoc(createDoc([]))
  }

  // ------------------------------------------------------------ history

  /** シーン内容が変わるたびに増える（自動保存の要否判定用。選択変更などでは増えない） */
  revision = 0

  private commit(): void {
    if (!this.history.push(this.toData())) return
    this.revision++
    this.emit()
  }

  undo(): void {
    const d = this.history.undo()
    if (d) {
      this.restore(d, this.selection)
      this.revision++
    }
    this.emit()
  }

  redo(): void {
    const d = this.history.redo()
    if (d) {
      this.restore(d, this.selection)
      this.revision++
    }
    this.emit()
  }

  // ------------------------------------------------------------ selection

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

  /** バウンディングボックス最小点を 5cm 格子へ（原点基準ではないので奇数サイズや回転後も面が格子に揃う） */
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
      if (m) disposeMesh(m)
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
    for (const id of this.selection) {
      const m = this.meshById(id)!
      if (m.geometry.groups.every((g) => g.materialIndex === color)) continue // 変化なしは履歴に積まない
      const ud = m.userData as ObjUserData
      if (ud.kind === 'mesh') {
        ud.mesh = { ...ud.mesh, groups: [{ start: 0, count: ud.mesh.indices.length, color }] }
        // 結合解除したときも色が引き継がれるよう結合元も塗り替える
        if (ud.sources) ud.sources = recolor(ud.sources, color)
      }
      setSingleColor(m.geometry, color)
    }
    this.commit()
  }

  /** X線表示: 半透明・両面＋ワイヤーフレーム、結合物の問題辺を赤で強調（見た目のみ） */
  setXray(on: boolean): void {
    this.xray = on
    for (const m of paletteMaterials()) {
      m.transparent = on
      m.opacity = on ? 0.35 : 1
      m.depthWrite = !on
      m.side = on ? DoubleSide : FrontSide
      m.needsUpdate = true
    }
    for (const mesh of this.meshes) {
      removeOverlays(mesh)
      if (on) addOverlays(mesh)
    }
    this.emit()
  }

  /** エディタ表示のシェーディング切替（全オブジェクト共通・見た目のみ） */
  setFlatShading(flat: boolean): void {
    for (const m of paletteMaterials()) {
      m.flatShading = flat
      m.needsUpdate = true
    }
    this.emit()
  }

  /**
   * 単独選択中のプリミティブの形状オプションを変更して形状を作り直す。
   * 底面の高さは保つ。commit=false はスライダー操作中のプレビュー（履歴に積まない）
   */
  setPrimitiveParams(params: Partial<PrimitiveParams>, commit = true): void {
    if (this.selection.length !== 1) return
    const m = this.meshById(this.selection[0])
    const ud = m?.userData as ObjUserData | undefined
    if (!m || ud?.kind !== 'primitive') return
    const next = resolveParams(ud.primitive, { ...ud.params, ...params })
    if (JSON.stringify(next) !== JSON.stringify(ud.params)) {
      const bottom = new Box3().setFromObject(m, true).min.y
      const color = m.geometry.groups[0]?.materialIndex ?? DEFAULT_COLOR
      ud.params = next
      const old = m.geometry
      m.geometry = setSingleColor(buildPrimitiveGeometry(ud.primitive, next), color)
      old.dispose()
      if (this.xray) {
        removeOverlays(m)
        addOverlays(m)
      }
      m.updateMatrixWorld(true)
      m.position.y += bottom - new Box3().setFromObject(m, true).min.y
      this.attachTransform()
    }
    if (commit) this.commit()
    this.emit()
  }

  /** 選択物を移動（矢印キー用）。delta はスナップ単位 */
  nudge(dx: number, dy: number, dz: number): void {
    const obj = this.transformTarget
    if (!obj) return
    obj.position.add(new Vector3(dx, dy, dz).multiplyScalar(SNAP))
    this.snapBoxMin(obj)
    this.commit()
  }

  /** 選択物を指定軸まわりに 45° 回転 */
  rotateSelected(axis: 'x' | 'y' | 'z', dir = 1): void {
    const obj = this.transformTarget
    if (!obj) return
    const v = new Vector3()
    v[axis] = 1
    // ローカル箱の中心まわりに回転（位置スナップはしない＝中心が動かない）
    const c = this.gizmo.rotationCenter() ?? new Vector3()
    obj.position.sub(c).applyAxisAngle(v, ROT_STEP * dir).add(c)
    obj.rotateOnWorldAxis(v, ROT_STEP * dir)
    this.commit()
  }

  /** 選択物を CSG 和集合で1つのメッシュに結合 */
  mergeSelected(): { id: string; issues: MeshIssues } | null {
    if (this.selection.length < 2) return null
    this.releasePivot()
    const sel = this.selection.map((id) => this.meshById(id)!)
    for (const m of sel) m.updateMatrixWorld(true)
    let merged: ReturnType<typeof mergeObjects>
    try {
      merged = mergeObjects(sel.map((m) => ({ geometry: m.geometry, matrixWorld: m.matrixWorld })))
    } catch (e) {
      this.attachTransform() // pivot を外したままにしない
      throw e
    }
    const { mesh, center } = merged
    for (const m of sel) {
      disposeMesh(m)
    }
    // 結合元は結合後メッシュ（位置 center・回転なし・等倍）のローカル座標で保持
    const sources = sel.map((m) => {
      const d = this.meshToData(m)
      d.position = [d.position[0] - center.x, d.position[1] - center.y, d.position[2] - center.z].map(round6) as Vec3
      return d
    })
    const id = newId()
    this.objectRoot.add(
      this.buildMesh({
        id,
        kind: 'mesh',
        mesh,
        sources,
        position: center.toArray() as Vec3,
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      }),
    )
    this.setSelection([id])
    this.commit()
    return { id, issues: issuesOf(mesh) }
  }

  /** 選択中の結合オブジェクトを結合前に戻す（結合後の移動・回転・拡縮は結合元に引き継ぐ） */
  unmergeSelected(): string[] {
    this.releasePivot()
    const restored: string[] = []
    const keep: string[] = []
    for (const id of this.selection) {
      const m = this.meshById(id)!
      const ud = m.userData as ObjUserData
      if (ud.kind !== 'mesh' || !ud.sources) {
        keep.push(id)
        continue
      }
      m.updateMatrixWorld(true)
      for (const src of ud.sources) {
        const local = new Matrix4().compose(
          new Vector3(...src.position),
          new Quaternion(...src.quaternion),
          new Vector3(...src.scale),
        )
        const p = new Vector3(), q = new Quaternion(), s = new Vector3()
        new Matrix4().multiplyMatrices(m.matrixWorld, local).decompose(p, q, s)
        const d: SceneObjectData = {
          ...src,
          id: newId(), // 複製した結合物を解除しても ID が重複しないよう振り直す
          position: p.toArray().map(round6) as Vec3,
          quaternion: q.toArray().map(round6) as Quat,
          scale: s.toArray().map(round6) as Vec3,
        }
        this.objectRoot.add(this.buildMesh(d))
        restored.push(d.id)
      }
      disposeMesh(m)
    }
    if (!restored.length) {
      this.attachTransform()
      return []
    }
    this.setSelection([...keep, ...restored])
    this.commit()
    return restored
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
    if (!sel.length) return this.frameAll()
    const box = new Box3()
    for (const m of sel) box.expandByObject(m, true)
    this.fitBox(box)
  }

  /** すべてのオブジェクトが映るようにカメラを合わせる（無ければ初期視点） */
  frameAll(): void {
    const box = new Box3()
    for (const m of this.meshes) box.expandByObject(m, true)
    if (box.isEmpty()) this.resetView()
    else this.fitBox(box)
  }

  resetView(): void {
    this.orbit.target.set(0, 0.05, 0)
    this.camera.position.set(0.45, 0.42, 0.6)
    this.orbit.update()
  }

  /** 現在の視線方向を保ったまま、箱の外接球が画面に収まる距離へ */
  private fitBox(box: Box3): void {
    const sphere = box.getBoundingSphere(new Sphere())
    const r = Math.max(sphere.radius, 0.05)
    const vFov = (this.camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect)
    const dist = (r / Math.sin(Math.min(vFov, hFov) / 2)) * 1.1
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize()
    this.orbit.target.copy(sphere.center)
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist)
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

  get isDragging(): boolean {
    return !!this.pointer?.dragging
  }

  /** ドラッグを取り消して開始前の状態に戻す（pointercancel・フォーカス喪失・Esc） */
  cancelDrag = (): void => {
    const p = this.pointer
    this.pointer = null
    if (!p?.dragging) return
    this.gizmo.cancelDrag()
    this.orbit.enabled = true
    this.dragInfo = ''
    this.emit()
  }

  private onLostCapture = (e: PointerEvent): void => {
    if (this.pointer && e.pointerId === this.pointer.id) this.cancelDrag()
  }

  private onContextMenu = (e: Event): void => e.preventDefault()

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || this.pointer) return // 2本目の指・ペンなどは無視
    this.setRay(e)
    this.pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: false, clickId: null }
    this.capture(e) // 空白クリックでもキャンバス外で離したときに pointerup を受け取る
    // 1) ハンドル
    const handle = this.gizmo.pick(this.raycaster)
    if (handle) {
      this.gizmo.beginHandleDrag(handle, this.raycaster.ray)
      this.startDrag()
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
    this.startDrag()
  }

  private startDrag(): void {
    this.pointer!.dragging = true
    this.orbit.enabled = false
  }

  private capture(e: PointerEvent): void {
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
    // 押したポインタの解放で終える（ドラッグ中に右ボタンを足した場合なども button では判定しない）
    if (!p || e.pointerId !== p.id || (e.buttons & 1) !== 0) return
    this.pointer = null
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
      flatShading: paletteMaterials()[0].flatShading,
      xray: this.xray,
      selectionPrimitive: (() => {
        const ud = sel.length === 1 ? (sel[0].userData as ObjUserData) : null
        return ud?.kind === 'primitive' ? { primitive: ud.primitive, params: { ...ud.params } } : null
      })(),
      selectionIssues: (() => {
        const merged = sel.map((m) => m.userData as ObjUserData).filter((u) => u.kind === 'mesh')
        if (!merged.length) return null
        const total = { open: 0, nonManifold: 0, flipped: 0 }
        for (const u of merged) {
          const i = issuesOf(u.mesh)
          total.open += i.open
          total.nonManifold += i.nonManifold
          total.flipped += i.flipped
        }
        return total
      })(),
      canUnmerge: sel.some((m) => (m.userData as ObjUserData).kind === 'mesh' && !!(m.userData as { sources?: unknown }).sources),
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

const round6 = (v: number) => Math.round(v * 1e6) / 1e6

/** 結合元（入れ子含む）をすべて指定色に */
function recolor(list: SceneObjectData[], color: number): SceneObjectData[] {
  return list.map((d) =>
    d.kind === 'primitive'
      ? { ...d, color }
      : {
          ...d,
          mesh: { ...d.mesh, groups: [{ start: 0, count: d.mesh.indices.length, color }] },
          ...(d.sources && { sources: recolor(d.sources, color) }),
        },
  )
}

// ---------------------------------------------------------------- 検査・X線表示

/** 結合物の検査結果（MeshData は不変なので参照でキャッシュ） */
const issueCache = new WeakMap<MeshData, MeshIssues>()
function issuesOf(m: MeshData): MeshIssues {
  let r = issueCache.get(m)
  if (!r) issueCache.set(m, (r = checkMesh(m)))
  return r
}

const wireMaterial = new LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false })
const issueMaterial = new LineBasicMaterial({ color: '#ff3b30', depthTest: false, transparent: true })

function addOverlays(mesh: Mesh): void {
  const wire = new LineSegments(new WireframeGeometry(mesh.geometry), wireMaterial)
  wire.name = 'overlay'
  wire.raycast = () => {}
  mesh.add(wire)
  const ud = mesh.userData as ObjUserData
  if (ud.kind !== 'mesh') return
  const segs = issuesOf(ud.mesh).segments
  if (!segs.length) return
  const g = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(segs), 3))
  const issues = new LineSegments(g, issueMaterial)
  issues.name = 'overlay'
  issues.renderOrder = 999
  issues.raycast = () => {}
  mesh.add(issues)
}

function removeOverlays(mesh: Mesh): void {
  for (const c of [...mesh.children]) {
    if (c.name !== 'overlay') continue
    c.removeFromParent()
    ;(c as LineSegments).geometry.dispose()
  }
}

function disposeMesh(m: Mesh): void {
  removeOverlays(m)
  m.removeFromParent()
  m.geometry.dispose()
}
