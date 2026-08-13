import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, HARD_SHADOW, SUB_BG } from '../brand';
import { fade } from './common';
import type { Box } from '../types';

/**
 * 画面のここを見て、と指す部品。
 *
 * 001のFB:「なんかできてる のところ、ぬいみち を囲うなり矢印でぴょんぴょんとか
 * うまーい演出いれて？」
 *
 * **映っているだけでは気づかれない。** 一覧に1つ増えた、みたいな小さな変化ほど、
 * 指してやらないと見つけてもらえないまま流れる。
 *
 * 枠が一度だけキュッと締まり、矢印が跳ね続ける。位置は画面に対する％で書く
 * （素材の寄り方が変わったら、ここも測り直す。`node scripts/find-crop.mjs` で下見できる）。
 */
export const Spot: React.FC<{
  /** 囲う範囲（画面に対する％） */
  box: Box;
  /** 矢印の横に出す言葉。無くてもよい */
  label?: string;
  /** 矢印をどちら側に置くか */
  from?: 'left' | 'right' | 'top' | 'bottom';
  color?: 'accent' | 'good' | 'bad' | 'cool';
  durFrames: number;
  fontFamily: string;
}> = ({ box, label, from = 'left', color = 'accent', durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);

  // 枠は一回り大きいところから 0.2秒で締まる（見つけた、という動き）
  const grow = interpolate(f, [0, Math.round(fps * 0.2)], [1.35, 1], { extrapolateRight: 'clamp' });
  // 矢印は 0.5秒周期で跳ね続ける
  const hop = Math.abs(Math.sin((f / fps) * Math.PI * 2)) * 16;

  const horizontal = from === 'left' || from === 'right';
  const arrow = from === 'left' ? '▶' : from === 'right' ? '◀' : from === 'top' ? '▼' : '▲';

  const pos: React.CSSProperties = horizontal
    ? {
        top: `${box.y + box.h / 2}%`,
        [from === 'left' ? 'right' : 'left']: `${from === 'left' ? 100 - box.x : box.x + box.w}%`,
        transform: `translate(${from === 'left' ? -hop : hop}px, -50%)`,
        flexDirection: from === 'left' ? 'row' : 'row-reverse',
      }
    : {
        left: `${box.x + box.w / 2}%`,
        [from === 'top' ? 'bottom' : 'top']: `${from === 'top' ? 100 - box.y : box.y + box.h}%`,
        transform: `translate(-50%, ${from === 'top' ? -hop : hop}px)`,
        flexDirection: 'column',
      };

  return (
    <AbsoluteFill style={{ opacity: o }}>
      <div
        style={{
          position: 'absolute',
          left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`,
          border: `5px solid ${C[color]}`,
          transform: `scale(${grow})`,
          boxShadow: `0 0 0 4px rgba(0,0,0,0.55)`,
        }}
      />
      <div style={{ position: 'absolute', display: 'flex', alignItems: 'center', gap: 12, ...pos }}>
        <span style={{ fontSize: 58, color: C[color], textShadow: HARD_SHADOW, lineHeight: 1 }}>{arrow}</span>
        {label ? (
          <span
            style={{
              fontFamily, fontWeight: 900, fontSize: 44, color: C[color],
              background: SUB_BG, border: `3px solid ${C[color]}`, padding: '8px 18px',
              textShadow: HARD_SHADOW, whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
