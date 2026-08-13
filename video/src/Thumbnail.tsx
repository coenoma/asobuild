import React, { useEffect, useState } from 'react';
import {
  AbsoluteFill, OffthreadVideo, cancelRender, continueRender, delayRender, staticFile,
} from 'remotion';
import { C } from './brand';

/**
 * サムネイル。型はシリーズで固定する（毎回同じレイアウト＝「また来た」を作る）。
 *
 * 実物サムネ48枚の調査（docs/video/research-notes/2026-08-13-youtube.md）から採った文法:
 *  - **AI名はバッジで大きく**（視聴者は「どのAIがやるのか」を配役として見ている）
 *  - **ゲーム画面はプレイ途中の決定的瞬間**を大きく。結果（最終スコア・成否）は出さない
 *  - **制約の実物**（カップ＋手）を入れる。物理モノはクリックを作る
 *  - 文字は1メッセージ。いちばん大きい行は7文字級
 *
 * バッジは文字だけで作る（公式ロゴ画像は使わない。商標の誤認を避ける）。
 */

const FONT = 'NotoSansJPLocal';

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
  /** いちばん大きく出す言葉。7文字級（例: 作れるのか） */
  big: string;
  /** その上に置く条件・状況（例: ソイラテ1杯で） */
  cond: string;
  /** 決定的瞬間に使う素材（public/footage/ のクリップ名） */
  gameClip: string;
  /** クリップの何秒目を使うか */
  gameAt?: number;
  /** 大きい言葉の色 */
  bigColor?: 'accent' | 'bad' | 'ink';
};

export const Thumbnail: React.FC<ThumbnailProps> = ({ big, cond, gameClip, gameAt = 1, bigColor = 'accent' }) => {
  useLocalFont();

  return (
    <AbsoluteFill style={{ background: C.bg, fontFamily: FONT }}>
      <AbsoluteFill
        style={{ backgroundImage: `repeating-linear-gradient(90deg, ${C.bg} 0 34px, ${C.bg2} 34px 36px)` }}
      />

      {/* 右: ゲーム画面。プレイ途中の決定的瞬間。結果は見せない */}
      <div
        style={{
          position: 'absolute', right: 36, top: 36, width: 470, height: 648,
          overflow: 'hidden', border: `6px solid ${C.line}`, background: C.bg,
        }}
      >
        <OffthreadVideo
          src={staticFile(`footage/${gameClip}.mp4`)}
          startFrom={Math.round(gameAt * 30)}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            // 上端の点数バーは枠外へ（結果を見せない）
            transform: 'scale(1.28)', transformOrigin: '50% 62%',
          }}
          muted
        />
      </div>

      {/* 左上: AI名のバッジ（出演者クレジット）。文字だけで作る */}
      <div
        style={{
          position: 'absolute', left: 40, top: 40,
          background: '#ffffff', color: '#1a1a1a',
          fontWeight: 900, fontSize: 56, padding: '10px 28px',
          border: `4px solid ${C.line}`,
        }}
      >
        Claude Code
      </div>

      {/* 左下: 制約の実物（カップ＋手） */}
      <div
        style={{
          position: 'absolute', left: 40, bottom: 40, width: 380, height: 214,
          overflow: 'hidden', border: `5px solid ${C.line}`,
        }}
      >
        <OffthreadVideo
          src={staticFile('footage/hook-cup.mp4')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 46%' }}
          muted
        />
      </div>

      {/* 中央: 条件 → 大きい言葉。1メッセージ */}
      <div style={{ position: 'absolute', left: 40, top: 210, width: 760 }}>
        <div
          style={{
            fontWeight: 900, fontSize: 64, color: C.ink,
            textShadow: `4px 4px 0 ${C.bg}, 0 0 22px rgba(0,0,0,0.9)`,
            whiteSpace: 'nowrap',
          }}
        >
          {cond}
        </div>
        <div
          style={{
            marginTop: 8, fontWeight: 900, fontSize: 168, lineHeight: 1.04,
            color: C[bigColor],
            textShadow: `6px 6px 0 ${C.bg}, 0 0 30px rgba(0,0,0,0.95)`,
            letterSpacing: '-0.02em', whiteSpace: 'nowrap',
          }}
        >
          {big}
        </div>
      </div>
    </AbsoluteFill>
  );
};
