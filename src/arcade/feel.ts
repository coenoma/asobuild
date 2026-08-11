/**
 * 手触り（ゲームフィール）のための道具。
 *
 * 「なんか気持ちいい」「なんか惜しい」「またやりたい」は雰囲気ではなく、
 * ほぼ全部が数フレーム単位の具体的な仕掛けでできている。
 * 当時のヒット作が持っていた工夫を、毎回思い出さなくても使えるようにここへ置く。
 *
 * 何がなぜ効くのかは docs/design/feel-catalog.md に書いてある。
 * 新しく効く工夫を見つけたら、実装をここに、理由をあちらに足すこと。
 */

import type { Input } from './types';

/** ゲーム状態に混ぜて使う手触り用のフィールド */
export interface FeelState {
  /** 先行入力の残り（早すぎた入力を覚えておく） */
  tapBuffer: number;
  /** 猶予の残り（条件を外れた直後でも受け付ける） */
  grace: number;
  /** 世界を止めている残り時間（当たった瞬間の重み） */
  freeze: number;
  /** 画面ゆれの強さ 0..1 */
  shake: number;
  /** 弾みの進行 0..1（1でいちばん膨らむ） */
  pop: number;
}

/** 早すぎた入力を覚えておく長さ。人の「押したのに！」はだいたいこの範囲に収まる */
export const TAP_BUFFER = 0.13;
/** 条件を外れた直後でも受け付ける猶予。落ちた直後のジャンプなど */
export const GRACE = 0.1;

export function createFeel(): FeelState {
  return { tapBuffer: 0, grace: 0, freeze: 0, shake: 0, pop: 0 };
}

/**
 * step の先頭で呼ぶ。各タイマーを減らし、入力を先行入力バッファに積む。
 * 戻り値が false なら「世界が止まっている」ので、以降の処理を飛ばして state を返す。
 */
export function feelTick(f: FeelState, input: Input, dt: number): boolean {
  if (input.tap) f.tapBuffer = TAP_BUFFER;
  f.tapBuffer = Math.max(0, f.tapBuffer - dt);
  f.grace = Math.max(0, f.grace - dt);
  f.shake = Math.max(0, f.shake - dt * 4);
  f.pop = Math.max(0, f.pop - dt * 5);
  if (f.freeze > 0) {
    f.freeze = Math.max(0, f.freeze - dt);
    return false;
  }
  return true;
}

/**
 * 押されていたか（先行入力を含む）。使ったらバッファは消える。
 *
 * `input.tap` を直接見るのではなくこちらを使うと、
 * 「ほんの少し早く押した」を拾えるようになり、理不尽さが目に見えて減る。
 */
export function takeTap(f: FeelState): boolean {
  if (f.tapBuffer <= 0) return false;
  f.tapBuffer = 0;
  return true;
}

/** 猶予を開始する（例: 足場から落ちた瞬間に呼ぶ） */
export function startGrace(f: FeelState): void {
  f.grace = GRACE;
}

/** 条件を満たしているか、猶予の中か */
export function inGrace(f: FeelState, condition: boolean): boolean {
  if (condition) {
    f.grace = GRACE;
    return true;
  }
  return f.grace > 0;
}

/**
 * 当たった瞬間に世界を止める。0.04〜0.08秒が目安。
 * これだけで「当たった感」がはっきり変わる。長くすると重くて不快になる。
 */
export function hitStop(f: FeelState, seconds = 0.05): void {
  f.freeze = Math.max(f.freeze, seconds);
}

/** 画面をゆらす。0.3=軽い、1=大きい */
export function addShake(f: FeelState, amount = 0.6): void {
  f.shake = Math.min(1, f.shake + amount);
}

/** 弾ませる（得点表示やキャラを一瞬大きくする） */
export function addPop(f: FeelState): void {
  f.pop = 1;
}

/**
 * 画面ゆれのオフセット。time から決めているので再現性が保たれる
 * （ここで Math.random を使うと面白さゲートが機能しなくなる）。
 */
export function shakeOffset(f: FeelState, time: number): [number, number] {
  if (f.shake <= 0) return [0, 0];
  const a = Math.sin(time * 97.3) * f.shake * 3;
  const b = Math.sin(time * 61.7 + 1.3) * f.shake * 3;
  return [Math.round(a), Math.round(b)];
}

/** 弾みの倍率。1 を基準に一瞬だけ膨らむ */
export function popScale(f: FeelState, strength = 0.35): number {
  return 1 + f.pop * strength;
}

/**
 * 惜しさの判定。あと少しで記録を超えていたか。
 * 「惜しい」と言われた回数だけ、人はもう一回やる。
 */
export function isNearMiss(score: number, best: number, ratio = 0.9): boolean {
  return best > 0 && score < best && score >= best * ratio;
}

/* ------------------------------------------------------------------ *
 * やられ演出
 *
 * 失敗の瞬間の見え方は、そのゲームの印象をほぼ決める。
 * 当時のヒット作で今も語られるのは、たいてい「あの落ち方」のような
 * 失敗の絵のほう。ここが楽しいと、失敗が罰でなくなり、何度でも遊べる。
 * ------------------------------------------------------------------ */

/** 吹っ飛んで回りながら落ちていくもの */
export interface Tumble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 回転（ラジアン） */
  rot: number;
  vrot: number;
  /** 動いているか */
  on: boolean;
}

export function createTumble(): Tumble {
  return { x: 0, y: 0, vx: 0, vy: 0, rot: 0, vrot: 0, on: false };
}

/**
 * 吹っ飛ばす。やられた瞬間に呼ぶ。
 *
 * 上向きに少し打ち上げてから落とすと「やられた」がはっきり出る。
 * まっすぐ落とすだけだと、事故ではなく単なる消滅に見える。
 */
export function launchTumble(
  t: Tumble,
  x: number,
  y: number,
  opts: { vx?: number; vy?: number; vrot?: number } = {},
): void {
  t.x = x;
  t.y = y;
  t.vx = opts.vx ?? -40;
  t.vy = opts.vy ?? -160;
  t.rot = 0;
  t.vrot = opts.vrot ?? 6;
  t.on = true;
}

/**
 * 毎フレーム進める。over のあとも呼び続けてよい（そこが見せ場）。
 *
 * 重力の既定値は、プレイ中の物理より**わざと弱くしてある**。
 * まじめに物理法則どおり、ただし現実よりゆっくり落ちていく——この組み合わせが
 * 可笑しみを生む。そして落ちきるまでの時間が、そのまま「見せる時間」になる。
 * 現実の速さで落とすと一瞬で画面から消え、何の記憶も残らない。
 */
export function stepTumble(t: Tumble, dt: number, gravity = 520): void {
  if (!t.on) return;
  t.vy += gravity * dt;
  t.x += t.vx * dt;
  t.y += t.vy * dt;
  t.rot += t.vrot * dt;
}
