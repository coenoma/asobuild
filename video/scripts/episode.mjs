#!/usr/bin/env node
/**
 * 回ごとのコマンドを、slug から組み立てて実行する。
 *
 *   node scripts/episode.mjs studio [slug]   # 音つきで見ながら直す
 *   node scripts/episode.mjs draft  [slug]   # 下書き画質で通して見る（半分）
 *   node scripts/episode.mjs build  [slug]   # 本番画質で書き出す → master まで
 *   node scripts/episode.mjs prep   [slug]   # 声とBGMを public へ用意するだけ
 *
 * slug を省くと edl/ の**いちばん新しい回**（連番の最大）を使う。
 * これで package.json から 001 決め打ちが消え、回が増えても何も書き換えない。
 *
 * コンポジション id は Root.tsx と同じ規則 `Episode-<slug>`。
 */

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const EDL_DIR = resolve(ROOT, 'edl');

const mode = process.argv[2];
const MODES = ['studio', 'draft', 'build', 'prep'];
if (!MODES.includes(mode)) {
  console.error(`使い方: node scripts/episode.mjs <${MODES.join('|')}> [slug]`);
  process.exit(1);
}

/** 連番始まりの回だけを新しい順に。作業ファイル（_始まり）は無視 */
function episodeSlugs() {
  return readdirSync(EDL_DIR)
    .filter((f) => /^\d.*\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort()
    .reverse();
}

const slug = process.argv[3] ?? episodeSlugs()[0];
if (!slug) {
  console.error('edl/ に回（連番始まりの .json）がありません');
  process.exit(1);
}
const edlPath = `edl/${slug}.json`;
const comp = `Episode-${slug}`;

function run(cmd, args) {
  console.log(`▶ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 声とBGMを public へ（studio でも書き出しでも先に要る）
run('node', ['scripts/prep-audio.mjs', edlPath]);
if (mode === 'prep') process.exit(0);

if (mode === 'studio') {
  run('npx', ['remotion', 'studio', 'src/index.ts', '--public-dir=public']);
} else if (mode === 'draft') {
  run('npx', ['remotion', 'render', 'src/index.ts', comp, `out/${slug}-draft.mp4`,
    '--public-dir=public', '--concurrency=3', '--scale=0.5', '--crf=32']);
} else if (mode === 'build') {
  const out = `out/${slug}.mp4`;
  run('npx', ['remotion', 'render', 'src/index.ts', comp, out,
    '--public-dir=public', '--concurrency=3']);
  run('node', ['scripts/master.mjs', out]);
}
