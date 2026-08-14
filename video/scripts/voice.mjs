#!/usr/bin/env node
/**
 * ナレーションを、字幕と声の**両方**として動画に乗せる。
 *
 * 原稿（voice/<slug>.json）が唯一の源。行ごとに
 *   at    … 章内の何秒で言うか
 *   t     … 字幕に出す文（そのまま読み上げる。say で読みだけ上書き可）
 *   big   … 演出級のデカ文字にする（字幕サイズではなく main サイズ）
 * を持つ。**声と字幕を同じ行から作るので、ずれようがない。**
 *
 *   # ① 行ごとに合成して、長さを実測する（VOICEVOX・既定はずんだもん）
 *   node scripts/voice.mjs edl/001-nuimichi.json --synth
 *
 *   # ② 字幕テロップを EDL に書き込む（gen:true の層だけ入れ替える。手書きの層は触らない）
 *   node scripts/voice.mjs edl/001-nuimichi.json --apply
 *
 *   # ③ 描画したあと、声を混ぜる（映像はコピーなので数秒）
 *   node scripts/voice.mjs edl/001-nuimichi.json --mux
 *
 * 本命（人の声）への切り替え:
 *   章ごとに録った wav を voice/<slug>/human/<章ID>.wav に置くと、--mux はそちらを優先する。
 *   字幕は同じ原稿から出るので、人の声の間に合わせて原稿の at を直し、--apply → 描画で追従させる。
 *
 * VOICEVOX は podmate-cli と同じ使い方（ローカルエンジンの REST /audio_query → /synthesis）。
 * 起動: docker run -d --rm --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-latest
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const edlPath = process.argv[2];
const MODES = ['--synth', '--apply', '--mux'];
if (!edlPath || !MODES.some((m) => process.argv.includes(m))) {
  console.error('使い方: node scripts/voice.mjs edl/<slug>.json --synth [--apply] [--mux]');
  console.error('  --synth  原稿の各行を合成して長さを実測（voice/<slug>/*.wav と layout を作る）');
  console.error('  --apply  字幕テロップを EDL に書き込む（gen:true だけ入れ替え）');
  console.error('  --mux    描画済みの動画に声を混ぜる（human/<章ID>.wav があればそちらを優先）');
  process.exit(1);
}
const edlAbs = resolve(process.cwd(), edlPath);
const edl = JSON.parse(readFileSync(edlAbs, 'utf8'));
const slug = edl.meta.slug;
const WAV_DIR = resolve(ROOT, 'voice', slug);
const LAYOUT = resolve(ROOT, 'voice', `${slug}.layout.json`);
const script = JSON.parse(readFileSync(resolve(ROOT, 'voice', `${slug}.json`), 'utf8'));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/** 章の頭が動画の何秒か */
const chapterStart = {};
{
  let t = 0;
  for (const ch of edl.chapters) {
    chapterStart[ch.id] = t;
    t += ch.dur;
  }
}
const chapterDur = Object.fromEntries(edl.chapters.map((c) => [c.id, c.dur]));

const wavSeconds = (p) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString());

/** 読み上げ用の文。字幕の記号は読ませない */
const speakable = (line) => (line.say ?? line.t).replace(/[「」『』]/g, '');

// ───────────────────────── ① 合成（行ごと） ─────────────────────────
if (process.argv.includes('--synth')) {
  const url = arg('url', 'http://localhost:50021');
  // 既定はずんだもん（ノーマル）。一覧: curl -s localhost:50021/speakers
  const speaker = Number(arg('speaker', '3'));
  const speed = Number(arg('speed', '1.1'));

  try {
    execFileSync('curl', ['-s', '-m', '2', `${url}/version`]);
  } catch {
    console.error('VOICEVOX が起きていません。起動:');
    console.error('  docker run -d --rm --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-latest');
    process.exit(1);
  }

  mkdirSync(WAV_DIR, { recursive: true });
  console.log(`話者 ${speaker}（ずんだもん） ／ 速さ ${speed}\n`);

  const layout = [];
  let warned = 0;
  for (const [chId, lines] of Object.entries(script.chapters)) {
    if (!(chId in chapterStart)) {
      console.log(`× ${chId}: EDL にこの章がありません`);
      continue;
    }
    lines.forEach((line, i) => {
      const aq = execFileSync('curl', [
        '-s', '-X', 'POST',
        `${url}/audio_query?speaker=${speaker}&text=${encodeURIComponent(speakable(line))}`,
      ]).toString();
      const query = JSON.parse(aq);
      query.speedScale = speed;
      const wav = execFileSync(
        'curl',
        ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', '@-', `${url}/synthesis?speaker=${speaker}`],
        { input: JSON.stringify(query), maxBuffer: 64 * 1024 * 1024 },
      );
      const file = `${chId}-${String(i).padStart(2, '0')}.wav`;
      writeFileSync(resolve(WAV_DIR, file), wav);
      const dur = wavSeconds(resolve(WAV_DIR, file));
      layout.push({ ch: chId, i, at: line.at, abs: chapterStart[chId] + line.at, dur, file });

      // 次の行・章の終わりに食い込んでいないか
      const next = lines[i + 1];
      const end = line.at + dur;
      if (next && end > next.at + 0.05) {
        console.log(`△ ${chId}#${i}「${line.t}」 声${dur.toFixed(1)}s が次の行(${next.at}s)に食い込む`);
        warned++;
      } else if (!next && end > chapterDur[chId]) {
        console.log(`△ ${chId}#${i}「${line.t}」 声${dur.toFixed(1)}s が章(${chapterDur[chId]}s)からはみ出す`);
        warned++;
      }
    });
    console.log(`○ ${chId.padEnd(9)} ${lines.length}行`);
  }
  writeFileSync(LAYOUT, JSON.stringify(layout, null, 1));
  console.log(`\n${layout.length}行 → voice/${slug}/ ＋ layout`);
  console.log(warned ? `△ ${warned}件。原稿を短くするか at をずらす` : 'ぜんぶ収まっています');
}

// ───────────────────────── ② 字幕を EDL へ ─────────────────────────
if (process.argv.includes('--apply')) {
  if (!existsSync(LAYOUT)) {
    console.error('layout がありません。先に --synth を実行してください');
    process.exit(1);
  }
  const layout = JSON.parse(readFileSync(LAYOUT, 'utf8'));
  const durOf = Object.fromEntries(layout.map((l) => [`${l.ch}#${l.i}`, l.dur]));

  let added = 0;
  for (const ch of edl.chapters) {
    // 前回の生成分だけ消す。手書きの層（数字・カード・小注釈）は残る
    ch.layers = ch.layers.filter((l) => !l.gen);
    const lines = script.chapters[ch.id] ?? [];
    lines.forEach((line, i) => {
      const voiceDur = durOf[`${ch.id}#${i}`] ?? 2.0;
      const next = lines[i + 1];
      // 声より少しだけ長く出す
      let end = line.at + voiceDur + 0.5;
      if (next) {
        // **次の行とのすきまを作らない。**
        // 0.1秒でも空けると、帯が消えてすぐ出るので点滅して見え、
        // 「読めない謎のテロップが一瞬出る」と受け取られる（001のFB）。
        // 間を置きたいときは、原稿の at を離して書く（0.6秒以上あければ間として残る）
        if (next.at - end < 0.6) end = next.at;
        end = Math.min(end, next.at);
      }
      end = Math.min(end, ch.dur - 0.05);
      const dur = end - line.at;
      ch.layers.push({
        type: 'telop',
        at: line.at,
        dur: Math.max(0.8, Number(dur.toFixed(2))),
        text: line.t,
        style: line.big ? 'main' : 'sub',
        place: line.place ?? 'bottom',
        ...(line.color ? { color: line.color } : {}),
        gen: true,
      });
      added++;
    });
  }
  writeFileSync(edlAbs, JSON.stringify(edl, null, 2) + '\n');
  console.log(`字幕 ${added}行を EDL に書き込みました（gen:true）。次: extract → render`);
}

// ───────────────────────── ③ 声を混ぜる ─────────────────────────
if (process.argv.includes('--mux')) {
  const video = arg('video', resolve(ROOT, 'out', `${slug}.mp4`));
  const out = arg('out', resolve(ROOT, 'out', `${slug}-voiced.mp4`));
  if (!existsSync(video)) {
    console.error(`動画がありません: ${video}`);
    process.exit(1);
  }
  if (!existsSync(LAYOUT)) {
    console.error('layout がありません。先に --synth を実行してください');
    process.exit(1);
  }
  const layout = JSON.parse(readFileSync(LAYOUT, 'utf8'));

  // 本命（人の声）が章単位で置いてあれば、その章の行wavより優先する
  const tracks = [];
  const humanCh = new Set();
  for (const chId of Object.keys(script.chapters)) {
    const human = resolve(WAV_DIR, 'human', `${chId}.wav`);
    if (existsSync(human)) {
      tracks.push({ path: human, abs: chapterStart[chId] });
      humanCh.add(chId);
    }
  }
  for (const l of layout) {
    if (humanCh.has(l.ch)) continue;
    tracks.push({ path: resolve(WAV_DIR, l.file), abs: l.abs });
  }
  tracks.sort((a, b) => a.abs - b.abs);
  if (humanCh.size) console.log(`人の声を優先: ${[...humanCh].join(', ')}`);

  const total = edl.chapters.reduce((a, c) => a + c.dur, 0);
  const inputs = ['-i', video];
  for (const t of tracks) inputs.push('-i', t.path);

  /**
   * BGM は**リポジトリに置かない**（PUBLIC なので音源の再配布になる）。
   * 手元の video/bgm/ を、書き出しのときだけ読む。無ければ黙って鳴らさない。
   * 大きさは「頂点を何dBにするか」で指定する（元の音量に左右されないように、
   * その場で測ってから差を当てる）。決まりは docs/video/sound-design.md
   */
  const measurePeak = (file) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'],
      { encoding: 'utf8' });
    const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr ?? '');
    return m ? Number(m[1]) : 0;
  };

  const bgmParts = [];
  const bgmLabels = [];
  let nextIdx = tracks.length + 1;

  const bgmConf = edl.meta?.bgm;
  const bgmFile = bgmConf ? resolve(ROOT, bgmConf.file) : null;
  // 締めの曲が始まる時刻（既定は最後の章の頭）
  const endChapter = edl.chapters[edl.chapters.length - 1];
  const endAt = total - endChapter.dur;

  if (bgmFile && existsSync(bgmFile)) {
    const gain = (bgmConf.peakDb ?? -32) - measurePeak(bgmFile);
    const i = nextIdx++;
    // ループさせて全体を覆い、締めの曲に入る手前で消える
    inputs.push('-stream_loop', '-1', '-i', bgmFile);
    const outStart = Math.max(0, endAt - 2.5);
    bgmParts.push(
      `[${i}:a]volume=${gain.toFixed(1)}dB,atrim=0:${endAt.toFixed(2)},` +
      `afade=t=in:st=0:d=2,afade=t=out:st=${outStart.toFixed(2)}:d=2.5,apad[bgm]`,
    );
    bgmLabels.push('[bgm]');
    console.log(`BGM: ${bgmConf.file} を 頂点${bgmConf.peakDb ?? -32}dB で敷きました`);
  } else if (bgmConf) {
    console.log(`BGM: ${bgmConf.file} が無いので鳴らしません（手元に置くと入ります）`);
  }

  const endConf = edl.meta?.endingBgm;
  const endFile = endConf ? resolve(ROOT, endConf.file) : null;
  if (endFile && existsSync(endFile)) {
    const gain = (endConf.peakDb ?? -8) - measurePeak(endFile);
    const i = nextIdx++;
    const at = Math.round((endConf.at ?? endAt) * 1000);
    inputs.push('-i', endFile);
    bgmParts.push(`[${i}:a]volume=${gain.toFixed(1)}dB,adelay=${at}|${at},apad[endbgm]`);
    bgmLabels.push('[endbgm]');
    console.log(`締めの曲: ${endConf.file} を 頂点${endConf.peakDb ?? -8}dB で置きました`);
  } else if (endConf) {
    console.log(`締めの曲: ${endConf.file} が無いので鳴らしません`);
  }

  const delays = tracks
    .map((t, i) => `[${i + 1}:a]adelay=${Math.round(t.abs * 1000)}|${Math.round(t.abs * 1000)},apad[v${i}]`)
    .join(';');
  const mixIn = ['[0:a]', ...tracks.map((_, i) => `[v${i}]`), ...bgmLabels].join('');
  const nMix = tracks.length + 1 + bgmLabels.length;
  // 効果音は声のうしろで少し下げる。BGM はすでに小さくしてあるので等倍
  const weights = ['0.5', ...tracks.map(() => '1'), ...bgmLabels.map(() => '1')].join(' ');
  const filter = `${[delays, ...bgmParts].filter(Boolean).join(';')};${mixIn}amix=inputs=${nMix}:duration=first:normalize=0:weights=${weights}[out]`;

  execFileSync('ffmpeg', [
    '-hide_banner', '-v', 'error', '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[out]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-t', String(total),
    out,
  ]);
  console.log(`のせた: ${out}（${tracks.length}トラック）`);
}
