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
| [structure.md](./structure.md) | 7分の型（11章）。素材をここに流し込む | 編集を始めるとき |
| [telop-rules.md](./telop-rules.md) | 色・書体・大きさ・言い回し・効果音 | テロップを書くとき |
| [safety-checklist.md](./safety-checklist.md) | 映り込みと権利。**出す前に必ず通す** | 書き出す前 |
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

# ⑤ 見ながら直す
npx remotion studio

# ⑥ 書き出す
npx remotion render src/index.ts Episode out/<slug>.mp4
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

| # | 回 | 尺 | 制約 | アテレコ用メモ |
|---|---|---|---|---|
| 001 | ぬいみち | 7:00 | ソイラテ1杯 | [001-nuimichi.md](./scripts/001-nuimichi.md) |
