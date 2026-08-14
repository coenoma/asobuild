import React, { useEffect, useState } from 'react';
import { AbsoluteFill, Audio, Sequence, cancelRender, continueRender, delayRender, staticFile, useVideoConfig } from 'remotion';
import { C } from './brand';
import type { Chapter, Edl, Layer } from './types';
import { Shot, Black } from './components/Shot';
import { Telop } from './components/Telop';
import { BigNumber, ChapterCard, EndCard, TitleCard } from './components/Cards';
import { Gate } from './components/Gate';
import { Checklist } from './components/Checklist';
import { Diagram } from './components/Diagram';
import { Loading } from './components/Loading';
import { TimeStamp } from './components/TimeStamp';
import { Spot } from './components/Spot';
import { Scrim } from './components/Scrim';
import { ProgramBar } from './components/ProgramBar';
import { secToFrames } from './components/common';

/**
 * サイト（globals.css の --font-dot）と同じ書体を使う。動画とサイトで見た目を揃える。
 * 実体は node scripts/fonts.mjs が public/fonts/ に置く（リポジトリには入れない）。
 */
const fontFamily = 'NotoSansJPLocal';

/**
 * 書体の読み込みは**必ずコンポーネントの中でやる**。
 * モジュールの一番外で delayRender を呼ぶと、コンポジションを数えるだけの工程でも
 * 待ちが発生して描画そのものが止まる（実際に止まった）。
 */
function useLocalFont(): void {
  const [handle] = useState(() => delayRender('書体の読み込み'));
  useEffect(() => {
    const face = new FontFace(fontFamily, `url(${staticFile('fonts/NotoSansJP.ttf')})`);
    face
      .load()
      .then(() => {
        document.fonts.add(face);
        continueRender(handle);
      })
      .catch((e) => {
        // 書体が無いまま描くと別物になるので、黙って進めない
        cancelRender(new Error(`書体を読めませんでした。先に node scripts/fonts.mjs を実行してください: ${String(e)}`));
      });
  }, [handle]);
}

/**
 * 開発の時計は**画面収録の時刻 + devOffset**（EDL の meta で持つ。001は48秒）。
 * 実測で、AIの「◯m◯s thinking」表示とこの値が一致する（依頼は収録開始の48秒前）。
 * 手で章ごとに書かない。**映っている素材から引く**（ProgramBar の marks）。
 */
const SELF_TO_SCREEN = 423; // 自撮りの時刻 - これ = 画面収録の時刻

/** 制約が尽きる開発時刻（秒）。ソイラテを飲み干したのは 画面22:50 */
const DRAIN_AT = 22 * 60 + 50 + 48;

const LayerView: React.FC<{ layer: Layer; durFrames: number }> = ({ layer, durFrames }) => {
  switch (layer.type) {
    case 'shot':
      return (
        <Shot
          clip={layer.clip}
          box={layer.box}
          fit={layer.fit}
          zoom={layer.zoom}
          origin={layer.origin}
          frame={layer.frame}
          wipe={layer.wipe}
          durFrames={durFrames}
        />
      );
    case 'telop':
      return (
        <Telop
          text={layer.text}
          style={layer.style}
          place={layer.place}
          color={layer.color}
          durFrames={durFrames}
          fontFamily={fontFamily}
        />
      );
    case 'timeStamp':
      return (
        <TimeStamp
          value={layer.value}
          note={layer.note}
          sub={layer.sub}
          color={layer.color}
          variant={layer.variant}
          durFrames={durFrames}
          fontFamily={fontFamily}
        />
      );
    case 'spot':
      return (
        <Spot
          box={layer.box}
          label={layer.label}
          from={layer.from}
          color={layer.color}
          durFrames={durFrames}
          fontFamily={fontFamily}
        />
      );
    case 'scrim':
      return <Scrim amount={layer.amount ?? 0.72} />;
    case 'number':
      return (
        <BigNumber
          value={layer.value}
          unit={layer.unit}
          label={layer.label}
          color={layer.color}
          place={layer.place}
          durFrames={durFrames}
          fontFamily={fontFamily}
        />
      );
    case 'chapterCard':
      return <ChapterCard no={layer.no} title={layer.title} durFrames={durFrames} fontFamily={fontFamily} />;
    case 'checklist':
      return <Checklist title={layer.title} items={layer.items} durFrames={durFrames} fontFamily={fontFamily} />;
    case 'gate':
      return <Gate pass={layer.pass} failed={layer.failed} total={layer.total} durFrames={durFrames} fontFamily={fontFamily} />;
    case 'diagram':
      return <Diagram kind={layer.kind} durFrames={durFrames} fontFamily={fontFamily} />;
    case 'loading':
      return <Loading text={layer.text} note={layer.note} durFrames={durFrames} fontFamily={fontFamily} />;
    case 'black':
      return <Black />;
    case 'titleCard':
      return <TitleCard title={layer.title} sub={layer.sub} durFrames={durFrames} fontFamily={fontFamily} />;
    case 'endCard':
      return <EndCard url={layer.url} lines={layer.lines} durFrames={durFrames} fontFamily={fontFamily} />;
    case 'sfx':
      return <Audio src={staticFile(`sfx/${layer.name}.wav`)} volume={layer.volume ?? 1} />;
    default:
      return null;
  }
};

/**
 * 上端のバーに出す「開発の経過」の目盛りを、章の素材から組み立てる。
 * 手で書いた章ごとの devFrom/devTo は使わない（画面と食い違う原因になっていた）。
 */
function devMarks(chapter: Chapter, edl: Edl): { at: number; dur: number; dev: number }[] {
  const off = edl.meta.devOffset ?? 0;
  return chapter.layers
    .filter((l): l is Extract<Layer, { type: 'shot' }> => l.type === 'shot' && !l.wipe)
    .map((l) => {
      const clip = edl.clips[l.clip];
      if (!clip) return null;
      // 自撮りの時刻は画面収録の時刻に直してから使う
      const screenIn = clip.src === 'self' ? clip.in - SELF_TO_SCREEN : clip.in;
      return { at: l.at, dur: l.dur, dev: screenIn + off };
    })
    .filter((m): m is { at: number; dur: number; dev: number } => m !== null)
    .sort((a, b) => a.at - b.at);
}

const ChapterView: React.FC<{ chapter: Chapter; constraint: string; edl: Edl }> = ({ chapter, constraint, edl }) => {
  const marks = devMarks(chapter, edl);
  const { fps } = useVideoConfig();
  const chFrames = secToFrames(chapter.dur, fps);

  return (
    <AbsoluteFill
      style={{
        background: C.bg,
        // 素材を枠に収めると余白が出る。真っ黒だと「抜けている」ように見えるので、
        // ゲームの盤面と同じ縦じまを薄く敷く（ぼかしやグラデーションは使わない）
        backgroundImage: `repeating-linear-gradient(90deg, ${C.bg} 0 46px, ${C.bg2} 46px 48px)`,
      }}
    >
      {chapter.layers.map((layer, i) => {
        const from = secToFrames(layer.at, fps);
        // 効果音は1回鳴らすだけなので長さを持たない
        const dur = layer.type === 'sfx' ? Math.min(3 * fps, chFrames - from) : secToFrames(layer.dur, fps);
        if (dur <= 0) return null;
        return (
          <Sequence key={i} from={from} durationInFrames={dur} layout="none" name={layer.type}>
            <LayerView layer={layer} durFrames={dur} />
          </Sequence>
        );
      })}

      {chapter.noBar ? null : (
        <ProgramBar
          constraint={constraint}
          chapterLabel={chapter.label}
          marks={marks}
          devFrom={chapter.devFrom ?? 0}
          devTo={chapter.devTo ?? chapter.devFrom ?? 0}
          drainAt={DRAIN_AT}
          durFrames={chFrames}
          fontFamily={fontFamily}
        />
      )}
    </AbsoluteFill>
  );
};

export const Episode: React.FC<{ edl: Edl }> = ({ edl }) => {
  useLocalFont();
  const { fps } = useVideoConfig();
  let cursor = 0;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {edl.chapters.map((ch) => {
        const from = cursor;
        const dur = secToFrames(ch.dur, fps);
        cursor += dur;
        return (
          <Sequence key={ch.id} from={from} durationInFrames={dur} name={ch.id} layout="none">
            <ChapterView chapter={ch} constraint={edl.meta.constraint} edl={edl} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const totalFrames = (edl: Edl, fps: number) =>
  edl.chapters.reduce((a, c) => a + secToFrames(c.dur, fps), 0);
