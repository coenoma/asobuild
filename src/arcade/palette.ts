/**
 * 色は「選ぶもの」ではなく「与えられるもの」にしている。
 *
 * 毎回その場のノリで色を決めると、シリーズとしての見た目が揃わない。
 * ゲーム側は必ずこのパレットのキー名で色を指定すること（生の #hex 禁止）。
 * 揃っていること自体がチャンネルの記号になる。
 */

import type { ThemeName } from './types';

export interface Palette {
  /** 背景 */
  bg: string;
  /** 一段浮いた面（パネル・地面） */
  bg2: string;
  /** 主役の文字・輪郭 */
  ink: string;
  /** 補助的な文字 */
  dim: string;
  /** 罫線・グリッド */
  line: string;
  /** 主アクセント（スコア・重要物） */
  accent: string;
  /** 副アクセント */
  accent2: string;
  /** 成功・加点 */
  good: string;
  /** 失敗・障害物 */
  bad: string;
  /** 補色（空・水・寒色系） */
  cool: string;
}

/** 2005 年ごろのカラー液晶。既定テーマ */
const keitai: Palette = {
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
};

/** モノクロ液晶。濃淡だけで作るので、形で見せる練習になる */
const mono: Palette = {
  bg: '#c3cf72',
  bg2: '#aab85f',
  ink: '#1b2410',
  dim: '#5c6b34',
  line: '#93a352',
  accent: '#1b2410',
  accent2: '#3d4a1f',
  good: '#1b2410',
  bad: '#1b2410',
  cool: '#5c6b34',
};

/** 2003 年ごろの個人サイトに置いてあった Flash ゲーム。白地に原色 */
const flash: Palette = {
  bg: '#ffffff',
  bg2: '#eeeeee',
  ink: '#111111',
  dim: '#888888',
  line: '#cccccc',
  accent: '#ff2d20',
  accent2: '#0066ff',
  good: '#00a651',
  bad: '#ff2d20',
  cool: '#00a0e9',
};

/**
 * 90年代末〜2000年前後のゲーセンの basement。暗い店内で光る彩度の高い色。
 *
 * キー数はまだ他テーマと同じ10。「アーケードだから32色」に増やすのは、
 * 最初のアーケード企画で実際に足りなくなったとき（キー名を増やす形で。
 * 用途の無い色を先に並べても読む量が増えるだけ——.claude/rules/arcade.md の
 * 「必要になってから」に従う）。
 */
const arcade: Palette = {
  bg: '#0a0a12',
  bg2: '#1a1a2e',
  ink: '#f4f4f0',
  dim: '#8888a0',
  line: '#33334d',
  accent: '#ffcc00',
  accent2: '#ff2266',
  good: '#33ee66',
  bad: '#ff3322',
  cool: '#22aaff',
};

const THEMES: Record<ThemeName, Palette> = { keitai, mono, flash, arcade };

export function getPalette(theme: ThemeName = 'keitai'): Palette {
  return THEMES[theme] ?? keitai;
}

/** パレットのキーとして有効か（Painter が生の hex を弾くために使う） */
export type ColorKey = keyof Palette;
