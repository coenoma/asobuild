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
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SLUG = '001-nuimichi';
const voice = JSON.parse(readFileSync(resolve(ROOT, 'voice', `${SLUG}.json`), 'utf8'));

const dir = resolve(ROOT, 'edl/shorts');
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const path = resolve(dir, f);
  const r = JSON.parse(readFileSync(path, 'utf8'));
  const outDir = resolve(ROOT, 'public/shorts-voice', r.id);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  r.beats.forEach((b, i) => {
    if (!b.voiceSrc) return;
    const { ch, from, to, parts } = b.voiceSrc;
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
  console.log(`${r.id}: ${r.beats.length}拍 / ${total.toFixed(1)}秒`);
}
