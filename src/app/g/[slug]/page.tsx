import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findMeta, metas } from '@/games/registry';
import { GameLoader } from './GameLoader';
import styles from './page.module.css';

export function generateStaticParams() {
  return metas.map((m) => ({ slug: m.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const meta = findMeta(slug);
  if (!meta) return { title: 'みつかりません' };
  return {
    title: meta.title,
    description: `${meta.howto}。${meta.constraint ? `${meta.constraint}のなかで作りました。` : ''}ブラウザですぐ遊べます。`,
    alternates: { canonical: `/g/${slug}` },
  };
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const meta = findMeta(slug);
  if (!meta) notFound();

  return (
    <main className={styles.main}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.back}>
          ← ぜんぶ見る
        </Link>
      </nav>

      <GameLoader slug={slug} />

      <section className={styles.about}>
        <h1 className={styles.title}>{meta.title}</h1>
        <p className={styles.howto}>{meta.howto}</p>
        <dl className={styles.facts}>
          {meta.constraint && (
            <>
              <dt>制約</dt>
              <dd>{meta.constraint}</dd>
            </>
          )}
          <dt>公開</dt>
          <dd>{meta.released}</dd>
        </dl>
        {meta.video && (
          <p>
            <a href={meta.video} target="_blank" rel="noopener noreferrer">
              作っているところを見る（YouTube）
            </a>
          </p>
        )}
      </section>
    </main>
  );
}
