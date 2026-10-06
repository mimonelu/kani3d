# 保存形式 `.kani`（JSON）

```jsonc
{
  "format": "kani3d",
  "version": 1,
  "objects": [
    {
      "id": "o...", "kind": "primitive",
      "primitive": "cube",            // core/primitives.ts の id
      "color": 11,                    // core/palette.ts のインデックス
      "params": { "sides": 6 },       // 省略可: 形状オプション（既定値と異なるものだけ。core/primitives.ts の ParamDef）
      "faceColors": { "12": 0 },      // 省略可: ポリゴン単位の塗り（ポリゴン番号 → 色ID。params に依存）
      "position": [0, 0.1, 0],        // m（Y-up、床は y=0）
      "quaternion": [0, 0, 0, 1],
      "scale": [1, 1, 1]
    },
    {
      "id": "o...", "kind": "mesh",   // 結合結果
      "mesh": {
        "positions": [/* x,y,z … ローカル座標 */],
        "normals":   [/* nx,ny,nz … */],
        "indices":   [/* 三角形 */],
        "groups":    [{ "start": 0, "count": 36, "color": 0 }]  // indices の範囲ごとの色
      },
      "sources": [ /* 省略可: 結合前のオブジェクト（この結合物のローカル座標）。結合解除に使う。入れ子可 */ ],
      "optimizedFrom": { "object": { /* 省略可: 最適化前のオブジェクト */ }, "offset": [0, 0, 0] },  // 最適化解除用
      "position": [...], "quaternion": [...], "scale": [...]
    }
  ]
}
```
- 読み込みは `io.parseDoc()` が検証。不正な色IDは既定色に丸め、重複・欠落 ID は振り直し、回転は正規化。未知のプリミティブ、scale 0、ゼロ長の回転、不正なインデックス・groups 範囲、深すぎる `sources` の入れ子はエラー。
- パラメータ導入前の旧プリミティブ ID（`tri-prism`・`cylinder`・`hemisphere` など）は読み込み時に新 ID＋params へ変換する（`LEGACY_PRIMITIVES`）。削除した `stairs`・`arch` は立方体になる。
- 互換性を壊す変更をしたら `version` を上げ、`parseDoc` に移行処理を書く。
- GLB 出力: オブジェクトごとに 1 ノード／色ごとに 1 primitive、マテリアルはパレット色名の PBR（metalness 0, roughness 0.7）。
