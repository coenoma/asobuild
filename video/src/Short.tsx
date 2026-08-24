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
// ビフォーアフター（video.vs）の定位置。固定値にして、拍が変わってもズレない・
// 下1/3（暗幕とタイトルの場所）に絶対に食い込ませない。
// ここは1本の中でいちばんの見せ場なので、**横幅を使い切る大きさ**にする
// （幅で決まる: (1080 - 余白40 - GAP36) / 2 ≒ 500。高さは 500/0.75 ≒ 667）。
// 検算: VS_TOP 440 ＋ ラベル60 ＋ 隙間12 ＋ 667 ＝ 1179 < 1280（下1/3の境界）
const VS_TOP = 440;
const VS_PANEL_W = 500;
const VS_PANEL_H = Math.round(VS_PANEL_W / 0.75); // ケータイ画面 240×320 と同じ縦横比
const VS_GAP = 36;

export type ShortBeat = {
  /** 拍の長さ（秒） */
  dur: number;
  /** ゲーム映像（public/footage/<clip>.mp4）。from=クリップ内の開始秒 */
  video?: { clip: string; from?: number; scale?: number; y?: number; mosaic?: boolean; small?: boolean; label?: string;
    /** 早送り（2=2倍速）。丸投げ・思考待ち・修正連打を「過程は見せるが待たせない」ために使う */
    speed?: number;
    /**
     * ビフォーアフターの並置。指定すると `video` と `vs` の2つを左右に同時再生する
     * （静止画ではない）専用レイアウトに切り替わる。`mosaic`/`small` とは併用しない。
     * このとき `label` は両画面の上に出す小さいキャプション（既存のテロップ様式＝
     * 白地・黒枠・黒文字の小チップ）になる。`vs` が無いときは `label` は従来どおり
     * 盤面中央のでか文字（？？？の演出）のまま——**既存4本はここを通らないので無影響**
     */
    vs?: { clip: string; from?: number; label?: string };
  };
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
   *  右端から16pxに右揃えで置く（顔に被らせない）。y は上端の位置（％） */
  spot?: { text: string; y: number; at?: number };
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
  overlays?: { at: number; dur: number; text: string; color?: 'accent' | 'bad' | 'good' | 'cool'; flash?: boolean; still?: boolean; pos?: 'mid' | 'low' | 'sub' | 'top' }[];
  /**
   * まとめカード。情報が詰まった1枚を出す（一時停止を誘発するための拍）。
   * `CtaCard` と様式を揃える（marker地のタイトル・地の文の箇条書き・チップのnote）。
   * 🔴 わざと短くして読めなくしない。読み切れる大きさ・長さで出す（shorts.mdの思想）
   */
  summaryCard?: { title: string; lines: string[]; note?: string };
  /**
   * この拍が、上部のステップ表示のどこに当たるか（1始まり）。
   * `recipe.steps` があるときだけ効く。書かないとどのステップも光らない
   */
  step?: number;
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
  /**
   * 上部に常時出す進行のステップ（例 ["たのむ","出てこない","直す","ハマる"]）。
   * 現在地は各拍の `step`（1始まり）で決まる。**最後のステップが最初から見えている**ので、
   * オチの予告（pinTitle）を兼ねる。両方は出さない——上が混むと画の主役が消える
   */
  steps?: string[];
  /**
   * ステップの上に重ねる**約束の一行**（この動画がどこへ行くのか）。
   * ステップが「現在地」なのに対し、こちらは「行き先」。役割が違うので2段にしてよい。
   * `steps` があるときだけ効く
   */
  topTitle?: { t: string; marker?: boolean }[];
  pinTitle?: { parts: { t: string; marker?: boolean }[]; from?: number;
    /** 尻から何秒ぶん出さないか（締めカードと被らせない） */
    toEnd?: number;
    /**
     * 文字の大きさ（既定 54）。オチの予告として出すときは大きくする。
     * 大きくすると parts の切れ目で折り返すので、**意味の切れ目で parts を割ること**
     */
    size?: number;
    /** 下の拍を押し下げる量（既定 104）。size を上げて2行になったら一緒に上げる */
    pad?: number };
  /** BGM（本編と同じ public/bgm/ の曲を同じ頂点で薄く敷く） */
  bgm?: { file: string; gainDb: number };
  /**
   * 下1/3の暗幕。YouTubeの一覧でショートに自動で重なる白いタイトル文字を読ませるため、
   * 全編にわたって画面下1/3に下へ向かって濃くなるグラデーションを敷く。
   * true = 既定の濃さ、数値（0〜1）= 濃さを指定。重なり順は「映像より上・字幕やカードより下」
   * （字幕・カードは自前で不透明な地を持つので、暗幕はその下でも隠れない）
   */
  bottomScrim?: boolean | number;
};

const db = (v: number) => Math.pow(10, v / 20);

/** 拍の途中の決めの一言（声は流れたまま）。白フラッシュ→ドン */
const Overlay: React.FC<{ text: string; color?: 'accent' | 'bad' | 'good' | 'cool'; flash?: boolean; still?: boolean; pos?: 'mid' | 'low' | 'sub' | 'top'; topPad?: number }> = ({ text, color = 'bad', flash, still, pos = 'mid', topPad = 0 }) => {
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

const Beat: React.FC<{ beat: ShortBeat; recipeId: string; index: number; durFrames: number; topPad?: number; bottomScrim?: boolean | number; steps?: string[]; topTitle?: { t: string; marker?: boolean }[] }> = ({
  beat, recipeId, index, durFrames, topPad = 0, bottomScrim, steps, topTitle,
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
      {beat.video && !beat.video.vs ? (
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

      {/*
       * ビフォーアフター（video.vs）。2画面を左右に同時再生する専用レイアウト。
       * 位置は固定定数（VS_TOP等）にして拍が変わってもズレない。下1/3には絶対に届かせない
       * （VS_TOP + 列の高さ が 1280（画面下1/3の境界）を必ず下回るように定数を選んである）。
       */}
      {beat.video?.vs ? (
        <AbsoluteFill style={{ justifyContent: 'flex-start', alignItems: 'center', paddingTop: VS_TOP, transform: `translate(${shakeX}px, ${shakeY}px)` }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: VS_GAP, alignItems: 'flex-start' }}>
            {[
              { clip: beat.video.clip, from: beat.video.from, label: beat.video.label },
              { clip: beat.video.vs.clip, from: beat.video.vs.from, label: beat.video.vs.label },
            ].map((v, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                {v.label ? (
                  <div
                    style={{
                      fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 46,
                      color: SUB_INK, background: SUB_BG, border: `4px solid ${SUB_EDGE}`,
                      padding: '8px 24px', whiteSpace: 'nowrap', lineHeight: 1.1,
                    }}
                  >
                    {v.label}
                  </div>
                ) : null}
                <div
                  style={{
                    position: 'relative', width: VS_PANEL_W, height: VS_PANEL_H,
                    overflow: 'hidden', border: `4px solid ${C.line}`, background: C.bg,
                  }}
                >
                  <OffthreadVideo
                    src={staticFile(`footage/${v.clip}.mp4`)}
                    startFrom={Math.round((v.from ?? 0) * fps)}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    muted
                  />
                </div>
              </div>
            ))}
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
              position: 'absolute', right: 16, top: `${beat.spot.y}%`,
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
                textShadow: '3px 3px 0 rgba(0,0,0,0.85)',
                whiteSpace: 'pre-line', textAlign: 'center', lineHeight: 1.3,
              }}
            >
              {beat.spot.text}
            </span>
          </div>
        );
      })() : null}

      {/*
       * 下1/3の暗幕。YouTubeが一覧で自動重ねる白いタイトルを読ませるため、
       * 映像の上・字幕やカードの下（＝ここ、titleLines/subs/overlays/summaryCardより前）に置く。
       * 字幕・カードは自前の不透明な地を持つので、暗幕の上に乗っても隠れない
       */}
      {bottomScrim ? (
        <AbsoluteFill
          style={{
            pointerEvents: 'none',
            background: `linear-gradient(to bottom, transparent 0%, transparent 64%, rgba(6,10,14,${(typeof bottomScrim === 'number' ? bottomScrim : 0.62) * 0.55}) 82%, rgba(6,10,14,${typeof bottomScrim === 'number' ? bottomScrim : 0.62}) 100%)`,
          }}
        />
      ) : null}

      {beat.titleLines ? (
        <AbsoluteFill style={{ alignItems: 'center', paddingTop: SAFE_TOP + 70 + topPad }}>
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

      {/*
       * まとめカード。CtaCard と様式を揃える（marker地の見出し・地の文の箇条書き・チップのnote）。
       * 一時停止したくなる情報量を1枚に出す拍。titleLines と同じ上寄せ配置＝
       * この拍の video（small想定）と縦に競合しない
       */}
      {beat.summaryCard ? (
        <AbsoluteFill style={{ alignItems: 'center', paddingTop: SAFE_TOP + 70 + topPad }}>
          <div
            style={{
              background: 'rgba(244,246,241,0.97)',
              border: `10px solid ${SUB_EDGE}`,
              boxShadow: `14px 14px 0 rgba(0,0,0,0.85), 0 0 0 6px ${C.accent}`,
              padding: '34px 44px 30px',
              textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
              maxWidth: width - 90,
            }}
          >
            <div
              style={{
                fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 68,
                color: SUB_INK, background: C.accent,
                padding: '6px 28px', lineHeight: 1.15, transform: 'rotate(-1.2deg)',
              }}
            >
              {beat.summaryCard.title}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {beat.summaryCard.lines.map((l, i) => (
                <div
                  key={i}
                  style={{
                    fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 46,
                    color: SUB_INK, lineHeight: 1.3, whiteSpace: 'pre-wrap',
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
            {beat.summaryCard.note ? (
              <div
                style={{
                  fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 34,
                  color: C.ink, background: 'rgba(16,24,32,0.94)',
                  border: `4px solid ${C.line}`, padding: '8px 24px',
                }}
              >
                {beat.summaryCard.note}
              </div>
            ) : null}
          </div>
        </AbsoluteFill>
      ) : null}

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

      {/*
       * 進行のステップ（上部に常時）。いま物語のどこにいるのかを出しっぱなしにする。
       * チュートリアルの「①②③＋現在地」と同じ役割で、**途中から見た人にも
       * 前提と、まだ終わっていないことが同時に伝わる**。
       * 最後のステップ（例「ハマる」）が最初から見えているので、オチの予告も兼ねる。
       * 🔴 文字は上に置く。下1/3（暗幕＝YouTubeがタイトルを載せる場所）には絶対に入れない。
       */}
      {steps && steps.length ? (
        <AbsoluteFill style={{ alignItems: 'stretch', justifyContent: 'flex-start' }}>
          {/*
           * 上部は**帯として切り離す**。ゲーム画面の上に文字を浮かせるだけだと、
           * 盤面の一部に見えて読み飛ばされる（本編のテロップで同じ失敗をしている
           * ＝「盤面と同じ色・同じ大きさ帯だと、ゲームの一部に見えて読まれない」）。
           * 全幅の不透明な地 ＋ 下辺の太い罫 ＋ 硬い影で、番組の枠と盤面をはっきり分ける。
           * 角丸・ぼかし・グラデーションは使わない（当時の画面に無いので）
           */}
          <div
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              background: 'rgba(11,18,25,0.97)',
              borderBottom: `9px solid ${C.accent}`,
              boxShadow: '0 12px 0 rgba(0,0,0,0.75)',
              paddingTop: SAFE_TOP + 10, paddingBottom: 18,
            }}
          >
          {/* 上段＝約束（この動画がどこへ行くのか）。下段＝現在地。役割が違うので2段にする */}
          {topTitle && topTitle.length ? (
            <div
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
                columnGap: 8, rowGap: 4, marginBottom: 12, maxWidth: width - 30,
                fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 68,
                color: SUB_INK, background: 'rgba(244,246,241,0.97)',
                border: `7px solid ${SUB_EDGE}`,
                boxShadow: `11px 11px 0 rgba(0,0,0,0.85), 0 0 0 6px ${C.accent}`,
                padding: '10px 26px', lineHeight: 1.15, textAlign: 'center',
              }}
            >
              {topTitle.map((pt, i) => (
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
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: width - 40 }}>
            {steps.map((s, i) => {
              const now = (beat.step ?? 0) === i + 1;
              const done = (beat.step ?? 0) > i + 1;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {i > 0 ? (
                    <span
                      style={{
                        fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: 36,
                        color: done || now ? C.accent : C.line,
                      }}
                    >
                      ›
                    </span>
                  ) : null}
                  <span
                    style={{
                      fontFamily: 'NotoSansJPLocal', fontWeight: 900,
                      fontSize: now ? 52 : 38, lineHeight: 1.1, whiteSpace: 'nowrap',
                      color: now || done ? SUB_INK : C.dim,
                      background: now ? C.accent : done ? 'rgba(244,246,241,0.90)' : 'rgba(16,24,32,0.86)',
                      border: `5px solid ${now || done ? SUB_EDGE : C.line}`,
                      boxShadow: now ? '8px 8px 0 rgba(0,0,0,0.85)' : undefined,
                      padding: now ? '10px 26px' : '7px 17px',
                    }}
                  >
                    {s}
                  </span>
                </div>
              );
            })}
          </div>
          </div>
        </AbsoluteFill>
      ) : null}

      {flash > 0 ? <AbsoluteFill style={{ background: `rgba(255,255,255,${flash})` }} /> : null}
    </AbsoluteFill>
  );
};

export const Short: React.FC<{ recipe: ShortRecipe }> = ({ recipe }) => {
  useLocalFont();   // 本編と同じ書体（Noto Sans JP）。呼ばないと明朝で描かれる
  const { fps, width } = useVideoConfig();
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
            <Beat beat={b} recipeId={recipe.id} index={i} durFrames={dur} topPad={recipe.steps ? (recipe.topTitle ? 248 : 130) : recipe.pinTitle ? (recipe.pinTitle.pad ?? 104) : 0} bottomScrim={recipe.bottomScrim} steps={recipe.steps} topTitle={recipe.topTitle} />
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
                /*
                 * 既定の 54px は1行に収まる短い企画名を想定した大きさ。
                 * `size` を上げるときは折り返す前提になるので、flexWrap で
                 * parts の切れ目（＝意味の切れ目）で折る。自動折り返しに任せない。
                 */
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
                columnGap: 10, rowGap: 6,
                fontFamily: 'NotoSansJPLocal', fontWeight: 900, fontSize: recipe.pinTitle.size ?? 54,
                color: SUB_INK, background: 'rgba(244,246,241,0.97)',
                border: `6px solid ${SUB_EDGE}`,
                boxShadow: `8px 8px 0 rgba(0,0,0,0.85), 0 0 0 4px ${C.accent}`,
                padding: '10px 26px', lineHeight: 1.15, textAlign: 'center',
                maxWidth: width - 60,
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
