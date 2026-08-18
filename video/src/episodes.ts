/**
 * 回（エピソード）の登録簿。**回が増えたら、ここに1行足すだけ**（Root.tsx は触らない）。
 *
 * ゲーム側の src/games/registry.ts と同じ思想。
 * 以前は Root.tsx が 001 を直に import していて、「EDL を1つ足すだけ」という
 * README の約束が実際には嘘だった（package.json も 001 決め打ちだった）。
 * 回ごとのコマンドは scripts/episode.mjs が slug から組み立てる。
 *
 * ショートのレシピ id は「連番-s◯-名前」。コンポジション id は連番を落として
 * `Short-s1-sonja` になるので、**名前の部分は回をまたいで重複させない**こと。
 */

import type { Edl } from './types';
import type { ShortRecipe } from './Short';

import e001 from '../edl/001-nuimichi.json';
import s001a from '../edl/shorts/001-s1-sonja.json';
import s001b from '../edl/shorts/001-s2-owatta.json';
import s001c from '../edl/shorts/001-s3-hamaru.json';

export interface EpisodeEntry {
  edl: Edl;
  shorts: ShortRecipe[];
}

export const episodes: EpisodeEntry[] = [
  {
    edl: e001 as unknown as Edl,
    shorts: [s001a, s001b, s001c] as unknown as ShortRecipe[],
  },
];
