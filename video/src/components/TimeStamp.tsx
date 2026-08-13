import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, HARD_SHADOW } from '../brand';
import { fade } from './common';

/**
 * 経過時間の判子。**場面が変わったこと**と**いま何分か**を、まとめてバシッと出す。
 *
 * 001のFB:「区切り？シーンごとに、何分経過… とかをもっと動画全体として、
 * 時間経過をつどつど意識させる感じにしようか。バシッと目立つ共通パーツつくって、
 * それをつどつど使う感じかな」
 *
 * この番組は**制限時間そのものが企画**なので、時間の表示は飾りではなく本体。
 * 上端の帯（ProgramBar）は流し見だと目に入らないので、**節目では画面を止めて大きく出す**。
 *
 * のっぺりしないように、色帯が横に走ってから数字が出る。全体で 1.2〜1.6秒。
 */
export const TimeStamp: React.FC<{
  /** 大きく出す値。例: 「14分」「49分」 */
  value: string;
  /** 値の上の小さい字。例: 「経過」 */
  note?: string;
  /** 値の下。その場面がなんなのか。例: 「なんか、できてる」 */
  sub?: string;
  color?: 'accent' | 'good' | 'bad' | 'cool';
  /**
   * stamp = 画を止めて大きく出す（場面の切れ目）
   * chip  = 画を止めずに隅へ添える（喋りが時刻に触れるとき）
   * 小さい時刻表示をその場しのぎのテロップで作らない。**必ずこの部品を使う**
   * （001のFB:「謎の小さい22分表示が残って変。ここも共通パーツにしようよ」）
   */
  variant?: 'stamp' | 'chip';
  durFrames: number;
  fontFamily: string;
}> = ({ value, note = '経過', sub, color = 'accent', variant = 'stamp', durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);

  // 色帯が左から画面いっぱいに走る（0.22秒）→ そのあと数字
  const band = interpolate(f, [0, Math.round(fps * 0.22)], [0, 100], { extrapolateRight: 'clamp' });
  const numIn = Math.round(fps * 0.16);
  const numO = interpolate(f, [numIn, numIn + Math.round(fps * 0.12)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const numS = interpolate(f, [numIn, numIn + Math.round(fps * 0.16)], [1.14, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  if (variant === 'chip') {
    return (
      <AbsoluteFill style={{ opacity: o }}>
        <div
          style={{
            position: 'absolute', left: 40, top: 86,
            display: 'flex', alignItems: 'baseline', gap: 12,
            background: 'rgba(0,0,0,0.95)', border: `4px solid ${C[color]}`, padding: '10px 22px',
          }}
        >
          <span style={{ fontFamily, fontWeight: 700, fontSize: 26, color: C.dim, letterSpacing: '0.2em' }}>{note}</span>
          <span style={{ fontFamily, fontWeight: 900, fontSize: 54, color: C[color], textShadow: HARD_SHADOW }}>{value}</span>
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ opacity: o, justifyContent: 'center', alignItems: 'center' }}>
      {/* 下の映像を消す。場面が変わったことを、まず黒で伝える */}
      <AbsoluteFill style={{ background: 'rgba(0,0,0,0.92)' }} />

      {/*
        帯は**文字の外側**に置く。
        位置を % で決め打ちすると、文字数や sub の有無で高さが変わったときに
        数字の上を線が横切る（001のFBで実際に起きた）。
        だから縦に積んで、帯・文字・帯 の順に流す。
      */}
      <div
        style={{
          position: 'relative', width: '100%',
          display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 26,
        }}
      >
        <div style={{ width: `${band}%`, height: 10, background: C[color] }} />

        <div style={{ textAlign: 'center', opacity: numO, transform: `scale(${numS})`, padding: '0 60px' }}>
          <div style={{ fontFamily, fontWeight: 700, fontSize: 44, color: C.dim, letterSpacing: '0.3em' }}>
            {note}
          </div>
          <div
            style={{
              marginTop: 4,
              fontFamily, fontWeight: 900, fontSize: 210, lineHeight: 1.05,
              color: C[color], textShadow: HARD_SHADOW, letterSpacing: '-0.02em',
            }}
          >
            {value}
          </div>
          {sub ? (
            <div style={{ marginTop: 14, fontFamily, fontWeight: 900, fontSize: 62, color: C.ink, textShadow: HARD_SHADOW }}>
              {sub}
            </div>
          ) : null}
        </div>

        <div style={{ width: `${band}%`, height: 10, background: C[color], marginLeft: 'auto' }} />
      </div>
    </AbsoluteFill>
  );
};
