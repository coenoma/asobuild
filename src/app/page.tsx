import Link from 'next/link';
import { botsuMetas, sortedMetas } from '@/games/registry';
import { Collection } from './Collection';
import styles from './page.module.css';

export default function Home() {
  const metas = sortedMetas();
  const botsu = botsuMetas();

  return (
    <main className={styles.main}>
      <header className={styles.hero}>
        <p className={styles.kicker}>コエノマ / YouTube「アソビルド」</p>
        <h1 className={styles.title}>アソビルド</h1>
        <p className={styles.lead}>
          コーヒー1杯、ポテトM、カップ麺3分。
          <br />
          制限時間のなかで作ったミニゲームを、その場で遊べる場所です。
        </p>
      </header>

      <section aria-labelledby="games-heading">
        <h2 id="games-heading" className={styles.sectionTitle}>
          あそぶ
        </h2>
        {metas.length === 0 ? (
          <p className={styles.empty}>まだ1本もありません。</p>
        ) : (
          <ul className={styles.grid}>
            {metas.map((m) => (
              <li key={m.slug}>
                <Link href={`/g/${m.slug}`} className={styles.card}>
                  <span className={styles.cardTitle}>{m.title}</span>
                  <span className={styles.cardHowto}>{m.howto}</span>
                  <span className={styles.cardMeta}>
                    {m.constraint ? <span className={styles.tag}>{m.constraint}</span> : null}
                    <span className={styles.date}>{m.released}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Collection slugs={metas.map((m) => m.slug)} />

      {botsu.length > 0 && (
        <section className={styles.botsuSection} aria-labelledby="botsu-heading">
          <h2 id="botsu-heading" className={styles.sectionTitle}>
            ボツ棚
          </h2>
          <p className={styles.botsuLead}>
            うまくいかなかったもの。消さずに置いてあります。遊べます。
          </p>
          <ul className={styles.grid}>
            {botsu.map((m) => (
              <li key={m.slug}>
                <Link href={`/g/${m.slug}`} className={styles.botsuCard}>
                  <span className={styles.botsuBadge}>ボツ</span>
                  <span className={styles.cardTitle}>{m.title}</span>
                  <span className={styles.cardHowto}>{m.howto}</span>
                  {m.botsuReason && <span className={styles.botsuReason}>{m.botsuReason}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.gateBanner}>
        <Link href="/gate" className={styles.gateLink}>
          <span className={styles.gateTitle}>ボットが何百回も遊んで検定しています</span>
          <span className={styles.gateSub}>めんどうさゲートを動かしてみる →</span>
        </Link>
      </section>

      <footer className={styles.footer}>
        <p>
          つくりかたも全部公開しています →{' '}
          <a href="https://github.com/coenoma/asobuild" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </p>
        <p className={styles.copy}>© 合同会社コエノマ</p>
      </footer>
    </main>
  );
}
