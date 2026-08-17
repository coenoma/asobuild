#!/usr/bin/env node
/**
 * 🚫 廃止（2026-08-17）。素材の等分チョップは2026年のショート環境に全敗した。
 * いまは レシピ式（edl/shorts/*.json → prep-shorts.mjs → Remotion の Short-* コンポジション）。
 * 作法と最低品質の関所: docs/video/shorts.md
 *
 * ショート（縦 1080×1920）を素材から切り出す。**毎回3本**が目安。
 *
 *   node scripts/shorts.mjs edl/001-nuimichi.json <クリップ名> [--from 秒] [--dur 秒] \
 *     [--top "上の文字"] [--bottom "下の文字"]
 *
 *   例（この3種類を毎回作る）:
 *     事故の瞬間   … --top "AIに雑に頼んだら" --bottom "1回当たったら、おわり"
 *     記録更新     … --top "ソイラテ1杯で作ったゲーム" --bottom "じこベスト 560点"
 *     制約の現物   … 飲み干した瞬間など、ゲーム画面以外でもよい
 *
 * なぜ要るか: 縦のゲーム画面はショートと相性がよく、
 * 発見の入口がショートフィードだった実例がある（docs/video/research-notes/）。
 * ゲームの切り出しは音が無いので、ゲームと同じ矩形波の音を後で足すか、無音のまま出す。
 *
 * 文字の焼き込みは drawtext（書体は fonts.mjs が取ってきた Noto Sans JP）。
 * 色・言い回しは telop-rules.md に従う（ここでは ink と accent だけ使う）。
 */

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FONT = resolve(ROOT, 'public/fonts/NotoSansJP.ttf');

const [edlPath, clipId] = process.argv.slice(2);
if (!edlPath || !clipId) {
  console.error('使い方: node scripts/shorts.mjs edl/<slug>.json <クリップ名> [--from 秒] [--dur 秒] [--top 文字] [--bottom 文字]');
  process.exit(1);
}
const edl = JSON.parse(readFileSync(resolve(process.cwd(), edlPath), 'utf8'));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

const src = resolve(ROOT, 'public/footage', `${clipId}.mp4`);
if (!existsSync(src)) {
  console.error(`素材がありません: ${src}（先に extract.mjs で切り出す）`);
  process.exit(1);
}
if (!existsSync(FONT)) {
  console.error('書体がありません。先に node scripts/fonts.mjs');
  process.exit(1);
}

const from = Number(arg('from', '0'));
const dur = Number(arg('dur', '15'));
const top = arg('top', '');
const bottom = arg('bottom', '');

const esc = (t) => t.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%');

// 1080×1920 の中に素材を幅いっぱいで置き、余白は盤面と同じ色で埋める
const filters = [
  'scale=1080:-2',
  'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:0x101820',
];
if (top) {
  filters.push(
    `drawtext=fontfile=${FONT}:text='${esc(top)}':x=(w-text_w)/2:y=170:fontsize=64:fontcolor=0xe9f1e4:box=1:boxcolor=0x101820@0.93:boxborderw=22`,
  );
}
if (bottom) {
  filters.push(
    `drawtext=fontfile=${FONT}:text='${esc(bottom)}':x=(w-text_w)/2:y=h-320:fontsize=72:fontcolor=0xffd23f:box=1:boxcolor=0x101820@0.93:boxborderw=24`,
  );
}

const outDir = resolve(ROOT, 'out/shorts');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, `${edl.meta.slug}_${clipId}_${from}s.mp4`);

execFileSync('ffmpeg', [
  '-hide_banner', '-v', 'error', '-y',
  '-ss', String(from), '-t', String(dur), '-i', src,
  '-vf', filters.join(','),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  out,
]);
console.log(`きった: ${out}`);
console.log('概要欄に本編のリンクを置くこと（ショートは入口。本編とゲームURLへ流す）。');
