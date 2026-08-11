/**
 * 称号（到達目標）まわり。
 *
 * スコアが伸び続けるだけのゲームは3回で飽きる。
 * 段階的な称号があると、1回ごとに「あと少しで次」が生まれ、
 * 最後まで埋めたときに「やりきった」が成立する。
 * 一気に遊んで15〜30分でひととおり埋まる幅に置くのが目安。
 */

import type { Goal } from './types';

function sorted(goals?: Goal[]): Goal[] {
  return [...(goals ?? [])].sort((a, b) => a.score - b.score);
}

/** いま持っている称号（まだ何も届いていなければ null） */
export function currentGoal(goals: Goal[] | undefined, score: number): Goal | null {
  const list = sorted(goals);
  let hit: Goal | null = null;
  for (const g of list) {
    if (score >= g.score) hit = g;
  }
  return hit;
}

/** 次に狙う称号（全部埋まっていれば null） */
export function nextGoal(goals: Goal[] | undefined, score: number): Goal | null {
  return sorted(goals).find((g) => score < g.score) ?? null;
}

/** 全部埋めたか */
export function isAllCleared(goals: Goal[] | undefined, score: number): boolean {
  const list = sorted(goals);
  return list.length > 0 && score >= list[list.length - 1].score;
}
