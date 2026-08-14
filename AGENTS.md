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
| 効く工夫のカタログ | [docs/design/feel-catalog.md](./docs/design/feel-catalog.md) |
| **既存作を題材にするときの型（記憶から作る）** | [docs/design/memory-first.md](./docs/design/memory-first.md) |
| 権利の線引き | [docs/design/rights-and-originality.md](./docs/design/rights-and-originality.md) |
| 既存作の調査のやり方 | [docs/research/README.md](./docs/research/README.md) |
| 開発の始め方 | [docs/guides/はじめかた.md](./docs/guides/はじめかた.md) |
| **収録して YouTube に出す段取り** | [.claude/skills/recording/SKILL.md](./.claude/skills/recording/SKILL.md) |
| **撮った素材を1本の動画に組み立てる** | [docs/video/README.md](./docs/video/README.md) |
| 動画の原則（誰に・どう見せるか） | [docs/video/video-doctrine.md](./docs/video/video-doctrine.md) |
| **構成を相談する（絵コンテ）** | [docs/video/storyboards/](./docs/video/storyboards/) |
| 映り込みと権利（出す前に必ず通す） | [docs/video/safety-checklist.md](./docs/video/safety-checklist.md) |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
