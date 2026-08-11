import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 画面隅の開発バッジを消す。収録では画面ごと録画するので映り込む
  // （ビルドの状態はターミナル側で見る）
  devIndicators: false,
};

export default nextConfig;
