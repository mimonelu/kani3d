<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { PALETTE } from '../core/palette'
import { PRIMITIVES } from '../core/primitives'
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

function onDragStart(e: DragEvent, id: string) {
  e.dataTransfer?.setData('application/x-kani-primitive', id)
}
const activeColor = () => state.selectionColor ?? state.currentColor
</script>

<template>
  <aside class="panel">
    <section>
      <h3>プリミティブ</h3>
      <p class="note">クリックで追加（選択中なら上に積む）／ドラッグで配置</p>
      <div class="prims">
        <button
          v-for="p in PRIMITIVES"
          :key="p.id"
          class="prim"
          :data-primitive="p.id"
          draggable="true"
          @dragstart="onDragStart($event, p.id)"
          @click="editorRef?.addPrimitive(p.id)"
        >
          <img v-if="thumbs[p.id]" :src="thumbs[p.id]" alt="" />
          <span>{{ p.label }}</span>
        </button>
      </div>
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
    <section class="help">
      <h3>ショートカット</h3>
      <dl>
        <dt>W / E / R</dt><dd>移動 / 回転 / 拡縮</dd>
        <dt>矢印 / PgUp・PgDn</dt><dd>10cm 移動（水平 / 垂直）</dd>
        <dt>X / Y / Z</dt><dd>45° 回転（Shift で逆）</dd>
        <dt>Ctrl+D</dt><dd>複製</dd>
        <dt>Ctrl+G</dt><dd>結合</dd>
        <dt>Delete</dt><dd>削除</dd>
        <dt>Ctrl+A / Esc</dt><dd>全選択 / 選択解除</dd>
        <dt>F</dt><dd>選択物にフォーカス</dd>
        <dt>Ctrl+Z / Ctrl+Shift+Z</dt><dd>元に戻す / やり直し</dd>
      </dl>
    </section>
  </aside>
</template>

<style scoped>
.panel {
  width: 280px;
  flex-shrink: 0;
  overflow-y: auto;
  background: #f5f6f8;
  border-left: 1px solid #ccd;
  padding: 8px 12px;
  font-size: 13px;
}
h3 {
  margin: 8px 0 6px;
  font-size: 13px;
  color: #445;
}
.note {
  margin: 0 0 6px;
  font-size: 11px;
  color: #778;
}
.prims {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.prim {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px;
  background: #fff;
  border: 1px solid #dde;
  border-radius: 6px;
  cursor: pointer;
  font-size: 11px;
}
.prim:hover {
  border-color: #2f7de1;
}
.prim img {
  width: 56px;
  height: 56px;
}
.palette {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.swatch {
  aspect-ratio: 1;
  border: 2px solid #fff;
  border-radius: 4px;
  box-shadow: 0 0 0 1px #ccd;
  cursor: pointer;
}
.swatch.active {
  box-shadow: 0 0 0 2px #ff8a00;
}
.help dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  margin: 0;
  font-size: 11px;
}
.help dt {
  font-family: monospace;
  color: #556;
}
.help dd {
  margin: 0;
}
</style>
