#!/usr/bin/env node
/**
 * EDL に書いてある区間だけを、素材から切り出して public/footage/ に置く。
 *
 * なぜ先に切り出すか：
 *   元素材は 3GB × 2 本ある。Remotion（ヘッドレス Chromium）に直接読ませると
 *   シークのたびに巨大ファイルを触りにいってメモリを食い、描画が止まる。
 *   **必要な数秒だけを小さく切っておけば、あとの工程が全部軽くなる。**
 *
 *   node scripts/extract.mjs edl/001-nuimichi.json
 *   node scripts/extract.mjs edl/001-nuimichi.json --only hook-play   # 1本だけ作り直す
 *   node scripts/extract.mjs edl/001-nuimichi.json --force            # 既存を無視して作り直す
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FOOTAGE = resolve(HERE, '../public/footage');

/**
 * `~` を展開する。
 * このリポジトリは PUBLIC なので、EDL に自宅の絶対パスを書かない
 * （読む人の環境でも動くように、という理由のほうが大きい）。
 */
const expand = (p) => (p.startsWith('~/') ? resolve(homedir(), p.slice(2)) : p);

const edlPath = process.argv[2];
if (!edlPath) {
  console.error('使い方: node scripts/extract.mjs edl/<slug>.json [--only <clipId>] [--force]');
  process.exit(1);
}
const edl = JSON.parse(readFileSync(resolve(process.cwd(), edlPath), 'utf8'));
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const force = process.argv.includes('--force');

mkdirSync(FOOTAGE, { recursive: true });

/**
 * 素材ごとの下ごしらえ。
 *
 * 自撮りは窓を背にしていて全体に眠い（実測: 平均輝度 150 前後・標準偏差 55 前後）ので、
 * 締めてから使う。画面収録は色をいじらない（コードの色が変わると別物になる）。
 */
const GRADE = {
  screen: null,
  /**
   * 自撮りの色。**素人の自撮りに見えないところまで持っていく**（001のFB）。
   * やっていること: 黒を少し浮かせる（フィルムっぽさ）／中間を明るく／
   * 白飛びを 0.965 で止める（窓の光で飛んでいた）／肌に寄せて少し暖色へ／
   * ハイライトだけ少し寒色（暖と寒の差が「それっぽさ」になる）／軽くシャープ。
   * ビネットは入れない（寄りの画では、暗い四隅が作り物っぽく見えた）。
   */
  self:
    "curves=all='0/0.035 0.25/0.245 0.5/0.53 0.75/0.80 1/0.965'," +
    'eq=contrast=1.05:saturation=1.14:gamma=1.02,' +
    'colorbalance=rs=0.02:bs=-0.03:rm=0.035:bm=-0.02:rh=0.005:bh=0.025,' +
    'unsharp=5:5:0.55:5:5:0.0',
};

function build(clip, id) {
  const src = edl.sources[clip.src];
  if (!src) throw new Error(`${id}: sources に "${clip.src}" がありません`);
  const crop = edl.crops[clip.crop];
  if (!crop) throw new Error(`${id}: crops に "${clip.crop}" がありません`);

  const filters = [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`];
  if (crop.out) filters.push(`scale=${crop.out.w}:${crop.out.h}:flags=lanczos`);
  if (GRADE[clip.src]) filters.push(GRADE[clip.src]);
  if (clip.speed && clip.speed !== 1) filters.push(`setpts=${(1 / clip.speed).toFixed(6)}*PTS`);
  filters.push(`fps=${edl.meta.fps}`);

  const file = expand(src.file);
  return {
    file,
    // -ss を -i の前に置くと速いが、この用途では -i の後ろに置いて正確さを取る
    // （数秒の切り出しなので速度差は問題にならない）
    args: [
      '-hide_banner', '-v', 'error', '-y',
      '-ss', String(Math.max(0, clip.in - 3)),
      '-i', file,
      '-ss', String(Math.min(3, clip.in)),
      '-t', String(clip.dur),
      '-vf', filters.join(','),
      '-an',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      resolve(FOOTAGE, `${id}.mp4`),
    ],
  };
}

/**
 * 切り出す前に EDL を検査する。
 *
 * いちばん起きやすい壊れ方は「素材が編集より短い」。
 * 描画してみるまで気づかず、最後の数秒だけ黒くなる（実際に起きた）。ここで止める。
 */
function validate() {
  const errors = [];
  let total = 0;

  // 使ってはいけない区間と、切り出そうとしている区間がぶつかっていないか。
  // scan-risk.mjs の候補を見て「気をつける」だけでは漏れる。実際に漏れた
  // （個人の検索履歴が出ているアドレスバーを、公開の場面にそのまま使っていた）。
  for (const [id, clip] of Object.entries(edl.clips)) {
    const from = clip.in;
    const to = clip.in + clip.dur * (clip.speed ?? 1);
    for (const r of edl.risks ?? []) {
      if (r.src !== clip.src) continue;
      if (r.crops && !r.crops.includes(clip.crop)) continue;
      if (from < r.to && to > r.from) {
        errors.push(
          `素材 "${id}"（${from.toFixed(0)}〜${to.toFixed(0)}s）が、使ってはいけない区間` +
            ` ${r.from}〜${r.to}s と重なっている: ${r.why}`,
        );
      }
    }
  }

  for (const ch of edl.chapters) {
    total += ch.dur;
    for (const l of ch.layers) {
      const end = (l.at ?? 0) + (l.dur ?? 0);
      if (l.type !== 'sfx' && end > ch.dur + 0.001) {
        errors.push(`${ch.id}: ${l.type} が章の外へ出ている（${end.toFixed(1)}s > ${ch.dur}s）`);
      }
      if (l.type === 'shot') {
        const clip = edl.clips[l.clip];
        if (!clip) errors.push(`${ch.id}: clips に "${l.clip}" がない`);
        else if (l.dur > clip.dur + 0.01) {
          errors.push(`${ch.id}: 素材 "${l.clip}" が短い（必要 ${l.dur}s / 実際 ${clip.dur}s）`);
        }
      }
      if (l.type === 'sfx' && !/^[a-zA-Z]+$/.test(l.name)) errors.push(`${ch.id}: 効果音の名前が変 "${l.name}"`);
    }
  }
  const mm = Math.floor(total / 60);
  const ss = String(Math.round(total % 60)).padStart(2, '0');
  console.log(`全体の尺: ${mm}:${ss}（${total}秒）\n`);
  if (errors.length) {
    console.error('EDL がおかしいので止めます:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
}
validate();

const ids = Object.keys(edl.clips).filter((id) => !only || id === only);
let made = 0;
let skipped = 0;

for (const id of ids) {
  const outPath = resolve(FOOTAGE, `${id}.mp4`);
  if (!force && existsSync(outPath)) { skipped++; continue; }
  const clip = edl.clips[id];
  const { args } = build(clip, id);
  const label = `${id}  ${clip.crop}  ${clip.in.toFixed(1)}s +${clip.dur}s${clip.speed && clip.speed !== 1 ? ` ×${clip.speed}` : ''}`;
  process.stdout.write(`切り出し中: ${label} ... `);
  try {
    execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    console.log('できた');
    made++;
  } catch (e) {
    console.log('しっぱい');
    console.error(String(e.stderr ?? e));
    process.exitCode = 1;
  }
}

console.log(`\n${made}本 切り出し / ${skipped}本 すでにある（作り直すなら --force）`);
