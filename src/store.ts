/** Vue 側の共有状態。three.js オブジェクトはリアクティブにしない（shallowRef + markRaw） */
import { computed, markRaw, reactive, shallowRef } from 'vue'
import type { Editor, EditorState } from './core/Editor'
import { downloadBlob, FILE_EXT, parseDoc, stringifyDoc } from './core/io'
import { DEFAULT_COLOR } from './core/palette'

export const editorRef = shallowRef<Editor | null>(null)

export const state = reactive<EditorState>({
  objectCount: 0,
  triangles: 0,
  selection: [],
  selectionTriangles: 0,
  selectionColor: null,
  selectionSize: null,
  currentColor: DEFAULT_COLOR,
  dragInfo: '',
  flatShading: true,
  canUnmerge: false,
  canUnoptimize: false,
  xray: false,
  selectionIssues: null,
  selectionPrimitive: null,
  paintMode: false,
  canUndo: false,
  canRedo: false,
})

export const ui = reactive({
  fileName: 'untitled',
  message: '',
  /** シーンビュー左下のフロート表示（showBanner で出す） */
  banner: null as { kind: 'info' | 'warn'; text: string; id: number } | null,
  helpOpen: false,
  openRequest: 0,
})

/** ファイルを開くダイアログを要求（ToolBar が監視してファイル選択を開く） */
export function requestOpen(): void {
  ui.openRequest++
}

const AUTOSAVE_KEY = 'kani3d:autosave'
const FLAT_KEY = 'kani3d:flatShading'

const BACKUP_KEY = 'kani3d:autosave.bak'

export function bindEditor(editor: Editor): void {
  editorRef.value = markRaw(editor)
  // 自動保存はシーン内容が変わったとき（revision 更新時）だけ。選択変更などでは書かない
  let savedRevision = editor.revision
  let timer = 0
  let warned = false
  const flush = () => {
    clearTimeout(timer)
    if (editor.revision === savedRevision) return
    try {
      localStorage.setItem(AUTOSAVE_KEY, stringifyDoc(editor.toDoc()))
      savedRevision = editor.revision
    } catch {
      if (!warned) notify('自動保存できませんでした（容量超過など）。こまめに「保存」してください', 6000)
      warned = true
    }
  }
  editor.onChange = (s) => {
    Object.assign(state, s)
    if (editor.revision === savedRevision) return
    clearTimeout(timer)
    timer = window.setTimeout(flush, 300)
  }
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())

  try {
    editor.setFlatShading(localStorage.getItem(FLAT_KEY) !== '0')
  } catch {
    /* 無視 */
  }
  let saved: string | null = null
  try {
    saved = localStorage.getItem(AUTOSAVE_KEY)
    if (saved) editor.loadDoc(parseDoc(saved))
  } catch (e) {
    // 壊れた（または新しい版の）自動保存は上書きで失わないよう退避する
    try {
      if (saved) localStorage.setItem(BACKUP_KEY, saved)
    } catch {
      /* 無視 */
    }
    notify(`前回の自動保存を読み込めませんでした（${BACKUP_KEY} に退避）: ${(e as Error).message}`, 8000)
  }
  savedRevision = editor.revision
  Object.assign(state, editor.currentState())
}

/** エディタ表示のフラット / スムーズ切替（ブラウザに記憶） */
export function toggleFlatShading(): void {
  const flat = !state.flatShading
  editorRef.value?.setFlatShading(flat)
  try {
    localStorage.setItem(FLAT_KEY, flat ? '1' : '0')
  } catch {
    /* 無視 */
  }
}

let bannerTimer = 0
let bannerSeq = 0
/** シーンビュー左下のフロート表示。info は時間経過で消え、warn は × で閉じるまで残る */
export function showBanner(kind: 'info' | 'warn', text: string): void {
  clearTimeout(bannerTimer)
  // reactive のプロキシと元オブジェクトは === で一致しないので通し番号で判定する
  const id = ++bannerSeq
  ui.banner = { kind, text, id }
  if (kind === 'info')
    bannerTimer = window.setTimeout(() => {
      if (ui.banner?.id === id) ui.banner = null
    }, 5000)
}

export function notify(message: string, ms = 2500): void {
  ui.message = message
  setTimeout(() => {
    if (ui.message === message) ui.message = ''
  }, ms)
}

export function newScene(): void {
  editorRef.value?.newScene()
  ui.banner = null
  ui.fileName = 'untitled'
}

/** ダウンロード用ファイル名（パス区切りや使用できない文字を除去） */
const safeName = () => ui.fileName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'untitled'

export function saveScene(): void {
  const ed = editorRef.value
  if (!ed) return
  downloadBlob(stringifyDoc(ed.toDoc()), safeName() + FILE_EXT, 'application/json')
}

export async function openSceneFile(file: File): Promise<void> {
  try {
    editorRef.value?.loadDoc(parseDoc(await file.text()))
    ui.fileName = file.name.replace(/\.(kani|json)$/i, '')
    ui.banner = null
    notify(`${file.name} を読み込みました`)
  } catch (e) {
    notify(`読み込み失敗: ${(e as Error).message}`)
  }
}

export async function exportGlbFile(): Promise<void> {
  const ed = editorRef.value
  if (!ed) return
  if (state.objectCount === 0) return notify('オブジェクトがありません')
  try {
    downloadBlob(await ed.exportGlb(), safeName() + '.glb', 'model/gltf-binary')
  } catch (e) {
    notify(`GLB 出力失敗: ${(e as Error).message}`)
  }
}

/** 結合ボタンの動作: 複数選択なら結合、結合物 1 つなら結合解除 */
export const mergeMode = computed<'merge' | 'unmerge' | null>(() =>
  state.selection.length >= 2 ? 'merge' : state.canUnmerge ? 'unmerge' : null,
)

export function toggleMerge(): void {
  if (mergeMode.value === 'merge') mergeSelection()
  else if (mergeMode.value === 'unmerge') editorRef.value?.unmergeSelected()
}

/** 最適化ボタンの動作: 最適化済みを選んでいれば最適化解除、それ以外は最適化 */
export const optimizeMode = computed<'optimize' | 'unoptimize' | null>(() =>
  state.canUnoptimize ? 'unoptimize' : state.selection.length ? 'optimize' : null,
)

export function toggleOptimize(): void {
  if (optimizeMode.value === 'unoptimize') {
    editorRef.value?.unoptimizeSelected()
    ui.banner = null
  } else if (optimizeMode.value === 'optimize') optimizeSelection()
}

/** 選択物の面数を最適化（同色・同一平面の面をまとめる） */
export function optimizeSelection(): void {
  try {
    const r = editorRef.value?.optimizeSelected()
    if (!r) return
    showBanner(
      'info',
      r.optimized
        ? `面数を最適化しました（${r.before} → ${r.after} 三角形）。「最適化解除」で元の形に戻せます`
        : 'これ以上は削減できません',
    )
  } catch (e) {
    notify(`最適化失敗: ${(e as Error).message}`)
  }
}

export function mergeSelection(): void {
  try {
    const r = editorRef.value?.mergeSelected()
    if (!r) return notify('2つ以上選択してください')
    const { open, nonManifold, flipped } = r.issues
    if (open + nonManifold + flipped)
      showBanner(
        'warn',
        `結合結果に問題があります（穴 ${open} / 内部面 ${nonManifold} / 裏返り ${flipped}）。X線表示で確認できます。辺だけで接する配置では内部面が出ることがあります`,
      )
    else ui.banner = null
  } catch (e) {
    notify(`結合失敗: ${(e as Error).message}`)
  }
}
