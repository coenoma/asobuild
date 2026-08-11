'use client';

/**
 * ゲーム本体はこのコンポーネントからだけ読み込む（遅延読み込み）。
 * 一覧ページやメタ情報はゲーム本体を巻き込まないので、
 * ゲームが何十本になってもトップページは軽いまま。
 */

import { useEffect, useState } from 'react';
import { GameShell } from '@/arcade/GameShell';
import { loaders } from '@/games/registry';
import type { AnyGame } from '@/arcade/types';
import styles from './page.module.css';

export function GameLoader({ slug }: { slug: string }) {
  const [game, setGame] = useState<AnyGame | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = loaders[slug];
    if (!load) {
      setFailed(true);
      return;
    }
    load()
      .then((mod) => {
        if (alive) setGame(mod.default);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  if (failed) {
    return <p className={styles.loading}>ゲームを読み込めませんでした。</p>;
  }
  if (!game) {
    return <p className={styles.loading}>よみこみ中…</p>;
  }
  return <GameShell game={game} />;
}
