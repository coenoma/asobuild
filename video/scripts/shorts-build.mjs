#!/usr/bin/env node
/**
 * ショートの仕上げを1コマンドにする。
 *
 *   node scripts/shorts-build.mjs [レシピid...]   # 省略時は edl/shorts/ の全部
 *
 * やること: prep（声の切り出し＋境界検査）→ 描画 → ラウドネス実測 → -14 LUFS へ正規化
 * → out/shorts/<レシピの out>.mp4
 *
 * なぜ1本にするか。measure→volume→alimiter の正規化を手でやっていると、
 * 「前回のゲインの使い回し」ができてしまう（声が変わるたびに実測しないと意味がない）。
 * ここに畳んで、実測せずに出す道を塞ぐ。loudnorm 一発を使わないのは、
 * ゲインがヘッドルームを超えると動的モードに落ちて声が破綻するから（本編で実害）。
 */
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const dir = resolve(ROOT, 'edl/shorts');

const all = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all;

console.log('── prep（声の切り出し＋境界検査）');
execFileSync('node', [resolve(HERE, 'prep-shorts.mjs')], { stdio: 'inherit' });

const lufs = (file) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'loudnorm=I=-14:TP=-1:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /"input_i"\s*:\s*"(-?[\d.]+)"/.exec(r.stderr ?? '');
  if (!m) throw new Error(`ラウドネスを測れない: ${file}`);
  return Number(m[1]);
};

mkdirSync(resolve(ROOT, 'out/shorts'), { recursive: true });
for (const id of ids) {
  const r = JSON.parse(readFileSync(resolve(dir, `${id}.json`), 'utf8'));
  const comp = `Short-${id.replace(/^\d+-/, '')}`;
  const raw = resolve(tmpdir(), `${id}-raw.mp4`);
  const outName = r.out ?? `${id}.mp4`;
  const out = resolve(ROOT, 'out/shorts', outName);
  console.log(`── ${id}: 描画（${comp}）`);
  execFileSync('npx', ['remotion', 'render', 'src/index.ts', comp, raw, `--public-dir=${resolve(ROOT, 'public')}`, '--concurrency=3'],
    { cwd: ROOT, stdio: 'inherit' });
  const before = lufs(raw);
  const gain = Number((-14 - before).toFixed(2));
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw,
    '-af', `volume=${gain}dB,alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=80:level=false`,
    '-ar', '48000', '-c:v', 'copy', out]);
  const after = lufs(out);
  console.log(`── ${id}: ${before} LUFS → +${gain}dB → ${after} LUFS ／ ${outName}`);
}
