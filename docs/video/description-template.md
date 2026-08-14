# 概要欄と固定コメントのテンプレ

**毎回この型のまま使う**（型の反復が「また来た」を作る）。`{}` を差し替えるだけ。
声の決まりは [voice-and-script.md](./voice-and-script.md)（ぼく・ですます・断言しない）。

## UTM の決まり

どの動画から遊びに来たかを分けるための飾り。**リンクを貼る場所ごとに medium を変える**。

```
https://asobuild.coenoma.com/g/{slug}?utm_source=youtube&utm_medium={場所}&utm_campaign=ep{番号}-{slug}
```

| 貼る場所 | utm_medium |
|---|---|
| 概要欄 | `description` |
| 固定コメント | `pinned` |
| ショートのコメント | `shorts` |

例: `?utm_source=youtube&utm_medium=description&utm_campaign=ep001-nuimichi`

## 概要欄

```
{制約}で、AIに「{題材}みたいなゲーム作って」って頼んでみました。
コードはぼくは1文字も書いていません。

▶ できたものは、いま遊べます（無料・登録なし・スマホOK）
https://asobuild.coenoma.com/g/{slug}?utm_source=youtube&utm_medium=description&utm_campaign=ep{番号}-{slug}

▶ やりとりの全部（コードも指示も）はここに公開しています
https://github.com/coenoma/asobuild

🙏 コメントで教えてください
・次にAIに作らせたいゲーム（次回のお題はここから選びます）
・あなたの最高記録（リザルトの「おだいURL」を貼ると、同じ出方で勝負できます）

{チャプター}

#AI #ゲーム制作 #ClaudeCode
```

- 題材名は必ず「みたいな」「風」を挟む（[safety-checklist.md](./safety-checklist.md) §3）
- チャプターは EDL の章から。無理に作らない（4:39 の動画に7個も要らない）

## 固定コメント（公開したらすぐ立てる）

```
見てくれてありがとうございます。3つ聞かせてください。

① あなたの思い出のガラケーゲーム・Flashゲームは何でしたか？
② 次にAIに作らせたいゲームは？（マジで次回のお題にします）
③ このゲームの最高記録は？ → いま遊べます:
https://asobuild.coenoma.com/g/{slug}?utm_source=youtube&utm_medium=pinned&utm_campaign=ep{番号}-{slug}
```

- ①が同窓会を作り、②が次回のお題在庫を作り、③が「戻ってくる理由」を作る
  （3つとも実測の裏付けあり: [research-notes](./research-notes/2026-08-13-youtube.md)）
- 返信は全部にしなくてよい。**②を採用したときは必ず返信**（採用ループが見えると次が来る）
