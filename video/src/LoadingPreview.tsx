import React from 'react';
import { Loading } from './components/Loading';
import { fontFamily, useLocalFont } from './fonts';

/** ローディング画面の見本（remotion studio / still で単体確認する用） */
export const LoadingPreview: React.FC = () => {
  useLocalFont();
  return <Loading note="つぎ：ブラッシュアップ" durFrames={36} fontFamily={fontFamily} />;
};
