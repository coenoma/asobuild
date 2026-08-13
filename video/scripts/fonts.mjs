#!/usr/bin/env node
/**
 * 書体を取ってくる。
 *
 * サイト（src/app/globals.css の --font-dot）が Noto Sans JP を指しているので、
 * 動画も同じ書体で描く。**サイトと動画で見た目を揃えるため。**
 *
 *   node scripts/fonts.mjs        → public/fonts/NotoSansJP.ttf
 *
 * @remotion/google-fonts は使わない。日本語は 100 個以上の細切れに分かれていて、
 * 描画のたびに取りに行くと遅く、ネットが無いと落ちる（実際に落ちた）。
 * **1ファイル持っておくほうが速いし確実。**
 *
 * 書体はリポジトリに置かない（PUBLIC・サイズも大きい）。
 * SIL Open Font License 1.1 なので再配布自体は許されているが、
 * 取ってこられるものを抱えない方針にしている（効果音と同じ）。
 */

import { writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../public/fonts');

const FONTS = [
  {
    name: 'NotoSansJP.ttf',
    // 可変フォント1本で 100〜900 の太さが全部入る
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf',
  },
  { name: 'OFL.txt', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/OFL.txt' },
];

mkdirSync(OUT, { recursive: true });

for (const f of FONTS) {
  const path = resolve(OUT, f.name);
  if (existsSync(path) && statSync(path).size > 1000) {
    console.log(`${f.name}  すでにある（${(statSync(path).size / 1024 / 1024).toFixed(1)}MB）`);
    continue;
  }
  process.stdout.write(`${f.name} を取得中 ... `);
  const res = await fetch(f.url);
  if (!res.ok) {
    console.log(`しっぱい (${res.status})`);
    process.exitCode = 1;
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  console.log(`できた（${(buf.length / 1024 / 1024).toFixed(1)}MB）`);
}
