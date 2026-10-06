/** 保存形式 (.kani = JSON) の読み書きと GLB 出力 */
import { Group, Mesh, type Object3D } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { clampColor, exportMaterials } from './palette'
import { getPrimitive } from './primitives'
import type { MeshData, SceneDoc, SceneObjectData } from './types'

export const FILE_EXT = '.kani'

export function createDoc(objects: SceneObjectData[]): SceneDoc {
  return { format: 'kani3d', version: 1, objects }
}

const isNums = (v: unknown, len?: number): v is number[] =>
  Array.isArray(v) && (len === undefined || v.length === len) && v.every((x) => typeof x === 'number' && Number.isFinite(x))

const MAX_SOURCE_DEPTH = 64

function parseMesh(m: unknown): MeshData {
  const o = m as MeshData
  if (!o || !isNums(o.positions) || !isNums(o.normals) || !isNums(o.indices) || !Array.isArray(o.groups))
    throw new Error('invalid mesh data')
  const vcount = o.positions.length / 3
  if (o.positions.length % 3 || o.indices.length % 3 || o.normals.length !== o.positions.length)
    throw new Error('invalid mesh size')
  if (o.indices.some((i) => i < 0 || i >= vcount || !Number.isInteger(i))) throw new Error('invalid mesh indices')
  const n = o.indices.length
  const groups = o.groups.map((g) => {
    const start = Number(g?.start), count = Number(g?.count)
    if (!Number.isInteger(start) || !Number.isInteger(count) || start < 0 || count < 0 || start + count > n || start % 3 || count % 3)
      throw new Error('invalid mesh groups')
    return { start, count, color: clampColor(g.color) }
  })
  // groups が空だと（マテリアル配列のため）何も描画されないので全体を既定色に
  return { positions: o.positions, normals: o.normals, indices: o.indices, groups: groups.length ? groups : [{ start: 0, count: n, color: clampColor(-1) }] }
}

/** JSON 文字列を検証して SceneDoc にする。不正なら例外 */
export function parseDoc(text: string): SceneDoc {
  const raw = JSON.parse(text) as Partial<SceneDoc>
  if (raw.format !== 'kani3d' || raw.version !== 1 || !Array.isArray(raw.objects)) throw new Error('kani3d 形式ではありません')
  return { format: 'kani3d', version: 1, objects: parseObjects(raw.objects, new Set(), 0) }
}

/** ids: シーン直下の ID 重複検出用（sources 内は結合解除時に振り直すので対象外） */
function parseObjects(list: SceneObjectData[], ids: Set<string> | null, depth: number): SceneObjectData[] {
  if (depth > MAX_SOURCE_DEPTH) throw new Error('結合の入れ子が深すぎます')
  return list.map((o, i): SceneObjectData => {
    if (!o || typeof o !== 'object') throw new Error(`object ${i}: invalid`)
    if (!isNums(o.position, 3) || !isNums(o.quaternion, 4) || !isNums(o.scale, 3)) throw new Error(`object ${i}: invalid transform`)
    if (o.scale.some((v) => v === 0)) throw new Error(`object ${i}: scale is zero`)
    const qlen = Math.hypot(...o.quaternion)
    if (qlen < 1e-6) throw new Error(`object ${i}: invalid rotation`)
    let id = typeof o.id === 'string' && o.id ? o.id : ''
    if (ids) {
      // 欠落・重複 ID は振り直す（同じ ID が複数あると選択や履歴が壊れる）
      for (let k = 0; !id || ids.has(id); k++) id = `${o.id || 'o'}~${i}_${k}`
      ids.add(id)
    }
    const base = {
      id: id || `o${i}`,
      position: o.position,
      quaternion: o.quaternion.map((v) => v / qlen) as SceneObjectData['quaternion'],
      scale: o.scale,
    }
    if (o.kind === 'primitive') {
      if (!getPrimitive(o.primitive)) throw new Error(`object ${i}: unknown primitive ${o.primitive}`)
      return { ...base, kind: 'primitive', primitive: o.primitive, color: clampColor(o.color) }
    }
    if (o.kind === 'mesh') {
      const sources = Array.isArray(o.sources) ? parseObjects(o.sources, null, depth + 1) : undefined
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
    const m = new Mesh(src.geometry, exportMaterials())
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
