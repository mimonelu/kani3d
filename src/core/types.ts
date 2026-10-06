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
  /** 形状オプション（既定値と異なるものだけ。core/primitives.ts の ParamDef 参照） */
  params?: Record<string, number | boolean>
  /** ポリゴン単位の塗り（ポリゴン番号 → 色ID）。color と異なるものだけ。params を変えると無効になる */
  faceColors?: Record<number, number>
}

export interface MeshObject extends Transform {
  id: string
  kind: 'mesh'
  mesh: MeshData
  /**
   * 結合前のオブジェクト（結合解除用）。transform はこのメッシュのローカル座標系での値。
   * 入れ子の結合も sources 内に再帰的に保持される。
   */
  sources?: SceneObjectData[]
  /**
   * 最適化前のオブジェクト（最適化解除用）。object の transform は使わず、
   * このメッシュのローカル座標で -offset の位置・同じ回転・拡縮に戻す
   */
  optimizedFrom?: { object: SceneObjectData; offset: Vec3 }
}

export type SceneObjectData = PrimitiveObject | MeshObject

export interface SceneDoc {
  format: 'kani3d'
  version: 1
  objects: SceneObjectData[]
}
