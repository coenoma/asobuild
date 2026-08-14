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
  // 登録簿に無いことは描画の時点で分かる。分かっていることを状態にしない
  const load = loaders[slug];
  const [game, setGame] = useState<AnyGame | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!load) return;
    let alive = true;
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
  }, [load]);

  if (!load || failed) {
    return <p className={styles.loading}>ゲームを読み込めませんでした。</p>;
  }
  if (!game) {
    return <p className={styles.loading}>よみこみ中…</p>;
  }
  return <GameShell game={game} />;
}
