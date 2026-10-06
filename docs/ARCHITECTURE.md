# アーキテクチャ

## レイヤー
```
Vue (src/App.vue, src/components/*, src/store.ts)   … UI・ショートカット・ファイル入出力
   │  公開メソッド呼び出し / onChange(EditorState)
   ▼
Editor (src/core/Editor.ts)                          … three.js シーン・操作・選択・スナップ・履歴
   │
   ▼
純粋ロジック (src/core/*.ts)                          … 形状生成・結合・シリアライズ（Node でテスト可）
```
three.js オブジェクトは Vue のリアクティブにしない（`markRaw`/`shallowRef`）。UI は `EditorState` のコピーだけを見る。

## どこを触るか
| やりたいこと | ファイル |
|---|---|
| プリミティブ追加・形状変更 | `core/primitives.ts`（`PRIMITIVES` に1行追加。bbox は自動正規化） |
| 色の追加・変更 | `core/palette.ts`（インデックス＝保存される色ID。並べ替え禁止、追加は末尾） |
| グリッド間隔・回転刻み | `core/constants.ts` |
| 結合（CSG・面数削減） | `core/merge.ts` / テスト `core/merge.test.ts` |
| 保存形式・GLB 出力 | `core/io.ts`、型は `core/types.ts` |
| Undo/Redo | `core/history.ts`（スナップショット方式） |
| マウス操作・選択・スナップ・編集コマンド | `core/Editor.ts` |
| キーボードショートカット | `App.vue` の `onKey` と `SidePanel.vue` のヘルプ表 |
| ツールバー / 右パネル / ビューポート HUD | `components/ToolBar.vue` / `SidePanel.vue` / `ViewportPane.vue` |
| ファイル操作・自動保存（localStorage） | `store.ts` |

## データモデル
- 永続データは `SceneObjectData`（`types.ts`）: `primitive`（種類＋単色）か `mesh`（結合結果の頂点データ `MeshData`）。どちらも position / quaternion / scale を持つ。
- three.js 上では 1 オブジェクト = 1 `Mesh`。`material` は**全メッシュ共通のパレット配列**（`paletteMaterials()`）で、`geometry.groups[].materialIndex` が色ID。
- `Editor.toData()` ⇄ `restore()` がシーンとデータを相互変換し、保存・読み込み・Undo すべてがこれを通る。
- `MeshData` は不変として扱う（色変更時も新オブジェクトを作る）→ 履歴間で参照共有できる。

## 操作とスナップ（Editor）
- マウス: 左=選択（Shift/Ctrl で追加）・ギズモ、中=パン、右=回転、ホイール=ズーム（OrbitControls の LEFT を無効化）。
- 移動: バウンディングボックス最小点を 10cm 格子へスナップ（原点ではなく bbox 基準なので奇数サイズでも面が格子に揃う）。
- 回転: TransformControls の 45° スナップ＋位置の bbox スナップ。
- 拡縮: ローカル bbox サイズ×scale を 10cm 単位に丸める（最小 10cm）。単一選択のみ。
- 複数選択は一時的な `pivot` に `attach` してまとめて移動・回転し、選択変更時に `objectRoot` へ戻す。

## 結合（merge.ts）
1. three-bvh-csg で和集合（色は groups/マテリアルで保持）
2. 頂点溶接 → 同色・同一平面・フラット法線の連結領域ごとに境界ループを抽出
3. 共線頂点を除去（隣接領域も同時に除去できる頂点のみ＝T 字の隙間を作らない）して earcut で再三角形化
4. 面積チェック等に失敗した領域は元の三角形のまま。結果は bbox 中心を原点にした `MeshData`

## 注意点（ハマりどころ）
- `geometry.addGroup(0, Infinity, …)` を CSG に渡すと **無限ループ**。必ず `setSingleColor()` で実数 count を使う。
- vitest では three-bvh-csg を `server.deps.inline` で ESM 取り込みしている（CJS 版 three の二重読み込み回避）。
- `BVH: "maxLeafSize" option has been deprecated` 警告は three-bvh-csg 側由来で無害。
