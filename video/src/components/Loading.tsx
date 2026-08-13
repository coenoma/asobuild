import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, HARD_SHADOW } from '../brand';
import { fade } from './common';

/**
 * 場面転換のローディング画面。汎用パーツ。
 *
 * よそのチャンネルの「LOADING...」転換画面と同じ役割を、このチャンネルの様式でやる。
 * 手本は外ではなく**ゲーム側の「よみこみ中…」画面**（共通シェルの起動時に出るもの）。
 * 動画とゲームで同じ画面が出ると、それ自体がチャンネルの記号になる。
 *
 * 様式は telop-rules.md / retro-style.md に従う:
 *  - ゲージは滑らかに動かさない。**目盛りが1つずつ点く**（当時の画面に滑らかな動きはない）
 *  - 「…」は1文字ずつ増える
 *  - 角丸・ぼかし・グラデーションを使わない
 *
 * 使いどころ: 場面が大きく飛ぶとき（開発時間が飛ぶ・工程が変わる）に 0.8〜1.5秒。
 * **連発しない。** 転換のたびに入れると、それ自体がテンポを削る。
 */
export const Loading: React.FC<{
  /** 中央の文言。既定は「よみこみ中」 */
  text?: string;
  /** ゲージの下に小さく出す一言（「つぎ：ブラッシュアップ」など）。省略可 */
  note?: string;
  durFrames: number;
  fontFamily: string;
}> = ({ text = 'よみこみ中', note, durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);

  // ゲージは10目盛り。尺の頭から終わりまでで点きswitchえる（最後の1目盛りは残す＝満タンで終わらない方が「次へ行く」感が出る）
  const CELLS = 10;
  const progress = interpolate(f, [0, durFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const lit = Math.min(CELLS - 1, Math.floor(progress * CELLS));

  // 「…」は0.4秒ごとに1つ増えて3つで折り返す
  const dots = '…'.repeat((Math.floor(f / Math.round(fps * 0.4)) % 3) + 1);

  return (
    <AbsoluteFill
      style={{
        background: C.bg,
        // 章の下地と同じ縦じま（ゲームの盤面の様式）
        backgroundImage: `repeating-linear-gradient(90deg, ${C.bg} 0 46px, ${C.bg2} 46px 48px)`,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: o,
      }}
    >
      {/* 四隅のドット。当時の画面の飾りはこの程度で十分 */}
      {[
        { left: 46, top: 84 },
        { right: 46, top: 84 },
        { left: 46, bottom: 46 },
        { right: 46, bottom: 46 },
      ].map((pos, i) => (
        <div key={i} style={{ position: 'absolute', ...pos, width: 14, height: 14, background: C.line }} />
      ))}

      <div
        style={{
          fontFamily,
          fontWeight: 900,
          fontSize: 64,
          color: C.ink,
          textShadow: HARD_SHADOW,
          letterSpacing: '0.14em',
          marginBottom: 40,
        }}
      >
        {text}
        {dots}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {Array.from({ length: CELLS }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 58,
              height: 26,
              background: i <= lit ? C.accent : 'transparent',
              border: `2px solid ${i <= lit ? C.accent : C.line}`,
            }}
          />
        ))}
      </div>

      {note ? (
        <div
          style={{
            marginTop: 36,
            fontFamily,
            fontWeight: 700,
            fontSize: 32,
            color: C.dim,
            textShadow: HARD_SHADOW,
          }}
        >
          {note}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
