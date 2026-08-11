/**
 * ハイスコアとプレイ回数。localStorage だけで完結させる。
 *
 * サーバを持たないのは意図的。ログインもランキング同期もない代わりに、
 * ゲームを1本足すのに必要な作業が「ファイルを2つ書く」だけで済む。
 */

const PREFIX = 'asobuild';

const canUse = () => typeof window !== 'undefined' && !!window.localStorage;

export function getBest(slug: string): number {
  if (!canUse()) return 0;
  const v = window.localStorage.getItem(`${PREFIX}:best:${slug}`);
  return v ? Number(v) || 0 : 0;
}

/** 更新したら true を返す */
export function setBest(slug: string, score: number): boolean {
  if (!canUse()) return false;
  if (score <= getBest(slug)) return false;
  window.localStorage.setItem(`${PREFIX}:best:${slug}`, String(score));
  return true;
}

export function getPlays(slug: string): number {
  if (!canUse()) return 0;
  return Number(window.localStorage.getItem(`${PREFIX}:plays:${slug}`)) || 0;
}

export function incPlays(slug: string): number {
  if (!canUse()) return 0;
  const n = getPlays(slug) + 1;
  window.localStorage.setItem(`${PREFIX}:plays:${slug}`, String(n));
  return n;
}

/** 一覧で「遊んだことがある」印を出すため */
export function getPlayedSlugs(slugs: string[]): Set<string> {
  const played = new Set<string>();
  if (!canUse()) return played;
  for (const s of slugs) if (getPlays(s) > 0) played.add(s);
  return played;
}
