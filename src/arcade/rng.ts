/**
 * シード付き乱数。
 *
 * ゲーム内で Math.random() を使うと、同じ操作をしても結果が変わり、
 * 面白さゲート（npm run fun）が数字を出せなくなる。
 * 乱数が要るときは必ずこの Rng を経由すること。
 */

export interface Rng {
  /** 0 以上 1 未満 */
  (): number;
  /** 0 以上 max 未満の整数 */
  int(max: number): number;
  /** min 以上 max 未満の実数 */
  range(min: number, max: number): number;
  /** 配列から1つ選ぶ */
  pick<T>(arr: readonly T[]): T;
  /** 確率 p（0..1）で true */
  chance(p: number): boolean;
  /** 現在のシード値（デバッグ・リプレイ用） */
  seed: number;
}

/** mulberry32。軽くて分布が素直なので固定タイムステップのゲームに向く */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng = next as Rng;
  rng.int = (max: number) => Math.floor(next() * max);
  rng.range = (min: number, max: number) => min + next() * (max - min);
  rng.pick = <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)];
  rng.chance = (p: number) => next() < p;
  rng.seed = seed;
  return rng;
}

/** 実プレイ用のシード。ここだけは非決定でよい */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
