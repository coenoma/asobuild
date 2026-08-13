import React from 'react';
import { AbsoluteFill } from 'remotion';

/**
 * カードを出すときに、後ろの映像を沈める幕。
 *
 * 開発画面は文字だらけなので、上に文字を重ねると**どちらも読めなくなる**。
 * 後ろは「本物の画面である」ことが伝わればよく、読ませる必要はない。
 * ぼかしは使わない（当時の画面にぼかしはない）。暗くするだけ。
 */
export const Scrim: React.FC<{ amount?: number }> = ({ amount = 0.78 }) => (
  <AbsoluteFill style={{ background: `rgba(16,24,32,${amount})` }} />
);
