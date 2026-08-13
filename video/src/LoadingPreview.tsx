import React, { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { Loading } from './components/Loading';

/** ローディング画面の見本（remotion studio / still で単体確認する用） */
export const LoadingPreview: React.FC = () => {
  const [handle] = useState(() => delayRender('書体の読み込み'));
  useEffect(() => {
    const face = new FontFace('NotoSansJPLocal', `url(${staticFile('fonts/NotoSansJP.ttf')})`);
    face
      .load()
      .then(() => {
        document.fonts.add(face);
        continueRender(handle);
      })
      .catch((e) => cancelRender(new Error(String(e))));
  }, [handle]);
  return <Loading note="つぎ：ブラッシュアップ" durFrames={36} fontFamily="NotoSansJPLocal" />;
};
