# GitHub 技術調査レポート — TRACE v0.1

調査日: 2026-10-18。数値は GitHub REST API（`gh api repos/...`）と npm レジストリ（`npm view`）から取得。
「最終更新」は GitHub の `pushed_at`（最後の push 日時）。

採用方針: **痕跡から推理する体験に直接効くものだけを、最小限採用する。**
結果として外部ライブラリの採用は 3 件（three.js / Yuka / three-mesh-bvh）。残りは「アルゴリズムだけ移植」または「参照のみ」とした。

## 1. 優先調査リポジトリ

| リポジトリ | ライセンス | 最終更新 | ★ | 使用バージョン | 依存 | 難易度 | 判定 |
|---|---|---|---|---|---|---|---|
| [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT | 2026-10-18 | 116,575 | `three@0.186.1`（2026-09-24 公開） | なし | 低 | **採用** |
| [Mugen87/yuka](https://github.com/Mugen87/yuka) | MIT | 2026-10-04 | 1,385 | `yuka@0.7.8`（npm 公開は 2022-09-17） | なし | 低〜中 | **採用** |
| [gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | 2026-10-12 | 3,518 | `three-mesh-bvh@0.9.15`（2026-09-09 公開） | peer: `three >=0.159.0` | 低 | **採用** |
| [ahujasid/mcp-for-blender](https://github.com/ahujasid/mcp-for-blender)（旧 blender-mcp） | MIT | 2026-10-06 | 31,473 | アドオン v1.8 / プロトコル 13 / Blender 4.4.3 | Blender, uvx | 低 | **制作ツールとして使用**（配布物には含めない） |

### three.js
- **使った部分**: `GLTFLoader`（Blender GLB の読込）、`PointerLockControls`、`InstancedMesh`、`AnimationMixer`（Blender の Walk/Graze）、`onBeforeCompile` によるシェーダ差し込み（草の曲げ・足跡のフェード）、`MeshPhysicalMaterial` の透過（捕捉時のガラス表示）。
- **失敗条件**: `onBeforeCompile` は `#include <project_vertex>` などシェーダチャンク名に依存するため、three.js のバージョンを上げると壊れうる → バージョン固定。WebGL2 前提。
- バージョン選定: `0.186.1` は公開から 3 週間以上経過しているもの。

### Yuka（動物の行動 AI）
- ソース確認: `build/yuka.module.js` の `StateMachine`（`states` は `Map`、`changeTo` で enter/exit）と `WanderBehavior` の実装を読んで使い方を決めた。
- **使った部分**: `Vehicle` + `WanderBehavior` / `ObstacleAvoidanceBehavior` / `ArriveBehavior` / `FleeBehavior`、独自の `StayInBounds`（`SteeringBehavior` の継承）、`StateMachine` + `State` による 5 状態（徘徊・採食・水飲み・警戒・逃走）。
- **失敗条件（実際に踏んだもの）**:
  - Wander と ObstacleAvoidance は**機体のローカル座標系**で計算される。`updateOrientation = false` にすると常に +Z 基準で計算され、木に向かって進んでしまった。→ `true` に戻し、偏りがないことを確かめる回帰テストを追加した（`tests/truth.test.js`）。
  - `WanderBehavior` は内部で `Math.random` を使う → 再現性が必要なときは `?seed=` で `Math.random` を差し替える。
  - 3D ベクトルなので Y を毎フレーム 0 に戻す必要がある。
  - npm の最終公開が 2022 年（リポジトリ自体は更新継続中）。API が安定している利点の一方、修正が npm に届かないリスクがある。

### three-mesh-bvh（地形接触）
- **使った部分**: `computeBoundsTree` + `acceleratedRaycast`。地面の高さ（動物・プレイヤー）、足が着いた面の種類判定（泥・水・地面・岩）、スキャンの照準、草の配置（読込時に約 1.5 万回レイキャスト）。
- **失敗条件**: BVH を作った後にジオメトリを変形すると不整合になる → 地形の窪みは実行時ではなく Blender 側で彫った。`firstHitOnly` を複数メッシュに使うとメッシュごとに 1 件ずつ返るので、距離でソートが必要。スキンメッシュは refit しない限り対象外。
- バージョン選定: 最新の `0.9.16` は公開から 2 週間未満だったため、`0.9.15` に固定。

### MCP for Blender
- 接続確認: `get_addon_status` → `up_to_date: true`、Blender 4.4.3。アセットライブラリ（Poly Haven / Sketchfab / Poly Pizza）と 3D 生成機能はすべて **off**。テレメトリも **off**（`telemetry_consent: false`）。
- したがって、**すべてのアセットは `execute_blender_code` から bpy/bmesh で手続き的にモデリング**し、`look` で目視確認した（外部アセットは使っていない）。
- 既存シーンの保護: ユーザーの `Scene`（未保存、Cube/Light/Camera）には触れず、新規シーン `TRACE` を作成。`.blend` は `bpy.data.libraries.write` で TRACE シーンだけを書き出したので、開いていたファイルのパスや状態は変わっていない。
- **失敗条件（実際に踏んだもの）**:
  - bmesh のループカラーは**バイトの sRGB**。リニア値のつもりで書くと GLB 書き出しで二重に暗くなる（草と足跡が真っ黒になった）。→ sRGB 値で書き直した。
  - bmesh で手組みした面は巻き方向が逆になりうる（足跡の法線がすべて下向きだった）→ `reverse_faces`。
  - `create_cone` などを続けて呼ぶと、面の並び順が作成順と一致しない → 木の幹と樹冠のマテリアルが入れ替わった。→ 幾何（軸からの距離）で割り当て直した。
  - glTF 書き出しの頂点カラー既定値は `MATERIAL`。`export_vertex_color='ACTIVE'` を明示した。

## 2. 追加調査（5 件）

| 候補 | 分野 | ライセンス | 最終更新 | 依存 / 言語 | 難易度 | 判定 |
|---|---|---|---|---|---|---|
| [three.js `examples/webgl_gpgpu_water.html`](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_gpgpu_water.html) | 物理的な波紋 | MIT（three.js 本体） | 2026-10-18 | `GPUComputationRenderer` | 中 | **アルゴリズムを移植**（CPU 版） |
| [m-ender/webgl-ripples](https://github.com/m-ender/webgl-ripples) | 物理的な波紋 | MIT | 2016-06-13 | 素の WebGL1 / JS | 中 | 参照のみ |
| [Steve245270533/three-stylized](https://github.com/Steve245270533/three-stylized) | GPU による草 | MIT | 2026-08-11 | three.js / TypeScript | 中 | 参照のみ |
| [GoogleChrome/omnitone](https://github.com/GoogleChrome/omnitone) | 音源方向 | Apache-2.0 | 2026-10-04 | Web Audio / JS（`omnitone@2.0.0`） | 中 | 不採用 |
| [thnewlands/unity-deformablesnow](https://github.com/thnewlands/unity-deformablesnow) | 足跡・変形痕 | MIT | 2021-01-08 | Unity / C# | — | 概念のみ採用 |

### three.js webgl_gpgpu_water（採用: アルゴリズムのみ）
- ソース確認: heightmap シェーダの更新式が `newHeight = ((north + south + east + west) * 0.5 - previous) * viscosity` であることを確認した。
- TRACE では `src/rules.js` の `RippleField` が、同じ 2 バッファ波動方程式を **CPU** で解く（水たまり 3 つ × 96² セル）。
- CPU を選んだ理由: 水たまりが小さく 1 ms 未満で済む、Node でユニットテストできる、浮動小数レンダーターゲット非対応の環境でも動く。
- 失敗条件: 計算量は 解像度² × 水たまり数 に比例する。水面が大きく・多くなったら GPGPU 版へ移行する。

### m-ender/webgl-ripples（参照のみ）
- README によると、陽的 2 次差分で波動方程式を解き、境界条件をテクスチャの α で与える方式。TRACE の方式が物理的に妥当であることの裏付けに使った。
- 不採用の理由: 2016 年以降更新がなく、WebGL1 の単体デモで three.js に組み込める形になっていない。

### Steve245270533/three-stylized（参照のみ）
- README によると、インスタンス化した草＋風アニメーション＋手続き地形のメドウ描画器（TypeScript、three.js のみに依存）。
- 不採用の理由: **踏まれて倒れる**表現がなく、TRACE の要（痕跡）を満たさない。TS のビルド工程も増える。インスタンス草の構成だけ参考にし、曲げは自作（`src/grass.js`）。
- 失敗条件（自作側）: 草の量は GPU の頂点処理に効く。7,096 クランプ（約 28 万三角形）で Iris Xe 上 1 フレーム約 24 ms（シミュレーション込み）。

### GoogleChrome/omnitone（不採用）
- README によると、Ambisonics（FOA/HOA）の音場を Web Audio でバイノーラルに描画する。
- 不採用の理由: TRACE の音は「枝が折れる」「泥を踏む」といった**点音源**で、ブラウザ標準の `PannerNode`（`panningModel: 'HRTF'`）で足りる。Omnitone が効くのは録音した環境音を音場として鳴らす場合 → 次の試作の候補。

### thnewlands/unity-deformablesnow（概念のみ）
- README によると、正射影カメラで深度を蓄積して「押し跡バッファ」を作り、画面エフェクトで少しずつ消していく方式（Batman: Arkham Origins の GDC 講演に基づく）。
- TRACE の `TrampleField` は、この「押し跡バッファ＋時間で戻る」という考え方を、真値から直接スタンプする CPU 版にしたもの。**戻り具合がそのまま痕跡の新しさ**になる。
- 不採用の理由: Unity/C# で、平らな固定範囲が前提。

### 分野ごとの結論
| 分野 | 結論 |
|---|---|
| GPU による草の変形 | 自作（`onBeforeCompile` で真値由来の押し跡テクスチャを読む） |
| 地形への足跡・変形痕 | Blender 製の蹄跡メッシュを InstancedMesh で配置し、BVH で面に沿わせる。泥は深く長く残り、地面は淡く短い |
| 物理的な波紋 | three.js gpgpu water と同じ式を CPU で解く |
| 動物の行動 AI | Yuka（ステアリング＋有限状態機械） |
| 音源方向の推理 | ブラウザ標準の `PannerNode` HRTF。サンプル音源は使わず、ノイズとフィルタで手続き生成 |
| 不可視物体の間接的な可視化 | v0.1 では未導入。痕跡だけで推理させることを優先した（次の試作案 2 を参照） |
