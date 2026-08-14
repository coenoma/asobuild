/**
 * ゲームを進める唯一の経路。
 *
 * 実プレイ（ブラウザ）もボット試験（Node）も必ずここを通す。
 * 経路を1本にしておかないと「ゲートは通ったのに実機だと違う」が起きる。
 */

import { platformOf } from './platforms';
import { createRng, type Rng } from './rng';
import {
  FIXED_DT,
  VIRTUAL_H,
  VIRTUAL_W,
  type BaseState,
  type BotAction,
  type Control,
  type Frame,
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

/** 打っていないフレームで毎回配列を作らないよう、空のときは使い回す */
const NO_KEYS: readonly string[] = Object.freeze([]);

/**
 * 1フレーム分の操作から Input を作る。tap / release は前フレームとの差で決まる。
 *
 * ボットの意思・実プレイの操作・リプレイの記録が、すべてこの1本を通る。
 * 経路を分けると「リプレイだけ結果が違う」が起きるので、必ずここを通すこと。
 *
 * dims は px/py を省略したときの「画面の真ん中」を決めるためのもの。
 * 機種が keitai 以外のゲームでは、その機種の寸法を渡すこと（playOnce は自動でやる）。
 */
export function toInput(
  frame: Frame,
  prevPress: boolean,
  dims: { w: number; h: number } = { w: VIRTUAL_W, h: VIRTUAL_H },
): Input {
  return {
    tap: frame.press && !prevPress,
    hold: frame.press,
    release: !frame.press && prevPress,
    px: frame.px ?? dims.w / 2,
    py: frame.py ?? dims.h / 2,
    steer: frame.steer ?? 0,
    typed: frame.typed ?? NO_KEYS,
  };
}

/**
 * 実プレイの入力を、リプレイに残す形へ落とす。
 *
 * **操作方式が使う分だけ残す。** タップのゲームの記録を1フレーム1ビットのまま
 * 保つための作りなので、まとめて全部残す形にしないこと。
 * 逆に、記録していない入力はリプレイでは無かったことになる
 * （aim の狙い先を残していなかった頃は、リプレイが別のプレイになっていた）。
 */
export function toLogFrame(input: Input, control: Control): Frame {
  switch (control) {
    case 'aim':
      return { press: input.hold, px: input.px, py: input.py };
    case 'steer':
      return { press: input.hold, steer: input.steer };
    case 'type':
      return input.typed.length > 0
        ? { press: input.hold, typed: [...input.typed] }
        : { press: input.hold };
    default:
      return { press: input.hold };
  }
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
  const dims = platformOf(game.meta);
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
    const input = toInput(action, prevPress, dims);
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
 *
 * control を渡すと、その操作方式に合ったでたらめさを足す。
 * **渡さなければ乱数の消費は増えない**（既存ゲームの数字を動かさないための作り）。
 * dims は狙い先のでたらめさの範囲。機種が keitai 以外なら、その機種の寸法を渡す。
 */
export function makeRandomPolicy<S extends BaseState>(
  control?: Control,
  dims: { w: number; h: number } = { w: VIRTUAL_W, h: VIRTUAL_H },
): Policy<S> {
  let pressing = false;
  let releaseAt = 0;
  let steer = 0;
  let steerUntil = 0;
  return (_state, rng, frame) => {
    if (pressing) {
      if (frame >= releaseAt) pressing = false;
    } else if (rng.chance(0.07)) {
      pressing = true;
      // 3〜75フレーム（0.05〜1.25秒）押し続ける。短い連打も長押しも出る
      releaseAt = frame + 3 + rng.int(72);
    }
    const action: BotAction = {
      press: pressing,
      px: rng.range(0, dims.w),
      py: rng.range(0, dims.h),
    };
    if (control === 'steer') {
      // 毎フレーム振り直すと小刻みに震えるだけで前に進めない。
      // 少しの間おなじ向きに切り続ける形にして、「何も分かっていない人」に寄せる
      if (frame >= steerUntil) {
        steer = rng.int(3) - 1;
        steerUntil = frame + 6 + rng.int(30);
      }
      action.steer = steer;
    }
    return action;
  };
}

/** ゲームが用意したボット。上手い人の再現 */
export function makeSmartPolicy<S extends BaseState>(game: GameDefinition<S>): Policy<S> {
  return (state, rng) => game.bot(state, rng);
}
