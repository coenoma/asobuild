/**
 * 一分一生（いっぷんいっしょう）
 *
 * ふきだしが出たらタップして応える。ねんね中と赤いふきだし（わがまま）はガマンする。
 * 60秒で「たまご→あかちゃん→こども→おとな→おとしより→たねになる」が全部終わる。
 *
 * ・**寿命でしか終わらない**（早死にが無い）。放置しても連打しても一生は最後まで続く。
 *   失敗は罰ではなく「育ち」に変換され、別の姿になって返ってくる
 * ・罰は時間を奪わず、ハート（＝得点の倍率）を落とすだけ。
 *   身動きの取れない時間を長くすると、ガサツな人ほど何もできないゲームになる
 * ・**うまれつき（たまごの柄）× 育ち**で姿が分かれる。よく世話されたら「うまれつき」が出て、
 *   雑なら「育ち」が出る。だから上手い人の一生も毎回ちがう
 *
 * 設計と数値の根拠は docs/plans/008-ippun-issho/design.md。
 */

import { defineGame, type BaseState } from '@/arcade/types';
import { PLATFORMS } from '@/arcade/platforms';
import type { Painter } from '@/arcade/painter';
import type { ColorKey } from '@/arcade/palette';
import type { Rng } from '@/arcade/rng';
import {
  addPop,
  addShake,
  createFeel,
  feelTick,
  hitStop,
  popScale,
  shakeOffset,
  takeTap,
  type FeelState,
} from '@/arcade/feel';
import { meta } from './meta';

/** この機種の画面寸法。座標はすべてこれが基準 */
const { w: W, h: H } = PLATFORMS.keitai;

/**
 * 収録中に触ることになる数値。`npm run tune` が動かせるよう、定数ではなく入れ物にしてある
 * （通常のプレイでは変わらない）。
 */
const TUNE = {
  /** 要求の間隔の倍率。大きいほどのんびりした一生になる */
  wantGap: 1,
  /** ふきだしが消えるまでの秒数。ガサツな人に届くかはここ1本で決まる */
  wantDur: 3.5,
  /** 寿命の基準（秒）。±2秒のゆれと「ながいき」+4秒がこの上に乗る */
  lifespan: 60,
};

/* ---- 一生の時間割 ---------------------------------------------------- */

/** たまごが自然に孵る時刻 */
const EGG_HATCH = 4;
/** ぽかぽか1回で孵化が早まる秒数 */
const EGG_WARM = 0.4;
/** どんなに温めてもこれより早くは孵らない */
const EGG_MIN = 2;
/** ぽかぽかが効く回数。4回目からは「そわそわ」揺れるだけ */
const EGG_TAPS = 3;
/** せいちょう①（こどもになる） */
const CHILD_AT = 16;
/** せいちょう②（おとなになる） */
const ADULT_AT = 32;
/** せいちょう③（おとしより）は寿命から逆算する。下手な人でも老後が12秒ある */
const ELDER_BEFORE = 12;
/** さいご（墓碑銘）に入るのは寿命の何秒前か */
const LAST_BEFORE = 3;
/** おとしよりになった瞬間にハートが足りていたら寿命が延びる */
const LONG_LIFE_HEARTS = 4;
const LONG_LIFE_BONUS = 4;
/** 墓碑銘の行が出る間隔 */
const EPITAPH_GAP = 0.7;

/* ---- なかよし度（ハート）と得点 -------------------------------------- */

const MAX_HEARTS = 5;
/** 初期ハートは2。×2で始まるので、初手から手応えが返る */
const START_HEARTS = 2;
/** 「すぐ来てくれた！」の境目（ふきだしの残り割合）。0.52秒以内 */
const R_FAST = 0.85;
/** 「ありがと」の境目。1.75秒以内 */
const R_OK = 0.5;
/** せいちょう1回ぶんの基礎点 */
const GROW_POINT = 5;
/** ガマンできたときの基礎点 */
const GAMAN_POINT = 2;

/* ---- つつきすぎ ------------------------------------------------------ */

/** つんつんの熱がここに達するとすねる */
const POKE_LIMIT = 3;
/** つんつんの熱が冷める速さ（毎秒） */
const POKE_COOL = 0.5;
/** 体が傾いている長さ */
const T_POKE = 0.25;

/* ---- ブロック状態の長さ（秒） ---------------------------------------- */

/** ぷんぷん（ねんねを起こした）。ここを長くすると、でたらめ操作が一生の大半を動けなくなる */
const T_GRUMPY = 1.2;
/** すねる（つつきすぎ） */
const T_SULK = 1.2;
/** ふらふら（わがままを甘やかした） */
const T_DIZZY = 1.2;
/** かぜひき（かぜを治せなかった） */
const T_SICK = 3;
/** あくび。ねんねの予告になる */
const T_YAWN = 0.8;
/** にこにこ顔 */
const T_HAPPY = 0.8;
/** しょんぼり顔 */
const T_SAD = 1;
/** ガマンできたときの「ぷいっ→にこっ」 */
const T_GAMAN = 0.6;
/** せいちょうの文字を読ませるための「間」。この間は要求もできごとも始めない */
const T_GROW_HOLD = 1.4;
/** ともだちが跳ねて帰っていく長さ */
const T_FRIEND_LEAVE = 0.5;
/** 応えた直後、この長さは二度押しを許す（ガサツな人のための猶予） */
const T_EHEHE = 0.5;
/** 生まれたてはこの長さ、何をされても嬉しい（つつきの熱を積まない） */
const T_NEWBORN = 2.5;
/** 起こされたあと、次のねんねまでが短くなる倍率（寝不足） */
const SHORT_SLEEP = 0.85;
/** できごとの予約を先送りできる限界。超えたら捨てる */
const EVENT_WAIT_MAX = 6;

/* ---- 画面の段（240×320） --------------------------------------------- */

/** 空の上端。ここより上は共通HUDと、こちらの状態表示の段 */
const SKY_TOP = 34;
/** 地面の上端 */
const GROUND_Y = 206;
/** 地面の厚み */
const GROUND_H = 44;
/** まめの立ち位置 */
const BEAN_X = 120;
const BEAN_Y = 180;
/** ふきだしの左上と大きさ */
const BUBBLE_X = 98;
const BUBBLE_Y = 100;
const BUBBLE_W = 44;
const BUBBLE_H = 36;
/** せいちょう・できごとの判定文字の段（ふきだしが無いときだけ使う） */
const TOP_JUDGE_Y = 120;
/** 要求・つんつん系の判定文字の段 */
const JUDGE_Y = 222;
/** ドット絵1マスの大きさ */
const DOT = 4;

/* ---- 型 -------------------------------------------------------------- */

type Stage = 'egg' | 'baby' | 'child' | 'adult' | 'elder' | 'last';
/** うまれつき。init の乱数で決まる（腕前では動かせない） */
type Nature = 'nonbiri' | 'yancha' | 'sabishi';
type Form =
  | 'mame'
  | 'poyo'
  | 'nora'
  | 'toge'
  | 'mofu'
  | 'hane'
  | 'natsuki'
  | 'nebosuke'
  | 'tabi'
  | 'iga'
  | 'kin';
type WantKind = 'gohan' | 'asobo' | 'nadete' | 'ofuro' | 'wagamama';
type EventKind = 'hoshi' | 'kaze' | 'tomodachi' | 'chou';

interface Want {
  kind: WantKind;
  /** 出てからの経過 */
  t: number;
  dur: number;
}

interface Ev {
  kind: EventKind;
  t: number;
  /** かぜのときだけ使う。叩いた回数 */
  taps: number;
  /** 老後のながれぼし（配点が大きい） */
  late: boolean;
}

/** できごとの予約。init で作って、時刻が来たら開始する */
interface Booking {
  kind: EventKind;
  at: number;
  late: boolean;
  done: boolean;
}

/** 浮く文字とハート。0.6秒で消える */
interface Float {
  x: number;
  y: number;
  vy: number;
  t: number;
  text: string;
  color: ColorKey;
  kind: 'text' | 'heart' | 'crack';
}

export interface IppunIsshoState extends BaseState, FeelState {
  /* 一生の骨格 */
  /** 寿命（秒）。ながいきで +4 される */
  lifespan: number;
  /** おとしよりになる時刻。ながいきで寿命が延びてもここは動かさない */
  elderAt: number;
  /** たまごが孵る時刻。ぽかぽかで早まる */
  hatchAt: number;
  stage: Stage;
  nature: Nature;
  /** きんのたまご。完璧に育てたときだけ金色になれる */
  gold: boolean;
  form: Form;
  /** おとしよりになったか（色が褪せる） */
  elder: boolean;

  /* なかよし度 */
  hearts: number;
  /** ハートが減った瞬間の点滅 */
  heartFlash: number;
  heartFlashLo: number;
  heartFlashHi: number;

  /* たまご期 */
  eggTaps: number;

  /* 要求 */
  want: Want | null;
  /** 次の要求までの残り */
  wantTimer: number;

  /* ねんね */
  /** 起きていられる残り時間 */
  sleepTimer: number;
  /** ねんね待ち。ここに入ったら新しい要求は出さない */
  sleepPending: boolean;
  yawn: number;
  sleep: number;

  /* ブロック状態 */
  grumpy: number;
  sulk: number;
  dizzy: number;
  sick: number;
  happy: number;
  sad: number;
  poke: number;
  pokeHeat: number;
  gamanAnim: number;

  /* できごと */
  events: Booking[];
  event: Ev | null;
  /** ともだちが跳ねて帰っていく残り時間。絵だけの値で、入力にも得点にも効かない */
  friendLeave: number;

  /* 演出 */
  night: number;
  evoFlash: number;
  evoAt: number;
  /** せいちょう直後の「間」。この間は新しい要求もできごとも始めない */
  growHold: number;
  topText: string;
  topColor: ColorKey;
  topTimer: number;
  judgeText: string;
  judgeColor: ColorKey;
  judgeTimer: number;
  floats: Float[];
  overT: number;

  /* 統計（フラットなスカラーだけ持つ） */
  care: number;
  wild: number;
  rough: number;
  /** こども期（16〜32秒）だけの数え直し。おとなの分岐がここで決まる */
  care2: number;
  rough2: number;
  wished: boolean;
  caughtCold: boolean;
  cured: boolean;
  friend: boolean;
  butterfly: boolean;

  /* さいご */
  epShown: number;
  epTimer: number;
}

/* ---- 一生の計算 ------------------------------------------------------ */

function stageAt(t: number, hatchAt: number, elderAt: number, lifespan: number): Stage {
  if (t < hatchAt) return 'egg';
  if (t >= lifespan - LAST_BEFORE) return 'last';
  if (t >= elderAt) return 'elder';
  if (t >= ADULT_AT) return 'adult';
  if (t >= CHILD_AT) return 'child';
  return 'baby';
}

const STAGE_LABEL: Record<Stage, string> = {
  egg: 'たまご',
  baby: 'あかちゃん',
  child: 'こども',
  adult: 'おとな',
  elder: 'おとしより',
  last: 'さいご',
};

const FORM_LABEL: Record<Form, string> = {
  mame: 'まめ',
  poyo: 'ぽよまめ',
  nora: 'のらまめ',
  toge: 'とげまめ',
  mofu: 'もふまめ',
  hane: 'はねまめ',
  natsuki: 'なつきまめ',
  nebosuke: 'ねぼすけまめ',
  tabi: 'たびまめ',
  iga: 'いがまめ',
  kin: 'きんまめ',
};

/**
 * 年齢。区分ごとに進み方が違う（子ども時代はゆっくり、大人は早い）。
 * 最期は 84〜100さいに収まる。
 */
function ageAt(t: number, elderAt: number, lifespan: number): number {
  // 表示は floor するので、割り算の誤差で1つ手前の年齢に見えないよう下駄を履かせる
  const eps = 1e-6;
  const end = 88 + 2 * (lifespan - 60);
  const pts: [number, number][] = [
    [4, 0],
    [CHILD_AT, 6],
    [ADULT_AT, 18],
    [elderAt, 65],
    [lifespan, end],
  ];
  if (t <= pts[0][0]) return 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, a0] = pts[i];
    const [t1, a1] = pts[i + 1];
    if (t <= t1) return a0 + ((a1 - a0) * (t - t0)) / Math.max(0.001, t1 - t0) + eps;
  }
  return end;
}

/** 起きていられる長さ。あかちゃんとおとしよりは短い（昼寝が多い） */
function awakeDur(stage: Stage, rng: Rng): number {
  if (stage === 'baby') return rng.range(5, 6.5);
  if (stage === 'child') return rng.range(9, 12);
  if (stage === 'elder') return rng.range(6, 8);
  return rng.range(12, 15);
}

/** ねんねの長さ */
function napDur(stage: Stage): number {
  return stage === 'baby' ? 2 : stage === 'elder' ? 2.8 : 2.2;
}

/** 次の要求までの間隔。難度ではなく**リズム**を段階で変える */
function wantGap(stage: Stage, rng: Rng): number {
  const base =
    stage === 'baby'
      ? rng.range(2, 3)
      : stage === 'child'
        ? rng.range(2.4, 3.4)
        : stage === 'elder'
          ? rng.range(3.4, 4.6)
          : rng.range(2.8, 4);
  return base * TUNE.wantGap;
}

const WANT_KINDS: WantKind[] = ['gohan', 'asobo', 'nadete', 'ofuro', 'wagamama'];

/** 要求の重み。段階ごとに求めるものが変わる */
function wantWeights(stage: Stage, time: number): number[] {
  if (stage === 'baby') return [45, 10, 45, 0, 0];
  // こども期のわがままは20秒から。最初の分岐（16秒）までは素直に世話させる
  if (stage === 'child') return [25, 40, 15, 10, time >= 20 ? 10 : 0];
  if (stage === 'elder') return [30, 10, 45, 5, 10];
  return [25, 25, 20, 15, 15];
}

function pickWant(stage: Stage, time: number, rng: Rng): WantKind {
  const w = wantWeights(stage, time);
  let total = 0;
  for (const v of w) total += v;
  let r = rng() * total;
  for (let i = 0; i < WANT_KINDS.length; i++) {
    r -= w[i];
    if (r < 0) return WANT_KINDS[i];
  }
  return 'gohan';
}

/** できごとの見せ場の長さ */
const EV_DUR: Record<EventKind, number> = { hoshi: 1.4, kaze: 3, tomodachi: 3, chou: 2.5 };
/** かぜを治すのに必要な回数 */
const KAZE_TAPS = 4;
/** ながれぼしを「ねがいごと」にできる速さ（出てから何秒以内か） */
const HOSHI_FAST = 0.6;

/**
 * できごとの基礎点（どれも倍率が掛かる）。
 * 老後のながれぼしだけ桁を上げてあり、これが上振れの主役②になっている。
 */
const EV_POINT = {
  /** ながれぼし・0.6秒以内 */
  hoshiFast: 12,
  /** ながれぼし・それ以降 */
  hoshiSlow: 6,
  /** 老後のながれぼし・0.6秒以内 */
  hoshiEldFast: 20,
  /** 老後のながれぼし・それ以降 */
  hoshiEldSlow: 10,
  /** かぜを4回で治した */
  kaze: 6,
  /** ともだちと あそんだ */
  tomodachi: 8,
  /** ちょうちょを つかまえた */
  chou: 4,
};

/** 要求に応えたときの基礎点。すぐ／ふつう／ぎりぎり の3段階 */
const WANT_POINT = [3, 2, 1];
/** 孵化のごほうび。まだハートが意味を持つ前なので倍率は掛けない */
const HATCH_POINT = 2;
/** ぽかぽか1回。同上 */
const WARM_POINT = 1;
/** かぜをさすった1回ぶん。刻みの手応えなので倍率は掛けない */
const STROKE_POINT = 1;

/* ---- 得点 ------------------------------------------------------------ */

/**
 * 倍率。**加点前のハート**で計算する。
 * きんまめだけ、以後の得点が1.5倍（切り上げ）になる。
 */
function multOf(hearts: number): number {
  return 1 + Math.floor(hearts / 2);
}

function gainOf(s: IppunIsshoState, base: number): number {
  const g = base * multOf(s.hearts);
  return s.form === 'kin' ? Math.ceil(g * 1.5) : g;
}

/* ---- state を書き換える小さな道具（すべて新しい state に対して使う） -- */

function say(n: IppunIsshoState, text: string, color: ColorKey, dur = 0.75): void {
  n.judgeText = text;
  n.judgeColor = color;
  n.judgeTimer = dur;
}

function sayTop(n: IppunIsshoState, text: string, color: ColorKey, dur = 1.2): void {
  n.topText = text;
  n.topColor = color;
  n.topTimer = dur;
}

function pushFloat(n: IppunIsshoState, f: Float): void {
  const arr = n.floats.length >= 10 ? n.floats.slice(1) : n.floats;
  n.floats = [...arr, f];
}

/** 数字がまめの脇から上へ飛ぶ。加点はすべてこの見た目で出す */
function floatPoint(n: IppunIsshoState, points: number): void {
  pushFloat(n, {
    x: BEAN_X + 42,
    y: BEAN_Y - 12,
    vy: -47,
    t: 0.6,
    text: `+${points}`,
    color: 'good',
    kind: 'text',
  });
}

/** 倍率つきの加点。要求・できごと・せいちょうはこちら */
function addScore(n: IppunIsshoState, base: number): number {
  const g = gainOf(n, base);
  n.score += g;
  floatPoint(n, g);
  return g;
}

/**
 * 倍率を掛けない加点。
 *
 * たまご期（ぽかぽか・孵化）は、まだハートが意味を持つ前なので倍率の対象にしない。
 * かぜの「さすさす」は手応えの刻みで、ごほうびは治った瞬間にまとめて渡す。
 * どちらも見た目は倍率つきの加点と同じにして、遊ぶ側が仕組みを2つ覚えなくていいようにする。
 */
function addPlain(n: IppunIsshoState, points: number): void {
  n.score += points;
  floatPoint(n, points);
}

function gainHeart(n: IppunIsshoState): void {
  if (n.hearts >= MAX_HEARTS) return;
  n.hearts += 1;
  pushFloat(n, {
    x: BEAN_X - 22,
    y: BEAN_Y - 10,
    vy: -62,
    t: 0.6,
    text: '',
    color: 'accent2',
    kind: 'heart',
  });
}

/** ハートが減ったことを見せる。上の列を点滅させ、割れたハートを胸から落とす */
function loseHearts(n: IppunIsshoState, k: number): void {
  const before = n.hearts;
  n.hearts = Math.max(0, before - k);
  if (n.hearts === before) return;
  n.heartFlash = 0.5;
  n.heartFlashLo = n.hearts;
  n.heartFlashHi = before;
  pushFloat(n, {
    x: BEAN_X,
    y: BEAN_Y + 20,
    vy: 52,
    t: 0.6,
    text: '',
    color: 'accent2',
    kind: 'crack',
  });
}

/**
 * 手が空いている（要求もできごとも出ておらず、どの状態にも入っていない）。
 * ねんね待ちはここに含めない。「出ている要求が片づくのを待ってから眠くなる」ため
 */
function isFree(s: IppunIsshoState): boolean {
  return (
    s.sleep <= 0 &&
    s.yawn <= 0 &&
    s.grumpy <= 0 &&
    s.sulk <= 0 &&
    s.dizzy <= 0 &&
    s.sick <= 0 &&
    s.want === null &&
    s.event === null &&
    s.stage !== 'egg' &&
    s.stage !== 'last'
  );
}

/** 起きていて、何も起きていない（要求・できごとを出してよい） */
function isIdle(s: IppunIsshoState): boolean {
  return isFree(s) && !s.sleepPending && s.growHold <= 0;
}

/** 16秒: こどもの姿は「育ち」で決まる */
function childForm(s: IppunIsshoState): Form {
  if (s.rough >= 2 && s.rough >= s.wild) return 'toge';
  if (s.wild > s.care) return 'nora';
  return 'poyo';
}

/**
 * 32秒: おとなの姿。
 * よく世話されたら「うまれつき」が出て、雑なら「育ち」（こどもの姿）が出る。
 */
function adultForm(s: IppunIsshoState): Form {
  if (s.gold && s.rough === 0 && s.wild <= 1) return 'kin';
  if (s.care2 >= 3 && s.rough2 === 0) {
    return s.nature === 'nonbiri' ? 'mofu' : s.nature === 'yancha' ? 'hane' : 'natsuki';
  }
  return s.form === 'poyo' ? 'nebosuke' : s.form === 'nora' ? 'tabi' : 'iga';
}

/** せいちょうの瞬間。光って、きらきらして、名前が出る */
function growTo(n: IppunIsshoState, form: Form, t: number, rng: Rng, label: string): void {
  n.form = form;
  n.evoFlash = 0.12;
  n.evoAt = t;
  // 「◯◯に なった！」はふきだしが出ていないときだけ描かれる。
  // 直後に要求やできごとが始まると、一生でいちばん見せたい文字が一瞬で消えるので間を空ける
  n.growHold = T_GROW_HOLD;
  addPop(n);
  hitStop(n, 0.08);
  sayTop(n, label, 'accent', 1.4);
  addScore(n, GROW_POINT);
  // せいちょうは一生でいちばん見せたい瞬間なので、寝ていたら目を覚ます
  if (n.sleep > 0 || n.yawn > 0) {
    n.sleep = 0;
    n.yawn = 0;
    n.sleepPending = false;
    n.sleepTimer = awakeDur(n.stage, rng);
  }
}

/* ---- ドット絵 -------------------------------------------------------- */

/** たまご。柄でうまれつきが分かる */
const EGG_PLAIN = [
  '....XXXX....',
  '...XXXXXX...',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  '.XXXXXXXXXX.',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  '.XXXXXXXXXX.',
  '..XXXXXXXX..',
  '...XXXXXX...',
];
/** しましま＝やんちゃ */
const EGG_STRIPE = [
  '....XXXX....',
  '...XXXXXX...',
  '..YYYYYYYY..',
  '.XXXXXXXXXX.',
  '.YYYYYYYYYY.',
  'XXXXXXXXXXXX',
  'YYYYYYYYYYYY',
  'XXXXXXXXXXXX',
  'YYYYYYYYYYYY',
  '.XXXXXXXXXX.',
  '..YYYYYYYY..',
  '...XXXXXX...',
];
/** みずたま＝さびしがり */
const EGG_DOT = [
  '....XXXX....',
  '...XXYYXX...',
  '..XXXXXXXX..',
  '.XYYXXXXYYX.',
  '.XYYXXXXYYX.',
  'XXXXXYYXXXXX',
  'XXXXXYYXXXXX',
  'XYYXXXXXXYYX',
  'XYYXXXXXXYYX',
  '.XXXXXXXXXX.',
  '..XXYYXXXX..',
  '...XXXXXX...',
];

/** あかちゃん。ひとまわり小さい */
const B_MAME = [
  '............',
  '............',
  '....XXXX....',
  '...XXXXXX...',
  '..XXXXXXXX..',
  '..XXXXXXXX..',
  '..XXXXXXXX..',
  '..XXXXXXXX..',
  '...XXXXXX...',
  '....XXXX....',
  '....X..X....',
  '............',
];

/** ぽよまめ。ふつうに愛されて、まるい */
const B_POYO = [
  '....XXXX....',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  '.XXXXXXXXXX.',
  '..XXXXXXXX..',
  '...X....X...',
];

/** のらまめ。ほっとかれて自由に。色がくすみ、葉っぱを乗せ、傷がある */
const B_NORA = [
  '.....LL.....',
  '....XXXX....',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XCXXXXXXXXXX',
  '.XCXXXXXXXX.',
  '..XXXXXXXX..',
  '...X....X...',
];

/** とげまめ。起こされ、つつかれて、頭にとげが3本 */
const B_TOGE = [
  '.S...S...S..',
  'SSS.SSS.SSS.',
  '.XXXXXXXXXX.',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  '.XXXXXXXXXX.',
  '..XXXXXXXX..',
  '...X....X...',
];

/** もふまめ。のんびりのうまれつきが出た姿。ひとまわり大きくふち毛 */
const B_MOFU = [
  '.F.FFFFFF.F.',
  'FFXXXXXXXXFF',
  '.FXXXXXXXXF.',
  'FFXXXXXXXXFF',
  '.FXXXXXXXXF.',
  'FFXXXXXXXXFF',
  '.FXXXXXXXXF.',
  'FFXXXXXXXXFF',
  '.FXXXXXXXXF.',
  'FFXXXXXXXXFF',
  '.F.FFFFFF.F.',
  '...X....X...',
];

/** はねまめ。やんちゃのうまれつきが出た姿 */
const B_HANE = [
  '....XXXX....',
  '..XXXXXXXX..',
  'W.XXXXXXXX.W',
  'WWXXXXXXXXWW',
  'WWXXXXXXXXWW',
  'WWXXXXXXXXWW',
  'W.XXXXXXXX.W',
  '..XXXXXXXX..',
  '..XXXXXXXX..',
  '..XXXXXXXX..',
  '...XXXXXX...',
  '...X....X...',
];

/** なつきまめ。さびしがりのうまれつきが出た姿。胸にハート */
const B_NATSUKI = [
  '....XXXX....',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXHXHXXXXX',
  '.XXHHHHHXXX.',
  '..XXHHHXXX..',
  '...X....X...',
];

/** ねぼすけまめ。こども期が雑だった「ぽよ」の行き先。寝ぐせがある */
const B_NEBOSUKE = [
  '....XXXX.X..',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  '.XXXXXXXXXX.',
  '..XXXXXXXX..',
  '...X....X...',
];

/** たびまめ。放置の行き先。帽子と首巻き */
const B_TABI = [
  '...BBBBBB...',
  'BBBBBBBBBBBB',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'MMMMMMMMMMMM',
  '.XXXXXXXXXX.',
  '..XXXXXXXX..',
  '...X....X...',
];

/** いがまめ。でたらめ連打の行き先。全身とげ */
const B_IGA = [
  '...S.SS.S...',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  'SXXXXXXXXXXS',
  '.XXXXXXXXXX.',
  'SXXXXXXXXXXS',
  '.XXXXXXXXXX.',
  'SXXXXXXXXXXS',
  '.XXXXXXXXXX.',
  '.XXXXXXXXXX.',
  '..XXXXXXXX..',
  '...X....X...',
];

/** きんまめ。きんのたまごを完璧に育てたときだけ */
const B_KIN = B_POYO;

const FORM_BODY: Record<Form, readonly string[]> = {
  mame: B_MAME,
  poyo: B_POYO,
  nora: B_NORA,
  toge: B_TOGE,
  mofu: B_MOFU,
  hane: B_HANE,
  natsuki: B_NATSUKI,
  nebosuke: B_NEBOSUKE,
  tabi: B_TABI,
  iga: B_IGA,
  kin: B_KIN,
};

const FORM_COLORS: Record<Form, Record<string, ColorKey>> = {
  mame: { X: 'ink' },
  poyo: { X: 'ink' },
  nora: { X: 'dim', L: 'good', C: 'line' },
  toge: { X: 'ink', S: 'dim' },
  mofu: { X: 'ink', F: 'dim' },
  hane: { X: 'ink', W: 'cool' },
  natsuki: { X: 'ink', H: 'accent2' },
  nebosuke: { X: 'ink' },
  tabi: { X: 'ink', B: 'accent2', M: 'cool' },
  iga: { X: 'ink', S: 'dim' },
  kin: { X: 'accent' },
};

/** おとしよりの色の写像。ink→dim、dim→line で全体が褪せる */
function agedColors(base: Record<string, ColorKey>): Record<string, ColorKey> {
  const out: Record<string, ColorKey> = {};
  for (const k of Object.keys(base)) {
    const c = base[k];
    out[k] = c === 'ink' ? 'dim' : c === 'dim' ? 'line' : c;
  }
  return out;
}

/** ともだち。耳が三角で、色がちがう */
const B_FRIEND = [
  '..X......X..',
  '..XX....XX..',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  '.XXXXXXXXXX.',
  '.XXXXXXXXXX.',
  '..XXXXXXXX..',
  '...X....X...',
];

const HEART = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'];
const HEART_L = ['.X', 'XX', 'XX', '.X', '..'];
const HEART_R = ['X.', 'XX', 'XX', 'X.', '..'];

/** 顔の位置。あかちゃんだけ体が小さいので寄せる */
function faceOf(form: Form): { dx: number; dy: number; mouth: number } {
  if (form === 'mame') return { dx: 6, dy: -5, mouth: 5 };
  if (form === 'tabi') return { dx: 8, dy: -2, mouth: 8 };
  // なつきまめは胸にハートがあるので、口を上げてぶつからないようにする
  if (form === 'natsuki') return { dx: 8, dy: -8, mouth: 2 };
  return { dx: 8, dy: -6, mouth: 6 };
}

type Mood =
  | 'futsu'
  | 'niko'
  | 'shon'
  | 'nemu'
  | 'akubi'
  | 'pun'
  | 'fura'
  | 'kaze'
  | 'pui'
  | 'toji'
  | 'nebo';

/** いまの気分。顔はここから毎フレーム決める（形態×表情を個別に描かない） */
function moodOf(s: IppunIsshoState): Mood {
  if (s.over || s.stage === 'last') return 'toji';
  if (s.sleep > 0) return 'nemu';
  // ガマンできたときは「ぷいっ」と顔をそむけてから、にこっとする
  if (s.gamanAnim > T_GAMAN * 0.45) return 'pui';
  if (s.gamanAnim > 0) return 'niko';
  if (s.yawn > 0) return 'akubi';
  if (s.grumpy > 0) return 'pun';
  if (s.sulk > 0) return 'pui';
  if (s.dizzy > 0) return 'fura';
  if (s.sick > 0) return 'kaze';
  if (s.happy > 0) return 'niko';
  if (s.sad > 0) return 'shon';
  if (s.form === 'nebosuke') return 'nebo';
  return 'futsu';
}

/* ---- 墓碑銘 ---------------------------------------------------------- */

function epitaph(s: IppunIsshoState): string[] {
  const age = Math.floor(ageAt(s.lifespan, s.elderAt, s.lifespan));
  const deed = s.wished
    ? 'ながれぼしに ねがい、'
    : s.cured
      ? 'かぜを なおして、'
      : s.caughtCold
        ? 'かぜを こじらせ、'
        : s.friend
          ? 'ともだちと あそび、'
          : s.butterfly
            ? 'ちょうちょを おいかけ、'
            : 'しずかな まいにちで、';
  const life =
    s.form === 'kin'
      ? 'きんいろに かがやき、'
      : s.rough >= 4
        ? 'よく おこされながらも、'
        : s.wild >= 8
          ? 'じゆうに いきて、'
          : s.hearts >= 4
            ? 'たくさん あいされて、'
            : 'のんびり くらして、';
  return [`${FORM_LABEL[s.form]}は、`, deed, life, `${age}さいで たねに なりました`];
}

/* ====================================================================== */

export default defineGame<IppunIsshoState>({
  meta,

  init(rng) {
    const lifespan = TUNE.lifespan + rng.range(-2, 2);
    const nature: Nature = rng.pick<Nature>(['nonbiri', 'yancha', 'sabishi']);
    const gold = rng.chance(0.3);

    // できごとは4種から2つ（重複なし）。1つ目は 18〜30秒、2つ目は 34〜L−14秒
    const kinds: EventKind[] = ['hoshi', 'kaze', 'tomodachi', 'chou'];
    const i1 = rng.int(kinds.length);
    const rest = kinds.filter((_, i) => i !== i1);
    const i2 = rng.int(rest.length);
    const events: Booking[] = [
      { kind: kinds[i1], at: rng.range(18, 30), late: false, done: false },
      { kind: rest[i2], at: rng.range(34, lifespan - 14), late: false, done: false },
    ];
    // 20%で老後にもう一度ながれぼし。出る一生と出ない一生がある＝上振れの主役
    if (rng.chance(0.2)) {
      events.push({
        kind: 'hoshi',
        at: rng.range(lifespan - 10, lifespan - 5),
        late: true,
        done: false,
      });
    }

    return {
      ...createFeel(),
      score: 0,
      over: false,
      time: 0,

      lifespan,
      elderAt: lifespan - ELDER_BEFORE,
      hatchAt: EGG_HATCH,
      stage: 'egg',
      nature,
      gold,
      form: 'mame',
      elder: false,

      hearts: START_HEARTS,
      heartFlash: 0,
      heartFlashLo: 0,
      heartFlashHi: 0,

      eggTaps: 0,

      want: null,
      wantTimer: 1,

      sleepTimer: 5,
      sleepPending: false,
      yawn: 0,
      sleep: 0,

      grumpy: 0,
      sulk: 0,
      dizzy: 0,
      sick: 0,
      happy: 0,
      sad: 0,
      poke: 0,
      pokeHeat: 0,
      gamanAnim: 0,

      events,
      event: null,
      friendLeave: 0,

      night: 0,
      evoFlash: 0,
      evoAt: -9,
      growHold: 0,
      topText: '',
      topColor: 'accent',
      topTimer: 0,
      judgeText: '',
      judgeColor: 'good',
      judgeTimer: 0,
      floats: [],
      overT: 0,

      care: 0,
      wild: 0,
      rough: 0,
      care2: 0,
      rough2: 0,
      wished: false,
      caughtCold: false,
      cured: false,
      friend: false,
      butterfly: false,

      epShown: 0,
      epTimer: 0,
    };
  },

  step(s, input, dt, rng) {
    // たねになったあと。共通シェルの余韻（0.85秒）のあいだ、最期の絵だけを進める
    if (s.over) {
      const n: IppunIsshoState = { ...s };
      feelTick(n, input, dt);
      n.overT = s.overT + dt;
      // 芽がぽんと出る瞬間だけ弾ませる
      if (s.overT < 0.55 && n.overT >= 0.55) addPop(n);
      n.floats = s.floats
        .map((f) => ({ ...f, t: f.t - dt, y: f.y + f.vy * dt }))
        .filter((f) => f.t > 0);
      return n;
    }

    const n: IppunIsshoState = { ...s };
    // せいちょうの瞬間だけ世界を止める。ここは主人公を動かし続ける遊びではないので効く
    if (!feelTick(n, input, dt)) return n;

    /** このフレームが終わったときの時刻。段階の境目はこれで見る */
    const t1 = s.time + dt;

    /* 1) 演出とブロック状態のタイマー */
    n.judgeTimer = Math.max(0, s.judgeTimer - dt);
    n.topTimer = Math.max(0, s.topTimer - dt);
    n.happy = Math.max(0, s.happy - dt);
    n.sad = Math.max(0, s.sad - dt);
    n.grumpy = Math.max(0, s.grumpy - dt);
    n.sulk = Math.max(0, s.sulk - dt);
    n.dizzy = Math.max(0, s.dizzy - dt);
    n.sick = Math.max(0, s.sick - dt);
    n.poke = Math.max(0, s.poke - dt);
    n.gamanAnim = Math.max(0, s.gamanAnim - dt);
    n.evoFlash = Math.max(0, s.evoFlash - dt);
    n.heartFlash = Math.max(0, s.heartFlash - dt);
    n.growHold = Math.max(0, s.growHold - dt);
    n.friendLeave = Math.max(0, s.friendLeave - dt);
    n.pokeHeat = Math.max(0, s.pokeHeat - dt * POKE_COOL);
    // 起きているあいだだけ減る。ここで先に引いておくと、孵化やせいちょうで
    // 入れ直した値からこのフレームぶんを二重に引かずに済む
    if (s.sleep <= 0 && s.yawn <= 0) n.sleepTimer = Math.max(0, s.sleepTimer - dt);
    n.floats = s.floats
      .map((f) => ({ ...f, t: f.t - dt, y: f.y + f.vy * dt }))
      .filter((f) => f.t > 0);

    /* 2) 段階。境目をまたいだフレームで「せいちょう」する */
    const st = stageAt(t1, n.hatchAt, n.elderAt, n.lifespan);
    if (st !== s.stage) {
      n.stage = st;
      if (st === 'baby') {
        // 孵化。うまれつきはもう決まっている（たまごの柄で見えていた）
        sayTop(n, 'うまれた！', 'good', 1.2);
        addPop(n);
        addPlain(n, HATCH_POINT);
        n.wantTimer = 1;
        // 最初の昼寝は9秒前後に置く（最初の10秒で1回は失敗させるため）。
        // ぽかぽかで早く孵っても、ここが前にずれないように孵化時刻から逆算する
        n.sleepTimer = Math.max(2.5, rng.range(8.7, 9.5) - t1);
      } else if (st === 'child') {
        growTo(n, childForm(n), t1, rng, `${FORM_LABEL[childForm(n)]}に なった！`);
      } else if (st === 'adult') {
        growTo(n, adultForm(n), t1, rng, `${FORM_LABEL[adultForm(n)]}に なった！`);
      } else if (st === 'elder') {
        n.elder = true;
        // ながいき。よく世話された子は長く生きて、そのぶん点を渡す機会が増える
        if (n.hearts >= LONG_LIFE_HEARTS) n.lifespan = s.lifespan + LONG_LIFE_BONUS;
        growTo(n, n.form, t1, rng, 'おとしよりに なった');
      } else if (st === 'last') {
        // さいご。要求もできごともねんねも止める。未消化の予約は捨てる
        n.want = null;
        n.event = null;
        n.sleep = 0;
        n.yawn = 0;
        n.sleepPending = false;
        n.events = s.events.map((b) => ({ ...b, done: true }));
        n.epShown = 0;
        n.epTimer = 0;
      }
    }

    /* 3) 昼夜。ねんねとさいごで夜になる */
    const nightTarget = n.sleep > 0 || st === 'last' ? 1 : 0;
    n.night = n.night + Math.max(-2 * dt, Math.min(2 * dt, nightTarget - n.night));

    /* 4) たまご期。叩くほど早く孵る */
    if (st === 'egg') {
      if (takeTap(n)) {
        if (n.eggTaps < EGG_TAPS) {
          n.eggTaps = s.eggTaps + 1;
          n.hatchAt = Math.max(EGG_MIN, s.hatchAt - EGG_WARM);
          addPlain(n, WARM_POINT);
          say(n, 'ぽかぽか', 'good');
          addPop(n);
        } else {
          // 4回目以降も無反応にはしない。たまごがそわそわ揺れる
          say(n, 'そわそわ', 'dim', 0.6);
          n.poke = T_POKE;
        }
      }
      return n;
    }

    /* 5) さいご。墓碑銘を1行ずつ出す。タップで次の行を即出し */
    if (st === 'last') {
      n.epTimer = Math.max(0, n.epTimer - dt);
      if (n.epShown < 4 && n.epTimer <= 0) {
        n.epShown += 1;
        n.epTimer = EPITAPH_GAP;
      }
      if (takeTap(n)) {
        if (n.epShown < 4) {
          // 出し切る前に終わりへは飛ばない（誤タップで墓碑銘を失わない）
          n.epShown += 1;
          n.epTimer = EPITAPH_GAP;
        } else {
          n.over = true;
        }
      }
      if (t1 >= n.lifespan) n.over = true;
      return n;
    }

    /* 6) ねんね。あくびが予告になる */
    if (n.sleep > 0) {
      n.sleep = Math.max(0, s.sleep - dt);
      if (n.sleep <= 0) {
        say(n, 'おはよ', 'dim', 0.6);
        n.sleepTimer = awakeDur(st, rng);
        n.wantTimer = wantGap(st, rng);
      }
    } else if (n.yawn > 0) {
      n.yawn = Math.max(0, s.yawn - dt);
      if (n.yawn <= 0) n.sleep = napDur(st);
    } else if (n.sleepTimer <= 0) {
      n.sleepPending = true;
    }

    /* 7) できごとの進行と、ほっといたときの判定 */
    if (n.event) {
      const ev: Ev = { ...n.event, t: n.event.t + dt };
      n.event = ev;
      if (ev.t >= EV_DUR[ev.kind]) {
        n.event = null;
        if (ev.kind === 'hoshi') {
          sayTop(n, 'みのがした', 'dim', 1);
        } else if (ev.kind === 'kaze') {
          sayTop(n, 'かぜを ひいた', 'bad', 1.2);
          n.sick = T_SICK;
          n.caughtCold = true;
          n.wild += 1;
        } else if (ev.kind === 'tomodachi') {
          sayTop(n, 'かえっちゃった', 'dim', 1);
          n.wild += 1;
        } else {
          sayTop(n, 'とんでいった', 'dim', 1);
        }
      }
    }

    /* 8) 要求の期限切れ。ほっとくのは失敗、わがままはガマン成功 */
    if (n.want) {
      const wt: Want = { ...n.want, t: n.want.t + dt };
      n.want = wt;
      if (wt.t >= wt.dur) {
        n.want = null;
        if (wt.kind === 'wagamama') {
          // 満ちるまで待てた＝ガマンできた。まめが「ぷいっ」としてから、にこっとする
          addScore(n, GAMAN_POINT);
          say(n, 'ガマンできた', 'good', 1);
          gainHeart(n);
          n.care += 1;
          if (st === 'child') n.care2 += 1;
          n.gamanAnim = T_GAMAN;
          addPop(n);
        } else {
          say(n, 'まってたのに…', 'bad', 1);
          loseHearts(n, 1);
          n.wild += 1;
          n.sad = T_SAD;
        }
        n.wantTimer = wantGap(st, rng);
      }
    }

    /* 9) ねんね待ち → あくび。要求が片づくのを待ってから眠くなる */
    if (n.sleepPending && isFree(n)) {
      n.sleepPending = false;
      n.yawn = T_YAWN;
      // あくびがねんねの予告。声にも出しておかないと「急に寝た」に見える
      say(n, 'ふぁ〜', 'dim', T_YAWN);
    }

    /* 10) できごとの出現。先送りは6秒まで、超えたら捨てる（本人のせいではない） */
    if (!n.event && isIdle(n)) {
      for (let i = 0; i < n.events.length; i++) {
        const b = n.events[i];
        if (b.done || t1 < b.at) continue;
        n.events = n.events.map((x, j) => (j === i ? { ...x, done: true } : x));
        n.event = { kind: b.kind, t: 0, taps: 0, late: b.late };
        sayTop(
          n,
          b.kind === 'hoshi'
            ? 'ながれぼし！'
            : b.kind === 'kaze'
              ? 'ハクション'
              : b.kind === 'tomodachi'
                ? 'あそぼ？'
                : 'ちょうちょ',
          b.kind === 'kaze' ? 'bad' : 'cool',
          1,
        );
        break;
      }
    }
    n.events = n.events.map((b) =>
      !b.done && t1 > b.at + EVENT_WAIT_MAX ? { ...b, done: true } : b,
    );

    /* 11) 要求の出現。ふきだしが出たらタップ、それだけ */
    if (isIdle(n)) {
      n.wantTimer = Math.max(0, n.wantTimer - dt);
      if (n.wantTimer <= 0) {
        n.want = { kind: pickWant(st, t1, rng), t: 0, dur: TUNE.wantDur };
      }
    }

    /* 12) 入力。どの状態で押しても、必ず何かが返る */
    if (takeTap(n)) {
      if (n.sleep > 0) {
        // 起こしてしまった。罰は時間ではなくハートで払わせる
        n.sleep = 0;
        n.grumpy = T_GRUMPY;
        // 寝不足はここ1回きり。次のねんねまでが短くなる（フラグで持ち越すと二重に効く）
        n.sleepTimer = awakeDur(st, rng) * SHORT_SLEEP;
        n.wantTimer = wantGap(st, rng);
        loseHearts(n, 2);
        n.rough += 1;
        if (st === 'child') n.rough2 += 1;
        addShake(n, 0.5);
        say(n, 'おこしちゃった！', 'bad', 1.1);
      } else if (n.yawn > 0) {
        say(n, 'ねむいの…', 'dim', 0.6);
      } else if (n.grumpy > 0) {
        say(n, 'ぷんぷん', 'bad', 0.6);
      } else if (n.sulk > 0) {
        say(n, 'ぷい', 'dim', 0.6);
      } else if (n.dizzy > 0) {
        say(n, 'ふらふら…', 'accent2', 0.6);
      } else if (n.sick > 0) {
        // さすってあげただけ。罰も点も無い
        say(n, 'さすさす', 'cool', 0.6);
      } else if (n.event) {
        const ev = n.event;
        if (ev.kind === 'hoshi') {
          const fast = ev.t <= HOSHI_FAST;
          const base = ev.late
            ? fast
              ? EV_POINT.hoshiEldFast
              : EV_POINT.hoshiEldSlow
            : fast
              ? EV_POINT.hoshiFast
              : EV_POINT.hoshiSlow;
          addScore(n, base);
          sayTop(n, fast ? 'ねがいごと！' : 'とどいた', 'accent', 1.2);
          n.wished = true;
          n.event = null;
          addPop(n);
          n.happy = T_HAPPY;
        } else if (ev.kind === 'kaze') {
          const taps = ev.taps + 1;
          if (taps >= KAZE_TAPS) {
            addScore(n, EV_POINT.kaze);
            sayTop(n, 'なおった！', 'good', 1.2);
            n.cured = true;
            n.care += 2;
            if (st === 'child') n.care2 += 2;
            n.event = null;
            n.happy = T_HAPPY;
            addPop(n);
          } else {
            n.event = { ...ev, taps };
            addPlain(n, STROKE_POINT);
            say(n, 'さすさす', 'cool', 0.5);
          }
        } else if (ev.kind === 'tomodachi') {
          addScore(n, EV_POINT.tomodachi);
          sayTop(n, 'いっしょに あそんだ', 'good', 1.2);
          n.friend = true;
          n.event = null;
          // 消えるのではなく、跳ねて帰っていく（絵だけの値。入力にも得点にも効かない）
          n.friendLeave = T_FRIEND_LEAVE;
          n.happy = T_HAPPY;
          addPop(n);
        } else {
          addScore(n, EV_POINT.chou);
          sayTop(n, 'つかまえた！', 'good', 1.2);
          n.butterfly = true;
          n.event = null;
          n.happy = T_HAPPY;
          addPop(n);
        }
      } else if (n.want) {
        const wt = n.want;
        if (wt.kind === 'wagamama') {
          // 赤いふきだしに応える＝甘やかし。得点は無し
          say(n, 'あまやかした！', 'bad', 1.1);
          loseHearts(n, 1);
          n.rough += 1;
          if (st === 'child') n.rough2 += 1;
          n.dizzy = T_DIZZY;
          n.want = null;
          n.wantTimer = wantGap(st, rng);
        } else {
          const r = 1 - wt.t / wt.dur;
          const fast = r >= R_FAST;
          const base = fast ? WANT_POINT[0] : r >= R_OK ? WANT_POINT[1] : WANT_POINT[2];
          addScore(n, base);
          say(n, fast ? 'すぐ来てくれた！' : r >= R_OK ? 'ありがと' : 'まにあった', 'good', 0.9);
          gainHeart(n);
          n.care += fast ? 2 : 1;
          if (st === 'child') n.care2 += fast ? 2 : 1;
          n.happy = T_HAPPY;
          n.want = null;
          n.wantTimer = wantGap(st, rng);
          addPop(n);
        }
      } else if (t1 - n.hatchAt <= T_NEWBORN || n.happy > T_HAPPY - T_EHEHE) {
        // 生まれたてと、応えた直後の二度押しは許す（つつきの熱を積まない）
        say(n, 'えへへ', 'good', 0.5);
      } else {
        n.pokeHeat = n.pokeHeat + 1;
        if (n.pokeHeat >= POKE_LIMIT) {
          say(n, 'しつこい！', 'bad', 1);
          n.sulk = T_SULK;
          loseHearts(n, 1);
          n.rough += 1;
          if (st === 'child') n.rough2 += 1;
          n.pokeHeat = 0;
        } else {
          say(n, 'つんつん', 'dim', 0.5);
          n.poke = T_POKE;
        }
      }
    }

    return n;
  },

  draw(g: Painter, s) {
    const [shakeX, shakeY] = shakeOffset(s, s.time);
    const night = s.night >= 0.5;

    /* 空と地面 */
    g.clear('bg');
    g.rect(0, SKY_TOP, W, GROUND_Y - SKY_TOP, night ? 'bg' : 'bg2');
    if (night) {
      // 月と星
      g.circle(198, 54, 9, 'ink');
      g.circle(193, 50, 8, 'bg');
      // さいごの夜だけ星を増やす。位置は i から決めているので再現性は保たれる
      const stars = s.stage === 'last' || s.over ? 32 : 14;
      for (let i = 0; i < stars; i++) {
        const x = 10 + ((i * 71 + 13) % (W - 20));
        const y = SKY_TOP + 6 + ((i * 53 + (i % 5) * 19) % 150);
        const tw = 0.5 + 0.5 * Math.sin(s.time * 3 + i * 1.7);
        g.alpha(0.35 + tw * 0.65, () => g.rect(x, y, 2, 2, 'ink'));
      }
    } else {
      g.circle(198, 54, 9, 'accent');
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + s.time * 0.4;
        g.rect(198 + Math.cos(a) * 13 - 1, 54 + Math.sin(a) * 13 - 1, 3, 3, 'accent');
      }
      // 雲。ゆっくり流れる（時間の関数なので state を持たない）
      for (let i = 0; i < 2; i++) {
        const cx = ((s.time * 6 + i * 130) % (W + 70)) - 35;
        const cy = 62 + i * 34;
        g.circle(cx, cy, 9, 'line');
        g.circle(cx + 11, cy + 2, 7, 'line');
        g.circle(cx - 10, cy + 2, 6, 'line');
      }
    }
    g.rect(0, GROUND_Y, W, GROUND_H, night ? 'bg2' : 'line');
    g.rect(0, GROUND_Y, W, 2, night ? 'line' : 'dim');

    /* 状態の段。一生のどこにいるかを常時出す */
    const shownAge = Math.floor(
      ageAt(s.stage === 'last' || s.over ? s.lifespan : s.time, s.elderAt, s.lifespan),
    );
    const stageText =
      s.stage === 'egg' ? STAGE_LABEL.egg : `${STAGE_LABEL[s.stage]} ${shownAge}さい`;
    g.text(stageText, 6, 19, { size: 11, color: 'ink' });
    for (let i = 0; i < MAX_HEARTS; i++) {
      const filled = i < s.hearts;
      const blink =
        s.heartFlash > 0 &&
        i >= s.heartFlashLo &&
        i < s.heartFlashHi &&
        Math.floor(s.time * 14) % 2 === 0;
      g.sprite(HEART, 150 + i * 12, 20, {
        scale: 2,
        colors: { X: blink ? 'bad' : filled ? 'accent2' : 'line' },
      });
    }
    const mult = multOf(s.hearts);
    g.text(`×${mult}`, W - 5, 19, { size: 12, align: 'right', color: mult > 1 ? 'accent' : 'dim' });

    /* できごとの絵。まめより先に描いて、後ろから出てくるように見せる */
    if (s.event) drawEvent(g, s, s.event, shakeX, shakeY);
    // あそんだあとのともだちは、消えるのではなく来た方（左）へ跳ねて帰っていく
    if (s.friendLeave > 0) {
      const k = 1 - s.friendLeave / T_FRIEND_LEAVE;
      g.alpha(1 - k * k * 0.6, () =>
        drawFriend(
          g,
          56 - k * 92 + shakeX,
          188 - Math.abs(Math.sin(k * Math.PI * 3)) * 20 + shakeY,
        ),
      );
    }

    /* まめ（または たまご） */
    drawBean(g, s, shakeX, shakeY);

    /* ふきだし。出たらタップ、それだけ */
    if (s.want) drawBubble(g, s.want, shakeX);

    /* せいちょうのきらきら（時間の関数。state に粒を持たない） */
    const ek = (s.time - s.evoAt) / 0.9;
    if (ek >= 0 && ek < 1) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + s.evoAt;
        const r = 10 + ek * 34;
        g.alpha(1 - ek, () =>
          g.circle(BEAN_X + Math.cos(a) * r, BEAN_Y + Math.sin(a) * r * 0.8, 3 - ek * 2, 'accent'),
        );
      }
    }

    /* 浮く文字とハート */
    for (const f of s.floats) {
      const k = 1 - f.t / 0.6;
      g.alpha(Math.max(0, 1 - k * k), () => {
        if (f.kind === 'text') {
          g.text(f.text, f.x, f.y, { size: 12, align: 'center', color: f.color });
        } else if (f.kind === 'heart') {
          g.sprite(HEART, f.x, f.y, { scale: 2, colors: { X: f.color }, center: true });
        } else {
          // 割れたハート。左右に離れながら落ちる
          g.sprite(HEART_L, f.x - 3 - k * 5, f.y, { scale: 2, colors: { X: f.color }, center: true });
          g.sprite(HEART_R, f.x + 3 + k * 5, f.y, { scale: 2, colors: { X: f.color }, center: true });
        }
      });
    }

    /* せいちょう・できごとの判定文字（ふきだしが無いときだけ使う段） */
    if (s.topTimer > 0 && !s.want) {
      const size = Math.round(14 * popScale(s, 0.3));
      const w = g.measure(s.topText, size) + 14;
      g.alpha(0.85, () => g.rect(BEAN_X - w / 2, TOP_JUDGE_Y - 3, w, size + 7, 'bg'));
      g.text(s.topText, BEAN_X, TOP_JUDGE_Y, { size, align: 'center', color: s.topColor });
    }

    /* 要求・つんつん系の判定文字。地面の上でも読めるよう背後に帯を敷く */
    if (s.judgeTimer > 0) {
      const size = Math.round(14 * popScale(s, 0.35));
      const w = g.measure(s.judgeText, size) + 14;
      g.alpha(0.85, () => g.rect(BEAN_X - w / 2, JUDGE_Y - 3, w, size + 7, 'bg'));
      g.text(s.judgeText, BEAN_X, JUDGE_Y, { size, align: 'center', color: s.judgeColor });
    }

    /* 墓碑銘。このゲームの「結果」そのものなので、ここで見せる */
    if (s.stage === 'last' || s.over) {
      const lines = epitaph(s);
      for (let i = 0; i < s.epShown && i < lines.length; i++) {
        const y = 56 + i * 20;
        // 星を増やしたぶん、文字の背後に帯を敷かないと粒が字に紛れて読めない
        const bw = g.measure(lines[i], 12) + 12;
        g.alpha(0.72, () => g.rect(BEAN_X - bw / 2, y - 3, bw, 18, 'bg'));
        g.text(lines[i], BEAN_X, y, { size: 12, align: 'center', color: 'ink' });
      }
    }

    /* せいちょうの瞬間、画面全体が一瞬明るくなる */
    if (s.evoFlash > 0) {
      g.alpha((s.evoFlash / 0.12) * 0.45, () => g.rect(0, 0, W, H, 'ink'));
    }

    /* 凡例。色に意味を持たせたら、意味を画面に常時置く */
    g.text('ふきだし → タップ', 6, 286, { size: 9, color: 'dim' });
    g.rect(6, 301, 8, 8, 'bg2');
    g.rectLine(6, 301, 8, 8, 'dim');
    g.text('ねんね', 18, 300, { size: 9, color: 'dim' });
    g.rect(58, 301, 8, 8, 'bad');
    g.text('あかいふきだし → ガマン', 70, 300, { size: 9, color: 'dim' });
  },

  /**
   * 上手い人の再現。
   * ふきだしが出たら少し置いて応え、赤（わがまま）とねんねには手を出さない。
   * 連打が正解なのは「かぜ」だけなので、そこだけ剰余で押し離しを作る。
   */
  bot(s) {
    if (s.over || s.stage === 'last') return { press: false };
    if (s.sleep > 0 || s.yawn > 0 || s.grumpy > 0 || s.sulk > 0 || s.dizzy > 0 || s.sick > 0) {
      return { press: false };
    }
    const frame = Math.floor(s.time * 60);
    if (s.event) {
      // 押しっぱなしだと tap は1回しか立たない（runner.ts の toInput）。
      // かぜだけは連打が正解なので、押す／離すを剰余で作って毎秒6回にする
      if (s.event.kind === 'kaze') return { press: frame % 10 < 5 };
      if (s.event.kind === 'hoshi') return { press: s.event.t >= 0.25 };
      return { press: s.event.t >= 0.3 };
    }
    if (s.want) {
      if (s.want.kind === 'wagamama') return { press: false };
      // 人の反応時間ぶん遅らせる。解決した次のフレームで自然に離れる
      return { press: s.want.t >= 0.3 };
    }
    // たまごも同じ理由で押す／離すを繰り返す。毎秒2回で、3回ぶんのぽかぽかを取りにいく
    if (s.stage === 'egg') return { press: frame % 30 < 15 };
    // つつかない
    return { press: false };
  },

  reason(s) {
    const age = Math.floor(ageAt(s.lifespan, s.elderAt, s.lifespan));
    return `${age}さいで たねになった（${FORM_LABEL[s.form]}）`;
  },

  tunables: {
    wantGap: {
      label: '要求の間隔',
      min: 0.6,
      max: 1.6,
      get: () => TUNE.wantGap,
      set: (v) => {
        TUNE.wantGap = v;
      },
    },
    wantDur: {
      label: 'ふきだしの持続',
      min: 2,
      max: 5,
      get: () => TUNE.wantDur,
      set: (v) => {
        TUNE.wantDur = v;
      },
    },
    lifespan: {
      label: '寿命',
      min: 45,
      max: 90,
      get: () => TUNE.lifespan,
      set: (v) => {
        TUNE.lifespan = v;
      },
    },
  },
});

/* ---- 描画の部品 ------------------------------------------------------ */

/** まめの体。うまれつきで揺れ方が違う */
function drawBean(g: Painter, s: IppunIsshoState, shakeX: number, shakeY: number): void {
  const cx = BEAN_X + shakeX;

  /* たまご期 */
  if (s.stage === 'egg') {
    const wob = Math.sin(s.time * (s.poke > 0 ? 26 : 4)) * (s.poke > 0 ? 4 : 2);
    const pat = s.nature === 'yancha' ? EGG_STRIPE : s.nature === 'sabishi' ? EGG_DOT : EGG_PLAIN;
    g.sprite(pat, cx + wob, BEAN_Y + shakeY, {
      scale: DOT,
      colors: { X: 'ink', Y: 'dim' },
      center: true,
    });
    // きんのたまごは金の斑点がきらめく。「この子は金色になれる」が最初から分かる
    if (s.gold) {
      for (let i = 0; i < 5; i++) {
        const a = i * 1.9 + s.time * 1.2;
        const tw = 0.45 + 0.55 * Math.sin(s.time * 6 + i * 2.1);
        g.alpha(tw, () =>
          g.circle(cx + wob + Math.cos(a) * 13, BEAN_Y + shakeY + 4 + Math.sin(a) * 17, 2.5, 'accent'),
        );
      }
    }
    return;
  }

  /* 体の揺れ。うまれつきで違う */
  let bobY = 0;
  let bobX = 0;
  if (s.nature === 'yancha') bobY = -Math.abs(Math.sin(s.time * 5)) * 3;
  else if (s.nature === 'sabishi') bobX = Math.sin(s.time * 3.2) * 3;
  else bobY = Math.sin(s.time * 2.2) * 2;
  if (s.sleep > 0 || s.stage === 'last') {
    bobY = Math.sin(s.time * 1.6) * 1.5;
    bobX = 0;
  }
  if (s.poke > 0) bobX += Math.sin((T_POKE - s.poke) * 50) * 4;
  if (s.dizzy > 0) bobX += Math.sin(s.time * 12) * 3;

  // さいごは座る（4px 下がる）。たねになるときは沈む
  let sink = 0;
  if (s.over) sink = Math.min(1, s.overT / 0.3) * 52;
  else if (s.stage === 'last') sink = 4;

  const bx = cx + bobX;
  const by = BEAN_Y + shakeY + bobY + sink;

  const base = FORM_COLORS[s.form];
  let colors = s.elder ? agedColors(base) : base;
  // せいちょうの0.6秒前から点滅して予告する
  const nextEvo =
    s.stage === 'baby' ? CHILD_AT : s.stage === 'child' ? ADULT_AT : s.stage === 'adult' ? s.elderAt : -1;
  const toEvo = nextEvo - s.time;
  if (!s.over && toEvo > 0 && toEvo <= 0.6 && Math.floor(toEvo * 14) % 2 === 0) {
    colors = { ...colors, X: 'accent' };
  }

  g.clip(0, 0, W, GROUND_Y + (s.over ? 0 : GROUND_H), () => {
    g.sprite(FORM_BODY[s.form], bx, by, { scale: DOT, colors, center: true });
    // きんまめはきらきらをまとう
    if (s.form === 'kin' && !s.over) {
      for (let i = 0; i < 4; i++) {
        const a = i * 1.6 + s.time * 1.6;
        const tw = 0.4 + 0.6 * Math.sin(s.time * 7 + i * 1.3);
        g.alpha(tw, () => g.circle(bx + Math.cos(a) * 30, by + Math.sin(a) * 24, 2.5, 'accent'));
      }
    }
    // おとしよりの杖
    if (s.elder && !s.over) {
      g.rect(bx + 28, by - 6, 3, 30, 'dim');
      g.rect(bx + 24, by - 8, 8, 3, 'dim');
    }
    drawFace(g, s, bx, by);
  });

  /* たねになる → 芽が出る。次の一生がここから始まる、という絵 */
  if (s.over) {
    // たねが落ちる
    if (s.overT >= 0.28 && s.overT < 0.55) {
      const fall = Math.min(1, (s.overT - 0.28) / 0.24);
      g.circle(cx, 166 + fall * 38, 4, 'ink');
      g.circle(cx, 166 + fall * 38, 2, 'bg2');
    }
    // 芽がぽんと出る。次の一生がここから始まる、という絵
    if (s.overT >= 0.55) {
      const k = popScale(s, 0.5);
      const hgt = Math.min(1, (s.overT - 0.55) / 0.18) * 22 * k;
      g.rect(cx - 6, GROUND_Y - 2, 12, 3, 'bg2');
      g.rect(cx - 1, GROUND_Y - hgt, 3, hgt, 'good');
      g.circle(cx - 6, GROUND_Y - hgt, 6 * k, 'good');
      g.circle(cx + 7, GROUND_Y - hgt, 6 * k, 'good');
    }
  }
}

/**
 * 顔。形態ごとに描き分けず、mood から矩形と円を重ねて作る。
 * ここを1か所にしておくと、形態が増えても表情の数は増えない。
 */
function drawFace(g: Painter, s: IppunIsshoState, cx: number, cy: number): void {
  const mood = moodOf(s);
  const f = faceOf(s.form);
  // すねているときは、そっぽを向く
  const turn = mood === 'pui' ? 7 : 0;
  const ex = cx + turn;
  const ey = cy + f.dy;
  const my = cy + f.mouth;
  const eye: ColorKey = 'bg';

  const dot = (x: number, y: number, r: number, c: ColorKey) => g.circle(x, y, r, c);

  if (mood === 'niko' || mood === 'pui') {
    // ^ ^（閉じた笑い目）
    for (const d of [-1, 1]) {
      const x = ex + d * f.dx;
      g.rect(x - 4, ey, 3, 2, eye);
      g.rect(x - 1, ey - 3, 3, 2, eye);
      g.rect(x + 2, ey, 3, 2, eye);
    }
  } else if (mood === 'nemu' || mood === 'toji') {
    for (const d of [-1, 1]) g.rect(ex + d * f.dx - 4, ey, 8, 2, eye);
  } else if (mood === 'akubi' || mood === 'nebo' || mood === 'kaze') {
    for (const d of [-1, 1]) {
      g.rect(ex + d * f.dx - 4, ey - 1, 8, 2, eye);
      dot(ex + d * f.dx, ey + 2, 1.5, eye);
    }
  } else if (mood === 'pun') {
    // つり上がった目
    for (const d of [-1, 1]) {
      const x = ex + d * f.dx;
      dot(x, ey + 1, 2.5, eye);
      g.rect(x - d * 4, ey - 5, 8, 2, eye);
    }
  } else if (mood === 'fura') {
    // 渦目
    for (const d of [-1, 1]) {
      const x = ex + d * f.dx;
      g.circleLine(x, ey, 4, eye, 2);
      dot(x, ey, 1.5, eye);
    }
  } else if (mood === 'shon') {
    for (const d of [-1, 1]) {
      const x = ex + d * f.dx;
      dot(x, ey + 1, 2.5, eye);
      g.rect(x - 4, ey - 4, 8, 2, eye);
    }
    // 涙
    g.rect(ex - f.dx - 1, ey + 4, 2, 6, 'cool');
  } else {
    for (const d of [-1, 1]) dot(ex + d * f.dx, ey, 2.2, eye);
  }

  // 口
  if (mood === 'niko') {
    g.rect(ex - 4, my, 8, 2, eye);
    g.rect(ex - 6, my - 2, 2, 2, eye);
    g.rect(ex + 4, my - 2, 2, 2, eye);
  } else if (mood === 'shon') {
    g.rect(ex - 4, my + 1, 8, 2, eye);
    g.rect(ex - 6, my + 3, 2, 2, eye);
    g.rect(ex + 4, my + 3, 2, 2, eye);
  } else if (mood === 'akubi') {
    g.circle(ex, my + 1, 4, eye);
  } else if (mood === 'pun') {
    g.rect(ex - 5, my, 10, 2, eye);
  } else if (mood === 'pui') {
    // むすっとした口。そっぽを向いているのに笑っていると、何が起きたか読めない
    g.rect(ex - 3, my, 7, 2, eye);
  } else if (mood === 'fura') {
    // ゆれた口。渦目と合わせて「まいっている」に見せる
    g.rect(ex - 5, my, 3, 2, eye);
    g.rect(ex - 2, my - 2, 3, 2, eye);
    g.rect(ex + 1, my, 3, 2, eye);
    g.rect(ex + 4, my - 2, 2, 2, eye);
  } else if (mood === 'nemu' || mood === 'toji') {
    g.rect(ex - 2, my, 5, 2, eye);
  } else {
    g.rect(ex - 2, my, 5, 2, eye);
    g.rect(ex - 4, my - 2, 2, 2, eye);
    g.rect(ex + 3, my - 2, 2, 2, eye);
  }

  // ぽよまめの頬
  if (s.form === 'poyo' && mood !== 'pui') {
    dot(cx - f.dx - 6, cy + 2, 3, 'accent2');
    dot(cx + f.dx + 6, cy + 2, 3, 'accent2');
  }

  // おとしよりの白い眉
  if (s.elder) {
    for (const d of [-1, 1]) g.rect(ex + d * f.dx - 5, ey - 8, 10, 2, 'ink');
  }

  // ねぼすけとあくびのよだれ
  if (mood === 'nebo' || mood === 'akubi') {
    g.rect(ex + 3, my + 2, 2, 5, 'cool');
  }

  // ぷんぷんの湯気と怒りの印
  if (mood === 'pun') {
    for (let i = 0; i < 3; i++) {
      const k = (s.time * 2 + i * 0.33) % 1;
      g.alpha(1 - k, () => g.circle(cx - 14 + i * 14, cy - 26 - k * 12, 3 - k * 2, 'dim'));
    }
    g.rect(cx + 16, cy - 20, 10, 2, 'accent2');
    g.rect(cx + 20, cy - 24, 2, 10, 'accent2');
  }

  // かぜの汗
  if (mood === 'kaze') {
    g.circle(cx + 20, cy - 14, 3, 'cool');
    g.rect(cx + 19, cy - 20, 2, 5, 'cool');
  }

  // ねんねの「Z」。文字ではなく形で描く（画面に英語を出さないため）
  if (mood === 'nemu') {
    for (let i = 0; i < 2; i++) {
      const k = (s.time * 0.9 + i * 0.5) % 1;
      const zx = cx + 20 + k * 10;
      const zy = cy - 22 - k * 22;
      const sz = 7 - i * 2;
      g.alpha(1 - k, () => {
        g.rect(zx, zy, sz, 2, 'ink');
        g.rect(zx, zy + sz, sz, 2, 'ink');
        for (let j = 0; j < sz; j++) g.rect(zx + sz - 1 - j, zy + (j * sz) / sz, 2, 2, 'ink');
      });
    }
  }
}

/** ともだちを1匹描く。来るときと帰るときで同じ絵を使う */
function drawFriend(g: Painter, fx: number, fy: number): void {
  g.sprite(B_FRIEND, fx, fy, { scale: 3, colors: { X: 'cool' }, center: true });
  g.circle(fx - 5, fy - 2, 2, 'bg');
  g.circle(fx + 5, fy - 2, 2, 'bg');
}

/** ふきだし。中に残り時間のバーを出す */
function drawBubble(g: Painter, w: Want, shakeX: number): void {
  const x = BUBBLE_X + shakeX;
  const bad = w.kind === 'wagamama';
  const edge: ColorKey = bad ? 'bad' : 'ink';
  g.rect(x, BUBBLE_Y, BUBBLE_W, BUBBLE_H, 'bg');
  g.rectLine(x, BUBBLE_Y, BUBBLE_W, BUBBLE_H, edge, 2);
  // しっぽ
  g.poly(
    [x + 16, BUBBLE_Y + BUBBLE_H - 1, x + 28, BUBBLE_Y + BUBBLE_H - 1, x + 19, BUBBLE_Y + BUBBLE_H + 8],
    'bg',
  );
  g.line(x + 16, BUBBLE_Y + BUBBLE_H, x + 19, BUBBLE_Y + BUBBLE_H + 8, edge, 2);
  g.line(x + 28, BUBBLE_Y + BUBBLE_H, x + 19, BUBBLE_Y + BUBBLE_H + 8, edge, 2);

  const ix = x + BUBBLE_W / 2;
  const iy = BUBBLE_Y + 13;
  if (w.kind === 'gohan') {
    g.poly([ix - 9, iy - 1, ix + 9, iy - 1, ix + 5, iy + 7, ix - 5, iy + 7], 'ink');
    g.rect(ix - 8, iy - 5, 16, 4, 'accent');
  } else if (w.kind === 'asobo') {
    g.circle(ix, iy + 1, 7, 'accent');
    g.circleLine(ix, iy + 1, 7, 'ink', 1);
    g.line(ix - 7, iy + 1, ix + 7, iy + 1, 'ink', 1);
  } else if (w.kind === 'nadete') {
    // 手
    g.rect(ix - 5, iy - 1, 11, 8, 'ink');
    g.rect(ix - 5, iy - 6, 2, 6, 'ink');
    g.rect(ix - 1, iy - 8, 2, 8, 'ink');
    g.rect(ix + 3, iy - 6, 2, 6, 'ink');
  } else if (w.kind === 'ofuro') {
    g.rect(ix - 9, iy + 1, 18, 7, 'cool');
    for (let i = 0; i < 3; i++) g.rect(ix - 6 + i * 6, iy - 7, 2, 6, 'dim');
  } else {
    // わがまま＝王冠。横に小さく×を添える
    g.poly([ix - 9, iy + 5, ix - 9, iy - 4, ix - 4, iy + 1, ix, iy - 7, ix + 4, iy + 1, ix + 9, iy - 4, ix + 9, iy + 5], 'bad');
    g.line(ix + 12, iy - 8, ix + 18, iy - 2, 'bad', 2);
    g.line(ix + 18, iy - 8, ix + 12, iy - 2, 'bad', 2);
  }

  // 残り時間。ふつうのふきだしは縮み、わがままは「ここまで待てば勝ち」に満ちる
  const barX = x + 6;
  const barW = BUBBLE_W - 12;
  g.rect(barX, BUBBLE_Y + 28, barW, 4, 'line');
  if (bad) {
    g.rect(barX, BUBBLE_Y + 28, Math.round(barW * (w.t / w.dur)), 4, 'bad');
  } else {
    const r = 1 - w.t / w.dur;
    g.rect(barX, BUBBLE_Y + 28, Math.round(barW * r), 4, r > 0.5 ? 'good' : 'accent2');
  }
}

/** できごとの絵 */
function drawEvent(g: Painter, s: IppunIsshoState, ev: Ev, shakeX: number, shakeY: number): void {
  const k = ev.t / EV_DUR[ev.kind];
  if (ev.kind === 'hoshi') {
    const x = W + 14 - k * (W + 40) + shakeX;
    const y = SKY_TOP + 16 + k * 70 + shakeY;
    g.line(x + 22, y - 12, x, y, 'dim', 2);
    g.poly([x, y - 7, x + 2, y - 2, x + 7, y, x + 2, y + 2, x, y + 7, x - 2, y + 2, x - 7, y, x - 2, y - 2], 'accent');
  } else if (ev.kind === 'kaze') {
    // 体温計と、あと何回さすればよいか
    g.rect(168 + shakeX, 150 + shakeY, 5, 26, 'ink');
    g.circle(170 + shakeX, 178 + shakeY, 5, 'bad');
    g.rect(169 + shakeX, 158 + shakeY, 3, 20, 'bad');
    for (let i = 0; i < KAZE_TAPS; i++) {
      const done = i < ev.taps;
      g.circle(96 + i * 16 + shakeX, 146 + shakeY, 5, done ? 'good' : 'line');
    }
  } else if (ev.kind === 'tomodachi') {
    const walk = Math.min(1, k * 3);
    drawFriend(g, -20 + walk * 76 + shakeX, 188 + shakeY + Math.sin(s.time * 8) * (walk < 1 ? 2 : 0));
  } else {
    // ちょうちょ
    const bx = 40 + k * 140 + shakeX;
    const by = 150 + Math.sin(s.time * 6) * 16 + shakeY;
    // 羽ばたき。左右の羽がつぶれきらないよう、下限を持たせる
    const flap = 4 + Math.abs(Math.sin(s.time * 14)) * 6;
    g.poly([bx, by, bx - 13, by - flap, bx - 9, by + flap], 'accent2');
    g.poly([bx, by, bx + 13, by - flap, bx + 9, by + flap], 'accent2');
    g.rect(bx - 1, by - 5, 3, 11, 'ink');
    g.line(bx, by - 5, bx - 4, by - 11, 'ink', 1);
    g.line(bx + 1, by - 5, bx + 5, by - 11, 'ink', 1);
  }
}
