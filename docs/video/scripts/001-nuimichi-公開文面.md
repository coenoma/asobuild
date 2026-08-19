# 001 ぬいみち ── 公開の文面

型は [description-template.md](../description-template.md) のまま。`{}` を埋めたもの。
**アテレコの実際の言葉から拾ってある**（言っていないことは書かない）。

---

## タイトル（推し）

```
AIにガラケー最強ゲーム"糸通し"みたいなのを作ってと言ったら…
```

（オーナー決定 2026-08-17。「ガラケー最強ゲーム」のフレームで題材を盛る。
制約〈ソイラテ〉はサムネが担う分担）

次点:

- `AIに「糸通しみたいなゲーム作って」って雑に頼んでみた`
- `【AIだけ】ソイラテを飲み終わるまでにゲームは完成するのか`

---

## 概要欄

```
スタバのソイラテ（トール）1杯を飲み終わるまでに、
AIに「懐かしの糸通しみたいなゲーム作って」って頼んでみました。
コードはぼくは1文字も書いていません。

▶ できたものは、いま遊べます（無料・登録なし・スマホOK）
https://asobuild.coenoma.com/g/nuimichi?utm_source=youtube&utm_medium=description&utm_campaign=ep001-nuimichi

▶ やりとりの全部（コードも指示も）はここに公開しています
https://github.com/coenoma/asobuild

🙏 コメントで教えてください
・次にAIに作らせたいゲーム（次回のお題はここから選びます）
・あなたの最高記録（ぼくは560点でした）

0:00 これ、糸通し？
0:04 ソイラテ1杯ぶんで、できるのか
0:23 覚えてることを全部投げる
2:04 糸通しって、覚えてます？
3:02 11分たっても、コードは1行も出てこない
3:55 15分。なんか出てきた
5:08 タイムアップ
5:38 ここからブラッシュアップ
7:11 これ、ハマるやつだ
8:17 49分。結論
9:45 あそんでみてください

使ったAI: Claude Code
音楽: JTLXq

#AI #ゲーム制作 #ClaudeCode #レトロゲーム
```

---

## 固定コメント（公開したらすぐ立てる）

```
見てくれてありがとうございます。3つ聞かせてください。

① あなたの思い出のガラケーゲームは何でしたか？
② 次にAIに作らせたいゲームは？（マジで次回のお題にします）
③ このゲームの最高記録は？ → いま遊べます:
https://asobuild.coenoma.com/g/nuimichi?utm_source=youtube&utm_medium=pinned&utm_campaign=ep001-nuimichi

ぼくの自己ベストは560点です。抜かれたら悔しいので、抜いてください。
```

---

## ショートの固定コメント（3本共通。公開したらすぐ立てる）

ショートは概要欄が読まれないので、**URLはコメント欄で渡す**（CTAでもそう言っている）。

```
🎮 このゲーム、いま無料で遊べます（登録なし・スマホOK）
https://asobuild.coenoma.com/g/nuimichi?utm_source=youtube&utm_medium=shorts&utm_campaign=ep001-nuimichi

ぼくの自己ベストは560点。何点いけたか、このコメントに返信で教えてください。
作った過程ぜんぶは本編で → チャンネル「アソビルド」
```

---

## ショートのA/Bテスト（2026-08-18 設計）

ショート→本編の直接遷移は構造的に少ない（視聴者重複〜10%）。その前提で、締めのCTA 2型を比べる。

| 本 | 型 | CTA |
|---|---|---|
| S2 あ、終わった | **本編誘導型** | つづきは本編へ！／**化けたあとは 7:11 から。そこだけでも**（量を相手に委ね、瞬間を指す） |
| S3 560点 | **行動型** | URLはコメント欄に！／560点こえたら、自慢して |
| S4 まるごと49分 | **構成の実験（本編まるごと圧縮・27秒）** | フルは本編で！／遊べるURLはコメント欄に |

S4 は CTA でなく**構成そのもののテスト**（切り抜き型 S1〜S3 に対する、物語まるごと圧縮型）。
完走率と本編流入を S1〜S3 と比べる。

- 固定コメントのURLは `utm_content` で本ごとに刻む（下記）。1〜2日おきに公開
- 見る数字（公開72時間後）: ①本編のトラフィックソース「ショート」経由の流入 ②登録/1000ショート再生 ③ゲームURLのクリック（utm_content 別） ④完走率・リプレイ率
- 勝った型を docs/video/shorts.md の文法6の既定にする

```
S2用固定コメントURL:
https://asobuild.coenoma.com/g/nuimichi?utm_source=youtube&utm_medium=shorts&utm_campaign=ep001-nuimichi&utm_content=s2-owatta

S2の固定コメントには本編の 7:11 直リンクも添える（化けたあとへ一発で飛べる）:
https://youtu.be/<本編のID>?t=431


S3用固定コメントURL:
https://asobuild.coenoma.com/g/nuimichi?utm_source=youtube&utm_medium=shorts&utm_campaign=ep001-nuimichi&utm_content=s3-hamaru

S4用固定コメントURL:
https://asobuild.coenoma.com/g/nuimichi?utm_source=youtube&utm_medium=shorts&utm_campaign=ep001-nuimichi&utm_content=s4-marugoto
```

---

## サムネの文言（実際に喋った言葉から）

| 案 | 大きい言葉 | 上の条件 |
|---|---|---|
| A（推し） | `作れるのか` | `ソイラテ1杯で` |
| B | `なにこれ` | `AIが15分で` |
| C | `意外とやれる` | `雑に頼んだら` |

B の「なにこれ」は本編の「四角と丸で謎の物体がシュールだな」から、
C の「意外とやれる」は「意外とやれるんじゃないですかね」からそのまま。

```bash
cd video
npx remotion still src/index.ts Thumbnail-A out/thumb-A.png
```

---

## 出す前に

- [ ] [publish-checklist.md](../publish-checklist.md) を通す
- [ ] **概要欄に曲のクレジット（JTLXq）**が入っている
- [ ] サイト側の `meta.video` に動画URLを入れる（サイト→動画の逆導線）
