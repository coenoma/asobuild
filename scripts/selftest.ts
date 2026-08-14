/**
 * ランタイムの自己検査。
 *
 *   npm run selftest      # 1秒で終わる。npm run check にも入っている
 *
 * 面白さゲート（fun:all）は**登録済みのゲームが使っている機能**しか通らない。
 * steer / type / aim や機種の配管は、それを使う1本目が出るまで誰も踏まないので、
 * 壊しても気づけない。ここでは仮想のゲームでその経路を毎回踏む。
 *
 * 見ているもの:
 *   1. steer / typed / aim(px,py) が step まで届くこと
 *   2. 記録（toLogFrame）した操作だけでリプレイが完全一致すること
 *   3. 記録から情報を落とすと**ちゃんと不一致になる**こと（関所に歯があるか）
 *   4. 機種の寸法が Painter / でたらめボットまで届くこと
 *
 * ここが落ちたら、直すのはたいてい runner.ts の toLogFrame（記録し忘れ）か
 * input.ts（入力の取りこぼし）。→ .claude/rules/arcade.md「入力を足すときは記録も一緒に足す」
 */

import { Painter } from '../src/arcade/painter';
import { PLATFORMS, platformOf } from '../src/arcade/platforms';
import { createRng } from '../src/arcade/rng';
import { advance, makeRandomPolicy, toInput, toLogFrame } from '../src/arcade/runner';
import {
  FIXED_DT,
  defineGame,
  type BaseState,
  type Control,
  type Frame,
  type GameDefinition,
} from '../src/arcade/types';

const A = PLATFORMS.arcade;
const F = PLATFORMS.flash;

interface S extends BaseState {
  x: number;
  word: string;
  done: number;
}

const blank = (): S => ({ score: 0, over: false, time: 0, x: 0, word: '', done: 0 });

/** 左右で動く。x の到達点がそのままスコア。1秒で終わる */
const steerGame = defineGame<S>({
  meta: {
    slug: 'selftest-steer',
    title: 'かり',
    howto: 'まがる',
    control: 'steer',
    platform: 'arcade',
    released: '2026-08-14',
    unit: '点',
  },
  init: () => ({ ...blank(), x: A.w / 2 }),
  step(s, input, dt) {
    const n = { ...s };
    n.x = Math.max(0, Math.min(A.w, s.x + input.steer * 120 * dt));
    n.score = Math.round(n.x);
    if (s.time >= 1) n.over = true;
    return n;
  },
  draw: () => {},
  bot: () => ({ press: false, steer: 1 }),
});

/** 正しい文字を打つと1点。打ち切るか1秒で終わる */
const typeGame = defineGame<S>({
  meta: {
    slug: 'selftest-type',
    title: 'かり',
    howto: 'うつ',
    control: 'type',
    platform: 'flash',
    released: '2026-08-14',
    unit: '点',
  },
  init: () => ({ ...blank(), word: 'asobi' }),
  step(s, input, dt) {
    const n = { ...s };
    for (const ch of input.typed) {
      if (ch === s.word[n.done]) {
        n.done += 1;
        n.score += 1;
      }
    }
    if (n.done >= s.word.length || s.time >= 1) n.over = true;
    return n;
  },
  draw: () => {},
  bot(s, rng) {
    if (rng.chance(0.7)) return { press: false };
    return { press: false, typed: [s.word[s.done] ?? 'a'] };
  },
});

/** 画面の右側を狙っている間だけ加点。1秒で終わる */
const aimGame = defineGame<S>({
  meta: {
    slug: 'selftest-aim',
    title: 'かり',
    howto: 'ねらう',
    control: 'aim',
    released: '2026-08-14',
    unit: '点',
  },
  init: blank,
  step(s, input) {
    const n = { ...s };
    if (input.px > 180) n.score += 1;
    if (s.time >= 1) n.over = true;
    return n;
  },
  draw: () => {},
  bot: (_s, rng) => ({ press: false, px: rng.chance(0.5) ? 220 : 20, py: 160 }),
});

/**
 * ボットに1回遊ばせて記録を取り、記録だけでなぞり直す。
 * drop に操作方式を渡すと、その情報を記録から落とす（記録し忘れの再現）。
 */
function roundTrip(
  game: GameDefinition<S>,
  opts: { drop?: boolean } = {},
): { played: number; replayed: number } {
  const seed = 20260814;
  const dims = platformOf(game.meta);
  const control: Control = game.meta.control;

  const rng = createRng(seed);
  const policyRng = createRng(seed ^ 0x9e3779b9);
  let state = game.init(rng);
  let prev = false;
  const log: Frame[] = [];
  while (!state.over && log.length < 600) {
    const action = game.bot(state, policyRng);
    const input = toInput(action, prev, dims);
    log.push(opts.drop ? { press: input.hold } : toLogFrame(input, control));
    state = advance(game, state, input, rng, FIXED_DT);
    prev = action.press;
  }

  const rng2 = createRng(seed);
  let replayed = game.init(rng2);
  let prev2 = false;
  for (const f of log) {
    replayed = advance(game, replayed, toInput(f, prev2, dims), rng2, FIXED_DT);
    prev2 = f.press;
  }
  return { played: state.score, replayed: replayed.score };
}

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failed += 1;
};

console.log('ランタイムの自己検査\n');

for (const [game, name] of [
  [steerGame, 'steer'],
  [typeGame, 'typed'],
  [aimGame, 'ねらい先'],
] as const) {
  const ok = roundTrip(game);
  check(`${name} が step まで届く`, ok.played > 0, `スコア ${ok.played}`);
  check(`${name} の記録でリプレイが一致`, ok.played === ok.replayed, `${ok.played} vs ${ok.replayed}`);
  const dropped = roundTrip(game, { drop: true });
  check(
    `${name} を記録し忘れると検出できる`,
    dropped.played !== dropped.replayed,
    `${dropped.played} vs ${dropped.replayed}`,
  );
}

// 機種の寸法の配管
const p = new Painter({} as unknown as CanvasRenderingContext2D, 'arcade', A);
check('Painter に機種の寸法が届く', p.w === A.w && p.h === A.h, `${p.w}×${p.h}`);
check("platformOf の既定は keitai", platformOf({}).name === 'keitai');

const rng = createRng(9);
const pol = makeRandomPolicy<S>('aim', F);
let inRange = true;
for (let i = 0; i < 200; i++) {
  const a = pol(blank(), rng, i);
  if ((a.px ?? 0) > F.w || (a.py ?? 0) > F.h) inRange = false;
}
check('でたらめボットの狙い先が機種の寸法内', inRange, `0..${F.w} × 0..${F.h}`);

console.log(
  failed === 0
    ? '\nすべて通りました'
    : `\n${failed} 件こわれています。直し方: .claude/rules/arcade.md「入力を足すときは記録も一緒に足す」`,
);
process.exit(failed === 0 ? 0 : 1);
