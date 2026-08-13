import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, HARD_SHADOW } from '../brand';
import { fade } from './common';
import { Scrim } from './Scrim';

/**
 * 面白さゲートの結果。**この番組にしかない絵**なので、専用の見せ方を持たせる。
 *
 * 落ちた項目の名前は、言葉そのものが面白い（「一気に遊びきれる長さ」など）。
 * だから小さく流さず、大きく出す（structure.md §⑧）。
 * 文言は .live/status.jsonl から引くので手打ちしない。
 */
export const Gate: React.FC<{
  pass: boolean;
  failed?: string[];
  total?: number;
  durFrames: number;
  fontFamily: string;
}> = ({ pass, failed = [], total = 12, durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  const ok = total - failed.length;

  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: o }}>
      <Scrim />
      <div
        style={{
          position: 'relative',
          background: 'rgba(16,24,32,0.94)',
          border: `3px solid ${C.line}`,
          padding: '36px 54px',
          minWidth: 1120,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 26 }}>
          <span style={{ fontFamily, fontWeight: 700, fontSize: 40, color: C.dim }}>おもしろさ けんてい</span>
          <span
            style={{
              fontFamily, fontWeight: 900, fontSize: 48,
              color: pass ? C.good : C.bad, textShadow: HARD_SHADOW,
            }}
          >
            {pass ? 'ぜんぶ みどり' : 'まだ ダメ'}
          </span>
        </div>

        {/* 12項目を四角で並べる。緑と赤の数がひと目で分かればよい */}
        <div style={{ display: 'flex', gap: 10, marginBottom: failed.length ? 26 : 0 }}>
          {Array.from({ length: total }).map((_, i) => {
            const bad = i >= ok;
            // 左から順に点く
            const lit = interpolate(f, [Math.round(fps * 0.1) + i * 2, Math.round(fps * 0.1) + i * 2 + 3], [0, 1], {
              extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
            });
            return (
              <div
                key={i}
                style={{
                  width: 78, height: 28,
                  background: bad ? C.bad : C.good,
                  opacity: lit,
                }}
              />
            );
          })}
        </div>

        {failed.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {failed.map((label, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ width: 20, height: 20, background: C.bad, flex: '0 0 auto' }} />
                <span style={{ fontFamily, fontWeight: 900, fontSize: 56, color: C.ink, textShadow: HARD_SHADOW }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontFamily, fontWeight: 900, fontSize: 56, color: C.good, textShadow: HARD_SHADOW }}>
            {total}こうもく ぜんぶ みどり
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
