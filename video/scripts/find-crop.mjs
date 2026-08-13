#!/usr/bin/env node
/**
 * 寄りのcropを決めるための下見。指定した時刻に**方眼を重ねた1枚**を出す。
 *
 *   node scripts/find-crop.mjs screen 466            # 全体＋方眼
 *   node scripts/find-crop.mjs screen 466 0,780,960,440   # 切り出しの確認
 *
 * **なぜ要るか。** この番組でいちばん濃い画は「AIに投げた本文」「AIの返事」で、
 * それは**寄って止めないと読めない**（[edit-checklist.md](../../docs/video/edit-checklist.md) §2）。
 * 寄る位置を勘で決めると外すので、方眼を見てから数字を決める。
 *
 * 出た数字はそのまま EDL の crops に書ける:
 *   "termAdd": { "src": "screen", "x": 0, "y": 780, "w": 960, "h": 440 }
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const [srcName, timeStr, cropStr] = process.argv.slice(2);
if (!srcName || !timeStr) {
  console.error('使い方: node scripts/find-crop.mjs <screen|self> <秒> [x,y,w,h]');
  process.exit(1);
}

const edlPath = process.argv.includes('--edl')
  ? process.argv[process.argv.indexOf('--edl') + 1]
  : resolve(ROOT, 'edl', '001-nuimichi.json');
const edl = JSON.parse(readFileSync(edlPath, 'utf8'));
const src = edl.sources?.[srcName];
if (!src) {
  console.error(`sources に ${srcName} がありません（${Object.keys(edl.sources ?? {}).join(', ')}）`);
  process.exit(1);
}
const file = src.file.startsWith('~') ? resolve(homedir(), src.file.slice(2)) : src.file;

const outDir = resolve(ROOT, 'out/lookup');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `${srcName}_${timeStr}${cropStr ? `_${cropStr.replace(/,/g, '-')}` : ''}.png`);

const filters = [];
if (cropStr) {
  const [x, y, w, h] = cropStr.split(',').map(Number);
  filters.push(`crop=${w}:${h}:${x}:${y}`);
} else {
  // 100px ごとの薄い線＋500px ごとの濃い線。数字を読み取れるようにする
  filters.push('drawgrid=w=100:h=100:t=1:c=cyan@0.35');
  filters.push('drawgrid=w=500:h=500:t=2:c=yellow@0.7');
}

execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-ss', timeStr, '-i', file, '-frames:v', '1', '-vf', filters.join(','), out]);
console.log(`できた: ${out}`);
if (!cropStr) {
  console.log('方眼は 100px（水色）と 500px（黄）。読ませたい範囲の x,y,w,h を読み取って、');
  console.log('  node scripts/find-crop.mjs ' + srcName + ' ' + timeStr + ' <x,y,w,h>   で確認する');
}
