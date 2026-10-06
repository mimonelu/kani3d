# 保存形式 `.kani`（JSON）

```jsonc
{
  "format": "kani3d",
  "version": 1,
  "objects": [
    {
      "id": "o...", "kind": "primitive",
      "primitive": "cube",            // core/primitives.ts の id
      "color": 6,                     // core/palette.ts のインデックス
      "position": [0, 0.1, 0],        // m（Y-up、床は y=0）
      "quaternion": [0, 0, 0, 1],
      "scale": [1, 1, 1],
      "shading": "flat"               // 省略可: "smooth" | "flat"。省略時はプリミティブ既定
    },
    {
      "id": "o...", "kind": "mesh",   // 結合結果
      "mesh": {
        "positions": [/* x,y,z … ローカル座標 */],
        "normals":   [/* nx,ny,nz … */],
        "indices":   [/* 三角形 */],
        "groups":    [{ "start": 0, "count": 36, "color": 0 }]  // indices の範囲ごとの色
      },
      "position": [...], "quaternion": [...], "scale": [...]
    }
  ]
}
```
- 読み込みは `io.parseDoc()` が検証（不正な色IDは既定色に丸め、未知のプリミティブ・不正インデックスはエラー）。
- 互換性を壊す変更をしたら `version` を上げ、`parseDoc` に移行処理を書く。
- GLB 出力: オブジェクトごとに 1 ノード／色ごとに 1 primitive、マテリアルはパレット色名の PBR（metalness 0, roughness 0.7）。
