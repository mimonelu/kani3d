/** Vue 側の共有状態。three.js オブジェクトはリアクティブにしない（shallowRef + markRaw） */
import { markRaw, reactive, shallowRef } from 'vue'
import type { Editor, EditorState } from './core/Editor'
import { createDoc, downloadBlob, FILE_EXT, parseDoc, stringifyDoc } from './core/io'
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
  xray: false,
  selectionIssues: null,
  canUndo: false,
  canRedo: false,
})

export const ui = reactive({ fileName: 'untitled', message: '', helpOpen: false })

const AUTOSAVE_KEY = 'kani3d:autosave'
const FLAT_KEY = 'kani3d:flatShading'

export function bindEditor(editor: Editor): void {
  editorRef.value = markRaw(editor)
  let timer = 0
  editor.onChange = (s) => {
    Object.assign(state, s)
    clearTimeout(timer)
    timer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, stringifyDoc(editor.toDoc()))
      } catch {
        /* 容量超過などは無視 */
      }
    }, 300)
  }
  try {
    editor.setFlatShading(localStorage.getItem(FLAT_KEY) !== '0')
    const saved = localStorage.getItem(AUTOSAVE_KEY)
    if (saved) editor.loadDoc(parseDoc(saved))
  } catch {
    /* 壊れた自動保存は無視 */
  }
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

export function notify(message: string, ms = 2500): void {
  ui.message = message
  setTimeout(() => {
    if (ui.message === message) ui.message = ''
  }, ms)
}

export function newScene(): void {
  editorRef.value?.loadDoc(createDoc([]))
  ui.fileName = 'untitled'
}

export function saveScene(): void {
  const ed = editorRef.value
  if (!ed) return
  downloadBlob(stringifyDoc(ed.toDoc()), ui.fileName + FILE_EXT, 'application/json')
}

export async function openSceneFile(file: File): Promise<void> {
  try {
    editorRef.value?.loadDoc(parseDoc(await file.text()))
    ui.fileName = file.name.replace(/\.(kani|json)$/i, '')
    notify(`${file.name} を読み込みました`)
  } catch (e) {
    notify(`読み込み失敗: ${(e as Error).message}`)
  }
}

export async function exportGlbFile(): Promise<void> {
  const ed = editorRef.value
  if (!ed) return
  if (state.objectCount === 0) return notify('オブジェクトがありません')
  downloadBlob(await ed.exportGlb(), ui.fileName + '.glb', 'model/gltf-binary')
}

export function mergeSelection(): void {
  try {
    const r = editorRef.value?.mergeSelected()
    if (!r) return notify('2つ以上選択してください')
    const { open, nonManifold, flipped } = r.issues
    if (open + nonManifold + flipped)
      notify(`結合結果に問題があります（穴 ${open} / 内部面 ${nonManifold} / 裏返り ${flipped}）。X線表示で確認できます`, 6000)
  } catch (e) {
    notify(`結合失敗: ${(e as Error).message}`)
  }
}
