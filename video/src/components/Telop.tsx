import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, SIZE, PANEL_BG, BORDER, HARD_SHADOW, SUB_BG, SUB_INK, SUB_EDGE, CARD_SHADOW } from '../brand';
import { fade, rise } from './common';

type Place = 'bottom' | 'top' | 'center' | 'lower-left';

const PLACE: Record<Place, React.CSSProperties> = {
  bottom: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 76 },
  top: { justifyContent: 'flex-start', alignItems: 'center', paddingTop: 96 },
  center: { justifyContent: 'center', alignItems: 'center' },
  'lower-left': { justifyContent: 'flex-end', alignItems: 'flex-start', paddingBottom: 48, paddingLeft: 56 },
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
            fontWeight: 800,
            fontSize: size,
            lineHeight: 1.24,
            letterSpacing: '0.015em',
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
          fontWeight: style === 'credit' ? 700 : style === 'note' ? 800 : 900,
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
