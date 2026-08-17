import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, SIZE, HARD_SHADOW, SUB_BG, SUB_INK, SUB_EDGE, CARD_SHADOW } from '../brand';
import { fade } from './common';
import { Scrim } from './Scrim';

/** 章のあたま。前の画を 0.2秒だけ黒で切ってから出す（structure.md） */
export const ChapterCard: React.FC<{ no: string; title: string; durFrames: number; fontFamily: string }> = ({
  no, title, durFrames, fontFamily,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  // 帯が横に開く。0.2秒で開ききる
  const w = interpolate(f, [0, Math.round(fps * 0.2)], [0, 100], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: o }}>
      <Scrim amount={0.82} />
      <div style={{ position: 'relative', width: `${w}%`, height: 6, background: C.accent }} />
      <div
        style={{
          position: 'relative',
          background: C.bg2, border: `3px solid ${C.accent}`, padding: '30px 70px',
          display: 'flex', alignItems: 'baseline', gap: 30,
        }}
      >
        <span style={{ fontFamily, fontWeight: 900, fontSize: 44, color: C.accent, textShadow: HARD_SHADOW }}>{no}</span>
        <span style={{ fontFamily, fontWeight: 900, fontSize: SIZE.chapter, color: C.ink, textShadow: HARD_SHADOW }}>{title}</span>
      </div>
      <div style={{ position: 'relative', width: `${w}%`, height: 6, background: C.accent }} />
    </AbsoluteFill>
  );
};

/**
 * 数字の強調。スコアが確定した瞬間に出す。
 *
 * **盤面の真ん中に重ねない**（001のFB1）。ゲーム自身がすでに点数を出しているので、
 * 同じ位置に同じ数字を重ねると「動画が点数を足している」ように見えて紛らわしい。
 * 盤面に重なる場面では `place: 'right'` にして、**盤面の外に判子として置く**。
 */
export const BigNumber: React.FC<{
  value: string; unit?: string; label?: string; color?: 'accent' | 'good' | 'bad';
  place?: 'center' | 'right'; durFrames: number; fontFamily: string;
}> = ({ value, unit, label, color = 'accent', place = 'center', durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  // 出た瞬間だけ 1.06 → 1.0。0.12秒で戻す（やりすぎない）
  const s = interpolate(f, [0, Math.round(fps * 0.12)], [1.06, 1], { extrapolateRight: 'clamp' });
  const right = place === 'right';
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: right ? 'flex-end' : 'center',
        paddingRight: right ? 60 : 0,
        opacity: o,
      }}
    >
      {right ? null : <Scrim amount={0.55} />}
      <div
        style={{
          position: 'relative', transform: `scale(${s})`, textAlign: 'center',
          // 盤面の外に置くときは、動画側の札だと分かる見た目にする
          // 盤面の外に置くときは、字幕と同じ**明るい札**にする。
          // 暗い札に色の数字だと、盤面の点数表示とそっくりで見分けがつかない
          background: right ? SUB_BG : undefined,
          border: right ? `8px solid ${C[color]}` : undefined,
          outline: right ? `5px solid ${SUB_EDGE}` : undefined,
          boxShadow: right ? CARD_SHADOW : undefined,
          padding: right ? '16px 28px' : undefined,
        }}
      >
        {label ? (
          <div style={{ fontFamily, fontWeight: 900, fontSize: SIZE.note, color: right ? SUB_INK : C.dim, textShadow: right ? undefined : HARD_SHADOW, marginBottom: 4 }}>
            {label}
          </div>
        ) : null}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 10 }}>
          <span style={{ fontFamily, fontWeight: 900, fontSize: right ? 118 : SIZE.number, color: right ? SUB_INK : C[color], textShadow: right ? undefined : HARD_SHADOW, lineHeight: 1 }}>
            {value}
          </span>
          {unit ? (
            <span style={{ fontFamily, fontWeight: 900, fontSize: 52, color: right ? SUB_INK : C[color], textShadow: right ? undefined : HARD_SHADOW }}>{unit}</span>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** 冒頭のタイトル */
export const TitleCard: React.FC<{ title: string; sub: string; durFrames: number; fontFamily: string }> = ({
  title, sub, durFrames, fontFamily,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);
  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', alignItems: 'center', opacity: o }}>
      <div style={{ fontFamily, fontWeight: 900, fontSize: 130, color: C.accent, letterSpacing: '0.06em', textShadow: HARD_SHADOW }}>
        {title}
      </div>
      <div style={{ width: 220, height: 3, background: C.line, margin: '26px 0' }} />
      <div style={{ fontFamily, fontWeight: 700, fontSize: 40, color: C.ink, textAlign: 'center', lineHeight: 1.5 }}>
        {sub}
      </div>
    </AbsoluteFill>
  );
};

/**
 * 締め。読み上げに頼らず、画面に文字で出す（video-doctrine.md §6）。
 *
 * **全部いっぺんに出さない。** 固定の1枚絵にすると、17秒間まったく動かない画になり、
 * いちばん離脱してほしくないところで離脱される（001のFB 16）。
 * 見出し → URL → お願いを1行ずつ、と順番に出す。**毎回そのまま使い回す部品**なので、
 * ここを直すと次回以降ぜんぶ良くなる。
 */
export const EndCard: React.FC<{
  url: string;
  lines?: string[];
  /** 声が「高評価」「登録」と言う瞬間に合わせて出すボタン。at は章内の秒 */
  buttons?: { at: number; label: string }[];
  durFrames: number;
  fontFamily: string;
}> = ({ url, lines, buttons, durFrames, fontFamily }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = fade(f, durFrames, fps);

  // 出てくる順番（秒）。行はあとから1本ずつ足される
  const AT_LABEL = 0.15;
  const AT_URL = 0.5;
  const AT_LINES = 1.6;
  const GAP = 1.25;

  /** 出はじめに一度だけ跳ねる。0.18秒で戻す（やりすぎない） */
  const pop = (atSec: number) => {
    const s0 = Math.round(fps * atSec);
    if (f < s0) return null;
    const t = f - s0;
    return {
      opacity: interpolate(t, [0, Math.round(fps * 0.12)], [0, 1], { extrapolateRight: 'clamp' }),
      transform: `translateY(${interpolate(t, [0, Math.round(fps * 0.18)], [14, 0], { extrapolateRight: 'clamp' })}px)`,
    } as React.CSSProperties;
  };

  // URLの枠は1秒周期でゆっくり点滅させる（止め画にしない）
  const blink = 0.72 + 0.28 * Math.abs(Math.sin((f / fps) * Math.PI));

  const label = pop(AT_LABEL);
  const urlStyle = pop(AT_URL);

  return (
    <AbsoluteFill style={{ background: C.bg, justifyContent: 'center', alignItems: 'center', opacity: o, padding: 80 }}>
      {label ? (
        <div style={{ ...label, fontFamily, fontWeight: 700, fontSize: 40, color: C.dim, marginBottom: 20 }}>
          あそべます
        </div>
      ) : null}
      {urlStyle ? (
        <div
          style={{
            ...urlStyle,
            fontFamily, fontWeight: 900, fontSize: 84, color: C.accent,
            border: `4px solid ${C.accent}`, padding: '22px 54px', textShadow: HARD_SHADOW,
            opacity: (urlStyle.opacity as number) * blink,
          }}
        >
          {url}
        </div>
      ) : null}
      {/*
        お願いの文はここに書かない（001のFB2）。
        字幕と二重になるうえ、声とタイミングが合わない。
        文はナレーション原稿から演出テロップとして出す（＝声と必ず同期する）。
      */}
      {/* 声と同期して出るボタン（数万再生クラスの定番。声だけより効く） */}
      <div style={{ marginTop: 46, display: 'flex', gap: 26 }}>
        {(buttons ?? []).map((b, i) => {
          const st = pop(b.at);
          if (!st) return null;
          return (
            <div
              key={i}
              style={{
                ...st,
                fontFamily, fontWeight: 900, fontSize: 46,
                color: '#12161c', background: 'rgba(244,246,241,0.97)',
                border: `6px solid ${C.accent}`, borderRadius: 999,
                padding: '14px 44px',
              }}
            >
              {b.label}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 30, display: 'flex', flexDirection: 'column', gap: 22, alignItems: 'center' }}>
        {(lines ?? []).map((l, i) => {
          const st = pop(AT_LINES + i * GAP);
          if (!st) return null;
          return (
            <div key={i} style={{ ...st, display: 'flex', alignItems: 'center', gap: 18 }}>
              <span style={{ width: 14, height: 14, background: C.accent, flexShrink: 0 }} />
              <span style={{ fontFamily, fontWeight: 700, fontSize: 44, color: C.ink }}>{l}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
