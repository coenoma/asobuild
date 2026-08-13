import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, SIZE, HARD_SHADOW } from '../brand';

/**
 * 画面上端の帯。**最初から最後まで消えない**（フックと締めを除く）。
 *
 * 仕事は2つ。
 *  1. まだ終わっていないことを見せ続ける（video-doctrine.md §4）
 *  2. 開発の実時間を出す。「30分でここまで来た」が伝わる
 *
 * カップの残量は制約そのもの。減っていくのが見えることが企画になっている
 * （docs/guides/収録レギュレーション.md「残り時間が画面に映るものほど強い」）。
 */
export const ProgramBar: React.FC<{
  constraint: string;
  chapterLabel?: string;
  devFrom: number;
  devTo: number;
  /** 制約が尽きる開発時刻（秒）。ここで残量が 0 になる */
  drainAt: number;
  durFrames: number;
  fontFamily: string;
}> = ({ constraint, chapterLabel, devFrom, devTo, drainAt, durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  const dev = interpolate(f, [0, durFrames], [devFrom, devTo], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const left = Math.max(0, 1 - dev / drainAt);
  const empty = left <= 0.001;

  const mm = String(Math.floor(dev / 60)).padStart(2, '0');
  const ss = String(Math.floor(dev % 60)).padStart(2, '0');

  const cell: React.CSSProperties = {
    fontFamily, fontWeight: 700, fontSize: SIZE.bar, color: C.ink,
    textShadow: HARD_SHADOW, whiteSpace: 'nowrap',
  };

  return (
    <div
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 62,
        background: 'rgba(16,24,32,0.88)', borderBottom: `2px solid ${C.line}`,
        display: 'flex', alignItems: 'center', gap: 26, padding: '0 30px',
      }}
    >
      <span style={{ ...cell, fontWeight: 900, color: C.accent, letterSpacing: '0.08em' }}>アソビルド</span>
      <span style={{ width: 2, height: 26, background: C.line }} />
      <span style={{ ...cell, color: empty ? C.dim : C.ink }}>{empty ? '飲み干した' : constraint}</span>

      {/* 残量。10目盛りで減らす（なめらかに減らすと変化が見えない） */}
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 16, height: 22,
              background: i < Math.ceil(left * 10) ? C.accent : 'transparent',
              border: `2px solid ${i < Math.ceil(left * 10) ? C.accent : C.line}`,
            }}
          />
        ))}
      </div>

      <span style={{ flex: 1 }} />
      {chapterLabel ? <span style={{ ...cell, color: C.dim }}>{chapterLabel}</span> : null}
      <span style={{ width: 2, height: 26, background: C.line }} />
      <span style={{ ...cell, fontWeight: 900, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>
        {mm}:{ss}
      </span>
      <span style={{ ...cell, color: C.dim, fontSize: 24 }}>けいか</span>
    </div>
  );
};
