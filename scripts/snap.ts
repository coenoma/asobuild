/**
 * いまの実装の「見た目」を1枚、時刻つきで保存する。
 *
 *   npm run snap -- <slug>          # 手動で1枚
 *   （npm run fun のたびに自動でも1枚落ちる）
 *
 * なぜ要るか:
 *   開発中、ゲームの見た目は何度も変わる（白い四角 → 針と糸）。
 *   その変遷は動画のいちばんの素材なのに、**画面収録の中から探すのは大変**。
 *   ゲートを回すたびに1枚焼いておけば、変遷が時刻つきで勝手に貯まる。
 *   ファイル名の時刻と収録の開始時刻を突き合わせれば、動画の編集にそのまま使える
 *   （docs/video/README.md「素材の開始時刻を実測する」）。
 *
 * 保存先は .live/shots/（git管理外）。リポジトリは PUBLIC なので、
 * 制作途中の画像はコミットしない。動画を作ったら消してよい。
 *
 * Painter は 2D コンテキストにしか依存していないので、
 * ブラウザで動いているのと同じ描画コードをそのままサーバー側で焼ける（gen-ogp.ts と同じ理屈）。
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { Painter } from '../src/arcade/painter';
import { advance, toInput } from '../src/arcade/runner';
import { createRng } from '../src/arcade/rng';
import { FIXED_DT, VIRTUAL_H, VIRTUAL_W } from '../src/arcade/types';
import { loaders, metas } from '../src/games/registry';

const LIVE_DIR = resolve(process.cwd(), '.live');
const SHOTS_DIR = resolve(LIVE_DIR, 'shots');

/** 拡大率。240×320 のまま保存すると小さすぎて動画で使えない */
const SCALE = 3;

/**
 * ボットに少し遊ばせてから撮る（開始直後は何も出ていない）。
 * 種は固定。**同じ実装なら同じ絵**になるので、変わったときだけ絵が変わる。
 */
async function snapOne(slug: string, seconds: number): Promise<string | null> {
  const load = loaders[slug];
  if (!load) throw new Error(`ゲームが見つかりません: ${slug}`);
  const game = (await load()).default;

  const rng = createRng(20260811);
  const botRng = createRng(7);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any = game.init(rng);
  state.time = 0;
  let prevPress = false;
  const frames = Math.round(seconds / FIXED_DT);
  for (let i = 0; i < frames && !state.over; i++) {
    const action = game.bot(state, botRng);
    state = advance(game, state, toInput(action.press, prevPress, action.px, action.py), rng, FIXED_DT);
    prevPress = action.press;
  }

  const screen = createCanvas(VIRTUAL_W, VIRTUAL_H);
  const sctx = screen.getContext('2d');
  const painter = new Painter(sctx as unknown as CanvasRenderingContext2D, game.meta.theme);
  // sans-serif 任せだと一部の漢字が豆腐（□）になる。gen-ogp.ts と同じ手当て
  painter.fontFamily = '"Hiragino Sans", "Noto Sans CJK JP", "Yu Gothic", sans-serif';
  game.draw(painter, state);

  const out = createCanvas(VIRTUAL_W * SCALE, VIRTUAL_H * SCALE);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(screen, 0, 0, VIRTUAL_W * SCALE, VIRTUAL_H * SCALE);

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const file = `${stamp}_${slug}.png`;
  writeFileSync(resolve(SHOTS_DIR, file), out.toBuffer('image/png'));

  // 機械で突き合わせる用の索引（時刻はエポックms。収録開始時刻と引き算するだけで動画の時刻になる）
  appendFileSync(
    resolve(SHOTS_DIR, 'index.jsonl'),
    JSON.stringify({ t: now.getTime(), slug, score: state.score ?? null, file }) + '\n',
  );
  return file;
}

/**
 * fun-check から呼ぶ入口。
 * .live/ が無い環境（CI・他人のマシン）では黙って何もしない。
 * スクショが撮れないことでゲートを止めない（本業はゲートのほう）。
 */
export async function trySnap(slug: string): Promise<void> {
  try {
    if (!existsSync(LIVE_DIR)) return;
    mkdirSync(SHOTS_DIR, { recursive: true });
    await snapOne(slug, 24);
  } catch {
    // 撮れなくても落とさない
  }
}

// 手動実行: npm run snap -- <slug>
// （トップレベル await は tsx の CJS 変換で落ちるので、async main に包む）
async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets = args.length > 0 ? args : metas.map((m) => m.slug);
  mkdirSync(SHOTS_DIR, { recursive: true });
  for (const slug of targets) {
    const file = await snapOne(slug, 24);
    console.log(`とった: .live/shots/${file}`);
  }
}

if (process.argv[1]?.endsWith('snap.ts')) {
  void main();
}
