<script setup lang="ts">
import { version } from '../../package.json'
import { ui } from '../store'

const mouse: [string, string][] = [
  ['左クリック', 'オブジェクトを選択（空白で選択解除）'],
  ['Shift / Ctrl + 左クリック', '選択に追加・解除'],
  ['オブジェクトを左ドラッグ', '床と平行に移動'],
  ['白い四角ハンドル', '拡縮（5cm 単位、反対側を固定、Shift で縦横比を保つ）'],
  ['上の矢印ハンドル', '上下に移動'],
  ['色付きの円弧ハンドル', '回転（赤=X / 緑=Y / 青=Z、45° 刻み）'],
  ['右ドラッグ / 中ドラッグ / ホイール', '視点の回転 / 平行移動 / 拡大縮小'],
]
const panel: [string, string][] = [
  ['プリミティブをクリック', '注視点の床に追加（選択中ならその上に積む）'],
  ['プリミティブをドラッグ', 'ドロップ位置に配置（オブジェクト上なら天面に積む）'],
  ['カラーをクリック', '選択物の色を変更（未選択なら次に追加する色）'],
  ['形状オプション', 'プリミティブを 1 つ選択すると角数・分割数・半分などを変更できる'],
  ['ペイント（P）', 'オンの間はクリック・ドラッグしたポリゴンを現在のカラーで塗る（Esc で終了）。E キーを押すとカーソル下のポリゴンの色を消す（押したまま動かすと連続で消す）。立方体は分割数を増やすとマス目単位で塗れる'],
  ['最適化', '同じ色・同じ平面の面をまとめて三角形を減らす（分割 → ペイント → 最適化 でローポリに）。最適化済みを選ぶとボタンが「最適化解除」になり元の形に戻せる'],
]
const keys: [string, string][] = [
  ['矢印 / PageUp・PageDown', '5cm 移動（水平 / 垂直）'],
  ['X / Y / Z', '45° 回転（Shift で逆回転）'],
  ['Ctrl+D', '複製'],
  ['Ctrl+G', '結合（複数選択時）/ 結合解除（結合物を 1 つ選択時）'],
  ['Delete / Backspace', '削除'],
  ['Ctrl+A / Esc', '全選択 / 選択解除'],
  ['F', '選択物が映るようにカメラを合わせる'],
  ['Home / Shift+F', 'すべてのオブジェクトが映るようにカメラを合わせる'],
  ['Ctrl+Z / Ctrl+Shift+Z・Ctrl+Y', '元に戻す / やり直し'],
  ['Ctrl+S / Ctrl+O', '保存 / 開く'],
  ['Esc（ドラッグ中）', '操作を取り消す'],
  ['?', 'このヘルプ'],
]
const sections = [
  { title: 'マウス操作', rows: mouse },
  { title: '右パネル', rows: panel },
  { title: 'ショートカット', rows: keys },
]
</script>

<template>
  <div v-if="ui.helpOpen" class="backdrop" @click.self="ui.helpOpen = false">
    <div class="dialog" role="dialog" aria-label="ヘルプ">
      <header>
        <strong>ヘルプ</strong>
        <button class="close" aria-label="閉じる" @click="ui.helpOpen = false">×</button>
      </header>
      <section v-for="s in sections" :key="s.title">
        <h3>{{ s.title }}</h3>
        <dl>
          <template v-for="[k, v] in s.rows" :key="k">
            <dt>{{ k }}</dt>
            <dd>{{ v }}</dd>
          </template>
        </dl>
      </section>
      <p class="note">
        グリッド線は 10cm 間隔。移動・拡縮は 5cm、回転は 45° 単位でスナップします。「フラット表示」はエディタ上の見た目だけの切替で、GLB
        の法線は変わりません。結合後に移動・回転・拡縮しても「結合解除」で元のオブジェクトに戻せます。結合物は自動で検査され（穴・内部面・裏返り）、
        選択すると左上に結果が出ます。「X線表示」では隠れた面とワイヤーフレームが見え、問題のある辺が赤く表示されます。
      </p>
      <section class="about">
        <h3>このアプリについて</h3>
        <p><strong>kani3d</strong> <span class="version">v{{ version }}</span></p>
        <p>
          <a href="https://github.com/mimonelu/kani3d/blob/main/LICENSE" target="_blank" rel="noopener">MIT License</a>
          — ソースコードは改変・再配布・商用利用が自由（著作権表示は残してください）。このエディタで作ったモデル・画像は作った人のもので、商用利用も自由です。
        </p>
        <p>&copy; 2026 mimonelu</p>
        <p class="links">
          <a href="https://bsky.app/profile/mimonelu.net" target="_blank" rel="noopener">Bluesky</a>
          <a href="https://github.com/mimonelu/kani3d" target="_blank" rel="noopener">GitHub</a>
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 48px 16px 16px;
  z-index: 10;
}
.dialog {
  width: min(520px, 100%);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px 16px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  font-size: 13px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--text-dim);
}
h3 {
  margin: 14px 0 6px;
  font-size: 12px;
  color: var(--text-dim);
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
}
dt {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--accent);
}
dd {
  margin: 0;
}
.about {
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.about p {
  margin: 4px 0;
  line-height: 1.6;
}
.version {
  color: var(--text-dim);
}
.links {
  display: flex;
  gap: 14px;
}
a {
  color: var(--accent);
}
.note {
  margin: 14px 0 0;
  font-size: 12px;
  color: var(--text-dim);
}
</style>
