/**
 * 記録の持ち出し。
 *
 * 「もう一回」の次に強い動線は「人に見せる」。
 * スコアが出たら必ず持ち出せる状態にしておく（リザルト画面から1タップ）。
 */

import type { GameMeta } from './types';

export const SITE_URL = 'https://asobuild.coenoma.com';
export const HASHTAG = 'アソビルド';

export function gameUrl(slug: string): string {
  return `${SITE_URL}/g/${slug}`;
}

export interface ShareContext {
  isBest?: boolean;
  /** 現在の称号（あれば見出しに使う。数字より人に伝わる） */
  rankLabel?: string;
  allCleared?: boolean;
}

export function buildShareText(meta: GameMeta, score: number, ctx: ShareContext = {}): string {
  const head = ctx.allCleared
    ? `ぜんぶ達成しました（${score}${meta.unit}）`
    : ctx.rankLabel
      ? `${ctx.rankLabel}になりました（${score}${meta.unit}）`
      : `${ctx.isBest ? '自己ベスト' : '記録'} ${score}${meta.unit}`;
  return `【${meta.title}】${head}\n${meta.howto}\n#${HASHTAG}\n${gameUrl(meta.slug)}`;
}

export function xIntentUrl(text: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

/**
 * 端末が対応していれば OS の共有シートを、なければ X の投稿画面を開く。
 * 失敗しても黙って何もしない（遊びを止めないことを優先する）。
 */
export async function shareScore(meta: GameMeta, score: number, ctx: ShareContext = {}): Promise<void> {
  const text = buildShareText(meta, score, ctx);
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share) {
    try {
      await nav.share({ title: meta.title, text });
      return;
    } catch {
      // 共有シートを閉じただけの場合もここに来るので、Xへは飛ばさず終わる
      return;
    }
  }
  if (typeof window !== 'undefined') {
    window.open(xIntentUrl(text), '_blank', 'noopener,noreferrer');
  }
}
