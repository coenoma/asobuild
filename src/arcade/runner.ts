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

  while (!state.over && frame < maxFrames) {
    const action = opts.policy(state, policyRng, frame);
    const input = toInput(action.press, prevPress, action.px, action.py);
    state = advance(game, state, input, rng, FIXED_DT);
    prevPress = action.press;
    frame++;
  }

  return {
    score: state.score,
    seconds: frame * FIXED_DT,
    frames: frame,
    ended: state.over,
    reason: state.over ? game.reason?.(state) : undefined,
  };
}

/** 何もしないボット。「放置していると死ぬか」を測る */
export const idlePolicy: Policy<BaseState> = () => ({ press: false });

/**
 * でたらめボット。人間の初見に近い。
 * 押しっぱなしにも押さないままにも寄らないよう、押す確率と離す確率を非対称にしている。
 * 内部状態を持つので、プレイごとに作り直すこと。
 */
export function makeRandomPolicy<S extends BaseState>(): Policy<S> {
  let pressing = false;
  return (_state, rng) => {
    if (pressing) {
      if (rng.chance(0.12)) pressing = false;
    } else if (rng.chance(0.06)) {
      pressing = true;
    }
    return { press: pressing, px: rng.range(0, VIRTUAL_W), py: rng.range(0, VIRTUAL_H) };
  };
}

/** ゲームが用意したボット。上手い人の再現 */
export function makeSmartPolicy<S extends BaseState>(game: GameDefinition<S>): Policy<S> {
  return (state, rng) => game.bot(state, rng);
}
