/**
 * 面白さゲート。
 *
 * 「面白いかどうか」は最後は人が決める。
 * ただし「面白くなりようがない状態」は機械で潰せる。ここはその足切り。
 *
 * 3種類のボットに何百回もプレイさせ、
 *   ・放置していると死ぬか（緊張があるか）
 *   ・初見でも点が入るか（1回で帰らないか）
 *   ・上手いと伸びるか（運ゲーでないか）
 *   ・上手くてもいつか終わるか（無限に続かないか）
 * を数字で見る。落ちたときは「何を直すか」まで出す。
 */

import {
  makeRandomPolicy,
  makeSmartPolicy,
  playOnce,
  type PlayResult,
  type Policy,
} from './runner';
import type { BaseState, FunGate, GameDefinition } from './types';

export const FUN_GATE_DEFAULT: FunGate = {
  idleSurvivalMaxSec: 8,
  randomSurvivalMinSec: 3,
  randomSurvivalMaxSec: 30,
  smartSurvivalMinSec: 20,
  smartSurvivalMaxSec: 240,
  skillRatioMin: 2.0,
  upsideRatioMin: 1.3,
  sessionMinutesMin: 6,
  sessionMinutesMax: 30,
};

export interface Dist {
  p10: number;
  p50: number;
  p90: number;
  max: number;
  mean: number;
}

export interface PolicyStats {
  name: string;
  runs: number;
  score: Dist;
  seconds: Dist;
  /** 打ち切りではなくゲームオーバーで終わった割合 */
  endedRate: number;
}

export interface GateCheck {
  id: string;
  label: string;
  pass: boolean;
  actual: string;
  expected: string;
  /** 落ちたときに何を直せばよいか */
  fix: string;
}

export interface GateReport {
  slug: string;
  title: string;
  pass: boolean;
  deterministic: boolean;
  stats: Record<string, PolicyStats>;
  checks: GateCheck[];
  topReasons: { reason: string; count: number }[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function dist(values: number[]): Dist {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    p10: percentile(sorted, 0.1),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
    mean: values.length ? sum / values.length : 0,
  };
}

function collect<S extends BaseState>(
  game: GameDefinition<S>,
  name: string,
  makePolicy: () => Policy<S>,
  runs: number,
  maxSeconds: number,
): { stats: PolicyStats; results: PlayResult[] } {
  const results: PlayResult[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(playOnce(game, { seed: 1000 + i * 7919, policy: makePolicy(), maxSeconds }));
  }
  return {
    stats: {
      name,
      runs,
      score: dist(results.map((r) => r.score)),
      seconds: dist(results.map((r) => r.seconds)),
      endedRate: results.filter((r) => r.ended).length / runs,
    },
    results,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function runFunGate<S extends BaseState>(
  game: GameDefinition<S>,
  opts: { runs?: number } = {},
): GateReport {
  const runs = opts.runs ?? 200;
  const gate: FunGate = { ...FUN_GATE_DEFAULT, ...(game.meta.funGate ?? {}) };
  const cap = gate.smartSurvivalMaxSec * 2;

  const idle = collect(game, 'idle', () => () => ({ press: false }), Math.min(runs, 60), cap);
  const random = collect(game, 'random', () => makeRandomPolicy<S>(), runs, cap);
  const smart = collect(game, 'smart', () => makeSmartPolicy(game), runs, cap);

  // 決定論チェック: 同じシード・同じ方針なら完全に同じ結果になるはず
  const a = playOnce(game, { seed: 42, policy: makeSmartPolicy(game), maxSeconds: cap });
  const b = playOnce(game, { seed: 42, policy: makeSmartPolicy(game), maxSeconds: cap });
  const deterministic = a.score === b.score && a.frames === b.frames;

  const skillRatio = smart.stats.score.p50 / Math.max(random.stats.score.p50, 0.5);
  const upsideRatio = smart.stats.score.p90 / Math.max(smart.stats.score.p50, 0.5);

  const checks: GateCheck[] = [
    {
      id: 'determinism',
      label: '再現性（同じ操作なら同じ結果）',
      pass: deterministic,
      actual: deterministic ? '一致' : `不一致 (${a.score}/${a.frames} vs ${b.score}/${b.frames})`,
      expected: '一致',
      fix: 'step / init の中で Math.random() や Date.now() を使っている。乱数は init(rng) で受け取った rng だけを使い、時間は引数の dt を積算して持つこと。',
    },
    {
      id: 'idle-dies',
      label: '放置すると死ぬ（緊張があるか）',
      pass: idle.stats.seconds.p50 <= gate.idleSurvivalMaxSec,
      actual: `${r1(idle.stats.seconds.p50)}秒`,
      expected: `${gate.idleSurvivalMaxSec}秒以内`,
      fix: '何もしなくても生き残れてしまう。時間とともに上がる圧（落下速度・出現間隔・制限時間の減り）を1つ入れる。',
    },
    {
      id: 'first-score',
      label: '初見でも点が入る（1回で帰らないか）',
      pass: random.stats.score.p50 >= 1,
      actual: `でたらめ操作の中央値 ${r1(random.stats.score.p50)}点`,
      expected: '1点以上',
      fix: '最初の1点が遠すぎる。開始直後は成功しやすくして、最初の3秒以内に必ず1点入るようにする。',
    },
    {
      id: 'not-instant-death',
      label: '理不尽な即死がない',
      pass: random.stats.seconds.p50 >= gate.randomSurvivalMinSec,
      actual: `${r1(random.stats.seconds.p50)}秒`,
      expected: `${gate.randomSurvivalMinSec}秒以上`,
      fix: '初見が何もできずに死んでいる。開始直後の数秒は難度を下げるか、猶予（無敵・広い判定）を置く。',
    },
    {
      id: 'not-mashable',
      label: '連打だけでは勝てない',
      pass: random.stats.seconds.p50 <= gate.randomSurvivalMaxSec,
      actual: `${r1(random.stats.seconds.p50)}秒`,
      expected: `${gate.randomSurvivalMaxSec}秒以内`,
      fix: 'でたらめに押しても生き残れてしまう。押す/押さないの判断に代償（外すと減点・クールタイム）をつける。',
    },
    {
      id: 'skill-matters',
      label: '腕前が効く（運ゲーでない）',
      pass: skillRatio >= gate.skillRatioMin,
      actual: `上手い/でたらめ = ${r1(skillRatio)}倍`,
      expected: `${gate.skillRatioMin}倍以上`,
      fix: '結果が運で決まっている。プレイヤーの判断（タイミング・位置・我慢）がスコアに直結する経路を作る。ランダム量を減らし、読める前兆を足す。',
    },
    {
      id: 'skilled-lasts',
      label: '上手ければ続く',
      pass: smart.stats.seconds.p50 >= gate.smartSurvivalMinSec,
      actual: `${r1(smart.stats.seconds.p50)}秒`,
      expected: `${gate.smartSurvivalMinSec}秒以上`,
      fix: '上手くても続かない＝伸びしろがない。上達で対処できる要素（予測・優先順位）を増やす。ボットが弱すぎる可能性もあるので bot() も見直す。',
    },
    {
      id: 'always-ends',
      label: '上手くてもいつか終わる',
      pass: smart.stats.seconds.p50 <= gate.smartSurvivalMaxSec && smart.stats.endedRate >= 0.9,
      actual: `中央値 ${r1(smart.stats.seconds.p50)}秒 / 決着率 ${Math.round(smart.stats.endedRate * 100)}%`,
      expected: `${gate.smartSurvivalMaxSec}秒以内 / 決着率90%以上`,
      fix: '終わらないゲームは記録が出ないのでもう一回が起きない。難度上昇を速める、または上限（制限時間・体力）を置く。',
    },
    {
      id: 'upside',
      label: '上振れがある（今日は乗ってる、が起きる）',
      pass: upsideRatio >= gate.upsideRatioMin,
      actual: `p90/p50 = ${r1(upsideRatio)}倍`,
      expected: `${gate.upsideRatioMin}倍以上`,
      fix: 'どのプレイも同じ点数で終わっている。連続成功のボーナスや、リスクを取ると大きい選択肢を足す。',
    },
  ];

  // 到達目標があるなら「一気に遊んでやりきれる長さか」も見る。
  // ここが長すぎるゲームは、終わりが見えないので次に開かれない。
  const goals = [...(game.meta.goals ?? [])].sort((a, b) => a.score - b.score);
  if (goals.length) {
    const first = goals[0];
    const last = goals[goals.length - 1];
    const reachRate = smart.results.filter((r) => r.score >= last.score).length / smart.results.length;
    const playsNeeded = reachRate > 0 ? 1 / reachRate : Infinity;
    const minutes = (playsNeeded * smart.stats.seconds.p50) / 60;

    checks.push({
      id: 'first-goal-early',
      label: '最初の称号がすぐ届く',
      pass: first.score <= smart.stats.score.p50,
      actual: `最初の称号 ${first.score}${game.meta.unit}（上手い人の中央値 ${Math.round(smart.stats.score.p50)}）`,
      expected: '中央値以下',
      fix: '最初の称号が遠すぎる。1〜2プレイで届く線まで下げる。最初のごほうびが遅いと2回目が起きない。',
    });

    checks.push({
      id: 'session-length',
      label: '一気に遊びきれる長さ（やりきり感）',
      pass: minutes >= gate.sessionMinutesMin && minutes <= gate.sessionMinutesMax,
      actual: Number.isFinite(minutes)
        ? `およそ ${Math.round(minutes)}分で「${last.label}」まで到達`
        : `「${last.label}」に到達できない`,
      expected: `${gate.sessionMinutesMin}〜${gate.sessionMinutesMax}分`,
      fix:
        minutes > gate.sessionMinutesMax
          ? '最後の称号が遠すぎる。1セッションで終わらないと「やりきった」が起きない。最後の目標を下げるか、1プレイあたりの得点を上げる。'
          : '最後の称号が近すぎる。すぐ全部埋まると遊ぶ理由が消える。目標を足すか、最後の目標を上げる。',
    });
  }

  const reasonCount = new Map<string, number>();
  for (const r of smart.results) {
    if (!r.reason) continue;
    reasonCount.set(r.reason, (reasonCount.get(r.reason) ?? 0) + 1);
  }

  return {
    slug: game.meta.slug,
    title: game.meta.title,
    pass: checks.every((c) => c.pass),
    deterministic,
    stats: { idle: idle.stats, random: random.stats, smart: smart.stats },
    checks,
    topReasons: [...reasonCount.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 3),
  };
}
