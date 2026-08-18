#!/usr/bin/env node
/**
 * EDL から絵コンテ（読み下せる構成表）を書き出す。
 *
 * なぜ生成するか：
 *   構成を人が別ファイルに書き写すと、EDL を直したときに必ずズレる。
 *   **ズレた構成表は、無いより悪い**（それを見て相談するので）。
 *   だから唯一の正は EDL にして、読む形はここから作る。
 *
 *   node scripts/storyboard.mjs edl/001-nuimichi.json > ../docs/video/storyboards/001-nuimichi.md
 *
 * 出てくるものには**通し番号**がついている（[3-2] = 3章目の2番目）。
 * 直したいところを「3-2 の言い回し変えて」と番号で指せるようにするため。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const edlPath = process.argv[2];
if (!edlPath) {
  console.error('使い方: node scripts/storyboard.mjs edl/<slug>.json');
  process.exit(1);
}
const edl = JSON.parse(readFileSync(resolve(process.cwd(), edlPath), 'utf8'));

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** 章の中は1秒より細かく動くので、小数第1位まで出す */
const mmssT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.round((s % 1) * 10)}`;
/** すでに「」で囲まれている文言を二重にしない */
const quote = (t) => (t.startsWith('「') ? t : `「${t}」`);
/** 番組バーに出さない章（フックと締め）にも、読むとき用の名前をつける */
const NAME = { hook: 'フック', end: 'しめ' };
const clean = (t) => String(t ?? '').replace(/\n/g, ' ／ ').replace(/\|/g, '｜');

/** 制約が尽きる開発時刻（Episode.tsx の DRAIN_AT と合わせる） */
const DRAIN_AT = 22 * 60 + 50;

/** その章で、素材が元のどこから来ているか */
function clipLabel(id) {
  const c = edl.clips[id];
  if (!c) return id;
  const src = c.src === 'self' ? '自撮り' : '画面';
  return `${c.note ?? id}〔${src} ${mmss(c.in)}〕`;
}

const L = [];
const out = (s = '') => L.push(s);

const total = edl.chapters.reduce((a, c) => a + c.dur, 0);

out(`# 絵コンテ ── ${edl.meta.title}`);
out();
out('> **このファイルは `video/edl/*.json` から生成しています。直接編集しないでください。**');
out('> 直すのは EDL 側で、こちらは `node scripts/storyboard.mjs` で作り直します。');
out('>');
out('> 各行に `[章-番号]` がついています。**「3-2 の言い回しを変えたい」のように番号で指してください。**');
out();
out(`全体 **${mmss(total)}**（${total}秒） ／ ${edl.meta.width}×${edl.meta.height} ${edl.meta.fps}fps ／ 制約「${edl.meta.constraint}」`);
out();

// ── 目次
out('## 流れ（ここだけ読めば構成が分かる）');
out();
out('| # | 章 | 時刻 | 尺 | そのとき思っていたこと |');
out('|---|---|---|---|---|');
{
  let t = 0;
  edl.chapters.forEach((ch, i) => {
    out(`| ${i + 1} | ${ch.label ?? NAME[ch.id] ?? ch.id} | ${mmss(t)} | ${ch.dur}秒 | ${clean(ch.mood) || '—'} |`);
    t += ch.dur;
  });
}
out();
out('---');
out();

// ── 章ごとの中身
let base = 0;
edl.chapters.forEach((ch, ci) => {
  const no = ci + 1;
  out(`## ${no}. ${ch.label ?? NAME[ch.id] ?? ch.id}　${mmss(base)} – ${mmss(base + ch.dur)}（${ch.dur}秒）`);
  out();
  if (ch.mood) out(`**心情**: ${clean(ch.mood)}`);
  if (ch.devFrom != null) {
    const cup = (v) => Math.max(0, Math.round((1 - v / DRAIN_AT) * 100));
    out(`**開発の時刻**: ${mmss(ch.devFrom)} → ${mmss(ch.devTo ?? ch.devFrom)}　`
      + `**カップ**: ${cup(ch.devFrom)}% → ${cup(ch.devTo ?? ch.devFrom)}%`);
  }
  out();
  out('| | 時刻 | 画 | 出る文字 | 音 |');
  out('|---|---|---|---|---|');

  // 画・文字・音を1本の時間軸に並べ、**0.4秒以内に始まるものは1行にまとめる**
  // （画とテロップはほぼ同時に出るので、分けると読みにくい）
  const events = ch.layers.map((l) => ({ ...l, at: l.at ?? 0 })).sort((a, b) => a.at - b.at);
  const groups = [];
  for (const e of events) {
    const g = groups[groups.length - 1];
    if (g && e.at - g.at < 0.4) g.items.push(e);
    else groups.push({ at: e.at, items: [e] });
  }

  let n = 0;
  for (const g of groups) {
    let pic = '';
    const texts = [];
    const sounds = [];
    for (const l of g.items) {
      if (l.type === 'shot') {
        pic = clipLabel(l.clip) + (l.box ? '（枠に収める）' : '');
      } else if (l.type === 'black') pic = '**黒**';
      else if (l.type === 'loading') pic = `**ローディング**「${clean(l.text ?? 'よみこみ中')}…」${l.note ? `（${clean(l.note)}）` : ''}`;
      else if (l.type === 'diagram') {
        pic = l.kind === 'thread' ? '**自作の図解**（うねる糸と針のめど）' : '**自作の図解**（面白さの肝をずらす）';
      } else if (l.type === 'telop') texts.push(quote(clean(l.text)));
      else if (l.type === 'number') texts.push(`［数字］**${l.value}${l.unit ?? ''}**　${clean(l.label) || ''}`);
      else if (l.type === 'gate') {
        texts.push(l.pass ? '［けんてい］**12項目ぜんぶ みどり**'
          : `［けんてい］**まだダメ** — ${(l.failed ?? []).join(' / ')}`);
      } else if (l.type === 'checklist') {
        texts.push(`［カード］${clean(l.title)} — ` + (l.items ?? []).map((i) => `${i.ok ? '○' : '×'}${i.text}`).join(' / '));
      } else if (l.type === 'chapterCard') texts.push(`［章タイトル］**${clean(l.title)}**`);
      else if (l.type === 'titleCard') texts.push(`［タイトル］**${clean(l.title)}** — ${clean(l.sub)}`);
      else if (l.type === 'endCard') {
        texts.push(`［締めのカード］**${clean(l.url)}**<br>` + (l.lines ?? []).map(clean).join('<br>'));
      } else if (l.type === 'sfx') sounds.push(l.name);
    }
    n += 1;
    out(`| \`${no}-${n}\` | ${mmssT(base + g.at)} | ${pic || '〃'} | ${texts.join('<br>') || ''} | ${sounds.join(' ')} |`);
  }

  out();
  base += ch.dur;
});

out('---');
out();
out('## 直したいときは');
out();
out('| 直すもの | どこを触るか |');
out('|---|---|');
out('| 文字（テロップ・数字・カード） | `video/edl/*.json` の該当 `text` / `value` / `title` |');
out('| 順番・尺 | 同じく `at` / `dur`（章の `dur` を変えたら中の `at` も動かす） |');
out('| 使う画 | `clips` の `in` / `dur`。切り出し直しが要る |');
out('| 心情の書き方 | `chapters[].mood` |');
out();
out('EDL を直したら、この2つを走らせる。');
out();
out('```bash');
out('cd video');
out(`node scripts/extract.mjs ${edlPath}                 # 尺と映り込みの検査つき`);
out(`node scripts/storyboard.mjs ${edlPath} > ../docs/video/storyboards/${edl.meta.slug}.md`);
out('npm run build -- <slug>   # 省略で最新の回。id は Episode-<slug>');
out('```');

console.log(L.join('\n'));
