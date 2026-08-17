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
        /**
         * 盤面に角丸は使わない（当時の画面に角丸はない）。
         * ただしワイプは**番組側の窓**なので、丸めて縁をつける。
         * 縁は border ではなく影の輪で作る（border だと映像が食われて顔が小さくなる）。
         * 白い輪 → 細い黒 → 落ち影、の3枚重ねで「浮いた窓」に見せる。
         */
        borderRadius: wipe ? 22 : undefined,
        border: wipe ? undefined : withFrame ? `3px solid ${C.line}` : undefined,
        boxShadow: wipe
          ? [
              `0 0 0 5px rgba(233,241,228,0.96)`,   // 白い輪
              `0 0 0 8px rgba(16,24,32,0.92)`,      // その外に細い黒
              `0 14px 30px rgba(0,0,0,0.5)`,        // 落ち影
            ].join(', ')
          : undefined,
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
      {wipe ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 22,
            // 内側にうっすら影。窓のふちが立って見える
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28), inset 0 -14px 22px rgba(0,0,0,0.28)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
};

/** 何も無いところを埋める黒 */
export const Black: React.FC = () => <AbsoluteFill style={{ background: '#000' }} />;
