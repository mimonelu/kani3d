/**
 * ローカルフォント（Local Font Access API / Chromium 系のみ）の一覧と読み込み。
 * テキストプリミティブの形状生成は同期なので、未読み込みのフォントは getFont が読み込みを始めて undefined を返し、
 * 読み込み完了時に onFontsChanged の購読者（Editor・UI）へ通知する。
 */
import { parse, type Font } from 'opentype.js'

export interface LocalFontInfo {
  postscriptName: string
  fullName: string
}
interface FontData extends LocalFontInfo {
  blob(): Promise<Blob>
}

export type FontStatus = 'idle' | 'unsupported' | 'denied' | 'ready'

/** 自動（font = ''）のときに優先するフォント（太めの日本語ゴシック → 英字） */
const PREFERRED = [
  'HiraginoSans-W6',
  'HiraKakuProN-W6',
  'HiraKakuPro-W6',
  'NotoSansJP-Bold',
  'NotoSansCJKjp-Bold',
  'YuGothic-Bold',
  'Meiryo-Bold',
  'Arial-BoldMT',
  'ArialMT',
]

let status: FontStatus = 'idle'
let available: FontData[] = []
const loaded = new Map<string, Font>()
const loading = new Map<string, Promise<void>>()
const failed = new Set<string>()
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((f) => f())

/** フォント一覧の取得・フォントの読み込み完了を購読。戻り値で解除 */
export function onFontsChanged(f: () => void): () => void {
  listeners.add(f)
  return () => listeners.delete(f)
}

export const fontStatus = (): FontStatus => status
export const localFonts = (): LocalFontInfo[] => available.map(({ postscriptName, fullName }) => ({ postscriptName, fullName }))
export const isFontLoaded = (name: string): boolean => loaded.has(resolveFontName(name))
export const isFontFailed = (name: string): boolean => failed.has(resolveFontName(name))

const supported = () => typeof window !== 'undefined' && 'queryLocalFonts' in window

/** 既に許可されていれば黙って一覧を取得する（起動時用。許可を求めるダイアログは出さない） */
export async function initLocalFonts(): Promise<void> {
  if (!supported()) {
    status = 'unsupported'
    return notify()
  }
  try {
    const p = await navigator.permissions.query({ name: 'local-fonts' as PermissionName })
    if (p.state === 'granted') await requestLocalFonts()
    else if (p.state === 'denied') {
      status = 'denied'
      notify()
    }
  } catch {
    /* permissions API 非対応 → ボタンから要求 */
  }
}

/** フォント一覧を取得（初回は許可ダイアログ。ユーザー操作の中で呼ぶこと） */
export async function requestLocalFonts(): Promise<void> {
  if (!supported()) {
    status = 'unsupported'
    return notify()
  }
  try {
    const list = (await (window as unknown as { queryLocalFonts(): Promise<FontData[]> }).queryLocalFonts()) ?? []
    available = [...list].sort((a, b) => a.fullName.localeCompare(b.fullName))
    status = 'ready'
  } catch {
    status = 'denied'
  }
  notify()
}

/** '' は自動（優先リスト → 一覧の先頭 → 読み込み済みの先頭）。一覧に無い名前はそのまま */
export function resolveFontName(name: string): string {
  if (name) return name
  for (const n of PREFERRED) if (loaded.has(n) || available.some((f) => f.postscriptName === n)) return n
  return available[0]?.postscriptName ?? loaded.keys().next().value ?? ''
}

/** 読み込み済みならそのフォント。未読み込みで一覧にあれば読み込みを開始して undefined */
export function getFont(name: string): Font | undefined {
  const n = resolveFontName(name)
  const f = loaded.get(n)
  if (f || !n || loading.has(n) || failed.has(n)) return f
  const data = available.find((d) => d.postscriptName === n)
  if (!data) return undefined
  loading.set(
    n,
    data
      .blob()
      .then((b) => b.arrayBuffer())
      .then((buf) => void loaded.set(n, parse(extractFromCollection(buf, n))))
      .catch((e) => {
        failed.add(n)
        console.warn(`font load failed: ${n}`, e)
      })
      .finally(() => {
        loading.delete(n)
        notify()
      }),
  )
  return undefined
}

/** 読み込みを待つ（形状を変える前に呼ぶと代用の板を挟まずに済む）。読めたら true */
export async function ensureFont(name: string): Promise<boolean> {
  if (getFont(name)) return true
  await loading.get(resolveFontName(name))
  return isFontLoaded(name)
}

/** テスト・組み込み用にフォントを登録 */
export function registerFont(name: string, font: Font): void {
  loaded.set(name, font)
  notify()
}

// ---------------------------------------------------------------- TrueType Collection

/**
 * .ttc（複数フォントの束）から postscriptName が一致するフォントを単体の sfnt として取り出す。
 * opentype.js は TTC を読めないため、該当フォントのテーブルディレクトリを先頭に置き、元ファイルを後ろに連結する
 * （TTC のテーブルオフセットはファイル先頭からの絶対値なので、ディレクトリ長だけずらせばよい）。TTC でなければそのまま
 */
export function extractFromCollection(buf: ArrayBuffer, postscriptName: string): ArrayBuffer {
  const v = new DataView(buf)
  if (v.getUint32(0) !== 0x74746366 /* 'ttcf' */) return buf
  const numFonts = v.getUint32(8)
  const offsets = Array.from({ length: numFonts }, (_, i) => v.getUint32(12 + i * 4))
  const dir = offsets.find((o) => sfntPostscriptName(v, o) === postscriptName) ?? offsets[0]
  const numTables = v.getUint16(dir + 4)
  const dirLen = 12 + numTables * 16
  const out = new Uint8Array(dirLen + buf.byteLength)
  out.set(new Uint8Array(buf, dir, dirLen), 0)
  out.set(new Uint8Array(buf), dirLen)
  const ov = new DataView(out.buffer)
  for (let i = 0; i < numTables; i++) ov.setUint32(12 + i * 16 + 8, ov.getUint32(12 + i * 16 + 8) + dirLen)
  return out.buffer
}

/** sfnt の name テーブルから PostScript 名（nameID 6）を読む */
function sfntPostscriptName(v: DataView, dir: number): string | undefined {
  const numTables = v.getUint16(dir + 4)
  for (let i = 0; i < numTables; i++) {
    const rec = dir + 12 + i * 16
    if (v.getUint32(rec) !== 0x6e616d65 /* 'name' */) continue
    const t = v.getUint32(rec + 8)
    const count = v.getUint16(t + 2)
    const strings = t + v.getUint16(t + 4)
    for (let k = 0; k < count; k++) {
      const r = t + 6 + k * 12
      if (v.getUint16(r + 6) !== 6) continue
      const platform = v.getUint16(r)
      const len = v.getUint16(r + 8)
      const off = strings + v.getUint16(r + 10)
      let s = ''
      if (platform === 3 || platform === 0) for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(v.getUint16(off + j))
      else for (let j = 0; j < len; j++) s += String.fromCharCode(v.getUint8(off + j))
      return s
    }
  }
  return undefined
}
