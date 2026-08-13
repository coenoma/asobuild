import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill, OffthreadVideo, cancelRender, continueRender, delayRender, staticFile,
} from 'remotion';
import { C, HARD_SHADOW } from './brand';

/**
 * サムネイル。
 *
 * 仕事は「結果を見たくさせる」ことだけ（docs/video/video-doctrine.md §2）。
 *  - **完成品を出さない**。スコアも「できた」かどうかも見せない
 *  - 制約の現物を写す。何が賭けられているか一目で分かるように
 *  - 数字は1つだけ。2つ置くと読まれない
 *  - 顔は入れるが主役にしない
 *
 * 文言は props にしてあるので、案を並べて比べられる（Root.tsx に登録してある）。
 *
 *   npx remotion still src/index.ts Thumbnail-A out/thumb-a.png
 */

const FONT = 'NotoSansJPLocal';

/** 文字を置ける横幅 */
const BOX_W = 810;

/**
 * 1行に収まる大きさを返す。
 * 日本語は 900 の太さでだいたい 1文字 = 文字サイズ × 0.98 の幅になる（半角は半分）。
 */
function fitSize(text: string, max: number): number {
  const w = [...text].reduce((a, ch) => a + (/[\x00-\x7F]/.test(ch) ? 0.55 : 1), 0);
  return Math.min(max, Math.floor(BOX_W / (w * 0.98)));
}

function useLocalFont(): void {
  const [handle] = useState(() => delayRender('書体の読み込み'));
  useEffect(() => {
    const face = new FontFace(FONT, `url(${staticFile('fonts/NotoSansJP.ttf')})`);
    face
      .load()
      .then(() => {
        document.fonts.add(face);
        continueRender(handle);
      })
      .catch((e) => cancelRender(new Error(String(e))));
  }, [handle]);
}

/**
 * interface ではなく type にしてある。
 * Remotion の Composition は props が Record<string, unknown> であることを求めるが、
 * interface には暗黙のインデックスシグネチャが付かないので型が通らない。
 */
export type ThumbnailProps = {
  /** 1行目。大きく出る。8文字くらいまで */
  line1: string;
  /** 2行目。1行目より小さい。12文字くらいまで */
  line2: string;
  /** 隅に置く一言 */
  note: string;
};

export const Thumbnail: React.FC<ThumbnailProps> = ({ line1, line2, note }) => {
  useLocalFont();

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT }}>
      {/* 背景はゲームの盤面と同じ縦じま */}
      <AbsoluteFill
        style={{ backgroundImage: `repeating-linear-gradient(90deg, ${C.bg} 0 34px, ${C.bg2} 34px 36px)` }}
      />

      {/* 右：ゲーム画面。遊んでいる途中で、点数は読めない大きさに置く */}
      <div
        style={{
          position: 'absolute', right: 44, top: 60, width: 386, height: 490,
          overflow: 'hidden', border: `5px solid ${C.line}`, background: C.bg,
        }}
      >
        {/* 上端の点数バーが入らないところまで寄せる。結果が見えたら押す理由が消える */}
        <OffthreadVideo
          src={staticFile('footage/hum-play.mp4')}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: 'scale(1.34)', transformOrigin: '50% 64%',
          }}
          muted
        />
      </div>

      {/* 左：制約の現物（カップ）と人。何が賭けられているかを見せる */}
      <div
        style={{
          position: 'absolute', left: 40, top: 60, width: 430, height: 242,
          overflow: 'hidden', border: `5px solid ${C.line}`,
        }}
      >
        <OffthreadVideo
          src={staticFile('footage/hook-cup.mp4')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 46%' }}
          muted
        />
      </div>

      {/* 文言。1行に収まる大きさまで自動で縮める（折り返すと下の帯にかぶる） */}
      <div style={{ position: 'absolute', left: 40, top: 322, width: BOX_W }}>
        <div
          style={{
            fontWeight: 900, fontSize: fitSize(line1, 132), lineHeight: 1.04, color: C.accent,
            textShadow: `4px 4px 0 ${C.bg}, 0 0 26px rgba(0,0,0,0.9)`, letterSpacing: '-0.02em',
            whiteSpace: 'nowrap',
          }}
        >
          {line1}
        </div>
        <div
          style={{
            marginTop: 12, fontWeight: 900, fontSize: fitSize(line2, 70), lineHeight: 1.14, color: C.ink,
            textShadow: `4px 4px 0 ${C.bg}, 0 0 20px rgba(0,0,0,0.9)`,
            whiteSpace: 'nowrap',
          }}
        >
          {line2}
        </div>
      </div>

      {/* 隅の一言。番組名は入れない（毎回同じものは読まれない） */}
      <div
        style={{
          position: 'absolute', left: 44, bottom: 34,
          background: C.bad, color: C.ink, fontWeight: 900, fontSize: 40,
          padding: '10px 22px', textShadow: HARD_SHADOW,
        }}
      >
        {note}
      </div>
    </AbsoluteFill>
  );
};
