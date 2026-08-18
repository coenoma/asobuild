#!/usr/bin/env node
/**
 * アテレコ全章を**語単位**のタイムスタンプで転記して貯める。
 *
 *   node scripts/transcribe-words.mjs [slug]   # 既定: 001-nuimichi
 *
 * なぜ要るか。ショートの声は本編アテレコから秒指定で切り出すが、
 * 文単位の転記（voice/<slug>.json）の時刻をアテに切ると、
 * 語の途中で切れる・次の語が混ざる・言ってない字幕を作る（001で実害5件超）。
 * 切る前に語の境界を数字で見られるよう、章ごとの語タイムスタンプを
 * voice/<slug>.words.json に一度だけ作っておく。prep-shorts が境界検査に使う。
 *
 * 済みの章はスキップする（録り直したら --force で作り直す）。
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '001-nuimichi';
const force = process.argv.includes('--force');

const humanDir = resolve(ROOT, 'voice', slug, 'human');
const outPath = resolve(ROOT, 'voice', `${slug}.words.json`);
const db = existsSync(outPath) && !force ? JSON.parse(readFileSync(outPath, 'utf8')) : {};

const pickWords = (o, acc) => {
  if (Array.isArray(o)) { for (const v of o) pickWords(v, acc); return acc; }
  if (o && typeof o === 'object') {
    if (typeof o.word === 'string' && typeof o.start === 'number') {
      acc.push({ w: o.word, s: Number(o.start.toFixed(2)), e: Number(o.end.toFixed(2)) });
      return acc;
    }
    for (const v of Object.values(o)) pickWords(v, acc);
  }
  return acc;
};

for (const f of readdirSync(humanDir)) {
  if (extname(f) !== '.wav') continue;
  const ch = basename(f, '.wav');
  if (db[ch]?.length) { console.log(`${ch}: 済み（${db[ch].length}語）`); continue; }
  const mp3 = resolve(tmpdir(), `words-${slug}-${ch}.mp3`);
  const json = resolve(tmpdir(), `words-${slug}-${ch}.json`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', resolve(humanDir, f), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', mp3]);
  execFileSync('pm', ['transcribe-local', mp3, '-p', 'simple', '-f', 'json', '--no-diarize', '-o', json], { stdio: 'ignore' });
  const words = pickWords(JSON.parse(readFileSync(json, 'utf8')), []);
  db[ch] = words;
  writeFileSync(outPath, `${JSON.stringify(db)}\n`, 'utf8');   // 章ごとに保存（途中で止めても再開できる）
  console.log(`${ch}: ${words.length}語`);
}
console.log(`→ ${outPath}`);
