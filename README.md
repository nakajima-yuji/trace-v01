# TRACE v0.1 — 透明動物の痕跡推理 FPS

30 m 四方の森に、目に見えない動物が 1 匹いる。
泥の足跡、倒れた草、水たまりの波紋、枝の折れる音、揺れる低木。**痕跡だけを頼りに、いま動物がいる場所を推理してスキャンする**一人称ゲーム。

すべて無料で、ローカルだけで動く（外部 CDN もサーバも不要）。

## 遊び方

```bash
npm install
```

```bash
npm start
```

ブラウザで http://localhost:5173/ を開き、画面をクリックすると始まる（ヘッドホン推奨）。

| 操作 | 内容 |
|---|---|
| マウス | 見回す |
| WASD / 矢印キー | 移動 |
| Shift | 走る（うるさいので気づかれやすい） |
| C / 左 Ctrl | しゃがむ切替（静か・痕跡を間近で見られる） |
| 右クリック / E | 照準の地点を推理スキャン。3 回まで、誤差 1.6 m 以内で成功 |
| V | 音の方向表示（字幕）の切替 |
| Esc | 一時停止 |
| R | 結果画面から再挑戦 |

### 痕跡の読み方
- **泥**: はっきりした蹄跡が 15 分残る。蹄の向きで進行方向が、間隔で歩いているか走っているかが分かる。
- **草地**: 体が通った筋が淡い色で倒れる。約 90 秒で起き上がるので、**倒れ具合がそのまま新しさ**になる。立ち止まっている動物の蹄の下の草は起き上がらない。
- **水たまり**: 着地点を中心に同心円の波紋が広がる。水を飲んでいるときは口元から小さな波紋が出る。
- **枝**: 踏むと折れて音が鳴り、折れた枝は白っぽい断面を見せたまま残る。
- **低木**: 体がこすると約 2 秒揺れ、葉擦れの音がする。
- 動物はプレイヤーの足音を聞いている。走ると 15 m、歩くと 8 m、しゃがみ歩きなら 4 m で気づかれ、立ち止まって様子をうかがったあと逃げる。

### URL パラメータ
| パラメータ | 内容 |
|---|---|
| `?seed=123` | 森の草の配置と動物の行動を固定する |
| `?debug=1` | 動物の実体（赤いワイヤーフレーム）と真値を表示 |
| `?captions=1` | 音の方向表示を最初から ON にする |
| `?selftest=1` | ブラウザ内の自動テストを実行し、結果を右下に表示 |

## 設計の中心: 真値 → 痕跡

```
            ┌─────────── AnimalTruth（src/truth.js）───────────┐
            │  位置・向き・速度・行動状態・歩行の位相           │  ← Yuka の Vehicle + StateMachine
            │  （この世界で動物の位置を知っている唯一の場所）    │
            └───────────────┬──────────────────────────────────┘
                            │ イベント: footfall / sip / state ＋ 毎フレームの接触
                            ▼
   world.surfaceAt(x,z)  ← three-mesh-bvh のレイキャストで、足元が 泥 / 水 / 草 / 地面 / 岩 か判定
                            │
          traceForFootfall(surface, speed)（src/rules.js：three.js に依存しない純粋な規則）
                            │
     ┌──────────┬───────────┼────────────┬─────────────┬──────────┐
     ▼          ▼           ▼            ▼             ▼          ▼
  足跡       草の押し跡    波紋        枝が折れる     低木の揺れ   立体音響
 (Instanced) (GPU で曲げ) (波動方程式) (props.js)   (props.js)  (PannerNode HRTF)
```

- 足跡の位置は、Blender の歩行アクションから求めた脚の着地位置（`src/gait.js`、ストライド 1.1744 m、トロット）を真値の位置と向きで変換したもの。捕捉して動物が見えると、歩行アニメーションの蹄が残した足跡にぴったり重なる。
- 描画側は真値を読まない（例外は捕捉後の表示と `?debug=1`）。

## ファイル構成

| パス | 内容 |
|---|---|
| `index.html` | importmap（`node_modules` を直接読む）、HUD、開始・結果画面 |
| `server.mjs` | 依存なしの静的サーバ |
| `src/truth.js` | 動物の真値。Yuka のステアリングと 5 状態（徘徊・採食・水飲み・警戒・逃走） |
| `src/gait.js` | トロット歩行の位相と着地位置 |
| `src/rules.js` | 地面ごとの痕跡規則、スキャン判定、`TrampleField`（草の押し跡）、`RippleField`（波紋） |
| `src/world.js` | GLB 読込、BVH、`heightAt` / `surfaceAt` / `pick` |
| `src/grass.js` | インスタンス草と、曲げのシェーダ |
| `src/footprints.js` | 蹄跡の InstancedMesh（1 本ずつフェード） |
| `src/water.js` | 水面のシェーダと波紋シミュレーション |
| `src/props.js` | 低木の揺れ、枝が折れる処理 |
| `src/audio.js` | 手続き生成の効果音と HRTF での定位 |
| `src/player.js` | FPS 操作、地面への追従、幹との衝突 |
| `src/animalView.js` | Blender でリグを組んだ動物。真値から姿勢を付け、捕捉時にガラス表示 |
| `src/selftest.js` | ブラウザ内 E2E テスト |
| `assets/forest.glb` | 30 m 四方の地形、泥 ×5、水たまり ×3、木 ×26、低木 ×30、枝 ×22、岩 ×10 |
| `assets/animal.glb` | ローポリの鹿型動物（スキン、骨 17 本、Walk / Graze アニメーション） |
| `assets/props.glb` | 草のクランプ、蹄跡メッシュ |
| `blender/trace_v01.blend` | 上記を作った TRACE 専用シーン |
| `docs/research.md` | GitHub 技術調査レポート |
| `docs/licenses.md` | 使用ライセンス一覧 |
| `docs/test-results.md` | テスト結果と改善提案 |
| `docs/next-experiments.md` | 次の試作で検証する未知の現象 3 案 |

## Blender アセット（MCP for Blender で制作）
- Blender 4.4.3 に MCP for Blender（アドオン v1.8）で接続し、`execute_blender_code` から bpy/bmesh で全アセットを手続き的にモデリングした。アセットライブラリと 3D 生成機能は off だったので使っていない。
- 既存の `Scene` は変更せず、新規シーン `TRACE` を作成した。`.blend` には TRACE シーンだけを書き出した。
- 座標の対応: Blender (x, y, z) → three.js (x, z, −y)。動物は Blender の −Y を向いて作ってあるので、three.js では +Z を向く（Yuka の前方向と同じ）。
- GLB を作り直すときは、`blender/trace_v01.blend` を開いて TRACE シーンを選び、各コレクション（`TRACE_Forest` / `TRACE_Animal` / `TRACE_Props`）を選択して glTF 書き出しする（頂点カラーは `ACTIVE`、動物は NLA トラックでアニメーション書き出し）。

## サーバの起動オプション
- `npm start` / `npm run dev`: `127.0.0.1:5173` で待ち受ける（この PC からのみアクセス可）。
- `npm run dev -- --host 0.0.0.0`: LAN 内の別の端末からも `http://<この PC の IP>:5173/` で開ける（Windows ファイアウォールの許可が必要な場合がある）。
- Vite は使っていない。依存のない `server.mjs` が静的ファイルを配信するだけなので、ターミナルを閉じるとサーバも止まる。

## GitHub Pages への公開
```bash
npm run build:pages
```
`site/` に公開用の静的コピーができる（必要な vendor ファイルだけを `site/vendor/` にコピーし、importmap をそこへ向け直す。ソースの `index.html` は変更しない）。
`.github/workflows/pages.yml` が `main` への push ごとに テスト → ビルド → Pages 公開 を行う。リポジトリの Settings → Pages → Source を「GitHub Actions」にすると、`https://<ユーザー名>.github.io/<リポジトリ名>/` で開ける。

## テスト

```bash
npm test
```

```bash
node tests/inference.analysis.mjs
```

ブラウザでのテストは http://localhost:5173/?selftest=1&seed=42 を開く。結果は [docs/test-results.md](docs/test-results.md) にまとめた（ユニット 12/12、ブラウザ 9/9）。

## 既知の制限
- 人の手でのポインターロック試遊と、立体音響を実際に聴いての確認はまだしていない。
- 泥場の周りで待つと当てやすい（水飲み行動のせい）。対策案は docs/test-results.md の改善提案にある。
- 性能は Iris Xe・1024×768 で 1 フレーム約 24 ms（シミュレーション込み）。
