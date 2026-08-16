#!/usr/bin/env node
/**
 * アテレコ（動画を見ながら自由に喋った画面収録）を、本ちゃんの声に整えるための道具。
 *
 * 前提のフロー（docs/video/atereco.md が正本）:
 *   1. 現行版の動画を再生しながら、自由に喋る。**画面収録**で録る
 *      （再生位置が映っているので、あとで「どこの話か」「どこで止めたか」が分かる）
 *   2. 高精度の文字起こしを作る（pm / podmate studio の whisper。SRT か segments JSON）
 *   3. このスクリプトで 音声抽出 → 発話ブロック検出 → 文字起こしの割り付け
 *   4. 人がブロックに章を割り当てる（voice/<slug>.atereco.json の chapter を埋める）
 *   5. --cut で 章ごとの wav に切り出す → 既存の voice.mjs --mux がそのまま人の声を使う
 *
 * 使い方（上から順に）:
 *   node scripts/atereco.mjs edl/<slug>.json --extract ~/path/アテレコ収録.mov
 *   node scripts/atereco.mjs edl/<slug>.json --blocks
 *   node scripts/atereco.mjs edl/<slug>.json --sheet --srt ~/path/文字起こし.srt
 *   （ここで人: voice/<slug>.atereco.json の各ブロックに chapter を書く。捨てるブロックは "skip"）
 *   node scripts/atereco.mjs edl/<slug>.json --cut
 *   node scripts/atereco.mjs edl/<slug>.json --check
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const edlPath = process.argv[2];
const MODES = ['--extract', '--blocks', '--sheet', '--cut', '--check', '--tighten'];
if (!edlPath || !MODES.some((m) => process.argv.includes(m))) {
  console.error('使い方: node scripts/atereco.mjs edl/<slug>.json --extract <収録> | --blocks | --sheet [--srt f|--json f] | --cut | --check');
  console.error('  --extract  画面収録から音声だけを取り出す（48kHz mono wav）');
  console.error('  --blocks   無音で区切って発話ブロックを検出する（別録りなら --offset <秒> で画面収録の時刻も併記）');
  console.error('  --sheet    文字起こしをブロックへ割り付け、対応表を作る');
  console.error('  --cut      章の割り当てに従って human/<章ID>.wav を切り出す（voice.mjs --mux が拾う）');
  console.error('             --keep-gaps を足すと、ブロックを詰めずに章の最初から最後までを丸ごと切る');
  console.error('  --check    章ごとの声の長さと映像の尺を見比べる（映像を伸ばす候補が分かる）');
  console.error('  --tighten  章ごとの声から間を詰める（喋りは削らない）。時刻の対応表も出す');
  process.exit(1);
}

const edl = JSON.parse(readFileSync(resolve(process.cwd(), edlPath), 'utf8'));
const slug = edl.meta.slug;
const VOICE_DIR = resolve(ROOT, 'voice', slug);
const WAV = resolve(VOICE_DIR, 'atereco.wav');
const DATA = resolve(ROOT, 'voice', `${slug}.atereco.json`);
const chapterIds = edl.chapters.map((c) => c.id);

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const r1 = (n) => Math.round(n * 10) / 10;
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/* ---------- --extract ---------- */

if (process.argv.includes('--extract')) {
  const src = arg('extract');
  if (!src) {
    console.error('--extract <画面収録ファイル> の形で渡してください');
    process.exit(1);
  }
  mkdirSync(VOICE_DIR, { recursive: true });
  // 文字起こしと無音検出の両方で使うので、扱いやすい 48kHz mono に揃える
  execFileSync('ffmpeg', ['-y', '-i', src, '-vn', '-ac', '1', '-ar', '48000', WAV], { stdio: 'inherit' });
  console.log(`\n音声を取り出しました: voice/${slug}/atereco.wav`);
  console.log('次: --blocks で発話ブロックを検出');
}

/* ---------- --blocks ---------- */

if (process.argv.includes('--blocks')) {
  if (!existsSync(WAV)) {
    console.error(`先に --extract を。見つかりません: voice/${slug}/atereco.wav`);
    process.exit(1);
  }
  /**
   * 無音のしきい値。**録音の大きさは毎回ちがう**ので、決め打ちにしない。
   *
   * 001の試し録りは声の頂点が -41dB で、既定の -35dB では「ずっと無音」と判定されて
   * ブロックが0個になった。かといって低くしすぎると部屋の音まで声として拾う。
   * so 上から順に下げていき、**ブロックが2つ以上に割れた時点で止める**。
   * 使った値は必ず表示する（人が「そんなに下げたのか」と気づけるように）。
   */
  const MIN_SILENCE = Number(arg('gap') ?? 0.6);
  const given = arg('noise');
  const LADDER = given ? [given] : ['-35dB', '-40dB', '-45dB', '-50dB', '-55dB'];

  const dur = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', WAV]).toString(),
  );
  const detect = (noise) =>
    spawnSync('ffmpeg', ['-i', WAV, '-af', `silencedetect=noise=${noise}:d=${MIN_SILENCE}`, '-f', 'null', '-'],
      { encoding: 'utf8' }).stderr;

  const parse = (stderr) => {
    const out = [];
    let start = null;
    for (const line of stderr.split('\n')) {
      const s = /silence_start: (-?[\d.]+)/.exec(line);
      const e = /silence_end: ([\d.]+)/.exec(line);
      if (s) start = Math.max(0, Number(s[1]));
      if (e && start !== null) {
        out.push([start, Number(e[1])]);
        start = null;
      }
    }
    if (start !== null) out.push([start, dur]);
    return out;
  };
  const toBlocks = (sil) => {
    const bs = [];
    let cur = 0;
    for (const [s, e] of sil) {
      if (s - cur >= 0.4) bs.push({ start: r1(cur), end: r1(s) });
      cur = e;
    }
    if (dur - cur >= 0.4) bs.push({ start: r1(cur), end: r1(dur) });
    return bs;
  };

  let NOISE = LADDER[0];
  let silences = [];
  let picked = null;
  for (const n of LADDER) {
    const b = toBlocks(parse(detect(n)));
    if (picked === null || b.length >= 2) {
      NOISE = n;
      silences = parse(detect(n));
      picked = b;
    }
    if (b.length >= 2) break;
  }
  console.log(`無音のしきい値: ${NOISE}${given ? '（指定）' : '（自動）'}`);
  if (picked.length <= 1) {
    console.log('');
    console.log('⚠️  発話ブロックに割れませんでした。よくある原因は次の2つです。');
    console.log('   1. 画面収録に**システム音**が混ざっている（動画の音が鳴り続けて途切れない）');
    console.log('   2. 声が小さすぎて、部屋の音と区別がつかない（マイクを近づける／入力を上げる）');
    console.log('   docs/video/atereco.md「撮る前に確かめる」を見てください。');
    console.log('');
  }

  // 無音の反転＝発話ブロック。短すぎるもの（咳・椅子の音）は捨てる
  const blocks = toBlocks(silences);

  /**
   * 声を別録り（ボイスメモ等）したときの、画面収録との時刻の差（秒）。
   * 表に「画面収録では何分何秒か」を併記するためだけに使う。切り出しには影響しない。
   *   --offset 12.5  … 声の 0秒 が、画面収録の 12.5秒 にあたる
   */
  const offset = Number(arg('offset') ?? 0);

  const data = {
    _note: [
      'アテレコの対応表。blocks の各行に人が chapter を書き込む（対応する章の ID。捨てるなら "skip"）。',
      'どの章か迷ったら、画面収録を開いてそのブロックの時刻を見る（再生位置が映っている）。',
      ...(offset ? [`声を別録りしたので、画面収録の時刻 = 声の時刻 + ${offset}秒（screen 列がそれ）。`] : []),
      '動画を止めて喋っていた区間は paused: true を書く（映像側の尺を伸ばす候補になる）。',
      `章の ID: ${chapterIds.join(' / ')}`,
    ],
    source: `voice/${slug}/atereco.wav`,
    ...(offset ? { offset } : {}),
    blocks: blocks.map((b, i) => ({
      n: i + 1,
      start: b.start,
      end: b.end,
      dur: r1(b.end - b.start),
      ...(offset ? { screen: r1(b.start + offset) } : {}),
      text: '',
      chapter: '',
    })),
  };
  writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`発話ブロック ${blocks.length}個 → voice/${slug}.atereco.json`);
  console.log('次: --sheet --srt <文字起こし> で本文を割り付け');
}

/* ---------- --sheet ---------- */

/** SRT を {start,end,text} の配列へ。時刻は 00:00:00,000 形式 */
function parseSrt(text) {
  const toSec = (t) => {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
  };
  const segs = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.trim().split('\n');
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [a, b] = timeLine.split('-->');
    const body = lines.slice(lines.indexOf(timeLine) + 1).join(' ').trim();
    if (body) segs.push({ start: toSec(a), end: toSec(b), text: body });
  }
  return segs;
}

if (process.argv.includes('--sheet')) {
  if (!existsSync(DATA)) {
    console.error('先に --blocks を。');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const srt = arg('srt');
  const json = arg('json');
  let segs = [];
  if (srt) segs = parseSrt(readFileSync(resolve(srt), 'utf8'));
  else if (json) {
    // whisper の verbose_json（{segments:[{start,end,text}]}）か、素の配列
    const raw = JSON.parse(readFileSync(resolve(json), 'utf8'));
    segs = (raw.segments ?? raw).map((s) => ({ start: s.start, end: s.end, text: String(s.text).trim() }));
  } else {
    console.error('--srt <file> か --json <file> で文字起こしを渡してください');
    process.exit(1);
  }

  // 各セグメントを、中点が入っているブロックへ割り付ける
  for (const b of data.blocks) b.text = '';
  for (const seg of segs) {
    const mid = (seg.start + seg.end) / 2;
    const hit =
      data.blocks.find((b) => mid >= b.start && mid <= b.end) ??
      // どのブロックにも入らない（しきい値の隙間）ときは、いちばん近いブロックへ
      data.blocks.reduce((best, b) => {
        const d = Math.min(Math.abs(b.start - mid), Math.abs(b.end - mid));
        return !best || d < best.d ? { b, d } : best;
      }, null)?.b;
    if (hit) hit.text = hit.text ? `${hit.text} ${seg.text}` : seg.text;
  }
  writeFileSync(DATA, `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  // 人が見て章を割り当てるための表（ビュー。書き込むのは json のほう）
  const lines = [
    `# アテレコ対応表 ── ${slug}`,
    '',
    '**chapter 列を `voice/' + slug + '.atereco.json` に書き込むこと**（ここは見るだけの表）。',
    '迷ったら画面収録のその時刻を開く。動画を止めて喋った区間は `paused: true` も。',
    '',
    // 声を別録りしたときは「画面収録では何分何秒か」も並べる（そこを開いて章を決めるため）
    data.offset ? '| # | 音声 | 画面収録 | 長さ | 発話 | 章 |' : '| # | 音声 | 長さ | 発話 | 章 |',
    data.offset ? '|---|---|---|---|---|---|' : '|---|---|---|---|---|',
    ...data.blocks.map((b) =>
      data.offset
        ? `| ${b.n} | ${mmss(b.start)}〜${mmss(b.end)} | **${mmss(b.screen ?? b.start)}** | ${b.dur}s | ${b.text || '（無音側？）'} | ${b.chapter || '　'} |`
        : `| ${b.n} | ${mmss(b.start)}〜${mmss(b.end)} | ${b.dur}s | ${b.text || '（無音側？）'} | ${b.chapter || '　'} |`,
    ),
  ];
  const sheetPath = resolve(ROOT, 'voice', `${slug}.atereco.md`);
  writeFileSync(sheetPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`割り付けました: voice/${slug}.atereco.json（表: voice/${slug}.atereco.md）`);
  console.log('次: json の各ブロックに chapter を書いてから --cut');
}

/* ---------- --cut ---------- */

if (process.argv.includes('--cut')) {
  const data = JSON.parse(readFileSync(DATA, 'utf8'));
  const unassigned = data.blocks.filter((b) => !b.chapter);
  if (unassigned.length > 0) {
    console.error(`chapter が空のブロックが ${unassigned.length}個あります（捨てるなら "skip" と書く）: ${unassigned.map((b) => b.n).join(', ')}`);
    process.exit(1);
  }
  const bad = data.blocks.filter((b) => b.chapter !== 'skip' && !chapterIds.includes(b.chapter));
  if (bad.length > 0) {
    console.error(`EDL に無い章です: ${bad.map((b) => `#${b.n}=${b.chapter}`).join(', ')}`);
    console.error(`章の ID: ${chapterIds.join(' / ')}`);
    process.exit(1);
  }

  /**
   * `--keep-gaps` … ブロックを詰めずに、**章の最初から最後までを丸ごと**切り出す。
   *
   * 1本通しで喋った収録では、こちらが正しい。ブロックを詰めると
   * 「間」が消えて息継ぎが不自然になるうえ、**文字起こしの時刻がそのまま使えなくなる**
   * （字幕を作り直す羽目になり、ズレの温床になる）。
   * 間が全体の1割程度なら、そのまま残したほうが喋りのリズムが生きる。
   *
   * 詰めたいのは「録り直しを何度もして、要らない区間が多い」収録のとき（既定の --cut）。
   */
  const keepGaps = process.argv.includes('--keep-gaps');
  const humanDir = resolve(VOICE_DIR, 'human');
  mkdirSync(humanDir, { recursive: true });
  const starts = {};
  for (const ch of chapterIds) {
    const blocks = data.blocks.filter((b) => b.chapter === ch);
    if (blocks.length === 0) continue;
    if (keepGaps) {
      const from = blocks[0].start;
      const to = blocks[blocks.length - 1].end;
      const out = resolve(humanDir, `${ch}.wav`);
      execFileSync('ffmpeg', ['-y', '-ss', String(from), '-to', String(to), '-i', WAV, out],
        { stdio: ['ignore', 'ignore', 'ignore'] });
      starts[ch] = from;
      console.log(`  ${ch}: ${from}〜${to}s を丸ごと → human/${ch}.wav（${r1(to - from)}s）`);
      continue;
    }
    // ブロックを 0.35秒の間でつないで、章の声にする
    const parts = blocks.map((b, i) => `[0:a]atrim=${b.start}:${b.end},asetpts=PTS-STARTPTS[p${i}]`);
    const gaps = blocks.slice(1).map((_, i) => `anullsrc=r=48000:cl=mono,atrim=0:0.35[g${i}]`);
    const seq = blocks.map((_, i) => (i === 0 ? '[p0]' : `[g${i - 1}][p${i}]`)).join('');
    const filter = [...parts, ...gaps, `${seq}concat=n=${blocks.length * 2 - 1}:v=0:a=1[out]`].join(';');
    const out = resolve(humanDir, `${ch}.wav`);
    execFileSync('ffmpeg', ['-y', '-i', WAV, '-filter_complex', filter, '-map', '[out]', out], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    const total = r1(blocks.reduce((a, b) => a + b.dur, 0) + (blocks.length - 1) * 0.35);
    console.log(`  ${ch}: ブロック ${blocks.map((b) => b.n).join('+')} → human/${ch}.wav（${total}s）`);
  }
  if (keepGaps) {
    // 章の声が録音のどこから始まるか。字幕の時刻を録音から引き写すのに要る
    const map = resolve(ROOT, 'voice', `${slug}.human-starts.json`);
    writeFileSync(map, `${JSON.stringify(starts, null, 2)}\n`, 'utf8');
    console.log(`\n章ごとの開始時刻: voice/${slug}.human-starts.json（字幕を録音から作るときに使う）`);
  }
  console.log('\n切り出しました。voice.mjs --mux が人の声を優先します。次: --check で尺を見比べる');
}

/* ---------- --check ---------- */

if (process.argv.includes('--check')) {
  const humanDir = resolve(VOICE_DIR, 'human');
  console.log(`\n章ごとの「声の長さ」と「映像の尺」（${slug}）`);
  console.log('声が長い章は、映像側を伸ばす（動画を止めて喋った区間はここに出る）\n');
  let over = 0;
  for (const ch of edl.chapters) {
    const wav = resolve(humanDir, `${ch.id}.wav`);
    if (!existsSync(wav)) {
      console.log(`  ${ch.id.padEnd(10)} 声なし（合成のまま）`);
      continue;
    }
    const sec = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString(),
    );
    const mark = sec > ch.dur ? ' ← 声が映像より長い。章の dur を伸ばすか、間を詰める' : '';
    if (sec > ch.dur) over += 1;
    console.log(`  ${ch.id.padEnd(10)} 声 ${r1(sec)}s / 映像 ${ch.dur}s${mark}`);
  }
  console.log(over === 0 ? '\n全章、映像に収まっています。' : `\n${over}章は映像側の調整が要ります。`);
}

/* ---------- --tighten ---------- */

/**
 * 章ごとの声から**間（ま）を詰める**。
 *
 * 1本通しで喋ると、考えている時間・言い直し・場面が変わるところで必ず間ができる。
 * 喋っているぶんには自然でも、動画にすると「テンポが悪い」になる（001のFB）。
 *
 * やること: 一定より長い無音を、決めた長さまで縮める。**喋りは1文字も削らない**。
 * 同時に「元の時刻 → 詰めたあとの時刻」の対応表を出すので、
 * 字幕と映像の時刻をそのまま引き直せる（ズレようがない）。
 *
 *   node scripts/atereco.mjs edl/<slug>.json --tighten [--keep 0.35] [--min 0.6]
 *     --keep  残す間の長さ（既定 0.35秒）
 *     --min   これより長い無音を詰める（既定 0.6秒）
 */
if (process.argv.includes('--tighten')) {
  const KEEP = Number(arg('keep') ?? 0.35);
  const MIN = Number(arg('min') ?? 0.6);
  const humanDir = resolve(VOICE_DIR, 'human');
  const maps = {};
  for (const ch of chapterIds) {
    const src = resolve(humanDir, `${ch}.wav`);
    if (!existsSync(src)) continue;
    const dur = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString(),
    );
    const stderr = spawnSync('ffmpeg', ['-i', src, '-af', `silencedetect=noise=-35dB:d=${MIN}`, '-f', 'null', '-'],
      { encoding: 'utf8' }).stderr;
    const sil = [];
    let st = null;
    for (const line of stderr.split('\n')) {
      const a = /silence_start: (-?[\d.]+)/.exec(line);
      const b = /silence_end: ([\d.]+)/.exec(line);
      if (a) st = Math.max(0, Number(a[1]));
      if (b && st !== null) { sil.push([st, Number(b[1])]); st = null; }
    }
    if (st !== null) sil.push([st, dur]);

    // 残す区間（喋り＋詰めた間）を組み立てる
    const keeps = [];
    let cur = 0;
    for (const [a, b] of sil) {
      if (a > cur) keeps.push([cur, Math.min(a + KEEP / 2, b)]);
      cur = Math.max(cur, b - KEEP / 2);
    }
    if (dur > cur) keeps.push([cur, dur]);
    const merged = keeps.filter(([a, b]) => b - a > 0.02);
    const total = merged.reduce((x, [a, b]) => x + (b - a), 0);
    if (merged.length <= 1 || dur - total < 0.2) { maps[ch] = { dur, cuts: [] }; continue; }

    const filter = merged.map(([a, b], i) => `[0:a]atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=PTS-STARTPTS[p${i}]`)
      .join(';') + ';' + merged.map((_, i) => `[p${i}]`).join('') + `concat=n=${merged.length}:v=0:a=1[out]`;
    const out = resolve(humanDir, `${ch}.wav`);
    const tmp = resolve(humanDir, `_${ch}.wav`);
    execFileSync('ffmpeg', ['-y', '-i', src, '-filter_complex', filter, '-map', '[out]', tmp],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    execFileSync('mv', [tmp, out]);
    maps[ch] = { dur: r1(total), cuts: merged.map(([a, b]) => [r1(a), r1(b)]) };
    console.log(`  ${ch}: ${r1(dur)}s → ${r1(total)}s（${r1(dur - total)}s 詰めた）`);
  }
  const mapPath = resolve(ROOT, 'voice', `${slug}.tighten.json`);
  writeFileSync(mapPath, `${JSON.stringify(maps, null, 1)}\n`, 'utf8');
  console.log(`\n対応表: voice/${slug}.tighten.json（字幕と映像の時刻を引き直すのに使う）`);
}
