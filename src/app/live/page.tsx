import { notFound } from 'next/navigation';
import { LiveView } from './LiveView';

/**
 * 収録カンペ。開発中に別ウィンドウで開いて、録画に映す。
 * 本番サイトには要らないので、本番ビルドでは出さない。
 */
export const dynamic = 'force-dynamic';

// 録画にタブが映ることがあるので、カンペと分かる名前にしておく
export const metadata = { title: 'カンペ' };

export default function LivePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <LiveView />;
}
