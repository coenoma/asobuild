#!/usr/bin/env node
/**
 * ナレーションを動画に乗せる。**確認用の合成音声と、本命の人の声を、同じ仕組みで扱う。**
 *
 *   # ① 確認用の声を作る（VOICEVOX。voice/<slug>.json の原稿から章ごとの wav へ）
 *   node scripts/voice.mjs edl/001-nuimichi.json --synth
 *
 *   # ② 声を動画に乗せる（再レンダリング不要。映像はコピーで音だけ混ぜる）
 *   node scripts/voice.mjs edl/001-nuimichi.json --mux
 *   → out/<slug>-voiced.mp4
 *
 * 本命（人の声）はどうするか:
 *   録った wav を voice/<slug>/<章ID>.wav に置き換えて、同じ --mux を打つだけ。
 *   ②は「voice/<slug>/ にある章IDの wav を、章の頭に置いて混ぜる」しかしていないので、
 *   声が VOICEVOX か人かを区別しない。
 *
 * VOICEVOX は podmate-cli と同じ使い方（ローカルエンジンの REST /audio_query → /synthesis）。
 * 起動: docker run -d --rm --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-latest
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const edlPath = process.argv[2];
if (!edlPath || (!process.argv.includes('--synth') && !process.argv.includes('--mux'))) {
  console.error('使い方: node scripts/voice.mjs edl/<slug>.json --synth | --mux');
  console.error('  --synth  voice/<slug>.json の原稿から、章ごとの wav を合成する');
  console.error('  --mux    voice/<slug>/ の wav を章の頭に置いて動画に混ぜる（人の声でも同じ）');
  process.exit(1);
}
const edl = JSON.parse(readFileSync(resolve(process.cwd(), edlPath), 'utf8'));
const slug = edl.meta.slug;
const VOICE_DIR = resolve(ROOT, 'voice', slug);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/** 章の頭が動画の何秒か */
function chapterOffsets() {
  const out = {};
  let t = 0;
  for (const ch of edl.chapters) {
    out[ch.id] = t;
    t += ch.dur;
  }
  return { offsets: out, total: t };
}

const wavSeconds = (p) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString());

// ───────────────────────── 合成（確認用の声） ─────────────────────────
if (process.argv.includes('--synth')) {
  const url = arg('url', 'http://localhost:50021');
  // 話者は男声の 13（青山龍星）を既定にする。ぼくの仮の声なので男声のほうが尺感が近い。
  // 一覧: curl -s localhost:50021/speakers | jq '.[] | {name, styles: [.styles[].id]}'
  const speaker = Number(arg('speaker', '13'));
  // 早口ぎみに。動画のテンポが2〜3秒刻みなので、1.0 だと間延びして聞こえる
  const speed = Number(arg('speed', '1.1'));

  try {
    execFileSync('curl', ['-s', '-m', '2', `${url}/version`]);
  } catch {
    console.error('VOICEVOX が起きていません。起動:');
    console.error('  docker run -d --rm --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-latest');
    process.exit(1);
  }

  const scriptPath = resolve(ROOT, 'voice', `${slug}.json`);
  const lines = JSON.parse(readFileSync(scriptPath, 'utf8'));
  mkdirSync(VOICE_DIR, { recursive: true });

  const { offsets } = chapterOffsets();
  const durOf = Object.fromEntries(edl.chapters.map((c) => [c.id, c.dur]));

  console.log(`話者 ${speaker} ／ 速さ ${speed} ／ ${url}\n`);
  for (const [id, text] of Object.entries(lines)) {
    if (id.startsWith('_')) continue;
    if (!(id in offsets)) {
      console.log(`× ${id}: EDL にこの章がありません（原稿の章IDを確認）`);
      continue;
    }
    // audio_query → speedScale を上書き → synthesis（podmate-cli shorts.py と同じ流れ）
    const aq = execFileSync('curl', [
      '-s', '-X', 'POST',
      `${url}/audio_query?speaker=${speaker}&text=${encodeURIComponent(text)}`,
    ]).toString();
    const query = JSON.parse(aq);
    query.speedScale = speed;
    const wav = execFileSync(
      'curl',
      ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', '@-', `${url}/synthesis?speaker=${speaker}`],
      { input: JSON.stringify(query), maxBuffer: 64 * 1024 * 1024 },
    );
    const out = resolve(VOICE_DIR, `${id}.wav`);
    writeFileSync(out, wav);
    const sec = wavSeconds(out);
    const cap = durOf[id];
    const fit = sec <= cap - 0.8 ? '○' : sec <= cap ? '△ぎりぎり' : '×はみ出す';
    console.log(`${fit} ${id.padEnd(9)} 声 ${sec.toFixed(1)}s ／ 章 ${cap}s`);
  }
  console.log(`\n→ voice/${slug}/*.wav`);
  console.log('はみ出した章は、原稿を削るか EDL の章を伸ばす。');
  console.log(`次: node scripts/voice.mjs ${edlPath} --mux`);
}

// ───────────────────────── 乗せる（合成でも人の声でも同じ） ─────────────────────────
if (process.argv.includes('--mux')) {
  const video = arg('video', resolve(ROOT, 'out', `${slug}.mp4`));
  const out = arg('out', resolve(ROOT, 'out', `${slug}-voiced.mp4`));
  if (!existsSync(video)) {
    console.error(`動画がありません: ${video}（先に本編を書き出す）`);
    process.exit(1);
  }
  if (!existsSync(VOICE_DIR)) {
    console.error(`voice/${slug}/ がありません（先に --synth するか、録った wav を置く）`);
    process.exit(1);
  }

  const { offsets, total } = chapterOffsets();
  const wavs = readdirSync(VOICE_DIR)
    .filter((f) => f.endsWith('.wav'))
    .map((f) => ({ id: f.replace(/\.wav$/, ''), path: resolve(VOICE_DIR, f) }))
    .filter((w) => w.id in offsets)
    .sort((a, b) => offsets[a.id] - offsets[b.id]);
  if (wavs.length === 0) {
    console.error(`voice/${slug}/ に章IDの wav がありません`);
    process.exit(1);
  }

  // はみ出しの警告（乗せはする。判断は人）
  for (const w of wavs) {
    const sec = wavSeconds(w.path);
    const cap = edl.chapters.find((c) => c.id === w.id).dur;
    if (sec > cap) console.log(`△ ${w.id}: 声 ${sec.toFixed(1)}s が章 ${cap}s からはみ出しています`);
  }

  // 各章の頭に adelay で置いて、元の音（効果音）と混ぜる。映像は再エンコードしない
  const inputs = ['-i', video];
  for (const w of wavs) inputs.push('-i', w.path);
  const delays = wavs
    .map((w, i) => {
      const ms = Math.round(offsets[w.id] * 1000);
      return `[${i + 1}:a]adelay=${ms}|${ms},apad[v${i}]`;
    })
    .join(';');
  const mixIn = ['[0:a]', ...wavs.map((_, i) => `[v${i}]`)].join('');
  // 効果音は声のうしろで少し下げる。normalize=0 で勝手に音量を割られないようにする
  const filter = `${delays};${mixIn}amix=inputs=${wavs.length + 1}:duration=first:normalize=0:weights=0.55 ${wavs.map(() => '1').join(' ')}[out]`;

  execFileSync('ffmpeg', [
    '-hide_banner', '-v', 'error', '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[out]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-t', String(total),
    out,
  ]);
  console.log(`のせた: ${out}（${wavs.length}章ぶん）`);
}
