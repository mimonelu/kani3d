<script setup lang="ts">
import { computed } from 'vue'
import { getPrimitive, type ParamDef, type ParamValue } from '../core/primitives'
import { editorRef, state } from '../store'

/** 単独選択中のプリミティブの形状オプション。スライダー操作中はプレビューのみで、離したときに履歴へ積む */
const target = computed(() => {
  const sp = state.selectionPrimitive
  const def = sp && getPrimitive(sp.primitive)
  return def ? { def, params: sp.params, painted: sp.painted } : null
})

function set(d: ParamDef, value: ParamValue, commit: boolean) {
  editorRef.value?.setPrimitiveParams({ [d.key]: value }, commit)
}
const fmt = (d: ParamDef, v: ParamValue) => (d.type === 'ratio' ? `${Math.round((v as number) * 100)}%` : String(v))
const onRange = (d: ParamDef, e: Event, commit: boolean) => set(d, Number((e.target as HTMLInputElement).value), commit)
</script>

<template>
  <section v-if="state.selection.length" class="shape-options">
    <h3>形状オプション</h3>
    <p v-if="!target" class="empty">プリミティブを 1 つ選択すると、角数や分割数などを変更できます。</p>
    <p v-else-if="!target.def.params.length" class="empty">{{ target.def.label }}にはオプションがありません。</p>
    <div v-else-if="target.painted" class="painted">
      <p class="empty">ポリゴン単位で塗られているため形状を変更できません（分割数などを変えると塗りの位置が変わるため）。</p>
      <button @click="editorRef?.clearPaint()">塗りをリセット</button>
    </div>
    <div v-else class="rows" :data-shape="target.def.id">
      <label v-for="d in target.def.params" :key="d.key" class="row">
        <span class="name">{{ d.label }}</span>
        <template v-if="d.type === 'int' || d.type === 'ratio'">
          <input
            type="range"
            :data-param="d.key"
            :min="d.min"
            :max="d.max"
            :step="d.type === 'ratio' ? d.step : 1"
            :value="target.params[d.key]"
            @input="onRange(d, $event, false)"
            @change="onRange(d, $event, true)"
          />
          <span class="value">{{ fmt(d, target.params[d.key]) }}</span>
        </template>
        <input
          v-else-if="d.type === 'bool'"
          type="checkbox"
          :data-param="d.key"
          :checked="!!target.params[d.key]"
          @change="set(d, ($event.target as HTMLInputElement).checked, true)"
        />
        <select
          v-else
          :data-param="d.key"
          :value="target.params[d.key]"
          @change="set(d, Number(($event.target as HTMLSelectElement).value), true)"
        >
          <option v-for="o in d.options" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </label>
    </div>
  </section>
</template>

<style scoped>
h3 {
  margin: 10px 0 6px;
  font-size: 13px;
}
.empty {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.painted button {
  margin-top: 6px;
  background: var(--button);
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
}
.painted button:hover {
  background: var(--button-hover);
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row {
  display: grid;
  grid-template-columns: 6.5em 1fr 3em;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.name {
  color: var(--text-dim);
}
.value {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
}
input[type='checkbox'] {
  justify-self: start;
  accent-color: var(--accent);
}
select {
  grid-column: span 2;
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 4px;
}
</style>
