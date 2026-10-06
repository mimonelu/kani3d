# kani3d — エージェント向けガイド

積み木感覚の簡易 3D モデラー（Vue 3 + TypeScript + three.js）。目的は **ゲーム用 .glb の出力**。

## まず読むもの（必要な分だけ）
- 全体構造・モジュールの責務・不変条件: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 保存形式 `.kani`: [docs/FILE_FORMAT.md](docs/FILE_FORMAT.md)
- 実装ファイルを開く前に ARCHITECTURE.md の「どこを触るか」表で対象を絞ること（コンテキスト節約）

## コマンド（Node 22 必須。`.nvmrc` 参照。Node 18 では vite/playwright が動かない）
```
export PATH=~/.nvm/versions/node/v22.22.0/bin:$PATH   # nvm use でも可
npm run dev        # http://localhost:5183
npm run typecheck  # vue-tsc
npm test           # vitest（src/**/*.test.ts、Node 上で結合ロジック等）
npm run e2e        # playwright（e2e/、ポート 5184 で vite を自動起動）
npm run build
npm run screenshot # README 用画像を撮り直す（dev サーバー起動中に）
```

## 動作確認
- E2E/手動確認とも `window.__kani`（Editor インスタンス）で状態取得・操作できる（`toData()`, `selectionBounds()`, `addPrimitive()` など）
- ブラウザペインでは `.claude/launch.json` の `dev` 構成を使う

## 作業ルール
- 一段落したら `typecheck → test → e2e` を通し、差分と構造を見直してからコミット（プッシュしない）
- 仕様や構造を変えたら docs/ も更新する
