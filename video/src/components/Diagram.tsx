import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, HARD_SHADOW } from '../brand';
import { fade } from './common';

/**
 * 自作の図解。
 *
 * 下敷きにした作品の画は1フレームも使えない（docs/video/safety-checklist.md §3）。
 * かわりに **仕組みだけを棒と丸で描く**。元の配色・キャラ・UIは再現しない。
 *
 * これは制約ではなく、むしろこちらのほうが分かりやすい。
 * 検索結果を映すより、何が面白いのかが伝わる。
 */

const VW = 1600;
const VH = 760;

/**
 * 縫い針は**右に1本**。糸は**左からくねくね**しながら伸びて、その穴を通す。
 *
 * 001のFB:「縫い針は右の方に1つ、左からくねくねする感じで、いっぽんに通すという感じの演出に」
 * 「はなすと落ちる、が物理法則的に不自然だから正弦波というか、くねくねするように」
 *
 * 押しているあいだ上がり、離すと落ちる——を素直に描くと直線の折れ線になるが、
 * 実際の手ざわりは**波打ちながら進む**。だから正弦波で描く。
 */
const NEEDLE = { x: 1180, hole: 380, gap: 78 };
const START = { x: 90, y: 470 };
/** 波の高さと、画面いっぱいに入る波の数 */
const AMP = 96;
const WAVES = 2.4;

function threadPoints() {
  const pts: [number, number][] = [];
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = START.x + (NEEDLE.x - START.x) * t;
    // 穴に近づくほど波を小さくして、ぴたりと通す
    const taper = 1 - t * t;
    const base = START.y + (NEEDLE.hole - START.y) * t;
    pts.push([x, base - Math.sin(t * Math.PI * 2 * WAVES) * AMP * taper]);
  }
  // 通したあとは、そのまま右へ抜ける
  for (let i = 1; i <= 20; i++) {
    const t = i / 20;
    pts.push([NEEDLE.x + (VW - 80 - NEEDLE.x) * t, NEEDLE.hole - Math.sin(t * Math.PI) * 26]);
  }
  return pts;
}

const NEEDLES = [NEEDLE];

const PTS = threadPoints();
const PATH = PTS.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const Label: React.FC<{ x: number; y: number; text: string; color?: string; size?: number; anchor?: 'start' | 'middle' }> = ({
  x, y, text, color = C.ink, size = 40, anchor = 'middle',
}) => (
  <text
    x={x} y={y} fill={color} fontSize={size} fontWeight={900} textAnchor={anchor}
    style={{ paintOrder: 'stroke', stroke: C.bg, strokeWidth: 8, strokeLinejoin: 'round' }}
  >
    {text}
  </text>
);

/** ①「押している間だけ上がる。はなすと落ちる」を見せる */
const Thread: React.FC<{ progress: number; fontFamily: string }> = ({ progress, fontFamily }) => {
  const total = PTS.length - 1;
  const idx = Math.min(total, Math.max(0, Math.round(progress * total)));
  const [hx, hy] = PTS[idx];
  const drawn = PTS.slice(0, idx + 1).map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: '100%', fontFamily }}>
      {/* 布（下地） */}
      <rect x={40} y={120} width={VW - 80} height={520} fill={C.bg2} stroke={C.line} strokeWidth={3} />

      {/* 縫い針は右に1本。上下2本の棒のあいだが「めど」 */}
      {NEEDLES.map((n, i) => (
        <g key={i}>
          <rect x={n.x - 17} y={140} width={34} height={n.hole - 140 - n.gap / 2} fill={C.ink} />
          <rect x={n.x - 17} y={n.hole + n.gap / 2} width={34} height={620 - (n.hole + n.gap / 2)} fill={C.ink} />
          {/* めど（穴）。ここを通す */}
          <rect
            x={n.x - 17} y={n.hole - n.gap / 2} width={34} height={n.gap}
            fill={C.bg} stroke={C.accent} strokeWidth={4}
          />
          <Label x={n.x} y={n.hole - n.gap / 2 - 22} text="めど" color={C.accent} size={34} />
        </g>
      ))}

      {/* 通った軌跡 */}
      <path d={PATH} fill="none" stroke={C.line} strokeWidth={5} strokeDasharray="10 14" />
      <path d={drawn} fill="none" stroke={C.accent2} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={hx} cy={hy} r={16} fill={C.accent} stroke={C.bg} strokeWidth={4} />

      <Label x={330} y={84} text="おしている間 ▲ 上がる" color={C.good} size={42} />
      <Label x={870} y={84} text="はなすと ▼ 落ちる" color={C.bad} size={42} />
      <Label x={VW / 2} y={690} text="くねくね進んで、めどに1本 通す" color={C.dim} size={36} />
    </svg>
  );
};

/** ②「面白さの肝をどこへずらしたか」を見せる */
const Shift: React.FC<{ progress: number; fontFamily: string }> = ({ progress, fontFamily }) => {
  const right = interpolate(progress, [0.35, 0.6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const mult = Math.min(5, 1 + Math.floor(interpolate(progress, [0.6, 1], [0, 5], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })));
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', height: '100%', fontFamily }}>
      {/* 左：もとの遊びの中心 */}
      <rect x={60} y={120} width={620} height={480} fill={C.bg2} stroke={C.line} strokeWidth={3} />
      <Label x={370} y={190} text="むかしの遊びの中心" color={C.dim} size={36} />
      <rect x={330} y={250} width={26} height={110} fill={C.ink} />
      <rect x={330} y={452} width={26} height={110} fill={C.ink} />
      <path d="M180,470 Q260,300 343,406" fill="none" stroke={C.accent2} strokeWidth={9} strokeLinecap="round" />
      <circle cx={343} cy={406} r={14} fill={C.accent} />
      <Label x={370} y={640} text="1つの穴を ていねいに通す" color={C.ink} size={40} />

      {/* 矢印 */}
      <path d={`M720,380 L860,380`} stroke={C.accent} strokeWidth={8} />
      <path d={`M840,358 L872,380 L840,402 Z`} fill={C.accent} />

      {/* 右：こちらの中心 */}
      <g opacity={right}>
        <rect x={920} y={120} width={620} height={480} fill={C.bg2} stroke={C.accent} strokeWidth={3} />
        <Label x={1230} y={190} text="ぬいみち の中心" color={C.accent} size={36} />
        {[1040, 1160, 1280, 1400].map((x, i) => (
          <g key={x} opacity={i < mult - 1 ? 1 : 0.25}>
            <rect x={x - 11} y={250} width={22} height={100} fill={C.ink} />
            <rect x={x - 11} y={442} width={22} height={100} fill={C.ink} />
          </g>
        ))}
        <path d="M960,470 Q1000,330 1040,396 Q1090,470 1160,396 Q1220,330 1280,396 Q1340,470 1400,396"
          fill="none" stroke={C.accent2} strokeWidth={8} strokeLinecap="round" />
        <Label x={1470} y={300} text={`×${mult}`} color={C.accent} size={64} />
        <Label x={1230} y={640} text="通すほど 倍率が上がる" color={C.ink} size={40} />
      </g>
      <Label x={VW / 2} y={690} text="同じ手ざわりのまま 面白さの肝だけ動かす" color={C.dim} size={34} />
    </svg>
  );
};

export const Diagram: React.FC<{ kind: 'thread' | 'shift'; durFrames: number; fontFamily: string }> = ({
  kind, durFrames, fontFamily,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  // 出入りのぶんを除いた中身の進み具合
  const p = interpolate(f, [Math.round(fps * 0.2), durFrames - Math.round(fps * 0.3)], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ background: C.bg, opacity: o, padding: '54px 60px 150px' }}>
      {kind === 'thread' ? <Thread progress={p} fontFamily={fontFamily} /> : <Shift progress={p} fontFamily={fontFamily} />}
    </AbsoluteFill>
  );
};
