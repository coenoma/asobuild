# 公開チェックリスト（公開ボタンを押す日の関所）

編集の関所（[edit-checklist.md](./edit-checklist.md)）と映り込みの関所
（[safety-checklist.md](./safety-checklist.md)）を通ったあと、**公開の日にやること**。
ここの後半（固定コメント・逆リンク）が
**視聴→プレイ→コメントのループ**を作る。編集より効くことがあるので飛ばさない。

シーズン全体の狙いは [plans/007-first-season](../plans/007-first-season/design.md)。

## 前日まで

- [ ] `npm run ship` が green（ゲームを直したなら遊び直しまで）
- [ ] サムネ・タイトルが型どおり（[video-doctrine.md](./video-doctrine.md) §2。疑問形・結果を見せない）
- [ ] ショート3本を書き出し済み（`video/scripts/shorts.mjs`）
- [ ] 概要欄の文面を [テンプレ](./description-template.md) から作成（**UTM の ep 番号を今回のものに**）

## 公開したら、その場で（15分）

- [ ] **固定コメントを立てる**（テンプレの3問。①思い出 ②次のお題 ③最高記録）
- [ ] **`meta.video` に動画URLを書いてコミット＆プッシュ**
      （ゲームページに埋め込みが出る。サイト→動画の逆導線はこの1行で開通する）
- [ ] 概要欄の遊べるURLを実際に踏んで、UTM 付きで開くことを確認
- [ ] X で1投稿（[シードの下書き](../plans/007-first-season/seed-x.md)。001のみ Zenn 記事も同時に）

## 公開後

- [ ] ショートを翌日から1日1本ずつ出す（長尺への導線を概要欄とコメントに）
- [ ] **1週間後: コメントからスコア報告・リクエストを拾い、次回の冒頭素材と
      [お題の在庫](../plans/007-first-season/design.md) に足す**（リピーター製造機。ここがループの心臓）
- [ ] 週次レビューを [weekly.md](../plans/007-first-season/weekly.md) に1ブロック追記
