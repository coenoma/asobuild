/**
 * 動画の見た目は、ゲームの見た目と揃える。
 *
 * 色は src/arcade/palette.ts の keitai をそのまま写している（**新しい色を作らない**）。
 * 揃っていること自体がチャンネルの記号になる、というのは palette.ts に書いてあるのと同じ理由。
 * あちらを変えたらこちらも変えること。
 *
 * 決まりの全文: docs/video/telop-rules.md
 */

export const C = {
  bg: '#101820',
  bg2: '#1d2a38',
  ink: '#e9f1e4',
  dim: '#7e8d9c',
  line: '#2d3d4f',
  accent: '#ffd23f',
  accent2: '#ff6b35',
  good: '#3ddc84',
  bad: '#ef476f',
  cool: '#4cc9f0',
} as const;

/** 1920×1080 基準の文字サイズ。telop-rules.md §2 と一致させる */
export const SIZE = {
  chapter: 96,
  main: 64,
  number: 160,
  note: 34,
  bar: 30,
  credit: 26,
} as const;

/**
 * 当時の画面に角丸・ぼかし・グラデーションはない。
 * 影は硬い2pxのオフセットだけにする（retro-style.md §6）。
 */
export const HARD_SHADOW = '2px 2px 0 rgba(0,0,0,0.85)';
/**
 * テロップの帯。
 * 0.82 だと**ターミナルの文字の上に置いたとき、下の字が透けて読めなくなる**（実測）。
 * 下の映像は「本物の画面である」ことが伝われば十分で、読ませる必要はない。
 */
export const PANEL_BG = 'rgba(16,24,32,0.93)';
export const BORDER = `2px solid ${C.line}`;

/** アニメーションは 0.15秒で出して 0.1秒で消す。読む前に次へ行かせない */
export const IN_SEC = 0.15;
export const OUT_SEC = 0.1;
