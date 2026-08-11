'use client';

/**
 * 共通シェル。1ゲーム作るのに毎回書かなくていいものは全部ここに入っている。
 *
 *   タイトル → プレイ → リザルト → もう一回（1タップ）
 *   スコア表示・自己ベスト・惜しい演出・死因表示・共有・ミュート
 *   固定タイムステップのループ・入力の一元化・ピクセル拡大表示
 *
 * ゲーム側が書くのは init / step / draw / bot だけ。
 * ここを厚くしておくほど、1本あたりの制作時間が短くなる。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Painter } from './painter';
import { InputSource } from './input';
import { advance } from './runner';
import { createRng, randomSeed } from './rng';
import { sfx } from './sfx';
import { getBest, incPlays, setBest } from './storage';
import { shareScore } from './share';
import { currentGoal, isAllCleared, nextGoal } from './goals';
import { FIXED_DT, VIRTUAL_H, VIRTUAL_W, type AnyGame, type Input } from './types';
import styles from './GameShell.module.css';

type Phase = 'title' | 'playing' | 'over' | 'result';

/**
 * ゲームオーバーからリザルト表示までの余韻。
 * ここは「やられた絵」を見せる時間。短すぎると何が起きたか分からず、
 * 長すぎると次の1回までの摩擦になる。
 */
const OVER_HOLD = 0.85;
/** リザルト表示から「もう一回」を受け付けるまで（誤タップ防止） */
const RETRY_LOCK = 0.4;

export function GameShell({ game }: { game: AnyGame }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>('title');
  const [result, setResult] = useState({
    score: 0,
    best: 0,
    isBest: false,
    reason: '',
    /** 今回のプレイで新しく手に入れた称号（無ければ空） */
    gotLabel: '',
    /** 記録全体で見たときの現在の称号 */
    rankLabel: '',
    /** 次に狙う称号 */
    nextLabel: '',
    nextDiff: 0,
    allCleared: false,
  });
  const [muted, setMuted] = useState(false);
  const resultRef = useRef(result);
  resultRef.current = result;

  useEffect(() => {
    sfx.init();
    setMuted(sfx.isMuted);
  }, []);

  const onShare = useCallback(() => {
    const r = resultRef.current;
    void shareScore(game.meta, r.score, {
      isBest: r.isBest,
      rankLabel: r.rankLabel,
      allCleared: r.allCleared,
    });
  }, [game]);

  const onToggleMute = useCallback(() => {
    setMuted(sfx.toggleMute());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const painter = new Painter(ctx, game.meta.theme);
    const cssFont = getComputedStyle(document.documentElement).getPropertyValue('--font-dot').trim();
    if (cssFont) painter.fontFamily = `${cssFont}, monospace`;

    const input = new InputSource();
    const detach = input.attach(wrap);

    // ループ内の状態はすべてここに置く（React の再描画と切り離す）
    let phaseLocal: Phase = 'title';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let state: any = null;
    let gameRng = createRng(randomSeed());
    let best = getBest(game.meta.slug);
    let prevScore = 0;
    let phaseTime = 0;
    let acc = 0;
    let last = performance.now();
    let raf = 0;
    let blink = 0;

    const gotoPhase = (p: Phase) => {
      phaseLocal = p;
      phaseTime = 0;
      setPhase(p);
    };

    const start = () => {
      gameRng = createRng(randomSeed());
      state = game.init(gameRng);
      state.time = 0;
      prevScore = 0;
      incPlays(game.meta.slug);
      sfx.tap();
      gotoPhase('playing');
    };

    const finish = () => {
      const score: number = state.score;
      const prevBest = best;
      const isBest = setBest(game.meta.slug, score);
      if (isBest) best = score;
      const reason = game.reason?.(state) ?? '';

      // 称号は「一度でも到達したか」で決まるので、記録（ベスト）を基準に見る
      const goals = game.meta.goals;
      const rank = currentGoal(goals, best);
      const hadRank = currentGoal(goals, prevBest);
      const got = rank && rank.label !== hadRank?.label ? rank.label : '';
      const next = nextGoal(goals, best);
      const allCleared = isAllCleared(goals, best);

      setResult({
        score,
        best: Math.max(best, score),
        isBest,
        reason,
        gotLabel: got,
        rankLabel: rank?.label ?? '',
        nextLabel: next?.label ?? '',
        nextDiff: next ? next.score - best : 0,
        allCleared,
      });
      if (got || isBest) sfx.best();
      gotoPhase('result');
    };

    const drawHud = () => {
      painter.rect(0, 0, VIRTUAL_W, 16, 'bg2');
      painter.text(`${state.score}${game.meta.unit}`, 6, 3, { color: 'accent', size: 12 });
      const nearBest = best > 0 && state.score >= best - Math.max(1, Math.round(best * 0.1)) && state.score < best;
      painter.text(`BEST ${best}`, VIRTUAL_W - 6, 4, {
        color: nearBest && Math.floor(blink * 6) % 2 === 0 ? 'accent2' : 'dim',
        size: 10,
        align: 'right',
      });
    };

    const drawTitle = () => {
      painter.clear('bg');
      painter.rect(0, 92, VIRTUAL_W, 2, 'line');
      painter.text(game.meta.title, VIRTUAL_W / 2, 60, { size: 22, align: 'center', color: 'ink' });
      painter.text(game.meta.howto, VIRTUAL_W / 2, 104, { size: 12, align: 'center', color: 'dim' });
      if (best > 0) {
        const rank = currentGoal(game.meta.goals, best);
        painter.text(`自己ベスト ${best}${game.meta.unit}${rank ? `（${rank.label}）` : ''}`, VIRTUAL_W / 2, 130, {
          size: 11,
          align: 'center',
          color: 'accent',
        });
        const next = nextGoal(game.meta.goals, best);
        if (next) {
          painter.text(`次は「${next.label}」${next.score}${game.meta.unit}`, VIRTUAL_W / 2, 146, {
            size: 10,
            align: 'center',
            color: 'dim',
          });
        } else if (isAllCleared(game.meta.goals, best)) {
          painter.text('ぜんぶ達成ずみ', VIRTUAL_W / 2, 146, { size: 10, align: 'center', color: 'good' });
        }
      }
      if (Math.floor(blink * 2) % 2 === 0) {
        painter.text('タップでスタート', VIRTUAL_W / 2, VIRTUAL_H - 70, {
          size: 13,
          align: 'center',
          color: 'ink',
        });
      }
      painter.text(hintForControl(game.meta.control), VIRTUAL_W / 2, VIRTUAL_H - 44, {
        size: 9,
        align: 'center',
        color: 'dim',
      });
    };

    const drawResult = () => {
      // 後ろでゲームは動き続けているが、読ませたいのは結果のほうなので強めに伏せる
      game.draw(painter, state);
      painter.alpha(0.94, () => painter.rect(0, 0, VIRTUAL_W, VIRTUAL_H, 'bg'));
      const r = resultRef.current;
      painter.text('おわり', VIRTUAL_W / 2, 62, { size: 13, align: 'center', color: 'dim' });
      painter.text(`${r.score}`, VIRTUAL_W / 2, 84, { size: 44, align: 'center', color: 'accent' });
      painter.text(game.meta.unit, VIRTUAL_W / 2, 132, { size: 12, align: 'center', color: 'dim' });
      if (r.reason) {
        painter.text(r.reason, VIRTUAL_W / 2, 156, { size: 11, align: 'center', color: 'bad' });
      }
      // 主役の1行。称号を取った瞬間がいちばん強いので最優先で出す
      const blinkOn = Math.floor(blink * 5) % 2 === 0;
      if (r.gotLabel) {
        if (blinkOn) {
          painter.text(`「${r.gotLabel}」になった！`, VIRTUAL_W / 2, 180, {
            size: 15,
            align: 'center',
            color: 'good',
          });
        }
      } else if (r.allCleared) {
        painter.text('ぜんぶ達成ずみ', VIRTUAL_W / 2, 180, { size: 13, align: 'center', color: 'good' });
      } else if (r.isBest) {
        if (blinkOn) {
          painter.text('自己ベスト更新！', VIRTUAL_W / 2, 180, { size: 15, align: 'center', color: 'good' });
        }
      } else if (r.rankLabel) {
        painter.text(`いまの称号: ${r.rankLabel}`, VIRTUAL_W / 2, 180, {
          size: 11,
          align: 'center',
          color: 'dim',
        });
      }

      // 次にやる理由を必ず1行出す
      if (r.nextLabel) {
        const close = r.nextDiff <= Math.max(2, r.best * 0.15);
        painter.text(`次は「${r.nextLabel}」まで あと${r.nextDiff}${game.meta.unit}`, VIRTUAL_W / 2, 202, {
          size: 11,
          align: 'center',
          color: close ? 'accent2' : 'dim',
        });
      } else if (!r.allCleared && r.best > r.score) {
        const diff = r.best - r.score;
        painter.text(`ベストまで あと${diff}${game.meta.unit}`, VIRTUAL_W / 2, 202, {
          size: 11,
          align: 'center',
          color: diff <= Math.max(2, r.best * 0.1) ? 'accent2' : 'dim',
        });
      }
      if (phaseTime > RETRY_LOCK && Math.floor(blink * 2) % 2 === 0) {
        painter.text('タップでもう一回', VIRTUAL_W / 2, VIRTUAL_H - 66, {
          size: 13,
          align: 'center',
          color: 'ink',
        });
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = Math.min((now - last) / 1000, 0.25);
      last = now;
      acc += elapsed;
      blink += elapsed;

      let steps = 0;
      while (acc >= FIXED_DT && steps < 5) {
        acc -= FIXED_DT;
        steps++;
        phaseTime += FIXED_DT;
        // 押してすぐ離すタップも拾えるよう、押下は押しっぱなし状態ではなくエッジで見る
        const tapped = input.justPressed;
        const inp: Input = {
          tap: tapped,
          hold: input.press || tapped,
          release: input.justReleased,
          px: input.px,
          py: input.py,
        };

        if (phaseLocal === 'title') {
          if (tapped) start();
        } else if (phaseLocal === 'playing') {
          state = advance(game, state, inp, gameRng, FIXED_DT);
          if (state.score > prevScore) {
            sfx.combo(state.score - prevScore > 1 ? 4 : Math.min(12, state.score));
            prevScore = state.score;
          }
          if (state.over) {
            sfx.over();
            gotoPhase('over');
          }
        } else if (phaseLocal === 'over') {
          // やられた後も step を回し続ける。ここが見せ場になる
          // （ゲーム側は over が立っていたら演出だけ進めること）
          state = advance(game, state, inp, gameRng, FIXED_DT);
          if (phaseTime >= OVER_HOLD) finish();
        } else if (phaseLocal === 'result') {
          if (tapped && phaseTime > RETRY_LOCK) start();
        }

        // 同じフレームで複数回 step が回っても、押下は最初の1回だけに効かせる
        input.endFrame();
      }

      if (phaseLocal === 'title') {
        drawTitle();
      } else if (phaseLocal === 'result') {
        drawResult();
      } else {
        painter.clear('bg');
        game.draw(painter, state);
        drawHud();
        // 赤の点滅は最初の一瞬だけ。そのあとは「やられた絵」を隠さない
        if (phaseLocal === 'over' && phaseTime < 0.18 && Math.floor(blink * 24) % 2 === 0) {
          painter.alpha(0.3, () => painter.rect(0, 0, VIRTUAL_W, VIRTUAL_H, 'bad'));
        }
      }
    };

    // タブを離れている間ブラウザはフレームを止める。戻ったときに
    // 止まっていた分をまとめて進めると「見ていない間に死んでいた」が起きるので、
    // 復帰時は経過時間を捨てる。
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        last = performance.now();
        acc = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      detach();
    };
  }, [game]);

  return (
    <div className={styles.root}>
      <div ref={wrapRef} className={styles.screen}>
        <canvas
          ref={canvasRef}
          width={VIRTUAL_W}
          height={VIRTUAL_H}
          className={styles.canvas}
          aria-label={`${game.meta.title}のゲーム画面`}
        />
      </div>

      <div className={styles.controls}>
        <button type="button" onClick={onToggleMute} className={styles.iconButton} aria-pressed={muted}>
          {muted ? '🔇 音オフ' : '🔊 音オン'}
        </button>
        {phase === 'result' && (
          <button type="button" onClick={onShare} className={styles.shareButton}>
            記録を送る
          </button>
        )}
      </div>
    </div>
  );
}

function hintForControl(control: string): string {
  switch (control) {
    case 'hold':
      return '長押しで操作（スペースキーでも遊べます）';
    case 'tap-hold':
      return 'タップと長押しで操作（スペースキーでも遊べます）';
    case 'aim':
      return '画面を狙ってタップ';
    default:
      return 'タップで操作（スペースキーでも遊べます）';
  }
}
