/** シーン内オブジェクトの永続データ。保存形式・Undo履歴・three.js 再構築のすべてがこれを元にする */

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export interface Transform {
  position: Vec3
  quaternion: Quat
  scale: Vec3
}

/** 結合で生成されたメッシュの頂点データ（ローカル座標）。不変として扱い、履歴間で共有する */
export interface MeshData {
  positions: number[]
  normals: number[]
  indices: number[]
  /** indices の範囲ごとの色 */
  groups: { start: number; count: number; color: number }[]
}

export interface PrimitiveObject extends Transform {
  id: string
  kind: 'primitive'
  primitive: string
  color: number
}

export interface MeshObject extends Transform {
  id: string
  kind: 'mesh'
  mesh: MeshData
}

export type SceneObjectData = PrimitiveObject | MeshObject

export interface SceneDoc {
  format: 'kani3d'
  version: 1
  objects: SceneObjectData[]
}
