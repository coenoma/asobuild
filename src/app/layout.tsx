import type { Metadata, Viewport } from 'next';
import { SITE_URL } from '@/arcade/share';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'アソビルド — つくったものは、ぜんぶ遊べます',
    template: '%s | アソビルド',
  },
  description:
    'コーヒー1杯、ポテトM、カップ麺3分。制約の中でミニゲームを作る番組「アソビルド」で生まれたものを、その場で遊べる場所です。',
  openGraph: {
    type: 'website',
    siteName: 'アソビルド',
    locale: 'ja_JP',
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#0b1016',
  // ゲーム中に画面が拡大縮小すると操作にならないので固定する
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
