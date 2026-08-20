import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { C, SUB_BG, SUB_INK, SUB_EDGE, HARD_SHADOW } from './brand';
import { Diagram } from './components/Diagram';
import { secToFrames } from './components/common';
import { useLocalFont } from './fonts';

/**
 * ショート（1080×1920）。**本編の切り抜きではなく、ショートとして組み直す**。
 *
 * 2026年の実測知見（docs/video/shorts.md に出典つきでまとめてある）:
 *  - 勝敗は**完走率とリプレイ**で決まる。だから「フック 0〜1.5秒」と「ループ」が骨格
 *  - 音あり前提。ただし無音で見る人のために**字幕は常時・大きく**
 *  - 「アイデアが完結したら即終わる」。だらだら続けない
 *
 * レシピ（edl/shorts/*.json）駆動。1本 = hook + beats + loopTail。
 * 素材・声・効果音は本編と同じものを使う（prep-shorts.mjs が public/ へ用意する）。
 */

/** セーフゾーン（実測系ガイドの合意値）。上120px・下350px・右120pxはUIに重なる */
const SAFE_TOP = 130;
const SAFE_BOTTOM = 360;
// ワイプの定位置（左右中央・中央より少し上）。全拍で共通、動かさない
const WIPE_TOP = 620;
const WIPE_SIZE = 280;

export type ShortBeat = {
  /** 拍の長さ（秒） */
  dur: number;
  /** ゲーム映像（public/footage/<clip>.mp4）。from=クリップ内の開始秒 */
  video?: { clip: string; from?: number; scale?: number; y?: number; mosaic?: boolean; small?: boolean; label?: string;
    /** 早送り（2=2倍速）。丸投げ・思考待ち・修正連打を「過程は見せるが待たせない」ために使う */
    speed?: number };
  /** でかいタイトルカード（フックの上位版）。3行までの \n 区切り */
  titleText?: string;
  /**
   * 行ごとに設計するタイトル。自動折り返しに任せると語の途中で折れる（実際に折れた）。
   * marker: その行をマーカー塗り（accent地）で最大強調
   */
  titleLines?: { t: string; size?: number; marker?: boolean }[];
  /** タイトル行を1行ずつ叩き込む間隔（秒）。0/未指定なら一括表示 */
  titleStagger?: number;
  /** 映像へのパンチイン（ツッコミの瞬間に寄せて揺らす） */
  punches?: { at: number }[];
  /** 自作の図解を出す拍 */
  diagram?: 'thread' | 'shift';
  /** 画面中央のデカ文字（ツッコミ。説明にしない） */
  bigText?: string;
  /** bigText の文字サイズ（既定120。行が折れるときに下げる） */
  bigSize?: number;
  /** bigText を1文字ずつタイプライター表示する（読点で少しタメる。2文字ごとにぴこ音） */
  bigTyped?: boolean;
  /** bigText の置き場。リザルト画面と数字が被るときは 'top'（最上部）へ逃がす */
  bigPos?: 'center' | 'top';
  bigColor?: 'accent' | 'bad' | 'good' | 'ink';
  /** 声（public/shorts-voice/<id>/beat-N.wav）。prep-shorts.mjs が切り出す */
  voice?: boolean;
  /** 拍の頭に置く無声の間（秒）。フリのテロップを入れるのに使う */
  voiceDelay?: number;
  /** 指差しラベル（跳ねる◀＋一言）。人を指すときは枠を付けない（本編のSpotと同じ流儀）。
   *  x/y はラベルの位置（画面に対する％）。矢印はラベルの左に付き、左の対象を指す */
  spot?: { text: string; x: number; y: number; at?: number };
  /** ワイプ（自撮り小窓）。位置と大きさは**全拍で固定**（部品側の定数）。
   *  シーンごとに動かせる形にすると必ずズレて安っぽくなるので、レシピからは動かせない */
  wipe?: { clip: string; from?: number };
  /** 下帯の字幕（声の全文。at は拍内の秒） */
  subs?: { at: number; dur: number; t: string }[];
  sfx?: { at: number; name: string; volume?: number }[];
  /** 一瞬の白フラッシュで入る（punch の代用） */
  flash?: boolean;
  /**
   * 拍の途中に重ねる決めの一言。**声を切らずに**画だけ被せる。
   * （拍を分けて無音を差し込むと、連続した喋りがぶつ切れてテンポが死ぬ）
   */
  overlays?: { at: number; dur: number; text: string; color?: 'accent' | 'bad' | 'good'; flash?: boolean; still?: boolean; pos?: 'mid' | 'low' | 'sub' | 'top' }[];
};

export type ShortRecipe = {
  id: string;
  title: string;
  /** 0〜1.5秒のフック。画面上部にドン（titleText の拍を使うなら空文字でよい） */
  hook: string;
  beats: ShortBeat[];
  /** 最後に頭へ戻る一言（ループの接続部。無ければ最後の拍で即終わり） */
  loopText?: string;
  /**
   * 締めのアクション。**1本に主アクションは1つだけ**（詰め込むと全部効かない）。
   * 終盤に画面中段へスライドインし、loopText と両立する。
   * fromEnd = 終わりの何秒前から出すか
   */
  cta?: { main?: string; sub?: string; fromEnd?: number; bottomPad?: number };
  /** 画面上部に出しっぱなしの企画タイトル（途中から見た人への前提）。from=出し始め秒。
   *  見た目は冒頭カードのコンパクト版（白地・黒枠・落ち影・marker部分だけ黄マーカー） */
  pinTitle?: { parts: { t: string; marker?: boolean }[]; from?: number;
    /** 尻から何秒ぶん出さないか（締めカードと被らせない） */
    toEnd?: number };
  /** BGM（本編と同じ public/bgm/ の曲を同じ頂点で薄く敷く） */
  bgm?: { file: string; gainDb: number };
};

const db = (v: number) => Math.pow(10, v / 20);

/** 拍の途中の決めの一言（声は流れたまま）。白フラッシュ→ドン */
const Overlay: React.FC<{ text: string; color?: 'accent' | 'bad' | 'good'; flash?: boolean; still?: boolean; pos?: 'mid' | 'low' | 'sub' | 'top'; topPad?: number }> = ({ text, color = 'bad', flash, still, pos = 'mid', topPad = 0 }) => {
  const f = useCurrentFrame();
  // still は前の拍から出続けている体で描く（拍をまたいで表示を続けるとき、入りの演出を繰り返さない）
  const fl = flash && !still ? interpolate(f, [0, 1, 4], [0.85, 0.85, 0], { extrapolateRight: 'clamp' }) : 0;
  const sc = still ? 1 : interpolate(f, [0, 3], [1.25, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill
      style={
        pos === 'low'
          // 低め＝字幕帯のすぐ上。ゲーム画面（その瞬間の主役）を隠さない
          ? { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: SAFE_BOTTOM + 150 }
          : pos === 'sub'
          // 字幕の定位置まで下げる。字幕の無い拍の展開カードはここが既定
          ? { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: SAFE_BOTTOM }
          : pos === 'top'
          // 画面最上部（セーフゾーンの内側）。下で起きていることを全部見せたいとき
          ? { justifyContent: 'flex-start', alignItems: 'center', paddingTop: SAFE_TOP + 30 + topPad }
          : { justifyContent: 'center', alignItems: 'center', paddingBottom: 140 }
      }
    >
      <div
        style={{
          transform: `scale(${sc})`,
          fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 116,
          color: C[color], background: SUB_BG,
          border: `10px solid ${C[color]}`, outline: `6px solid ${SUB_EDGE}`,
          padding: '24px 46px', lineHeight: 1.15, whiteSpace: 'pre-wrap', textAlign: 'center',
        }}
      >
        {text}
      </div>
      {fl > 0 ? <AbsoluteFill style={{ background: `rgba(255,255,255,${fl})` }} /> : null}
    </AbsoluteFill>
  );
};

/** 締めのアクション帯。下の字幕帯の上に、跳ねて入る */
const CtaCard: React.FC<{ main?: string; sub?: string; bottomPad?: number }> = ({ main, sub, bottomPad = 170 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const y = interpolate(f, [0, Math.round(fps * 0.18)], [40, 0], { extrapolateRight: 'clamp' });
  const o = interpolate(f, [0, Math.round(fps * 0.12)], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: SAFE_BOTTOM + bottomPad }}>
      <div style={{ transform: `translateY(${y}px)`, opacity: o, textAlign: 'center' }}>
        {main ? (
        <div
          style={{
            fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 84,
            color: SUB_INK, background: C.accent,
            border: `8px solid ${SUB_EDGE}`,
            boxShadow: '12px 12px 0 rgba(0,0,0,0.85)',
            padding: '18px 44px', lineHeight: 1.2, maxWidth: 980, whiteSpace: 'pre-wrap',
            transform: 'rotate(-1.5deg)',
          }}
        >
          {main}
        </div>
        ) : null}
        {sub ? (
          <div
            style={{
              marginTop: 22, display: 'inline-block',
              fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 46,
              color: C.ink, background: 'rgba(16,24,32,0.94)',
              border: `4px solid ${C.line}`, padding: '10px 28px',
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};

const Beat: React.FC<{ beat: ShortBeat; recipeId: string; index: number; durFrames: number; topPad?: number }> = ({
  beat, recipeId, index, durFrames, topPad = 0,
}) => {
  const f = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const flash = beat.flash ? interpolate(f, [0, 1, 4], [0.9, 0.9, 0], { extrapolateRight: 'clamp' }) : 0;
  // パンチイン: ツッコミと同時に一瞬グッと寄り、0.4秒で戻る。揺れも添える
  let punchZoom = 0;
  let shake = 0;
  for (const pu of beat.punches ?? []) {
    const dt = f / fps - pu.at;
    if (dt >= 0 && dt < 0.45) {
      const decay = 1 - dt / 0.45;
      punchZoom = Math.max(punchZoom, 0.09 * decay);
      shake = Math.max(shake, 7 * decay);
    }
  }
  const shakeX = shake * Math.sin(f * 2.7);
  const shakeY = shake * 0.6 * Math.sin(f * 3.4 + 1);
  // ゲームは縦画面と相性がいい。幅いっぱい＋ゆっくり寄り
  const scale = ((beat.video?.scale ?? 1.0) + punchZoom) * interpolate(f, [0, durFrames], [1.0, 1.04], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <AbsoluteFill
        style={{ backgroundImage: `repeating-linear-gradient(90deg, ${C.bg} 0 34px, ${C.bg2} 34px 36px)` }}
      />
      {beat.video ? (
        <AbsoluteFill style={{ justifyContent: beat.video.small ? 'flex-end' : 'center', alignItems: 'center', transform: `translate(${shakeX}px, ${shakeY}px)` }}>
          <div
            style={{
              position: 'relative',
              width: beat.video.small ? width * 0.56 : width * 0.92,
              height: beat.video.small ? 520 : height - SAFE_TOP - SAFE_BOTTOM - 180,
              marginTop: beat.video.small ? 0 : -40 + (beat.video.y ?? 0),
              marginBottom: beat.video.small ? SAFE_BOTTOM + 60 : 0,
              overflow: 'hidden',
              border: `4px solid ${C.line}`,
              background: C.bg,
            }}
          >
            <OffthreadVideo
              src={staticFile(`footage/${beat.video.clip}.mp4`)}
              startFrom={Math.round((beat.video.from ?? 0) * fps)}
              playbackRate={beat.video.speed ?? 1}
              style={{
                width: '100%', height: '100%', objectFit: beat.video.small ? 'cover' : 'contain',
                transform: `scale(${beat.video.mosaic ? scale * 1.06 : scale})`,
                // モザイク＝強いぼかし。「まだ見せない」の表現
                filter: beat.video.mosaic ? 'blur(16px) saturate(1.15)' : undefined,
              }}
              muted
            />
            {beat.video.label ? (
              <div
                style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 120,
                  color: C.bad, textShadow: '4px 4px 0 rgba(0,0,0,0.85)',
                  letterSpacing: '0.06em',
                }}
              >
                {beat.video.label}
              </div>
            ) : null}
          </div>
        </AbsoluteFill>
      ) : null}

      {beat.wipe ? (
        <div
          style={{
            position: 'absolute', top: WIPE_TOP, left: '50%',
            transform: 'translateX(-50%)',
            width: WIPE_SIZE, height: WIPE_SIZE,   // ワイプ素材（w-*）は正方形
            overflow: 'hidden',
            // 本編の Shot と同じ窓の作り。縁は border でなく影の輪
            //（border だと映像が食われて顔が小さくなる）
            borderRadius: 22,
            boxShadow: [
              '0 0 0 5px rgba(233,241,228,0.96)',   // 白い輪
              '0 0 0 8px rgba(16,24,32,0.92)',      // その外に細い黒
              '0 14px 30px rgba(0,0,0,0.5)',        // 落ち影
            ].join(', '),
            background: C.bg,
          }}
        >
          <OffthreadVideo
            src={staticFile(`footage/${beat.wipe.clip}.mp4`)}
            startFrom={Math.round((beat.wipe.from ?? 0) * fps)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            muted
          />
          <div
            style={{
              position: 'absolute', inset: 0, borderRadius: 22,
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28), inset 0 -14px 22px rgba(0,0,0,0.28)',
              pointerEvents: 'none',
            }}
          />
        </div>
      ) : null}

      {beat.spot ? (() => {
        const st = secToFrames(beat.spot.at ?? 0.15, fps);
        const k = Math.max(0, f - st);
        const o = f < st ? 0 : interpolate(k, [0, 4], [0, 1], { extrapolateRight: 'clamp' });
        // 矢印は0.5秒周期で対象へ跳ね続ける（本編のSpotと同じ動き）
        const hop = Math.abs(Math.sin((k / fps) * Math.PI * 2)) * 16;
        return (
          <div
            style={{
              position: 'absolute', left: `${beat.spot.x}%`, top: `${beat.spot.y}%`,
              display: 'flex', alignItems: 'center', gap: 14, opacity: o,
              transform: `translateX(${-hop}px)`,
            }}
          >
            <span style={{ fontSize: 88, color: C.accent, textShadow: '4px 4px 0 rgba(0,0,0,0.85)', lineHeight: 1, fontWeight: 900 }}>◀</span>
            <span
              style={{
                fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 46,
                color: C.accent, background: 'rgba(16,24,32,0.92)',
                border: `4px solid ${C.accent}`, padding: '10px 24px',
                textShadow: '3px 3px 0 rgba(0,0,0,0.85)', whiteSpace: 'nowrap',
              }}
            >
              {beat.spot.text}
            </span>
          </div>
        );
      })() : null}

      {beat.titleLines ? (
        <AbsoluteFill style={{ alignItems: 'center', paddingTop: SAFE_TOP + 70 }}>
          <div
            style={{
              background: 'rgba(244,246,241,0.97)',
              border: `10px solid ${SUB_EDGE}`,
              boxShadow: `14px 14px 0 rgba(0,0,0,0.85), 0 0 0 6px ${C.accent}`,
              padding: '34px 40px 30px',
              textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
              maxWidth: width - 70,
            }}
          >
            {beat.titleLines.map((ln, i) => {
              // 行ごとに時間差で「ドン」と入る。全部同時に置くと読み順が生まれない
              const st = secToFrames((beat.titleStagger ?? 0) * i, fps);
              const k = Math.max(0, f - st);
              const o = beat.titleStagger ? interpolate(k, [0, 3], [0, 1], { extrapolateRight: 'clamp' }) : 1;
              const sc2 = beat.titleStagger ? interpolate(k, [0, 4], [1.22, 1], { extrapolateRight: 'clamp' }) : 1;
              return (
              <div
                key={i}
                style={{
                  fontFamily: 'NotoSansJPLocal', fontWeight: 900,
                  fontSize: ln.size ?? 72,
                  lineHeight: 1.12,
                  whiteSpace: 'nowrap',
                  color: SUB_INK,
                  background: ln.marker ? C.accent : 'transparent',
                  padding: ln.marker ? '4px 26px 8px' : 0,
                  opacity: o,
                  transform: `${ln.marker ? 'rotate(-1.2deg) ' : ''}scale(${sc2})`,
                }}
              >
                {ln.t}
              </div>
              );
            })}
          </div>
        </AbsoluteFill>
      ) : null}

      {beat.titleText ? (
        <AbsoluteFill style={{ alignItems: 'center', paddingTop: SAFE_TOP + 90 }}>
          <div
            style={{
              fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 92,
              color: SUB_INK, background: 'rgba(244,246,241,0.97)',
              border: `10px solid ${C.accent}`, outline: `6px solid ${SUB_EDGE}`,
              boxShadow: '12px 12px 0 rgba(0,0,0,0.85)',
              padding: '30px 44px', textAlign: 'center', lineHeight: 1.3,
              maxWidth: width - 90, whiteSpace: 'pre-wrap',
            }}
          >
            {beat.titleText}
          </div>
        </AbsoluteFill>
      ) : null}

      {beat.diagram ? (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 30px', marginTop: -60 }}>
          <div style={{ width: '100%', height: 700 }}>
            <Diagram kind={beat.diagram} durFrames={durFrames} fontFamily="NotoSansJPLocal" />
          </div>
        </AbsoluteFill>
      ) : null}

      {beat.bigText ? (() => {
        // タイプライター: 文字ごとの出現時刻（読点・三点リーダは後に0.18秒のタメ）
        const chars = [...beat.bigText];
        const times: number[] = [];
        let tt = 0.18;
        for (const ch of chars) {
          times.push(tt);
          if (ch !== '\n') tt += 0.085;
          if (ch === '、' || ch === '…' || ch === '。') tt += 0.18;
        }
        const now = f / fps;
        const shown = beat.bigTyped ? chars.filter((_, i) => times[i] <= now).length : chars.length;
        return (
        <AbsoluteFill
          style={
            beat.bigPos === 'top'
              ? { justifyContent: 'flex-start', alignItems: 'center', paddingTop: SAFE_TOP + 30 + topPad }
              : { justifyContent: 'center', alignItems: 'center', paddingBottom: 120 }
          }
        >
          <div
            style={{
              position: 'relative',
              fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: beat.bigSize ?? 120,
              color: beat.bigColor && beat.bigColor !== 'ink' ? C[beat.bigColor] : SUB_INK,
              background: SUB_BG, border: `10px solid ${beat.bigColor ? C[beat.bigColor] : SUB_EDGE}`,
              outline: `6px solid ${SUB_EDGE}`,
              padding: '26px 48px', textAlign: beat.bigTyped ? 'left' : 'center', lineHeight: 1.15,
              maxWidth: width - 120, whiteSpace: 'pre-wrap',
            }}
          >
            {/* 枠の大きさは全文で確保し、見える文字だけ上に重ねる（出るたびに箱が動かない） */}
            <span style={{ opacity: 0 }}>{beat.bigText}</span>
            <span style={{ position: 'absolute', inset: '26px 48px', whiteSpace: 'pre-wrap' }}>
              {chars.slice(0, shown).join('')}
            </span>
          </div>
          {beat.bigTyped
            ? chars.map((ch, i) =>
                ch !== '\n' && i % 2 === 0 ? (
                  <Sequence key={`bt${i}`} from={secToFrames(times[i], fps)} durationInFrames={Math.round(fps * 0.5)} layout="none">
                    <Audio src={staticFile('sfx/type.wav')} volume={db(-6) * 0.5} />
                  </Sequence>
                ) : null,
              )
            : null}
        </AbsoluteFill>
        );
      })() : null}

      {beat.voice ? (
        <Sequence from={secToFrames(beat.voiceDelay ?? 0, fps)} layout="none">
          <Audio src={staticFile(`shorts-voice/${recipeId}/beat-${index}.wav`)} />
        </Sequence>
      ) : null}
      {(beat.sfx ?? []).map((s, i) => (
        <Sequence key={i} from={secToFrames(s.at, fps)} durationInFrames={Math.round(2 * fps)} layout="none">
          <Audio src={staticFile(`sfx/${s.name}.wav`)} volume={db(-6) * (s.volume ?? 1)} />
        </Sequence>
      ))}

      {(beat.overlays ?? []).map((ov, i) => (
        <Sequence key={`o${i}`} from={secToFrames(ov.at, fps)} durationInFrames={secToFrames(ov.dur, fps)} layout="none">
          <Overlay text={ov.text} color={ov.color} flash={ov.flash} still={ov.still} pos={ov.pos} topPad={topPad} />
        </Sequence>
      ))}

      {(beat.subs ?? []).map((sub, i) => (
        <Sequence key={`s${i}`} from={secToFrames(sub.at, fps)} durationInFrames={secToFrames(sub.dur, fps)} layout="none">
          <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: SAFE_BOTTOM }}>
            <div
              style={{
                width: '100%', textAlign: 'center',
                background: SUB_BG,
                borderTop: `6px solid ${SUB_EDGE}`, borderBottom: `6px solid ${SUB_EDGE}`,
                padding: '18px 40px',
                fontFamily: 'NotoSansJPLocal', fontWeight: 900,
                fontSize: Math.min(66, Math.floor((width - 90) / Math.max(1, sub.t.length))),
                color: SUB_INK, lineHeight: 1.2, whiteSpace: 'nowrap',
              }}
            >
              {sub.t}
            </div>
          </AbsoluteFill>
        </Sequence>
      ))}

      {flash > 0 ? <AbsoluteFill style={{ background: `rgba(255,255,255,${flash})` }} /> : null}
    </AbsoluteFill>
  );
};

export const Short: React.FC<{ recipe: ShortRecipe }> = ({ recipe }) => {
  useLocalFont();   // 本編と同じ書体（Noto Sans JP）。呼ばないと明朝で描かれる
  const { fps } = useVideoConfig();
  const f = useCurrentFrame();
  let cursor = 0;
  const total = recipe.beats.reduce((a, b) => a + secToFrames(b.dur, fps), 0);

  return (
    <AbsoluteFill style={{ background: C.bg }}>
      {recipe.beats.map((b, i) => {
        const from = cursor;
        const dur = secToFrames(b.dur, fps);
        cursor += dur;
        return (
          <Sequence key={i} from={from} durationInFrames={dur} name={`beat ${i}`}>
            <Beat beat={b} recipeId={recipe.id} index={i} durFrames={dur} topPad={recipe.pinTitle ? 104 : 0} />
          </Sequence>
        );
      })}

      {/* 常時タイトル。途中から見た人にも前提が張られ続ける（まるごと圧縮型で特に効く） */}
      {recipe.pinTitle ? (
        <Sequence
          from={secToFrames(recipe.pinTitle.from ?? 0, fps)}
          durationInFrames={total - secToFrames(recipe.pinTitle.from ?? 0, fps) - secToFrames(recipe.pinTitle.toEnd ?? 0, fps)}
          layout="none"
        >
          <AbsoluteFill style={{ alignItems: 'center', paddingTop: SAFE_TOP + 10 }}>
            <div
              style={{
                display: 'flex', alignItems: 'center',
                fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 54,
                color: SUB_INK, background: 'rgba(244,246,241,0.97)',
                border: `6px solid ${SUB_EDGE}`,
                boxShadow: `8px 8px 0 rgba(0,0,0,0.85), 0 0 0 4px ${C.accent}`,
                padding: '10px 26px', whiteSpace: 'nowrap', lineHeight: 1.15,
              }}
            >
              {recipe.pinTitle.parts.map((pt, i) => (
                <span
                  key={i}
                  style={
                    pt.marker
                      ? { background: C.accent, padding: '2px 12px 4px', transform: 'rotate(-1.2deg)', display: 'inline-block' }
                      : undefined
                  }
                >
                  {pt.t}
                </span>
              ))}
            </div>
          </AbsoluteFill>
        </Sequence>
      ) : null}

      {/* フック。0秒から出しっぱなし → 1.6秒で消える。上部のセーフゾーン内 */}
      {recipe.hook ? (
      <Sequence durationInFrames={secToFrames(1.8, fps)} layout="none">
        <AbsoluteFill style={{ alignItems: 'center', paddingTop: SAFE_TOP + 40 }}>
          <div
            style={{
              opacity: interpolate(f, [0, 3, secToFrames(1.5, fps), secToFrames(1.8, fps)], [0, 1, 1, 0], { extrapolateRight: 'clamp' }),
              fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 76,
              color: SUB_INK, background: 'rgba(244,246,241,0.97)',
              border: `8px solid ${C.accent}`, outline: `5px solid ${SUB_EDGE}`,
              padding: '20px 36px', textAlign: 'center', lineHeight: 1.25,
              maxWidth: 960, whiteSpace: 'pre-wrap', textShadow: 'none',
            }}
          >
            {recipe.hook}
          </div>
        </AbsoluteFill>
      </Sequence>
      ) : null}

      {/* 締めのアクション（主1つ＋添え）。最後の拍に重ねて出す */}
      {recipe.bgm ? (
        <Audio
          src={staticFile(recipe.bgm.file)}
          volume={(f) => {
            const t = f / fps;
            // ショートは頭から声が乗るので入りは速く、尻は1.2秒で消える
            const inGain = Math.min(1, t / 0.6);
            const left = total / fps - t;
            const outGain = Math.min(1, Math.max(0, left / 1.2));
            return Math.pow(10, recipe.bgm!.gainDb / 20) * inGain * outGain;
          }}
        />
      ) : null}

      {recipe.cta ? (
        <Sequence
          from={total - secToFrames(recipe.cta.fromEnd ?? 4.5, fps)}
          durationInFrames={secToFrames((recipe.cta.fromEnd ?? 4.5) - (recipe.loopText ? 1.0 : 0.12), fps)}
          layout="none"
        >
          <CtaCard main={recipe.cta.main} sub={recipe.cta.sub} bottomPad={recipe.cta.bottomPad} />
        </Sequence>
      ) : null}

      {/* ループの接続部。最後の0.9秒で「頭に戻る一言」を出して、そのまま先頭へつながる */}
      {recipe.loopText ? (
        <Sequence from={total - secToFrames(0.9, fps)} durationInFrames={secToFrames(0.9, fps)} layout="none">
          <AbsoluteFill style={{ alignItems: 'center', paddingTop: SAFE_TOP + 40 }}>
            <div
              style={{
                fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 72,
                color: SUB_INK, background: 'rgba(244,246,241,0.97)',
                border: `8px solid ${C.accent}`, outline: `5px solid ${SUB_EDGE}`,
                padding: '18px 34px', textAlign: 'center', lineHeight: 1.25, maxWidth: 960,
              }}
            >
              {recipe.loopText}
            </div>
          </AbsoluteFill>
        </Sequence>
      ) : null}
    </AbsoluteFill>
  );
};

export const shortTotalFrames = (recipe: ShortRecipe, fps: number) =>
  recipe.beats.reduce((a, b) => a + secToFrames(b.dur, fps), 0);
