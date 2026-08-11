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
 * 記録カードの画像を作る。
 *
 * 文字だけの共有より、絵があるほうが人の目に留まる。
 * 画面の見た目をそのまま焼くのではなく、SNS で見やすい正方形に組み直す。
 */
export async function buildResultCard(
  meta: GameMeta,
  score: number,
  ctx: ShareContext,
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const S = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d');
  if (!g) return null;

  const font = (size: number, bold = false) =>
    `${bold ? 'bold ' : ''}${size}px system-ui, -apple-system, "Hiragino Sans", sans-serif`;

  g.fillStyle = '#101820';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#2d3d4f';
  g.lineWidth = 6;
  g.strokeRect(40, 40, S - 80, S - 80);

  g.textAlign = 'center';
  g.fillStyle = '#7e8d9c';
  g.font = font(34);
  g.fillText('アソビルド', S / 2, 190);

  g.fillStyle = '#e9f1e4';
  g.font = font(64, true);
  g.fillText(meta.title, S / 2, 300);

  g.fillStyle = '#ffd23f';
  g.font = font(210, true);
  g.fillText(String(score), S / 2, 520);
  g.fillStyle = '#7e8d9c';
  g.font = font(40);
  g.fillText(meta.unit, S / 2, 580);

  if (ctx.allCleared) {
    g.fillStyle = '#3ddc84';
    g.font = font(52, true);
    g.fillText('ぜんぶ達成', S / 2, 690);
  } else if (ctx.rankLabel) {
    g.fillStyle = '#3ddc84';
    g.font = font(52, true);
    g.fillText(ctx.rankLabel, S / 2, 690);
  } else if (ctx.isBest) {
    g.fillStyle = '#ff6b35';
    g.font = font(44, true);
    g.fillText('自己ベスト', S / 2, 690);
  }

  g.fillStyle = '#e9f1e4';
  g.font = font(34);
  g.fillText(meta.howto, S / 2, 810);

  g.fillStyle = '#4cc9f0';
  g.font = font(30);
  g.fillText(gameUrl(meta.slug).replace('https://', ''), S / 2, 950);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

/**
 * 端末が対応していれば OS の共有シートを、なければ X の投稿画面を開く。
 * 画像つきで共有できる端末では記録カードも一緒に渡す。
 * 失敗しても黙って何もしない（遊びを止めないことを優先する）。
 */
export async function shareScore(meta: GameMeta, score: number, ctx: ShareContext = {}): Promise<void> {
  const text = buildShareText(meta, score, ctx);
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  if (nav?.share) {
    try {
      const blob = await buildResultCard(meta, score, ctx);
      if (blob) {
        const file = new File([blob], `${meta.slug}.png`, { type: 'image/png' });
        if (nav.canShare?.({ files: [file] })) {
          await nav.share({ title: meta.title, text, files: [file] });
          return;
        }
      }
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
