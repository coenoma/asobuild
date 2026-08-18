import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';

/**
 * サイト（globals.css の --font-dot）と同じ書体を使う。動画とサイトで見た目を揃える。
 * 実体は node scripts/fonts.mjs が public/fonts/ に置く（リポジトリには入れない）。
 *
 * 読み込みは**必ずコンポーネントの中でやる**。モジュールの一番外で delayRender を呼ぶと、
 * コンポジションを数えるだけの工程でも待ちが発生して描画そのものが止まる（実際に止まった）。
 *
 * ここに1本化してある。**コピーを作らない**——実際に3か所へコピーされて、
 * 1か所だけ太さ範囲の指定が漏れる事故が起きた（900 のつもりが 400 で描かれる）。
 */
export const fontFamily = 'NotoSansJPLocal';

export function useLocalFont(): void {
  const [handle] = useState(() => delayRender('書体の読み込み'));
  useEffect(() => {
    // 変数フォントなので、**太さの範囲を書かないと 900 が効かない**（400で描かれる）
    const face = new FontFace(fontFamily, `url(${staticFile('fonts/NotoSansJP.ttf')})`, {
      weight: '100 900',
    });
    face
      .load()
      .then(() => {
        // TS の lib.dom には FontFaceSet.add がまだ無い（実ブラウザには昔からある）。型だけ補う
        (document.fonts as unknown as { add(f: FontFace): void }).add(face);
        continueRender(handle);
      })
      .catch((e) => {
        // 書体が無いまま描くと別物になるので、黙って進めない
        cancelRender(new Error(`書体を読めませんでした。先に node scripts/fonts.mjs を実行してください: ${String(e)}`));
      });
  }, [handle]);
}
