#!/usr/bin/env node
/**
 * ゲームオーバーの瞬間を見つけて、そのときの自撮りを並べる。
 *
 * なぜ要るか：
 *   遊んでいる間、撮られている人は**集中していて無表情**。
 *   顔が動くのは**ゲームオーバーの瞬間**で、そこだけがリアクションとして使える。
 *   2本の素材の開始時刻が分かっていれば、**探さずに機械で突き合わせられる**。
 *
 *   node scripts/reactions.mjs edl/001-nuimichi.json
 *   node scripts/reactions.mjs edl/001-nuimichi.json --frames   # コマ画像も出す
 *
 * リザルト画面の見つけ方：ゲーム画面の中央やや上に、大きな数字が accent 色で出る。
 * そこだけを小さく切り出して、黄色い画素が増えた瞬間を「死んだ時刻」とみなす。
 */

import { readFileSync, mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const edlPath = process.argv[2];
if (!edlPath) {
  console.error('使い方: node scripts/reactions.mjs edl/<slug>.json [--frames]');
  process.exit(1);
}
const edl = JSON.parse(readFileSync(resolve(process.cwd(), edlPath), 'utf8'));
const wantFrames = process.argv.includes('--frames');

const expand = (p) => (p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p);
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const screen = edl.sources.screen;
const self = edl.sources.self;
if (!screen || !self) {
  console.error('sources に screen と self の両方が要ります');
  process.exit(1);
}

/** 自撮りが画面収録より何秒早く回り始めたか */
const OFFSET = Math.round((Date.parse(screen.startedAt) - Date.parse(self.startedAt)) / 1000);
console.log(`自撮りは画面収録より ${OFFSET}秒（${mmss(OFFSET)}）早く回り始めている`);
console.log(`  自撮りの時刻 = 画面の時刻 + ${OFFSET}\n`);

// ゲーム画面の切り出しを EDL から借りる（自分で座標を持たない）
const game = edl.crops.game;
const W = 60, H = 76;
const BYTES = W * H * 3;

console.log('ゲーム画面を読み込み中（1秒に2コマ）…');
const frames = await new Promise((res, rej) => {
  const out = [];
  let buf = Buffer.alloc(0);
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-v', 'error', '-i', expand(screen.file),
    '-vf', `crop=${game.w}:${game.h}:${game.x}:${game.y},fps=2,scale=${W}:${H}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
  ff.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= BYTES) { out.push(buf.subarray(0, BYTES)); buf = buf.subarray(BYTES); }
  });
  ff.stderr.on('data', (d) => process.stderr.write(d));
  ff.on('close', (c) => (c === 0 ? res(out) : rej(new Error(`ffmpeg 終了コード ${c}`))));
});

/** リザルトの大きな数字（accent 色）が中央やや上にあるか */
function isResult(f) {
  let yellow = 0;
  for (let y = Math.floor(H * 0.25); y < Math.floor(H * 0.44); y++) {
    for (let x = Math.floor(W * 0.18); x < Math.floor(W * 0.82); x++) {
      const i = (y * W + x) * 3;
      const r = f[i], g = f[i + 1], b = f[i + 2];
      // 縮小と圧縮で色が鈍るので、しきい値はゆるめに取る
      if (r > 150 && g > 105 && b < 150 && r - b > 55) yellow++;
    }
  }
  return yellow >= 6;
}

const flags = frames.map(isResult);
// 「出ていない → 出た」に変わった瞬間が、死んだ時刻
const deaths = [];
for (let i = 1; i < flags.length; i++) {
  if (flags[i] && !flags[i - 1]) {
    const at = i / 2;
    if (!deaths.length || at - deaths[deaths.length - 1] > 6) deaths.push(at);
  }
}

const selfLen = 2808; // 自撮りの尺は下で実測して上書きする
let selfDur = selfLen;
try {
  selfDur = Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', expand(self.file),
  ]).toString().trim());
} catch { /* 取れなければ既定値のまま */ }

console.log(`\nゲームオーバー ${deaths.length}回\n`);
console.log('  画面      自撮り     自撮りに写っているか');
console.log('  ────────────────────────────────────');
const usable = [];
for (const d of deaths) {
  const s = d + OFFSET;
  const ok = s + 8 <= selfDur;
  if (ok) usable.push({ screen: d, self: s });
  console.log(`  ${mmss(d)}     ${mmss(s)}      ${ok ? '○' : '× 自撮りが終わっている'}`);
}

console.log(`\n使えるリアクション ${usable.length}件。`);
console.log('**遊んでいる間は無表情。顔が動くのはここだけ**なので、優先して見ること。');

if (wantFrames && usable.length) {
  const dir = resolve('out/reactions');
  mkdirSync(dir, { recursive: true });
  console.log(`\nコマ画像 → ${dir}`);
  for (const u of usable) {
    for (const off of [1, 3, 5, 7]) {
      execFileSync('ffmpeg', [
        '-hide_banner', '-v', 'error', '-y', '-ss', String(u.self + off), '-i', expand(self.file),
        '-frames:v', '1', '-vf', 'scale=280:-2',
        resolve(dir, `self${Math.round(u.self)}_+${off}s.jpg`),
      ]);
    }
  }
  console.log('良かったものは docs/episodes/<slug>/footage-notes.md に時刻つきで書き写すこと。');
}
