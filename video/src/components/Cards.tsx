import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, SIZE, HARD_SHADOW } from '../brand';
import { fade } from './common';
import { Scrim } from './Scrim';

/** 章のあたま。前の画を 0.2秒だけ黒で切ってから出す（structure.md） */
export const ChapterCard: React.FC<{ no: string; title: string; durFrames: number; fontFamily: string }> = ({
  no, title, durFrames, fontFamily,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  // 帯が横に開く。0.2秒で開ききる
  const w = interpolate(f, [0, Math.round(fps * 0.2)], [0, 100], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: o }}>
      <Scrim amount={0.82} />
      <div style={{ position: 'relative', width: `${w}%`, height: 6, background: C.accent }} />
      <div
        style={{
          position: 'relative',
          background: C.bg2, border: `3px solid ${C.accent}`, padding: '30px 70px',
          display: 'flex', alignItems: 'baseline', gap: 30,
        }}
      >
        <span style={{ fontFamily, fontWeight: 900, fontSize: 44, color: C.accent, textShadow: HARD_SHADOW }}>{no}</span>
        <span style={{ fontFamily, fontWeight: 900, fontSize: SIZE.chapter, color: C.ink, textShadow: HARD_SHADOW }}>{title}</span>
      </div>
      <div style={{ position: 'relative', width: `${w}%`, height: 6, background: C.accent }} />
    </AbsoluteFill>
  );
};

/** 数字の強調。スコアが確定した瞬間に出す */
export const BigNumber: React.FC<{
  value: string; unit?: string; label?: string; color?: 'accent' | 'good' | 'bad'; durFrames: number; fontFamily: string;
}> = ({ value, unit, label, color = 'accent', durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  // 出た瞬間だけ 1.06 → 1.0。0.12秒で戻す（やりすぎない）
  const s = interpolate(f, [0, Math.round(fps * 0.12)], [1.06, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: o }}>
      <Scrim amount={0.55} />
      <div style={{ position: 'relative', transform: `scale(${s})`, textAlign: 'center' }}>
        {label ? (
          <div style={{ fontFamily, fontWeight: 700, fontSize: SIZE.note, color: C.dim, textShadow: HARD_SHADOW, marginBottom: 6 }}>
            {label}
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 10 }}>
          <span style={{ fontFamily, fontWeight: 900, fontSize: SIZE.number, color: C[color], textShadow: HARD_SHADOW, lineHeight: 1 }}>
            {value}
          </span>
          {unit ? (
            <span style={{ fontFamily, fontWeight: 900, fontSize: 52, color: C[color], textShadow: HARD_SHADOW }}>{unit}</span>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 冒頭のタイトル */
export const TitleCard: React.FC<{ title: string; sub: string; durFrames: number; fontFamily: string }> = ({
  title, sub, durFrames, fontFamily,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', alignItems: 'center', opacity: o }}>
      <div style={{ fontFamily, fontWeight: 900, fontSize: 130, color: C.accent, letterSpacing: '0.06em', textShadow: HARD_SHADOW }}>
        {title}
      </div>
      <div style={{ width: 220, height: 3, background: C.line, margin: '26px 0' }} />
      <div style={{ fontFamily, fontWeight: 700, fontSize: 40, color: C.ink, textAlign: 'center', lineHeight: 1.5 }}>
        {sub}
      </div>
    </AbsoluteFill>
  );
};

/** 締め。読み上げに頼らず、画面に文字で出す（video-doctrine.md §6） */
export const EndCard: React.FC<{ url: string; lines: string[]; durFrames: number; fontFamily: string }> = ({
  url, lines, durFrames, fontFamily,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', alignItems: 'center', opacity: o, padding: 80 }}>
      <div style={{ fontFamily, fontWeight: 700, fontSize: 40, color: C.dim, marginBottom: 20 }}>あそべます</div>
      <div
        style={{
          fontFamily, fontWeight: 900, fontSize: 84, color: C.accent,
          border: `4px solid ${C.accent}`, padding: '22px 54px', textShadow: HARD_SHADOW,
        }}
      >
        {url}
      </div>
      <div style={{ marginTop: 60, display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'center' }}>
        {lines.map((l, i) => (
          <div key={i} style={{ fontFamily, fontWeight: 700, fontSize: 44, color: C.ink }}>{l}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
