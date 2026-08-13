import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, HARD_SHADOW } from '../brand';
import { fade } from './common';
import { Scrim } from './Scrim';

/**
 * 「確かめた／確かめていない」のカード。
 *
 * この番組は毎回ここで終わる（CLAUDE.md「AIには確かめられないこと」）ので、
 * 使い回せる形にしてある。
 *
 * ターミナルの生の字をそのまま見せない理由：
 * スマホでは 20px の等幅日本語は読めない。**画は証拠として後ろに置き、
 * 中身はこちらで組み直して大きく出す。** 文言は画面に出ていたものと同じにすること。
 */
export const Checklist: React.FC<{
  title: string;
  items: { ok: boolean; text: string }[];
  durFrames: number;
  fontFamily: string;
}> = ({ title, items, durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: o }}>
      <Scrim />
      <div
        style={{
          position: 'relative',
          background: 'rgba(16,24,32,0.94)',
          border: `3px solid ${C.line}`,
          padding: '36px 54px',
          minWidth: 1180,
        }}
      >
        <div style={{ fontFamily, fontWeight: 900, fontSize: 44, color: C.dim, marginBottom: 26 }}>{title}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {items.map((it, i) => {
            // 上から順に出す。全部同時だと最後の1行（未確認）が埋もれる
            const at = Math.round(fps * (0.2 + i * 0.35));
            const show = interpolate(f, [at, at + Math.round(fps * 0.15)], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 22, opacity: show }}>
                <span
                  style={{
                    width: 46, height: 46, flex: '0 0 auto',
                    background: it.ok ? C.good : C.bad,
                    color: C.bg, fontFamily, fontWeight: 900, fontSize: 32,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {it.ok ? '✓' : '×'}
                </span>
                <span
                  style={{
                    fontFamily, fontWeight: 900, fontSize: 48,
                    color: it.ok ? C.ink : C.bad,
                    textShadow: HARD_SHADOW,
                  }}
                >
                  {it.text}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
