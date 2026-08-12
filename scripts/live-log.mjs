/**
 * 収録カンペ（/live）へ流す、共通の書き込み口。
 *
 * なぜ共通化したか。
 *
 * カンペは「収録する人が手で流すもの」として作ったが、実際に手を動かして
 * **無言の時間を作るのは実装している側**（多くの場合 AI）だった。
 * 実測すると、自動で流れるゲート結果は66件貯まっていたのに、
 * 手で書いた一言は2件しかなく、しかも全部が最初の2分間のものだった。
 *
 * 「意識して流す」に頼ると流れない。だから**主要なコマンドが勝手に喋る**ようにしてある。
 * ここを通せば、雛形を作った・遊んだ記録をつけた・公開前チェックを通した、が自動で出る。
 *
 * カンペが無くても作業は成立するので、失敗しても黙って進む（収録中に止まらないことが最優先）。
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

function file() {
  return path.join(process.cwd(), '.live', 'status.jsonl');
}

/** 生のイベントを流す（kind は say / phase / timer / gate） */
export async function live(event) {
  try {
    await mkdir(path.dirname(file()), { recursive: true });
    await appendFile(file(), `${JSON.stringify({ t: Date.now(), ...event })}\n`, 'utf8');
  } catch {
    // カンペは無くてよい
  }
}

/** いまの一言（カンペの主役になる大きい文字） */
export async function say(text) {
  if (!text) return;
  await live({ kind: 'say', text });
}
