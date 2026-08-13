import { interpolate } from 'remotion';
import { IN_SEC, OUT_SEC } from '../brand';

/**
 * 出し入れの不透明度。
 *
 * 動きは使わない（当時の画面に滑らかな動きはない）。
 * 不透明度と縦2pxのずれだけで出す。telop-rules.md §3
 */
export function fade(frame: number, durFrames: number, fps: number) {
  const inF = Math.max(1, Math.round(IN_SEC * fps));
  const outF = Math.max(1, Math.round(OUT_SEC * fps));
  return interpolate(
    frame,
    [0, inF, Math.max(inF + 1, durFrames - outF), durFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}

/** 出るときだけ 2px 下からずらす */
export function rise(frame: number, fps: number) {
  const inF = Math.max(1, Math.round(IN_SEC * fps));
  return interpolate(frame, [0, inF], [2, 0], { extrapolateRight: 'clamp' });
}

export const secToFrames = (sec: number, fps: number) => Math.round(sec * fps);
