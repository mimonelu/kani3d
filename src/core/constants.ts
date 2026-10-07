/** 1 unit = 1 m。表示グリッドは 10cm 間隔 */
export const GRID = 0.1
/** 移動・拡縮のスナップ単位 5cm（表示グリッドとは独立） */
export const SNAP = 0.05
/** 回転スナップ 45° */
export const ROT_STEP = Math.PI / 4
/** 地面グリッドの一辺 (m) */
export const GRID_EXTENT = 10
/** プリミティブの基本サイズ (m) */
export const BASE_SIZE = 1
/** 保存形式 v1 の基本サイズ（読み込み時に拡大率を換算して実寸を保つ） */
export const BASE_SIZE_V1 = 0.1

/** step 単位に丸める（浮動小数の誤差を 1e-9 で切り捨て） */
export const snapValue = (v: number, step = SNAP): number => Math.round(Math.round(v / step) * step * 1e9) / 1e9
