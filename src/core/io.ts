/** 保存形式 (.kani = JSON) の読み書きと GLB 出力 */
import { Group, Mesh, type Object3D } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { clampColor } from './palette'
import { getPrimitive } from './primitives'
import type { MeshData, SceneDoc, SceneObjectData } from './types'

export const FILE_EXT = '.kani'

export function createDoc(objects: SceneObjectData[]): SceneDoc {
  return { format: 'kani3d', version: 1, objects }
}

const isNums = (v: unknown, len?: number): v is number[] =>
  Array.isArray(v) && (len === undefined || v.length === len) && v.every((x) => typeof x === 'number' && Number.isFinite(x))

function parseMesh(m: unknown): MeshData {
  const o = m as MeshData
  if (!o || !isNums(o.positions) || !isNums(o.normals) || !isNums(o.indices) || !Array.isArray(o.groups))
    throw new Error('invalid mesh data')
  const vcount = o.positions.length / 3
  if (o.normals.length !== o.positions.length || o.indices.some((i) => i < 0 || i >= vcount || !Number.isInteger(i)))
    throw new Error('invalid mesh indices')
  return {
    positions: o.positions,
    normals: o.normals,
    indices: o.indices,
    groups: o.groups.map((g) => ({ start: g.start | 0, count: g.count | 0, color: clampColor(g.color) })),
  }
}

/** JSON 文字列を検証して SceneDoc にする。不正なら例外 */
export function parseDoc(text: string): SceneDoc {
  const raw = JSON.parse(text) as Partial<SceneDoc>
  if (raw.format !== 'kani3d' || raw.version !== 1 || !Array.isArray(raw.objects)) throw new Error('kani3d 形式ではありません')
  return { format: 'kani3d', version: 1, objects: parseObjects(raw.objects) }
}

function parseObjects(list: SceneObjectData[]): SceneObjectData[] {
  return list.map((o, i): SceneObjectData => {
    if (!isNums(o.position, 3) || !isNums(o.quaternion, 4) || !isNums(o.scale, 3)) throw new Error(`object ${i}: invalid transform`)
    const base = {
      id: typeof o.id === 'string' && o.id ? o.id : `o${i}`,
      position: o.position,
      quaternion: o.quaternion,
      scale: o.scale,
    }
    if (o.kind === 'primitive') {
      if (!getPrimitive(o.primitive)) throw new Error(`object ${i}: unknown primitive ${o.primitive}`)
      return { ...base, kind: 'primitive', primitive: o.primitive, color: clampColor(o.color) }
    }
    if (o.kind === 'mesh') {
      const sources = Array.isArray(o.sources) ? parseObjects(o.sources) : undefined
      return { ...base, kind: 'mesh', mesh: parseMesh(o.mesh), ...(sources && { sources }) }
    }
    throw new Error(`object ${i}: unknown kind`)
  })
}

export const stringifyDoc = (doc: SceneDoc): string => JSON.stringify(doc)

/** シーン内メッシュ群を GLB (バイナリ glTF) に変換 */
export async function exportGlb(meshes: Object3D[]): Promise<ArrayBuffer> {
  const root = new Group()
  root.name = 'kani3d'
  for (const src of meshes) {
    if (!(src instanceof Mesh)) continue
    const m = new Mesh(src.geometry, src.material)
    m.name = src.name
    src.matrixWorld.decompose(m.position, m.quaternion, m.scale)
    root.add(m)
  }
  const result = await new GLTFExporter().parseAsync(root, { binary: true })
  return result as ArrayBuffer
}

export function downloadBlob(data: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
