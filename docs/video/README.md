# 動画をつくる

**このリポジトリは「動くものを作る」だけでは終わらない。**
撮った素材を、遊んでいない人が最後まで見る1本に組み立てるところまでが仕事。

ゲーム側に [面白さの原則](../design/fun-doctrine.md) と [面白さゲート](../../scripts/fun-check.ts) があるのと同じで、
動画側にも**毎回考え直さないための決まり**と**機械で通す関所**を置いてある。

---

## 読む順番

| | 何が書いてあるか | いつ読むか |
|---|---|---|
| [video-doctrine.md](./video-doctrine.md) | 誰に、どんな気持ちで見てもらうか。売っているものは何か | **企画の前に必ず** |
| [structure.md](./structure.md) | 章立ては固定しない。心情の流れが構成になる | 編集を始めるとき |
| [telop-rules.md](./telop-rules.md) | 色・書体・大きさ・言い回し・効果音 | テロップを書くとき |
| [voice-and-script.md](./voice-and-script.md) | **台本の声（ゆとの喋りかた）。原稿を書く前に** | ナレーション原稿を書くとき |
| [sound-design.md](./sound-design.md) | **音の設計。どの音が何を意味するか。音源は外から持ってこない** | 音を足すとき |
| [edit-checklist.md](./edit-checklist.md) | **編集の関所。出す前に必ず通す**（タイミング・可読性・テロップ・ワイプ・締め） | 書き出す前 |
| [research-notes/](./research-notes/) | 外部調査の精査記録（何を採り、何を外れ値と判断したか） | 企画・型を見直すとき |
| [safety-checklist.md](./safety-checklist.md) | 映り込みと権利。**出す前に必ず通す** | 書き出す前 |
| [storyboards/](./storyboards/) | **回ごとの絵コンテ（構成表）。EDLから生成** | **構成を相談するとき** |
| [footage-notes/](./footage-notes/) | **回ごとの素材の見どころ。「ここ使いたい」を貯める** | **編集を始める前に必ず** |
| [scripts/](./scripts/) | 回ごとのアテレコ用メモ | 収録を頼むとき |

撮るときの段取りは [recording スキル](../../.claude/skills/recording/SKILL.md)、
番組としての決めごとは [収録レギュレーション](../guides/収録レギュレーション.md)。

---

## 1本つくる手順

道具は [`video/`](../../video/) にある（Remotion）。**編集の中身はコードではなく `video/edl/*.json` にある。**

```bash
cd video
npm install
node scripts/fonts.mjs                    # 書体（1回だけ）
node scripts/sfx.mjs                      # 効果音（ゲームと同じ音源から作る）

# ① 映り込みを機械で洗い出す
node scripts/scan-risk.mjs ~/path/画面収録.mov --contact

# ② 開発ログを動画の時刻に直す（何分何秒に何が起きたか）
node scripts/timeline.mjs --rec-start "2026-08-12T16:32:09+09:00"

# ③ edl/<slug>.json を書く（唯一の手作業）
# ④ 必要な区間だけ切り出す（尺の検査もここで通る）
node scripts/extract.mjs edl/<slug>.json

# ⑤ 絵コンテを出して、構成を相談する
node scripts/storyboard.mjs edl/<slug>.json > ../docs/video/storyboards/<slug>.md

# ⑥ 見ながら直す
npx remotion studio

# ⑦ 書き出す
npx remotion render src/index.ts Episode out/<slug>.mp4

# ⑧ 確認用の声（VOICEVOX）を乗せる。本命の声も同じコマンド
docker run -d --rm --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-latest
node scripts/voice.mjs edl/<slug>.json --synth
node scripts/voice.mjs edl/<slug>.json --mux     # → out/<slug>-voiced.mp4
```

### 素材の開始時刻を実測する

**`creation_time` を信じない。** 画面収録のそれはファイルが確定した時刻で、撮り始めではない。

```bash
# メニューバーの時計を切り出して、目で読む
ffmpeg -ss 1 -i 画面収録.mov -frames:v 1 -vf "crop=400:60:2160:0,scale=800:120" clock.png
```

自撮り（iPhone）は `com.apple.quicktime.creationdate` が**撮り始め**なので、そのまま使える。

```bash
ffprobe -v error -show_format 自撮り.MOV | grep creationdate
```

この2つが分かれば、**2本の素材は秒単位で噛み合う**。
ゲームオーバーの瞬間を目で探して合わせる必要はない。

---

## 設計の考え方（なぜこの形か）

### 見た目の変遷は `.live/shots/` に貯まっている

収録中に `npm run fun` が走るたび、**そのときのゲームの見た目が1枚**保存されている
（`scripts/snap.ts`。ファイル名とindex.jsonl に時刻入り）。
「白い四角 → 針と糸」のような変遷を画面収録から探さなくても、ここから並べられる。

```bash
ls .live/shots/            # 時刻順に並ぶ
cat .live/shots/index.jsonl  # t（エポックms）と slug と score
```

時刻から `t/1000 - 画面収録の開始エポック秒 = 動画の時刻`。git管理外なので、動画を作ったら消してよい。

### 「ここ使いたい」は、その場で消える

撮った本人が言う「あそこ良かった」「この自撮り入れたい」は、
**チャットで言われたら、そこで消える。** 編集は何度も直すし、別のセッションが続きをやることもある。

だから [footage-notes/](./footage-notes/) に時刻つきで貯める。

- **使う／使わないは EDL 側で決める。** こちらは在庫であって編集台本ではない
- **使ったものも消さない。** 切り抜きや次のブラッシュアップで効く
- 使わないと決めたもの（映り込み・権利）も理由つきで書く

**編集を始める前に必ず読む。** 無いまま始めると、同じ発見を毎回やり直すことになる。

### 構成の相談は、絵コンテでやる

映像を見て相談すると、書き出しに20〜30分かかるので往復が重い。
**EDL から絵コンテ（マークダウンの表）を生成**して、まずそこで詰める。

```bash
node scripts/storyboard.mjs edl/<slug>.json > ../docs/video/storyboards/<slug>.md
```

各行に `[章-番号]` がつくので、**「3-2 の言い回しを変えたい」と番号で指せる**。

**手で書き写さない。** 構成表を別に持つと、EDL を直したときに必ずズレる。
ズレた構成表は、無いより悪い（それを見て相談してしまうので）。

### 編集はデータに置く

`edl/*.json` に「何をどの順で出すか」を、コードに「どう描くか」を置いてある。

- **ナレーションは後から乗せる。** 声が上がってきたら章の尺を調整して描き直す
- テロップは画面に映っている事実だけを書くので、**喋りが変わっても作り直さなくてよい**
- 次の回はコードを触らず、EDL を1つ足すだけ

### テロップの文言は開発ログから引く

`.live/status.jsonl` に、ゲートの合否も落ちた項目名もカンペの一言も、
**絶対時刻つきで全部残っている**。手で書き写すと必ずずれるので引いてくる。

### 効果音はゲームと同じ音源で作る

[src/arcade/sfx.ts](../../src/arcade/sfx.ts) の矩形波シンセを Node に移して WAV を書き出している
（`video/scripts/sfx.mjs`）。**外から持ってくると、そこだけ音の質感が変わって浮く。**

### 色と書体はサイトと揃える

色は [palette.ts](../../src/arcade/palette.ts) の `keitai` そのまま、書体はサイトと同じ Noto Sans JP。
**揃っていること自体がチャンネルの記号になる。**

---

## 置かないもの

`video/` は PUBLIC リポジトリの一部なので、次は git に入れない（`.gitignore` 済み）。

- 元素材・切り出した素材（`public/footage/`）
- 効果音（`public/sfx/`）— `scripts/sfx.mjs` で作れる
- 書体（`public/fonts/`）— `scripts/fonts.mjs` で取れる
- 書き出した動画（`out/`）

**取ってこられるもの・作れるものは抱えない。**

---

## これまでの回

| # | 回 | 尺 | 制約 | 構成 | アテレコ用メモ |
|---|---|---|---|---|---|
| 001 | ぬいみち | 7:00 | ソイラテ1杯 | [絵コンテ](./storyboards/001-nuimichi.md) ／ [見どころ](./footage-notes/001-nuimichi.md) | [001-nuimichi.md](./scripts/001-nuimichi.md) |
