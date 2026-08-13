import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, SIZE, PANEL_BG, BORDER, HARD_SHADOW } from '../brand';
import { fade, rise } from './common';

type Place = 'bottom' | 'top' | 'center' | 'lower-left';

const PLACE: Record<Place, React.CSSProperties> = {
  bottom: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 120 },
  top: { justifyContent: 'flex-start', alignItems: 'center', paddingTop: 110 },
  center: { justifyContent: 'center', alignItems: 'center' },
  'lower-left': { justifyContent: 'flex-end', alignItems: 'flex-start', paddingBottom: 48, paddingLeft: 56 },
};

/**
 * テロップ。
 *
 * **1行16文字まで、2行まで。** 3行になったら文が長すぎる（telop-rules.md §2）。
 * 改行は原稿側（EDL）で \n を入れて決める。ここで自動改行しないのは、
 * どこで切れるかを人が決めたほうが読みやすいから。
 */
export const Telop: React.FC<{
  text: string;
  style?: 'main' | 'sub' | 'note' | 'chapter' | 'credit';
  place?: Place;
  color?: keyof typeof C;
  durFrames: number;
  fontFamily: string;
}> = ({ text, style = 'main', place = 'bottom', color = 'ink', durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  const dy = rise(f, fps);

  // sub = ナレーションの字幕。演出テロップ（main）よりひとまわり小さく、常に脇役
  const size =
    style === 'chapter' ? SIZE.chapter
    : style === 'sub' ? SIZE.sub
    : style === 'note' ? SIZE.note
    : style === 'credit' ? SIZE.credit
    : SIZE.main;
  const weight = style === 'note' || style === 'credit' || style === 'sub' ? 700 : 900;

  return (
    <AbsoluteFill style={{ ...PLACE[place], display: 'flex', opacity: o }}>
      <div
        style={{
          transform: `translateY(${dy}px)`,
          background: style === 'credit' ? 'transparent' : PANEL_BG,
          border: style === 'credit' ? 'none' : BORDER,
          padding: style === 'credit' ? 0 : style === 'note' ? '10px 20px' : style === 'sub' ? '12px 26px' : '18px 34px',
          color: C[color],
          fontFamily,
          fontWeight: weight,
          fontSize: size,
          lineHeight: 1.28,
          letterSpacing: '0.01em',
          textAlign: place === 'lower-left' ? 'left' : 'center',
          textShadow: HARD_SHADOW,
          whiteSpace: 'pre-wrap',
          maxWidth: '86%',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
