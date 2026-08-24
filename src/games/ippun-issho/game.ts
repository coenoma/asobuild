/**
 * 一分一生（いっぷんいっしょう）── v12（最終）
 *
 * **たまごを押したときから、その子はあなたに頼る。あさに生まれ、よるに光になる。**
 *
 * v1〜v11 はオーナーの実機FB 11回で作り直し続け、v11 で「全然全く面白くない」。
 * 部分修正を重ねる進め方が誤りだったので、32件のFBを統合して根本原因を出し、設計から作り直し、
 * 設計レビュー2本（反証役・初見プレイ再生）の指摘を取り込んだ（docs/plans/008-ippun-issho/design.md）。
 *
 * 7つの原則（設計 §1）:
 *   1. キャラが UI。欲求・体調・育ち・年齢は体・顔・姿勢・動き・持ち物で見せる
 *   2. 毎タップが舵。ごはん→丸く／あそぶ→足が伸びる／なでる→毛が立つ。t=30 に自分が作った形へ名前が付く
 *   3. 本当に死ぬ。たまごを押した子は頼る。放てば6秒で雨、18秒で力尽きる。応えれば必ず助かる
 *   4. 読ませる字は3か所（名前・場面の見出し・記念）。キャラの言葉は2つ。手応えは反応と「＋N」
 *   5. 波のテンポ。あさは3回だけ呼ぶ。場面転換と変身は全停止
 *   6. 姿は一目で別物。大きさは年齢（あさ小→ひる中→よる大）。調子は顔・姿勢・雨
 *   7. 最初の10秒で全部教える。名前は自動。あさだけボタンが光る
 *
 * 文字を出すのは drawHead / drawNameBanner / drawBanner / drawEpitaph / drawGain だけ。
 * 文字の重なりは scratchpad の overlap-check で全フレーム機械検査して 0 にする。
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
  shakeOffset,
  takeTap,
  type FeelState,
} from '@/arcade/feel';
import { meta } from './meta';

/** この機種の画面寸法。座標はすべてこれが基準 */
const { w: W } = PLATFORMS.keitai;

/** 収録中に触ることになる数値。`npm run tune` が動かせるよう、定数ではなく入れ物にしてある */
const TUNE = {
  /** 欲求が 1 減るのにかかる秒数（おなか。きげん・さみしさは係数をかける） */
  drain: 5,
  /** 呼び始めから力尽きるまでの秒数。「放てば死ぬ」の猶予そのもの（本家「僅かな気の緩みで死ぬ」） */
  graceToDie: 18,
};

/* ================================================================== *
 * 一日の時間割（設計 §3）。`t` は孵化からの秒。全停止中は止まる
 * ================================================================== */

/** あさ → ひる（ひるの間）。ここまでが「教える期間」＝ボタンが光る */
const T_NOON = 15;
/** へんしん（自分が作った形に名前が付く）。sick・反応中なら落ち着くまで待つ */
const T_MORPH = 30;
const T_MORPH_MAX = 36;
/** ゆうがた → よる（よるの間） */
const T_NIGHT = 45;
/** 看取りが始まる */
const T_BYE = 50;

/** 全停止の長さ: 場面転換／へんしん */
const PAUSE_BEAT = 2;
const PAUSE_MORPH = 2.6;
/** 名前を大きく出す長さ（孵化の瞬間に1回） */
const NAME_T = 1.5;

/** たまご: 押すと何秒後に孵るか／押されなければ何秒で自分で孵るか／温められる回数 */
const EGG_HATCH = 1.2;
const EGG_AUTO = 30;
const EGG_TAPS = 3;

/** 欲求の段階（設計 §6）。値は 0〜4 */
const NEED_MAX = 4;
/** この値で「気にする」（Lv1。小さな吹き出し） */
const LV1_AT = 2;
/** この値以下で「呼ぶ」（Lv2。大きな吹き出し・ピッ） */
const LV2_AT = 1;
/** 呼び始めてから Lv3（強く呼ぶ）・Lv4（よわる＝雨）になる秒数 */
const LV3_AFTER = 3;
const LV4_AFTER = 6;
/** ぐあいわるい のまま何秒で力尽きるか（Lv5 は graceToDie - これ） */
const SICK_TO_DIE = 8;
/** 満腹で続けて食べさせると「げふ」になる回数／そのあと食べられない秒数 */
const OVERFEED_AT = 3;
const FULL_T = 6;
/** なでるで けなみ が増える間隔（連打では増えない） */
const PET_EVERY = 4;
/** 育ちの軸の上限 */
const AXIS_MAX = 8;

/* ---- 得点（設計 §9）-------------------------------------------- */

const P_WARM = 1;
const P_BORN = 2;
/** 呼びに応えた点: はやい（気にしているうち／呼ばれて1.5秒以内）／ふつう／おそい（強く呼ばれてから） */
const P_FAST = 5;
const P_NORMAL = 3;
const P_SLOW = 1;
/** 呼ばれてから これ以内に応えれば「はやい」 */
const FAST_WITHIN = 1.5;
const P_CURE = 5;
const P_MORPH = 10;
/** 一度も強く呼ばれなかった（おだやか）。へんしん時と看取り時の2回 */
const P_CALM = 10;
const P_KIRA = 25;
const KIRA_MULT = 1.5;

const P_TUCK = 5;
const P_LIVED = 15;
/** 一度も雨が降らなかった（きれいな一生） */
const P_CLEAN = 15;


/* ---- 画面の決まり（240×320・mono。設計 §4）-------------------- */

const HEAD_Y = 26; // 共通シェルが左上 y≈10 に「NNしあわせ」を描くので、その下
const WIN_X = 8;
const WIN_Y = 40;
const WIN_W = 224;
const WIN_H = 176;
const WIN_LINE = 2;
/** 角丸の抜き幅（上から順に、その行で本体色に塗る幅） */
const CORNER: readonly number[] = [5, 3, 2, 1, 1];
const FLOOR_Y = 190;
const CHAR_X = 120;
/** 吹き出し */
const BUBBLE_R = 17;

/** 世話ボタン4つ */
const BTN_Y = 238;
/** 手応えの帯（窓とボタンの間。目線の通り道）。手応え・コンボ・体の言葉は全部ここに一列で出す */
const FEED_Y = 219;
const BTN_H = 64;
const BTN_W = 52;
const BTN_X0 = 8;
const BTN_GAP = 58;
/** 記念の文 */
const EPI_Y = 54;
const EPI_LINE = 18;
/** ＋N の長さ／反応の既定の長さ */
const GAIN_T = 1.2;
const ANIM_T = 1.2;

/* ---- おわかれの時間割（設計 §8）-------------------------------- */

/** 見上げる（言葉）／倒れたまま */
const BYE_LOOK = 1.6;
/** 光の粒が散る */
const BYE_LIGHT = 1.2;
const BYE_SEED = BYE_LOOK + BYE_LIGHT + 0.3;
const BYE_EPI = BYE_SEED + 0.4;
const EPI_STEP = 0.6;
/** 記念4行のあと、6つの姿の列を見せてから終わる（全体 ≈7秒。タップで送れる） */
const BYE_FORMS = BYE_EPI + EPI_STEP * 4;
const BYE_END = BYE_FORMS + 2.4;

/* ---- 種類 ------------------------------------------------------------ */

/** 世話の種類＝ボタン4つ＝吹き出しの絵。同じ絵を3か所で使う */
type Kind = 'gohan' | 'asobu' | 'nade' | 'kusuri';
const BTN_KINDS: readonly Kind[] = ['gohan', 'asobu', 'nade', 'kusuri'];
const BTN_LABEL: readonly string[] = ['ごはん', 'あそぶ', 'なでる', 'くすり'];

/** 欲求3つ（おなか・きげん・さみしさ）。並びは NEED_KIND と対応 */
type Need = 0 | 1 | 2;
const NEED_KIND: readonly Kind[] = ['gohan', 'asobu', 'nade'];

type Phase = 'egg' | 'life' | 'bye' | 'gone';
type Pause = '' | 'noon' | 'morph' | 'night';

/** 姿（設計 §7）。語尾を揃えない（本家の命名の癖に寄せないため）。つぶ＝名前が付く前 */
type Form = 'tsubu' | 'poyo' | 'koro' | 'pyon' | 'mofu' | 'tabi' | 'kira';

const FORM_NAME: Record<Form, string> = {
  tsubu: 'つぶ',
  poyo: 'ぽよ',
  koro: 'ころ',
  pyon: 'ぴょん',
  mofu: 'もふ',
  tabi: 'たび',
  kira: 'きら',
};

/** 姿の理由。式ではなく、ぼかした一言で見せる */
const FORM_WHY: Record<Form, string> = {
  tsubu: '',
  poyo: 'かまってもらったから',
  koro: 'ごはんが だいすきだから',
  pyon: 'はねるのが すきだから',
  mofu: 'たくさん なでられたから',
  tabi: 'じぶんの みちを いくから',
  kira: 'だいじに そだてられたから',
};

/** 記念の最後に並べる6つの姿（「ほかにもある」＝もう一回の理由） */
const FORMS_ALL: readonly Form[] = ['poyo', 'koro', 'pyon', 'mofu', 'tabi', 'kira'];

/** 名前の候補。「っち」で終わる名前は入れない（設計 §13）。自動で1つ引く */
const NAMES: readonly string[] = [
  'ぽち', 'もこ', 'たま', 'ちび', 'くう', 'ぷく', 'まる', 'のん', 'きな', 'あず',
  'ここ', 'そら', 'ひな', 'ゆず', 'りく', 'なな', 'とと', 'みお', 'ぽん', 'こむ',
];

function whenLabel(t: number): string {
  if (t < T_NOON) return 'あさ';
  if (t < T_MORPH) return 'ひる';
  if (t < T_NIGHT) return 'ゆうがた';
  return 'よる';
}

/* ---- 状態 ------------------------------------------------------------ *
 * フラットに持つ。粒（光・雨・星）は `s.time` の関数で描く（配列を持たない）。
 * ------------------------------------------------------------------- */

export interface IppunIsshoState extends BaseState, FeelState {
  phase: Phase;
  /** 孵化からの秒。全停止中は進まない */
  t: number;
  byeT: number;
  /** たまごが孵る時刻（s.time 基準。押されるまでは EGG_AUTO） */
  hatchAt: number;
  /** たまごを押したか（＝契約。ここからこの子はあなたに頼る） */
  touched: boolean;
  eggTaps: number;
  nameId: number;
  /** 名前を大きく出している残り秒 */
  nameT: number;

  /* 欲求（0〜4。画面には出さない。体と吹き出しで見せる） */
  hunger: number;
  fun: number;
  love: number;
  /** 呼び始め（値≤1）からの秒。0 なら呼んでいない */
  call0: number;
  call1: number;
  call2: number;
  /** 減りの溜め */
  drain0: number;
  drain1: number;
  drain2: number;
  /** 減りの位相（子ごとに ±15%。2つ同時の組み合わせが毎回変わる） */
  pace0: number;
  pace1: number;
  pace2: number;

  /* 体調 */
  sick: boolean;
  sickT: number;
  /** 満腹で続けて食べさせた回数／「げふ」で食べられない残り */
  overfeed: number;
  fullT: number;
  /** 一度でも雨が降った（よわった） */
  rained: boolean;
  /** 一度でも強く呼ばれた（おだやか の判定） */
  urged: boolean;
  alive: boolean;
  early: boolean;
  endT: number;

  /* 育ち（毎タップ体に出る3軸。設計 §7） */
  maru: number;
  ashi: number;
  kenami: number;
  /** 体が変わった瞬間の残り（ぷるっと揺れる） */
  grewT: number;
  fed: number;
  played: number;
  petted: number;
  cured: number;
  form: Form;
  morphed: boolean;
  kira: boolean;
  /** 連続で応えた数（コンボ）と、この一生の最高 */
  combo: number;
  comboMax: number;
  /** 手応えの言葉（はやい！／おそい／ちがう／コンボ おわり）と倍率（×2・×3） */
  word: string;
  mult: number;
  /** 頼まれていない世話で体が変わったときの言葉（まるくなる 等）と残り秒 */
  growWord: string;
  growWordT: number;
  bandage: boolean;
  tucked: boolean;

  /* 全停止（場面転換・へんしん） */
  pause: Pause;
  pauseT: number;
  beatDone: number;

  /* 反応: 0=なし 1=たべる 2=あそぶ 3=なでる 4=くすり 5=ねる 6=いや 7=げふ 8=ん？ 9=のび 10=あくび 11=ふるえ */
  anim: number;
  animT: number;
  petAt: number;
  /** 応えた・治した直後、次の呼びまでの小休止（この間だけ減りが止まる。連打では止まらない） */
  restT: number;

  /* ひとり遊び: 0=歩く 1=見回す 2=のび 3=くしゃみ 4=はなうた */
  idle: number;
  idleT: number;
  walkX: number;
  walkDir: number;
  lookX: number;
  lookT: number;

  /* 手応え「＋N」 */
  gain: number;
  gainT: number;
  pressBtn: number;
  pressT: number;
  beeped: number;
  epShown: number;
  poke: number;
}

/* ---- 小さな道具 ------------------------------------------------------ */

function gain(n: IppunIsshoState, base: number, word = '', mult = 1): void {
  const add = Math.round(base * mult * (n.kira ? KIRA_MULT : 1));
  n.score += add;
  n.gain = add;
  n.gainT = GAIN_T;
  n.word = word;
  n.mult = mult;
}

/** コンボの倍率。3連続で ×2、5連続で ×3 */
function multOf(combo: number): number {
  return combo >= 5 ? 3 : combo >= 3 ? 2 : 1;
}

/** コンボが切れる（雨・違うボタン・おそい）。言葉で見せる */
function breakCombo(n: IppunIsshoState, word: string): void {
  if (n.combo > 0) {
    n.word = word;
    n.gain = 0;
    n.gainT = GAIN_T;
    n.mult = 1;
  }
  n.combo = 0;
}

function animate(n: IppunIsshoState, kind: number, dur = ANIM_T): void {
  n.anim = kind;
  n.animT = dur;
}

/** ピッ（呼び出し）。1増やすと共通シェルが1回鳴らす */
function beep(n: IppunIsshoState): void {
  n.cue = (n.cue ?? 0) + 1;
}

function needOf(s: IppunIsshoState, i: Need): number {
  return i === 0 ? s.hunger : i === 1 ? s.fun : s.love;
}
function setNeed(n: IppunIsshoState, i: Need, v: number): void {
  const c = Math.max(0, Math.min(NEED_MAX, v));
  if (i === 0) n.hunger = c;
  else if (i === 1) n.fun = c;
  else n.love = c;
}
function callOf(s: IppunIsshoState, i: Need): number {
  return i === 0 ? s.call0 : i === 1 ? s.call1 : s.call2;
}
function setCall(n: IppunIsshoState, i: Need, v: number): void {
  if (i === 0) n.call0 = v;
  else if (i === 1) n.call1 = v;
  else n.call2 = v;
}
function setDrain(n: IppunIsshoState, i: Need, v: number): void {
  if (i === 0) n.drain0 = v;
  else if (i === 1) n.drain1 = v;
  else n.drain2 = v;
}

/** その欲求の段階。0=げんき 1=気にする 2=呼ぶ 3=強く呼ぶ 4=よわる（雨）。5=ぐあいわるい は sick */
function levelOf(s: IppunIsshoState, i: Need): number {
  if (s.phase !== 'life' || s.t >= T_NIGHT) return 0;
  const v = needOf(s, i);
  if (v <= LV2_AT) {
    const c = callOf(s, i);
    if (c >= LV4_AFTER) return 4;
    if (c >= LV3_AFTER) return 3;
    return 2;
  }
  if (v <= LV1_AT) return 1;
  return 0;
}

/** いちばん困っている欲求。無ければ -1 */
function worstNeed(s: IppunIsshoState): Need | -1 {
  let best: Need | -1 = -1;
  let bestLv = 0;
  for (const i of [0, 1, 2] as const) {
    const lv = levelOf(s, i);
    if (lv > bestLv || (lv === bestLv && lv > 0 && best !== -1 && callOf(s, i) > callOf(s, best))) {
      best = i;
      bestLv = lv;
    }
  }
  return best;
}

/** いちばん困っている欲求の段階（無ければ 0） */
function worstLevel(s: IppunIsshoState): number {
  const w = worstNeed(s);
  return w === -1 ? 0 : levelOf(s, w);
}

/** 2つ目（同時に呼んでいるとき）。無ければ -1 */
function secondNeed(s: IppunIsshoState): Need | -1 {
  const first = worstNeed(s);
  if (first < 0) return -1;
  let best: Need | -1 = -1;
  let bestLv = 0;
  for (const i of [0, 1, 2] as const) {
    if (i === first) continue;
    const lv = levelOf(s, i);
    if (lv >= 2 && lv > bestLv) {
      best = i;
      bestLv = lv;
    }
  }
  return best;
}

/** 吹き出しに出すもの（病気なら くすり だけ） */
function bubbles(s: IppunIsshoState): { kind: Kind; lv: number }[] {
  if (s.phase !== 'life' || s.pause !== '' || !s.alive) return [];
  if (s.sick) return [{ kind: 'kusuri', lv: 5 }];
  const out: { kind: Kind; lv: number }[] = [];
  const a = worstNeed(s);
  if (a !== -1) out.push({ kind: NEED_KIND[a], lv: levelOf(s, a) });
  const b = secondNeed(s);
  if (b !== -1) out.push({ kind: NEED_KIND[b], lv: levelOf(s, b) });
  return out;
}

/** 年齢＝大きさ（設計 §6）。あさ3・ひる4・よる5 */
function dotOf(s: IppunIsshoState): number {
  if (s.phase === 'egg') return 4;
  // へんしんの瞬間は一回り大きく現れて等倍に戻る（「ぽん」）
  if (s.pause === 'morph' && s.pauseT > PAUSE_MORPH - 0.7 && s.pauseT < PAUSE_MORPH - 0.25) return 6;
  if (s.t >= T_NOON) return 5;
  return 4;
}

/** 液晶を暗く反転する場面は無い（早い別れも暗転しない＝罰にしない。光になって上る） */
function darkNow(_s: IppunIsshoState): boolean {
  return false;
}

/** 足の長さ（あし軸。まる≥6 の球は足が無い） */
function legLen(s: IppunIsshoState): number {
  if (s.maru >= 6 || s.pause !== '') return 0; // 球は足が無い。全停止中は座る

  const a = Math.min(8, s.ashi);
  if (a <= 0) return 0;
  return Math.round(a * 3 * (dotOf(s) / 4));
}

/** 吹き出しの中心（キャラの頭の右上に追従。2つ目は左上） */
function bubbleAt(s: IppunIsshoState, idx: number): { x: number; y: number } {
  const dot = dotOf(s);
  const headY = FLOOR_Y - 16 * dot - legLen(s) + 4 * dot;
  const side = idx === 0 ? 1 : -1;
  return { x: CHAR_X + s.walkX + side * (8 * dot + 14), y: headY - 18 };
}

/* ---- 当たり判定 ------------------------------------------------------ */

type HitWhat = 'btn' | 'bubble' | 'char' | 'sky' | 'window' | 'none';

function hitTest(s: IppunIsshoState, px: number, py: number): { what: HitWhat; i: number } {
  for (let i = 0; i < 4; i++) {
    const x = BTN_X0 + i * BTN_GAP;
    if (px >= x && px < x + BTN_W && py >= BTN_Y && py < BTN_Y + BTN_H) return { what: 'btn', i };
  }
  const bs = bubbles(s);
  for (let i = 0; i < bs.length; i++) {
    const b = bubbleAt(s, i);
    const r = bs[i].lv === 1 ? 14 : BUBBLE_R + 6;
    if (Math.hypot(px - b.x, py - b.y) <= r) return { what: 'bubble', i };
  }
  const dot = dotOf(s);
  const h = 16 * dot + legLen(s);
  if (Math.abs(px - (CHAR_X + s.walkX)) < 8 * dot + 12 && py >= FLOOR_Y - h - 12 && py < FLOOR_Y + 8) {
    return { what: 'char', i: -1 };
  }
  if (px >= WIN_X && px < WIN_X + WIN_W && py >= WIN_Y && py < WIN_Y + WIN_H) {
    return { what: py < FLOOR_Y - 80 ? 'sky' : 'window', i: -1 };
  }
  return { what: 'none', i: -1 };
}

/* ================================================================== *
 * ゲーム本体
 * ================================================================== */

export default defineGame<IppunIsshoState>({
  meta,

  init(rng) {
    const pace2 = 0.85 + rng.int(31) / 100;
    return {
      ...createFeel(),
      score: 0,
      over: false,
      time: 0,
      cue: 0,
      click: 0,

      phase: 'egg',
      t: 0,
      byeT: 0,
      hatchAt: EGG_AUTO,
      touched: false,
      eggTaps: 0,
      nameId: rng.int(NAMES.length),
      nameT: 0,

      // 生まれたては さみしがり（最初の呼びが「なでて」になる）。おなか・きげんは順に来る
      hunger: 3,
      fun: 3.6,
      love: 1.4,
      call0: 0,
      call1: 0,
      call2: 0,
      drain0: 0,
      drain1: 0,
      // 最初の「なでて」が t≈2 で来るよう、さみしさの減りだけ先に溜めておく（教える期間の1手目）
      drain2: Math.max(0, TUNE.drain * 1.6 * 0.6 * pace2 - 2),
      pace0: 0.85 + rng.int(31) / 100,
      pace1: 0.85 + rng.int(31) / 100,
      pace2,

      sick: false,
      sickT: 0,
      overfeed: 0,
      fullT: 0,
      rained: false,
      urged: false,
      alive: true,
      early: false,
      endT: T_BYE,

      maru: 0,
      ashi: 0,
      kenami: 0,
      grewT: 0,
      fed: 0,
      played: 0,
      petted: 0,
      cured: 0,
      form: 'tsubu',
      morphed: false,
      kira: false,
      combo: 0,
      comboMax: 0,
      word: '',
      mult: 1,
      growWord: '',
      growWordT: 0,
      bandage: false,
      tucked: false,

      pause: '',
      pauseT: 0,
      beatDone: 0,

      anim: 0,
      animT: 0,
      petAt: -99,
      restT: 0,

      idle: 0,
      idleT: 2,
      walkX: 0,
      walkDir: 1,
      lookX: 0,
      lookT: 0,

      gain: 0,
      gainT: 0,
      pressBtn: -1,
      pressT: 0,
      beeped: 0,
      epShown: 0,
      poke: 0,
    };
  },

  step(s, input, dt, rng) {
    const n = { ...s };
    if (!feelTick(n, input, dt)) return n;

    /* 1. 演出のタイマーを減らす */
    n.animT = Math.max(0, n.animT - dt);
    if (n.animT <= 0) n.anim = 0;
    n.gainT = Math.max(0, n.gainT - dt);
    n.pressT = Math.max(0, n.pressT - dt);
    n.lookT = Math.max(0, n.lookT - dt);
    if (n.lookT <= 0) n.lookX = 0;
    n.poke = Math.max(0, n.poke - dt);
    n.nameT = Math.max(0, n.nameT - dt);
    n.grewT = Math.max(0, n.grewT - dt);
    n.fullT = Math.max(0, n.fullT - dt);
    n.restT = Math.max(0, n.restT - dt);
    n.growWordT = Math.max(0, n.growWordT - dt);
    if (n.pause !== '') {
      n.pauseT = Math.max(0, n.pauseT - dt);
      if (n.pauseT <= 0) n.pause = '';
    }

    /* 2. 時間を進める（全停止中は止まる。看取りは byeT） */
    if (n.phase === 'life' && n.pause === '') n.t += dt;
    if (n.phase === 'bye' || n.phase === 'gone') n.byeT += dt;

    /* 3. 入力（いつでも受ける。無反応ゼロ） */
    if (takeTap(n)) handleTap(n, input.px, input.py);

    /* 4. 減り・呼び・よわり・病気・力尽きる（全停止中・反応中は減りを休む） */
    if (n.phase === 'life' && n.alive && n.pause === '') stepNeeds(n, dt);

    /* 5. 時間で起きること（孵化・場面転換・へんしん・看取り） */
    stepPhase(n, rng);

    /* 6. ひとり遊び（全停止中も体は動く＝固まって見せない） */
    if (n.phase === 'life') stepIdle(n, dt, rng);

    return n;
  },

  draw(g, s) {
    const [sx, sy] = shakeOffset(s, s.time);
    g.clear('bg2');
    // over 後はシェルの結果画面に全部ゆずる
    if (s.phase === 'gone') return;
    drawHead(g, s);
    drawWindow(g, s, sx, sy);
    if (s.phase === 'life') {
      drawFeedback(g, s);
      drawButtons(g, s);
    }
  },

  /**
   * 上手い人（設計 §11）。押すフレームだけ press を立てる。0.35秒に1手。
   * 病気→くすり ＞ よるで起きていれば なでる ＞ 値≤2 の欲求（いちばん低いものから。満腹には食べさせない）＞ 一番星 ＞ 待つ。
   */
  bot(s) {
    const frame = Math.round(s.time * 60);
    const idle = { press: false, px: CHAR_X, py: FLOOR_Y - 30 };
    if (frame % 21 !== 0) return idle;
    const btn = (i: number) => ({ press: true, px: BTN_X0 + i * BTN_GAP + BTN_W / 2, py: BTN_Y + BTN_H / 2 });
    const char = { press: true, px: CHAR_X + s.walkX, py: FLOOR_Y - 30 };

    if (s.phase === 'egg') return s.eggTaps < EGG_TAPS ? char : idle;
    if (s.phase === 'bye' || s.phase === 'gone') return frame % 63 === 0 ? char : idle;
    if (s.pause !== '') return idle;
    if (s.sick) return btn(3);
    if (s.t >= T_NIGHT) return s.tucked ? idle : char;
    // 人間の上手い人の揺らぎ: 55% は「気にする」で先回り（はやい）、30% は呼ばれて2秒で（ふつう）、
    // 15% は強く呼ばれてから（おそい・コンボが切れる）
    const tier = Math.floor(s.time * 1.7) % 20;
    const wait = tier < 11 ? -1 : tier < 17 ? 2 : 3.2;
    let pick: Need | -1 = -1;
    let low = 99;
    for (const i of [0, 1, 2] as const) {
      const v = needOf(s, i);
      const ready = wait < 0 ? v <= LV1_AT : v <= LV2_AT && callOf(s, i) >= wait;
      if (ready && v < low) {
        low = v;
        pick = i;
      }
    }
    if (pick === 0) return s.fullT > 0 ? idle : btn(0);
    if (pick === 1) return btn(1);
    if (pick === 2) return char;
    return idle;
  },

  reason: (s) => {
    const name = NAMES[s.nameId];
    if (s.early) return `${name}、${whenLabel(s.endT)}に おわかれ`;
    return `${name}（${FORM_NAME[s.form]}）、あさから よるまで`;
  },

  tunables: {
    drain: {
      label: '欲求が1減る秒数',
      min: 3,
      max: 9,
      get: () => TUNE.drain,
      set: (v) => {
        TUNE.drain = v;
      },
    },
    graceToDie: {
      label: '呼び始めから力尽きるまでの秒数',
      min: 12,
      max: 40,
      get: () => TUNE.graceToDie,
      set: (v) => {
        TUNE.graceToDie = v;
      },
    },
  },
});

/* ================================================================== *
 * step の中身
 * ================================================================== */

/** あさは呼びが多い（本家「最初の30分が最も忙しい」）。ゆうがたは落ち着く */
function drainSpan(s: IppunIsshoState, i: Need): number {
  const mul = s.t < T_NOON ? 0.6 : s.t < T_MORPH ? 1 : 1.5;
  const per = i === 0 ? 1 : i === 1 ? 1.3 : 1.6;
  const pace = i === 0 ? s.pace0 : i === 1 ? s.pace1 : s.pace2;
  return TUNE.drain * per * mul * pace;
}

/** 減り → 呼びの段階 → よわり（雨）→ ぐあいわるい → 力尽きる（設計 §6） */
function stepNeeds(n: IppunIsshoState, dt: number): void {
  const night = n.t >= T_NIGHT;
  // 応えた・治した直後の小休止だけ減らない（「次の呼びは前の反応が終わってから」。
  // 反応アニメ全般で止めると、なでる連打で永久に呼ばれなくなる＝原則3が壊れる）
  const busy = n.restT > 0;
  for (const i of [0, 1, 2] as const) {
    if (!night && !n.sick && !busy) {
      const span = drainSpan(n, i);
      const d = (i === 0 ? n.drain0 : i === 1 ? n.drain1 : n.drain2) + dt;
      if (d >= span) {
        const before = needOf(n, i);
        setNeed(n, i, before - 1);
        setDrain(n, i, d - span);
        if (before > LV2_AT && needOf(n, i) <= LV2_AT) beep(n);
      } else {
        setDrain(n, i, d);
      }
    }
    if (!night && needOf(n, i) <= LV2_AT) {
      const c = callOf(n, i);
      const c2 = c + dt;
      setCall(n, i, c2);
      if (c < LV3_AFTER && c2 >= LV3_AFTER) {
        n.urged = true;
        beep(n);
      }
      if (c < LV4_AFTER && c2 >= LV4_AFTER) {
        n.rained = true;
        breakCombo(n, 'コンボ おわり');
        beep(n);
        addShake(n, 0.15);
      }
      // Lv4 の間、3秒ごとにピピッ
      if (c2 >= LV4_AFTER && Math.floor((c2 - LV4_AFTER) / 3) !== Math.floor((c - LV4_AFTER) / 3)) beep(n);
      const lv5 = Math.max(LV4_AFTER + 1, TUNE.graceToDie - SICK_TO_DIE);
      if (!n.sick && c2 >= lv5) makeSick(n);
    } else {
      setCall(n, i, 0);
    }
  }
  if (n.sick) {
    n.sickT += dt;
    if (Math.floor(n.sickT / 2) !== Math.floor((n.sickT - dt) / 2)) beep(n);
    if (n.sickT >= SICK_TO_DIE) {
      n.endT = n.t;
      n.alive = false;
      startBye(n, true);
    }
  }
}

function makeSick(n: IppunIsshoState): void {
  n.sick = true;
  n.sickT = 0;
  n.rained = true;
  n.anim = 0;
  n.animT = 0;
  beep(n);
  addShake(n, 0.3);
  hitStop(n, 0.06);
}

/** 時間で起きること */
function stepPhase(n: IppunIsshoState, rng: Rng): void {
  switch (n.phase) {
    case 'egg':
      if (n.time >= n.hatchAt) {
        n.phase = 'life';
        n.t = 0;
        n.form = 'tsubu';
        n.nameT = NAME_T;
        gain(n, P_BORN);
        addPop(n);
        hitStop(n, 0.08);
        beep(n);
        n.lookT = 1.2;
      }
      break;

    case 'life': {
      if (!n.alive) break;
      if (n.beatDone < 1 && n.t >= T_NOON) {
        n.beatDone = 1;
        n.pause = 'noon';
        n.pauseT = PAUSE_BEAT;
        animate(n, 9, PAUSE_BEAT);
        n.grewT = 0.6;
        addPop(n);
        beep(n);
      }
      if (!n.morphed && n.t >= T_MORPH && (n.t >= T_MORPH_MAX || (!n.sick && n.animT <= 0 && n.pause === ''))) {
        n.morphed = true;
        n.form = formOf(n, rng);
        // 名前が付いた瞬間、その姿を完成形にする（球になる・足が伸びきる・毛が生えそろう）
        if (n.form === 'koro') n.maru = AXIS_MAX;
        else if (n.form === 'pyon') n.ashi = AXIS_MAX;
        else if (n.form === 'mofu') n.kenami = AXIS_MAX;
        gain(n, P_MORPH);
        if (n.form === 'kira') {
          n.score += P_KIRA;
          n.kira = true;
        }
        n.pause = 'morph';
        n.pauseT = PAUSE_MORPH;
        n.anim = 0;
        n.animT = 0;
        addPop(n);
        hitStop(n, 0.1);
        beep(n);
      }
      if (n.beatDone < 2 && n.t >= T_NIGHT) {
        n.beatDone = 2;
        n.pause = 'night';
        n.pauseT = PAUSE_BEAT;
        animate(n, 10, PAUSE_BEAT);
        n.call0 = n.call1 = n.call2 = 0;
        n.grewT = 0.6;
        addPop(n);
        beep(n);
      }
      // 病気のまま よるの終わりを迎えたら、それは早い別れ（倒れた絵に「たのしかった」を重ねない）
      if (n.t >= T_BYE) {
        if (n.sick) {
          n.endT = n.t;
          n.alive = false;
        }
        startBye(n, n.sick);
      }
      break;
    }

    case 'bye': {
      if (n.early && n.beeped < 3 && n.byeT >= 0.3 + n.beeped * 0.5) {
        beep(n);
        n.beeped++;
      }
      const shown = Math.floor((n.byeT - BYE_EPI) / EPI_STEP) + 1;
      if (n.byeT >= BYE_EPI && shown > n.epShown) {
        n.epShown = Math.min(4, shown);
        if (n.epShown === 1) addPop(n);
      }
      if (n.byeT >= BYE_END) {
        n.phase = 'gone';
        n.over = true;
      }
      break;
    }

    case 'gone':
      break;
  }
}

function startBye(n: IppunIsshoState, early: boolean): void {
  if (n.phase !== 'life') return;
  n.phase = 'bye';
  n.byeT = 0;
  n.beeped = 0;
  n.epShown = 0;
  n.early = early;
  n.alive = !early;
  n.pause = '';
  n.anim = 0;
  n.animT = 0;
  n.walkX = 0;
  if (early) {
    addShake(n, 0.5);
  } else {
    n.endT = T_BYE;
    gain(n, P_LIVED);
    if (!n.rained) n.score += P_CLEAN;
    if (!n.urged) n.score += P_CALM;

    addPop(n);
    hitStop(n, 0.08);
  }
}

/**
 * 名前が付く（設計 §7）。優先: たび ＞ きら ＞ いちばん伸びた軸 ＞ ぽよ（同点は運で寄せる）。
 * 世話の癖がそのまま姿になる。条件は隠す。
 */
function formOf(s: IppunIsshoState, rng: Rng): Form {
  const cares = s.fed + s.played + s.petted;
  if (cares <= 4 && s.rained) return 'tabi';
  // きら＝腕前: 雨を降らせず・3つの世話を均等に（運の要素は無い）
  const axes = [s.maru, s.ashi, s.kenami];
  const even = Math.max(...axes) - Math.min(...axes) <= 3;
  if (!s.rained && s.fed >= 2 && s.played >= 2 && s.petted >= 2 && even) return 'kira';
  const m = Math.max(s.maru, s.ashi, s.kenami);
  if (m <= 0) return 'poyo';
  const tops: Form[] = [];
  if (s.maru === m) tops.push('koro');
  if (s.ashi === m) tops.push('pyon');
  if (s.kenami === m) tops.push('mofu');
  if (tops.length === 1) return tops[0];
  return rng.chance(0.4) ? 'poyo' : tops[rng.int(tops.length)];
}

/** ひとり遊び（本家 §4「待機中の動きが愛着の源」） */
function stepIdle(n: IppunIsshoState, dt: number, rng: Rng): void {
  if (!n.alive) return;
  n.idleT -= dt;
  if (n.idleT <= 0) {
    const r = rng.int(100);
    n.idle = r < 55 ? 0 : r < 72 ? 1 : r < 84 ? 2 : r < 93 ? 3 : 4;
    n.idleT = 1.4 + rng.int(20) / 10;
    if (n.idle === 0 && rng.chance(0.4)) n.walkDir = -n.walkDir;
  }
  const lv = worstLevel(n);
  const still = n.sick || n.tucked || n.pause !== '' || n.anim === 2 || lv >= 4 || n.t >= T_NIGHT;
  if (still) {
    n.walkX *= Math.max(0, 1 - dt * 4);
    return;
  }
  if (lv >= 3) {
    n.walkX *= Math.max(0, 1 - dt * 3);
    return;
  }
  if (n.idle !== 0) return;
  const range = n.form === 'tabi' ? 84 : 40;
  const speed = n.form === 'tabi' ? 26 : n.t >= T_MORPH ? 11 : n.ashi >= 6 ? 24 : 16;
  n.walkX += n.walkDir * speed * dt;
  if (Math.abs(n.walkX) > range) {
    n.walkX = Math.sign(n.walkX) * range;
    n.walkDir = -n.walkDir;
  }
}

/* ================================================================== *
 * 入力（無反応ゼロ。設計 §5）
 * ================================================================== */

function handleTap(n: IppunIsshoState, px: number, py: number): void {
  /* たまご: どこを押しても温める。最初のタップ＝契約（1.2秒後に孵る） */
  if (n.phase === 'egg') {
    n.poke = 0.35;
    if (!n.touched) {
      n.touched = true;
      n.hatchAt = Math.min(n.hatchAt, n.time + EGG_HATCH);
    }
    if (n.eggTaps < EGG_TAPS) {
      n.eggTaps++;
      gain(n, P_WARM);
    }
    addPop(n);
    return;
  }
  if (n.phase === 'bye' || n.phase === 'gone') {
    byeTap(n);
    return;
  }

  const hit = hitTest(n, px, py);

  /* 全停止中: 見るだけ（押すとこちらを見る＝固まっていない） */
  if (n.pause !== '') {
    if (hit.what === 'btn') {
      n.pressBtn = hit.i;
      n.pressT = 0.15;
    }
    n.lookX = px < CHAR_X + n.walkX ? -1 : 1;
    n.lookT = 0.6;
    return;
  }

  switch (hit.what) {
    case 'btn':
      n.pressBtn = hit.i;
      n.pressT = 0.15;
      n.click = (n.click ?? 0) + 1;
      doCare(n, BTN_KINDS[hit.i]);
      return;
    case 'bubble': {
      // 吹き出しを押す＝その世話
      const b = bubbles(n)[hit.i];
      if (b) {
        n.pressBtn = BTN_KINDS.indexOf(b.kind);
        n.pressT = 0.15;
        n.click = (n.click ?? 0) + 1;
        doCare(n, b.kind);
      }
      return;
    }
    case 'char':
      pet(n);
      return;
    case 'sky':
      n.lookX = px < CHAR_X + n.walkX ? -1 : 1;
      n.lookT = 0.7;
      animate(n, 8, 0.7);
      return;
    default:
      n.lookX = px < CHAR_X + n.walkX ? -1 : 1;
      n.lookT = 0.6;
      animate(n, 8, 0.6);
      return;
  }
}

/** 育ちの軸を伸ばす（毎タップ体が変わる。欲しがっていないときは2倍＝舵） */
function grow(n: IppunIsshoState, axis: 0 | 1 | 2, wanted: boolean): void {
  if (n.morphed) return; // 名前が付いたら形は固定
  const add = wanted ? 1 : 2;
  if (axis === 0) n.maru = Math.min(AXIS_MAX, n.maru + add);
  else if (axis === 1) n.ashi = Math.min(AXIS_MAX, n.ashi + add);
  else n.kenami = Math.min(AXIS_MAX, n.kenami + add);
  n.grewT = 0.5;
  // 頼まれていない世話は点でなく「形の舵」。何が変わったかを言葉で見せる
  if (!wanted) {
    n.growWord = axis === 0 ? 'まるくなる' : axis === 1 ? 'あしがのびる' : 'けがはえる';
    n.growWordT = 1.0;
  }
}

/**
 * 呼んでいる最中（Lv≥2）に、それ以外の世話をしたか。
 * そのときは断る（「いまはそれじゃない」）。やみくもな連打を実際に弱くし、人には「聞いて」と伝わる。
 */
function offCall(s: IppunIsshoState, i: Need): boolean {
  if (levelOf(s, i) >= 2) return false;
  for (const j of [0, 1, 2] as const) if (j !== i && levelOf(s, j) >= 2) return true;
  return false;
}

/**
 * 欲求に応えた。**速さで点が変わり、連続で倍になる**（ルールは言葉で見せる）:
 *   はやい！（気にしているうち／呼ばれて1.5秒以内）＋5 ／ ふつう ＋3 ／ おそい（強く呼ばれてから）＋1 でコンボが切れる。
 *   3連続で ×2、5連続で ×3。
 */
function answer(n: IppunIsshoState, i: Need): void {
  const lv = levelOf(n, i);
  const c = callOf(n, i);
  if (lv >= 3) {
    n.combo = 0;
    gain(n, P_SLOW, 'おそい', 1);
  } else {
    n.combo++;
    n.comboMax = Math.max(n.comboMax, n.combo);
    const fast = lv <= 1 || c <= FAST_WITHIN;
    gain(n, fast ? P_FAST : P_NORMAL, fast ? 'はやい！' : '', multOf(n.combo));
  }
  setNeed(n, i, NEED_MAX);
  setCall(n, i, 0);
  setDrain(n, i, 0);
  n.restT = ANIM_T;
}

/** 世話ボタン4つ（設計 §5 の反応表。押して無反応になる枝を作らない） */
function doCare(n: IppunIsshoState, kind: Kind): void {
  const night = n.t >= T_NIGHT;
  switch (kind) {
    case 'gohan': {
      if (offCall(n, 0)) return refuse(n, true);
      if (n.sick || n.tucked || n.fullT > 0) return refuse(n);
      n.fed++;
      if (n.hunger >= NEED_MAX - 0.5) {
        // 満腹。点は無いが体は丸くなる（舵）。続けると「げふ」（笑える罰。病気にはしない）
        n.overfeed++;
        grow(n, 0, false);
        if (n.overfeed >= OVERFEED_AT) {
          n.overfeed = 0;
          n.fullT = FULL_T;
          n.hunger = NEED_MAX;
          setDrain(n, 0, -FULL_T); // 満腹の余韻: しばらく減らない＝「ごはん」を呼びながら断る矛盾を作らない
          animate(n, 7, 1.2);
          addShake(n, 0.2);
          return;
        }
        animate(n, 1, 0.7);
        return;
      }
      n.overfeed = 0;
      const wantedNow = levelOf(n, 0) >= 1;
      if (wantedNow) answer(n, 0);
      grow(n, 0, wantedNow); // 欲しがっていなければ体が丸くなるだけ（欲求は戻らない＝連打で延命しない）
      animate(n, 1, wantedNow ? ANIM_T : 0.7);
      addPop(n);
      return;
    }
    case 'asobu': {
      if (offCall(n, 1)) return refuse(n, true);
      if (n.sick || night || n.tucked) return refuse(n);
      n.played++;
      const wantedNow = levelOf(n, 1) >= 1;
      if (wantedNow) answer(n, 1);
      grow(n, 1, wantedNow);
      animate(n, 2, wantedNow ? ANIM_T : 0.8);
      addPop(n);
      return;
    }
    case 'nade':
      pet(n);
      return;
    case 'kusuri': {
      if (!n.sick) return refuse(n);
      n.sick = false;
      n.sickT = 0;
      n.bandage = true;
      n.cured++;
      // 治った直後にすぐ呼び直さない程度に戻す（全快にはしない＝偶然の1タップで全部帳消しにならない）
      for (const i of [0, 1, 2] as const) {
        setNeed(n, i, Math.max(needOf(n, i), 2));
        setCall(n, i, 0);
        setDrain(n, i, 0);
      }
      gain(n, P_CURE);
      n.restT = 1.4;
      animate(n, 4, 1.4);
      addPop(n);
      hitStop(n, 0.06);
      return;
    }
  }
}

/** キャラをタップ＝なでる（なでるボタンからも） */
function pet(n: IppunIsshoState): void {
  if (n.sick) {
    animate(n, 11, 0.7); // つらそうに震える（点なし）
    return;
  }
  if (n.t >= T_NIGHT) {
    if (!n.tucked) {
      n.tucked = true;
      gain(n, P_TUCK);
      animate(n, 5, 1.4);
      addPop(n);
      return;
    }
    animate(n, 3, 0.5);
    return;
  }
  if (offCall(n, 2)) return refuse(n, true);
  n.petted++;
  const wantedNow = levelOf(n, 2) >= 1;
  if (wantedNow) {
    n.petAt = n.t;
    answer(n, 2);
    grow(n, 2, true);
    animate(n, 3, ANIM_T);
    addPop(n);
    return;
  }
  if (n.t - n.petAt >= PET_EVERY) {
    n.petAt = n.t;
    grow(n, 2, false);
    animate(n, 3, 0.7);
    return;
  }
  animate(n, 3, 0.4); // 連打: ハート1つだけ
}

/** 断る（首を振る）。減点は無いが必ず見える。呼んでいる最中の違うボタンは「ちがう」でコンボが切れる */
function refuse(n: IppunIsshoState, wrong = false): void {
  animate(n, 6, 0.6);
  if (wrong) {
    breakCombo(n, 'ちがう');
    if (n.combo === 0 && n.gainT <= 0) {
      n.word = 'ちがう';
      n.gain = 0;
      n.gainT = 0.7;
      n.mult = 1;
    }
  }
}

function byeTap(n: IppunIsshoState): void {
  const marks = [BYE_LOOK, BYE_SEED, BYE_EPI, BYE_EPI + EPI_STEP, BYE_EPI + EPI_STEP * 2, BYE_EPI + EPI_STEP * 3, BYE_FORMS, BYE_END];
  for (const m of marks) {
    if (n.byeT < m - 0.05) {
      n.byeT = m;
      return;
    }
  }
  addPop(n);
}

/* ================================================================== *
 * 描画。世界は1ビット（ink と bg）。強調は反転・点滅・太さだけ。
 * 文字を出す関数: drawHead / drawNameBanner / drawBanner / drawEpitaph / drawGain。
 * 見出しの下には必ず下地（hole）を敷く（重ねると読めなくなる＝実機で5回起きた）。
 * ================================================================== */

function drawHead(g: Painter, s: IppunIsshoState): void {
  if (s.phase === 'egg') {
    g.text('たまご', 6, HEAD_Y, { size: 12, color: 'ink' });
    return;
  }
  const t = s.phase === 'life' ? s.t : s.endT;
  g.text(whenLabel(t), 6, HEAD_Y, { size: 12, color: 'ink' });
}

/** 液晶の窓。角丸四角＋ink の枠線（卵型にしない） */
function windowFrame(g: Painter, blink: boolean): void {
  for (let row = 0; row < CORNER.length; row++) {
    const cw = CORNER[row];
    g.rect(WIN_X, WIN_Y + row, cw, 1, 'bg2');
    g.rect(WIN_X + WIN_W - cw, WIN_Y + row, cw, 1, 'bg2');
    g.rect(WIN_X, WIN_Y + WIN_H - 1 - row, cw, 1, 'bg2');
    g.rect(WIN_X + WIN_W - cw, WIN_Y + WIN_H - 1 - row, cw, 1, 'bg2');
  }
  const t = blink ? WIN_LINE + 1 : WIN_LINE;
  const r = 5;
  g.rect(WIN_X + r, WIN_Y, WIN_W - r * 2, t, 'ink');
  g.rect(WIN_X + r, WIN_Y + WIN_H - t, WIN_W - r * 2, t, 'ink');
  g.rect(WIN_X, WIN_Y + r, t, WIN_H - r * 2, 'ink');
  g.rect(WIN_X + WIN_W - t, WIN_Y + r, t, WIN_H - r * 2, 'ink');
  for (let i = 0; i < 2; i++) {
    const d = 3 - i;
    const o = r - 3 + i * 2;
    g.rect(WIN_X + o, WIN_Y + d, 2, t, 'ink');
    g.rect(WIN_X + WIN_W - o - 2, WIN_Y + d, 2, t, 'ink');
    g.rect(WIN_X + o, WIN_Y + WIN_H - d - t, 2, t, 'ink');
    g.rect(WIN_X + WIN_W - o - 2, WIN_Y + WIN_H - d - t, 2, t, 'ink');
    g.rect(WIN_X + d, WIN_Y + o, t, 2, 'ink');
    g.rect(WIN_X + d, WIN_Y + WIN_H - o - 2, t, 2, 'ink');
    g.rect(WIN_X + WIN_W - d - t, WIN_Y + o, t, 2, 'ink');
    g.rect(WIN_X + WIN_W - d - t, WIN_Y + WIN_H - o - 2, t, 2, 'ink');
  }
}

function drawWindow(g: Painter, s: IppunIsshoState, sx: number, sy: number): void {
  const dark = darkNow(s);
  g.rect(WIN_X, WIN_Y, WIN_W, WIN_H, dark ? 'ink' : 'bg');

  // 起動時の点灯チェック。全ドットが 0.3秒 光って消える
  if (s.phase === 'egg' && s.time < 0.3) {
    g.rect(WIN_X + 4, WIN_Y + 4, WIN_W - 8, WIN_H - 8, 'ink');
    windowFrame(g, false);
    return;
  }
  const ink: ColorKey = dark ? 'bg' : 'ink';
  const hole: ColorKey = dark ? 'ink' : 'bg';

  g.clip(WIN_X, WIN_Y, WIN_W, WIN_H, () => {
    if (s.phase === 'egg') {
      drawEgg(g, s, sx, sy);
    } else if (s.phase === 'bye') {
      drawBye(g, s, sx, sy, ink, hole);
    } else {
      drawSky(g, s, ink, hole);
      drawRain(g, s, ink);
      g.rect(WIN_X + 4, FLOOR_Y + 1, WIN_W - 8, 2, ink);
      drawProps(g, s, ink, hole);
      drawCreature(g, s, CHAR_X + s.walkX + sx, FLOOR_Y + sy, ink, hole);
      if (s.pause === '') {
        drawBubbles(g, s, ink, hole);
      }
      drawNameBanner(g, s, ink, hole);
      drawBanner(g, s, ink, hole);
    }
  });

  // ぐあいわるい: 枠が点滅して「あぶない」
  const warn = s.phase === 'life' && s.sick && Math.floor(s.time * 6) % 2 === 0;
  windowFrame(g, warn);
}

/** 窓の空。太陽が左→右へ動き、ゆうがたは地平線、よるは月と星（「一日の命」を目線の中に） */
function drawSky(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  if (s.t >= T_NIGHT) {
    const mx = WIN_X + WIN_W - 36;
    const my = WIN_Y + 26;
    g.circle(mx, my, 9, ink);
    g.circle(mx + 4, my - 3, 8, hole);
    const stars: [number, number][] = [
      [30, 22],
      [70, 14],
      [110, 28],
      [150, 12],
      [60, 44],
      [130, 50],
    ];
    for (const [px, py] of stars) {
      if (Math.floor(s.time * 2 + px) % 3 === 0) continue;
      g.rect(WIN_X + px, WIN_Y + py, 2, 2, ink);
    }
    return;
  }
  // 雨の間は雲に隠れる（晴れと雨を同時に出さない）
  if (worstLevel(s) >= 4 || s.sick) return;
  // 太陽は左の低い所から昇り、ひるに真上、ゆうがたは右へ下りながら窓の右端の外へ沈む（一日の命の記号）。
  // キャラや吹き出しの帯（y≥90）には下りてこない
  const p = Math.min(T_NIGHT, s.t) / T_NIGHT;
  const cx = WIN_X + 22 + p * (WIN_W + 4);
  const top = WIN_Y + 34;
  const cy = p < 0.5 ? top + 26 - Math.sin(p * Math.PI) * 26 : top + ((p - 0.5) / 0.5) * 26;
  g.circle(cx, cy, 7, ink);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.line(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, ink, 2);
  }
  void hole;
}

/** 雨。よわる（Lv4）で小雨、ぐあいわるい（Lv5）で大雨 */
function drawRain(g: Painter, s: IppunIsshoState, ink: ColorKey): void {
  if (s.phase !== 'life' || !s.alive) return;
  const lv4 = worstLevel(s) >= 4;
  if (!lv4 && !s.sick) return;
  // 頭の上に雨雲（雨粒より先に目に入る「よくない」の記号）
  const cx = CHAR_X + s.walkX;
  const cy = FLOOR_Y - 16 * dotOf(s) - legLen(s) - 30;
  g.circle(cx - 10, cy + 2, 7, ink);
  g.circle(cx + 2, cy - 2, 9, ink);
  g.circle(cx + 13, cy + 3, 6, ink);
  const count = s.sick ? 22 : 12;
  for (let i = 0; i < count; i++) {
    const x = WIN_X + 10 + ((i * 37) % (WIN_W - 20));
    const span = FLOOR_Y - WIN_Y - 14;
    const y = WIN_Y + 10 + (((s.time * 120 + i * 29) % span) | 0);
    const len = s.sick ? 10 : 8;
    g.line(x + 3, y, x, y + len, ink, 2);
  }
}

/** 床の上の小物: ごはんの皿・ボール・ねむりの Zzz */
function drawProps(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  if (s.anim === 1 && s.animT > 0) {
    const x = CHAR_X + s.walkX + 8 * dotOf(s) + 8;
    g.rect(x - 10, FLOOR_Y - 6, 20, 3, ink);
    g.rect(x - 7, FLOOR_Y - 10, 14, 4, ink);
  }
  if (s.anim === 2 && s.animT > 0) {
    const p = 1 - s.animT / ANIM_T;
    const bx = CHAR_X + Math.sin(p * Math.PI * 2) * 70;
    drawIcon(g, 'asobu', bx, FLOOR_Y - 9, 16, ink, hole);
  }
  if (s.tucked && s.phase === 'life') {
    // ねむり: 「z」を3つ、斜め上へ（字でなくドット絵。吹き出しや＋N と重ならない左側に）
    const x0 = CHAR_X + s.walkX - 8 * dotOf(s) - 30;
    const y0 = FLOOR_Y - 16 * dotOf(s) + 10;
    for (let i = 0; i < 3; i++) {
      const sc = 2 + i;
      const on = Math.floor(s.time * 1.5 + i) % 3 !== 2;
      if (on) g.sprite(ZEE, x0 - i * 20, y0 - i * 24, { scale: sc, colors: { X: ink } });
    }
  }
}

/* ---- キャラ（3軸で形を作る。設計 §7）-------------------------------- */

function bodyOf(s: IppunIsshoState): readonly string[] {
  if (s.maru >= 4) return BODY_MANMARU;
  if (s.maru >= 2) return BODY_KORO;
  if (s.t >= T_NOON || s.phase !== 'life') return BODY_POYO;
  return BODY_TSUBU;
}

type Mood = 'futsu' | 'niko' | 'shon' | 'nemu' | 'kaze' | 'kininaru';

function moodOf(s: IppunIsshoState): Mood {
  if (s.phase === 'bye') return s.early ? 'kaze' : 'niko';
  if (s.sick) return 'kaze';
  if (s.tucked || s.anim === 5) return 'nemu';
  if (s.anim === 6 || s.anim === 7 || s.anim === 11) return 'shon';
  if (s.anim >= 1 && s.anim <= 4) return 'niko';
  if (s.t >= T_NIGHT) return 'nemu';
  const lv = worstLevel(s);
  if (lv >= 4) return 'shon';
  if (lv >= 1) return 'kininaru';
  return s.pause !== '' ? 'niko' : 'futsu';
}

function drawCreature(g: Painter, s: IppunIsshoState, cx: number, footY: number, ink: ColorKey, hole: ColorKey): void {
  const dot = dotOf(s);
  const body = bodyOf(s);
  const w = 16 * dot;
  const h = 16 * dot;
  const lv = worstLevel(s);
  const ball = s.maru >= 6;
  const legs = legLen(s);

  // 跳ね: げんきなら時々ぴょこ。あし軸が長いと高く。よわっていれば無し
  let hop = 0;
  if (s.phase === 'life' && s.alive && !s.sick && !s.tucked && lv < 4 && s.pause === '' && s.anim !== 11) {
    const period = s.ashi >= 6 ? 0.45 : 0.9;
    const ph = (s.time % period) / period;
    const amp = s.ashi >= 6 ? 12 : lv >= 2 ? 0 : 4;
    hop = ph < 0.5 ? Math.sin(ph * Math.PI * 2) * amp : 0;
  }
  if (s.anim === 2 && s.animT > 0) hop = Math.abs(Math.sin(s.time * 14)) * 10;
  const sag = s.sick ? 6 : lv >= 4 ? 4 : 0;
  const lift = Math.round(s.pop * 5) + (s.anim === 9 ? 6 : 0);
  const grew = s.grewT > 0 ? Math.sin(s.grewT * 30) * 2 : 0;
  const x = Math.round(cx - w / 2 + grew);
  const pad = footPad(body) * dot;
  const y = Math.round(footY - h + pad - legs - hop - lift + sag);

  if (s.sick || s.anim === 7) {
    // 倒れる（横向き）: 横長の楕円。病気は×目＋汗、げふは目を閉じて汗だけ（病気と同じ絵にしない）
    const ry = Math.round(h * 0.45);
    g.circle(cx, footY - ry + 2, ry, ink);
    drawFaceAt(g, s, cx, footY - ry - 6, hole, s.sick ? 'kaze' : 'nemu', dot);
    const d = (s.time * 40) % 18;
    g.circle(cx + ry + 8, footY - ry - 4 + d, 3, ink);
    // 病気中の反応（震え・断る・ん？）も見せる＝無反応にしない
    const ax2 = cx + ry + 12;
    const ay2 = footY - ry * 2;
    if (s.anim === 11 && s.animT > 0) {
      g.rect(ax2, ay2 + 4, 2, 8, ink);
      g.rect(ax2 + 5, ay2 + 2, 2, 8, ink);
    }
    if ((s.anim === 6 || s.anim === 8) && s.animT > 0) {
      g.rect(ax2, ay2 - 8, 3, 10, ink);
      g.rect(ax2, ay2 + 5, 3, 3, ink);
    }
    return;
  }

  /* 足（あし軸）。球なら無い */
  if (legs > 0 && !ball) {
    g.rect(x + 5 * dot, footY - legs, dot, legs, ink);
    g.rect(x + 10 * dot, footY - legs, dot, legs, ink);
  }

  /* 体。まる≥6 は球（円で描く＝スプライトの丸とは別物に見える）。きら は白抜き（反転発光） */
  if (ball) {
    const r = Math.round(8 * dot);
    const bcx = cx;
    const bcy = y + h / 2;
    if (s.form === 'kira') {
      g.circle(bcx, bcy, r + 2, ink);
      g.circle(bcx, bcy, r, hole);
    } else {
      g.circle(bcx, bcy, r, ink);
    }
  } else if (s.form === 'kira') {
    g.sprite(body, x - 1, y - 1, { scale: dot, colors: { X: ink } });
    g.sprite(body, x + 1, y + 1, { scale: dot, colors: { X: ink } });
    g.sprite(body, x, y, { scale: dot, colors: { X: hole } });
  } else {
    g.sprite(body, x, y, { scale: dot, colors: { X: ink } });
  }
  const faceInk: ColorKey = s.form === 'kira' ? ink : hole;

  /* 耳（あし軸 4 以上） */
  if (s.ashi >= 4 && !ball) {
    g.rect(x + 3 * dot, y - 3 * dot + 2, dot, 3 * dot, ink);
    g.rect(x + 12 * dot, y - 3 * dot + 2, dot, 3 * dot, ink);
  }
  /* 毛（けなみ軸）。外周に棘。8 以上でふわふわ揺れる */
  if (s.kenami >= 1) {
    const spikes = Math.min(12, s.kenami * 2 + 2);
    const wob = s.kenami >= 8 ? Math.sin(s.time * 6) * 2 : 0;
    // 毛は絵の実寸（16×16 の枠ではなく、塗られている範囲）に沿わせる＝浮いて見せない
    const [bw, bh, bcy] = bodyExtent(body);
    const rx = (bw / 2) * dot + wob;
    const ry = (bh / 2) * dot + wob;
    const cyb = y + bcy * dot;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 - Math.PI / 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // 底辺は体の縁の内側、先端は外へ 7px
      const bx = cx + ca * (rx - 5);
      const by = cyb + sa * (ry - 5);
      const tx = cx + ca * (rx + 7);
      const ty = cyb + sa * (ry + 7);
      g.poly([bx - sa * 4, by + ca * 4, bx + sa * 4, by - ca * 4, tx, ty], ink);
    }
  }
  /* 持ち物 */
  if (s.form === 'tabi') {
    g.rect(x + 5 * dot, y - 4 * dot, 6 * dot, 4 * dot, ink); // 山
    g.rect(x + 2 * dot, y - dot, 12 * dot, dot, ink); // つば
    g.rect(x + 2 * dot, y + 11 * dot, 12 * dot, dot + 2, ink); // 首巻き
    g.rect(x + 2 * dot, y + 11 * dot + 1, 12 * dot, 1, hole);
  }
  if (s.bandage) {
    g.rect(x + 2 * dot, y + 10 * dot, 4 * dot, dot, faceInk);
    g.rect(x + 3 * dot + 1, y + 9 * dot, dot, 3 * dot, faceInk);
  }
  if (s.form === 'kira') {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + s.time * 2;
      const px = cx + Math.cos(a) * (w * 0.7);
      const py = y + h / 2 + Math.sin(a) * (h * 0.6);
      g.rect(px - 1, py - 5, 3, 11, ink);
      g.rect(px - 5, py - 1, 11, 3, ink);
    }
  }

  drawFaceAt(g, s, cx, y + (s.ashi >= 4 ? 7 : 6) * dot, faceInk, moodOf(s), dot);

  /* 反応のまわりの絵 */
  const ax = cx + 8 * dot + 6;
  const ay = y + 2;
  if (s.anim === 3 && s.animT > 0) {
    const many = s.animT > 0.9;
    g.sprite(HEART, ax, ay, { scale: 3, colors: { X: ink }, center: true });
    if (many) {
      g.sprite(HEART, ax + 14, ay - 12, { scale: 2, colors: { X: ink }, center: true });
      g.sprite(HEART, ax - 4, ay - 16, { scale: 2, colors: { X: ink }, center: true });
    }
  }
  if (s.anim === 1 && s.animT > 0) g.rect(cx - 2, y + 11 * dot, 4, 4, faceInk);
  if (s.anim === 4 && s.animT > 0) {
    for (let k = 0; k < 4; k++) {
      const a = k * 1.57 + s.time * 5;
      g.rect(cx + Math.cos(a) * (w * 0.6) - 1, y + h / 2 + Math.sin(a) * (h * 0.5) - 1, 3, 3, ink);
    }
  }
  if ((s.anim === 6 || s.anim === 8) && s.animT > 0) {
    // いや／ん？: 頭の横に小さな印（字ではなく絵）
    g.rect(ax - 2, ay - 8, 3, 10, ink);
    g.rect(ax - 2, ay + 5, 3, 3, ink);
  }
  if (s.anim === 11 && s.animT > 0) {
    g.rect(ax, ay + 4, 2, 8, ink);
    g.rect(ax + 5, ay + 2, 2, 8, ink);
  }
  if (s.anim === 10 && s.animT > 0) g.circle(cx, y + (s.ashi >= 4 ? 7 : 6) * dot + 18, Math.round(dot * 1.2), faceInk);
}

/** 絵の塗られている範囲（幅・高さ・中心の行）。毛や耳をスプライトの実寸に沿わせるため */
function bodyExtent(pattern: readonly string[]): [number, number, number] {
  let top = -1;
  let bottom = -1;
  let left = 99;
  let right = -1;
  for (let r = 0; r < pattern.length; r++) {
    const row = pattern[r];
    const l = row.indexOf('X');
    if (l < 0) continue;
    if (top < 0) top = r;
    bottom = r;
    left = Math.min(left, l);
    right = Math.max(right, row.lastIndexOf('X'));
  }
  if (top < 0) return [16, 16, 8];
  return [right - left + 1, bottom - top + 1, (top + bottom + 1) / 2];
}

/** その絵の下にある空白行の数 */
function footPad(pattern: readonly string[]): number {
  let pad = 0;
  for (let i = pattern.length - 1; i >= 0; i--) {
    if (/[^. ]/.test(pattern[i])) break;
    pad++;
  }
  return pad;
}

/** 顔は本体に空けた「穴」で描く。1ビットの液晶はこう見える */
function drawFaceAt(g: Painter, s: IppunIsshoState, cx: number, ey: number, hole: ColorKey, mood: Mood, dot: number): void {
  // 断る（anim 6）は首振り＝目が左右に速く揺れる
  const look =
    s.anim === 6 && s.animT > 0
      ? Math.round(Math.sin(s.time * 28) * 4)
      : s.lookX !== 0
        ? s.lookX * 2
        : Math.floor(s.time / 3.2) % 3 === 0
          ? 0
          : s.walkDir;
  const gap = Math.round(dot * 2.5);
  const ex = [cx - gap - 3 + look, cx + gap - 3 + look];
  const narrow = s.kenami >= 8; // もふは目が細い
  for (const x of ex) {
    switch (mood) {
      case 'nemu':
        g.rect(x - 1, ey + 3, 8, 3, hole);
        break;
      case 'kaze': {
        // ぎゅっと閉じた目「> <」（×目は「死んだ」に見える）
        const left = x < cx;
        const tipX = left ? x + 6 : x;
        const baseX = left ? x : x + 6;
        g.line(baseX, ey - 1, tipX, ey + 3, hole, 3);
        g.line(tipX, ey + 3, baseX, ey + 7, hole, 3);
        break;
      }
      case 'niko':
        g.rect(x, ey + 4, 6, 3, hole);
        g.rect(x - 1, ey + 1, 2, 3, hole);
        g.rect(x + 5, ey + 1, 2, 3, hole);
        break;
      case 'kininaru':
        g.rect(x, ey - 1, 6, narrow ? 3 : 6, hole);
        break;
      case 'shon':
        g.rect(x, ey + 2, 6, narrow ? 3 : 5, hole);
        break;
      default:
        g.rect(x, ey, 6, narrow ? 3 : 7, hole);
    }
  }
  const my = ey + 16;
  if (mood === 'niko') {
    const open = s.anim === 1 && Math.floor(s.time * 8) % 2 === 0;
    if (open) g.rect(cx - 5 + look, my - 2, 10, 7, hole);
    else {
      g.rect(cx - 6 + look, my, 12, 3, hole);
      g.rect(cx - 8 + look, my - 3, 3, 3, hole);
      g.rect(cx + 5 + look, my - 3, 3, 3, hole);
    }
  } else if (mood === 'shon' || mood === 'kaze') {
    g.rect(cx - 5 + look, my, 10, 3, hole);
  } else if (mood !== 'nemu') {
    g.rect(cx - 3 + look, my, 6, 3, hole);
  }
}

/** 吹き出し（キャラの頭に追従）。Lv1 小・Lv2 以上 大。Lv3 以上は点滅。中はボタンと同じ絵 */
function drawBubbles(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  const bs = bubbles(s);
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    const at = bubbleAt(s, i);
    const small = b.lv === 1;
    if (b.lv >= 3 && b.lv !== 5 && Math.floor(s.time * 4) % 2 === 1) continue;
    const r = small ? 11 : BUBBLE_R;
    const side = i === 0 ? 1 : -1;
    g.circle(at.x, at.y, r + 2, ink);
    g.circle(at.x, at.y, r, hole);
    g.poly([at.x - side * 6, at.y + r - 2, at.x - side * (r + 2), at.y + r + 8, at.x + side * 2, at.y + r + 1], ink);
    g.poly([at.x - side * 5, at.y + r - 3, at.x - side * (r - 1), at.y + r + 5, at.x + side * 1, at.y + r - 1], hole);
    drawIcon(g, b.kind, at.x, at.y, small ? 14 : 22, ink, hole);
    if (b.lv >= 3) {
      g.rect(at.x + r - 2, at.y - r - 6, 3, 9, ink);
      g.rect(at.x + r - 2, at.y - r + 5, 3, 3, ink);
    }
  }
}

/**
 * 手応えの帯（窓とボタンの間）。**ルールが読める場所**にすべてを一列で:
 *   「はやい！ ＋5 ×2」「＋3」「おそい ＋1」「ちがう」「コンボ おわり」「まるくなる」
 * 窓の中に出すと大きい体の上に場所が無く、頭や枠と重なった（実測）。ここなら何とも重ならない。
 */
function drawFeedback(g: Painter, s: IppunIsshoState): void {
  if (s.phase !== 'life') return;
  let text = '';
  if (s.gainT > 0) {
    if (s.gain > 0) {
      text = `${s.word ? `${s.word}　` : ''}＋${s.gain}${s.mult > 1 ? `　×${s.mult}` : ''}`;
    } else if (s.word) {
      text = s.word;
    }
  } else if (s.growWordT > 0 && s.growWord) {
    text = s.growWord;
  }
  if (!text) return;
  const big = s.gain > 0 && s.gainT > GAIN_T - 0.15;
  g.text(text, W / 2, FEED_Y - (big ? 1 : 0), { size: big ? 16 : 14, align: 'center', color: 'ink' });
}

/** 名前（孵化の瞬間に1回だけ大きく。字①） */
function drawNameBanner(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  if (s.nameT <= 0 || s.pause !== '') return;
  g.rect(WIN_X + 3, WIN_Y + 6, WIN_W - 6, 34, hole);
  g.text(NAMES[s.nameId], W / 2, WIN_Y + 12, { size: 20, align: 'center', color: ink });
}

/** 場面の見出し（全停止中だけ。字②）。下地を必ず敷く。キャラの頭にかからない高さに収める */
function drawBanner(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  if (s.pause === '') return;
  // 帯は y 44〜90。キャラの頭（座っているので dot5 で y≥110）にかからない
  g.rect(WIN_X + 3, WIN_Y + 4, WIN_W - 6, 46, hole);
  if (s.pause === 'morph') {
    const goals = meta.goals ?? [];
    let title = '';
    for (const goal of goals) if (s.score >= goal.score) title = goal.label;
    g.text(`${NAMES[s.nameId]}は ${FORM_NAME[s.form]}に なった！`, W / 2, WIN_Y + 6, { size: 16, align: 'center', color: ink });
    g.text(`しあわせ ${s.score}${title ? `・${title}` : ''}`, W / 2, WIN_Y + 30, {
      size: 11,
      align: 'center',
      color: ink,
    });
    if (s.pauseT > PAUSE_MORPH - 0.25) g.rect(WIN_X + 3, WIN_Y + 3, WIN_W - 6, WIN_H - 6, hole); // 白く光る
    return;
  }
  if (s.pause === 'night') {
    g.text('よる', W / 2, WIN_Y + 6, { size: 18, align: 'center', color: ink });
    g.text('もうすぐ おわかれ', W / 2, WIN_Y + 30, { size: 11, align: 'center', color: ink });
  } else {
    g.text('ひる', 96, WIN_Y + 10, { size: 20, align: 'center', color: ink });
    const cx = 150;
    const cy = WIN_Y + 24;
    g.circle(cx, cy, 7, ink);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.line(cx + Math.cos(a) * 10, cy + Math.sin(a) * 10, cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, ink, 2);
    }
  }
}

/* ---- たまご ---------------------------------------------------------- */

function drawEgg(g: Painter, s: IppunIsshoState, sx: number, sy: number): void {
  const waiting = !s.touched;
  const wob = Math.sin(s.time * (s.poke > 0 ? 26 : waiting ? 3 : 10)) * (s.poke > 0 ? 4 : waiting ? 1.5 : 3);
  const ex = CHAR_X + sx + wob;
  const ey = FLOOR_Y - 30 + sy;
  g.sprite(EGG, ex, ey, { scale: 4, colors: { X: 'ink' }, center: true });
  if (s.touched) {
    g.rect(ex - 2, ey - 10, 3, 8, 'bg');
    g.rect(ex + 1, ey - 3, 3, 6, 'bg');
    g.rect(ex - 6, ey + 2, 3, 5, 'bg');
  }
  g.rect(WIN_X + 4, FLOOR_Y, WIN_W - 8, 2, 'ink');
  g.rect(WIN_X + 3, FLOOR_Y + 2, WIN_W - 6, WIN_H - (FLOOR_Y + 2 - WIN_Y) - 3, 'bg');
  // 6つの姿の影絵を たまごの両脇に（この卵からどれかが生まれる＝0秒から目標がある。字は無し）
  const slots = [34, 60, 86, 154, 180, 206];
  for (let i = 0; i < FORMS_ALL.length; i++) drawMiniForm(g, FORMS_ALL[i], slots[i], FLOOR_Y - 16, false, 'ink', 'bg');
  // 押す場所を示す「指さし」がたまごを叩く（字ではなく絵。ゆっくり上下して、触れた瞬間に波紋）
  if (waiting) {
    const ph = (s.time % 1.2) / 1.2;
    const down = ph < 0.5 ? ph * 2 : (1 - ph) * 2;
    // たまごの真上から指さす手（人さし指が下向き・にぎった指が右に並ぶ）。大きく、たまごに触れるまで下りる
    const fx = CHAR_X + 6;
    const fy = ey - 104 + down * 30;
    g.circle(fx, fy + 34, 5, 'ink'); // 指先（丸）
    g.rect(fx - 5, fy, 10, 36, 'ink'); // 人さし指
    g.rect(fx + 5, fy + 6, 10, 18, 'ink'); // 中指
    g.rect(fx + 15, fy + 8, 9, 16, 'ink'); // 薬指
    g.rect(fx + 24, fy + 10, 7, 13, 'ink'); // 小指
    g.rect(fx - 5, fy, 36, 8, 'ink'); // 手の甲
    g.rect(fx - 14, fy + 3, 10, 6, 'ink'); // 親指
    if (down > 0.9) {
      g.circleLine(ex, ey - 6, 18, 'ink', 2);
      g.circleLine(ex, ey - 6, 26, 'ink', 1);
    }
  }
}

/* ---- おわかれ（設計 §8）-------------------------------------------- */

function drawBye(g: Painter, s: IppunIsshoState, sx: number, sy: number, ink: ColorKey, hole: ColorKey): void {
  g.rect(WIN_X + 4, FLOOR_Y, WIN_W - 8, 2, ink);
  if (!s.early) {
    const stars: [number, number][] = [
      [30, 22],
      [70, 14],
      [110, 28],
      [150, 12],
      [60, 44],
      [190, 30],
    ];
    for (const [px, py] of stars) {
      if (Math.floor(s.time * 2 + px) % 3 === 0) continue;
      g.rect(WIN_X + px, WIN_Y + py, 2, 2, ink);
    }
  }

  if (s.byeT < BYE_LOOK) {
    drawCreature(g, s, CHAR_X + sx, FLOOR_Y + sy, ink, hole);
    g.rect(WIN_X + 3, WIN_Y + 6, WIN_W - 6, 28, hole);
    // 言葉は2つ: よるまで「きょう、たのしかった」／早い別れ「つぎは そばに いて」（罰でなく次への誘い）
    g.text(s.early ? 'つぎは そばに いて' : 'きょう、たのしかった', W / 2, WIN_Y + 12, { size: 14, align: 'center', color: ink });
  } else if (s.byeT < BYE_LOOK + BYE_LIGHT) {
    const p = (s.byeT - BYE_LOOK) / BYE_LIGHT;
    const n = s.early ? 3 : 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const spread = s.early ? 6 : 18 + p * 40;
      const px = CHAR_X + Math.cos(a) * spread;
      const py = FLOOR_Y - 30 - p * 120 + Math.sin(a) * spread * 0.4;
      const r = Math.max(1, 5 - p * 4);
      g.rect(px - r, py - r, r * 2, r * 2, ink);
    }
  }

  if (s.byeT >= BYE_SEED) {
    g.circle(CHAR_X, FLOOR_Y - 5, 5, ink);
    g.rect(CHAR_X - 6, FLOOR_Y - 6, 12, 3, ink);
    if (s.bandage) g.rect(CHAR_X + 12, FLOOR_Y - 8, 8, 3, ink);

    if (s.tucked) {
      g.circle(CHAR_X + 26, FLOOR_Y - 10, 4, ink);
      g.circle(CHAR_X + 28, FLOOR_Y - 11, 3, hole);
    }
  }
  drawEpitaph(g, s, ink, hole);
}

/** 記念の文（字③）。flat な統計から組む。3行のあと、6つの姿の列（今回の姿だけ塗る） */
function drawEpitaph(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  if (s.epShown <= 0) return;
  const name = NAMES[s.nameId];
  // 4行目＝その一生の出来事（毎回違う）
  const event = s.comboMax >= 5
    ? `さいこう ${s.comboMax}れんぞくで こたえた`
    : s.bandage
        ? 'いちど たおれて、なおった'
        : !s.rained && !s.early
          ? 'いちども なかなかった'
          : s.tucked
            ? 'さいごは ねむって'
            : s.early
              ? 'あめが ふっていた'
              : 'ふつうの いちにち';
  const lines = s.early
    ? [s.form === 'tsubu' ? `${name}は まだ あかちゃんだった` : `${name}は ${FORM_NAME[s.form]}だった`, 'まっていた', event, `${whenLabel(s.endT)}に おわかれ`]
    : [`${name}は ${FORM_NAME[s.form]}に なった`, FORM_WHY[s.form], event, s.form === 'tabi' ? 'ひとりで いきた' : 'あさから よるまで いっしょだった'];
  g.rect(WIN_X + 3, WIN_Y + 4, WIN_W - 6, EPI_Y + EPI_LINE * 4 - WIN_Y, hole);
  for (let i = 0; i < Math.min(s.epShown, 4); i++) {
    g.text(lines[i], W / 2, EPI_Y + i * EPI_LINE, { size: 11, align: 'center', color: ink });
  }
  if (s.byeT >= BYE_FORMS) {
    // 6つの姿を小さな影絵で（今回の姿は塗り・ほかは輪郭）。「ほかにもある」＝もう一回の理由
    const y = FLOOR_Y - 40;
    for (let i = 0; i < FORMS_ALL.length; i++) {
      const f = FORMS_ALL[i];
      const x = 38 + i * 33;
      const mine = f === s.form;
      drawMiniForm(g, f, x, y, mine, ink, hole);
    }
  }
}

/** 姿の影絵（記念の列）。体は丸、姿ごとの特徴を1つだけ足す */
function drawMiniForm(g: Painter, f: Form, x: number, y: number, solid: boolean, ink: ColorKey, hole: ColorKey): void {
  const r = f === 'koro' ? 9 : 7;
  const body = () => {
    if (solid) g.circle(x, y, r, ink);
    else g.circleLine(x, y, r, ink, 2);
  };
  switch (f) {
    case 'pyon':
      g.rect(x - 5, y - r - 5, 2, 6, ink);
      g.rect(x + 3, y - r - 5, 2, 6, ink);
      body();
      g.rect(x - 4, y + r - 1, 2, 7, ink);
      g.rect(x + 2, y + r - 1, 2, 7, ink);
      break;
    case 'mofu':
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        g.rect(x + Math.cos(a) * (r + 2) - 2, y + Math.sin(a) * (r + 2) - 2, 4, 4, ink);
      }
      body();
      break;
    case 'tabi':
      body();
      g.rect(x - 4, y - r - 5, 8, 5, ink);
      g.rect(x - 8, y - r - 1, 16, 2, ink);
      break;
    case 'kira':
      g.circle(x, y, r + 1, ink);
      g.circle(x, y, r - 1, hole);
      if (solid) g.circle(x, y, r - 3, ink);
      for (let k = 0; k < 4; k++) {
        const a = k * 1.57 + 0.78;
        g.rect(x + Math.cos(a) * (r + 6) - 1, y + Math.sin(a) * (r + 6) - 1, 3, 3, ink);
      }
      break;
    case 'koro':
      body();
      break;
    default:
      body();
      g.rect(x + 2, y - r - 4, 2, 5, ink);
  }
  if (solid) {
    // 目
    g.rect(x - 4, y - 2, 2, 3, hole);
    g.rect(x + 2, y - 2, 2, 3, hole);
  }
}

/* ---- 世話ボタン4つ ---------------------------------------------------- */

function drawButtons(g: Painter, s: IppunIsshoState): void {
  const live = s.phase === 'life';
  const teach = live && s.t < T_NOON; // あさだけ光る（教える期間）
  const bs = bubbles(s);
  for (let i = 0; i < 4; i++) {
    const x = BTN_X0 + i * BTN_GAP;
    const kind = BTN_KINDS[i];
    const hot = s.pressT > 0 && s.pressBtn === i;
    const calling = bs.some((b) => b.kind === kind && b.lv >= 2);
    // ぐあいわるい のときは いつでも くすり が光る（キャラが言う）
    const ask = (teach || s.sick) && calling && Math.floor(s.time * 2.5) % 2 === 0;
    // 押した瞬間は「へこむ」（2px ずれて枠が太く）。「押して」は反転の点滅。別の見た目にして取り違えない
    const on = ask;
    const dx = hot ? 2 : 0;
    g.rect(x + dx, BTN_Y + dx, BTN_W - dx, BTN_H - dx, on ? 'ink' : 'bg');
    g.rectLine(x + dx, BTN_Y + dx, BTN_W - dx, BTN_H - dx, 'ink', hot ? 4 : 2);
    const c: ColorKey = on ? 'bg' : live ? 'ink' : 'dim';
    drawIcon(g, kind, x + BTN_W / 2 + dx, BTN_Y + 26 + dx, 26, c, on ? 'ink' : 'bg');
    g.text(BTN_LABEL[i], x + BTN_W / 2 + dx, BTN_Y + 46 + dx, { size: 9, align: 'center', color: on ? 'bg' : 'dim' });
  }
}

/* ---- アイコン（1ビットで自作。吹き出しとボタンで同じ絵）--------------- */

function drawIcon(g: Painter, kind: Kind, cx: number, cy: number, size: number, c: ColorKey, hole: ColorKey): void {
  const u = size / 24;
  switch (kind) {
    case 'gohan':
      // ごはんの山（丸の上半分）＋茶碗（台形）＋ふち
      g.circle(cx, cy - 1 * u, 8 * u, c);
      g.rect(cx - 12 * u, cy - 1 * u, 24 * u, 3 * u, c);
      g.poly([cx - 11 * u, cy + 2 * u, cx + 11 * u, cy + 2 * u, cx + 7 * u, cy + 11 * u, cx - 7 * u, cy + 11 * u], c);
      g.rect(cx - 9 * u, cy + 5 * u, 18 * u, 1.5 * u, hole);
      break;
    case 'asobu':
      // はずむボール: 丸＋つやの点＋下に影（帯は入れない）
      g.circle(cx, cy - 1 * u, 9 * u, c);
      g.circle(cx - 3.5 * u, cy - 4.5 * u, 2.2 * u, hole);
      g.rect(cx - 7 * u, cy + 10 * u, 14 * u, 2 * u, c);
      break;
    case 'nade':
      // 手のひら＋太い指3本＋親指
      g.rect(cx - 7 * u, cy - 1 * u, 15 * u, 11 * u, c);
      g.circle(cx, cy + 8 * u, 7 * u, c);
      g.rect(cx - 7 * u, cy - 10 * u, 4 * u, 12 * u, c);
      g.rect(cx - 1.5 * u, cy - 12 * u, 4 * u, 14 * u, c);
      g.rect(cx + 4 * u, cy - 10 * u, 4 * u, 12 * u, c);
      g.rect(cx - 12 * u, cy + 1 * u, 6 * u, 4 * u, c);
      break;
    case 'kusuri':
      g.circle(cx - 5 * u, cy + 5 * u, 6 * u, c);
      g.circle(cx + 5 * u, cy - 5 * u, 6 * u, c);
      g.poly([cx - 10 * u, cy + 1 * u, cx - 1 * u, cy - 9 * u, cx + 10 * u, cy - 1 * u, cx + 1 * u, cy + 9 * u], c);
      g.line(cx - 6 * u, cy - 4 * u, cx + 4 * u, cy + 6 * u, hole, 2 * u);
      break;
  }
}

/* ---- ドット絵（16×16。顔は本体に穴を空けて描く）------------------------ */

const EGG = [
  '....XXXX....',
  '...XXXXXX...',
  '..XXXXXXXX..',
  '.XXXXXXXXXX.',
  '.XXXXXXXXXX.',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  '.XXXXXXXXXX.',
  '.XXXXXXXXXX.',
  '..XXXXXXXX..',
  '...XXXXXX...',
];

/** つぶ（生まれたて）。小さくて頼りない */
const BODY_TSUBU = [
  '................',
  '................',
  '.....XXXXXX.....',
  '...XXXXXXXXXX...',
  '..XXXXXXXXXXXX..',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  '.XXXXXXXXXXXXXX.',
  '.XXXXXXXXXXXXXX.',
  '..XXXXXXXXXXXX..',
  '..XXXXXXXXXXXX..',
  '...XXXXXXXXXX...',
  '.....XXXXXX.....',
  '.....X....X.....',
  '................',
  '................',
];

/** ぽよ（基本形）。少し縦長でアホ毛が1本 */
const BODY_POYO = [
  '.........X......',
  '........XX......',
  '....XXXXXXXX....',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  '.XXXXXXXXXXXXXX.',
  '..XXXXXXXXXXXX..',
  '...XXXXXXXXXX...',
  '...XXX....XXX...',
  '................',
];

/** まる軸 2〜3。丸く太い */
const BODY_KORO = [
  '................',
  '.....XXXXXX.....',
  '...XXXXXXXXXX...',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  '.XXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  '.XXXXXXXXXXXXXX.',
  '.XXXXXXXXXXXXXX.',
  '..XXXXXXXXXXXX..',
  '...XXXXXXXXXX...',
  '.....X....X.....',
  '................',
];

/** まる軸 4 以上。ほぼ球 */
const BODY_MANMARU = [
  '.....XXXXXX.....',
  '...XXXXXXXXXX...',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  '.XXXXXXXXXXXXXX.',
  '..XXXXXXXXXXXX..',
  '...XXXXXXXXXX...',
  '.....X....X.....',
  '................',
];

/** ハート（なでる の反応） */
const HEART = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'];
/** ねむりの z */
const ZEE = ['XXXXX', '....X', '..XX.', '.X...', 'XXXXX'];
