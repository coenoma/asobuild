# video — 動画を組み立てる器

**編集の中身はコードではなく [`edl/*.json`](./edl/) にある。**
ここ（`src/`）にあるのは「どう描くか」だけで、「何をどの順で出すか」は EDL が持つ。

なぜこの形かと、実際の作り方は [docs/video/](../docs/video/) を読むこと。
とくに **[video-doctrine.md](../docs/video/video-doctrine.md) は企画の前に必ず**。

---

## はじめて動かすとき

```bash
npm install
node scripts/fonts.mjs     # 書体を取ってくる（9MB・1回だけ）
node scripts/sfx.mjs       # 効果音を作る（ゲームと同じ矩形波シンセ）
```

素材（`public/footage/`）・効果音・書体・書き出し（`out/`）は **git に入れない**。
取ってこられるもの・作れるものは抱えない方針。

## 1本つくる

```bash
node scripts/scan-risk.mjs <画面収録.mov> --contact         # 映り込みを洗い出す
node scripts/timeline.mjs --rec-start "<ISO8601>"           # 開発ログを動画の時刻へ
$EDITOR edl/<slug>.json                                      # ここだけ手で書く
node scripts/extract.mjs edl/<slug>.json                     # 必要な区間だけ切り出す
npx remotion studio                                          # 見ながら直す
npx remotion render src/index.ts Episode out/<slug>.mp4      # 書き出す
```

`extract.mjs` は切り出す前に EDL を検査する（尺のはみ出し・素材の長さ不足・効果音名）。
**描画してから気づくと1時間むだになる**ので、ここで止める。

---

## ファイルの役割

| | |
|---|---|
| `edl/*.json` | **編集台本。手で書くのはここだけ** |
| `src/types.ts` | EDL の形。レイヤーを増やすときはここから |
| `src/brand.ts` | 色・大きさ。[palette.ts](../src/arcade/palette.ts) の写し。**新しい色を作らない** |
| `src/Episode.tsx` | EDL を読んで章とレイヤーを並べる |
| `src/components/Shot.tsx` | 素材を出す。寄り・枠・見せる位置 |
| `src/components/Telop.tsx` | テロップ |
| `src/components/Gate.tsx` | 面白さゲートの結果（この番組にしかない絵） |
| `src/components/Checklist.tsx` | 確かめた／確かめていない。毎回ここで終わる |
| `src/components/Diagram.tsx` | 自作の図解。**下敷きにした作品の画は1コマも使えない** |
| `src/components/ProgramBar.tsx` | 上端の帯。制約の残量と開発の経過 |
| `scripts/timeline.mjs` | `.live/status.jsonl` → 画面収録の時刻 |
| `scripts/extract.mjs` | EDL の検査＋素材の切り出し |
| `scripts/scan-risk.mjs` | 映り込みの候補出し |
| `scripts/sfx.mjs` | 効果音の生成（[sfx.ts](../src/arcade/sfx.ts) と同じ音） |
| `scripts/fonts.mjs` | 書体の取得 |

---

## つまずいたところ（同じことを繰り返さないために）

| 症状 | 原因と対処 |
|---|---|
| 描画が始まらず落ちる | **`delayRender` をモジュールの外側で呼んだ**。書体の読み込みは必ずコンポーネントの中で |
| 日本語が出ない | `@remotion/google-fonts` の日本語は番号つきの細切れで、`subsets: ['japanese']` は通らない。`scripts/fonts.mjs` で1ファイル持つ |
| 読ませたい行が枠に入らない | 縦長の素材を横長の枠に `cover` で入れると大半が枠外に出る。**`origin` で見せる位置を決める** |
| 最後の数秒が黒い | 素材が編集より短い。`extract.mjs` の検査で止まるようにしてある |
| カードの下の文字と重なって読めない | `Scrim` を敷く。ぼかしは使わない（暗くするだけ） |
| 変換候補・通知が映り込む | 切り出しの位置で避ける。ぼかしで隠さない（[safety-checklist.md](../docs/video/safety-checklist.md)） |

## メモリ

本描画はヘッドレス Chromium を並列で回すので重い。`remotion.config.ts` で並列を 3 に落としてある。
**本描画は単独で走らせる**こと（他のビルドやテストと同時に回さない）。
