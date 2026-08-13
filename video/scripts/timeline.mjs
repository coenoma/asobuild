#!/usr/bin/env node
/**
 * 収録カンペのログ（.live/status.jsonl）を「画面収録の何分何秒か」に変換する。
 *
 * 編集でいちばん事故るのは、テロップの文言と時刻を手で書き写すこと。
 * ログには絶対時刻つきで全部残っているので、引いてくればずれない。
 *
 *   node scripts/timeline.mjs --rec-start "2026-08-12T16:32:09+09:00" --len 2940
 *
 * --rec-start は画面収録が始まった時刻。メニューバーの時計から実測して入れる。
 *   （ffmpeg で切り出して目で読む。creation_time はファイル確定時刻なのであてにしない）
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LOG = resolve(HERE, '../../.live/status.jsonl');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const recStart = Date.parse(arg('rec-start', ''));
if (Number.isNaN(recStart)) {
  console.error('--rec-start に画面収録の開始時刻を ISO8601 で渡してください');
  console.error('例: node scripts/timeline.mjs --rec-start "2026-08-12T16:32:09+09:00"');
  process.exit(1);
}
const len = Number(arg('len', '99999'));
const json = process.argv.includes('--json');

const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const rows = readFileSync(LOG, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .map((r) => ({ ...r, at: (r.t - recStart) / 1000 }))
  .filter((r) => r.at >= -30 && r.at <= len + 30);

const out = rows.map((r) => {
  if (r.kind === 'gate') {
    const failed = (r.checks ?? []).filter((c) => !c.pass).map((c) => c.label);
    return { at: r.at, kind: 'gate', slug: r.slug, pass: r.pass, failed };
  }
  if (r.kind === 'say') return { at: r.at, kind: 'say', text: r.text };
  if (r.kind === 'phase') return { at: r.at, kind: 'phase', phase: r.phase };
  if (r.kind === 'timer') return { at: r.at, kind: 'timer', ...r };
  return { at: r.at, kind: r.kind };
});

if (json) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log('画面収録の時刻   できごと');
  console.log('──────────────────────────────────────────────────────────');
  for (const r of out) {
    let line;
    if (r.kind === 'gate') {
      line = r.pass
        ? `ゲート ${r.slug} ぜんぶ緑`
        : `ゲート ${r.slug} 落ちた → ${r.failed.join(' / ')}`;
    } else if (r.kind === 'say') line = `★ ひとこと「${r.text}」`;
    else if (r.kind === 'phase') line = `フェーズ ${r.phase}`;
    else if (r.kind === 'timer') line = `タイマー ${r.action} ${r.seconds ?? ''} ${r.label ?? ''}`;
    else line = r.kind;
    console.log(`${mmss(r.at).padEnd(16)} ${line}`);
  }
}
