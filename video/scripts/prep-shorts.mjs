#!/usr/bin/env node
/**
 * ショートの下ごしらえ。レシピ（edl/shorts/*.json）を読み、
 *
 *  1. 拍ごとの声を human/<章>.wav から切り出す → public/shorts-voice/<id>/beat-N.wav
 *  2. 拍の長さ（dur）を声の実測に合わせて書き戻す
 *  3. その範囲の字幕を voice/<slug>.json から拾って、拍の subs に注入する（gen印つき）
 *
 * 声と字幕が同じ出所（本編のアテレコ）から機械的に来るので、ズレようがない。
 *
 *   node scripts/prep-shorts.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SLUG = '001-nuimichi';

// ずんだもんナレ（VOICEVOX ローカルエンジン）。
// 起動: docker run -d --rm --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-latest
// 公開時は「VOICEVOX:ずんだもん」のクレジット表記が必須（利用規約）
const TTS_URL = 'http://127.0.0.1:50021';
const TTS_SPEAKER = 3; // ずんだもん ノーマル
const voice = JSON.parse(readFileSync(resolve(ROOT, 'voice', `${SLUG}.json`), 'utf8'));

// 語単位の境界検査（scripts/transcribe-words.mjs が作る。無ければ検査なしで進む）
const wordsPath = resolve(ROOT, 'voice', `${SLUG}.words.json`);
let WORDS = null;
try { WORDS = JSON.parse(readFileSync(wordsPath, 'utf8')); } catch { /* まだ作っていない */ }

/**
 * 切り出し境界が安全かを語タイムスタンプで見る。
 * 001の実害: 語の途中で切れる（スピードかなり上がっ//て）／
 * 尻の+0.05秒に次の語頭が混ざる（…ました。**いが**）。
 * 語中切りが正しい場合もある（フィラーが語に併合されて転記されるとき）ので、
 * 止めずに⚠️で列挙する。**未確認の⚠️を残したまま出さない**のが運用。
 */
const checkBoundary = (id, ch, t, kind) => {
  const ws = WORDS?.[ch];
  if (!ws) return 0;
  let n = 0;
  const inside = ws.find((w) => w.s + 0.04 < t && t < w.e - 0.04);
  if (inside) {
    console.log(`  ⚠️ ${id} ${ch} ${kind}${t}s は「${inside.w}」(${inside.s}〜${inside.e}) の最中。語境界: ${inside.s} / ${inside.e}`);
    n++;
  }
  if (kind === '尻') {
    const next = ws.find((w) => w.s >= t - 0.01 && w.s < t + 0.07);
    if (next) {
      console.log(`  ⚠️ ${id} ${ch} 尻${t}s のすぐ後 ${next.s}s に「${next.w}」の頭。切り出しの+0.05秒で混ざるかも`);
      n++;
    }
  }
  return n;
};

const dir = resolve(ROOT, 'edl/shorts');
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const path = resolve(dir, f);
  const r = JSON.parse(readFileSync(path, 'utf8'));
  const outDir = resolve(ROOT, 'public/shorts-voice', r.id);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  let warns = 0;
  r.beats.forEach((b, i) => {
    // テロップだけの拍に、ずんだもんの声を合成して当てる
    if (!b.voiceSrc && b.tts) {
      const out = resolve(outDir, `beat-${i}.wav`);
      let q;
      try {
        q = JSON.parse(execFileSync('curl', ['-s', '-m', '10', '-X', 'POST',
          `${TTS_URL}/audio_query?speaker=${TTS_SPEAKER}&text=${encodeURIComponent(b.tts)}`]).toString());
      } catch {
        console.error(`✗ VOICEVOX に繋がらない。起動: docker run -d --rm --name voicevox -p 50021:50021 voicevox/voicevox_engine:cpu-latest`);
        process.exit(1);
      }
      q.speedScale = b.ttsSpeed ?? 1.2;   // ショートの速さに合わせて少し早口
      q.volumeScale = 0.9;                // 人の声より前に出すぎない
      q.prePhonemeLength = 0.04;
      q.postPhonemeLength = 0.06;
      const raw = resolve(outDir, `tts-${i}-raw.wav`);
      execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json',
        '-d', JSON.stringify(q), `${TTS_URL}/synthesis?speaker=${TTS_SPEAKER}`, '-o', raw]);
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-ar', '48000',
        '-af', 'afade=t=in:st=0:d=0.02', out]);
      rmSync(raw);
      const spoken = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
      b.voice = true;
      if (spoken > b.dur - 0.06) {
        console.log(`  ⚠️ ${r.id} 拍${i} のずんだもん「${b.tts}」が ${spoken.toFixed(2)}s で拍(${b.dur}s)からはみ出す。ttsSpeed か dur を調整`);
        warns++;
      }
      return;
    }
    if (!b.voiceSrc) { delete b.voice; return; }
    const { ch, from, to, parts } = b.voiceSrc;
    for (const seg of parts ?? [{ from, to }]) {
      warns += checkBoundary(r.id, ch, seg.from, '頭');
      warns += checkBoundary(r.id, ch, seg.to, '尻');
    }
    const src = resolve(ROOT, 'voice', SLUG, 'human', `${ch}.wav`);
    const out = resolve(outDir, `beat-${i}.wav`);
    let dur;
    if (parts) {
      // 中抜き（「うーん…糸通しではないですね」のように、間の言い回しを飛ばして繋ぐ）。
      // 各切れ端の頭と尻にフェードを入れてから繋ぐと、ジャンプカットでもプツッと鳴らない
      dur = parts.reduce((a, pt) => a + (pt.to - pt.from), 0);
      const chains = parts.map((pt, k) => {
        const d = pt.to - pt.from;
        return `[0:a]atrim=start=${pt.from}:end=${pt.to},asetpts=N/SR/TB,` +
          `afade=t=in:st=0:d=0.04,afade=t=out:st=${(d - 0.06).toFixed(3)}:d=0.06[p${k}]`;
      });
      const filter = `${chains.join(';')};${parts.map((_, k) => `[p${k}]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`;
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-filter_complex', filter, '-map', '[out]', out]);
    } else {
      dur = to - from;
      // 頭と尻に短いフェード（本編と同じ。直切りはプツッと鳴る）
      execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', String(from), '-to', String(to + 0.05), '-i', src,
        '-af', `afade=t=in:st=0:d=0.04,afade=t=out:st=${(dur - 0.02).toFixed(3)}:d=0.06`, out]);
    }
    b.voice = true;
    // 拍間の間はほぼゼロ（0.1）。最終拍だけ余韻を持たせる（急に切れると気持ち悪い）
    const isLast = i === r.beats.length - 1;
    const delay = b.voiceDelay ?? 0;
    b.dur = Number((delay + dur + (isLast ? 0.9 : 0.1)).toFixed(2));
    // 字幕を同じ範囲から注入（手書き subs は gen が付いていないものだけ残す）。
    // 中抜き（parts）の拍は転記と声が一致しなくなるので、字幕は手書きに任せる
    const keep = (b.subs ?? []).filter((s) => !s.gen);
    const lines = (parts || b.noAutoSubs ? [] : voice.chapters[ch] ?? [])
      .filter((l) => l.at + l.dur > from + 0.05 && l.at < to - 0.05)
      .map((l) => ({
        at: Number((Math.max(0, l.at - from) + delay).toFixed(2)),
        dur: Number(Math.min(l.dur, b.dur - Math.max(0, l.at - from) - 0.05).toFixed(2)),
        t: l.t,
        gen: true,
      }));
    b.subs = [...keep, ...lines];
  });

  writeFileSync(path, `${JSON.stringify(r, null, 2)}\n`, 'utf8');
  const total = r.beats.reduce((a, b) => a + b.dur, 0);
  console.log(`${r.id}: ${r.beats.length}拍 / ${total.toFixed(1)}秒${warns ? `（⚠️ 境界の要確認 ${warns}件 — 耳かレンダで確認済みならOK）` : ''}`);
}
