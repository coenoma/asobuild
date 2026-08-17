import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, SIZE, PANEL_BG, BORDER, HARD_SHADOW, SUB_BG, SUB_INK, SUB_EDGE, CARD_SHADOW } from '../brand';
import { fade, rise } from './common';

type Place = 'bottom' | 'top' | 'center' | 'lower-left' | 'center-right';

const PLACE: Record<Place, React.CSSProperties> = {
  bottom: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 76 },
  top: { justifyContent: 'flex-start', alignItems: 'center', paddingTop: 96 },
  center: { justifyContent: 'center', alignItems: 'center' },
  'lower-left': { justifyContent: 'flex-end', alignItems: 'flex-start', paddingBottom: 48, paddingLeft: 56 },
  // 画を左に置いたとき、右の空きに出す（コールドオープン等）
  'center-right': { justifyContent: 'center', alignItems: 'flex-end', paddingRight: 170 },
};

/**
 * テロップ。2種類ある。
 *
 * - **sub（字幕）** … 喋りの全文。**全幅の真っ黒な帯**にする。
 *   ゲーム画面に重ねる場面が多く、盤面と同系色の小さな札にすると
 *   「ゲームのUIの一部」に見えて読まれない（001のFB 8・13）。
 *   テレビの字幕と同じ形（全幅・黒・白文字）にすると、下がゲームでも文字として読まれる。
 * - **main（演出）** … 見出し。太い枠と硬い影で**画面から浮かせる**。
 *
 * **1行16文字まで、2行まで。** 3行になったら文が長すぎる（telop-rules.md §2）。
 * 改行は原稿側（EDL）で \n を入れて決める。ここで自動改行しないのは、
 * どこで切れるかを人が決めたほうが読みやすいから。
 */
export const Telop: React.FC<{
  text: string;
  style?: 'main' | 'sub' | 'note' | 'chapter' | 'credit';
  place?: Place;
  color?: keyof typeof C;
  durFrames: number;
  fontFamily: string;
}> = ({ text, style = 'main', place = 'bottom', color = 'ink', durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  const dy = rise(f, fps);

  const size =
    style === 'chapter' ? SIZE.chapter
    : style === 'sub' ? SIZE.sub
    : style === 'note' ? SIZE.note
    : style === 'credit' ? SIZE.credit
    : SIZE.main;

  // 字幕＝全幅の帯。**明るい地に黒い文字**にして、盤面と明暗を逆にする
  if (style === 'sub') {
    return (
      <AbsoluteFill style={{ ...PLACE[place], display: 'flex', opacity: o }}>
        <div
          style={{
            width: '100%',
            background: SUB_BG,
            borderTop: `6px solid ${SUB_EDGE}`,
            borderBottom: `6px solid ${SUB_EDGE}`,
            padding: '18px 60px',
            // 色の指定があっても、地が明るいので暗い文字に寄せる（ink は黒）
            color: color === 'ink' ? SUB_INK : C[color],
            fontFamily,
            // 字幕はいちばん読ませるもの。書体の最太（900）で置く
            fontWeight: 900,
            fontSize: size,
            lineHeight: 1.22,
            letterSpacing: '0.01em',
            textAlign: 'center',
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ ...PLACE[place], display: 'flex', opacity: o }}>
      <div
        style={{
          transform: `translateY(${dy}px)`,
          // 演出＝明るい札に太い色枠。外側に黒線を回して、盤面から完全に切り離す
          background: style === 'credit' ? 'transparent' : style === 'main' || style === 'note' ? SUB_BG : PANEL_BG,
          border:
            style === 'credit' ? 'none'
            : style === 'main' ? `8px solid ${C[color]}`
            : style === 'note' ? `4px solid ${C[color]}`
            : BORDER,
          outline: style === 'main' ? `5px solid ${SUB_EDGE}` : style === 'note' ? `3px solid ${SUB_EDGE}` : undefined,
          boxShadow: style === 'main' ? CARD_SHADOW : undefined,
          padding: style === 'credit' ? 0 : style === 'note' ? '10px 22px' : '18px 40px',
          color: style === 'main' || style === 'note' ? SUB_INK : C[color],
          fontFamily,
          fontWeight: style === 'credit' ? 800 : 900,
          fontSize: size,
          lineHeight: 1.24,
          letterSpacing: '0.01em',
          textAlign: place === 'lower-left' ? 'left' : 'center',
          textShadow: style === 'main' || style === 'note' ? undefined : HARD_SHADOW,
          whiteSpace: 'pre-wrap',
          maxWidth: '86%',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

/**
 * 字幕の帯。**1枚だけ置いて、文字を差し替える。**
 *
 * 行ごとに帯を出し入れすると、切り替わりのたびに背景が一瞬消えて**またたく**。
 * また、1行と2行で高さが変わると**枠が上下に跳ねる**（001のFB）。
 * so 帯は喋っているあいだ出しっぱなしにし、中の文字だけを入れ替える。
 * 高さは1行ぶんに固定し、長い行は文字を少し縮めて収める（折り返さない）。
 */
export const SubtitleTrack: React.FC<{
  subs: { at: number; dur: number; text: string; color?: keyof typeof C }[];
  fontFamily: string;
}> = ({ subs, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = f / fps;
  if (subs.length === 0) return null;

  const sorted = [...subs].sort((a, b) => a.at - b.at);
  /** 帯を出しっぱなしにするひとつながり。次の行まで 1.2秒以内なら同じかたまり */
  const HOLD = 1.2;
  const runs: { from: number; to: number }[] = [];
  for (const s of sorted) {
    const last = runs[runs.length - 1];
    if (last && s.at - last.to <= HOLD) last.to = Math.max(last.to, s.at + s.dur);
    else runs.push({ from: s.at, to: s.at + s.dur });
  }
  const run = runs.find((r) => t >= r.from - 0.15 && t <= r.to + 0.15);
  if (!run) return null;

  // いま出す文字。行と行のすきまでは、直前の行を残す（文字が消えて見えないように）
  const active = sorted.filter((s) => s.at <= t).pop();
  if (!active) return null;

  // 帯の出入りだけ 0.15秒。中の文字は入れ替えるだけ
  const o = Math.min(1, Math.min(t - (run.from - 0.15), run.to + 0.15 - t) / 0.15);

  const PAD_X = 60;
  // 長い行は縮めて1行に収める（全角はだいたい1文字＝1em）
  const room = width - PAD_X * 2;
  const size = Math.min(SIZE.sub, Math.floor(room / Math.max(1, active.text.length)));
  const lineH = Math.round(SIZE.sub * 1.22);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 76, opacity: Math.max(0, o) }}>
      <div
        style={{
          width: '100%',
          height: lineH + 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: SUB_BG,
          borderTop: `6px solid ${SUB_EDGE}`,
          borderBottom: `6px solid ${SUB_EDGE}`,
          padding: `0 ${PAD_X}px`,
        }}
      >
        <span
          style={{
            color: active.color && active.color !== 'ink' ? C[active.color] : SUB_INK,
            fontFamily,
            fontWeight: 900,
            fontSize: size,
            lineHeight: 1.22,
            letterSpacing: '0.01em',
            whiteSpace: 'nowrap',
          }}
        >
          {active.text}
        </span>
      </div>
    </AbsoluteFill>
  );
};
