/**
 * 一分一生（いっぷんいっしょう）── v3.1
 *
 * **ひらいて、せわして、とじる。とじているあいだに時間がすすむ。**
 *
 * v1（反射ゲーム化）・v2（「ダメを作らない」応答ゲーム化）はどちらもオーナーの実機評価で却下された。
 * 指摘の根幹は「これをやってどんな気持ちになると正解なのか」。
 * v3 は本家と同ジャンルを調べてから（docs/research/virtual-pet-1996.md）、
 * **気持ちの側から**組み直したもの。正解の気持ちはこの5つ（design.md §0）:
 *
 * ・見ていない時間 = **気になる**（暗い液晶の中でつぶが動き、ピピッと鳴るのに開けられない）
 * ・開けて世話する = **ほっとする**（減っていたからあげた。心配が静まる）
 * ・放っておいた   = **しまった、ごめん**（うんちを置いて寝たら病気。慌てて直す）
 * ・毎回のとじる   = **面倒だが、やると気持ちいい儀式**（カチッ。ポケットにしまう）
 * ・最期           = **ちゃんと見届けた**（ありがと → たね → 芽 → 記念）
 *
 * 一生は8回の「ひらく」。#8 が おわかれ。放っておくと「よわったまま閉じた」回が
 * 4つたまった時点で死ぬ（＝閉じる前に直せば必ず助かる）。
 * 設計は docs/plans/008-ippun-issho/design.md（v3.1）。権利の線引きは §12。
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

/**
 * 収録中に触ることになる数値。`npm run tune` が動かせるよう、定数ではなく入れ物にしてある
 * （通常のプレイでは変わらない）。
 */
const TUNE = {
  /** 何もしないと自動で閉じるまでの秒数（#1 だけ +2秒） */
  openMax: 6,
  /** とじているあいだの秒数。ここが「気になる」の長さそのもの */
  closedDur: 2.4,
  /** 「よわったまま閉じた」が何回たまったら死ぬか */
  weakToDie: 4,
};

/* ================================================================== *
 * 一生の時間割（design.md §3）
 *
 * 8回の「ひらく」で終わる。#8 は おわかれ。
 * 年齢は本家と同じ「日数＝年齢」の感覚に寄せて、あとになるほど飛ぶ。
 * ================================================================== */

/** turn 1〜8 の年齢 */
const AGE: readonly number[] = [0, 1, 2, 4, 6, 8, 11, 14];
/** turn 1〜8 が何にちめか */
const DAY: readonly number[] = [1, 1, 1, 2, 2, 2, 3, 3];
/** turn 1〜8 の時間帯 */
const WHEN: readonly string[] = ['あさ', 'ひる', 'よる', 'あさ', 'ひる', 'よる', 'あさ', 'ゆうがた'];
/** turn 1〜7 を閉じたあと、とじているあいだに出る「自分の一日」の札 */
const CLOSED_LABEL: readonly string[] = [
  'がっこうへ',
  'ごご',
  'ねる',
  'がっこう',
  'ぶかつ',
  'ねる',
  'がっこう',
];
/** 札の時計が指す時刻（時） */
const CLOSED_HOUR: readonly number[] = [8, 15, 21, 8, 16, 21, 8];
/**
 * turn 1〜7 を閉じたあいだに減るおなか／きげん。あかちゃんはよく減り、育つとゆっくりになる。
 *
 * 🔴 きげんも毎回減らす（設計 v3.1 は「遊ばなかった回だけ −1」だった）。
 * 遊べば減らない作りだと `played` が `fed` を構造的に上回れず、
 * せいちょう①の「ぴょん」が到達不能になっていた（上手いボット200回で こども＝ころ 200/200）。
 * 遊ばなかった回はさらに −1 で、「遊ばないと不機嫌になる」は保っている。
 */
const DROP: readonly number[] = [2, 2, 2, 1, 1, 1, 1];
/** 減り方のゆらぎ。ここが育ちの分かれ目になる（同じ世話でも子によって違う） */
const DROP_WOBBLE = 0.35;
/** 眠くなる回（よる）。ここで でんき を消すと ぐっすり */
const SLEEP_TURNS: readonly number[] = [3, 6];

/** たまごが孵るまでの秒数 */
const EGG_AT = 3;
/** 温めると早くなる。ここが下限 */
const EGG_MIN = 2;
/** 1回温めると縮む秒数 */
const EGG_WARM = 0.4;
/** ぽかぽかで点が入る上限 */
const EGG_TAPS = 3;
/** なまえを選ばずにいると自分で名乗るまでの秒数 */
const NAME_WAIT = 5;
/** ひらいてから、とじられるようになるまでの秒数（開けた瞬間の誤爆を防ぐ） */
const OPEN_LOCK = 1.2;
/** 自動で閉じる何秒前からふちが点滅するか */
const WARN_BEFORE = 1.5;
/** ひらいた瞬間、大きな「！」を出しておく秒数 */
const OPEN_BANG = 1.6;
/** メーターの満タン */
const METER_MAX = 4;
/** これ以下で呼び出しが鳴る */
const CALL_AT = 1;
/** ごはんをあげた回を閉じたとき、うんちが出る確率 */
const POOP_P = 0.6;
/** うんちを置いたまま閉じたときに病気になる確率（昼） */
const SICK_DAY_P = 0.5;

/* ---- おわかれの時間割（design.md §7）-------------------------------- */

/** 手を振る「ありがと」／「…しずかだ」の長さ */
const BYE_WAVE = 2;
/** 土に沈みはじめる */
const BYE_SINK = 2;
const BYE_SINK_LEN = 0.9;
/** たねが見えるまで */
const BYE_SEED = 2.9;
/** 芽が出る＝記念の1行目が出る */
const BYE_SPROUT = 3.5;
/** 記念の行の間隔 */
const EPI_STEP = 0.7;
/** 最後の行が出てから終わるまで */
const BYE_TAIL = 2.5;
/** おわかれ全体の長さ */
const BYE_END = BYE_SPROUT + EPI_STEP * 3 + BYE_TAIL;

/* ---- 得点（design.md §6）-------------------------------------------- */

const P_WARM = 1;
const P_BORN = 2;
/** 呼び出しに応えた */
const P_ANSWER = 3;
/** 呼ばれる前に満たした */
const P_AHEAD = 4;
/** なでる（1回の「ひらく」に1回）／「なでて」と呼ばれて なでた */
const P_PET = 1;
const P_PET_ASKED = 3;
/** せいちょう①②／おとしより */
const P_GROW = 5;
const P_ELDER = 3;
/** 困りごとが無い状態で手で とじた */
const P_CLOSE = 2;
/** きらになったとき */
const P_KIRA = 15;
/** 最期まで生きた */
const P_LIVED = 10;

/* ---- 画面の決まり（240×320・mono テーマ。design.md §2）-------------- */

/** 上の帯（左に「◯にちめ・あさ」、右に年齢） */
const HEAD_Y = 21;
/** 液晶の窓 */
const WIN_X = 8;
const WIN_Y = 44;
const WIN_W = 224;
const WIN_H = 170;
/** 窓の枠の太さ */
const WIN_LINE = 2;
/** 角丸の抜き幅（上から順に、その行で本体色に塗る幅） */
const CORNER: readonly number[] = [5, 3, 2, 1, 1];
/** 窓の上辺のアイコン列 */
const ICON_Y = 55;
const ICON_X0 = 35;
const ICON_GAP = 34;
/** メーター */
const METER_X = 16;
const METER_Y1 = 68;
const METER_Y2 = 82;
/** 床の線 */
const FLOOR_Y = 190;
/** つぶの立ち位置 */
const CHAR_X = 120;
/** 16×16 ドットの1ドット */
const DOT = 4;
/** 体の高さ（16ドット×DOT） */
const BODY_H = 16 * DOT;
/** うんち */
const POOP_X = 198;
const POOP_Y = 180;
/** 液晶の中に出る一言 */
const SAY_Y = 196;
/** せいちょうの見出しと理由 */
const GROW_Y = 96;
const GROW_WHY_Y = 112;
/** 「とじる」 */
const CLOSE_Y = 218;
const CLOSE_H = 20;
/** 世話ボタン5つ */
const BTN_Y = 242;
const BTN_H = 62;
const BTN_W = 44;
const BTN_X0 = 4;
const BTN_GAP = 47;
/** 手引き */
const HELP_Y = 307;
/** 右上の芽5つ（しあわせ 20 ごと） */
const SPROUT_MAX = 5;
const SPROUT_STEP = 20;
const SPROUT_X0 = 112;
const SPROUT_GAP = 12;
const SPROUT_Y = 38;
/** とじているあいだの札と時計 */
const CARD_Y = 226;
const CLOCK_X = 120;
const CLOCK_Y = 276;
const CLOCK_R = 22;
/** なまえのカード */
const NCARD_Y = 146;
const NCARD_W = 64;
const NCARD_H = 38;
const NCARD_X: readonly number[] = [16, 84, 152];
/** 記念の文（芽の上） */
const EPI_Y = 88;
const EPI_LINE = 17;
/** 一言・演出の既定の長さ */
const SAY_T = 1.1;
const ANIM_T = 0.5;

/* ---- 種類 ------------------------------------------------------------ */

/** 世話の種類。ボタン5つと窓の上辺のアイコン列は同じ並び */
type Kind = 'gohan' | 'asobu' | 'souji' | 'kusuri' | 'denki' | 'bikkuri';

const BTN_KINDS: readonly Kind[] = ['gohan', 'asobu', 'souji', 'kusuri', 'denki'];
const BTN_LABEL: readonly string[] = ['ごはん', 'あそぶ', 'そうじ', 'くすり', 'でんき'];
/** 窓の上辺のアイコン列。6つめは「！」（なでて・おわり） */
const ICON_KINDS: readonly Kind[] = [...BTN_KINDS, 'bikkuri'];

type Phase = 'egg' | 'name' | 'open' | 'closed' | 'bye' | 'gone';

/**
 * 姿。**語尾を揃えない**（本家の看板キャラの語幹・命名の癖に寄せないため。design.md §12）。
 * あかちゃんは「つぶ」そのもの。
 */
type Form =
  | 'tsubu'
  | 'poyo'
  | 'koro'
  | 'pyon'
  | 'nora'
  | 'kira'
  | 'natsuki'
  | 'tabi'
  | 'manmaru'
  | 'hane'
  | 'mofu';

const FORM_NAME: Record<Form, string> = {
  tsubu: 'つぶ',
  poyo: 'ぽよ',
  koro: 'ころ',
  pyon: 'ぴょん',
  nora: 'のら',
  kira: 'きら',
  natsuki: 'なつき',
  tabi: 'たび',
  manmaru: 'まんまる',
  hane: 'はね',
  mofu: 'もふ',
};

/** せいちょうの理由。式ではなく、ぼかした一言で見せる（本家は条件が隠されていた） */
const FORM_WHY: Record<Form, string> = {
  tsubu: '',
  poyo: 'かまってもらったから',
  koro: 'ごはんが すきだから',
  pyon: 'あそぶのが すきだから',
  nora: 'ひとりで がんばったから',
  kira: 'だいじに そだてられたから',
  natsuki: 'さいごまで そばに いたから',
  tabi: 'じぶんの みちを いくから',
  manmaru: 'ごはんが だいすきだから',
  hane: 'はねるのが すきだから',
  mofu: 'たくさん なでられたから',
};

/**
 * 名前の候補。**「っち」で終わる名前は入れない**（本家の命名に寄せないため。design.md §12）。
 * ここから rng で3つ引いてカードにする。
 */
const NAMES: readonly string[] = [
  'ぽち',
  'もこ',
  'たま',
  'ちび',
  'くう',
  'ぷく',
  'まる',
  'のん',
  'きな',
  'あず',
  'ここ',
  'そら',
  'ひな',
  'ゆず',
  'りく',
  'なな',
  'とと',
  'みお',
  'ぽん',
  'こむ',
];

/* ---- 状態 ------------------------------------------------------------ *
 * **フラットに持つ。** 予定も演出もすべてスカラーで、粒（きらきら・ハエ）は
 * `s.time` の関数にしてある（配列を持つと `{...s}` の浅いコピーで壊れる）。
 * ------------------------------------------------------------------- */

export interface IppunIsshoState extends BaseState, FeelState {
  /* 進行 */
  phase: Phase;
  /** そのフェーズに入った時刻（ボットが「少し待ってから動く」ために見る） */
  phaseAt: number;
  /** 何回目の「ひらく」か（1〜8。8 は おわかれ） */
  turn: number;
  /** ひらいてからの秒 */
  openT: number;
  /** とじてからの秒 */
  closedT: number;
  /** おわかれの経過秒 */
  byeT: number;
  /** たまごが孵る時刻 */
  hatchAt: number;
  eggTaps: number;

  /* なまえ */
  n0: number;
  n1: number;
  n2: number;
  name: string;

  /* メーター・そのときの様子 */
  hunger: number;
  mood: number;
  /** うんち（0/1。画面に1つまで） */
  poop: number;
  sick: boolean;
  /** その回は ねんね か */
  asleep: boolean;
  /** 液晶の明かりが点いているか（ねんね中に消すと ぐっすり） */
  lit: boolean;
  /** その とじている で でんきを消せたか */
  litDone: boolean;
  /** ねむれなかった（翌朝のクマ） */
  kuma: boolean;
  /** 「なでて」とねだっているか */
  wantPet: boolean;

  /* 累計 */
  weak: number;
  missed: number;
  fed: number;
  played: number;
  cleaned: number;
  cured: number;
  litCount: number;
  petted: number;
  sickDays: number;

  /* 育ち */
  form: Form;
  /** こどものときの姿（おとなの分岐が見る） */
  child: Form;
  kira: boolean;
  /** せいちょう①の時点の missed（こども期の missed を引くため） */
  missedAtChild: number;
  /** すきなもの（記念の文が見る） */
  fav: 'gohan' | 'asobu' | 'nade';
  /** かくれた運（非表示） */
  lucky: boolean;
  alive: boolean;
  /** 早い死か */
  early: boolean;
  /** 何さいで終わったか */
  endAge: number;

  /* その「ひらく」のあいだ */
  petThisOpen: number;
  careThisOpen: number;
  fedThisOpen: boolean;
  playedThisOpen: boolean;
  /** その回で最後に手を出した openT（ボットが「1.2秒たったら とじる」を測る） */
  lastActT: number;

  /* 演出 */
  say: string;
  sayT: number;
  /** 0=なし 1=もぐもぐ 2=はねる 3=しゅっ 4=なおった 5=なでた */
  animKind: number;
  animT: number;
  /** 首を振っている残り */
  noT: number;
  /** 押したボタン（-1=とじる。反転させる） */
  pressBtn: number;
  pressT: number;
  /** せいちょうの見出し */
  growT: number;
  growText: string;
  growWhy: string;
  /** でんきを空押ししたときの一瞬の暗転 */
  blackout: number;
  /** たまごを温めた残り */
  poke: number;
  /** 「ん？」で見る向き（-1/0/1） */
  lookX: number;
  /** その とじている で何回鳴らしたか */
  beeped: number;
  /** 記念の何行目まで出したか */
  epShown: number;
}

/* ---- 小さな道具 ------------------------------------------------------ */

/** 点を足す。きらになった子は以後 ×1.5（design.md §6） */
function gain(n: IppunIsshoState, base: number): void {
  n.score += n.kira ? Math.round(base * 1.5) : base;
}

/** 液晶の中に一言。**無反応をゼロにするための最後の砦**でもある */
function speak(n: IppunIsshoState, text: string, dur = SAY_T): void {
  n.say = text;
  n.sayT = dur;
}

function animate(n: IppunIsshoState, kind: number): void {
  n.animKind = kind;
  n.animT = ANIM_T;
}

/** その回の年齢 */
function ageOf(s: IppunIsshoState): number {
  return AGE[Math.min(AGE.length - 1, Math.max(0, s.turn - 1))];
}

/** いま困っている世話。無ければ空（＝つぶがこちらを見てにこっとする） */
function troubleOf(s: IppunIsshoState): Kind | '' {
  if (s.phase !== 'open') return '';
  if (s.sick) return 'kusuri';
  if (s.poop > 0) return 'souji';
  if (s.asleep && s.lit) return 'denki';
  if (s.hunger <= CALL_AT) return 'gohan';
  if (s.mood <= CALL_AT) return 'asobu';
  if (s.wantPet) return 'bikkuri';
  return '';
}

/** そのアイコンが「いま欲しいもの」か（窓の上辺で反転して点滅する） */
function wanted(s: IppunIsshoState, kind: Kind): boolean {
  // とじているあいだも呼び出しは見える。開けられないから「気になる」
  if (s.phase === 'closed') {
    if (kind === 'gohan') return s.hunger <= CALL_AT;
    if (kind === 'souji') return s.poop > 0;
    if (kind === 'kusuri') return s.sick;
    return false;
  }
  if (s.phase !== 'open') return false;
  switch (kind) {
    case 'gohan':
      return s.hunger <= CALL_AT;
    case 'asobu':
      return s.mood <= CALL_AT;
    case 'souji':
      return s.poop > 0;
    case 'kusuri':
      return s.sick;
    case 'denki':
      return s.asleep && s.lit;
    case 'bikkuri':
      return s.wantPet;
  }
}

/** とじているあいだ、呼び出しが鳴る状態か（おなか・うんち・病気だけ。design.md §3） */
function calling(s: IppunIsshoState): boolean {
  return s.hunger <= CALL_AT || s.poop > 0 || s.sick;
}

/** 液晶が暗いか（ねんねで消灯した／とじている／でんきの空押し／夜に見つけた早い死） */
function darkNow(s: IppunIsshoState): boolean {
  if (s.phase === 'closed') return true;
  if (s.blackout > 0) return true;
  if ((s.phase === 'bye' || s.phase === 'gone') && s.early) return true;
  return s.phase === 'open' && s.asleep && !s.lit;
}

/* ---- 当たり判定 ------------------------------------------------------ *
 * 順番は 世話ボタン → とじる → つぶ → 液晶の中 → それ以外（design.md §2）。
 * ここで使う数値は draw と共有している定数だけ（ずれると押しても効かない）。
 * ------------------------------------------------------------------- */

type HitWhat = 'btn' | 'close' | 'char' | 'window' | 'card' | 'none';

function hitTest(s: IppunIsshoState, px: number, py: number): { what: HitWhat; i: number } {
  // なまえ中はカードがいちばん上にある
  if (s.phase === 'name') {
    for (let i = 0; i < 3; i++) {
      if (px >= NCARD_X[i] && px < NCARD_X[i] + NCARD_W && py >= NCARD_Y && py < NCARD_Y + NCARD_H) {
        return { what: 'card', i };
      }
    }
    return { what: 'none', i: -1 };
  }
  for (let i = 0; i < 5; i++) {
    const x = BTN_X0 + i * BTN_GAP;
    if (px >= x && px < x + BTN_W && py >= BTN_Y && py < BTN_Y + BTN_H) return { what: 'btn', i };
  }
  if (px >= WIN_X && px < WIN_X + WIN_W && py >= CLOSE_Y && py < CLOSE_Y + CLOSE_H) {
    return { what: 'close', i: -1 };
  }
  // つぶの当たりは体より少し広く取る（ドット絵の隙間で外れると「押したのに」になる）
  if (Math.abs(px - CHAR_X) < 40 && py >= FLOOR_Y - BODY_H - 8 && py < FLOOR_Y + 6) {
    return { what: 'char', i: -1 };
  }
  if (px >= WIN_X && px < WIN_X + WIN_W && py >= WIN_Y && py < WIN_Y + WIN_H) {
    return { what: 'window', i: -1 };
  }
  return { what: 'none', i: -1 };
}

/* ================================================================== *
 * ゲーム本体
 * ================================================================== */

export default defineGame<IppunIsshoState>({
  meta,

  init(rng) {
    // 名前の候補を3つ、重複なしで引く
    const pool = NAMES.map((_, i) => i);
    const pick: number[] = [];
    for (let i = 0; i < 3; i++) pick.push(pool.splice(rng.int(pool.length), 1)[0]);
    const fav = rng.pick(['gohan', 'asobu', 'nade'] as const);
    return {
      ...createFeel(),
      score: 0,
      over: false,
      time: 0,
      cue: 0,
      click: 0,

      phase: 'egg',
      phaseAt: 0,
      turn: 1,
      openT: 0,
      closedT: 0,
      byeT: 0,
      hatchAt: EGG_AT,
      eggTaps: 0,

      n0: pick[0],
      n1: pick[1],
      n2: pick[2],
      name: '',

      // あかちゃん期は呼び出しが多い。#1 はいきなり「！ごはん」「！あそぶ」が鳴る
      hunger: 1,
      mood: 1,
      poop: 0,
      sick: false,
      asleep: false,
      lit: true,
      litDone: false,
      kuma: false,
      wantPet: false,

      weak: 0,
      missed: 0,
      fed: 0,
      played: 0,
      cleaned: 0,
      cured: 0,
      litCount: 0,
      petted: 0,
      sickDays: 0,

      form: 'tsubu',
      child: 'poyo',
      kira: false,
      missedAtChild: 0,
      fav,
      lucky: rng.chance(0.25),
      alive: true,
      early: false,
      endAge: 14,

      petThisOpen: 0,
      careThisOpen: 0,
      fedThisOpen: false,
      playedThisOpen: false,
      lastActT: 0,

      say: '',
      sayT: 0,
      animKind: 0,
      animT: 0,
      noT: 0,
      pressBtn: -2,
      pressT: 0,
      growT: 0,
      growText: '',
      growWhy: '',
      blackout: 0,
      poke: 0,
      lookX: 0,
      beeped: 0,
      epShown: 0,
    };
  },

  step(s, input, dt, rng) {
    const n = { ...s };
    if (!feelTick(n, input, dt)) return n;
    const now = s.time;

    /* 1. 演出のタイマーを減らす */
    n.sayT = Math.max(0, n.sayT - dt);
    n.animT = Math.max(0, n.animT - dt);
    n.noT = Math.max(0, n.noT - dt);
    n.pressT = Math.max(0, n.pressT - dt);
    n.growT = Math.max(0, n.growT - dt);
    n.blackout = Math.max(0, n.blackout - dt);
    n.poke = Math.max(0, n.poke - dt);
    if (n.pressT <= 0) n.pressBtn = -2;

    /* 2. いまのフェーズの時計を進める */
    if (n.phase === 'open') n.openT += dt;
    else if (n.phase === 'closed') n.closedT += dt;
    else if (n.phase === 'bye' || n.phase === 'gone') n.byeT += dt;

    /* 3. 入力（自動で閉じるより先に見る。ぎりぎりの「とじる」を取りこぼさないため） */
    if (takeTap(n)) handleTap(n, input.px, input.py, rng);

    /* 4. 時間で起きること（孵化・自動クローズ・とじている処理・おわかれ） */
    stepPhase(n, now, rng);

    return n;
  },

  draw(g, s) {
    const [sx, sy] = shakeOffset(s, s.time);
    drawBody(g);
    drawHeadRow(g, s);
    drawWindow(g, s, sx, sy);
    if (s.phase === 'closed') drawDayCard(g, s);
    else drawControls(g, s);
    drawHelp(g, s);
  },

  /**
   * 上手い人。**押すフレームだけ press を立てる**（押しっぱなしにすると、
   * aim では毎フレーム別の場所を押したことになってしまう）。
   * `% 21` ＝ 0.35秒に1手。ここを `% 2` にすると毎秒30タップの別人になる。
   */
  bot(s) {
    const frame = Math.round(s.time * 60);
    const idle = { press: false, px: CHAR_X, py: FLOOR_Y - 30 };
    if (frame % 21 !== 0) return idle;

    const btn = (i: number) => ({
      press: true,
      px: BTN_X0 + i * BTN_GAP + BTN_W / 2,
      py: BTN_Y + BTN_H / 2,
    });
    const char = { press: true, px: CHAR_X, py: FLOOR_Y - 30 };
    const closeBtn = { press: true, px: W / 2, py: CLOSE_Y + CLOSE_H / 2 };

    switch (s.phase) {
      case 'egg':
        // 温めると早く孵る。3回で打ち止め
        return s.eggTaps < EGG_TAPS ? char : idle;
      case 'name':
        // 少し考えてから左のカード
        return s.time - s.phaseAt >= 0.6
          ? { press: true, px: NCARD_X[0] + NCARD_W / 2, py: NCARD_Y + NCARD_H / 2 }
          : idle;
      case 'closed':
        return idle;
      case 'bye':
      case 'gone':
        // 1.0秒ごとに次の行へ送る
        return frame % 63 === 0 ? char : idle;
      case 'open':
        break;
    }

    // 困っているものから順に片づける
    if (s.sick) return btn(3);
    if (s.poop > 0) return btn(2);
    // 「なでて」は寝る前のおねだりなので、ねんね中でも先に応える
    if (s.wantPet) return char;
    if (s.asleep) {
      // ねんね中は でんき（と そうじ・くすり）だけ。消したら待って閉じる。
      // ここで「なでる」を試すと「すやすや…」が返るだけで永久に閉じない
      if (s.lit) return btn(4);
    } else {
      if (s.hunger < METER_MAX) return btn(0);
      if (s.mood < METER_MAX) return btn(1);
      if (s.petThisOpen === 0) return char;
    }
    // 困りごとが無くなって 1.2秒たったら、手で とじる（+2 と カチッ）
    if (s.openT >= OPEN_LOCK && s.openT >= s.lastActT + 1.2) return closeBtn;
    return idle;
  },

  reason: (s) =>
    s.early
      ? `${s.name || 'つぶ'}（${FORM_NAME[s.form]}）は ${s.endAge}さいで たねになった`
      : `${s.name || 'つぶ'}（${FORM_NAME[s.form]}）は ${s.endAge}さいまで いきた`,

  tunables: {
    openMax: {
      label: '自動で閉じるまでの秒数',
      min: 4,
      max: 10,
      get: () => TUNE.openMax,
      set: (v) => {
        TUNE.openMax = v;
      },
    },
    closedDur: {
      label: 'とじている秒数',
      min: 1.2,
      max: 4,
      get: () => TUNE.closedDur,
      set: (v) => {
        TUNE.closedDur = v;
      },
    },
    weakToDie: {
      label: 'よわり何回で死ぬか',
      min: 2,
      max: 6,
      get: () => TUNE.weakToDie,
      set: (v) => {
        TUNE.weakToDie = v;
      },
    },
  },
});

/* ================================================================== *
 * step の中身
 * ================================================================== */

/** 時間で起きること */
function stepPhase(n: IppunIsshoState, now: number, rng: Rng): void {
  switch (n.phase) {
    case 'egg':
      if (now >= n.hatchAt) {
        n.phase = 'name';
        n.phaseAt = now;
        n.form = 'tsubu';
        gain(n, P_BORN);
        speak(n, 'うまれた！', 1.4);
        addPop(n);
        hitStop(n, 0.06);
        n.cue = (n.cue ?? 0) + 1;
      }
      break;

    case 'name':
      // 選ばずにいると自分で名乗る
      if (now - n.phaseAt >= NAME_WAIT) {
        setName(n, [n.n0, n.n1, n.n2][rng.int(3)]);
        openTurn(n, now);
      }
      break;

    case 'open': {
      const max = TUNE.openMax + (n.turn === 1 ? 2 : 0);
      // 自動で閉じる。手で押していないので +2 も カチッ も無い
      if (n.openT >= max) closeTurn(n, now, rng, false);
      break;
    }

    case 'closed': {
      // とじているあいだの呼び出し。1増やすと共通シェルがピピッと1回鳴らす。
      // 続けて鳴らすときはフレームを分ける（同じフレームで2増やしても1回に聞こえる）
      if (n.turn <= CLOSED_LABEL.length && calling(n)) {
        if (n.beeped === 0 && n.closedT >= 0.9) {
          n.cue = (n.cue ?? 0) + 1;
          n.beeped = 1;
        } else if (n.beeped === 1 && n.closedT >= 1.9) {
          n.cue = (n.cue ?? 0) + 1;
          n.beeped = 2;
        }
      }
      if (n.closedT >= TUNE.closedDur) {
        if (!n.alive) startBye(n, now, true);
        else if (n.turn >= AGE.length) startBye(n, now, false);
        else openTurn(n, now);
      }
      break;
    }

    case 'bye': {
      // 「…しずかだ」のあいだにピーピー鳴らす（死の音。フレームを分けて3回）
      if (n.early) {
        if (n.beeped === 0 && n.byeT >= 0.2) {
          n.cue = (n.cue ?? 0) + 1;
          n.beeped = 1;
        } else if (n.beeped === 1 && n.byeT >= 0.6) {
          n.cue = (n.cue ?? 0) + 1;
          n.beeped = 2;
        } else if (n.beeped === 2 && n.byeT >= 1) {
          n.cue = (n.cue ?? 0) + 1;
          n.beeped = 3;
        }
      }
      // 芽が出たら記念の文を0.7秒おきに4行
      const shown = Math.floor((n.byeT - BYE_SPROUT) / EPI_STEP) + 1;
      if (shown > n.epShown && n.byeT >= BYE_SPROUT) {
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

/** なまえを決めて #1 へ */
function setName(n: IppunIsshoState, id: number): void {
  n.name = NAMES[id];
}

/**
 * ひらく。年齢・札・せいちょうはここで決まる。
 * 開けた瞬間に困りごとがあれば ピピッ ＋「！」＋アイコン列の反転（design.md §4）。
 */
function openTurn(n: IppunIsshoState, now: number): void {
  n.phase = 'open';
  n.phaseAt = now;
  n.openT = 0;
  n.closedT = 0;
  n.petThisOpen = 0;
  n.careThisOpen = 0;
  n.fedThisOpen = false;
  n.playedThisOpen = false;
  n.lastActT = 0;
  n.beeped = 0;
  n.litDone = false;
  n.lit = true;

  // せいちょう（開けた瞬間に見る。これが「えっ、こうなったの」）
  if (n.turn === 3) growUp(n, childForm(n));
  else if (n.turn === 5) growUp(n, adultForm(n));
  else if (n.turn === 7) {
    n.growT = 1.8;
    n.growText = 'おとしよりに なった';
    n.growWhy = 'ゆっくり あるいている';
    gain(n, P_ELDER);
    addPop(n);
  }

  // よるは眠い。でんきを消すと ぐっすり
  n.asleep = SLEEP_TURNS.includes(n.turn);
  // きげんが高いと「なでて」とねだる（#6 の余白。design.md §3）
  n.wantPet = n.turn === 6 && n.mood >= 3 && !n.sick;

  if (troubleOf(n) !== '') {
    n.cue = (n.cue ?? 0) + 1;
    addShake(n, 0.15);
  } else if (n.turn !== 7) {
    speak(n, 'げんき！', 0.9);
    addPop(n);
  }
  if (n.kuma) speak(n, 'ねむれなかった…', 1.6);
}

/**
 * とじる。**とじているあいだに起きることは、閉じた瞬間に1回でまとめて適用する**
 * （時間が飛ぶ）。表示だけを closedDur 秒かけて見せる（design.md §3）。
 */
function closeTurn(n: IppunIsshoState, now: number, rng: Rng, byHand: boolean): void {
  const t = n.turn;
  const trouble = troubleOf(n);

  // 手で押したときだけ +2 と カチッ（自動クローズは加点なし。design.md §14）
  if (byHand) {
    n.click = (n.click ?? 0) + 1;
    if (trouble === '') {
      gain(n, P_CLOSE);
      speak(n, 'ほっ', 1);
      addPop(n);
    } else {
      speak(n, '…', 0.8);
    }
  }
  if (trouble !== '') n.missed++;

  /* ① よわり判定は「とじる直前」の姿で見る。閉じる前に直せば必ず助かる（design.md §14） */
  if (n.hunger <= 0 || n.sick) n.weak++;

  /* ② おなかとごきげんが減る。ゆらぎの分だけ、同じ世話をしても子ごとに違う育ちになる */
  const base = DROP[Math.min(DROP.length - 1, t - 1)];
  n.hunger = Math.max(0, n.hunger - base - (rng.chance(DROP_WOBBLE) ? 1 : 0));
  // 「遊ばなかった回はもう1つ下がる」。ただし ねんね の回は遊べないので数に入れない
  const lazy = !n.playedThisOpen && !SLEEP_TURNS.includes(t) ? 1 : 0;
  n.mood = Math.max(0, n.mood - base - lazy - (rng.chance(DROP_WOBBLE) ? 1 : 0));

  /* ③ うんちを置いたまま閉じたら病気（夜は必ず） */
  if (n.poop > 0 && !n.sick) {
    const p = t === 3 ? 1 : SICK_DAY_P;
    if (rng.chance(p)) {
      n.sick = true;
      n.sickDays++;
    }
  }

  /* ④ ごはんをあげた回はうんちが出る。#7 のあと（余白の回の前）は出さない */
  if (n.fedThisOpen && n.poop <= 0 && t < 7 && rng.chance(POOP_P)) n.poop = 1;

  /* ⑤ ねる の札。消灯していれば ぐっすり、点けたままなら翌朝クマ */
  if (SLEEP_TURNS.includes(t)) {
    if (n.litDone) {
      n.mood = Math.min(METER_MAX, n.mood + 1);
      n.kuma = false;
    } else {
      n.kuma = true;
      n.mood = Math.max(0, n.mood - 2);
    }
  } else {
    n.kuma = false;
  }

  /* ⑥ よわりが たまりきったら、この とじている のあいだに死ぬ */
  if (n.weak >= TUNE.weakToDie) {
    n.alive = false;
    n.endAge = AGE[Math.min(AGE.length - 1, t - 1)];
  }

  n.phase = 'closed';
  n.phaseAt = now;
  n.closedT = 0;
  n.beeped = 0;
  n.turn = t + 1;
}

/** おわかれへ。§7 の順（手振り→沈む→たね→芽→記念4行） */
function startBye(n: IppunIsshoState, now: number, early: boolean): void {
  n.phase = 'bye';
  n.phaseAt = now;
  n.byeT = 0;
  n.beeped = 0;
  n.epShown = 0;
  n.early = early;
  n.asleep = false;
  n.lit = true;
  n.wantPet = false;
  if (early) {
    speak(n, '…しずかだ', BYE_WAVE);
    addShake(n, 0.5);
  } else {
    n.endAge = AGE[AGE.length - 1];
    gain(n, P_LIVED);
    speak(n, 'ありがと', BYE_WAVE);
    addPop(n);
    hitStop(n, 0.08);
  }
}

/* ---- 育ち（design.md §5）-------------------------------------------- */

/**
 * せいちょう①（#3）。
 *
 * 🔴 差の線を設計 v3.1 の「+2」から「+1」に下げてある。
 * #3 の時点では とじる が2回しか終わっておらず、減り方のゆらぎでは +2 の差が作れない。
 * +2 のままだと、メーターを満たす遊び方をする限り **こども＝ぽよ 200/200**（実測）になり、
 * 「何になるのか」が消える。+1 なら ころ／ぴょん／ぽよ に割れ、
 * ごはん寄り・あそび寄りの癖はそのまま結果に出る。
 */
function childForm(s: IppunIsshoState): Form {
  // 🔴 のら の線も v3.1 の「よわり2回」から1回に下げてある。
  // #3 までに閉じるのは2回だけで、1回目は おなかが 1 から始まるので よわらない。
  // つまり **まったく世話しなくても よわりは1回**にしかならず、のら が到達不能だった（実測）。
  if (s.weak >= 1) return 'nora';
  if (s.fed > s.played) return 'koro';
  if (s.played > s.fed) return 'pyon';
  return 'poyo';
}

function adultForm(s: IppunIsshoState): Form {
  if (s.lucky && s.weak <= 1 && s.sickDays <= 1) return 'kira';
  if (s.child === 'nora') return s.missed - s.missedAtChild === 0 ? 'natsuki' : 'tabi';
  if (s.child === 'koro') return 'manmaru';
  if (s.child === 'pyon') return 'hane';
  return 'mofu';
}

function growUp(n: IppunIsshoState, form: Form): void {
  n.form = form;
  if (n.turn === 3) {
    n.child = form;
    n.missedAtChild = n.missed;
  }
  n.growT = 1.8;
  n.growText = `${FORM_NAME[form]}に なった`;
  n.growWhy = FORM_WHY[form];
  gain(n, P_GROW);
  if (form === 'kira') {
    // 先に +15 を入れてから ×1.5 を有効にする（そのぶんまで1.5倍にすると効きすぎる）
    n.score += P_KIRA;
    n.kira = true;
  }
  addPop(n);
  hitStop(n, 0.08);
}

/* ================================================================== *
 * 入力（無反応ゼロ。design.md §2 の表）
 * ================================================================== */

function handleTap(n: IppunIsshoState, px: number, py: number, rng: Rng): void {
  /* たまご: どこを押しても ぽかぽか */
  if (n.phase === 'egg') {
    n.poke = 0.35;
    if (n.eggTaps < EGG_TAPS) {
      n.eggTaps++;
      gain(n, P_WARM);
      n.hatchAt = Math.max(EGG_MIN, n.hatchAt - EGG_WARM);
      speak(n, 'ぽかぽか', 0.8);
    } else {
      speak(n, 'もうすこし', 0.8);
    }
    addPop(n);
    return;
  }

  /* とじている: 押しても開かない。本体が小さく揺れる */
  if (n.phase === 'closed') {
    addShake(n, 0.35);
    speak(n, '…いまは ひらけない', 1);
    return;
  }

  /* おわかれ: どこを押しても次の行へ送る */
  if (n.phase === 'bye' || n.phase === 'gone') {
    byeTap(n);
    return;
  }

  const hit = hitTest(n, px, py);

  /* なまえ */
  if (n.phase === 'name') {
    if (hit.what === 'card') {
      setName(n, [n.n0, n.n1, n.n2][hit.i]);
      speak(n, `${n.name}！`, 1.2);
      addPop(n);
      hitStop(n, 0.05);
      openTurn(n, n.time);
    } else {
      speak(n, 'なまえを えらんでね', 1);
      n.noT = 0.4;
    }
    return;
  }

  /* ひらいているとき */
  switch (hit.what) {
    case 'btn':
      n.pressBtn = hit.i;
      n.pressT = 0.18;
      n.lastActT = n.openT;
      doCare(n, BTN_KINDS[hit.i]);
      return;
    case 'close':
      n.pressBtn = -1;
      n.pressT = 0.18;
      if (n.openT < OPEN_LOCK) {
        speak(n, 'まだ ひらいたばかり', 0.9);
        addShake(n, 0.2);
        return;
      }
      closeTurn(n, n.time, rng, true);
      return;
    case 'char':
      n.lastActT = n.openT;
      pet(n);
      return;
    case 'window':
      n.lookX = px < CHAR_X ? -1 : 1;
      speak(n, 'ん？', 0.7);
      return;
    default:
      // ボタンの外側。ここも「何も起きない」にしない
      n.lookX = 0;
      speak(n, 'ん？', 0.6);
      return;
  }
}

/** 世話ボタン5つ（design.md §2 の反応表。押して無反応になる枝を作らない） */
function doCare(n: IppunIsshoState, kind: Kind): void {
  const waited = n.careThisOpen === 0 && n.weak > 0;

  switch (kind) {
    case 'gohan':
      if (n.asleep) return sleepy(n);
      if (n.sick) return cantDo(n, 'たべられない…');
      if (n.hunger >= METER_MAX) return shakeNo(n, 'いらない');
      gain(n, n.hunger <= CALL_AT ? P_ANSWER : P_AHEAD);
      n.hunger = Math.min(METER_MAX, n.hunger + 1);
      n.fed++;
      n.fedThisOpen = true;
      n.careThisOpen++;
      animate(n, 1);
      speak(n, waited ? '…まってたよ' : 'もぐもぐ');
      addPop(n);
      return;

    case 'asobu':
      if (n.asleep) return sleepy(n);
      if (n.sick) return cantDo(n, 'あそべない…');
      if (n.mood >= METER_MAX) return shakeNo(n, 'いらない');
      gain(n, n.mood <= CALL_AT ? P_ANSWER : P_AHEAD);
      n.mood = Math.min(METER_MAX, n.mood + 1);
      n.played++;
      n.playedThisOpen = true;
      n.careThisOpen++;
      animate(n, 2);
      speak(n, waited ? '…まってたよ' : 'たのしい！');
      addPop(n);
      return;

    case 'souji':
      // ねんね中でも片づけられる。ここを塞ぐと #3 の夜に手が無く、
      // 「閉じる前に直せば必ず助かる」（design.md §14）が成り立たなくなる
      if (n.poop <= 0) return shakeNo(n, 'きれいだよ');
      gain(n, P_ANSWER);
      n.poop = 0;
      n.cleaned++;
      n.careThisOpen++;
      animate(n, 3);
      speak(n, n.asleep ? 'そっと かたづけた' : 'きれいに なった');
      addPop(n);
      return;

    case 'kusuri':
      if (!n.sick) return shakeNo(n, 'いらない');
      gain(n, P_ANSWER);
      n.sick = false;
      n.cured++;
      n.careThisOpen++;
      animate(n, 4);
      speak(n, waited ? '…まってたよ' : 'なおった！');
      addPop(n);
      hitStop(n, 0.06);
      return;

    case 'denki':
      if (n.asleep && n.lit) {
        gain(n, P_ANSWER);
        n.lit = false;
        n.litDone = true;
        n.litCount++;
        n.careThisOpen++;
        speak(n, 'ぐっすり', 1.3);
        addPop(n);
        return;
      }
      if (n.asleep) return shakeNo(n, 'おやすみ');
      // 昼に消しても、まぶしくないので すぐ点く
      n.blackout = 0.45;
      speak(n, 'まっくら！', 0.9);
      addShake(n, 0.2);
      return;

    case 'bikkuri':
      return;
  }
}

/** つぶをタップ = なでる */
function pet(n: IppunIsshoState): void {
  // 「なでて」は寝る前のおねだり（#6）なので、ねんね中でも応えられる
  if (n.wantPet) {
    gain(n, P_PET_ASKED);
    n.wantPet = false;
    n.petted++;
    n.careThisOpen++;
    animate(n, 5);
    speak(n, 'うれしい！', 1.2);
    addPop(n);
    hitStop(n, 0.05);
    return;
  }
  if (n.asleep) return sleepy(n);
  if (n.sick) {
    speak(n, 'つらそう…', 1);
    n.lookX = 0;
    animate(n, 5);
    return;
  }
  if (n.petThisOpen === 0) {
    gain(n, P_PET);
    n.petThisOpen++;
    n.petted++;
    animate(n, 5);
    speak(n, n.turn >= 7 ? '…' : 'にこっ');
    addPop(n);
    return;
  }
  // 2回目から点は入らないが、必ず何か返す（無反応にしない）
  n.petThisOpen++;
  animate(n, 5);
  speak(n, n.turn >= 7 ? '…' : 'ふふ', 0.7);
}

function sleepy(n: IppunIsshoState): void {
  speak(n, 'すやすや…', 0.9);
  n.lookX = 0;
}

function cantDo(n: IppunIsshoState, text: string): void {
  speak(n, text, 1);
  n.noT = 0.45;
}

/** 間違い。首を振るだけで減点はしない（design.md §4） */
function shakeNo(n: IppunIsshoState, text: string): void {
  speak(n, text, 0.9);
  n.noT = 0.5;
}

/** おわかれ中のタップ。次の見せ場まで飛ばす */
function byeTap(n: IppunIsshoState): void {
  const marks = [
    BYE_WAVE,
    BYE_SEED,
    BYE_SPROUT,
    BYE_SPROUT + EPI_STEP,
    BYE_SPROUT + EPI_STEP * 2,
    BYE_SPROUT + EPI_STEP * 3,
    BYE_END,
  ];
  for (const m of marks) {
    if (n.byeT < m) {
      n.byeT = m;
      return;
    }
  }
  // もう送るものが無いときも、押した手応えだけは返す（無反応にしない）
  addPop(n);
}

/* ================================================================== *
 * 描画
 *
 * 世界は1ビット（ink と bg）。mono では accent/good/bad が ink と同色なので、
 * 強調は**反転・点滅・太さ**だけで作る（design.md §8）。
 * dim はメーターの空き●・アイコン列の非選択・手引きだけ、bg2 は液晶の外＝本体の面。
 * ================================================================== */

/** 本体の面。輪郭線・卵型・ストラップ穴は描かない（design.md §12） */
function drawBody(g: Painter): void {
  g.clear('bg2');
}

/** 上の帯: 左に「◯にちめ・あさ」、まん中に芽5つ、右に年齢 */
function drawHeadRow(g: Painter, s: IppunIsshoState): void {
  if (s.phase === 'bye' || s.phase === 'gone') {
    const head = s.early
      ? `${s.name || 'つぶ'}・${s.endAge}さいで`
      : `${s.name || 'つぶ'}・${s.endAge}さいまで いきた`;
    g.text(head, W / 2, HEAD_Y, { size: 12, align: 'center', color: 'ink' });
    return;
  }
  if (s.phase === 'egg') {
    g.text('たまご', 6, HEAD_Y, { size: 12, color: 'ink' });
  } else if (s.phase === 'name') {
    g.text('うまれた', 6, HEAD_Y, { size: 12, color: 'ink' });
  } else {
    // とじているあいだは「いま閉じた回」を出す（turn は次へ進んでいる）
    const i = Math.max(0, Math.min(AGE.length - 1, s.turn - (s.phase === 'closed' ? 2 : 1)));
    g.text(`${DAY[i]}にちめ・${WHEN[i]}`, 6, HEAD_Y, { size: 12, color: 'ink' });
    g.text(`${AGE[i]}さい`, W - 6, HEAD_Y - 3, { size: 16, align: 'right', color: 'ink' });
  }
  drawSprouts(g, s);
}

/** しあわせ 20 ごとに1つ育つ芽。5本で打ち止め */
function drawSprouts(g: Painter, s: IppunIsshoState): void {
  for (let i = 0; i < SPROUT_MAX; i++) {
    const x = SPROUT_X0 + i * SPROUT_GAP;
    const p = (s.score - i * SPROUT_STEP) / SPROUT_STEP;
    g.rect(x - 4, SPROUT_Y, 9, 1, p > 0 ? 'dim' : 'line');
    if (p <= 0) continue;
    if (p < 0.34) {
      g.rect(x - 1, SPROUT_Y - 3, 3, 3, 'ink');
    } else if (p < 0.67) {
      g.rect(x - 1, SPROUT_Y - 8, 2, 8, 'ink');
      g.rect(x + 1, SPROUT_Y - 9, 4, 3, 'ink');
    } else {
      g.rect(x - 1, SPROUT_Y - 12, 2, 12, 'ink');
      g.rect(x - 5, SPROUT_Y - 12, 4, 3, 'ink');
      g.rect(x + 1, SPROUT_Y - 13, 4, 3, 'ink');
    }
  }
}

/**
 * 液晶の窓。**角丸四角＋ink の枠線**（卵型にしない。design.md §12）。
 * painter に角丸が無いので、辺の矩形＋角の階段で作る。
 */
function windowFrame(g: Painter, blink: boolean): void {
  const c: ColorKey = 'ink';
  // 角の外側を本体の色で抜く。これをしないと、暗い液晶のとき角丸が消えて四角に見える
  for (let row = 0; row < CORNER.length; row++) {
    const cw = CORNER[row];
    g.rect(WIN_X, WIN_Y + row, cw, 1, 'bg2');
    g.rect(WIN_X + WIN_W - cw, WIN_Y + row, cw, 1, 'bg2');
    g.rect(WIN_X, WIN_Y + WIN_H - 1 - row, cw, 1, 'bg2');
    g.rect(WIN_X + WIN_W - cw, WIN_Y + WIN_H - 1 - row, cw, 1, 'bg2');
  }
  const t = blink ? WIN_LINE + 1 : WIN_LINE;
  const r = 5;
  g.rect(WIN_X + r, WIN_Y, WIN_W - r * 2, t, c);
  g.rect(WIN_X + r, WIN_Y + WIN_H - t, WIN_W - r * 2, t, c);
  g.rect(WIN_X, WIN_Y + r, t, WIN_H - r * 2, c);
  g.rect(WIN_X + WIN_W - t, WIN_Y + r, t, WIN_H - r * 2, c);
  // 角は2段の階段。この粗さがそのまま「1ドットが光っている」に見える
  for (let i = 0; i < 2; i++) {
    const d = 3 - i;
    const o = r - 3 + i * 2;
    g.rect(WIN_X + o, WIN_Y + d, 2, t, c);
    g.rect(WIN_X + WIN_W - o - 2, WIN_Y + d, 2, t, c);
    g.rect(WIN_X + o, WIN_Y + WIN_H - d - t, 2, t, c);
    g.rect(WIN_X + WIN_W - o - 2, WIN_Y + WIN_H - d - t, 2, t, c);
    g.rect(WIN_X + d, WIN_Y + o, t, 2, c);
    g.rect(WIN_X + d, WIN_Y + WIN_H - o - 2, t, 2, c);
    g.rect(WIN_X + WIN_W - d - t, WIN_Y + o, t, 2, c);
    g.rect(WIN_X + WIN_W - d - t, WIN_Y + WIN_H - o - 2, t, 2, c);
  }
}

function drawWindow(g: Painter, s: IppunIsshoState, sx: number, sy: number): void {
  const dark = darkNow(s);
  // 液晶の地。とじているあいだも消えず、暗いまま中が見える（design.md §14）
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
    } else if (s.phase === 'name') {
      drawTsubu(g, s, CHAR_X + sx, 118 + sy, ink, hole);
      g.text('なまえを えらんでね', W / 2, 126, { size: 12, align: 'center', color: 'ink' });
      drawNameCards(g, s);
    } else if (s.phase === 'bye' || s.phase === 'gone') {
      drawBye(g, s, sx, sy, ink, hole);
    } else {
      drawIconRow(g, s, ink, hole);
      drawMeters(g, s, ink, hole);
      // 床。とじているあいだも同じ位置に出して「同じ場所を覗いている」ことを保つ
      g.rect(WIN_X + 4, FLOOR_Y, WIN_W - 8, 2, ink);
      drawPoop(g, s, ink, hole);
      drawTsubu(g, s, CHAR_X + sx, FLOOR_Y + sy, ink, hole);
      drawBang(g, s, ink);
      drawGrow(g, s, ink);
    }
    drawSay(g, s, ink);
  });

  // 自動で閉じる 1.5秒前からふちが点滅して「とじるよ」と知らせる
  const max = TUNE.openMax + (s.turn === 1 ? 2 : 0);
  const warn =
    s.phase === 'open' && s.openT >= max - WARN_BEFORE && Math.floor(s.openT * 6) % 2 === 0;
  windowFrame(g, warn);
}

/* ---- 窓の中身 -------------------------------------------------------- */

/** 上辺のアイコン列。いま欲しいものだけ反転して点滅する（手が覚えている位置） */
function drawIconRow(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  const blink = Math.floor(s.time * 4) % 2 === 0;
  for (let i = 0; i < ICON_KINDS.length; i++) {
    const kind = ICON_KINDS[i];
    const cx = ICON_X0 + i * ICON_GAP;
    const on = wanted(s, kind);
    if (on && blink) {
      g.rect(cx - 9, ICON_Y - 9, 18, 18, ink);
      if (kind === 'bikkuri') {
        g.text('！', cx, ICON_Y, { size: 14, align: 'center', baseline: 'middle', color: hole });
      } else {
        drawIcon(g, kind, cx, ICON_Y, 13, hole, ink);
      }
      continue;
    }
    const c: ColorKey = on ? ink : 'dim';
    if (kind === 'bikkuri') {
      g.text('！', cx, ICON_Y, { size: 14, align: 'center', baseline: 'middle', color: c });
    } else {
      drawIcon(g, kind, cx, ICON_Y, 13, c, s.phase === 'closed' ? 'ink' : 'bg');
    }
  }
}

/**
 * メーター。●が1つになった行だけ点滅する。
 * 点滅は**行ごと反転**で作る（●を消して作ると「0になった」に見えて嘘になる）。
 */
function drawMeters(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  const rows: [string, number, number][] = [
    ['おなか', s.hunger, METER_Y1],
    ['きげん', s.mood, METER_Y2],
  ];
  const blink = Math.floor(s.time * 4) % 2 === 0;
  for (const [label, v, y] of rows) {
    const flip = v <= CALL_AT && blink;
    if (flip) g.rect(METER_X - 4, y - 2, 80, 14, ink);
    const fg: ColorKey = flip ? hole : ink;
    const empty: ColorKey = flip ? hole : 'dim';
    g.text(label, METER_X, y, { size: 10, color: fg });
    for (let i = 0; i < METER_MAX; i++) {
      const x = METER_X + 36 + i * 9;
      if (i < v) {
        g.rect(x, y + 2, 6, 6, fg);
      } else {
        g.rect(x, y + 2, 6, 1, empty);
        g.rect(x, y + 7, 6, 1, empty);
        g.rect(x, y + 3, 1, 4, empty);
        g.rect(x + 5, y + 3, 1, 4, empty);
      }
    }
  }
}

/** うんちは3つ山の丘型（渦巻きにしない。design.md §12） */
function drawPoop(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  if (s.poop <= 0) return;
  // とじているあいだは、閉じてから少し置いてポトッと落ちる
  if (s.phase === 'closed' && s.closedT < 1) return;
  const drop = s.phase === 'closed' && s.closedT < 1.25 ? (1.25 - s.closedT) * 60 : 0;
  const y = POOP_Y - drop;
  g.rect(POOP_X - 12, y + 6, 24, 4, ink);
  g.circle(POOP_X - 7, y + 5, 6, ink);
  g.circle(POOP_X + 7, y + 5, 6, ink);
  g.circle(POOP_X, y - 3, 7, ink);
  g.circle(POOP_X - 4, y + 4, 2, hole);
  g.circle(POOP_X + 5, y + 3, 2, hole);
}

/**
 * 液晶の中で点滅する大きな「！」。
 * とじているあいだ（呼び出し中）と、**ひらいた瞬間に困りごとがあるとき**に出す。
 * これが「しまった」の第一報になる（design.md §4・§11）。
 */
function drawBang(g: Painter, s: IppunIsshoState, ink: ColorKey): void {
  const on =
    s.phase === 'closed' ? calling(s) : s.openT < OPEN_BANG && troubleOf(s) !== '';
  if (!on) return;
  if (Math.floor(s.time * 4) % 2 !== 0) return;
  g.text('！', CHAR_X + 44, FLOOR_Y - 66, { size: 20, align: 'center', color: ink });
}

/** せいちょうの見出しと理由。消灯中は反転しているので色を受け取る */
function drawGrow(g: Painter, s: IppunIsshoState, ink: ColorKey): void {
  if (s.growT <= 0) return;
  g.text(s.growText, W / 2, GROW_Y, { size: 14, align: 'center', color: ink });
  if (s.growWhy) {
    g.text(s.growWhy, W / 2, GROW_WHY_Y, { size: 9, align: 'center', color: ink });
  }
  // きらきら。粒は時間の関数（乱数を使わない）
  for (let i = 0; i < 8; i++) {
    const a = i * 0.79 + s.time * 2.2;
    const r = 34 + Math.sin(s.time * 5 + i) * 10;
    g.rect(CHAR_X + Math.cos(a) * r - 1, FLOOR_Y - 34 + Math.sin(a) * r * 0.7 - 1, 3, 3, ink);
  }
}

/** 液晶の中に出る一言。ここが「無反応に見えない」の最後の砦 */
function drawSay(g: Painter, s: IppunIsshoState, ink: ColorKey): void {
  if (s.sayT <= 0 || !s.say) return;
  if (s.phase === 'name') {
    // つぶの頭（y62〜）に重ならないよう、窓のいちばん上に置く
    g.text(s.say, W / 2, 50, { size: 12, align: 'center', color: 'ink' });
    return;
  }
  g.text(s.say, W / 2, SAY_Y, { size: 11, align: 'center', color: ink });
}

/* ---- たまご ---------------------------------------------------------- */

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

function drawEgg(g: Painter, s: IppunIsshoState, sx: number, sy: number): void {
  const wob = Math.sin(s.time * (s.poke > 0 ? 26 : 4)) * (s.poke > 0 ? 4 : 2);
  g.sprite(EGG, CHAR_X + sx + wob, FLOOR_Y - 30 + sy, {
    scale: 4,
    colors: { X: 'ink' },
    center: true,
  });
  g.rect(WIN_X + 4, FLOOR_Y, WIN_W - 8, 2, 'ink');
  // 温かさだけ見せる（あとどれくらいで生まれるかは出さない）
  if (s.poke > 0) {
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + s.time * 3;
      g.rect(CHAR_X + Math.cos(a) * 40 - 1, FLOOR_Y - 30 + Math.sin(a) * 34 - 1, 3, 3, 'ink');
    }
  }
}

/* ---- なまえのカード -------------------------------------------------- */

function drawNameCards(g: Painter, s: IppunIsshoState): void {
  const ids = [s.n0, s.n1, s.n2];
  for (let i = 0; i < 3; i++) {
    const x = NCARD_X[i];
    g.rect(x, NCARD_Y, NCARD_W, NCARD_H, 'ink');
    g.rect(x + 2, NCARD_Y + 2, NCARD_W - 4, NCARD_H - 4, 'bg');
    g.text(NAMES[ids[i]], x + NCARD_W / 2, NCARD_Y + NCARD_H / 2, {
      size: 17,
      align: 'center',
      baseline: 'middle',
      color: 'ink',
    });
  }
}

/* ---- つぶ（16×16 ドット × DOT）-------------------------------------- *
 * こども4体のボディを土台に、おとなはパーツ差分で作る。
 * 顔は 64px の空間に矩形で「穴」として描く（1ビットの液晶はこう見える）。
 * ------------------------------------------------------------------- */

const BODY_TSUBU = [
  '................',
  '................',
  '......XXXX......',
  '.....XXXXXX.....',
  '....XXXXXXXX....',
  '...XXXXXXXXXX...',
  '...XXXXXXXXXX...',
  '...XXXXXXXXXX...',
  '...XXXXXXXXXX...',
  '...XXXXXXXXXX...',
  '....XXXXXXXX....',
  '.....XXXXXX.....',
  '......XXXX......',
  '......X..X......',
  '................',
  '................',
];

/** ころ。まんまるで手足が小さい */
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

/** ぴょん。長い耳と長い足 */
const BODY_PYON = [
  '..XX........XX..',
  '..XX........XX..',
  '..XX........XX..',
  '...XX......XX...',
  '....XXXXXXXX....',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  '.XXXXXXXXXXXXXX.',
  '.XXXXXXXXXXXXXX.',
  '.XXXXXXXXXXXXXX.',
  '..XXXXXXXXXXXX..',
  '...XXXXXXXXXX...',
  '....XX....XX....',
  '....XX....XX....',
  '...XXX....XXX...',
  '................',
];

/** ぽよ。少し縦長でアホ毛が1本 */
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

/** のら。葉っぱを乗せている */
const BODY_NORA = [
  '.......XX.......',
  '......XX........',
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
  '....XX....XX....',
  '................',
];

/** まんまる。ころがさらにまるくなった */
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

/** 羽（はね）。左右に1枚ずつ、肩から斜め上へ広げる */
const WING_L = ['.....X', '....XX', '..XXXX', 'XXXXXX', 'XXXXXX', '..XXXX', '....XX'];
const WING_R = ['X.....', 'XX....', 'XXXX..', 'XXXXXX', 'XXXXXX', 'XXXX..', 'XX....'];
/** ハート（なつきの胸・なでたとき） */
const HEART = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'];

/** その絵の下にある空白行の数。これを引かないと体が床から浮いて見える */
function footPad(pattern: readonly string[]): number {
  let pad = 0;
  for (let i = pattern.length - 1; i >= 0; i--) {
    if (/[^. ]/.test(pattern[i])) break;
    pad++;
  }
  return pad;
}

function bodyOf(form: Form, child: Form): readonly string[] {
  switch (form) {
    case 'tsubu':
      return BODY_TSUBU;
    case 'koro':
      return BODY_KORO;
    case 'manmaru':
      return BODY_MANMARU;
    case 'pyon':
    case 'hane':
      return BODY_PYON;
    case 'poyo':
    case 'mofu':
      return BODY_POYO;
    case 'nora':
    case 'natsuki':
    case 'tabi':
      return BODY_NORA;
    case 'kira':
      // きらは「その子が光った」姿なので、体はこどものときのまま
      return bodyOf(child, 'poyo');
  }
}

/** その回のつぶの表情 */
type Mood = 'futsu' | 'niko' | 'shon' | 'nemu' | 'kaze' | 'kuma';

function moodOf(s: IppunIsshoState): Mood {
  // 見送りの顔。最期まで生きた子は、こちらを見て笑って手を振る
  if (s.phase === 'bye' || s.phase === 'gone') return 'niko';
  if (s.sick) return 'kaze';
  if (s.asleep && !s.lit) return 'nemu';
  if (s.asleep) return 'nemu';
  if (s.kuma) return 'kuma';
  if (s.animT > 0 && (s.animKind === 2 || s.animKind === 5)) return 'niko';
  if (s.noT > 0) return 'shon';
  if (troubleOf(s) !== '') return 'shon';
  if (s.phase === 'open') return 'niko';
  return 'futsu';
}

/**
 * つぶ本体。footY は足が着く床の高さ。
 * ink/hole を渡すのは、消灯中・とじているあいだは**反転**して見せるため。
 */
function drawTsubu(
  g: Painter,
  s: IppunIsshoState,
  cx: number,
  footY: number,
  ink: ColorKey,
  hole: ColorKey,
): void {
  const elder = s.turn >= 7 && s.phase !== 'name';
  const still = s.asleep || s.sick || s.phase === 'name' || s.phase === 'bye' || s.phase === 'gone';
  // 2コマの差分で左右にちょこまか。おとしよりはゆっくり
  const beat = Math.floor(s.time * (elder ? 1.3 : 2.8)) % 2;
  const walk = still ? 0 : (beat === 0 ? -1 : 1) * (elder ? 3 : 6);
  const hop = !still && s.animT > 0 && s.animKind === 2 ? 10 : 0;
  const scale = DOT;
  // 弾みは大きさではなく「浮き」で出す（ドットの大きさが変わるとにじむ）
  const lift = Math.round(s.pop * 5);
  const w = 16 * scale;
  const h = BODY_H;
  const x = Math.round(cx + walk - w / 2);
  const body = bodyOf(s.form, s.child);
  // 絵の下の空白ぶんだけ下げて、どの姿でも床に足が着くようにする
  const y = Math.round(footY - h + footPad(body) * scale - hop - lift);

  g.sprite(body, x, y, { scale, colors: { X: ink } });

  /* パーツ差分 */
  if (s.form === 'hane') {
    g.sprite(WING_L, x - 12, y + 14, { scale: 3, colors: { X: ink } });
    g.sprite(WING_R, x + w - 6, y + 14, { scale: 3, colors: { X: ink } });
  }
  if (s.form === 'mofu') {
    // ふち毛。外周に小さな棘（角度は固定なので再現性が壊れない）
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.rect(cx + walk + Math.cos(a) * 34 - 2, y + 32 + Math.sin(a) * 30 - 2, 5, 5, ink);
    }
  }
  if (s.form === 'natsuki') {
    g.sprite(HEART, cx + walk, y + 40, { scale: 3, colors: { X: hole }, center: true });
  }
  if (s.form === 'tabi') {
    // 帽子と首巻き
    g.rect(x + 12, y - 2, 40, 8, ink);
    g.rect(x + 4, y + 4, 56, 5, ink);
    g.rect(x + 8, y + 46, 48, 6, ink);
    g.rect(x + 8, y + 48, 48, 2, hole);
  }
  if (s.form === 'kira') {
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + s.time * 2;
      const px = cx + walk + Math.cos(a) * 40;
      const py = y + 30 + Math.sin(a) * 34;
      g.rect(px - 1, py - 5, 3, 11, ink);
      g.rect(px - 5, py - 1, 11, 3, ink);
    }
  }
  if (elder) {
    // 杖。おとしよりの回だけ
    g.rect(x + w + 4, y + 26, 3, 38, ink);
    g.rect(x + w + 4, y + 22, 9, 3, ink);
  }

  drawFace(g, s, cx + walk, y, ink, hole, elder);

  /* まわりの絵 */
  if (s.asleep) {
    g.text('Zzz', cx + walk + 34, y + 2, { size: 12, align: 'center', color: ink });
  }
  if (s.sick) {
    // 汗。ひと粒だけ
    const d = (s.time * 40) % 20;
    g.circle(cx + walk + 30, y + 12 + d, 3.5, ink);
  }
  if (s.animT > 0 && s.animKind === 1) {
    // もぐもぐ。口もとに粒
    g.rect(cx + walk - 2, y + 46, 4, 4, hole);
  }
  if (s.animT > 0 && s.animKind === 5) {
    g.sprite(HEART, cx + walk + 30, y + 8, { scale: 3, colors: { X: ink }, center: true });
  }
  if (s.animT > 0 && s.animKind === 3) {
    // しゅっ。片づけた線
    for (let i = 0; i < 3; i++) {
      g.rect(POOP_X - 14 + i * 10, POOP_Y - 10 - i * 4, 8, 2, ink);
    }
  }
  if (s.animT > 0 && s.animKind === 4) {
    g.text('…', cx + walk + 32, y + 6, { size: 14, align: 'center', color: ink });
  }
  if (s.noT > 0) {
    g.text('…', cx + walk + 32, y + 6, { size: 14, align: 'center', color: ink });
  }
}

/** 顔は本体に空けた「穴」で描く。1ビットの液晶はこう見える */
function drawFace(
  g: Painter,
  s: IppunIsshoState,
  cx: number,
  top: number,
  ink: ColorKey,
  hole: ColorKey,
  elder: boolean,
): void {
  const mood = moodOf(s);
  const ey = top + (s.form === 'pyon' || s.form === 'hane' ? 30 : 26);
  // たまに こちらを見る。ふだんは進む方を見ている
  const look = Math.floor(s.time / 3.2) % 3 === 0 ? 0 : s.lookX !== 0 ? s.lookX * 2 : 0;
  const ex = [cx - 13 + look, cx + 7 + look];

  if (elder) {
    // 白い眉（体に空けた横線）
    for (const x of ex) g.rect(x - 2, ey - 9, 10, 3, hole);
  }

  for (const x of ex) {
    switch (mood) {
      case 'nemu':
        g.rect(x - 1, ey + 3, 8, 3, hole);
        break;
      case 'kaze':
        g.line(x, ey, x + 6, ey + 7, hole, 3);
        g.line(x + 6, ey, x, ey + 7, hole, 3);
        break;
      case 'niko':
        g.rect(x, ey + 4, 6, 3, hole);
        g.rect(x - 1, ey + 1, 2, 3, hole);
        g.rect(x + 5, ey + 1, 2, 3, hole);
        break;
      case 'kuma':
        g.rect(x, ey, 6, 6, hole);
        g.rect(x - 1, ey + 9, 8, 2, hole);
        break;
      case 'shon':
        g.rect(x, ey + 2, 6, 5, hole);
        break;
      default:
        g.rect(x, ey, 6, 7, hole);
    }
  }

  // 口
  const my = ey + 16;
  if (mood === 'niko') {
    g.rect(cx - 6 + look, my, 12, 3, hole);
    g.rect(cx - 8 + look, my - 3, 3, 3, hole);
    g.rect(cx + 5 + look, my - 3, 3, 3, hole);
  } else if (mood === 'shon' || mood === 'kaze') {
    g.rect(cx - 5 + look, my, 10, 3, hole);
  } else if (mood !== 'nemu') {
    g.rect(cx - 3 + look, my, 6, 3, hole);
  }
  void ink;
}

/* ---- おわかれ -------------------------------------------------------- */

function drawBye(
  g: Painter,
  s: IppunIsshoState,
  sx: number,
  sy: number,
  ink: ColorKey,
  hole: ColorKey,
): void {
  // 早い死は夜の液晶（反転して暗い）。最期まで生きた版は夕方の明るい液晶のまま
  g.rect(WIN_X + 4, FLOOR_Y, WIN_W - 8, 2, ink);

  if (!s.early && s.byeT < BYE_SINK) {
    // 手を振る
    drawTsubu(g, s, CHAR_X + sx, FLOOR_Y + sy, ink, hole);
    // 手を振る。杖（右）と重ならないよう左側に出す
    const up = Math.floor(s.byeT * 4) % 2 === 0 ? -6 : 2;
    const hx = CHAR_X - 40;
    const hy = FLOOR_Y - 54 + up;
    for (let i = 0; i < 3; i++) g.rect(hx + i * 5, hy, 4, 10, ink);
    g.rect(hx, hy + 8, 14, 12, ink);
    g.rect(hx + 4, hy + 18, 8, 16, ink);
  } else if (!s.early && s.byeT < BYE_SEED) {
    // 土に沈む
    const p = Math.min(1, (s.byeT - BYE_SINK) / BYE_SINK_LEN);
    g.clip(WIN_X, WIN_Y, WIN_W, FLOOR_Y - WIN_Y, () => {
      drawTsubu(g, s, CHAR_X + sx, FLOOR_Y + p * BODY_H + sy, ink, hole);
    });
  }

  if (s.byeT >= BYE_SEED) {
    // たね
    g.circle(CHAR_X, FLOOR_Y - 5, 5, ink);
    g.rect(CHAR_X - 6, FLOOR_Y - 6, 12, 3, ink);
  }
  if (s.byeT >= BYE_SPROUT) {
    // 芽。早い死のほうはゆっくり伸びる
    const p = Math.min(1, (s.byeT - BYE_SPROUT) / (s.early ? 1.6 : 0.8));
    const hgt = Math.round(26 * p);
    const ty = FLOOR_Y - 6 - hgt;
    g.rect(CHAR_X - 1, ty, 3, hgt + 4, ink);
    if (p > 0.5) {
      // 双葉。左右で高さをずらすと「まだ伸びている途中」に見える
      g.circle(CHAR_X - 7, ty + 1, 5, ink);
      g.rect(CHAR_X - 8, ty - 2, 8, 5, ink);
      g.circle(CHAR_X + 8, ty - 4, 5, ink);
      g.rect(CHAR_X + 1, ty - 7, 8, 5, ink);
    }
  }

  drawEpitaph(g, s, ink);
}

/**
 * 記念の文。flat な統計から draw で組み立てる（配列に持たない）。
 * 芽が出たあと、芽の上へ 0.7秒おきに4行。
 */
function drawEpitaph(g: Painter, s: IppunIsshoState, ink: ColorKey): void {
  if (s.epShown <= 0) return;
  const lines: string[] = [];
  lines.push(`${s.name || 'つぶ'}（${FORM_NAME[s.form]}）は、`);

  const care: [string, number][] = [
    ['ごはん', s.fed],
    ['あそび', s.played],
    ['そうじ', s.cleaned],
    ['なでなで', s.petted],
    ['おくすり', s.cured],
    ['でんき', s.litCount],
  ];
  const parts = care
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k} ${v}`);
  // 10px で 240px に収まるのは 22文字まで。超えるぶんは落とす（両端が切れると読めない）
  let line2 = '';
  for (const part of parts) {
    if (line2.length > 0 && line2.length + 1 + part.length > 22) break;
    line2 = line2 ? `${line2}・${part}` : part;
  }
  lines.push(line2 || 'ひとりで すごした');

  // 3行目は嘘にならないものを1つだけ
  const favName = s.fav === 'gohan' ? 'ごはん' : s.fav === 'asobu' ? 'あそぶこと' : 'なでなで';
  const favCare = s.fav === 'gohan' ? s.fed : s.fav === 'asobu' ? s.played : s.petted;
  const favTop = favCare >= 3 && favCare >= Math.max(s.fed, s.played, s.petted);
  if (s.early) lines.push('ひとりの じかんが ながかった');
  else if (favTop) lines.push(`いちばん すきだったのは ${favName}`);
  else lines.push(`ほんとうは ${favName}が すきだった`);

  lines.push(s.early ? `${s.endAge}さいで たねに なった` : `${s.endAge}さいまで いきた`);

  for (let i = 0; i < Math.min(s.epShown, 4); i++) {
    g.text(lines[i], W / 2, EPI_Y + i * EPI_LINE, { size: 10, align: 'center', color: ink });
  }
}

/* ---- とじているあいだの札と時計 -------------------------------------- */

function drawDayCard(g: Painter, s: IppunIsshoState): void {
  const i = Math.min(CLOSED_LABEL.length - 1, Math.max(0, s.turn - 2));
  g.text(`${DAY[i]}にちめ・${CLOSED_LABEL[i]}`, W / 2, CARD_Y, {
    size: 14,
    align: 'center',
    color: 'ink',
  });

  // 時計。文字を使わずに時刻を出す（英数字も絵文字も使わない）
  const hour = CLOSED_HOUR[i];
  g.circleLine(CLOCK_X, CLOCK_Y, CLOCK_R, 'ink', 2);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 - Math.PI / 2;
    g.rect(
      CLOCK_X + Math.cos(a) * (CLOCK_R - 5) - 1,
      CLOCK_Y + Math.sin(a) * (CLOCK_R - 5) - 1,
      2,
      2,
      'ink',
    );
  }
  const ha = ((hour % 12) / 12) * Math.PI * 2 - Math.PI / 2;
  g.line(CLOCK_X, CLOCK_Y, CLOCK_X + Math.cos(ha) * 10, CLOCK_Y + Math.sin(ha) * 10, 'ink', 3);
  g.line(CLOCK_X, CLOCK_Y, CLOCK_X, CLOCK_Y - 16, 'ink', 2);
}

/* ---- とじる と 世話ボタン -------------------------------------------- */

function drawControls(g: Painter, s: IppunIsshoState): void {
  const live = s.phase === 'open';

  /* とじる。幅いっぱいの反転ボタン */
  const pressed = s.pressT > 0 && s.pressBtn === -1;
  g.rect(WIN_X, CLOSE_Y, WIN_W, CLOSE_H, pressed ? 'bg' : 'ink');
  g.rect(WIN_X + 2, CLOSE_Y + 2, WIN_W - 4, CLOSE_H - 4, pressed ? 'ink' : 'bg');
  g.rect(WIN_X + 3, CLOSE_Y + 3, WIN_W - 6, CLOSE_H - 6, pressed ? 'bg' : 'ink');
  g.text('とじる（ポケットに しまう）', W / 2, CLOSE_Y + CLOSE_H / 2, {
    size: 11,
    align: 'center',
    baseline: 'middle',
    color: pressed ? 'ink' : 'bg',
  });

  /* 世話ボタン5つ。押した瞬間は反転 */
  for (let i = 0; i < 5; i++) {
    const x = BTN_X0 + i * BTN_GAP;
    const hot = s.pressT > 0 && s.pressBtn === i;
    const ask = live && wanted(s, BTN_KINDS[i]) && Math.floor(s.time * 4) % 2 === 0;
    const on = hot || ask;
    g.rect(x, BTN_Y, BTN_W, BTN_H, on ? 'ink' : 'bg');
    g.rectLine(x, BTN_Y, BTN_W, BTN_H, 'ink', 2);
    const c: ColorKey = on ? 'bg' : live ? 'ink' : 'dim';
    drawIcon(g, BTN_KINDS[i], x + BTN_W / 2, BTN_Y + 24, 24, c, on ? 'ink' : 'bg');
    g.text(BTN_LABEL[i], x + BTN_W / 2, BTN_Y + 44, {
      size: 9,
      align: 'center',
      color: on ? 'bg' : 'dim',
    });
  }
}

/** 最下段の手引き。dim・9px なので邪魔にならない */
function drawHelp(g: Painter, s: IppunIsshoState): void {
  if (s.phase === 'bye' || s.phase === 'gone') return;
  // 9px で 240px に収まる長さに切ってある（1行に全部入れると両端が切れる）
  const alt = Math.floor(s.time / 4) % 2 === 1;
  const text =
    s.phase === 'closed'
      ? 'とじているあいだ じかんが すすむ'
      : s.phase === 'name'
        ? 'カードを おして なまえを つける'
        : s.phase === 'egg'
          ? 'たまごを おして あたためる'
        : alt
          ? 'とじると じかんが すすむ'
          : 'ボタンで せわ・つぶを タップで なでる';
  g.text(text, W / 2, HELP_Y, { size: 9, align: 'center', color: 'dim' });
}

/* ---- アイコン（1ビットで自作。上辺の列と下のボタンは同じ絵）--------- */

function drawIcon(
  g: Painter,
  kind: Kind,
  cx: number,
  cy: number,
  size: number,
  c: ColorKey,
  hole: ColorKey,
): void {
  const u = size / 24;
  switch (kind) {
    case 'gohan': {
      // 茶碗＋湯気
      g.poly(
        [
          cx - 11 * u,
          cy + 1 * u,
          cx + 11 * u,
          cy + 1 * u,
          cx + 7 * u,
          cy + 10 * u,
          cx - 7 * u,
          cy + 10 * u,
        ],
        c,
      );
      g.rect(cx - 12 * u, cy - 2 * u, 24 * u, 3 * u, c);
      g.rect(cx - 6 * u, cy - 10 * u, 2 * u, 6 * u, c);
      g.rect(cx + 4 * u, cy - 11 * u, 2 * u, 7 * u, c);
      break;
    }
    case 'asobu': {
      // 縞のボール
      g.circle(cx, cy, 10 * u, c);
      g.rect(cx - 10 * u, cy - 3 * u, 20 * u, 2 * u, hole);
      g.rect(cx - 10 * u, cy + 2 * u, 20 * u, 2 * u, hole);
      break;
    }
    case 'souji': {
      // ほうき
      g.rect(cx - 1 * u, cy - 11 * u, 3 * u, 13 * u, c);
      g.poly(
        [cx - 8 * u, cy + 11 * u, cx + 9 * u, cy + 11 * u, cx + 5 * u, cy + 1 * u, cx - 4 * u, cy + 1 * u],
        c,
      );
      break;
    }
    case 'kusuri': {
      // 斜めに置いたカプセル。まん中に分かれ目を入れて「薬」と読めるようにする
      g.circle(cx - 5 * u, cy + 5 * u, 6 * u, c);
      g.circle(cx + 5 * u, cy - 5 * u, 6 * u, c);
      g.poly(
        [cx - 10 * u, cy + 1 * u, cx - 1 * u, cy - 9 * u, cx + 10 * u, cy - 1 * u, cx + 1 * u, cy + 9 * u],
        c,
      );
      g.line(cx - 6 * u, cy - 4 * u, cx + 4 * u, cy + 6 * u, hole, 2 * u);
      break;
    }
    case 'denki': {
      // 電球
      g.circle(cx, cy - 3 * u, 8 * u, c);
      g.rect(cx - 4 * u, cy + 4 * u, 8 * u, 4 * u, c);
      g.rect(cx - 3 * u, cy + 8 * u, 6 * u, 3 * u, c);
      break;
    }
    case 'bikkuri':
      break;
  }
}
