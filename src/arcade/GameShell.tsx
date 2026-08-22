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
import { advance, toInput, toLogFrame } from './runner';
import { createRng, randomSeed } from './rng';
import { sfx } from './sfx';
import { getBest, incPlays, setBest } from './storage';
import { gameUrl, shareScore } from './share';
import { currentGoal, isAllCleared, nextGoal } from './goals';
import { platformOf } from './platforms';
import { FIXED_DT, type AnyGame, type Frame, type Input } from './types';
import styles from './GameShell.module.css';

type Phase = 'title' | 'playing' | 'paused' | 'over' | 'replay' | 'result';

/** リプレイで見せる長さ（秒）。死ぬ直前だけでいい */
const REPLAY_SECONDS = 3;

/**
 * URL の #s=1234 から「出方の種」を読む。
 *
 * 同じ種なら出てくる順番が完全に同じになるので、
 * サーバーを持たなくても「同じ盤面での勝負」が成立する。
 */
function readSeedFromHash(): number | null {
  if (typeof window === 'undefined') return null;
  const m = /[#&]s=(\d+)/.exec(window.location.hash);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n >>> 0 : null;
}

/**
 * ゲームオーバーからリザルト表示までの余韻。
 * ここは「やられた絵」を見せる時間。短すぎると何が起きたか分からず、
 * 長すぎると次の1回までの摩擦になる。
 */
const OVER_HOLD = 0.85;
/** リザルト表示から「もう一回」を受け付けるまで（誤タップ防止） */
const RETRY_LOCK = 0.4;

export function GameShell({ game }: { game: AnyGame }) {
  // 機種。画面の寸法・向き・描画の質感・入力の想定がここで決まる
  const plat = platformOf(game.meta);
  const theme = game.meta.theme ?? plat.defaultTheme;
  /**
   * 画面枠の寸法。keitai の縦長は従来の値そのまま、横長の機種は幅を広めに取る。
   * CSS 側は keitai の値を既定として持っているので、ここで機種ぶんだけ上書きする。
   */
  const screenStyle = {
    aspectRatio: `${plat.w} / ${plat.h}`,
    width: plat.w >= plat.h ? 'min(92vw, 660px)' : 'min(92vw, 400px)',
  } as const;

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
  /** ゲームの中で例外が出たとき。null なら健康 */
  const [crashed, setCrashed] = useState<string | null>(null);
  /** 直前のプレイの種。おだいURLに使う */
  const [lastSeed, setLastSeed] = useState(0);
  const [copied, setCopied] = useState(false);
  /** ループの中で作った関数を、画面のボタンから呼ぶための橋渡し */
  const replayRef = useRef<(() => void) | null>(null);
  const pauseRef = useRef<(() => void) | null>(null);
  const resumeRef = useRef<(() => void) | null>(null);
  const quitRef = useRef<(() => void) | null>(null);
  const resultRef = useRef(result);
  // 描画中に ref を書き換えない。読むのは共有ボタンとループの中（どちらも描画の外）なので、
  // 描画が終わってから合わせれば間に合う
  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    sfx.init();
    // サーバー側では localStorage が読めないので、水和したあとに一度だけ実物へ合わせる。
    // 「効果の中で setState しない」の例外。ここを外すと、音を消していた人に音が鳴る
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMuted(sfx.isMuted);
  }, []);

  const onShare = useCallback(() => {
    const r = resultRef.current;
    void shareScore(game.meta, r.score, {
      isBest: r.isBest,
      rankLabel: r.rankLabel,
      allCleared: r.allCleared,
      // 終わり方を人に言いたいゲーム（育てる型）だけ、reason() を共有文に足す
      detail: game.meta.ending?.share ? r.reason : undefined,
    });
  }, [game]);

  const onToggleMute = useCallback(() => {
    setMuted(sfx.toggleMute());
  }, []);

  const onCopyChallenge = useCallback(() => {
    if (!lastSeed) return;
    const url = `${gameUrl(game.meta.slug)}#s=${lastSeed}`;
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      },
      () => {
        // コピーできない環境ではURLをそのまま出して手で選んでもらう
        window.prompt('このおだいのURL', url);
      },
    );
  }, [game, lastSeed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    // ドット機種は補間なし。flash（ベクター風）はなめらかに描く
    ctx.imageSmoothingEnabled = !plat.pixelated;

    const painter = new Painter(ctx, theme, plat);
    const cssFont = getComputedStyle(document.documentElement).getPropertyValue('--font-dot').trim();
    if (cssFont) painter.fontFamily = `${cssFont}, monospace`;

    const input = new InputSource();
    // 左右と打鍵は、それを遊びの中心にしているゲームでだけ拾う。
    // 常に拾うと、ページの矢印キー操作や文字入力を奪ってしまう
    const detach = input.attach(wrap, {
      steer: game.meta.control === 'steer',
      text: game.meta.control === 'type',
      dims: plat,
    });

    // ループ内の状態はすべてここに置く（React の再描画と切り離す）
    let phaseLocal: Phase = 'title';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let state: any = null;
    let gameRng = createRng(randomSeed());

    // タイトルの裏でボットに遊ばせ続ける（ゲームセンターのアトラクトモード）。
    // 開いた瞬間に遊び方が伝わるうえ、bot() を必須にしてある見返りが目に見える形になる。
    // 実プレイ用の state / rng とは完全に分けて、記録や進行に一切影響させない。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let demoState: any = null;
    let demoRng = createRng(randomSeed());
    let demoPolicyRng = createRng(randomSeed());
    let demoPrevPress = false;
    let demoRestIn = 0;

    // このプレイの入力を1フレーム1ビットで残しておく。
    // step が純粋関数で乱数もシード式なので、**シードと入力列だけで完全に再現できる**。
    // 状態を保存する必要がないので、記録はほぼタダ。
    let seedUsed = 0;
    /**
     * リプレイ用の操作の記録。
     *
     * tap / hold のゲームは1フレームあたり1ビットで足りるが、
     * 狙い先・左右・打鍵を使うゲームはそれも残さないと同じプレイにならない
     * （記録していなかった頃は aim のゲームがリプレイで別物になっていた）。
     * 使う分だけ残すので、tap のゲームの記録はこれまでと同じ大きさのまま。
     */
    let inputLog: Frame[] = [];
    // リプレイ再生中の状態（実プレイとは完全に分ける）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let replayState: any = null;
    let replayRng = createRng(0);
    let replayAt = 0;
    let replayPrev = false;
    let replaySlow = 0;
    let best = getBest(game.meta.slug);
    let prevScore = 0;
    /** 呼びかけ（BaseState.cue）の前回値。増えたぶんだけビープを鳴らす */
    let prevCue = 0;
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

    const startDemo = () => {
      demoRng = createRng(randomSeed());
      demoPolicyRng = createRng(randomSeed());
      demoState = game.init(demoRng);
      demoState.time = 0;
      demoPrevPress = false;
      demoRestIn = 0;
    };

    /**
     * 中断まわり。
     *
     * リトライの前に確認を挟まない（fun-doctrine ⑤）のと、プレイ中に抜けられることは別の話。
     * 抜け道が無いと、電話が来ただけで記録を捨てることになる。
     * 共通シェルが持つので、ゲーム側は何もしなくてよい。
     */
    const pause = () => {
      if (phaseLocal !== 'playing') return;
      gotoPhase('paused');
    };
    const resume = () => {
      if (phaseLocal !== 'paused') return;
      // 止まっていた分をまとめて進めないよう、時間を捨ててから戻る
      last = performance.now();
      acc = 0;
      gotoPhase('playing');
    };
    const quit = () => {
      if (phaseLocal !== 'paused') return;
      // 途中でやめても、そこまで遊んだ結果には変わりないので記録は残す
      finish('とちゅうでやめた');
    };
    pauseRef.current = pause;
    resumeRef.current = resume;
    quitRef.current = quit;

    const start = () => {
      // URL に #s=1234 が付いていたら、その出方で遊ぶ（同じ盤面で勝負できる）
      const fixed = readSeedFromHash();
      seedUsed = fixed ?? randomSeed();
      setLastSeed(seedUsed);
      inputLog = [];
      gameRng = createRng(seedUsed);
      state = game.init(gameRng);
      state.time = 0;
      prevScore = 0;
      prevCue = state.cue ?? 0;
      incPlays(game.meta.slug);
      sfx.jingleStart();
      gotoPhase('playing');
    };

    /**
     * 死ぬ直前だけをもう一度見せる。
     * 種と入力列があれば完全に再現できるので、状態を保存しておく必要はない。
     * 見たい人だけが押す（自動再生にすると「もう一回」までの摩擦になる）。
     */
    const startReplay = () => {
      if (inputLog.length === 0) return;
      const skip = Math.max(0, inputLog.length - Math.round(REPLAY_SECONDS / FIXED_DT));
      replayRng = createRng(seedUsed);
      replayState = game.init(replayRng);
      replayState.time = 0;
      replayPrev = false;
      replaySlow = 0;
      // 見せたいところまで一気に進める（描かないので一瞬）
      for (let i = 0; i < skip; i++) {
        const f = inputLog[i];
        replayState = advance(game, replayState, toInput(f, replayPrev), replayRng, FIXED_DT);
        replayPrev = f.press;
      }
      replayAt = skip;
      gotoPhase('replay');
    };
    replayRef.current = startReplay;

    const finish = (overrideReason?: string) => {
      const score: number = state.score;
      const prevBest = best;
      const isBest = setBest(game.meta.slug, score);
      if (isBest) best = score;
      const reason = overrideReason ?? game.reason?.(state) ?? '';

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
      // 称号を取った瞬間がいちばん強いので、そこはファンファーレにする
      if (got) sfx.jingleGoal();
      else if (isBest) sfx.best();
      gotoPhase('result');
    };

    const drawHud = () => {
      painter.rect(0, 0, painter.w, 16, 'bg2');
      painter.text(`${state.score}${game.meta.unit}`, 6, 3, { color: 'accent', size: 12 });
      const nearBest = best > 0 && state.score >= best - Math.max(1, Math.round(best * 0.1)) && state.score < best;
      painter.text(`BEST ${best}`, painter.w - 6, 4, {
        color: nearBest && Math.floor(blink * 6) % 2 === 0 ? 'accent2' : 'dim',
        size: 10,
        align: 'right',
      });
    };

    const drawTitle = () => {
      painter.clear('bg');
      // 裏で動いているデモを薄く見せる。文字が読めることを優先して強めに伏せる
      if (demoState) {
        game.draw(painter, demoState);
        painter.alpha(0.76, () => painter.rect(0, 0, painter.w, painter.h, 'bg'));
        painter.text('DEMO', painter.w - 6, 6, { size: 8, align: 'right', color: 'dim' });
      }
      painter.rect(0, 92, painter.w, 2, 'line');
      painter.text(game.meta.title, painter.w / 2, 60, { size: 22, align: 'center', color: 'ink' });
      painter.text(game.meta.howto, painter.w / 2, 104, { size: 12, align: 'center', color: 'dim' });
      if (best > 0) {
        const rank = currentGoal(game.meta.goals, best);
        painter.text(`自己ベスト ${best}${game.meta.unit}${rank ? `（${rank.label}）` : ''}`, painter.w / 2, 130, {
          size: 11,
          align: 'center',
          color: 'accent',
        });
        const next = nextGoal(game.meta.goals, best);
        if (next) {
          painter.text(`次は「${next.label}」${next.score}${game.meta.unit}`, painter.w / 2, 146, {
            size: 10,
            align: 'center',
            color: 'dim',
          });
        } else if (isAllCleared(game.meta.goals, best)) {
          painter.text('ぜんぶ達成ずみ', painter.w / 2, 146, { size: 10, align: 'center', color: 'good' });
        }
      }
      if (Math.floor(blink * 2) % 2 === 0) {
        painter.text('タップでスタート', painter.w / 2, painter.h - 70, {
          size: 13,
          align: 'center',
          color: 'ink',
        });
      }
      if (plat.extraHint) {
        // 機種由来の補足（ゲームパッド対応など）。操作の説明とは行を分ける
        painter.text(plat.extraHint, painter.w / 2, painter.h - 28, {
          size: 9,
          align: 'center',
          color: 'dim',
        });
      }
      painter.text(hintForControl(game.meta.control), painter.w / 2, painter.h - 44, {
        size: 9,
        align: 'center',
        color: 'dim',
      });
    };

    const drawResult = () => {
      // 後ろでゲームは動き続けているが、読ませたいのは結果のほうなので強めに伏せる
      game.draw(painter, state);
      painter.alpha(0.94, () => painter.rect(0, 0, painter.w, painter.h, 'bg'));
      const r = resultRef.current;
      painter.text('おわり', painter.w / 2, 62, { size: 13, align: 'center', color: 'dim' });
      painter.text(`${r.score}`, painter.w / 2, 84, { size: 44, align: 'center', color: 'accent' });
      painter.text(game.meta.unit, painter.w / 2, 132, { size: 12, align: 'center', color: 'dim' });
      if (r.reason) {
        // 死因は赤が既定。終わりが失敗でないゲーム（meta.ending.color）はその色で
        painter.text(r.reason, painter.w / 2, 156, {
          size: 11,
          align: 'center',
          color: game.meta.ending?.color ?? 'bad',
        });
      }
      // 主役の1行。称号を取った瞬間がいちばん強いので最優先で出す
      const blinkOn = Math.floor(blink * 5) % 2 === 0;
      if (r.gotLabel) {
        if (blinkOn) {
          painter.text(`「${r.gotLabel}」になった！`, painter.w / 2, 180, {
            size: 15,
            align: 'center',
            color: 'good',
          });
        }
      } else if (r.allCleared) {
        painter.text('ぜんぶ達成ずみ', painter.w / 2, 180, { size: 13, align: 'center', color: 'good' });
      } else if (r.isBest) {
        if (blinkOn) {
          painter.text('自己ベスト更新！', painter.w / 2, 180, { size: 15, align: 'center', color: 'good' });
        }
      } else if (r.rankLabel) {
        painter.text(`いまの称号: ${r.rankLabel}`, painter.w / 2, 180, {
          size: 11,
          align: 'center',
          color: 'dim',
        });
      }

      // 次にやる理由を必ず出す。
      //
      // 称号は「自己ベスト」で判定している（一度取った称号は落ちない）ので、
      // 「あと◯点」も自己ベストからの差になる。**そのことを画面に書かないと壊れて見える**。
      // 実際に「毎回100点は取っているのに あと28点 のまま動かない。これは何？」という
      // 指摘が出た（2026-08-12 / nuimichi）。目標値と自己ベストの両方を並べて出す。
      if (r.nextLabel) {
        const close = r.nextDiff <= Math.max(2, r.best * 0.15);
        painter.text(`次は「${r.nextLabel}」${r.best + r.nextDiff}${game.meta.unit}`, painter.w / 2, 198, {
          size: 12,
          align: 'center',
          color: close ? 'accent2' : 'ink',
        });
        painter.text(
          `自己ベスト ${r.best}${game.meta.unit} … あと${r.nextDiff}${game.meta.unit}`,
          painter.w / 2,
          215,
          { size: 10, align: 'center', color: 'dim' },
        );
      } else if (r.best > 0) {
        painter.text(`自己ベスト ${r.best}${game.meta.unit}`, painter.w / 2, 202, {
          size: 11,
          align: 'center',
          color: !r.allCleared && r.best - r.score <= Math.max(2, r.best * 0.1) ? 'accent2' : 'dim',
        });
      }
      if (phaseTime > RETRY_LOCK && Math.floor(blink * 2) % 2 === 0) {
        painter.text('タップでもう一回', painter.w / 2, painter.h - 66, {
          size: 13,
          align: 'center',
          color: 'ink',
        });
      }
    };

    const frame = (now: number) => {
      try {
        tick(now);
      } catch (err) {
        // ゲームの中で落ちても、固まった画面のまま放置しない。
        // 収録中に出ても、それ自体がネタになる形で見せる
        cancelAnimationFrame(raf);
        console.error('[asobuild] ゲームが落ちました', err);
        setCrashed(err instanceof Error ? err.message : String(err));
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const tick = (now: number) => {
      // ゲームパッドはイベントが来ないので、毎フレームこちらから読む
      input.pollGamepad();
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
          steer: input.steer,
          typed: input.typed,
        };

        if (phaseLocal === 'paused') {
          // 止まっている間は何も進めない（時間も入力も）
        } else if (phaseLocal === 'title') {
          // 裏のデモを進める。死んだら少し置いて、別のシードで次のデモへ
          if (!demoState) {
            startDemo();
          } else if (demoState.over) {
            demoRestIn -= FIXED_DT;
            if (demoRestIn <= 0) startDemo();
          } else {
            const action = game.bot(demoState, demoPolicyRng);
            const demoInput = toInput(action, demoPrevPress);
            demoState = advance(game, demoState, demoInput, demoRng, FIXED_DT);
            demoPrevPress = action.press;
            if (demoState.over) demoRestIn = 0.8;
          }
          if (tapped) start();
        } else if (phaseLocal === 'playing') {
          inputLog.push(toLogFrame(inp, game.meta.control));
          state = advance(game, state, inp, gameRng, FIXED_DT);
          if (state.score > prevScore) {
            sfx.combo(state.score - prevScore > 1 ? 4 : Math.min(12, state.score));
            prevScore = state.score;
          }
          // 得点は動かないが知らせたい瞬間（育てる型の呼び出し）。ゲームが cue を進めたら鳴らす
          if ((state.cue ?? 0) > prevCue) {
            sfx.call();
            prevCue = state.cue ?? 0;
          }
          if (state.over) {
            sfx.jingleOver();
            gotoPhase('over');
          }
        } else if (phaseLocal === 'over') {
          // やられた後も step を回し続ける。ここが見せ場になる
          // （ゲーム側は over が立っていたら演出だけ進めること）
          state = advance(game, state, inp, gameRng, FIXED_DT);
          if (phaseTime >= OVER_HOLD) finish();
        } else if (phaseLocal === 'replay') {
          // 半分の速さで見せる。等速だと何が起きたのか目で追えない
          replaySlow += 1;
          if (replaySlow % 2 === 0 && replayAt < inputLog.length) {
            const f = inputLog[replayAt];
            replayState = advance(game, replayState, toInput(f, replayPrev), replayRng, FIXED_DT);
            replayPrev = f.press;
            replayAt += 1;
          } else if (replayAt >= inputLog.length) {
            gotoPhase('result');
          }
          // 途中でタップしたら切り上げる（見たくない人を待たせない）
          if (tapped && phaseTime > 0.3) gotoPhase('result');
        } else if (phaseLocal === 'result') {
          if (tapped && phaseTime > RETRY_LOCK) start();
        }

        // 同じフレームで複数回 step が回っても、押下は最初の1回だけに効かせる
        input.endFrame();
      }

      // 型の絞り込みで比較が潰れないよう、いったん Phase として受け直す
      const ph: Phase = phaseLocal;
      if (ph === 'title') {
        drawTitle();
      } else if (ph === 'result') {
        drawResult();
      } else if (ph === 'paused') {
        // 止めている間も、後ろで何が起きていたかは見せたまま伏せる
        painter.clear('bg');
        game.draw(painter, state);
        drawHud();
        painter.alpha(0.72, () => painter.rect(0, 0, painter.w, painter.h, 'bg'));
        // ゲームの絵と重ならない高さに置く
        painter.text('ちゅうだん中', painter.w / 2, 66, { size: 16, align: 'center', color: 'ink' });
        painter.text(`いま ${state.score}${game.meta.unit}`, painter.w / 2, 92, {
          size: 11,
          align: 'center',
          color: 'dim',
        });
      } else if (ph === 'replay') {
        painter.clear('bg');
        game.draw(painter, replayState);
        painter.rect(0, 0, painter.w, 16, 'bg2');
        painter.text(`${replayState.score}${game.meta.unit}`, 6, 3, { color: 'dim', size: 12 });
        if (Math.floor(blink * 3) % 2 === 0) {
          painter.text('リプレイ', painter.w - 6, 4, { size: 10, align: 'right', color: 'accent2' });
        }
        painter.text('タップでとばす', painter.w / 2, painter.h - 24, {
          size: 9,
          align: 'center',
          color: 'dim',
        });
      } else {
        painter.clear('bg');
        game.draw(painter, state);
        drawHud();
        // 赤の点滅は最初の一瞬だけ。そのあとは「やられた絵」を隠さない
        if (ph === 'over' && phaseTime < 0.18 && Math.floor(blink * 24) % 2 === 0) {
          painter.alpha(0.3, () => painter.rect(0, 0, painter.w, painter.h, 'bad'));
        }
      }
    };

    // ESC は「遊ぶための入力」ではなく画面の操作なので、InputSource とは分けて扱う
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (phaseLocal === 'playing') pause();
      else if (phaseLocal === 'paused') resume();
    };
    window.addEventListener('keydown', onEsc);

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
      window.removeEventListener('keydown', onEsc);
      document.removeEventListener('visibilitychange', onVisibility);
      detach();
    };
  }, [game, plat, theme]);

  if (crashed) {
    return (
      <div className={styles.root}>
        <div className={styles.crash} style={screenStyle}>
          <p className={styles.crashTitle}>エラーが はっせい しました</p>
          <p className={styles.crashBody}>{crashed}</p>
          <button type="button" className={styles.crashButton} onClick={() => window.location.reload()}>
            もう一回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div ref={wrapRef} className={styles.screen} style={screenStyle}>
        <canvas
          ref={canvasRef}
          width={plat.w}
          height={plat.h}
          className={styles.canvas}
          // flash 機種は当時のベクター描画の質感なので、ドット拡大にしない
          style={plat.pixelated ? undefined : { imageRendering: 'auto' }}
          aria-label={`${game.meta.title}のゲーム画面`}
        />
      </div>

      <div className={styles.controls}>
        {phase === 'playing' && (
          <button type="button" onClick={() => pauseRef.current?.()} className={styles.iconButton}>
            やめる（ESC）
          </button>
        )}
        {phase === 'paused' && (
          <>
            <button type="button" onClick={() => resumeRef.current?.()} className={styles.shareButton}>
              つづける
            </button>
            <button type="button" onClick={() => quitRef.current?.()} className={styles.quitButton}>
              ここでやめる
            </button>
          </>
        )}
        <button type="button" onClick={onToggleMute} className={styles.iconButton} aria-pressed={muted}>
          {muted ? '🔇 音オフ' : '🔊 音オン'}
        </button>
        {phase === 'result' && (
          <>
            <button type="button" onClick={() => replayRef.current?.()} className={styles.iconButton}>
              今のを見る
            </button>
            <button type="button" onClick={onCopyChallenge} className={styles.iconButton}>
              {copied ? 'コピーした' : 'おだいURL'}
            </button>
            <button type="button" onClick={onShare} className={styles.shareButton}>
              記録を送る
            </button>
          </>
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
    case 'steer':
      return '画面の左右をおして曲がる（← → キーでも）';
    case 'type':
      // これだけスマホで遊べないので、開く前に分かるようにしておく
      return 'キーボードで打つ（パソコン向け）';
    default:
      return 'タップで操作（スペースキーでも遊べます）';
  }
}
