import React from 'react';
import { Composition } from 'remotion';
import { Episode, totalFrames } from './Episode';
import { Thumbnail } from './Thumbnail';
import type { Edl } from './types';
import edl from '../edl/001-nuimichi.json';

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

      {/*
        サムネは案を並べて比べる（1つに決め打ちしない）。
        どれも完成品とスコアを出していない ＝ 結果が見えたら押す理由が消えるため。
      */}
      <Composition
        id="Thumbnail-A"
        component={Thumbnail}
        durationInFrames={1}
        fps={1}
        width={1280}
        height={720}
        defaultProps={{ line1: '1杯ぶんで', line2: 'ゲームは作れるか', note: 'コードは1文字も書かない' }}
      />
      <Composition
        id="Thumbnail-B"
        component={Thumbnail}
        durationInFrames={1}
        fps={1}
        width={1280}
        height={720}
        defaultProps={{ line1: '30分', line2: 'ミニゲームを1本つくって出す', note: 'コードは1文字も書かない' }}
      />
      <Composition
        id="Thumbnail-C"
        component={Thumbnail}
        durationInFrames={1}
        fps={1}
        width={1280}
        height={720}
        defaultProps={{ line1: '飲み干すまでに', line2: 'どこまで作れるか', note: '作るのは ぜんぶ AI' }}
      />
    </>
  );
};
