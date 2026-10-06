<script setup lang="ts">
import { ref } from 'vue'
import type { TransformMode } from '../core/Editor'
import { FILE_EXT } from '../core/io'
import { editorRef, exportGlbFile, mergeSelection, newScene, openSceneFile, saveScene, state, ui } from '../store'

const fileInput = ref<HTMLInputElement>()
const modes: { id: TransformMode; label: string; key: string }[] = [
  { id: 'translate', label: '移動', key: 'W' },
  { id: 'rotate', label: '回転', key: 'E' },
  { id: 'scale', label: '拡縮', key: 'R' },
]

function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) openSceneFile(f)
  input.value = ''
}
function confirmNew() {
  if (state.objectCount === 0 || confirm('現在のシーンを破棄して新規作成しますか？')) newScene()
}
</script>

<template>
  <header class="toolbar">
    <strong class="logo">🦀 kani3d</strong>
    <input class="name" v-model="ui.fileName" title="ファイル名" />
    <div class="group">
      <button @click="confirmNew">新規</button>
      <button @click="fileInput?.click()" title="Ctrl+O">開く</button>
      <button @click="saveScene" title="Ctrl+S">保存</button>
      <button class="primary" @click="exportGlbFile">GLB出力</button>
      <input ref="fileInput" type="file" :accept="`${FILE_EXT},.json`" hidden @change="onFile" />
    </div>
    <div class="group">
      <button :disabled="!state.canUndo" @click="editorRef?.undo()" title="Ctrl+Z">元に戻す</button>
      <button :disabled="!state.canRedo" @click="editorRef?.redo()" title="Ctrl+Shift+Z">やり直し</button>
    </div>
    <div class="group">
      <button
        v-for="m in modes"
        :key="m.id"
        :class="{ active: state.mode === m.id }"
        :disabled="m.id === 'scale' && state.selection.length > 1"
        :title="m.key"
        @click="editorRef?.setMode(m.id)"
      >
        {{ m.label }}
      </button>
    </div>
    <div class="group">
      <button :disabled="!state.selection.length" @click="editorRef?.duplicateSelected()" title="Ctrl+D">複製</button>
      <button :disabled="!state.selection.length" @click="editorRef?.deleteSelected()" title="Delete">削除</button>
      <button :disabled="state.selection.length < 2" @click="mergeSelection" title="Ctrl+G">結合</button>
    </div>
    <span class="message">{{ ui.message }}</span>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: #2b3440;
  color: #eef;
  flex-wrap: wrap;
}
.logo {
  font-size: 15px;
}
.name {
  width: 120px;
  background: #1d242c;
  color: #eef;
  border: 1px solid #455;
  border-radius: 4px;
  padding: 3px 6px;
}
.group {
  display: flex;
  gap: 2px;
  padding-left: 12px;
  border-left: 1px solid #455;
}
button {
  background: #3b4654;
  color: #eef;
  border: none;
  border-radius: 4px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 13px;
}
button:hover:not(:disabled) {
  background: #4d5a6b;
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button.active {
  background: #ff8a00;
  color: #222;
}
button.primary {
  background: #2f7de1;
}
.message {
  margin-left: auto;
  font-size: 12px;
  color: #ffd27f;
}
</style>
