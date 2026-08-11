import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findMeta, metas } from '@/games/registry';
import { GameLoader } from './GameLoader';
import styles from './page.module.css';

/** YouTube の各種URLから動画IDを取り出す（watch / youtu.be / shorts / embed） */
function youtubeId(url: string): string | null {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/.exec(url);
  return m ? m[1] : null;
}

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
    // npm run ogp で焼いた実プレイの画像（無ければ共通のものになる）
    openGraph: {
      title: meta.title,
      description: meta.howto,
      images: [{ url: `/ogp/${slug}.png`, width: 1200, height: 630, alt: `${meta.title}の画面` }],
    },
    twitter: {
      card: 'summary_large_image',
      images: [`/ogp/${slug}.png`],
    },
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
        {meta.video &&
          (youtubeId(meta.video) ? (
            <section className={styles.video}>
              <h2 className={styles.videoTitle}>作っているところ</h2>
              <div className={styles.videoFrame}>
                {/* 余計な追跡をさせないよう nocookie 側を使う */}
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${youtubeId(meta.video)}`}
                  title={`${meta.title}を作っている動画`}
                  allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture; web-share"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            </section>
          ) : (
            <p>
              <a href={meta.video} target="_blank" rel="noopener noreferrer">
                作っているところを見る（YouTube）
              </a>
            </p>
          ))}

        {meta.inspiration && (
          <div className={styles.inspiration}>
            <h2 className={styles.inspirationTitle}>着想について</h2>
            <p>
              {meta.inspiration.from}から着想を得ています。参考にしたのは
              <strong>{meta.inspiration.borrowed}</strong>で、
              {meta.inspiration.original}はすべてこの作品のために作ったものです。
              既存作品の画像・音・コードは使用していません。
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
