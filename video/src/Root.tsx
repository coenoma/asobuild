import React from 'react';
import { Composition } from 'remotion';
import { Episode, totalFrames } from './Episode';
import { Thumbnail } from './Thumbnail';
import { LoadingPreview } from './LoadingPreview';
import type { Edl } from './types';
import edl from '../edl/001-nuimichi.json';
import { Short, shortTotalFrames, type ShortRecipe } from './Short';
import s1 from '../edl/shorts/001-s1-sonja.json';
import s2 from '../edl/shorts/001-s2-owatta.json';
import s3 from '../edl/shorts/001-s3-hamaru.json';

/**
 * 編集の中身は edl/*.json にある。ここは「どの EDL を、どの大きさで描くか」だけ。
 *
 * 回が増えたら Composition を足す（EDL を差し替える）。
 * コードは触らない設計にしてある: docs/video/structure.md
 */
export const RemotionRoot: React.FC = () => {
  const e = edl as unknown as Edl;
  return (
    <>
      <Composition
        id="Episode"
        component={Episode}
        durationInFrames={totalFrames(e, e.meta.fps)}
        fps={e.meta.fps}
        width={e.meta.width}
        height={e.meta.height}
        defaultProps={{ edl: e }}
      />

      {/* ショート（縦 1080×1920）。レシピ駆動。docs/video/shorts.md */}
      {[s1, s2, s3].map((r) => (
        <Composition
          key={r.id}
          id={`Short-${r.id.replace('001-', '')}`}
          component={Short}
          durationInFrames={shortTotalFrames(r as unknown as ShortRecipe, 30)}
          fps={30}
          width={1080}
          height={1920}
          defaultProps={{ recipe: r as unknown as ShortRecipe }}
        />
      ))}

      {/*
        サムネは案を並べて比べる（1つに決め打ちしない）。
        どれも完成品とスコアを出していない ＝ 結果が見えたら押す理由が消えるため。
      */}
      {/* 場面転換パーツの見本。動画へは EDL の layer type "loading" で入れる */}
      <Composition
        id="Loading"
        component={LoadingPreview}
        durationInFrames={36}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />

      <Composition
        id="Thumbnail-A"
        component={Thumbnail}
        durationInFrames={1}
        fps={1}
        width={1280}
        height={720}
        defaultProps={{ big: '作れるのか', cond: 'ソイラテ1杯で', gameClip: 'hum-play', gameAt: 3, bigColor: 'accent' }}
      />
      <Composition
        id="Thumbnail-B"
        component={Thumbnail}
        durationInFrames={1}
        fps={1}
        width={1280}
        height={720}
        defaultProps={{ big: 'こうなった', cond: '雑に頼んだら', gameClip: 'turn-title', gameAt: 6, bigColor: 'accent' }}
      />
      <Composition
        id="Thumbnail-C"
        component={Thumbnail}
        durationInFrames={1}
        fps={1}
        width={1280}
        height={720}
        defaultProps={{ big: 'なにこれ', cond: 'AIが14分で', gameClip: 'ugly-play', gameAt: 4, bigColor: 'bad' }}
      />
    </>
  );
};
