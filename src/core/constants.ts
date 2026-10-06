/** 1 unit = 1 m。グリッドは 10cm 間隔 */
export const GRID = 0.1
/** 回転スナップ 45° */
export const ROT_STEP = Math.PI / 4
/** 地面グリッドの一辺 (m) */
export const GRID_EXTENT = 4
/** プリミティブの基本サイズ (m) */
export const BASE_SIZE = 0.2

export const snapValue = (v: number, step = GRID): number => Math.round(v / step) * step
