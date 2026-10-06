import { MeshStandardMaterial } from 'three'

export interface PaletteColor {
  name: string
  hex: string
}

/** あらかじめ決められたカラーパレット。インデックスがそのまま色IDになる（保存形式でも使用） */
export const PALETTE: readonly PaletteColor[] = [
  { name: '赤', hex: '#e53935' },
  { name: '橙', hex: '#fb8c00' },
  { name: '黄', hex: '#fdd835' },
  { name: '黄緑', hex: '#7cb342' },
  { name: '緑', hex: '#2e7d32' },
  { name: '水色', hex: '#29b6f6' },
  { name: '青', hex: '#1e5bd8' },
  { name: '紫', hex: '#8e24aa' },
  { name: '桃', hex: '#f06292' },
  { name: '茶', hex: '#795548' },
  { name: '肌', hex: '#f5c9a0' },
  { name: '白', hex: '#f5f5f5' },
  { name: '灰', hex: '#9e9e9e' },
  { name: '濃灰', hex: '#555555' },
  { name: '黒', hex: '#212121' },
  { name: '金', hex: '#c9a227' },
]

export const DEFAULT_COLOR = 6

let materials: MeshStandardMaterial[] | null = null

/** パレット全色のマテリアル配列（全メッシュで共有。geometry.groups[].materialIndex = 色ID） */
export function paletteMaterials(): MeshStandardMaterial[] {
  materials ??= PALETTE.map(
    (c) => new MeshStandardMaterial({ name: c.name, color: c.hex, roughness: 0.7, metalness: 0 }),
  )
  return materials
}

export const clampColor = (i: number): number =>
  Number.isInteger(i) && i >= 0 && i < PALETTE.length ? i : DEFAULT_COLOR
