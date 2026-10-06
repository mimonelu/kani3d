<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import SidePanel from './components/SidePanel.vue'
import ToolBar from './components/ToolBar.vue'
import ViewportPane from './components/ViewportPane.vue'
import HelpDialog from './components/HelpDialog.vue'
import { editorRef, mergeSelection, saveScene, ui } from './store'

function onKey(e: KeyboardEvent) {
  const ed = editorRef.value
  const t = e.target as HTMLElement
  if (!ed || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
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
      if (k === 'g') return mergeSelection(), true
      if (k === 'a') return ed.selectAll(), true
      if (k === 's') return saveScene(), true
      return false
    }
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
    }
    switch (k) {
      case 'x':
      case 'y':
      case 'z': return ed.rotateSelected(k, e.shiftKey ? -1 : 1), true
      case 'f': return ed.focusSelection(), true
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
