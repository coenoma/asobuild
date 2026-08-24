/**
 * ゲームの登録簿。ゲームを1本足すたびに、ここへ2行だけ追記する。
 * （`npm run new -- <slug>` を使えば自動で追記されるので、手で書く必要はない）
 *
 * metas はメタ情報だけを静的に読む（一覧・OGP 用）。
 * loaders はゲーム本体を遅延読み込みする（ページを開いたときだけ落ちてくる）。
 * この2本立てにしておくと、ゲームが100本になっても一覧は軽いまま。
 */

import type { AnyGame, GameMeta } from '@/arcade/types';

import { meta as hanko } from './hanko/meta';
import { meta as tamago } from './tamago/meta';
import { meta as tamatsunagi } from './tamatsunagi/meta';
import { meta as nuimichi } from './nuimichi/meta';
import { meta as ippunIssho } from './ippun-issho/meta';

export const metas: GameMeta[] = [hanko, tamago, tamatsunagi, nuimichi, ippunIssho];

export const loaders: Record<string, () => Promise<{ default: AnyGame }>> = {
  'ippun-issho': () => import('./ippun-issho/game'),
  nuimichi: () => import('./nuimichi/game'),
  tamatsunagi: () => import('./tamatsunagi/game'),
  hanko: () => import('./hanko/game'),
  tamago: () => import('./tamago/game'),
};

function byNewest(list: GameMeta[]): GameMeta[] {
  return [...list].sort((a, b) => {
    if ((b.pin ?? 0) !== (a.pin ?? 0)) return (b.pin ?? 0) - (a.pin ?? 0);
    return b.released.localeCompare(a.released);
  });
}

/** 表に出すもの（新しい順） */
export function sortedMetas(): GameMeta[] {
  return byNewest(metas.filter((m) => m.status !== 'botsu'));
}

/** ボツ棚。消さずに残しておく */
export function botsuMetas(): GameMeta[] {
  return byNewest(metas.filter((m) => m.status === 'botsu'));
}

export function findMeta(slug: string): GameMeta | undefined {
  return metas.find((m) => m.slug === slug);
}
