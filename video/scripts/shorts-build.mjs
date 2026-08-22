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

const measure = (file, key) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'loudnorm=I=-14:TP=-1:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = new RegExp(`"${key}"\\s*:\\s*"(-?[\\d.]+)"`).exec(r.stderr ?? '');
  if (!m) throw new Error(`測れない（${key}）: ${file}`);
  return Number(m[1]);
};
const lufs = (file) => measure(file, 'input_i');
/**
 * トゥルーピーク（インターサンプルを含む山の高さ）。
 * `alimiter` が抑えるのは**サンプルピーク**だけで、AAC にしたときの
 * オーバーシュートは抑えられない。実際 S5 が +0.1 dBTP で上がってきた
 * （リミッターの天井を下げても消えなかった＝原因は符号化側）。だから
 * **焼いたあとに実測して、超えていたら下げて焼き直す**。
 */
const truePeak = (file) => measure(file, 'input_tp');

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
  let gain = Number((-14 - before).toFixed(2));
  const encode = (g) => execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw,
    '-af', `volume=${g}dB,alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=80:level=false`,
    '-ar', '48000', '-c:v', 'copy', out]);

  encode(gain);

  /*
   * トゥルーピークは**測って出すだけ**にしてある。直す処理は置かない。
   *
   * 2026-08-22 に S5 が +0.1 dBTP で上がってきたので2つ試して、どちらも実測で外れた。
   *  ① リミッターの天井を下げる（0.891 → 0.84）… 値がまったく動かなかった
   *  ② 超過ぶんだけゲインを下げて焼き直す … 1.33dB → 1.41dB と2回下げても
   *     0.13 → 0.21 → 0.03 dBTP のまま。**ラウドネスだけが -17.1 LUFS まで落ちて基準割れ**
   * 全体を静かにしても山が下がらない以上、原因は音量ではない（符号化・計測側の疑い）。
   * 分かっていないものを自動で触ると、今度は音量の基準を壊す。**測って人に見せる**に留める。
   * 既存の S1・S3・S4 は -0.5〜-0.9 dBTP なので、超えるのは今のところ S5 だけ。
   */
  const peak = truePeak(out);
  const after = lufs(out);
  console.log(`── ${id}: ${before} LUFS → +${gain}dB → ${after} LUFS ／ TP ${peak} dBTP ／ ${outName}`);
  if (peak > -1) console.log(`   ⚠️ トゥルーピークが -1 dBTP を超えている（${peak}）。出す前に人が判断すること`);
}
