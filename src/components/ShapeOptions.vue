<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ensureFont, isFontFailed, isFontLoaded, requestLocalFonts, resolveFontName } from '../core/fonts'
import { getPrimitive, type ParamDef, type ParamValue } from '../core/primitives'
import { editorRef, fonts, state } from '../store'

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
/** 数値入力欄（長さは cm で入力）。空・不正な値は無視 */
function onNumber(d: ParamDef, e: Event, commit: boolean) {
  const el = e.target as HTMLInputElement
  const v = el.valueAsNumber
  if (Number.isFinite(v)) set(d, d.type === 'length' ? v / 100 : v, commit)
  // 確定時は丸めた実際の値に戻す
  if (commit && target.value) el.value = String(numberValue(d, target.value.params[d.key]))
}
const numberValue = (d: ParamDef, v: ParamValue) => (d.type === 'length' ? Math.round((v as number) * 100) : (v as number))
function reroll(d: ParamDef) {
  if (d.type !== 'seed') return
  const cur = target.value?.params[d.key]
  let v = cur
  while (v === cur) v = d.min + Math.floor(Math.random() * (d.max - d.min + 1))
  set(d, v as number, true)
}

// 文字列は入力中の値を手元に持つ（空にすると形状は既定値になるが、入力欄まで書き換えると打ち直せないため）。
// 確定（Enter・フォーカス外し）で履歴に積み、入力欄を実際の値（空なら既定値）に戻す
const drafts = ref<Record<string, string>>({})
const editing = ref<string | null>(null)
watch(
  () => target.value?.params,
  (p) => {
    if (!p) return
    for (const [k, v] of Object.entries(p)) if (typeof v === 'string' && editing.value !== k) drafts.value[k] = v
  },
  { immediate: true },
)
const onText = (d: ParamDef, e: Event) => {
  editing.value = d.key
  drafts.value[d.key] = (e.target as HTMLInputElement).value
  set(d, drafts.value[d.key], false)
}
const onTextCommit = (d: ParamDef) => {
  editing.value = null
  set(d, drafts.value[d.key], true)
  drafts.value[d.key] = String(target.value?.params[d.key] ?? '')
}

/** フォントは読み込んでから切り替える（読み込み中の代用の板で底面の高さを合わせるとずれるため） */
async function setFont(d: ParamDef, name: string) {
  const id = state.selection[0]
  await ensureFont(name)
  if (state.selection.length === 1 && state.selection[0] === id) set(d, name, true)
}

/** フォント欄の補足（読み込み中・未取得など） */
const fontNote = computed(() => {
  void fonts.loaded
  const name = target.value?.params.font as string | undefined
  if (name === undefined || isFontLoaded(name)) return ''
  if (fonts.status === 'unsupported') return 'このブラウザはローカルフォントを読めません（Chrome / Edge が必要）。代わりに板を表示しています'
  if (fonts.status === 'denied') return 'フォントの利用が許可されていません。代わりに板を表示しています'
  if (fonts.status !== 'ready') return ''
  const resolved = resolveFontName(name)
  if (!fonts.list.some((f) => f.postscriptName === resolved)) return `フォント ${resolved || name} がありません。代わりに板を表示しています`
  return isFontFailed(name) ? 'このフォントは読み込めませんでした。代わりに板を表示しています' : '読み込み中…'
})
const autoLabel = computed(() => {
  void fonts.loaded
  const n = resolveFontName('')
  return `自動${n ? `（${fonts.list.find((f) => f.postscriptName === n)?.fullName ?? n}）` : ''}`
})
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
        <template v-else-if="d.type === 'length' || d.type === 'seed'">
          <input
            type="number"
            :data-param="d.key"
            :min="d.type === 'length' ? d.min * 100 : d.min"
            :max="d.type === 'length' ? d.max * 100 : d.max"
            :step="d.type === 'length' ? 5 : 1"
            :value="numberValue(d, target.params[d.key])"
            @input="onNumber(d, $event, false)"
            @change="onNumber(d, $event, true)"
            @keydown.enter="($event.target as HTMLInputElement).blur()"
          />
          <span v-if="d.type === 'length'" class="value">cm</span>
          <button v-else class="reroll" title="別の形にする" @click.prevent="reroll(d)">🎲</button>
        </template>
        <input
          v-else-if="d.type === 'text'"
          class="wide"
          type="text"
          :data-param="d.key"
          :maxlength="d.maxLength"
          :placeholder="d.default"
          :value="drafts[d.key]"
          @input="onText(d, $event)"
          @change="onTextCommit(d)"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
        <span v-else-if="d.type === 'font'" class="wide font">
          <button v-if="fonts.status === 'idle'" @click.prevent="requestLocalFonts()">ローカルフォントを読み込む</button>
          <select
            v-else-if="fonts.status === 'ready'"
            :data-param="d.key"
            :value="target.params[d.key]"
            @change="setFont(d, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ autoLabel }}</option>
            <option v-for="f in fonts.list" :key="f.postscriptName" :value="f.postscriptName">{{ f.fullName }}</option>
          </select>
          <span v-else class="current">{{ resolveFontName(String(target.params[d.key])) || '（なし）' }}</span>
          <small v-if="fontNote">{{ fontNote }}</small>
        </span>
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
.wide {
  grid-column: span 2;
  min-width: 0;
}
input[type='number'] {
  width: 100%;
  min-width: 0;
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 6px;
  font-variant-numeric: tabular-nums;
}
.reroll {
  background: var(--button);
  border: none;
  border-radius: 6px;
  padding: 2px 0;
  cursor: pointer;
}
.reroll:hover {
  background: var(--button-hover);
}
input[type='text'] {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 6px;
}
.font {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.font select {
  width: 100%;
}
.font button {
  background: var(--button);
  border: none;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
}
.font button:hover {
  background: var(--button-hover);
}
.font .current {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.font small {
  color: var(--text-dim);
  font-size: 11px;
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
