/**
 * 一分一生（いっぷんいっしょう）── v5
 *
 * **あさに生まれ、よるに力尽きる。一日だけの命を、そばで看取る。**
 *
 * v4（ひらく→せわ→とじる）を実機で遊んだオーナーの根幹 FB（2026-08-22）で作り直した。
 * ①「とじる」が分からない ②チカチカを押すだけ ③左上メーターを見て下ボタンを押す往復で
 * 真ん中のキャラを見ない ④メーターと押すボタンの点滅で視線がガチャつく ⑤1分＝一生の必然性がない。
 * → オーナー判断（2026-08-23）で v5（design.md §14）:
 *
 * ・⑤ 題材を「一日の命」の生き物に。あさ→ひる→ゆうがた→よる を約48秒で流す（儚さが主題）
 * ・③④ メーターを廃止。おなか・きげん・体調は内部に持ち、キャラの顔・しぐさ・動きだけで見せる
 * ・①② とじるを廃止。時間は流れ続け、一日をずっとそばで看取る（作業感を消す）
 *
 * 正解の気持ち（design.md §0）:
 * ・生まれたて = **いとおしい**（たよりない子）
 * ・応えて喜ぶ = **ほっとする**（しぐさで気づいて先に応えると「わかってる！」）
 * ・見落とした = **しまった**（静かなしぐさを見落とすと ぐあいがわるくなる。気づけば助かる）
 * ・最期       = **見届けた**（よるに静かに、あるいは早い別れに「ごめん」→ たね → 芽 → 記念）
 *
 * 時間は turn ではなく「生まれてからの秒 `t`」で連続的に進む（とじないので実時間そのもの）。
 * せいちょう（姿決定）は t=20 の1回。上振れは きら と ゆうがたの一番星の2本。
 * 設計は docs/plans/008-ippun-issho/design.md（v5）。権利の線引きは §12。
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
  /** 開いている間、おなか・きげんが1マス減るのにかかる秒数（目の前でゆっくり減る） */
  openDrain: 5,
  /** `weak` がいくつ溜まったら力尽きるか（世話で 0 に戻るので、気づけば助かる） */
  weakToDie: 7,
};

/* ================================================================== *
 * 一生の時間割（design.md §3）── turn ではなく「孵化からの秒 `t`」で進む
 * ================================================================== */

/* 一日の時間割（design.md §3）。生まれてからの秒 `t` で進む。約48秒で一生 */
/** せいちょう（姿が決まる）＝ひるの中ほど。1回だけ */
const GROW_AT = 20;
/** ひる（よちよち→元気）に入る時刻。ここまでが あさ */
const T_NOON = 12;
/** ゆうがた（落ち着く。動きがゆっくり・色が淡く）に入る時刻 */
const T_DUSK = 28;
/** よる（眠くなる。おやすみで寝かせる）に入る時刻 */
const T_NIGHT = 42;
/** よるの終わり＝力尽きる（最期まで生きた） */
const T_BYE = 48;

/** おなか0（起きている）／退屈0／ぐあいわるい のまま、`weak` が +1 されるまでの秒数 */
const WEAK_OPEN = 3;
/** おなか0 か 退屈0 を放置して、ぐあいがわるくなる（×目）までの秒数 */
const SICK_ONSET = 6;

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
/** おなか・きげんの満タン（内部だけ。画面には数値を出さない） */
const METER_MAX = 4;
/** これ以下で「呼んでいる」（頭上に合図＋ピピッ）。応えて +3（P_ANSWER） */
const CALL_AT = 1;
/** これなら「かすかに気にする」（呼ぶ前・しぐさだけ）。先に応えると +4（P_AHEAD） */
const AHEAD_AT = 2;

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
/** 「呼んでいる」に応えた（頭上の合図が出てから） */
const P_ANSWER = 3;
/** 呼ぶ前の「かすかに気にする」しぐさに、先に気づいて応えた（わかってる！） */
const P_AHEAD = 4;
/** なでる（1回に1回）／「なでて」とねだられて なでた */
const P_PET = 1;
const P_PET_ASKED = 3;
/** せいちょう（姿決定） */
const P_GROW = 5;
/** ゆうがたに落ち着いた（余白のしるし） */
const P_ELDER = 3;
/** ゆうがたの一番星をタップした（上振れ②。init 20% の子だけ空に出る） */
const P_HOSHI = 8;
/** きらになったとき（上振れ①） */
const P_KIRA = 15;
/** きらは以後この倍率で点が入る */
const KIRA_MULT = 1.5;
/** よるまで生きた（最期まで看取れた） */
const P_LIVED = 10;

/** せいちょうの見出しを出しておく秒数 */
const GROW_BANNER_T = 1.8;

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
/** 床の線 */
const FLOOR_Y = 190;
/** つぶの立ち位置 */
const CHAR_X = 120;
/** 16×16 ドットの1ドット */
const DOT = 4;
/** 体の高さ（16ドット×DOT） */
const BODY_H = 16 * DOT;
/** 液晶の中に出る一言 */
const SAY_Y = 196;
/** せいちょうの見出しと理由 */
const GROW_Y = 96;
const GROW_WHY_Y = 112;
/** 世話ボタン5つ */
const BTN_Y = 242;
const BTN_H = 62;
const BTN_W = 44;
const BTN_X0 = 4;
const BTN_GAP = 47;
/** 手引き */
const HELP_Y = 307;
/** 上帯中央の称号ゲージの y（design.md §6・v6 FB4②） */
const SPROUT_Y = 24;
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

/** 世話の種類。ボタン5つと同じ並び。頭上のしぐさアイコンも同じ絵を引用する（design.md §2） */
type Kind = 'gohan' | 'asobu' | 'nade' | 'kusuri' | 'oyasumi';

const BTN_KINDS: readonly Kind[] = ['gohan', 'asobu', 'nade', 'kusuri', 'oyasumi'];
const BTN_LABEL: readonly string[] = ['ごはん', 'あそぶ', 'なでる', 'くすり', 'おやすみ'];

type Phase = 'egg' | 'name' | 'open' | 'bye' | 'gone';
/** 見た目の段階。elder＝ゆうがた以降＝落ち着き（動きがゆっくり・色が淡い） */
type Stage = 'baby' | 'grown' | 'elder';

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

/* ---- 時間 `t` から段階・時間帯を出す（design.md §3）------------------ *
 * 一日を一本道で流す。年齢の数字・「◯にちめ」は出さない（v4 から廃止）。
 * ------------------------------------------------------------------- */

/** その時刻の段階（見た目に効く。elder＝ゆうがた以降＝落ち着き） */
function stageOf(t: number): Stage {
  if (t < GROW_AT) return 'baby'; // あさ〜ひる前半（姿が決まる前・よちよち）
  if (t < T_DUSK) return 'grown'; // 姿が決まってから ゆうがた まで（元気）
  return 'elder'; // ゆうがた・よる（動きがゆっくり・色が淡い）
}

/** よるか（人生の終盤。眠くなり、おやすみで寝かせる。Zzz が出る） */
function isYoru(t: number): boolean {
  return t >= T_NIGHT;
}

/** 上の帯に出す時間帯 */
function whenLabel(t: number): string {
  if (t < T_NOON) return 'あさ';
  if (t < T_DUSK) return 'ひる';
  if (t < T_NIGHT) return 'ゆうがた';
  return 'よる';
}

/* ---- 状態 ------------------------------------------------------------ *
 * **フラットに持つ。** 予定も演出もすべてスカラーで、粒（きらきら・汗）は
 * `s.time` の関数にしてある（配列を持つと `{...s}` の浅いコピーで壊れる）。
 * ------------------------------------------------------------------- */

export interface IppunIsshoState extends BaseState, FeelState {
  /* 進行 */
  phase: Phase;
  /** そのフェーズに入った時刻（ボットが「少し待ってから動く」ために見る） */
  phaseAt: number;
  /** 生まれてからのゲーム内時間（秒）。とじないので実時間そのもの。段階・せいちょうはこれで決まる */
  t: number;
  /** open に入ってからの秒（open では t とほぼ一致する。連打やねだりの間合いに使う） */
  openT: number;
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

  /* おなか・きげん・体調（画面には数値を出さない。しぐさで見せる。design.md §2） */
  hunger: number;
  mood: number;
  sick: boolean;
  /** よるで眠くなっているか（`t` から決まる） */
  asleep: boolean;
  /** よるに おやすみで寝かせたか（ぐっすり看取れる） */
  slept: boolean;
  /** 「なでて」とねだっているか */
  wantPet: boolean;

  /* 開いている間のタイマー（すべてスカラー） */
  /** おなか・きげんが1マス減るまでの溜め */
  drainT: number;
  /** よわり（おなか0/退屈0/ぐあいわるい のまま）の溜め */
  weakT: number;
  /** おなか0か退屈0を放置して ぐあいわるくなるまでの溜め */
  sickClock: number;

  /* 累計 */
  weak: number;
  /** 一度でも よわったか（育ちが見る） */
  weakEver: boolean;
  /** 呼んでいたのに気づけなかった回数（記念・分岐が見る） */
  missed: number;
  fed: number;
  played: number;
  cured: number;
  petted: number;
  sickDays: number;

  /* 育ち */
  form: Form;
  /** 姿が決まる前の見た目（つぶ）。分岐の記録にも使う */
  child: Form;
  kira: boolean;
  /** どこまで育ったか（0=あかちゃん 1=姿が決まった 2=ゆうがたに落ち着いた） */
  growStage: number;
  /** すきなもの（記念の文が見る） */
  fav: 'gohan' | 'asobu' | 'nade';
  /** かくれた運（非表示。きらの条件） */
  lucky: boolean;
  /** ゆうがたに一番星が出る子か（init 20%。上振れ②） */
  ichiban: boolean;
  /** その一番星をタップして取ったか */
  hoshiGot: boolean;
  alive: boolean;
  /** 早い別れか（よるまで生きられなかった） */
  early: boolean;
  /** 力尽きた時刻（記念・結果の時間帯に使う。よるまで生きたら T_BYE） */
  endT: number;

  /* その回の状態 */
  /** 最後に なでて点が入った openT（連打では点が入らない） */
  petAt: number;

  /* 演出 */
  say: string;
  sayT: number;
  /** 0=なし 1=もぐもぐ 2=はねる 3=なでた 4=なおった 5=うれしい 6=ぐっすり。1〜6 はハートを出す */
  animKind: number;
  animT: number;
  /** 首を振っている残り */
  noT: number;
  /** 押したボタン（反転させる） */
  pressBtn: number;
  pressT: number;
  /** せいちょうの見出し */
  growT: number;
  growText: string;
  growWhy: string;
  /** おやすみ／一番星の空タップの一瞬の演出 */
  blackout: number;
  /** たまごを温めた残り */
  poke: number;
  /** 「ん？」で見る向き（-1/0/1） */
  lookX: number;
  /** そのフェーズで何回鳴らしたか（呼び出し／死の音） */
  beeped: number;
  /** 記念の何行目まで出したか */
  epShown: number;
  /** 手応えポップ（＋N を大きく出す。design.md §4）。0=なし */
  gainPop: number;
  gainPopT: number;
  /** 手応えの言葉（わかってる！/いらない 等） */
  gainWord: string;
}

/* ---- 小さな道具 ------------------------------------------------------ */

/** 点を足す。きらになった子は以後 ×KIRA_MULT（design.md §6） */
function gain(n: IppunIsshoState, base: number): void {
  const add = n.kira ? Math.round(base * KIRA_MULT) : base;
  n.score += add;
  // 一手ごとの手応え。「＋N」を大きくポップ（design.md §4）
  n.gainPop = add;
  n.gainPopT = 0.85;
  n.gainWord = '';
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

/** ピピッ（呼び出し）。1増やすと共通シェルが1回鳴らす */
function beep(n: IppunIsshoState): void {
  n.cue = (n.cue ?? 0) + 1;
}

/**
 * いま「はっきり困っている」こと＝頭上に合図（ボタンの絵）を出す1件。無ければ空。
 * design.md §2 の3段のうち「呼んでいる」。呼ぶ前の気配は wishOf（頭上には出さない）。
 */
function troubleOf(s: IppunIsshoState): Kind | '' {
  if (s.phase !== 'open') return '';
  if (s.sick) return 'kusuri';
  if (s.asleep && !s.slept) return 'oyasumi';
  if (s.hunger <= CALL_AT) return 'gohan';
  if (s.mood <= CALL_AT) return 'asobu';
  if (s.wantPet) return 'nade';
  return '';
}

/**
 * 呼ぶ前の「かすかに気にする」気配（頭上アイコンは出さず、姿勢だけで見せる）。
 * ここで先に気づいて応えると P_AHEAD（わかってる！）。design.md §2 の中段。
 */
function wishOf(s: IppunIsshoState): Kind | '' {
  if (s.phase !== 'open' || s.asleep || troubleOf(s) !== '') return '';
  if (s.hunger === AHEAD_AT) return 'gohan';
  if (s.mood === AHEAD_AT) return 'asobu';
  return '';
}

/** そのボタンが「いま応えるべきもの」か（下のボタンが反転して点滅する。頭上の合図と同じ1件） */
function wanted(s: IppunIsshoState, kind: Kind): boolean {
  if (s.phase !== 'open') return false;
  return troubleOf(s) === kind;
}

/** 液晶が暗いか（よるに寝かせた／おやすみ・空タップの演出／早い別れの暗い画面） */
function darkNow(s: IppunIsshoState): boolean {
  if (s.blackout > 0) return true;
  if ((s.phase === 'bye' || s.phase === 'gone') && s.early) return true;
  return s.phase === 'open' && s.asleep && s.slept;
}

/** ゆうがたの空に一番星が出ているか（ichiban の子・まだ取っていない・ゆうがた。上振れ②） */
function starUp(s: IppunIsshoState): boolean {
  return s.phase === 'open' && s.ichiban && !s.hoshiGot && s.t >= T_DUSK && s.t < T_NIGHT;
}

/* ---- 当たり判定 ------------------------------------------------------ *
 * 順番は 世話ボタン → とじる → つぶ → 液晶の中 → それ以外（design.md §2）。
 * ここで使う数値は draw と共有している定数だけ（ずれると押しても効かない）。
 * ------------------------------------------------------------------- */

type HitWhat = 'btn' | 'char' | 'window' | 'card' | 'none';

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
  // つぶの当たりは体より少し広く取る（ドット絵の隙間で外れると「押したのに」になる）
  if (Math.abs(px - CHAR_X) < 40 && py >= FLOOR_Y - BODY_H - 8 && py < FLOOR_Y + 6) {
    return { what: 'char', i: -1 };
  }
  // 液晶の中（空をふくむ）。ゆうがたは空の上のほうに一番星（handleTap で判定）
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
      t: 0,
      openT: 0,
      byeT: 0,
      hatchAt: EGG_AT,
      eggTaps: 0,

      n0: pick[0],
      n1: pick[1],
      n2: pick[2],
      name: '',

      // あかちゃん期は呼び出しが多い。おなかは高めから、きげんは早めに減る
      hunger: 3,
      mood: 2,
      sick: false,
      asleep: false,
      slept: false,
      wantPet: false,

      drainT: 0,
      weakT: 0,
      sickClock: 0,

      weak: 0,
      weakEver: false,
      missed: 0,
      fed: 0,
      played: 0,
      cured: 0,
      petted: 0,
      sickDays: 0,

      form: 'tsubu',
      child: 'tsubu',
      kira: false,
      growStage: 0,
      fav,
      lucky: rng.chance(0.25),
      ichiban: rng.chance(0.2),
      hoshiGot: false,
      alive: true,
      early: false,
      endT: T_BYE,

      petAt: -99,

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
      gainPop: 0,
      gainPopT: 0,
      gainWord: '',
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
    n.gainPopT = Math.max(0, n.gainPopT - dt);
    if (n.pressT <= 0) n.pressBtn = -2;

    /* 2. 一日ぶんの時間を流し続ける（とじない）。よるになると眠くなる */
    if (n.phase === 'open') {
      n.openT += dt;
      n.t += dt;
      n.asleep = isYoru(n.t);
    } else if (n.phase === 'bye' || n.phase === 'gone') {
      n.byeT += dt;
    }

    /* 3. 入力（いつでも受ける） */
    if (takeTap(n)) handleTap(n, input.px, input.py);

    /* 4. 開いている間に、目の前で減る・よわる（design.md §3・§5） */
    if (n.phase === 'open' && n.alive) openDrain(n, dt);

    /* 5. 時間で起きること（孵化・せいちょう・おわかれ） */
    stepPhase(n, now, rng);

    return n;
  },

  draw(g, s) {
    const [sx, sy] = shakeOffset(s, s.time);
    drawBody(g);
    // over 後（gone）はシェルの結果画面に全部ゆずる（記念は bye で見せ切る。二重表示を防ぐ）
    if (s.phase === 'gone') return;
    drawHeadRow(g, s);
    drawWindow(g, s, sx, sy);
    // おわかれ（bye）は記念に集中させる（ボタン・手引きを消す。design.md §7）
    if (s.phase !== 'bye') {
      drawControls(g, s);
      drawHelp(g, s);
    }
  },

  /**
   * 上手い人。**押すフレームだけ press を立てる**（押しっぱなしにすると、
   * aim では毎フレーム別の場所を押したことになってしまう）。
   * `% 21` ＝ 0.35秒に1手。ここを `% 2` にすると毎秒30タップの別人になる。
   * とじないので、困りごとに応え続けて一日を看取る。上手い人は「呼ぶ前」に先に応える。
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
    const star = { press: true, px: CHAR_X + 60, py: WIN_Y + 24 };

    switch (s.phase) {
      case 'egg':
        // 温めると早く孵る。3回で打ち止め
        return s.eggTaps < EGG_TAPS ? char : idle;
      case 'name':
        // 少し考えてから左のカード
        return s.time - s.phaseAt >= 0.6
          ? { press: true, px: NCARD_X[0] + NCARD_W / 2, py: NCARD_Y + NCARD_H / 2 }
          : idle;
      case 'bye':
      case 'gone':
        // 1.0秒ごとに次の行へ送る
        return frame % 63 === 0 ? char : idle;
      case 'open':
        break;
    }

    // 困っているものから順に。上手い人は「呼ぶ前」（AHEAD_AT）に先に応える（design.md §9）
    if (s.sick) return btn(3);
    if (s.asleep) return s.slept ? idle : btn(4);
    if (s.wantPet) return char;
    if (s.hunger <= AHEAD_AT) return btn(0);
    if (s.mood <= AHEAD_AT) return btn(1);
    // ゆうがたの一番星は見つけたら取る（上振れ②）
    if (starUp(s)) return star;
    return idle;
  },

  reason: (s) =>
    s.early
      ? `${s.name || 'つぶ'}、${whenLabel(s.endT)}に おわかれ`
      : `${s.name || 'つぶ'}、あさから よるまで いっしょ`,

  tunables: {
    openDrain: {
      label: '減りの速さ（1マスの秒数）',
      min: 3,
      max: 9,
      get: () => TUNE.openDrain,
      set: (v) => {
        TUNE.openDrain = v;
      },
    },
    weakToDie: {
      label: 'よわり何回で力尽きるか',
      min: 2,
      max: 8,
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

/**
 * 開いている間の減り・よわり（v4 の芯）。目の前でメーターが減り、放っておくと よぼよぼになる。
 * おとしより（余白）は何も減らない。ねんね中はおなかも減らない。
 */
function openDrain(n: IppunIsshoState, dt: number): void {
  const elder = stageOf(n.t) === 'elder';

  /* おなか・きげんが減る。ゆうがた以降（elder）はゆっくり（落ち着き）。ねんね中は減らない */
  if (!n.asleep) {
    n.drainT += dt;
    const span = elder ? TUNE.openDrain * 1.8 : TUNE.openDrain;
    if (n.drainT >= span) {
      n.drainT -= span;
      const hb = n.hunger;
      const mb = n.mood;
      n.hunger = Math.max(0, n.hunger - 1);
      n.mood = Math.max(0, n.mood - 1);
      // ちょうど「呼んでいる」の線に落ちたら鳴らす（1回だけ）
      if ((hb > CALL_AT && n.hunger <= CALL_AT) || (mb > CALL_AT && n.mood <= CALL_AT)) beep(n);
    }
  }

  /* あさ（あかちゃん）と ゆうがた以降は静かなので、8秒に一度「なでて」とねだる（見どころを絶やさない） */
  const wantsPet = stageOf(n.t) === 'baby' || elder;
  if (wantsPet && !n.wantPet && !n.sick && !n.asleep && n.mood >= 1 && n.openT - n.petAt >= 8) {
    n.wantPet = true;
    beep(n);
  }

  /* おなか0 か 退屈0 を放置すると、ぐあいがわるくなる（×目）。頭上にカプセル＝くすり */
  if ((n.hunger <= 0 || n.mood <= 0) && !n.sick && !n.asleep) {
    n.sickClock += dt;
    if (n.sickClock >= SICK_ONSET) {
      n.sickClock = 0;
      n.sick = true;
      n.sickDays++;
      beep(n);
      addShake(n, 0.2);
    }
  } else if (!n.sick) {
    n.sickClock = 0;
  }

  /* おなか0／退屈0（起きているとき）／ぐあいわるい のまま時間が進むと、よわりが溜まる。
     weak=weakToDie で力尽きる。ねんね中は空いても よわらない。ぐあいわるいは寝ていても進む */
  if (((n.hunger <= 0 || n.mood <= 0) && !n.asleep) || n.sick) {
    n.weakT += dt;
    if (n.weakT >= WEAK_OPEN) {
      n.weakT -= WEAK_OPEN;
      n.weak++;
      n.weakEver = true;
      if (n.weak >= 2) addShake(n, 0.1);
      if (n.weak >= TUNE.weakToDie) {
        // その場で力尽きる（design.md §5）。早い別れ
        n.endT = n.t;
        n.alive = false;
        startBye(n, n.time, true);
      }
    }
  } else {
    n.weakT = 0;
  }
}

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
        beep(n);
      }
      break;

    case 'name':
      // 選ばずにいると自分で名乗る
      if (now - n.phaseAt >= NAME_WAIT) {
        setName(n, [n.n0, n.n1, n.n2][rng.int(3)]);
        openTurn(n, now);
      }
      break;

    case 'open':
      // 時間は流れ続ける。せいちょう（姿決定・ゆうがた）は目の前で起きる
      if (n.alive) checkGrowth(n);
      // よるの終わりまで生きたら、静かなおわかれへ
      if (n.alive && n.t >= T_BYE) startBye(n, now, false);
      break;

    case 'bye': {
      // 「…しずかだ」のあいだにピーピー鳴らす（死の音。フレームを分けて3回）
      if (n.early) {
        if (n.beeped === 0 && n.byeT >= 0.2) {
          beep(n);
          n.beeped = 1;
        } else if (n.beeped === 1 && n.byeT >= 0.6) {
          beep(n);
          n.beeped = 2;
        } else if (n.beeped === 2 && n.byeT >= 1) {
          beep(n);
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

/** なまえを決める */
function setName(n: IppunIsshoState, id: number): void {
  n.name = NAMES[id];
}

/**
 * ひらく。年齢・せいちょうはここで（開けた瞬間に）見える。
 * 開けた瞬間に困りごとがあれば ピピッ ＋「！」＋アイコン列の反転（design.md §4）。
 */
function openTurn(n: IppunIsshoState, now: number): void {
  n.phase = 'open';
  n.phaseAt = now;
  n.openT = 0;
  n.petAt = -99;
  n.beeped = 0;
  n.drainT = 0;
  n.weakT = 0;
  n.sickClock = 0;
  n.asleep = isYoru(n.t);
  // 生まれてすぐは たよりない。最初に「なでて」とこちらを見上げる
  n.wantPet = !n.asleep && n.mood >= 2;
  speak(n, 'こんにちは', 1);
  addPop(n);
}

/** おわかれへ。§7 の順（手振り→沈む→たね→芽→記念4行） */
function startBye(n: IppunIsshoState, now: number, early: boolean): void {
  n.phase = 'bye';
  n.phaseAt = now;
  n.byeT = 0;
  n.beeped = 0;
  n.epShown = 0;
  n.early = early;
  n.alive = !early;
  n.asleep = false;
  n.slept = false;
  n.wantPet = false;
  n.growT = 0;
  if (early) {
    // 早い別れ。ことばにならない「…」→ ピー（stepPhase）
    speak(n, '…', BYE_WAVE);
    addShake(n, 0.5);
  } else {
    // よるまで看取れた。静かな満足（design.md §7）
    n.endT = T_BYE;
    gain(n, P_LIVED);
    speak(n, 'きょう、たのしかった', BYE_WAVE);
    addPop(n);
    hitStop(n, 0.08);
  }
}

/* ---- 育ち（design.md §5）-------------------------------------------- */

/**
 * 姿が決まる（design.md §5）。ひるの中ほど（GROW_AT=20）に1回だけ。
 * 条件は式ではなく、記念の「ぼかした一言」で見せる（本家は条件が隠されていた）。
 * いちばん多く応えたもの＝その子の性格。まったく世話しなかった子は「たび」（ひとりで生きた）。
 * きら（上振れ①）は だいじに育てた証で、放置の子は入らない。
 */
function formOf(s: IppunIsshoState): Form {
  if (s.lucky && !s.weakEver && s.sickDays === 0 && s.fed + s.played + s.petted >= 3) return 'kira';
  if (s.fed === 0 && s.played === 0 && s.petted === 0) return 'tabi';
  if (s.petted >= s.fed && s.petted >= s.played) return 'mofu';
  if (s.fed > s.played) return 'koro';
  if (s.played > s.fed) return 'pyon';
  return 'poyo';
}

/**
 * `t` がせいちょうの時刻を越えていたら育てる（とじないので目の前で起きる。reveal は常に）。
 * stage 1＝姿が決まる（GROW_AT=20）／ stage 2＝ゆうがたに落ち着く（T_DUSK=28）。
 */
function checkGrowth(n: IppunIsshoState): void {
  const want = n.t >= T_DUSK ? 2 : n.t >= GROW_AT ? 1 : 0;
  while (n.growStage < want) {
    const stage = n.growStage + 1;
    applyGrowth(n, stage);
    n.growStage = stage;
    revealGrow(n, stage);
  }
}

/** 育ちの中身（姿・点数）を適用する。見出しは revealGrow がつける */
function applyGrowth(n: IppunIsshoState, stage: number): void {
  if (stage === 1) {
    // ひるの中ほど。ここで姿が決まる
    n.form = formOf(n);
    n.child = n.form;
    gain(n, P_GROW);
    if (n.form === 'kira') {
      // 先に +15 を入れてから ×倍率 を有効にする（そのぶんまで倍率にすると効きすぎる）
      n.score += P_KIRA;
      n.kira = true;
    }
  } else if (stage === 2) {
    // ゆうがた。姿はそのまま、動きがゆっくり・色が淡くなる（t で描く）
    gain(n, P_ELDER);
  }
}

/** せいちょうの見出しを出す（目の前で見える） */
function revealGrow(n: IppunIsshoState, stage: number): void {
  n.growT = GROW_BANNER_T;
  if (stage === 2) {
    n.growText = 'ゆうがた';
    n.growWhy = 'ゆっくり あるいている';
  } else {
    n.growText = `${FORM_NAME[n.form]}に なった`;
    n.growWhy = FORM_WHY[n.form];
  }
  addPop(n);
  hitStop(n, 0.08);
}

/* ================================================================== *
 * 入力（無反応ゼロ。design.md §2 の表）
 * ================================================================== */

function handleTap(n: IppunIsshoState, px: number, py: number): void {
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
      speak(n, 'えらんでね', 1);
      n.noT = 0.4;
    }
    return;
  }

  /* ひらいているとき */
  switch (hit.what) {
    case 'btn':
      n.pressBtn = hit.i;
      n.pressT = 0.18;
      doCare(n, BTN_KINDS[hit.i]);
      return;
    case 'char':
      pet(n);
      return;
    case 'window':
      // ゆうがたの空に一番星（上振れ②）。空の上のほうをタップして取る
      if (starUp(n) && py < FLOOR_Y - BODY_H) {
        gain(n, P_HOSHI);
        n.hoshiGot = true;
        speak(n, 'いちばんぼし！', 1.3);
        animate(n, 5);
        addPop(n);
        hitStop(n, 0.06);
        return;
      }
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

/** 世話をしたら、よわっていた分は帳消し（「…まってたよ」）。罪悪感が愛着に変わる瞬間 */
function healWeak(n: IppunIsshoState): boolean {
  if (n.weak > 0) {
    n.weak = 0;
    n.weakT = 0;
    return true;
  }
  return false;
}

/** 世話ボタン5つ（design.md §2 の反応表。押して無反応になる枝を作らない） */
function doCare(n: IppunIsshoState, kind: Kind): void {
  // どの世話でも、よわっていたら「…まってたよ」（罪悪感が愛着に変わる。design.md §4）
  switch (kind) {
    case 'gohan': {
      if (n.asleep) return sleepy(n);
      if (n.sick) return cantDo(n, 'たべられない…');
      if (n.hunger >= METER_MAX) return shakeNo(n, 'いらない');
      const ahead = n.hunger > CALL_AT; // 呼ぶ前（かすかに気にする）に先に気づいた
      gain(n, ahead ? P_AHEAD : P_ANSWER);
      if (ahead) n.gainWord = 'わかってる！';
      n.hunger = Math.min(METER_MAX, n.hunger + 1);
      n.fed++;
      animate(n, 1);
      speak(n, healWeak(n) ? '…まってたよ' : 'もぐもぐ');
      addPop(n);
      return;
    }

    case 'asobu': {
      if (n.asleep) return sleepy(n);
      if (n.sick) return cantDo(n, 'あそべない…');
      if (n.mood >= METER_MAX) return shakeNo(n, 'いらない');
      const ahead = n.mood > CALL_AT;
      gain(n, ahead ? P_AHEAD : P_ANSWER);
      if (ahead) n.gainWord = 'わかってる！';
      n.mood = Math.min(METER_MAX, n.mood + 1);
      n.played++;
      animate(n, 2);
      speak(n, healWeak(n) ? '…まってたよ' : 'たのしい！');
      addPop(n);
      return;
    }

    case 'nade':
      // なでる（ボタン）＝つぶをタップと同じ
      pet(n);
      return;

    case 'kusuri':
      if (!n.sick) return shakeNo(n, 'いらない');
      gain(n, P_ANSWER);
      n.sick = false;
      n.sickClock = 0;
      n.cured++;
      animate(n, 4);
      speak(n, healWeak(n) ? '…まってたよ' : 'なおった！');
      addPop(n);
      hitStop(n, 0.06);
      return;

    case 'oyasumi':
      // よるだけ。まだ眠くないと やわらかく断る
      if (!n.asleep) return shakeNo(n, 'まだ ねむくない');
      if (n.slept) return shakeNo(n, 'すやすや…');
      gain(n, P_ANSWER);
      n.slept = true;
      n.blackout = 0.6; // 寝かしつけ。液晶が暗くなる
      animate(n, 6);
      speak(n, healWeak(n) ? '…まってたよ' : 'おやすみ', 1.3);
      addPop(n);
      return;
  }
}

/** つぶをタップ = なでる（なでるボタンからも呼ぶ） */
function pet(n: IppunIsshoState): void {
  // 「なでて」はおねだりなので、ねんね中でも応えられる
  if (n.wantPet) {
    gain(n, P_PET_ASKED);
    n.wantPet = false;
    n.petted++;
    n.petAt = n.openT;
    animate(n, 5);
    speak(n, healWeak(n) ? '…まってたよ' : 'うれしい！', 1.2);
    addPop(n);
    hitStop(n, 0.05);
    return;
  }
  if (n.asleep) return sleepy(n);
  if (n.sick) {
    speak(n, 'つらそう…', 1);
    n.lookX = 0;
    animate(n, 3);
    return;
  }
  // 前になでてから間があいていれば点が入る（連打では入らない）
  if (n.openT - n.petAt >= 4) {
    gain(n, P_PET);
    n.petted++;
    n.petAt = n.openT;
    animate(n, 3);
    speak(n, healWeak(n) ? '…まってたよ' : 'にこっ');
    addPop(n);
    return;
  }
  // 連打では点は入らないが、必ず何か返す（無反応にしない）
  animate(n, 3);
  speak(n, 'ふふ', 0.7);
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
  // 拒否も手応え（点は入らないが「いらない」を大きく返す）
  n.gainWord = text;
  n.gainPop = 0;
  n.gainPopT = 0.6;
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

/** 上の帯: 左に時間帯、まん中に芽5つ、右に太陽／月の位置（年齢・◯にちめは廃止） */
function drawHeadRow(g: Painter, s: IppunIsshoState): void {
  if (s.phase === 'bye' || s.phase === 'gone') {
    const head = s.early
      ? `${s.name || 'つぶ'}・${whenLabel(s.endT)}に`
      : `${s.name || 'つぶ'}・よるまで いっしょ`;
    g.text(head, W / 2, HEAD_Y, { size: 12, align: 'center', color: 'ink' });
    return;
  }
  if (s.phase === 'egg') {
    g.text('たまご', 6, HEAD_Y, { size: 12, color: 'ink' });
  } else if (s.phase === 'name') {
    g.text('うまれた', 6, HEAD_Y, { size: 12, color: 'ink' });
  } else {
    // 時間帯（一日の流れ）。のこりは太陽/月の位置と よるの星で見せる（v6 FB5）
    g.text(whenLabel(s.t), 6, HEAD_Y, { size: 12, color: 'ink' });
    drawSky(g, s.t);
  }
  drawSprouts(g, s);
}

/** 上帯の右、一日の流れ（太陽→月）。あさ左→ひる高く→よるは沈んで月に変わる */
function drawSky(g: Painter, t: number): void {
  const x0 = W - 82;
  const span = 72;
  const p = Math.min(1, Math.max(0, t / T_BYE));
  const cx = x0 + p * span;
  const cy = HEAD_Y - 1 - Math.sin(p * Math.PI) * 8;
  if (t >= T_NIGHT) {
    // 月（三日月。本体色で欠けを抜く）
    g.circle(cx, cy, 6, 'ink');
    g.circle(cx + 3, cy - 2, 5, 'bg2');
  } else {
    // 太陽（光条は線で。点だと「…」に見える）
    g.circle(cx, cy, 5, 'ink');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.line(
        cx + Math.cos(a) * 7,
        cy + Math.sin(a) * 7,
        cx + Math.cos(a) * 11,
        cy + Math.sin(a) * 11,
        'ink',
        2,
      );
    }
  }
}

/**
 * しあわせ 20 ごとに芽が1つ ●（達成）に。未達は ○。5個で満開。
 * すぐ下に いまの称号を dim で添える。
 * 🔴 双葉のドット絵は QVGA で潰れて「⊥⊥⊥＿＿」と文字化けに見えたので、●／○ のドットに変えた（coordinator指摘）。
 */
function drawSprouts(g: Painter, s: IppunIsshoState): void {
  // 称号ゲージ（design.md §6・v6 FB4②）。いまのしあわせと、つぎの称号までの進みを見せる
  const goals = meta.goals ?? [];
  if (goals.length === 0) return;
  const max = goals[goals.length - 1].score;
  const bx = W / 2 - 48;
  const bw = 96;
  const by = SPROUT_Y - 2;
  g.rect(bx, by, bw, 4, 'dim'); // 台
  g.rect(bx, by, Math.round(bw * Math.min(1, s.score / max)), 4, 'ink'); // いまの伸び
  let cur = '';
  let next: { score: number; label: string } | null = null;
  for (const goal of goals) {
    const gx = bx + Math.round((goal.score / max) * bw);
    const done = s.score >= goal.score;
    g.rect(gx - 1, by - 2, 2, 8, done ? 'ink' : 'dim'); // 称号のしるし
    if (done) cur = goal.label;
    else if (!next) next = goal;
  }
  const label = next ? `つぎ ${next.label} まで あと ${next.score - s.score}` : `${cur}！`;
  g.text(label, W / 2, SPROUT_Y + 10, { size: 9, align: 'center', color: 'dim' });
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
      // 床
      g.rect(WIN_X + 4, FLOOR_Y, WIN_W - 8, 2, ink);
      drawDusk(g, s, ink); // よるの星（時間の移ろい）
      drawTsubu(g, s, CHAR_X + sx, FLOOR_Y + sy, ink, hole);
      drawWish(g, s, ink, hole); // 欲しいものアイコン（キャラの真下）
      drawStar(g, s, ink); // ゆうがたの一番星（上振れ②）
      drawGainPop(g, s, ink); // 手応え「＋N」（キャラの上）
      drawGrow(g, s, ink);
    }
    drawSay(g, s, ink);
  });

  // よわってきたら、ふちが太く点滅して「あぶない」と知らせる（自動クローズの予告は廃止）
  const warn = s.phase === 'open' && s.weak >= 2 && Math.floor(s.time * 6) % 2 === 0;
  windowFrame(g, warn);
}

/* ---- 窓の中身 -------------------------------------------------------- */

/**
 * 頭上のしぐさアイコン（design.md §2）。troubleOf の「呼んでいる」1件を、
 * 対応ボタンと同じ絵で頭上に出す（凡例代わり。頭上とボタンで同じ絵＝視線がつながる）。
 */
function drawWish(g: Painter, s: IppunIsshoState, ink: ColorKey, hole: ColorKey): void {
  const kind = troubleOf(s);
  if (kind === '') return;
  // 病気（見落としの結果）は点滅させず常時出す＝「くすり」を確実に伝える。ほかはゆっくり点滅（1つだけ）
  if (!s.sick && Math.floor(s.time * 4) % 2 !== 0) return;
  // キャラの真下（キャラ→アイコン→下のボタンで視線が下へ一直線。design.md v6 FB3）
  drawIcon(g, kind, CHAR_X, FLOOR_Y + 14, 20, ink, hole);
}

/** ゆうがたの空に一番星（上振れ②）。ichiban の子だけ・取るまで きらめく */
function drawStar(g: Painter, s: IppunIsshoState, ink: ColorKey): void {
  if (!starUp(s)) return;
  const cx = CHAR_X + 60;
  const cy = WIN_Y + 24;
  const r = Math.floor(s.time * 3) % 2 === 0 ? 6 : 3;
  g.rect(cx - 1, cy - r, 3, r * 2 + 1, ink);
  g.rect(cx - r, cy - 1, r * 2 + 1, 3, ink);
}

/** ゆうがた→よるの空（時間を主役に。design.md v6 FB5）。よるは窓の上に星がまたたく */
function drawDusk(g: Painter, s: IppunIsshoState, ink: ColorKey): void {
  if (s.t < T_NIGHT) return;
  const stars: [number, number][] = [
    [40, 66],
    [92, 52],
    [150, 72],
    [188, 58],
    [118, 86],
    [66, 92],
  ];
  for (const [px, py] of stars) {
    if (Math.floor(s.time * 2 + px) % 3 === 0) continue; // まばたき
    g.rect(WIN_X + px, WIN_Y + py, 2, 2, ink);
  }
}

/** 手応えポップ（design.md §4・v6 FB4①）。押した瞬間、キャラの上に「＋N」を大きく。上へ流れて消える */
function drawGainPop(g: Painter, s: IppunIsshoState, ink: ColorKey): void {
  if (s.gainPopT <= 0 || s.growT > 0) return; // 成長バナー中はゆずる
  const rise = (0.85 - s.gainPopT) * 16;
  const y = FLOOR_Y - BODY_H - 14 - rise;
  if (s.gainPop > 0) {
    g.text(`＋${s.gainPop}`, CHAR_X, y, { size: 24, align: 'center', color: ink });
    if (s.gainWord) g.text(s.gainWord, CHAR_X, y + 19, { size: 12, align: 'center', color: ink });
  } else if (s.gainWord) {
    g.text(s.gainWord, CHAR_X, y + 8, { size: 15, align: 'center', color: ink });
  }
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
  let text = s.say;
  let show = s.sayT > 0 && !!s.say;
  // よわっているあいだは「よぼよぼ…」を出し続ける（死ぬ前の予兆。世話すれば消える。design.md §5）。
  // 世話などの一言（「…まってたよ」等）が出ているときは、そちらを優先する。
  // せいちょうの見出しが出ている間は表示を譲る（成長の喜びと弱りの悲しみを同時に出さない。weak の状態は保つ）
  if (!show && s.phase === 'open' && s.weak >= 2 && s.growT <= 0) {
    text = 'よぼよぼ…';
    show = true;
  }
  if (!show) return;
  if (s.phase === 'name') {
    // つぶの頭（y62〜）に重ならないよう、窓のいちばん上に置く
    g.text(text, W / 2, 50, { size: 12, align: 'center', color: 'ink' });
    return;
  }
  g.text(text, W / 2, SAY_Y, { size: 11, align: 'center', color: ink });
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
/** ハート（なつきの胸・世話のたびに出す） */
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
type Mood = 'futsu' | 'niko' | 'shon' | 'nemu' | 'kaze' | 'kininaru';

function moodOf(s: IppunIsshoState): Mood {
  // 見送りの顔。最期まで生きた子は、こちらを見て笑って手を振る
  if (s.phase === 'bye' || s.phase === 'gone') return 'niko';
  if (s.sick) return 'kaze';
  if (s.asleep) return 'nemu';
  // よわっているときは しょんぼり（よぼよぼの予兆）
  if (s.phase === 'open' && s.weak >= 2) return 'shon';
  if (s.animT > 0 && (s.animKind === 2 || s.animKind === 5)) return 'niko';
  if (s.noT > 0) return 'shon';
  if (troubleOf(s) !== '') return 'shon'; // はっきり困る（頭上に合図が出ている）
  if (wishOf(s) !== '') return 'kininaru'; // 呼ぶ前・かすかに気にする（design.md §2 中段）
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
  const elder = stageOf(s.t) === 'elder' && s.phase !== 'name';
  const weakling = s.phase === 'open' && s.weak >= 2;
  // 困っている（頭上に合図が出ている）子は動きが鈍い。呼ぶ前は落ち着かない（そわそわ）
  const trouble = s.phase === 'open' && troubleOf(s) !== '';
  const fret = s.phase === 'open' && wishOf(s) !== '';
  const still =
    s.asleep ||
    s.sick ||
    weakling ||
    trouble ||
    s.phase === 'name' ||
    s.phase === 'bye' ||
    s.phase === 'gone';
  // 2コマの差分で左右にちょこまか。そわそわは速く小さく、おとしより・よぼよぼはゆっくり
  const rate = fret ? 3.6 : elder ? 1.3 : 2.8;
  const beat = Math.floor(s.time * rate) % 2;
  const walk = still ? 0 : (beat === 0 ? -1 : 1) * (fret ? 4 : elder ? 3 : 6);
  const hop = !still && s.animT > 0 && s.animKind === 2 ? 10 : 0;
  const scale = DOT;
  // 弾みは大きさではなく「浮き」で出す（ドットの大きさが変わるとにじむ）
  const lift = Math.round(s.pop * 5);
  // よぼよぼ・ぐあいわるい・困っている子は沈む（体で「たいへん」が分かるように）
  const sag = weakling ? 4 : s.sick ? 3 : trouble ? 2 : elder ? 1 : 0;
  const w = 16 * scale;
  const h = BODY_H;
  const x = Math.round(cx + walk - w / 2);
  const body = bodyOf(s.form, s.child);
  // 絵の下の空白ぶんだけ下げて、どの姿でも床に足が着くようにする
  const y = Math.round(footY - h + footPad(body) * scale - hop - lift + sag);

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
  drawFace(g, s, cx + walk, y, ink, hole);

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
  // 世話のたびにハートを出す（5つの世話すべてと なでる・手でとじた ほっ。design.md §4）
  if (s.animT > 0 && s.animKind >= 1) {
    g.sprite(HEART, cx + walk + 30, y + 8, { scale: 3, colors: { X: ink }, center: true });
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
): void {
  const mood = moodOf(s);
  const ey = top + (s.form === 'pyon' || s.form === 'hane' ? 30 : 26);
  // たまに こちらを見る。ふだんは進む方を見ている
  const look = Math.floor(s.time / 3.2) % 3 === 0 ? 0 : s.lookX !== 0 ? s.lookX * 2 : 0;
  const ex = [cx - 13 + look, cx + 7 + look];

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
      case 'kininaru':
        // かすかに気にする。目を少し上に（きょろっと）
        g.rect(x, ey - 1, 6, 6, hole);
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
    ['なでなで', s.petted],
    ['おくすり', s.cured],
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

  lines.push(s.early ? `${whenLabel(s.endT)}に ちからつきた` : 'あさから よるまで いっしょだった');

  for (let i = 0; i < Math.min(s.epShown, 4); i++) {
    g.text(lines[i], W / 2, EPI_Y + i * EPI_LINE, { size: 10, align: 'center', color: ink });
  }
}

/* ---- とじる と 世話ボタン -------------------------------------------- */

function drawControls(g: Painter, s: IppunIsshoState): void {
  const live = s.phase === 'open';

  /* 世話ボタン5つ。押した瞬間は反転（とじるは廃止＝一日を見守り続ける） */
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
    s.phase === 'name'
      ? 'おして なまえを つける'
      : s.phase === 'egg'
        ? 'たまごを おして あたためる'
        : alt
          ? 'ようすを 見て、ボタンで こたえる'
          : 'つぶを タップで なでる';
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
    case 'nade': {
      // なでる手（手のひらと指4本）
      g.circle(cx, cy + 4 * u, 7 * u, c);
      for (let i = 0; i < 4; i++) {
        g.rect(cx - 7 * u + i * 4 * u, cy - 8 * u, 3 * u, 10 * u, c);
      }
      g.rect(cx - 11 * u, cy - 1 * u, 4 * u, 6 * u, c);
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
    case 'oyasumi': {
      // 三日月（欠けを hole で抜く）
      g.circle(cx, cy, 10 * u, c);
      g.circle(cx + 4 * u, cy - 3 * u, 9 * u, hole);
      break;
    }
  }
}
