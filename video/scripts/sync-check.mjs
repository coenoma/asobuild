#!/usr/bin/env node
/**
 * 「言っていること」と「映っているもの」のズレを機械で洗い出す。
 *
 *   node scripts/sync-check.mjs edl/<slug>.json
 *
 * **なぜ要るか。** 001 の初版は、次のようなズレを全部通してしまった（人が見て気づいた）:
 *  - 「7分半 考えてる」と言っている画面に、そのあと投げるはずの補足がもう映っている
 *  - 「あ、なんかできてる！」が、実際に画面へ出る 0.5秒前に始まっている
 *  - 「一覧に出てる！」と言った直後に一覧が出る
 *
 * どれも**人の目には一瞬で分かるのに、作っている側からは見えない**。
 * だから原稿の行に「この行はこの出来事の反応です」と書けるようにして、機械で見る。
 *
 * 原稿（voice/<slug>.json）の行に足せる印:
 *   "after": { "clip": "sca-list", "at": 4.5 }   … その素材の 4.5秒地点で起きたことへの反応
 *   "reads": true                                 … 画面の文字を読ませる行（静止させる）
 *
 * 見るもの:
 *  1. **反応は出来事のあと**か（0.3〜1.2秒あと。前に出ると「予知」になって気持ち悪い）
 *  2. 行のとき、その素材が**まだ映っているか**
 *  3. 読ませる行のショットが**動いていないか**（zoom があると読めない）
 *  4. 1つのショットが**長すぎないか**（8秒を超えると画が止まって見える）
 *  5. 章の切れ目に**行がまたがっていないか**
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const edlPath = process.argv[2];
if (!edlPath) {
  console.error('使い方: node scripts/sync-check.mjs edl/<slug>.json');
  process.exit(1);
}
const edl = JSON.parse(readFileSync(resolve(process.cwd(), edlPath), 'utf8'));
const voicePath = resolve(ROOT, 'voice', `${basename(edlPath)}`);
if (!existsSync(voicePath)) {
  console.error(`原稿がありません: ${voicePath}`);
  process.exit(1);
}
const voice = JSON.parse(readFileSync(voicePath, 'utf8'));

/** 反応が自然に見える遅れ（秒）。人は見てから声が出る */
const REACT_MIN = 0.3;
const REACT_MAX = 1.2;
/** 1ショットの上限。これを超えると画が止まって見える */
const SHOT_MAX = 8.5;

const bad = [];
const warn = [];

for (const ch of edl.chapters) {
  const lines = voice.chapters?.[ch.id] ?? [];
  const shots = ch.layers.filter((l) => l.type === 'shot' && !l.wipe).sort((a, b) => a.at - b.at);
  /** その時刻に映っている主役のショット（ワイプは除く） */
  const shotAt = (t) => shots.filter((s) => s.at <= t && t < s.at + s.dur).pop();

  for (const s of shots) {
    if (s.dur > SHOT_MAX) warn.push(`${ch.id} ${s.clip} が ${s.dur}秒（${SHOT_MAX}秒を超えると画が止まって見える）`);
  }

  for (const line of lines) {
    const label = `${ch.id}「${line.t}」`;

    // 1・2. 反応の位置
    if (line.after) {
      const s = shots.find((x) => x.clip === line.after.clip);
      if (!s) {
        bad.push(`${label} after に書いた素材 ${line.after.clip} が、この章にありません`);
      } else {
        const eventAt = s.at + line.after.at; // 出来事が起きる章内の時刻
        const delay = line.at - eventAt;
        if (delay < REACT_MIN) {
          bad.push(
            `${label} 出来事(${eventAt.toFixed(1)}s)より ${(-delay).toFixed(1)}秒はやい。` +
            `${(eventAt + REACT_MIN).toFixed(1)}〜${(eventAt + REACT_MAX).toFixed(1)}s に置く`,
          );
        } else if (delay > REACT_MAX) {
          warn.push(`${label} 出来事から ${delay.toFixed(1)}秒あと（間があきすぎ。${REACT_MAX}秒までが目安）`);
        }
      }
    }

    // 3. 読ませる行は、画が動いていたら読めない
    if (line.reads) {
      const s = shotAt(line.at);
      if (!s) bad.push(`${label} 読ませる行なのに、この時刻にショットがありません`);
      else if (s.zoom && Array.isArray(s.zoom)) bad.push(`${label} 読ませる行の下で ${s.clip} が動いています（zoom を外す）`);
    }

    // 5. 章からはみ出していないか（声の長さは voice.mjs 側で見る）
    if (line.at >= ch.dur) bad.push(`${label} at=${line.at} が章の長さ ${ch.dur}秒を超えています`);
  }
}

for (const m of bad) console.log(`✗ ${m}`);
for (const m of warn) console.log(`△ ${m}`);
if (!bad.length && !warn.length) console.log('ズレは見つかりませんでした');
console.log(`\n✗ ${bad.length}件 / △ ${warn.length}件`);
process.exit(bad.length ? 1 : 0);
