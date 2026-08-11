/**
 * ゲームを進める唯一の経路。
 *
 * 実プレイ（ブラウザ）もボット試験（Node）も必ずここを通す。
 * 経路を1本にしておかないと「ゲートは通ったのに実機だと違う」が起きる。
 */

import { createRng, type Rng } from './rng';
import {
  FIXED_DT,
  VIRTUAL_H,
  VIRTUAL_W,
  type BaseState,
  type BotAction,
  type GameDefinition,
  type Input,
} from './types';

/** ボットの行動方針 */
export type Policy<S extends BaseState> = (state: S, rng: Rng, frame: number) => BotAction;

/** 1フレーム進める。time の加算はここが引き受ける（ゲーム側は触らない） */
export function advance<S extends BaseState>(
  game: GameDefinition<S>,
  state: S,
  input: Input,
  rng: Rng,
  dt: number = FIXED_DT,
): S {
  const next = game.step(state, input, dt, rng);
  if (next === state) return { ...state, time: state.time + dt };
  next.time = state.time + dt;
  return next;
}

/** press の連なりから tap / hold / release を導出する */
export function toInput(press: boolean, prevPress: boolean, px?: number, py?: number): Input {
  return {
    tap: press && !prevPress,
    hold: press,
    release: !press && prevPress,
    px: px ?? VIRTUAL_W / 2,
    py: py ?? VIRTUAL_H / 2,
  };
}

export interface PlayResult {
  score: number;
  /** 生存秒数 */
  seconds: number;
  frames: number;
  /** 打ち切りではなく、ちゃんとゲームオーバーで終わったか */
  ended: boolean;
  reason?: string;
  /**
   * スコアが動いた回数。
   * 「画面の上で目に見えることが何回起きたか」の代わりとして使う。
   * これが少ないゲームは、遊んでいない人が見ると何も起きていないように見える。
   */
  scoreEvents: number;
}

/** ボットに1回プレイさせる */
export function playOnce<S extends BaseState>(
  game: GameDefinition<S>,
  opts: { seed: number; policy: Policy<S>; maxSeconds?: number },
): PlayResult {
  const maxFrames = Math.ceil((opts.maxSeconds ?? 300) / FIXED_DT);
  const rng = createRng(opts.seed);
  // 方針側の乱数はゲーム本体と混ざらないよう別系統にする
  const policyRng = createRng(opts.seed ^ 0x9e3779b9);
  let state = game.init(rng);
  let prevPress = false;
  let frame = 0;
  let scoreEvents = 0;
  let prevScore = state.score;

  while (!state.over && frame < maxFrames) {
    const action = opts.policy(state, policyRng, frame);
    const input = toInput(action.press, prevPress, action.px, action.py);
    state = advance(game, state, input, rng, FIXED_DT);
    if (state.score !== prevScore) {
      scoreEvents++;
      prevScore = state.score;
    }
    prevPress = action.press;
    frame++;
  }

  return {
    score: state.score,
    seconds: frame * FIXED_DT,
    frames: frame,
    ended: state.over,
    reason: state.over ? game.reason?.(state) : undefined,
    scoreEvents,
  };
}

/** 何もしないボット。「放置していると死ぬか」を測る */
export const idlePolicy: Policy<BaseState> = () => ({ press: false });

/**
 * でたらめボット。何も分かっていない人の代わり。
 *
 * 「押し始めたら、でたらめな長さだけ押し続ける」形にしてある。
 * 毎フレーム一定確率で離す作りにしていた頃は、押す時間がほぼ一定の短さにしかならず、
 * 長押しで加減するゲーム（ゲージを伸ばして離す等）では**構造的に一度も成功できなかった**。
 * それだと「初見でも点が入るか」の判定が、ゲームの出来ではなくボットの都合で決まってしまう。
 *
 * 内部状態を持つので、プレイごとに作り直すこと。
 */
export function makeRandomPolicy<S extends BaseState>(): Policy<S> {
  let pressing = false;
  let releaseAt = 0;
  return (_state, rng, frame) => {
    if (pressing) {
      if (frame >= releaseAt) pressing = false;
    } else if (rng.chance(0.07)) {
      pressing = true;
      // 3〜75フレーム（0.05〜1.25秒）押し続ける。短い連打も長押しも出る
      releaseAt = frame + 3 + rng.int(72);
    }
    return { press: pressing, px: rng.range(0, VIRTUAL_W), py: rng.range(0, VIRTUAL_H) };
  };
}

/** ゲームが用意したボット。上手い人の再現 */
export function makeSmartPolicy<S extends BaseState>(game: GameDefinition<S>): Policy<S> {
  return (state, rng) => game.bot(state, rng);
}
