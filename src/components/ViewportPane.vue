<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Editor } from '../core/Editor'
import { bindEditor, editorRef, state } from '../store'

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
      <span v-if="issues" :class="issues.total ? 'issue-bad' : 'issue-ok'">{{ issues.text }}</span>
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
.hud {
  top: 8px;
  left: 8px;
  display: flex;
  gap: 12px;
  color: var(--text-dim);
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
