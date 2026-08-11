'use client';

/**
 * 開発のリザルト画面。
 *
 * ゲームの終わりに出るリザルトと同じ形で、その日の開発を締める。
 * 「ゲームのリザルトの様式で開発をリザルトする」という入れ子が、そのままシリーズの記号になる。
 * 動画のエンディングにも、Xに貼る画像にもこのまま使える。
 */

import { useEffect, useState } from 'react';
import styles from './result.module.css';

interface Summary {
  empty: boolean;
  totalSeconds?: number;
  phases?: { name: string; seconds: number }[];
  limit?: { label: string; seconds: number } | null;
  gate?: { attempts: number; passedAt: number | null; topReason: string | null; slugs: string[] };
  code?: { added: number; removed: number; files: number; commits: number };
}

function jpDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}びょう`;
  const rest = s % 60;
  return rest === 0 ? `${m}ふん` : `${m}ふん${rest}びょう`;
}

export function ResultView() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/live/result', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('bad'))))
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return <main className={styles.main}>読み込めませんでした（開発サーバーは動いていますか）</main>;
  }
  if (!data) {
    return <main className={styles.main}>あつめています…</main>;
  }
  if (data.empty) {
    return (
      <main className={styles.main}>
        <div className={styles.card}>
          <p className={styles.empty}>
            まだ記録がありません。
            <br />
            <code>npm run dev:rec</code> で収録をはじめてください。
          </p>
        </div>
      </main>
    );
  }

  const gate = data.gate!;
  const code = data.code!;

  return (
    <main className={styles.main}>
      <div className={styles.card}>
        <p className={styles.kicker}>きょうの開発</p>

        <div className={styles.hero}>
          <span className={styles.heroValue}>{jpDuration(data.totalSeconds ?? 0)}</span>
          <span className={styles.heroLabel}>
            {data.limit ? `${data.limit.label}（${jpDuration(data.limit.seconds)}）で` : 'かけて'}
          </span>
        </div>

        <dl className={styles.rows}>
          <dt>ゲート</dt>
          <dd>
            {gate.attempts === 0
              ? 'まだ検定していない'
              : gate.passedAt
                ? `${gate.passedAt}かいめで合格`
                : `${gate.attempts}回まわして まだ合格していない`}
          </dd>

          <dt>書いた行</dt>
          <dd>
            <span className={styles.added}>+{code.added}</span>{' '}
            <span className={styles.removed}>-{code.removed}</span>
            <span className={styles.sub}>
              　{code.files}ファイル{code.commits > 0 ? ` / ${code.commits}コミット` : ''}
            </span>
          </dd>

          {gate.topReason && (
            <>
              <dt>いちばんの死因</dt>
              <dd className={styles.reason}>{gate.topReason}</dd>
            </>
          )}

          {data.phases && data.phases.length > 0 && (
            <>
              <dt>うちわけ</dt>
              <dd className={styles.phases}>
                {data.phases.map((p, i) => (
                  <span key={`${p.name}-${i}`} className={styles.phase}>
                    {p.name} {jpDuration(p.seconds)}
                  </span>
                ))}
              </dd>
            </>
          )}
        </dl>

        {gate.slugs.length > 0 && (
          <div className={styles.made}>
            <p className={styles.madeLabel}>できたもの</p>
            {gate.slugs.map((s) => (
              <p key={s} className={styles.madeUrl}>
                asobuild.coenoma.com/g/{s}
              </p>
            ))}
          </div>
        )}

        <p className={styles.foot}>アソビルド</p>
      </div>

      <p className={styles.hint}>
        この画面をそのまま動画の締めに使えます。ウィンドウごと撮るか、スクリーンショットを撮ってください。
      </p>
    </main>
  );
}
