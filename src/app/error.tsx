'use client';

/**
 * ページごと落ちたときの受け皿。
 * 白い画面や英語のスタックトレースを出さず、当時のケータイっぽく謝る。
 * 収録中に出てもネタになる見た目にしておく。
 */

import styles from './error.module.css';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className={styles.main}>
      <div className={styles.box}>
        <p className={styles.face}>{'( ×_× )'}</p>
        <h1 className={styles.title}>エラーが はっせい しました</h1>
        <p className={styles.body}>{error.message || 'なにかが うまく いきませんでした'}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} onClick={reset}>
            もう一回
          </button>
          <a className={styles.link} href="/">
            ぜんぶ見る
          </a>
        </div>
      </div>
    </main>
  );
}
