import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C } from '../brand';
import type { Box } from '../types';

/**
 * 素材を1つ出す。
 *
 * **素材をそのまま置かない。必ず寄る。**（telop-rules.md §8）
 * 画面収録は 2560×1664 のまま置くと、ターミナルの字が読めず、ゲームも小さい。
 */
export const Shot: React.FC<{
  clip: string;
  box?: Box;
  fit?: 'cover' | 'contain';
  zoom?: number | [number, number];
  origin?: [number, number];
  frame?: boolean;
  /** ワイプ（自撮りの小窓）。窓らしい縁をつける */
  wipe?: boolean;
  durFrames: number;
}> = ({ clip, box, fit = 'cover', zoom = 1, origin = [0.5, 0.5], frame: withFrame, wipe, durFrames }) => {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const scale = Array.isArray(zoom)
    ? interpolate(f, [0, durFrames], zoom, { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : zoom;

  const style: React.CSSProperties = box
    ? {
        position: 'absolute',
        left: (box.x / 100) * width,
        top: (box.y / 100) * height,
        width: (box.w / 100) * width,
        height: (box.h / 100) * height,
      }
    : { position: 'absolute', inset: 0 };

  return (
    <div
      style={{
        ...style,
        overflow: 'hidden',
        // 盤面に角丸は使わない（当時の画面に角丸はない）。
        // ただしワイプは「番組側の窓」なので、少し丸めて縁をつけたほうが窓に見える
        borderRadius: wipe ? 12 : undefined,
        border: wipe ? `5px solid ${C.ink}` : withFrame ? `3px solid ${C.line}` : undefined,
        outline: wipe ? `3px solid ${C.bg}` : undefined,
        boxShadow: wipe ? '0 10px 26px rgba(0,0,0,0.55)' : undefined,
        background: C.bg,
      }}
    >
      <OffthreadVideo
        src={staticFile(`footage/${clip}.mp4`)}
        style={{
          width: '100%',
          height: '100%',
          objectFit: fit,
          // 縦長の素材（ターミナル 960×1440）を横長の枠に入れると大半が枠外に出る。
          // どこを見せるかは origin で決める。ここを指定しないと必ず真ん中になり、
          // 読ませたい行が画面に入らない
          objectPosition: `${origin[0] * 100}% ${origin[1] * 100}%`,
          transform: `scale(${scale})`,
          transformOrigin: `${origin[0] * 100}% ${origin[1] * 100}%`,
        }}
        // 音は使わない（喋りは後から乗せる／効果音は別に作る）
        muted
      />
    </div>
  );
};

/** 何も無いところを埋める黒 */
export const Black: React.FC = () => <AbsoluteFill style={{ background: '#000' }} />;
