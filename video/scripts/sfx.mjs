#!/usr/bin/env node
/**
 * 動画の効果音を、ゲームと同じ音源で作る。
 *
 * src/arcade/sfx.ts は WebAudio で矩形波を合成しているだけなので、
 * 同じ計算を Node でやって WAV に落とせば、音源ファイルを買ってこなくてよい。
 * **効果音を外から持ってくると、そこだけ音の質感が変わって浮く。**
 *
 *   node scripts/sfx.mjs        → public/sfx/*.wav
 *
 * 音の定義（周波数・長さ・音量）は sfx.ts と一致させること。
 * あちらを変えたらこちらも変える。ずれると動画とゲームで同じ音が違って聞こえる。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/sfx');
const SR = 48000;

/** sfx.ts の N と同じ */
const N = {
  C3: 130.81, G3: 196.0,
  C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760.0,
  C7: 2093.0,
};

/** 波形1周期ぶんの値。position は 0〜1 */
function wave(type, p) {
  switch (type) {
    case 'triangle': return 4 * Math.abs(p - 0.5) - 1;
    case 'sawtooth': return 2 * (p - Math.floor(p + 0.5));
    case 'sine': return Math.sin(p * Math.PI * 2);
    default: return p < 0.5 ? 1 : -1; // square
  }
}

/**
 * 1音を書き込む。WebAudio の exponentialRampToValueAtTime と同じ曲線にする
 * （線形フェードだと当時のピコピコに聞こえない。減衰が速いのが特徴）
 */
function renderNote(buf, startSec, { freq, to, dur, type = 'square', vol = 0.12, hold = 0, detune = 0 }) {
  const n = Math.floor(dur * SR);
  const start = Math.floor(startSec * SR);
  const holdN = Math.floor(Math.min(hold, dur) * SR);
  let phase = 0;
  let phase2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    // 周波数の滑らせ（指数）
    const f = to ? freq * Math.pow(Math.max(1, to) / freq, x) : freq;
    // 音量。hold のあいだは保ち、そのあと指数で落とす。
    // ジングルは伸びが要るので保つ時間を持たせた（効果音は hold=0 で従来どおり）
    let g;
    if (i < holdN) {
      // 立ち上がりの 5ms だけ滑らかにする（ぶつっと切れる音を防ぐ）
      g = vol * Math.min(1, i / (SR * 0.005));
    } else {
      const y = (i - holdN) / Math.max(1, n - holdN);
      g = vol * Math.pow(0.0001 / vol, y);
    }
    phase += f / SR;
    if (phase >= 1) phase -= Math.floor(phase);
    let v = wave(type, phase);
    // わずかにずらした同じ音を重ねると厚みが出る（当時の重ね方）
    if (detune) {
      phase2 += (f * (1 + detune)) / SR;
      if (phase2 >= 1) phase2 -= Math.floor(phase2);
      v = (v + wave(type, phase2)) * 0.5;
    }
    const idx = start + i;
    if (idx < buf.length) buf[idx] += v * g;
  }
}

/**
 * 風切り音。矩形波では作れないので雑音を1本足す。
 * 高い雑音から低い雑音へ落とすと「シュッ」、逆だと「シュワッ」になる。
 */
function renderNoise(buf, startSec, { dur, from = 1.0, to = 0.05, vol = 0.1 }) {
  const n = Math.floor(dur * SR);
  const start = Math.floor(startSec * SR);
  let lp = 0;
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    // 決まった並びの疑似乱数（毎回同じ音になるように）
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = (seed / 0x3fffffff) - 1;
    // 一次ローパスの係数を動かして、明るさを滑らせる
    const k = from * Math.pow(to / from, x);
    lp += (white - lp) * k;
    const g = vol * Math.sin(Math.PI * x); // 山なりに出して山なりに消す
    const idx = start + i;
    if (idx < buf.length) buf[idx] += lp * g;
  }
}

function seqLength(notes, gap) {
  return notes.reduce((a, n) => a + n.d + gap, 0);
}

/** 和音つきの並び。当時のケータイにならって同時発音は3音まで */
function renderSequence(notes, { type = 'square', gap = 0.012, vol = 0.1 } = {}) {
  const total = seqLength(notes, gap) + 0.2;
  const buf = new Float64Array(Math.ceil(total * SR));
  let at = 0;
  for (const note of notes) {
    const freqs = (Array.isArray(note.f) ? note.f : [note.f]).filter((f) => f > 0).slice(0, 3);
    const v = (note.v ?? vol) / Math.max(1, freqs.length);
    for (const f of freqs) renderNote(buf, at, { freq: f, dur: note.d, type, vol: v });
    at += note.d + gap;
  }
  return buf;
}

function renderBeep(opts) {
  const buf = new Float64Array(Math.ceil((opts.dur + 0.15) * SR));
  renderNote(buf, 0, opts);
  return buf;
}

/**
 * ピークを揃える。
 *
 * sfx.ts の音量（0.07〜0.14）はゲームの中で鳴らす前提の値で、そのまま WAV にすると
 * ピーク -20dB あたりになり、ナレーションに埋もれる。合成の忠実さは保ったまま、
 * **書き出しのときだけ**音量を揃える（動画とゲームでは鳴らす場所が違う）。
 */
function normalize(samples, peakDb = -12) {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  if (peak === 0) return samples;
  const target = Math.pow(10, peakDb / 20);
  const gain = target / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return samples;
}

/** 16bit PCM モノラルの WAV にする */
function toWav(samples) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return b;
}

/** sfx.ts の各メソッドと1対1で対応させる */
const SOUNDS = {
  // 押した感触。テロップが出るときに使う
  tap: () => renderBeep({ freq: 660, dur: 0.04, vol: 0.07 }),
  // 加点。数字が確定したとき
  score: () => renderBeep({ freq: 880, dur: 0.06, vol: 0.1 }),
  // 連続成功の3段。積み上がる感じが要るとき
  combo: () => renderSequence([{ f: 715, d: 0.06 }, { f: 770, d: 0.06 }, { f: 825, d: 0.06 }]),
  // 失敗・被弾。ゲートに落ちたとき
  hit: () => renderBeep({ freq: 220, to: 90, dur: 0.16, type: 'sawtooth', vol: 0.12 }),
  // ゲームオーバー
  over: () => renderBeep({ freq: 330, to: 70, dur: 0.5, type: 'triangle', vol: 0.14 }),
  /**
   * タイトルコール。**この番組の名刺**なので、毎回まったく同じものを使う。
   * 型: 低い土台 → 駆け上がり4音 → 大きな和音 → 上のきらめき。
   * ケータイの3和音でできる範囲に収めてある（同時発音は3つまで）。
   */
  title: () => {
    const buf = new Float64Array(Math.ceil(2.6 * SR));
    // 土台。低い音を伸ばすと、上の音が軽く聞こえない
    renderNote(buf, 0.0, { freq: N.C3, dur: 2.3, type: 'triangle', vol: 0.10, hold: 1.5, detune: 0.004 });
    // 駆け上がり
    const run = [N.G4, N.C5, N.E5, N.G5];
    run.forEach((f, i) => renderNote(buf, 0.06 + i * 0.085, { freq: f, dur: 0.11, vol: 0.09 }));
    // 着地の和音。ここが「アソビルド」のところ
    [N.C6, N.E6, N.G6].forEach((f) =>
      renderNote(buf, 0.42, { freq: f, dur: 1.5, vol: 0.055, hold: 0.85, detune: 0.003 }));
    // 上のきらめき（余韻）
    [[N.E6, 1.02], [N.G6, 1.12], [N.C7, 1.22]].forEach(([f, at]) =>
      renderNote(buf, at, { freq: f, dur: 0.5, type: 'triangle', vol: 0.05 }));
    return buf;
  },
  // 場面が変わる直前の風切り。判子の直前に置く
  swipe: () => {
    const buf = new Float64Array(Math.ceil(0.5 * SR));
    renderNoise(buf, 0, { dur: 0.34, from: 0.9, to: 0.03, vol: 0.13 });
    return buf;
  },
  // 判子が出た瞬間の一撃
  stampHit: () => {
    const buf = new Float64Array(Math.ceil(0.9 * SR));
    renderNote(buf, 0, { freq: N.C3, dur: 0.55, type: 'triangle', vol: 0.14, hold: 0.1 });
    renderNote(buf, 0, { freq: N.C6, dur: 0.22, vol: 0.08 });
    renderNoise(buf, 0, { dur: 0.12, from: 0.9, to: 0.2, vol: 0.08 });
    return buf;
  },
  // 打鍵。依頼文を送るところ
  type: () => renderBeep({ freq: 1200, to: 900, dur: 0.03, vol: 0.06 }),
  // 「ここを見て」の枠が締まる音
  reveal: () => {
    const buf = new Float64Array(Math.ceil(0.4 * SR));
    renderNote(buf, 0, { freq: N.A5, dur: 0.07, vol: 0.07 });
    renderNote(buf, 0.07, { freq: N.E6, dur: 0.16, vol: 0.08 });
    return buf;
  },
  // 結論に入る一撃。ここだけ音を止めてから鳴らす
  sting: () => {
    const buf = new Float64Array(Math.ceil(1.6 * SR));
    renderNote(buf, 0, { freq: N.C3, dur: 1.3, type: 'triangle', vol: 0.13, hold: 0.5, detune: 0.005 });
    [N.C5, N.G5].forEach((f) => renderNote(buf, 0, { freq: f, dur: 1.1, vol: 0.06, hold: 0.35 }));
    renderNoise(buf, 0, { dur: 0.2, from: 0.95, to: 0.3, vol: 0.09 });
    return buf;
  },
  // 締め。タイトルコールの終わり方を裏返して、終わった感じを出す
  outro: () => {
    const buf = new Float64Array(Math.ceil(2.8 * SR));
    renderNote(buf, 0, { freq: N.C3, dur: 2.5, type: 'triangle', vol: 0.09, hold: 1.7, detune: 0.004 });
    const run = [N.C5, N.E5, N.G5, N.C6];
    run.forEach((f, i) => renderNote(buf, 0.05 + i * 0.14, { freq: f, dur: 0.16, vol: 0.07 }));
    [N.C6, N.E6, N.G6].forEach((f) =>
      renderNote(buf, 0.62, { freq: f, dur: 1.7, vol: 0.05, hold: 1.0, detune: 0.003 }));
    return buf;
  },
  // 章の切り替え
  jingleStart: () => renderSequence([{ f: N.G5, d: 0.07 }, { f: [N.C6, N.E6], d: 0.16 }]),
  // 記録更新
  best: () => renderSequence([
    { f: N.C6, d: 0.09 }, { f: N.E6, d: 0.09 }, { f: N.G6, d: 0.09 },
    { f: [N.C6, N.E6, N.G6], d: 0.34 },
  ]),
  // 称号・ゲート全部緑。いちばん派手
  jingleGoal: () => renderSequence([
    { f: [N.C5, N.E5], d: 0.1 }, { f: [N.E5, N.G5], d: 0.1 },
    { f: [N.G5, N.C6], d: 0.1 }, { f: [N.C6, N.E6, N.G6], d: 0.45 },
  ]),
  // 力尽きた。下がりながら消える
  jingleOver: () => renderSequence(
    [{ f: [N.G4, N.B4], d: 0.13 }, { f: [N.E4, N.G4], d: 0.13 }, { f: [N.C4, N.E4], d: 0.42 }],
    { type: 'triangle', vol: 0.13 },
  ),
  // カウントダウン
  tick: () => renderBeep({ freq: 440, dur: 0.03, vol: 0.06, type: 'triangle' }),
};

mkdirSync(OUT, { recursive: true });
for (const [name, make] of Object.entries(SOUNDS)) {
  const wav = toWav(normalize(make()));
  writeFileSync(resolve(OUT, `${name}.wav`), wav);
  console.log(`${name}.wav  ${(wav.length / 1024).toFixed(0)}KB`);
}
console.log(`\n${Object.keys(SOUNDS).length}個 書き出しました → public/sfx/`);
