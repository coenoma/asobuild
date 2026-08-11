---
paths:
  - "src/app/**"
---

# サイト側の規約

## ゲーム本体を直接 import しない

一覧ページやメタデータ生成から `games/<slug>/game` を読むと、
**ゲームが増えるたびにトップページが重くなる**。

- メタ情報は `@/games/registry` の `metas` / `sortedMetas()` / `findMeta()` から取る
- ゲーム本体は `GameLoader`（クライアント側の遅延読み込み）からのみ読む

## サーバーコンポーネントを既定にする

`'use client'` を書くのは、Canvas とブラウザ入力を扱う場所だけ。
一覧・メタデータ・静的な説明文はサーバー側のままにする。

## スタイル

- CSS Modules（`*.module.css`）。Tailwind もCSS-in-JSも入れない
- 色は `globals.css` の CSS 変数を使う（`var(--accent)` など）
- ゲーム画面の中の色は Canvas 側のパレット（`src/arcade/palette.ts`）で、別系統。混ぜない

## 端末での操作を壊さない

ゲーム画面は `touch-action: none` と `user-select: none` が必須。
ここを外すと、スマホで遊んだときにスクロールや文字選択が発生して操作にならない。
