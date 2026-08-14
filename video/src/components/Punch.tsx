import React from 'react';
import { AbsoluteFill, Audio, Freeze, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Shot } from './Shot';
import type { Box } from '../types';

/**
 * 決めの瞬間 ── 一気に寄って、止まって、音が鳴る。
 *
 * ゲーム側 feel.ts のヒットストップ（当たった瞬間、世界が一瞬止まる）の動画への移植。
 * バラエティの「ズーム→静止→効果音」と同じ文法で、**ここが見せ場だ**と編集が肩を叩く。
 *
 * 使いどころは3つだけ: 記録更新・初めて動いた・即死（docs/video/structure.md §決めの瞬間）。
 * **1本に2〜3回まで。** 毎回やると「ここぞ」が消える（sting が1本1回なのと同じ規律）。
 *
 * 覆っているあいだも下の映像は進む（戻さない・巻かない）。だから dur は 0.4〜0.8秒に収める。
 * 結果画面のような静止した画に当てると、下が進んでいても切れ目が見えない。
 */
export const Punch: React.FC<{
  /** どのクリップの */
  clip: string;
  /** クリップ内の何秒の画で止めるか */
  frame: number;
  /** 寄り。1.35 で 35% 寄る */
  zoom?: number;
  /** 寄る中心（0〜1）。決めたいもの（スコア表示など）の位置に置く */
  origin?: [number, number];
  box?: Box;
  fit?: 'cover' | 'contain';
  /** 鳴らす音（public/sfx/<name>.wav）。null で無音 */
  sound?: string | null;
  volume?: number;
  durFrames: number;
}> = ({ clip, frame, zoom = 1.35, origin = [0.5, 0.5], box, fit, sound = 'best', volume = 0.9, durFrames }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  // 3コマで一気に寄って、そのまま止める。
  // ゆっくり寄せると「ズーム」であって「決め」にならない（パンチイン）
  const scale = interpolate(f, [0, 3], [1, zoom], { extrapolateRight: 'clamp' });
  // 最初の一瞬だけ白く光る（当たった感）。すぐ消す
  const flash = interpolate(f, [0, 1, 4], [0.85, 0.85, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          transform: `scale(${scale})`,
          transformOrigin: `${origin[0] * 100}% ${origin[1] * 100}%`,
        }}
      >
        {/* 指定の1コマで凍らせた画を、走っている映像の上にかぶせる */}
        <Freeze frame={Math.round(frame * fps)}>
          <Shot clip={clip} box={box} fit={fit} zoom={1} durFrames={durFrames} />
        </Freeze>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: '#ffffff', opacity: flash, pointerEvents: 'none' }} />
      {sound ? <Audio src={staticFile(`sfx/${sound}.wav`)} volume={volume} /> : null}
    </AbsoluteFill>
  );
};
