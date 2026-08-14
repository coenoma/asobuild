import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, SIZE, HARD_SHADOW } from '../brand';

/**
 * 画面上端の帯。**最初から最後まで消えない**（フックと締めを除く）。
 *
 * 仕事は2つ。
 *  1. まだ終わっていないことを見せ続ける（video-doctrine.md §4）
 *  2. 開発の実時間を出す。「30分でここまで来た」が伝わる
 *
 * カップの残量は制約そのもの。減っていくのが見えることが企画になっている
 * （docs/guides/収録レギュレーション.md「残り時間が画面に映るものほど強い」）。
 */
export const ProgramBar: React.FC<{
  constraint: string;
  chapterLabel?: string;
  /**
   * その章で映っている素材の、開発時刻（秒）の目盛り。
   * `{ at, dur, dev }` … 章内 at 秒から dur 秒のあいだ、開発時刻 dev から進む。
   *
   * **章の頭と尻を線で結ぶ（従来）とズレる。** 章のなかで素材が飛ぶので、
   * 「7分半 考えている」と言っている画面の脇で 5:45 と出る、といった食い違いが起きた（001のFB）。
   * だから**いま映っている素材の時刻をそのまま出す**。
   */
  marks?: { at: number; dur: number; dev: number; recap?: boolean }[];
  devFrom: number;
  devTo: number;
  /** 制約が尽きる開発時刻（秒）。ここで残量が 0 になる */
  drainAt: number;
  durFrames: number;
  fontFamily: string;
}> = ({ constraint, chapterLabel, marks, devFrom, devTo, drainAt, durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();

  const t = f / fps;
  const active = marks?.filter((m) => m.at <= t).pop();
  /** ふりかえりの画。時計を進めても戻しても嘘になるので、そう書く */
  const isRecap = Boolean(active?.recap);
  let dev: number;
  if (marks && marks.length) {
    // いま映っている素材の時刻。無ければ直前の素材の終わりで止める
    const live = marks.filter((m) => m.at <= t && !m.recap).pop();
    dev = live ? live.dev + Math.min(t - live.at, live.dur) : marks[0].dev;
  } else {
    dev = interpolate(f, [0, durFrames], [devFrom, devTo], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
  }
  const left = Math.max(0, 1 - dev / drainAt);
  const empty = left <= 0.001;

  const mm = String(Math.floor(dev / 60)).padStart(2, '0');
  const ss = String(Math.floor(dev % 60)).padStart(2, '0');
  const clock = isRecap ? 'ふりかえり' : `${mm}:${ss}`;

  const cell: React.CSSProperties = {
    fontFamily, fontWeight: 700, fontSize: SIZE.bar, color: C.ink,
    textShadow: HARD_SHADOW, whiteSpace: 'nowrap',
  };

  return (
    <div
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 62,
        background: 'rgba(16,24,32,0.88)', borderBottom: `2px solid ${C.line}`,
        display: 'flex', alignItems: 'center', gap: 26, padding: '0 30px',
      }}
    >
      <span style={{ ...cell, fontWeight: 900, color: C.accent, letterSpacing: '0.08em' }}>アソビルド</span>
      <span style={{ width: 2, height: 26, background: C.line }} />
      <span style={{ ...cell, color: empty ? C.dim : C.ink }}>{empty ? '飲み干した' : constraint}</span>

      {/* 残量。10目盛りで減らす（なめらかに減らすと変化が見えない） */}
      <div style={{ display: 'flex', gap: 3 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            style={{
              width: 16, height: 22,
              background: i < Math.ceil(left * 10) ? C.accent : 'transparent',
              border: `2px solid ${i < Math.ceil(left * 10) ? C.accent : C.line}`,
            }}
          />
        ))}
      </div>

      <span style={{ flex: 1 }} />
      {chapterLabel ? <span style={{ ...cell, color: C.dim }}>{chapterLabel}</span> : null}
      <span style={{ width: 2, height: 26, background: C.line }} />
      <span style={{ ...cell, fontWeight: 900, color: C.accent, fontVariantNumeric: 'tabular-nums' }}>
        {clock}
      </span>
      <span style={{ ...cell, color: C.dim, fontSize: 24 }}>けいか</span>
    </div>
  );
};
