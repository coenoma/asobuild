'use client';

/**
 * 全ゲームを横断した進み具合。
 *
 * ゲームが増えるほど「全部埋めたい」が効くようにするための仕掛け。
 * 記録は端末の中にしかないので、サーバーは要らない。
 * 何も遊んでいない人には出さない（空の進捗バーほど寂しいものはない）。
 */

import { useEffect, useState } from 'react';
import { getBest, getPlays } from '@/arcade/storage';
import { isAllCleared } from '@/arcade/goals';
import { metas } from '@/games/registry';
import styles from './page.module.css';

export function Collection({ slugs }: { slugs: string[] }) {
  const [state, setState] = useState<{ played: number; cleared: number; total: number } | null>(null);

  useEffect(() => {
    let played = 0;
    let cleared = 0;
    for (const slug of slugs) {
      if (getPlays(slug) > 0) played++;
      const meta = metas.find((m) => m.slug === slug);
      if (meta?.goals?.length && isAllCleared(meta.goals, getBest(slug))) cleared++;
    }
    setState({ played, cleared, total: slugs.length });
  }, [slugs]);

  // サーバー側では記録が読めないので、最初の描画では何も出さない
  if (!state || state.played === 0) return null;

  const done = state.cleared === state.total;

  return (
    <section className={styles.collection}>
      <p className={styles.collectionLine}>
        <span className={styles.collectionMain}>
          {state.total}本中 {state.played}本 あそんだ
        </span>
        <span className={done ? styles.collectionDone : styles.collectionSub}>
          {done ? 'ぜんぶ達成ずみ！' : `称号コンプ ${state.cleared}／${state.total}`}
        </span>
      </p>
      <div className={styles.collectionTrack}>
        <div
          className={styles.collectionFill}
          style={{ width: `${(state.cleared / Math.max(1, state.total)) * 100}%` }}
        />
      </div>
    </section>
  );
}
