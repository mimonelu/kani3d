import { DirectionalLight, HemisphereLight, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { PRIMITIVES, buildPrimitiveGeometry } from './primitives'

/** プリミティブ一覧用のサムネイル (dataURL) を一時レンダラーで生成 */
export function renderPrimitiveThumbnails(color: string, size = 96): Record<string, string> {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setSize(size, size)
  const scene = new Scene()
  scene.add(new HemisphereLight('#ffffff', '#667788', 2))
  const light = new DirectionalLight('#ffffff', 1.5)
  light.position.set(2, 3, 2)
  scene.add(light)
  const camera = new PerspectiveCamera(30, 1, 0.01, 10)
  const material = new MeshStandardMaterial({ color, roughness: 0.6, flatShading: true })
  const out: Record<string, string> = {}
  for (const p of PRIMITIVES) {
    const mesh = new Mesh(buildPrimitiveGeometry(p.id), material)
    scene.add(mesh)
    const sz = mesh.geometry.boundingBox!.getSize(new Vector3())
    const r = Math.max(sz.x, sz.y, sz.z) * 1.6
    camera.position.set(r * 0.9, r * 0.7, r * 1.2)
    camera.lookAt(0, 0, 0)
    renderer.render(scene, camera)
    out[p.id] = renderer.domElement.toDataURL()
    scene.remove(mesh)
    mesh.geometry.dispose()
  }
  material.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
  return out
}
