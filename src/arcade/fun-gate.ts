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

import { platformOf } from './platforms';
import { createRng } from './rng';
import {
  advance,
  makeRandomPolicy,
  makeSmartPolicy,
  playOnce,
  toInput,
  toLogFrame,
  type PlayResult,
  type Policy,
} from './runner';
import { FIXED_DT, type Frame, type PlatformName } from './types';
import type { BaseState, FunGate, GameDefinition, Genre } from './types';

/**
 * 「何も分かっていない人」役を作る。
 *
 * ゲームが novice() を持っていればそれを使う。
 * タイピングのように、共通のでたらめボットでは構造的に一度も成功できない遊びがあるため。
 */
function makeNovicePolicy<S extends BaseState>(game: GameDefinition<S>): Policy<S> {
  const novice = game.novice;
  if (novice) return (state, rng, frame) => novice.call(game, state, rng, frame);
  return makeRandomPolicy<S>(game.meta.control, platformOf(game.meta));
}

export const FUN_GATE_DEFAULT: FunGate = {
  idleSurvivalMaxSec: 8,
  idleSurvivalMinSec: 0,
  randomSurvivalMinSec: 3,
  randomSurvivalMaxSec: 30,
  smartSurvivalMinSec: 20,
  /**
   * 上手い人の1プレイの上限。
   * fun-doctrine では「40〜90秒」を目安にしているのに、ここが 240秒 では
   * 明らかに長すぎるゲームが素通りしてしまう（実際に158秒のものが通った）。
   * 目安より少し余裕をみて 120秒 にしている。
   */
  smartSurvivalMaxSec: 120,
  skillRatioMin: 2.0,
  upsideRatioMin: 1.3,
  sessionMinutesMin: 6,
  sessionMinutesMax: 30,
  eventIntervalMinSec: 0.25,
  eventIntervalMaxSec: 4,
};

/**
 * 遊びの型ごとの既定値。
 * 型が変われば「良い状態」も変わるので、同じものさしを当ててはいけない。
 */
const GENRE_GATE: Record<Genre, Partial<FunGate>> = {
  action: {},
  // 考える時間があるぶん、1手の間隔も1プレイの長さも長くてよい
  puzzle: { smartSurvivalMaxSec: 420, randomSurvivalMaxSec: 90, eventIntervalMaxSec: 10 },
  // 放置が遊びの一部。少し放っておいたくらいで終わっては困る。
  // 上振れの基準を下げているのは、育てるものは「毎回同じように世話する」のが基本で、
  // 反射ゲームほどスコアが跳ねないため。代わりに「どう育つか」の分岐で飽きさせる／させないが決まる
  nurture: {
    idleSurvivalMinSec: 45,
    smartSurvivalMaxSec: 600,
    eventIntervalMaxSec: 12,
    upsideRatioMin: 1.2,
  },
  // 運の波が主役なので、上振れを強めに求める
  chance: { upsideRatioMin: 1.8, smartSurvivalMaxSec: 400, eventIntervalMaxSec: 8 },
  // 1回たどり着いて終わり。繰り返し前提の項目は外す
  oneshot: { smartSurvivalMaxSec: 900, eventIntervalMaxSec: 15 },
};

/**
 * 記録した操作だけで、同じプレイを再現できるか。
 *
 * リプレイ・おだいURL・OGP画像は、どれも「種＋操作の記録」から作り直している。
 * 操作の一部を記録し忘れていると、そこだけ別のプレイになる。
 * 実際に aim（狙い先）を記録していなかった時期があり、気づかれていなかった。
 */
function replaysTheSame<S extends BaseState>(game: GameDefinition<S>): boolean {
  const seed = 4242;
  const control = game.meta.control;
  const dims = platformOf(game.meta);

  // 1回目: ボットに遊ばせながら、操作方式が使う分だけを記録する
  const rng = createRng(seed);
  const policyRng = createRng(seed ^ 0x9e3779b9);
  let state = game.init(rng);
  let prev = false;
  const log: Frame[] = [];
  while (!state.over && log.length < 3600) {
    const action = game.bot(state, policyRng);
    const input = toInput(action, prev, dims);
    log.push(toLogFrame(input, control));
    state = advance(game, state, input, rng, FIXED_DT);
    prev = action.press;
  }

  // 2回目: 記録だけを頼りに、同じプレイをなぞる
  const rng2 = createRng(seed);
  let replayed = game.init(rng2);
  let prev2 = false;
  for (const f of log) {
    replayed = advance(game, replayed, toInput(f, prev2, dims), rng2, FIXED_DT);
    prev2 = f.press;
  }

  return replayed.score === state.score && replayed.over === state.over;
}

/** 全ジャンルで見る項目 */
const COMMON_CHECKS = [
  'determinism',
  'replay-fidelity',
  'first-score',
  'skill-matters',
  'event-pace',
  'first-goal-early',
  'session-length',
];

/**
 * 型ごとに、どの項目を効かせるか。
 * action の「放置すると死ぬ」を nurture に当てると、正しく作れているものが落ちる。
 */
const GENRE_CHECKS: Record<Genre, string[]> = {
  action: [
    ...COMMON_CHECKS,
    'idle-dies',
    'not-instant-death',
    'not-mashable',
    'skilled-lasts',
    'always-ends',
    'upside',
  ],
  puzzle: [...COMMON_CHECKS, 'not-mashable', 'skilled-lasts', 'always-ends', 'upside'],
  nurture: [...COMMON_CHECKS, 'idle-survives', 'always-ends', 'upside'],
  chance: [...COMMON_CHECKS, 'always-ends', 'upside'],
  oneshot: [
    'determinism',
    'replay-fidelity',
    'first-score',
    'skill-matters',
    'event-pace',
    'completable',
  ],
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
  genre: Genre;
  /** 機種。keitai 以外なら見出しに出す */
  platform: PlatformName;
  pass: boolean;
  deterministic: boolean;
  /**
   * 「でたらめ」役をゲーム側の novice() が担ったか。
   * 共通のでたらめボットより甘い判定になりうるので、必ず画面に出す。
   */
  customNovice: boolean;
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
  seedOffset: number,
): { stats: PolicyStats; results: PlayResult[] } {
  const results: PlayResult[] = [];
  for (let i = 0; i < runs; i++) {
    results.push(
      playOnce(game, { seed: 1000 + seedOffset + i * 7919, policy: makePolicy(), maxSeconds }),
    );
  }
  return { stats: makeStats(name, results, runs), results };
}

function makeStats(name: string, results: PlayResult[], runs: number): PolicyStats {
  return {
    name,
    runs,
    score: dist(results.map((r) => r.score)),
    seconds: dist(results.map((r) => r.seconds)),
    endedRate: results.filter((r) => r.ended).length / runs,
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** 3種のボットの結果。判定はここから作る */
interface Collected {
  stats: PolicyStats;
  results: PlayResult[];
}

/** ゲートの設定を組み立てる（既定 → 型ごと → ゲームごとの順で上書き） */
function resolveGate(genre: Genre, override?: Partial<FunGate>): FunGate {
  return { ...FUN_GATE_DEFAULT, ...GENRE_GATE[genre], ...(override ?? {}) };
}

export function runFunGate<S extends BaseState>(
  game: GameDefinition<S>,
  opts: { runs?: number; seedOffset?: number } = {},
): GateReport {
  const runs = opts.runs ?? 200;
  // 種をずらして測ると、たまたま今の種でうまくいっているだけの調整を見つけられる
  const seedOffset = opts.seedOffset ?? 0;
  const genre: Genre = game.meta.genre ?? 'action';
  const gate = resolveGate(genre, game.meta.funGate);
  const cap = gate.smartSurvivalMaxSec * 2;

  const idle = collect(game, 'idle', () => () => ({ press: false }), Math.min(runs, 60), cap, seedOffset);
  const random = collect(game, 'random', () => makeNovicePolicy(game), runs, cap, seedOffset);
  const smart = collect(game, 'smart', () => makeSmartPolicy(game), runs, cap, seedOffset);

  return buildReport(game, genre, gate, cap, idle, random, smart);
}

/**
 * 集めた結果から判定を作る。
 *
 * ここを1か所にしておくことで、コマンドラインからの実行（同期）と
 * ブラウザでの実行（非同期・途中経過つき）が、必ず同じ基準で判定される。
 */
function buildReport<S extends BaseState>(
  game: GameDefinition<S>,
  genre: Genre,
  gate: FunGate,
  cap: number,
  idle: Collected,
  random: Collected,
  smart: Collected,
): GateReport {
  // 決定論チェック: 同じシード・同じ方針なら完全に同じ結果になるはず
  const a = playOnce(game, { seed: 42, policy: makeSmartPolicy(game), maxSeconds: cap });
  const b = playOnce(game, { seed: 42, policy: makeSmartPolicy(game), maxSeconds: cap });
  const deterministic = a.score === b.score && a.frames === b.frames;
  const replayable = replaysTheSame(game);

  const skillRatio = smart.stats.score.p50 / Math.max(random.stats.score.p50, 0.5);
  const upsideRatio = smart.stats.score.p90 / Math.max(smart.stats.score.p50, 0.5);

  const allChecks: GateCheck[] = [
    {
      id: 'determinism',
      label: '再現性（同じ操作なら同じ結果）',
      pass: deterministic,
      actual: deterministic ? '一致' : `不一致 (${a.score}/${a.frames} vs ${b.score}/${b.frames})`,
      expected: '一致',
      fix: 'step / init の中で Math.random() や Date.now() を使っている。乱数は init(rng) で受け取った rng だけを使い、時間は引数の dt を積算して持つこと。',
    },
    {
      id: 'replay-fidelity',
      label: '記録した操作だけで同じプレイになる',
      pass: replayable,
      actual: replayable ? '一致' : '別のプレイになった',
      expected: '一致',
      fix: 'リプレイ・おだいURL・OGP画像は「種＋操作の記録」から作り直している。meta.control が実際に使っている入力と食い違っているか、runner.ts の toLogFrame がその入力を残していない。まず meta.control が実物と合っているかを見ること。',
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
      id: 'idle-survives',
      label: '放置しても壊れない（ほったらかしにできるか）',
      pass: idle.stats.seconds.p50 >= gate.idleSurvivalMinSec,
      actual: `${r1(idle.stats.seconds.p50)}秒`,
      expected: `${gate.idleSurvivalMinSec}秒以上`,
      fix: '少し放っておいただけで終わってしまう。育てるものは「見ていない時間がある」のが前提なので、放置に耐える猶予を長くする。減るものは減っても、取り返しがつく形にする。',
    },
    {
      id: 'completable',
      label: '最後までたどり着ける',
      pass: smart.stats.endedRate >= 0.9,
      actual: `到達率 ${Math.round(smart.stats.endedRate * 100)}%`,
      expected: '90%以上',
      fix: '正しい手順をとっても終わりに届いていない。詰みがあるか、bot() が終わり方を知らない。どちらなのかを先に切り分ける。',
    },
    {
      id: 'first-score',
      label: '初見でも点が入る（1回で帰らないか）',
      pass: random.stats.score.p50 >= 1,
      actual: `でたらめ操作の中央値 ${r1(random.stats.score.p50)}点`,
      expected: '1点以上',
      // type の共通でたらめボットは文字を打たないので、直すべきはゲームではなく novice() の不在。
      // ここで普通の直し方を出すと、難度を無意味に下げる方向へ誘導してしまう
      fix:
        game.meta.control === 'type' && !game.novice
          ? 'control:"type" の共通でたらめボットは文字を打たないので、この項目は novice()（「何も分かっていない人」役）を書かないと通りません。.claude/rules/games.md の「novice()」の節を読むこと。'
          : '最初の1点が遠すぎる。開始直後は成功しやすくして、最初の3秒以内に必ず1点入るようにする。',
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

  // 遊んでいない人が画面を見ているとき、どれくらいの間隔で何かが起きるか。
  // 動画で見せる前提なので、無風が続くゲームは「何も起きていない」に見えてしまう。
  const totalEvents = smart.results.reduce((a, r) => a + r.scoreEvents, 0);
  const totalSeconds = smart.results.reduce((a, r) => a + r.seconds, 0);
  const eventInterval = totalEvents > 0 ? totalSeconds / totalEvents : Infinity;

  allChecks.push({
    id: 'event-pace',
    label: '画面で何かが起きる間隔（見ていて退屈しないか）',
    pass: eventInterval >= gate.eventIntervalMinSec && eventInterval <= gate.eventIntervalMaxSec,
    actual: Number.isFinite(eventInterval) ? `${r1(eventInterval)}秒に1回` : '何も起きない',
    expected: `${gate.eventIntervalMinSec}〜${gate.eventIntervalMaxSec}秒に1回`,
    fix:
      eventInterval > gate.eventIntervalMaxSec
        ? '間が空きすぎて、遊んでいない人には何も起きていないように見える。加点の刻みを細かくするか、出てくる物を増やす。'
        : '起きることが多すぎて、何が起きたのか目で追えない。加点をまとめる、出現を減らす。',
  });

  // 到達目標があるなら「一気に遊んでやりきれる長さか」も見る。
  // ここが長すぎるゲームは、終わりが見えないので次に開かれない。
  const goals = [...(game.meta.goals ?? [])].sort((a, b) => a.score - b.score);
  if (goals.length) {
    const first = goals[0];
    const last = goals[goals.length - 1];
    const reachCount = smart.results.filter((r) => r.score >= last.score).length;
    const playsNeeded = reachCount > 0 ? smart.results.length / reachCount : Infinity;
    const minutes = (playsNeeded * smart.stats.seconds.p50) / 60;
    // 到達回数が少ないと推定が大きくぶれる（実測: 80回試行で56分、200回で8分と出た）。
    // 足りないときは当て推量で合否を出さず、「判定できない」と言う
    const enoughSamples = reachCount >= 5;

    allChecks.push({
      id: 'first-goal-early',
      label: '最初の称号がすぐ届く',
      pass: first.score <= smart.stats.score.p50,
      actual: `最初の称号 ${first.score}${game.meta.unit}（上手い人の中央値 ${Math.round(smart.stats.score.p50)}）`,
      expected: '中央値以下',
      fix: '最初の称号が遠すぎる。1〜2プレイで届く線まで下げる。最初のごほうびが遅いと2回目が起きない。',
    });

    allChecks.push({
      id: 'session-length',
      label: '一気に遊びきれる長さ（やりきり感）',
      pass: enoughSamples && minutes >= gate.sessionMinutesMin && minutes <= gate.sessionMinutesMax,
      actual: !enoughSamples
        ? `最後の称号「${last.label}」への到達が ${smart.results.length}回中 ${reachCount}回しかなく、判定できない`
        : `およそ ${Math.round(minutes)}分で「${last.label}」まで到達`,
      expected: `${gate.sessionMinutesMin}〜${gate.sessionMinutesMax}分（到達5回以上で判定）`,
      fix: !enoughSamples
        ? `まず試行を増やして測り直す（npm run fun -- ${game.meta.slug} --runs=400）。それでも到達が数回なら、最後の称号が遠すぎるので下げる。`
        : minutes > gate.sessionMinutesMax
          ? '最後の称号が遠すぎる。1セッションで終わらないと「やりきった」が起きない。最後の目標を下げるか、1プレイあたりの得点を上げる。'
          : '最後の称号が近すぎる。すぐ全部埋まると遊ぶ理由が消える。目標を足すか、最後の目標を上げる。',
    });
  }

  const reasonCount = new Map<string, number>();
  for (const r of smart.results) {
    if (!r.reason) continue;
    reasonCount.set(r.reason, (reasonCount.get(r.reason) ?? 0) + 1);
  }

  // 遊びの型に合う項目だけを見る。合わない項目で落とすと、
  // 正しく作れているものを不合格にしてしまう
  const active = new Set(GENRE_CHECKS[genre]);
  const checks = allChecks.filter((c) => active.has(c.id));

  return {
    slug: game.meta.slug,
    title: game.meta.title,
    genre,
    platform: game.meta.platform ?? 'keitai',
    pass: checks.every((c) => c.pass),
    deterministic,
    customNovice: typeof game.novice === 'function',
    stats: { idle: idle.stats, random: random.stats, smart: smart.stats },
    checks,
    topReasons: [...reasonCount.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 3),
  };
}

/**
 * 画面に描かせるための小休止。
 *
 * setTimeout(0) だと、裏に回ったタブでは 1秒に1回まで抑えられてしまい、
 * 検定が何十倍も遅くなる（実測: 300回が84秒たっても終わらなかった）。
 * MessageChannel はその抑制を受けないので、こちらを使う。
 */
function yieldToUI(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

/** ブラウザで走らせるときの途中経過 */
export interface GateProgress {
  policy: 'idle' | 'random' | 'smart';
  done: number;
  total: number;
  /** ここまでに出たスコア（分布を描くのに使う） */
  scores: number[];
}

/**
 * ブラウザ用。少しずつ走らせて、途中経過を返しながら進む。
 *
 * 判定そのものは同期版と同じ buildReport を通るので、
 * 画面で見えている結果とコマンドラインの結果は必ず一致する。
 * （見せるためだけの別実装を作ると、そのうち食い違って信用できなくなる）
 */
export async function runFunGateAsync<S extends BaseState>(
  game: GameDefinition<S>,
  opts: {
    runs?: number;
    seedOffset?: number;
    onProgress?: (p: GateProgress) => void;
    /** 何回ごとに画面へ制御を返すか。小さいほど滑らかだが遅くなる */
    yieldEvery?: number;
  } = {},
): Promise<GateReport> {
  const runs = opts.runs ?? 200;
  const seedOffset = opts.seedOffset ?? 0;
  const genre: Genre = game.meta.genre ?? 'action';
  const gate = resolveGate(genre, game.meta.funGate);
  const cap = gate.smartSurvivalMaxSec * 2;
  const yieldEvery = opts.yieldEvery ?? 6;

  const collectAsync = async (
    name: 'idle' | 'random' | 'smart',
    makePolicy: () => Policy<S>,
    count: number,
  ): Promise<{ stats: PolicyStats; results: PlayResult[] }> => {
    const results: PlayResult[] = [];
    for (let i = 0; i < count; i++) {
      results.push(
        playOnce(game, {
          seed: 1000 + seedOffset + i * 7919,
          policy: makePolicy(),
          maxSeconds: cap,
        }),
      );
      if ((i + 1) % yieldEvery === 0 || i === count - 1) {
        opts.onProgress?.({
          policy: name,
          done: i + 1,
          total: count,
          scores: results.map((r) => r.score),
        });
        // 画面を描かせる隙を作る
        await yieldToUI();
      }
    }
    return { stats: makeStats(name, results, count), results };
  };

  const idle = await collectAsync('idle', () => () => ({ press: false }), Math.min(runs, 60));
  const random = await collectAsync('random', () => makeNovicePolicy(game), runs);
  const smart = await collectAsync('smart', () => makeSmartPolicy(game), runs);

  return buildReport(game, genre, gate, cap, idle, random, smart);
}
