<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { FILE_EXT } from './core/io'
import SidePanel from './components/SidePanel.vue'
import ToolBar from './components/ToolBar.vue'
import ViewportPane from './components/ViewportPane.vue'
import HelpDialog from './components/HelpDialog.vue'
import RenderDialog from './components/RenderDialog.vue'
import { editorRef, notify, openSceneFile, requestOpen, saveScene, state, toggleMerge, ui } from './store'

const isTextEntry = (t: HTMLElement) =>
  t.tagName === 'TEXTAREA' ||
  t.isContentEditable ||
  (t instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'file'].includes(t.type))

function onKey(e: KeyboardEvent) {
  const ed = editorRef.value
  const t = e.target as HTMLElement
  if (!ed || e.isComposing || isTextEntry(t)) return
  // スライダー・チェックボックス・セレクト上では矢印キーなどは各コントロールに任せる
  const passThrough = e.ctrlKey || e.metaKey || ['Escape', 'Delete', 'Backspace'].includes(e.key)
  if (['INPUT', 'SELECT'].includes(t.tagName) && !passThrough) return
  // ドラッグ中は Esc（取り消し）以外を受け付けない（操作中のオブジェクトを作り直すと状態が壊れるため）
  if (ed.isDragging) {
    if (e.key === 'Escape') ed.cancelDrag()
    e.preventDefault()
    return
  }
  if (ui.helpOpen) {
    if (e.key === 'Escape' || e.key === '?') ui.helpOpen = false
    return
  }
  if (ui.renderOpen) {
    if (e.key === 'Escape') ui.renderOpen = false
    return
  }
  if (e.key === '?') return (ui.helpOpen = true), e.preventDefault()
  const mod = e.ctrlKey || e.metaKey
  const k = e.key.toLowerCase()
  const handled = (() => {
    if (mod) {
      if (k === 'z') return e.shiftKey ? ed.redo() : ed.undo(), true
      if (k === 'y') return ed.redo(), true
      if (k === 'd') return ed.duplicateSelected(), true
      if (k === 'g') return e.shiftKey ? ed.unmergeSelected() : toggleMerge(), true
      if (k === 'a') return ed.selectAll(), true
      if (k === 's') return saveScene(e.shiftKey), true
      if (k === 'o') return requestOpen(), true
      return false
    }
    if (e.key === 'Escape' && state.paintMode) return ed.setPaintMode(false), true
    switch (e.key) {
      case 'Delete':
      case 'Backspace': return ed.deleteSelected(), true
      case 'Escape': return ed.setSelection([]), true
      case 'ArrowLeft': return ed.nudge(-1, 0, 0), true
      case 'ArrowRight': return ed.nudge(1, 0, 0), true
      case 'ArrowUp': return ed.nudge(0, 0, -1), true
      case 'ArrowDown': return ed.nudge(0, 0, 1), true
      case 'PageUp': return ed.nudge(0, 1, 0), true
      case 'PageDown': return ed.nudge(0, -1, 0), true
      case 'Home': return ed.frameAll(), true
    }
    switch (k) {
      case 'x':
      case 'y':
      case 'z': return ed.rotateSelected(k, e.shiftKey ? -1 : 1), true
      case 'f': return e.shiftKey ? ed.frameAll() : ed.focusSelection(), true
      case 'p': return ed.setPaintMode(!state.paintMode), true
      case 'e': return state.paintMode ? (ed.setErasing(true), true) : false
    }
    return false
  })()
  if (handled) e.preventDefault()
}

// E を離したら消去を終える（フォーカスが外れた場合も）
const endErase = (e?: KeyboardEvent) => {
  if (!e || e.key.toLowerCase() === 'e') editorRef.value?.setErasing(false)
}
const onBlur = () => endErase()

/** 画面全体を .kani のドロップ先にする（対応ブラウザではハンドルも取り、以後の保存を上書きにする） */
const dragging = ref(false)
let dragDepth = 0
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
function onDragEnter(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth++
  dragging.value = true
}
function onDragOver(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
}
function onDragLeave(e: DragEvent) {
  if (!hasFiles(e)) return
  if (--dragDepth <= 0) (dragDepth = 0), (dragging.value = false)
}
async function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  dragging.value = false
  const i = [...e.dataTransfer!.files].findIndex((f) => /\.(kani|json)$/i.test(f.name))
  if (i < 0) return notify(`${FILE_EXT} ファイルではありません`)
  const file = e.dataTransfer!.files[i]
  // DataTransfer はイベント中しか使えないので、ハンドル取得はここで同期的に開始しておく
  const item = [...e.dataTransfer!.items].filter((it) => it.kind === 'file')[i]
  const handlePromise = item?.getAsFileSystemHandle?.().catch(() => null)
  if (state.objectCount !== 0 && !confirm('現在のシーンを破棄してファイルを開きますか？')) return
  const handle = await handlePromise
  await openSceneFile(file, handle?.kind === 'file' ? (handle as FileSystemFileHandle) : null)
}

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', endErase)
  window.addEventListener('blur', onBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', endErase)
  window.removeEventListener('blur', onBlur)
})
</script>

<template>
  <div class="app">
    <ToolBar />
    <main>
      <ViewportPane />
      <SidePanel />
    </main>
    <HelpDialog />
    <RenderDialog />
    <div v-if="dragging" class="drop-overlay">{{ FILE_EXT }} ファイルをドロップして開く</div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  font-size: 20px;
  color: var(--text);
  background: rgb(0 0 0 / 0.5);
  outline: 3px dashed var(--accent);
  outline-offset: -12px;
  pointer-events: none;
}
main {
  display: flex;
  flex: 1;
  min-height: 0;
}
</style>
