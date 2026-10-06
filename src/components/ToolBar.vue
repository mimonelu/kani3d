<script setup lang="ts">
import { ref } from 'vue'
import { FILE_EXT } from '../core/io'
import { editorRef, exportGlbFile, mergeSelection, newScene, openSceneFile, saveScene, state, toggleFlatShading, ui } from '../store'

const fileInput = ref<HTMLInputElement>()

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
      <button :disabled="!state.selection.length" @click="editorRef?.duplicateSelected()" title="Ctrl+D">複製</button>
      <button :disabled="!state.selection.length" @click="editorRef?.deleteSelected()" title="Delete">削除</button>
      <button :disabled="state.selection.length < 2" @click="mergeSelection" title="Ctrl+G">結合</button>
      <button :disabled="!state.canUnmerge" @click="editorRef?.unmergeSelected()" title="Ctrl+Shift+G">結合解除</button>
    </div>
    <div class="group">
      <button title="すべてのオブジェクトが映るようにカメラを合わせる (Home)" @click="editorRef?.frameAll()">全体表示</button>
      <button
        :class="{ active: state.flatShading }"
        :aria-pressed="state.flatShading"
        title="エディタ上の表示のみ切り替え（GLB には影響しません）"
        @click="toggleFlatShading"
      >
        フラット表示
      </button>
      <button
        :class="{ active: state.xray }"
        :aria-pressed="state.xray"
        title="半透明＋ワイヤーフレームで隠れた面を表示し、結合物の問題のある辺を赤で強調（見た目のみ）"
        @click="editorRef?.setXray(!state.xray)"
      >
        X線表示
      </button>
    </div>
    <span class="message">{{ ui.message }}</span>
    <button class="help" title="ヘルプ (?)" @click="ui.helpOpen = true">?</button>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.logo {
  font-size: 15px;
}
.name {
  width: 120px;
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 6px;
}
.group {
  display: flex;
  gap: 2px;
  padding-left: 12px;
  border-left: 1px solid var(--border);
}
button {
  background: var(--button);
  border: none;
  border-radius: 4px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 13px;
}
button:hover:not(:disabled) {
  background: var(--button-hover);
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
button.active {
  background: var(--accent);
  color: #1b1f24;
}
button.primary {
  background: var(--primary);
}
.message {
  margin-left: auto;
  font-size: 12px;
  color: var(--accent);
}
.help {
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 50%;
  font-weight: bold;
}
</style>
