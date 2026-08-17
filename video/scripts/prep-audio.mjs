#!/usr/bin/env node
/**
 * 声とBGMを、**描画に混ぜられる場所へ置く**。
 *
 *   node scripts/prep-audio.mjs edl/<slug>.json
 *
 * なぜ要るか。以前は「描画してから ffmpeg で声を混ぜる」2工程だったので、
 * **Remotion Studio で見ても無音**だった。いちばん確認したい「声と画の合い方」が
 * ブラウザで見られず、毎回30分の書き出しを待つしかなかった（001のFB）。
 *
 * 声もBGMも `public/` に置いて合成へ入れれば、
 *  - Studio で**音つきのまま**スクラブできる（直したら即反映）
 *  - 書き出しが**1工程**で終わる（混ぜる工程が要らない）
 *
 * 大きさは「頂点を何dBにするか」で決める（docs/video/sound-design.md）。
 * 元の音量はまちまちなので、ここで実測して**必要なゲインをEDLへ書き込む**。
 * 描画側はその数字を使うだけにする（描画中に測らない＝毎フレーム同じ音になる）。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const edlPath = process.argv[2];
if (!edlPath) {
  console.error('使い方: node scripts/prep-audio.mjs edl/<slug>.json');
  process.exit(1);
}
const edlAbs = resolve(process.cwd(), edlPath);
const edl = JSON.parse(readFileSync(edlAbs, 'utf8'));
const slug = edl.meta.slug;

/** 頂点（dB）を測る。無音なら -inf 相当を返す */
const peakDb = (file) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' });
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr ?? '');
  return m ? Number(m[1]) : 0;
};

// ── 声（章ごと）
const humanDir = resolve(ROOT, 'voice', slug, 'human');
const outVoice = resolve(ROOT, 'public/voice');
rmSync(outVoice, { recursive: true, force: true });
mkdirSync(outVoice, { recursive: true });
let n = 0;
if (existsSync(humanDir)) {
  for (const f of readdirSync(humanDir)) {
    if (extname(f) !== '.wav') continue;
    copyFileSync(resolve(humanDir, f), resolve(outVoice, f));
    n++;
  }
}
console.log(`声: ${n}章ぶんを public/voice/ へ`);

// ── BGM（リポジトリの外にある。無ければ黙って飛ばす）
const outBgm = resolve(ROOT, 'public/bgm');
mkdirSync(outBgm, { recursive: true });
for (const key of ['bgm', 'endingBgm']) {
  const conf = edl.meta?.[key];
  if (!conf) continue;
  const src = resolve(ROOT, conf.file);
  if (!existsSync(src)) {
    console.log(`${key}: ${conf.file} が無いので鳴らしません`);
    conf.gainDb = null;
    continue;
  }
  const name = key === 'bgm' ? 'main' : 'ending';
  const dst = resolve(outBgm, `${name}${extname(src)}`);
  copyFileSync(src, dst);
  const target = conf.peakDb ?? (key === 'bgm' ? -38 : -8);
  conf.gainDb = Number((target - peakDb(src)).toFixed(1));
  conf.publicFile = `bgm/${name}${extname(src)}`;
  console.log(`${key}: 頂点${target}dB にするため ${conf.gainDb}dB（${conf.publicFile}）`);
}

writeFileSync(edlAbs, `${JSON.stringify(edl, null, 2)}\n`, 'utf8');
console.log('EDL にゲインを書きました。次: npm run build');
