/**
 * ゲームごとの OGP 画像を作る。
 *
 *   npm run ogp            # ぜんぶ
 *   npm run ogp -- hanko   # 1本だけ
 *
 * Painter は 2D コンテキストにしか依存していないので、
 * **ブラウザで動いているのと同じ描画コードを、そのままサーバー側で焼ける**。
 * 絵を別に用意する必要がないし、ゲームを直せば OGP も自動で追いつく。
 *
 * 生成した PNG は public/ogp/ に置いてコミットする（ビルド時に作らない）。
 */

import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { Painter } from '../src/arcade/painter';
import { platformOf } from '../src/arcade/platforms';
import { advance, toInput } from '../src/arcade/runner';
import { createRng } from '../src/arcade/rng';
import { getPalette } from '../src/arcade/palette';
import { FIXED_DT } from '../src/arcade/types';
import { loaders, metas } from '../src/games/registry';

/**
 * フォントを名指しするのは、`sans-serif` 任せだと混ざった日本語の一部が
 * 豆腐（□）になるため。実測で「ワクに来たら押す」の「来」だけが落ちた。
 * 生成は手元でやって PNG をコミットするので、macOS のフォントを前提にしてよい。
 */
const FONT = '"Hiragino Sans", "Noto Sans CJK JP", "Yu Gothic", sans-serif';

const W = 1200;
const H = 630;
/** ゲーム画面をどれくらい拡大して置くか */
const SCALE = 1.7;

const argv = process.argv.slice(2);
const args = argv.filter((a) => !a.startsWith('--'));
const targets = args.length > 0 ? args : metas.map((m) => m.slug);
/** 何秒ぶん遊ばせてから撮るか。育てる系は少し進めたほうが絵になる */
const secondsArg = argv.find((a) => a.startsWith('--seconds='));
const SECONDS = secondsArg ? Number(secondsArg.split('=')[1]) : 26;

/**
 * ボットに少し遊ばせて、絵になっているフレームまで進める。
 * 開始直後は何も出ていないので、そのまま撮ると寂しい画になる。
 */
async function captureFrame(slug: string, seconds: number) {
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
    state = advance(game, state, toInput(action, prevPress), rng, FIXED_DT);
    prevPress = action.press;
  }
  return { game, state };
}

async function generate(slug: string): Promise<void> {
  const { game, state } = await captureFrame(slug, SECONDS);
  const meta = game.meta;
  const plat = platformOf(meta);
  const theme = meta.theme ?? plat.defaultTheme;
  const palette = getPalette(theme);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // 背景
  ctx.fillStyle = '#0b1016';
  ctx.fillRect(0, 0, W, H);

  // ゲーム画面を別のキャンバスに実寸で描いてから拡大して貼る
  // （最初から拡大して描くとドットが粗くならない）
  const screen = createCanvas(plat.w, plat.h);
  const sctx = screen.getContext('2d');
  const painter = new Painter(sctx as unknown as CanvasRenderingContext2D, theme, plat);
  painter.fontFamily = FONT;
  painter.clear('bg');
  game.draw(painter, state);
  // HUD（スコア帯）も入れておくと「ゲームの画面」だと一目で分かる
  painter.rect(0, 0, plat.w, 16, 'bg2');
  painter.text(`${state.score}${meta.unit}`, 6, 3, { color: 'accent', size: 12 });

  // 縦長（keitai）は従来の倍率のまま。横長の機種は右側に収まる大きさへ落とす
  const scale = plat.h >= plat.w ? SCALE : Math.min(SCALE, 600 / plat.w, 520 / plat.h);
  const dw = plat.w * scale;
  const dh = plat.h * scale;
  const dx = W - dw - 90;
  const dy = (H - dh) / 2;
  // ドット機種は補間なしで拡大。なめらか機種はそのまま補間で拡大
  ctx.imageSmoothingEnabled = !plat.pixelated;
  // 枠（ケータイの画面らしく見せる）
  ctx.fillStyle = palette.line;
  ctx.fillRect(dx - 8, dy - 8, dw + 16, dh + 16);
  ctx.drawImage(screen, dx, dy, dw, dh);

  // 左側の文字
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7e8d9c';
  ctx.font = `24px ${FONT}`;
  ctx.fillText('アソビルド', 90, 190);

  ctx.fillStyle = '#ffd23f';
  ctx.font = `bold 76px ${FONT}`;
  ctx.fillText(meta.title, 90, 285);

  ctx.fillStyle = '#e9f1e4';
  ctx.font = `30px ${FONT}`;
  ctx.fillText(meta.howto, 90, 345);

  if (meta.constraint) {
    ctx.fillStyle = '#7e8d9c';
    ctx.font = `22px ${FONT}`;
    ctx.fillText(meta.constraint, 90, 400);
  }

  ctx.fillStyle = '#4cc9f0';
  ctx.font = `22px ${FONT}`;
  ctx.fillText('asobuild.coenoma.com', 90, H - 90);

  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), 'public/ogp');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug}.png`);
  await writeFile(file, canvas.toBuffer('image/png'));
  console.log(`  public/ogp/${slug}.png（スコア ${state.score}${meta.unit} の場面）`);
}

async function main(): Promise<void> {
  console.log('OGP画像を作ります');
  for (const slug of targets) {
    try {
      await generate(slug);
    } catch (e) {
      console.error(`  ${slug}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log('できました。public/ogp/ をコミットしてください。');
}

void main();
