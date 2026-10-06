<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { CAMERA_PRESETS, type CameraPreset, type RenderOptions } from '../core/Editor'
import type { Vec3 } from '../core/types'
import { downloadBlob } from '../core/io'
import { editorRef, notify, ui } from '../store'

/**
 * 画像出力ダイアログ（PNG）。設定を変えるとプレビューを描き直す。
 * 入力内容はアプリ起動中は保持（コンポーネントは常駐し、開くたびにリセットしない）
 */
const SIZE_PRESETS = [
  { id: 'view', label: 'シーンビューと同じ' },
  { id: '1280x720', label: '1280 × 720' },
  { id: '1920x1080', label: '1920 × 1080' },
  { id: '1080x1080', label: '1080 × 1080' },
  { id: '2048x2048', label: '2048 × 2048' },
  { id: 'custom', label: 'カスタム' },
] as const
const PREVIEW_MAX = 520

const form = reactive({
  fileName: '',
  sizePreset: 'view' as string,
  width: 1280,
  height: 720,
  background: '#1b1f24',
  opacity: 100,
  grid: false,
  cameraPreset: 'view' as CameraPreset | 'custom',
  /** 全体を収めるときの上下左右の余白（px） */
  padding: 32,
  position: [0, 0, 0] as Vec3,
  target: [0, 0, 0] as Vec3,
  up: undefined as Vec3 | undefined,
})
const preview = ref('')
const saving = ref(false)

const options = computed<RenderOptions>(() => ({
  width: form.width,
  height: form.height,
  background: form.background,
  opacity: form.opacity / 100,
  grid: form.grid,
  camera: { position: [...form.position], target: [...form.target], up: form.up },
}))

function applySizePreset() {
  const ed = editorRef.value
  if (!ed || form.sizePreset === 'custom') return
  const s = form.sizePreset === 'view' ? ed.viewSize() : { width: +form.sizePreset.split('x')[0], height: +form.sizePreset.split('x')[1] }
  form.width = s.width
  form.height = s.height
}

function applyCameraPreset() {
  const ed = editorRef.value
  if (!ed || form.cameraPreset === 'custom') return
  const c = ed.presetCamera(form.cameraPreset, form.width, form.height, form.padding)
  form.position = c.position
  form.target = c.target
  form.up = c.up
}

function setPos(kind: 'position' | 'target', i: number, e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  if (!Number.isFinite(v)) return
  form[kind][i] = v
  form.cameraPreset = 'custom'
}

// 開いたとき: 入力内容は保持し、「シーンビューと同じ」「全体を収める」系だけ現在の状態で取り直す
let initialized = false
watch(
  () => ui.renderOpen,
  (open) => {
    if (!open) return
    if (!initialized) form.fileName = ui.fileName
    initialized = true
    applySizePreset()
    applyCameraPreset()
  },
)
watch(() => form.sizePreset, applySizePreset)
watch(() => form.cameraPreset, applyCameraPreset)
// サイズが変わると縦横比が変わるので、全体を収めるプリセットは取り直す
watch(
  () => [form.width, form.height, form.padding],
  () => form.cameraPreset !== 'view' && form.cameraPreset !== 'custom' && applyCameraPreset(),
)

let timer = 0
function updatePreview() {
  const ed = editorRef.value
  if (!ed || !ui.renderOpen || form.width < 1 || form.height < 1) return
  const k = Math.min(1, PREVIEW_MAX / Math.max(form.width, form.height))
  preview.value = ed.renderImage({ ...options.value, width: form.width * k, height: form.height * k }).toDataURL('image/png')
}
watch(
  [options, () => ui.renderOpen],
  () => {
    clearTimeout(timer)
    timer = window.setTimeout(updatePreview, 80)
  },
  { deep: true },
)
onBeforeUnmount(() => clearTimeout(timer))

async function save() {
  const ed = editorRef.value
  if (!ed) return
  saving.value = true
  try {
    const name = form.fileName.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'untitled'
    downloadBlob(await ed.renderPng(options.value), `${name}.png`, 'image/png')
    ui.renderOpen = false
  } catch (e) {
    notify(`画像出力失敗: ${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}

const cameraOptions = [
  { id: 'view', label: 'シーンビューと同じ' },
  ...Object.entries(CAMERA_PRESETS).map(([id, p]) => ({ id, label: `${p.label}（全体を収める）` })),
  { id: 'custom', label: 'カスタム' },
]
const axes = ['X', 'Y', 'Z']
</script>

<template>
  <div v-if="ui.renderOpen" class="backdrop" @click.self="ui.renderOpen = false">
    <div class="dialog" role="dialog" aria-label="画像出力">
      <header>
        <strong>画像出力</strong>
        <button class="close" aria-label="閉じる" @click="ui.renderOpen = false">×</button>
      </header>
      <div class="body">
        <div class="preview" :style="{ aspectRatio: `${form.width} / ${form.height}` }">
          <img v-if="preview" :src="preview" alt="プレビュー" data-test="render-preview" />
        </div>
        <div class="fields">
          <label class="row">
            <span>ファイル名</span>
            <span class="inline"><input v-model="form.fileName" data-field="fileName" class="grow" /><span class="dim">.png</span></span>
          </label>
          <label class="row">
            <span>サイズ</span>
            <select v-model="form.sizePreset" data-field="sizePreset">
              <option v-for="s in SIZE_PRESETS" :key="s.id" :value="s.id">{{ s.label }}</option>
            </select>
          </label>
          <div class="row">
            <span></span>
            <span class="inline">
              <input type="number" min="1" max="8192" v-model.number="form.width" data-field="width" @input="form.sizePreset = 'custom'" />
              ×
              <input type="number" min="1" max="8192" v-model.number="form.height" data-field="height" @input="form.sizePreset = 'custom'" />
              <span class="dim">px</span>
            </span>
          </div>
          <label class="row">
            <span>背景色</span>
            <span class="inline"><input type="color" v-model="form.background" data-field="background" /><span class="dim">{{ form.background }}</span></span>
          </label>
          <label class="row">
            <span>背景の不透明度</span>
            <span class="inline"><input type="range" min="0" max="100" v-model.number="form.opacity" data-field="opacity" class="grow" /><span class="num">{{ form.opacity }}%</span></span>
          </label>
          <label class="row">
            <span>グリッド</span>
            <span class="inline"><input type="checkbox" v-model="form.grid" data-field="grid" /><span class="dim">グリッドと軸ラインを含める</span></span>
          </label>
          <label class="row">
            <span>カメラ</span>
            <select v-model="form.cameraPreset" data-field="cameraPreset">
              <option v-for="c in cameraOptions" :key="c.id" :value="c.id">{{ c.label }}</option>
            </select>
          </label>
          <label class="row">
            <span>余白</span>
            <span class="inline">
              <input
                type="number"
                min="0"
                max="1000"
                v-model.number="form.padding"
                data-field="padding"
                :disabled="form.cameraPreset === 'view' || form.cameraPreset === 'custom'"
              />
              <span class="dim">px（全体を収めるカメラのとき。0 で画像の端ぴったり）</span>
            </span>
          </label>
          <div v-for="kind in ['position', 'target'] as const" :key="kind" class="row">
            <span>{{ kind === 'position' ? '位置 (m)' : '注視点 (m)' }}</span>
            <span class="inline">
              <template v-for="(a, i) in axes" :key="a">
                <span class="dim">{{ a }}</span>
                <input type="number" step="0.05" :value="form[kind][i]" :data-field="`${kind}${a}`" @change="setPos(kind, i, $event)" />
              </template>
            </span>
          </div>
          <footer>
            <button @click="ui.renderOpen = false">キャンセル</button>
            <button class="primary" :disabled="saving" @click="save">PNG を保存</button>
          </footer>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 10;
}
.dialog {
  width: min(980px, 100%);
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px 14px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  font-size: 13px;
}
header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
footer {
  justify-content: flex-end;
  gap: 8px;
  margin-top: auto;
  padding-top: 12px;
}
.close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-dim);
}
.body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 400px;
  gap: 16px;
  margin-top: 10px;
}
@media (max-width: 760px) {
  .body {
    grid-template-columns: 1fr;
  }
}
/* 透明部分が分かるよう市松模様の上に表示 */
.preview {
  width: 100%;
  max-height: 60vh;
  align-self: start;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: repeating-conic-gradient(#3a3f47 0% 25%, #2a2e34 0% 50%) 0 0 / 16px 16px;
}
.preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.fields {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: grid;
  grid-template-columns: 7em minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.row > span:first-child {
  color: var(--text-dim);
  font-size: 12px;
}
.inline {
  display: flex;
  align-items: center;
  gap: 6px;
}
.grow {
  flex: 1;
  min-width: 0;
}
.dim {
  color: var(--text-dim);
  font-size: 12px;
}
.num {
  width: 3em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
input:not([type]),
input[type='number'],
select {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 6px;
  font: inherit;
}
input[type='number'] {
  width: 4.6em;
  min-width: 0;
}
input[type='range'],
input[type='checkbox'] {
  accent-color: var(--accent);
}
input[type='color'] {
  width: 40px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: none;
}
footer button {
  background: var(--button);
  border: none;
  border-radius: 7px;
  padding: 6px 14px;
  cursor: pointer;
}
footer button:hover:not(:disabled) {
  background: var(--button-hover);
}
footer button.primary {
  background: var(--accent);
  color: #1b1f24;
}
footer button.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
</style>
