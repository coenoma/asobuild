# AGENTS.md

このリポジトリの規範は **[CLAUDE.md](./CLAUDE.md)** にまとめてあります。
Claude Code 以外のツール（Cursor / Codex など）を使う場合も、同じ内容に従ってください。

内容を二重に持つと必ず片方が腐るので、ここにはリンクだけを置いています。

**この番組は開発している画面そのものが本編です。** 動くものを作るだけでは終わりません。
長い作業に入る前に `npm run say -- "いま何をしているか"` でカンペへ流してください
（無言の時間が動画の敵。詳細は下の「収録」）。

| 知りたいこと | 場所 |
|---|---|
| 守るべき規範（全体） | [CLAUDE.md](./CLAUDE.md) |
| どの型で作るか（面白さゲートの見る項目が変わる） | [docs/design/genre-map.md](./docs/design/genre-map.md) |
| **どの機種で作るか**（ケータイ／PCブラウザ／ゲーセン。寸法・入力が変わる） | [docs/design/platforms.md](./docs/design/platforms.md) |
| ゲーム実装の規約 | [.claude/rules/games.md](./.claude/rules/games.md) |
| 共通ランタイムを触るときの注意 | [.claude/rules/arcade.md](./.claude/rules/arcade.md) |
| サイト側の規約 | [.claude/rules/web.md](./.claude/rules/web.md) |
| 面白さの原則（作る前に読む） | [docs/design/fun-doctrine.md](./docs/design/fun-doctrine.md) |
| 2005年前後の空気（時代背景・価値観・流行の材料庫） | [docs/design/era-2005.md](./docs/design/era-2005.md) |
| 懐かしさのヒキの採点・体験再現ものの設計 | [docs/design/nostalgia-hooks.md](./docs/design/nostalgia-hooks.md) |
| **看板の外のジャンル**（心理・クイズ・恋愛・日常・雑学）の地図と罠・平成風にするかの判断 | [docs/design/genre-crossover.md](./docs/design/genre-crossover.md) |
| **番組の企画フォーマット**（IT実験側の型・asobuild に載る/載らないの分け方・やらないこと） | [docs/video/formats.md](./docs/video/formats.md) |
| **oneshot（診断・クイズ・判定もの）の作り方** | [docs/design/oneshot-playbook.md](./docs/design/oneshot-playbook.md) |
| 効く工夫のカタログ | [docs/design/feel-catalog.md](./docs/design/feel-catalog.md) |
| **既存作を題材にするときの型（記憶から作る）** | [docs/design/memory-first.md](./docs/design/memory-first.md) |
| 権利の線引き | [docs/design/rights-and-originality.md](./docs/design/rights-and-originality.md) |
| 既存作の調査のやり方 | [docs/research/README.md](./docs/research/README.md) |
| 開発の始め方 | [docs/guides/はじめかた.md](./docs/guides/はじめかた.md) |
| **収録して YouTube に出す段取り** | [.claude/skills/recording/SKILL.md](./.claude/skills/recording/SKILL.md) |
| **撮った素材を1本の動画に組み立てる** | [docs/video/README.md](./docs/video/README.md) |
| **アテレコ（本命の声）と、声に映像を合わせ直す** | [docs/video/atereco.md](./docs/video/atereco.md) |
| **編集の関所（出す前に必ず通す）** | [docs/video/edit-checklist.md](./docs/video/edit-checklist.md) |
| 音の設計（どの音が何を意味するか・BGM） | [docs/video/sound-design.md](./docs/video/sound-design.md) |
| **公開ボタンを押す日の段取り**（概要欄・固定コメント・逆リンク） | [docs/video/publish-checklist.md](./docs/video/publish-checklist.md) |
| シーズン計画・成功の定義・週次レビュー | [docs/plans/007-first-season/design.md](./docs/plans/007-first-season/design.md) |
| 動画の原則（誰に・どう見せるか） | [docs/video/video-doctrine.md](./docs/video/video-doctrine.md) |
| **構成を相談する（絵コンテ）** | [docs/video/storyboards/](./docs/video/storyboards/) |
| 映り込みと権利（出す前に必ず通す） | [docs/video/safety-checklist.md](./docs/video/safety-checklist.md) |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
