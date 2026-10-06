<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Editor } from '../core/Editor'
import { getPrimitive } from '../core/primitives'
import { bindEditor, editorRef, state, ui } from '../store'

const host = ref<HTMLDivElement>()
const cm = (m: number) => +(m * 100).toFixed(1)
const issues = computed(() => {
  const i = state.selectionIssues
  if (!i) return null
  const total = i.open + i.nonManifold + i.flipped
  return { total, text: total ? `検査: 穴 ${i.open} / 内部面 ${i.nonManifold} / 裏返り ${i.flipped}` : '検査: 問題なし' }
})

onMounted(() => {
  const editor = new Editor(host.value!)
  bindEditor(editor)
  // E2E テスト・デバッグ用
  ;(window as unknown as { __kani: Editor }).__kani = editor
})
onBeforeUnmount(() => {
  editorRef.value?.dispose()
  delete (window as unknown as { __kani?: Editor }).__kani
})

function onDrop(e: DragEvent) {
  const id = e.dataTransfer?.getData('application/x-kani-primitive')
  const ed = editorRef.value
  if (!id || !ed || !getPrimitive(id)) return
  const p = ed.dropPoint(e.clientX, e.clientY)
  ed.addPrimitive(id, p ?? undefined)
}
</script>

<template>
  <div class="viewport" ref="host" @dragover.prevent @drop.prevent="onDrop">
    <div class="top">
      <div v-if="ui.banner" class="banner" :class="ui.banner.kind" :role="ui.banner.kind === 'warn' ? 'alert' : 'status'">
        <span>{{ ui.banner.text }}</span>
        <button class="close" aria-label="閉じる" @click="ui.banner = null">×</button>
      </div>
      <div class="hud">
      <span>オブジェクト {{ state.objectCount }}</span>
      <span>三角形 {{ state.triangles }}</span>
      <span v-if="state.selection.length">選択 {{ state.selection.length }}（{{ state.selectionTriangles }} 三角形）</span>
      <span v-if="state.selectionSize" class="size">{{ state.selectionSize.map(cm).join(' × ') }} cm</span>
      <span v-if="issues" :class="issues.total ? 'issue-bad' : 'issue-ok'">{{ issues.text }}</span>
      </div>
    </div>
    <div v-if="state.dragInfo" class="drag-info">{{ state.dragInfo }}</div>
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
.drag-info {
  position: absolute;
  pointer-events: none;
  font-size: 12px;
  background: rgba(20, 24, 28, 0.75);
  padding: 3px 8px;
  border-radius: 4px;
}
.top {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  pointer-events: none;
}
.hud {
  position: static;
  display: flex;
  gap: 12px;
  color: var(--text-dim);
}
.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 100%;
  padding: 6px 8px 6px 12px;
  border-radius: 6px;
  background: rgba(30, 60, 110, 0.92);
  border: 1px solid #3d8bff;
  color: #e2ecff;
  font-size: 12px;
  pointer-events: auto;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.banner.warn {
  background: rgba(120, 40, 30, 0.92);
  border-color: #ff5f57;
  color: #ffe2df;
}
.banner .close {
  background: none;
  border: none;
  color: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.8;
}
.issue-ok {
  color: #4cd964;
}
.issue-bad {
  color: #ff5f57;
}
.drag-info {
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 14px;
  color: var(--accent);
}
</style>
