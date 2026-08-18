#!/usr/bin/env node
/**
 * ショートの「検査したい瞬間」を1枚に並べる（コンタクトシート）。
 *
 *   node scripts/shorts-proof.mjs <レシピid>   → out/shorts/proof-<id>.png
 *
 * 並べるのは機械的に決める: 各拍の頭／タイトル行が出そろった瞬間／ツッコミの瞬間／
 * パンチの瞬間／でか文字／CTAの出た画／最終フレーム。
 * 文字の被り・変な折り返し・置き場のミスは、動画を通しで見るより
 * この1枚を見るほうが速く確実に見つかる（001では全部この種のFBだった）。
 */
import { readFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const id = process.argv[2];
if (!id) { console.error('使い方: node scripts/shorts-proof.mjs <レシピid>'); process.exit(1); }
const r = JSON.parse(readFileSync(resolve(ROOT, 'edl/shorts', `${id}.json`), 'utf8'));
const FPS = 30;

// 検査したい瞬間（秒）とラベルを拍から列挙する
const shots = [];
let t0 = 0;
r.beats.forEach((b, i) => {
  shots.push([t0 + 0.2, `拍${i} 頭`]);
  if (b.titleLines && b.titleStagger) shots.push([t0 + b.titleStagger * b.titleLines.length + 0.15, `拍${i} タイトル`]);
  for (const ov of b.overlays ?? []) shots.push([t0 + ov.at + 0.1, `拍${i} ${ov.text.replace(/\n/g, '')}`]);
  for (const pu of b.punches ?? []) shots.push([t0 + pu.at + 0.05, `拍${i} パンチ`]);
  if (b.bigText) shots.push([t0 + (b.bigTyped ? 1.4 : 0.3), `拍${i} ${b.bigText.replace(/\n/g, '')}`]);
  t0 += b.dur;
});
if (r.cta) shots.push([t0 - (r.cta.fromEnd ?? 4.5) + 0.3, 'CTA']);
shots.push([t0 - 0.15, '最終']);

const seqDir = resolve(tmpdir(), `proof-${id}`);
rmSync(seqDir, { recursive: true, force: true });
mkdirSync(seqDir, { recursive: true });
const comp = `Short-${id.replace(/^\d+-/, '')}`;
execFileSync('npx', ['remotion', 'render', 'src/index.ts', comp, seqDir, '--sequence', '--image-format=jpeg',
  '--scale=0.25', `--public-dir=${resolve(ROOT, 'public')}`, '--concurrency=3'], { cwd: ROOT, stdio: 'inherit' });

// 連番ファイル名の桁数はレンダ結果から読む
const files = readdirSync(seqDir).filter((f) => f.endsWith('.jpeg')).sort();
const frameFile = (f) => files[Math.min(files.length - 1, Math.max(0, Math.round(f)))];

const out = resolve(ROOT, 'out/shorts', `proof-${id}.png`);
const args = [];
for (const [sec, label] of shots) {
  args.push('-label', `${label} @${sec.toFixed(1)}s`, resolve(seqDir, frameFile(sec * FPS)));
}
execFileSync('magick', ['montage', ...args, '-tile', 'x2', '-geometry', '+6+14', '-background', '#1a2230',
  '-fill', 'white', '-pointsize', '13', out]);
console.log(`→ ${out}（${shots.length}コマ）`);
