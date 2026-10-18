# GitHub 技術調査（v0.2 追加分）

調査日: 2026-10-18。数値は GitHub REST API と npm レジストリから取得。

## 方針
- **既存の Yuka と three-mesh-bvh を優先して再利用**した。新しい依存は追加していない。
  - Yuka: v0.1 で使っていた Vehicle/StateMachine に加えて、`Graph` / `NavNode` / `NavEdge` / `AStar` / `Path` / `FollowPathBehavior` / `OnPathBehavior` を使い、動物が獣道を A* で選んでたどるようにした（`src/truth.js`）。
  - three-mesh-bvh: 地面の高さ・地面の種類・観察（F）の照準・草の配置（読み込み時に約 2.8 万回のレイキャスト）に引き続き使っている。
- 「草の変形」「痕跡の残留」「環境の反応」に使えそうな珍しいリポジトリを 5 件調べ、**採用は 0 件、概念だけ取り入れたものが 1 件**。

## 候補と判定

| 候補 | 分野 | ライセンス | 最終更新 | 依存・導入負担 | 判定 |
|---|---|---|---|---|---|
| [lynxnathan/grass-study](https://github.com/lynxnathan/grass-study) | 草の接触・ばね状の戻り | **なし**（LICENSE ファイルなし） | 2026-09-27 | TypeScript、ビルド必要 | **概念のみ**（コードは読まず・使わず） |
| [Alchemist0823/three.quarks](https://github.com/Alchemist0823/three.quarks) | 落ち葉・しぶきの粒子 | MIT | 2026-05-21 | `three.quarks@0.17.1`、依存 `quarks.core: "*"`、展開時 1.2 MB | 不採用 |
| [FarazzShaikh/THREE-CustomShaderMaterial](https://github.com/FarazzShaikh/THREE-CustomShaderMaterial) | シェーダの拡張 | MIT | 2025-10-12 | `three-custom-shader-material@6.4.0`、peer に react と @react-three/fiber | 不採用 |
| [gkjohnson/three-bvh-csg](https://github.com/gkjohnson/three-bvh-csg) | 地面を実際に凹ませる（CSG） | MIT | 2026-09-27 | `three-bvh-csg@0.0.18`（0.0.x）、peer: three-mesh-bvh | 不採用 |
| [ZGeng/DeepSnowFootprint](https://github.com/ZGeng/DeepSnowFootprint) | 深い雪の足跡 | MIT | 2021-09-28 | Unity / C# | 参照のみ |

### grass-study（概念のみ）
- README によると「曲がった草の葉、移動する突風、**ばね状の戻り（spring recovery）**、雨」などを段階的に試す WebGL の研究。
- **ライセンスがないためコードは使えない**（読んでもいない）。取り入れたのは「踏まれた草はすぐには止まらず、少し揺れてから落ち着く」という考え方だけ。
- TRACE では `TrampleField` に**揺れ（agitation）のチャンネル**を足し、接触直後の草が約 3 秒間ふるえるようにした。これで「**まだ揺れている＝ほんの数秒前に通った**」という、新しい痕跡が生まれた。

### three.quarks（不採用）
- 汎用の粒子・VFX エンジンで、落ち葉や水しぶきに使える。
- 不採用の理由: 依存の `quarks.core` がバージョン `*` 指定で再現性が低く、サイズも大きい（1.2 MB）。必要なのは数十枚の葉が落ちるだけなので、InstancedMesh の 80 行（`src/findings.js` の `Flutter`）で足りた。

### THREE-CustomShaderMaterial（不採用）
- 標準マテリアルを壊さずにシェーダを足すためのもの。v0.1 の `onBeforeCompile` によるシェーダ差し込みを置き換えられる。
- 不採用の理由: peer 依存に react と @react-three/fiber が入っていて、TRACE（React なし）には負担が大きい。新しくできることも増えない。

### three-bvh-csg（不採用）
- メッシュのブール演算で、泥に本物の穴を開けられる。痕跡の残留としては最も本格的。
- 不採用の理由: 足跡 1 つごとに地形メッシュを作り直すのは重い（数百個になる）。0.0.x で API も安定していない。v0.1 の「浮かせて陰影を付けた蹄跡メッシュ」で読みやすさは足りている。寝床のような一度きりの凹みに使う案は、次の試作に回す。

### DeepSnowFootprint（参照のみ）
- Unity 用。深い雪に足が沈み、周りが盛り上がるシェーダ。
- 「縁が盛り上がる → 時間とともに崩れる」という見た目の変化を、観察ノートの文言（「縁がまだ崩れていない」「縁が崩れかけている」）として取り入れた。
