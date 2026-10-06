<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Editor } from '../core/Editor'
import { bindEditor, editorRef, state } from '../store'

const host = ref<HTMLDivElement>()
const cm = (m: number) => +(m * 100).toFixed(1)

onMounted(() => {
  const editor = new Editor(host.value!)
  bindEditor(editor)
  // E2E テスト・デバッグ用
  ;(window as unknown as { __kani: Editor }).__kani = editor
})
onBeforeUnmount(() => editorRef.value?.dispose())

function onDrop(e: DragEvent) {
  const id = e.dataTransfer?.getData('application/x-kani-primitive')
  const ed = editorRef.value
  if (!id || !ed) return
  const p = ed.dropPoint(e.clientX, e.clientY)
  ed.addPrimitive(id, p ?? undefined)
}
</script>

<template>
  <div class="viewport" ref="host" @dragover.prevent @drop.prevent="onDrop">
    <div class="hud">
      <span>オブジェクト {{ state.objectCount }}</span>
      <span>三角形 {{ state.triangles }}</span>
      <span v-if="state.selection.length">選択 {{ state.selection.length }}（{{ state.selectionTriangles }} 三角形）</span>
      <span v-if="state.selectionSize" class="size">{{ state.selectionSize.map(cm).join(' × ') }} cm</span>
    </div>
    <div class="hint">左クリック: 選択（Shift で追加） / 右ドラッグ: 回転 / 中ドラッグ: 移動 / ホイール: 拡縮</div>
  </div>
</template>

<style scoped>
.viewport {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.viewport :deep(canvas) {
  display: block;
}
.hud,
.hint {
  position: absolute;
  left: 8px;
  pointer-events: none;
  font-size: 12px;
  color: #334;
  background: rgba(255, 255, 255, 0.7);
  padding: 2px 8px;
  border-radius: 4px;
}
.hud {
  top: 8px;
  display: flex;
  gap: 12px;
}
.hint {
  bottom: 8px;
}
</style>
