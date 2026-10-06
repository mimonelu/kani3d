<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PALETTE } from '../core/palette'
import { PRIMITIVES, type PrimitiveDef } from '../core/primitives'
import { renderPrimitiveThumbnails } from '../core/thumbnails'
import { editorRef, state } from '../store'

const thumbs = ref<Record<string, string>>({})
onMounted(() => {
  try {
    thumbs.value = renderPrimitiveThumbnails()
  } catch {
    /* WebGL 不可の環境ではラベルのみ */
  }
})

const categories = computed(() => {
  const map = new Map<string, PrimitiveDef[]>()
  for (const p of PRIMITIVES) map.set(p.category, [...(map.get(p.category) ?? []), p])
  return [...map]
})

function onDragStart(e: DragEvent, id: string) {
  e.dataTransfer?.setData('application/x-kani-primitive', id)
}
const activeColor = () => state.selectionColor ?? state.currentColor
</script>

<template>
  <aside class="panel">
    <section>
      <h3>プリミティブ</h3>
      <template v-for="[cat, items] in categories" :key="cat">
        <h4>{{ cat }}</h4>
        <div class="prims">
          <button
            v-for="p in items"
            :key="p.id"
            class="prim"
            :data-primitive="p.id"
            :title="p.label"
            draggable="true"
            @dragstart="onDragStart($event, p.id)"
            @click="editorRef?.addPrimitive(p.id)"
          >
            <img v-if="thumbs[p.id]" :src="thumbs[p.id]" alt="" />
            <span>{{ p.label }}</span>
          </button>
        </div>
      </template>
    </section>
    <section>
      <h3>カラー</h3>
      <div class="palette">
        <button
          v-for="(c, i) in PALETTE"
          :key="c.hex"
          class="swatch"
          :class="{ active: activeColor() === i }"
          :style="{ background: c.hex }"
          :title="c.name"
          :data-color="i"
          @click="editorRef?.setColor(i)"
        />
      </div>
    </section>
  </aside>
</template>

<style scoped>
.panel {
  width: 280px;
  flex-shrink: 0;
  overflow-y: auto;
  background: var(--panel);
  border-left: 1px solid var(--border);
  padding: 4px 12px 12px;
  font-size: 13px;
}
h3 {
  margin: 10px 0 6px;
  font-size: 13px;
}
h4 {
  margin: 8px 0 4px;
  font-size: 11px;
  font-weight: normal;
  color: var(--text-dim);
}
.prims {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}
.prim {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 3px 2px;
  background: var(--panel-2);
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  font-size: 10px;
  white-space: nowrap;
}
.prim:hover {
  border-color: var(--primary);
  background: var(--button-hover);
}
.prim img {
  width: 44px;
  height: 44px;
}
.palette {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.swatch {
  aspect-ratio: 1;
  border: 2px solid var(--panel);
  border-radius: 4px;
  box-shadow: 0 0 0 1px var(--border);
  cursor: pointer;
}
.swatch.active {
  box-shadow: 0 0 0 2px var(--accent);
}
</style>
