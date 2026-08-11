import type { Metadata } from 'next';
import Link from 'next/link';
import { sortedMetas } from '@/games/registry';
import { GateView } from './GateView';
import styles from './gate.module.css';

export const metadata: Metadata = {
  title: 'めんどうさゲート',
  description:
    'ボットに何百回も遊ばせて、「面白くなりようがない状態」でないかを数字で確かめています。ここで動かして結果を見られます。',
  alternates: { canonical: '/gate' },
};

export default function GatePage() {
  const metas = sortedMetas();

  return (
    <main className={styles.main}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.back}>
          ← ぜんぶ見る
        </Link>
      </nav>

      <header className={styles.header}>
        <h1 className={styles.title}>めんどうさゲート</h1>
        <p className={styles.lead}>
          このサイトのゲームは、公開する前に<strong>ボットが何百回も遊んで</strong>検定しています。
          <br />
          「面白いか」は人が決めますが、<strong>面白くなりようがない状態</strong>は機械で弾けます。
        </p>
      </header>

      <GateView metas={metas} />

      <section className={styles.about}>
        <h2 className={styles.aboutTitle}>何を見ているのか</h2>
        <dl className={styles.terms}>
          <dt>放置</dt>
          <dd>何もしないボット。これで生き残れるなら、そのゲームには緊張がない</dd>
          <dt>でたらめ</dt>
          <dd>適当に押すボット。初めて遊ぶ人に近い</dd>
          <dt>上手い</dt>
          <dd>そのゲーム専用に書いたボット。上手い人の代わり</dd>
        </dl>
        <p className={styles.note}>
          ここで動いている検定は、開発中に <code>npm run fun</code> で走らせているものと
          <strong>同じコード</strong>です。見せるための別物ではありません。
        </p>
      </section>
    </main>
  );
}
