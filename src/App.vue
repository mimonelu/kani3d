<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import SidePanel from './components/SidePanel.vue'
import ToolBar from './components/ToolBar.vue'
import ViewportPane from './components/ViewportPane.vue'
import HelpDialog from './components/HelpDialog.vue'
import { editorRef, requestOpen, saveScene, state, toggleMerge, ui } from './store'

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
      if (k === 's') return saveScene(), true
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
    }
    return false
  })()
  if (handled) e.preventDefault()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="app">
    <ToolBar />
    <main>
      <ViewportPane />
      <SidePanel />
    </main>
    <HelpDialog />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
main {
  display: flex;
  flex: 1;
  min-height: 0;
}
</style>
