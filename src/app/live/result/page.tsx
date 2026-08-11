import { notFound } from 'next/navigation';
import { ResultView } from './ResultView';

/**
 * 収録1回分のエンディングカード。
 * ゲームのリザルト画面と同じ様式で「開発そのもの」を締めるのが狙い。
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'きょうの開発' };

export default function LiveResultPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ResultView />;
}
