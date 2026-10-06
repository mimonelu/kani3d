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
| プリミティブ追加・形状オプション | `core/primitives.ts`（`PRIMITIVES` に定義を追加。`params` に ParamDef を書けば UI〈`components/ShapeOptions.vue`〉は自動生成。bbox 正規化・巻き方向・法線は自動。`primitives.test.ts` が全パラメータの端値で閉じた形状かを検証） |
| 既存オブジェクトの形状変更 | `Editor.setPrimitiveParams`（底面の高さを保って作り直す。スライダー操作中は commit=false でプレビュー） |
| ポリゴン単位のペイント | `core/paint.ts`（三角形ごとの色 → index を色順に並べ替えて groups 化）、`Editor.setPaintMode / paintHit`。ポリゴン番号はプリミティブ生成時に `geometry.userData.polyIds`（`PrimitiveDef.polygons`: 同一平面でつながった三角形 or 立方体のマス目）、結合物は `meshPolygons`（同一平面でつながった三角形） |
| 単体の面数最適化 | `Editor.optimizeSelected`（オブジェクトのローカル座標で 1 入力の `mergeObjects` を通す。位置・回転・拡縮は保持。最適化前の形は `optimizedFrom` に残し、ボタンは結合と同様に切り替え式で「最適化解除」で戻す〈`store.optimizeMode`〉。結合物の `sources` は原点のずれ分を補正して引き継ぐので結合解除も可能） |
| 旧形式のプリミティブ ID の変換 | `primitives.ts` の `LEGACY_PRIMITIVES`（`io.parseDoc` が適用） |
| 色の追加・変更 | `core/palette.ts`（インデックス＝保存される色ID。並べ替え禁止、追加は末尾） |
| 表示グリッド(10cm)・スナップ単位(5cm)・回転刻み・初期サイズ(10cm) | `core/constants.ts`（`GRID` は表示のみ、スナップは `SNAP`） |
| フラット表示切替（エディタ上の見た目のみ。全マテリアルの `flatShading`、GLB には影響なし） | `Editor.setFlatShading`、記憶は `store.ts` |
| カメラのフィット（全体表示・起動/読み込み時の自動フィット） | `Editor.frameAll / fitBox / resetView` |
| 結合解除 | `Editor.unmergeSelected`（データは `MeshObject.sources`）。ボタンは結合と共用（`store.mergeMode`: 複数選択→結合、結合物 1 つ→解除） |
| 結合（CSG・修復・面数削減） | `core/merge.ts` / テスト `core/merge.test.ts` |
| 結合結果の検査（穴・内部面・裏返り） | `core/meshCheck.ts`、表示は `Editor.setXray` / `ViewportPane.vue` の HUD |
| 保存形式・GLB 出力 | `core/io.ts`、型は `core/types.ts` |
| Undo/Redo | `core/history.ts`（スナップショット方式） |
| 操作ハンドル（拡縮・回転・持ち上げ・本体ドラッグの計算と描画） | `core/Gizmo.ts` |
| マウス操作の振り分け・選択・スナップ・編集コマンド | `core/Editor.ts` |
| キーボードショートカット | `App.vue` の `onKey` と `components/HelpDialog.vue` |
| ツールバー / 右パネル / ビューポート HUD / ヘルプ | `components/ToolBar.vue` / `SidePanel.vue` / `ViewportPane.vue` / `HelpDialog.vue` |
| UI 配色（ダークテーマ） | `style.css` の CSS 変数、シーン背景・グリッド色は `Editor.setupLightsAndGround` |
| ファイル操作・自動保存（localStorage） | `store.ts`（`Editor.revision` が変わったときだけ保存。読めない自動保存は `kani3d:autosave.bak` に退避） |

## データモデル
- 永続データは `SceneObjectData`（`types.ts`）: `primitive`（種類＋単色）か `mesh`（結合結果の頂点データ `MeshData`）。どちらも position / quaternion / scale を持つ。
- three.js 上では 1 オブジェクト = 1 `Mesh`。`material` は**全メッシュ共通のパレット配列**（`paletteMaterials()`）で、`geometry.groups[].materialIndex` が色ID。
- `Editor.toData()` ⇄ `restore()` がシーンとデータを相互変換し、保存・読み込み・Undo すべてがこれを通る。
- transform は保存・履歴とも浮動小数のノイズだけを落として保持（`Editor.toTransform`）。1e-6 などに丸めると回転が正規化されずわずかに縮み、同一平面の面がずれて再結合時に CSG が穴を残す。
- `MeshData` は不変として扱う（色変更時も新オブジェクトを作る）→ 履歴間で参照共有できる。
- プリミティブの塗りは `faceColors`（ポリゴン番号 → 色）。形状オプションを変えると番号がずれるので、塗りがある間は形状オプションをロック（UI でリセットを促す）。全体の色変更は塗りを上書きする。結合物を塗ると MeshData を作り直す（`sources` は塗らないので結合解除で塗りは消える）。
- 結合物は `sources` に結合前のオブジェクトを **結合物のローカル座標** で保持する（入れ子可）。結合解除はその時点の結合物の行列を掛けて戻すので、結合後の移動・回転・拡縮が引き継がれる（回転した結合元を非等倍拡縮した場合は歪みを近似）。色変更は `sources` にも再帰的に反映。

## 操作とスナップ（Editor + Gizmo）
- マウス: 左=選択・ハンドル・本体ドラッグ（Shift/Ctrl+クリックで追加選択）、中=パン、右=回転、ホイール=ズーム（OrbitControls の LEFT は無効）。
- `Editor.onPointerDown` の優先順: ハンドル → オブジェクト（選択してそのまま本体ドラッグ）→ 空白（クリックで選択解除）。
- ポインタは押した 1 本だけを追跡（pointerId・キャプチャ）。終了は「全ボタン解放」で判定し、`pointercancel`・キャプチャ喪失・ウィンドウのフォーカス喪失・Esc は `cancelDrag()` で開始前に戻す。ドラッグ中は他のキー操作を受け付けない（`App.vue` が `Editor.isDragging` を見る）。
- Gizmo は Tinkercad 風の統合ハンドル。サイズは画面上で一定（`HANDLE_PX`）、`depthTest:false` で常に手前に描画。
  - 本体ドラッグ: 掴んだ点の高さの水平面上を移動。
  - 持ち上げ（天面上の矢印）: Y 移動。
  - 拡縮（縦の中央の高さの四隅・四面中心、天面中央）: **反対側を固定**し、ローカル軸のサイズを 5cm 単位（最小 5cm）に丸める。Shift で全軸等倍（底面は固定）。回転済みオブジェクトもローカル軸で伸縮。単独選択時のみ。
  - 回転（X 赤 / Y 緑 / Z 青の円弧、キーボード X/Y/Z も同じ）: **ローカル箱の中心**（物体に固定された点＝`Gizmo.rotationCenter()`）まわりにワールド軸で 45° 刻み。回転後は位置スナップしない（ワールド AABB の中心や bbox スナップを使うと非対称形状で中心がずれていくため）。
- 移動の後は `snapBoxMin`: バウンディングボックス最小点を 5cm 格子へ（原点基準ではないので奇数サイズでも面が格子に揃う）。拡縮は固定点、回転は中心を保つためこのスナップをしない。
- ハンドルの選択は奥行きではなく画面上の距離（点状ハンドルは中心から `HANDLE_PX*0.8` 以内）。小さな物体で本体ドラッグがハンドルに奪われないため。
- 複数選択は一時的な `pivot` に `attach` してまとめて移動・回転し、選択変更時に `objectRoot` へ戻す。Gizmo の対象の親は identity である前提。
- ドラッグ中の寸法・角度は `EditorState.dragInfo` で HUD に表示。
- E2E 用に `Editor.debugHandleScreen()` がハンドルの画面座標を返す（`e2e/gizmo.spec.ts`）。

## 結合（merge.ts）
1. three-bvh-csg で和集合（色は groups/マテリアルで保持）→ 近接頂点の統合（`clusterVertices`、0.05mm 以内）→ T 字接合の修復（`fixTJunctions`）→ 平面上の穴埋め（`fillPlanarHoles`）。
   CSG は同一平面で重なる面（床に並べた底面など）で稀に穴・重複を残すため、分割方式（CDT / Legacy）× 結合順の 4 通りを試し、辺の問題が最少のものを採用
2. 頂点溶接 → 同色・同一平面・フラット法線の連結領域ごとに境界ループを抽出
3. 共線頂点を除去（隣接領域も同時に除去できる頂点のみ＝T 字の隙間を作らない）して earcut で再三角形化
4. 面積チェック等に失敗した領域は元の三角形のまま。さらに出力の辺の健全性が入力より悪化したら、関わる領域を元に戻して繰り返す。結果は bbox 中心を原点にした `MeshData`
5. 面数削減では面積ほぼゼロでも頂点が異なる三角形を捨てない（形状を閉じる役割があるため）。
6. 検査（`checkMesh`）: 位置で溶接した辺ごとに「逆向きの 2 面で共有」以外を問題とする。結合直後に問題があればシーンビュー上部に警告（`ui.banner`。最適化結果も同じ枠で info 表示。自動では消えない）、結果は MeshData 参照でキャッシュ（保存しない）。`e2e/merge-roundtrip.spec.ts` が「結合→移動・回転→解除→再結合」で悪化しないことを検証。
   `merge.test.ts` が全プリミティブ × 4 形状 × 4 配置で穴・裏返りゼロを検証（辺だけで接する配置は幾何学的に非多様体になり得るので内部面は少数許容）

## 注意点（ハマりどころ）
- `geometry.addGroup(0, Infinity, …)` を CSG に渡すと **無限ループ**。必ず `setSingleColor()` で実数 count を使う。
- vitest では three-bvh-csg を `server.deps.inline` で ESM 取り込みしている（CJS 版 three の二重読み込み回避）。
- `BVH: "maxLeafSize" option has been deprecated` 警告は three-bvh-csg 側由来で無害。
- 表示用の設定（フラット表示・X線）はパレットマテリアルを直接書き換える。GLB 出力は `exportMaterials()` の別マテリアルを使うので影響しない。
- X線表示のオーバーレイはメッシュの子（name='overlay'）。メッシュを捨てるときは `disposeMesh()` を使う。
