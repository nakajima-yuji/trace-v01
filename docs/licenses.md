# 使用ライセンス一覧 — TRACE v0.1

## 実行時に同梱・読み込むもの（`node_modules/`）

| パッケージ | バージョン | ライセンス | 著作権表記 | 用途 |
|---|---|---|---|---|
| three | 0.186.1 | MIT | Copyright © 2010-2026 three.js authors | 描画・GLB 読込・FPS 操作 |
| three-mesh-bvh | 0.9.15 | MIT | Copyright (c) 2018 Garrett Johnson | BVH レイキャスト（地形接触） |
| yuka | 0.7.8 | MIT | Copyright © 2022 Yuka authors | 動物のステアリング・状態機械 |

ライセンス全文は `node_modules/<package>/LICENSE` にある。配布するときは各 LICENSE を同梱すること。

## 制作に使ったツール（配布物には含まない）

| ツール | ライセンス | 備考 |
|---|---|---|
| Blender 4.4.3 | GPL-3.0-or-later | Blender で作った成果物（.blend / GLB）には GPL は及ばない |
| MCP for Blender（ahujasid/mcp-for-blender）アドオン v1.8 | MIT（Copyright (c) 2025 Siddharth Ahuja） | Claude から Blender を操作するために使用。テレメトリは off |
| Node.js 24 | MIT | ローカルサーバ（`server.mjs`）とテスト |

## アセット
- `assets/*.glb` と `blender/trace_v01.blend` は、すべてこのプロジェクト内で bpy/bmesh から手続き的に作ったオリジナル。外部アセットライブラリや 3D 生成サービスは使っていない（MCP 側でもすべて off だった）。
- 効果音はサンプル音源を使わず、Web Audio のノイズとフィルタでその場で生成している。
- フォントは OS 標準を使い、Web フォントは読み込まない。

## 参照のみ（コードは取り込んでいない）
- three.js `examples/webgl_gpgpu_water.html`（MIT）: 波動方程式の更新式を CPU 版として再実装
- m-ender/webgl-ripples（MIT）、Steve245270533/three-stylized（MIT）、thnewlands/unity-deformablesnow（MIT）: 設計の参考
- GoogleChrome/omnitone（Apache-2.0）: 比較検討したが不採用
