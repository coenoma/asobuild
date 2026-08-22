/**
 * 一分一生（いっぷんいっしょう）── v2
 *
 * **よばれたら、ほしいものを おす。それだけ。**
 *
 * 60秒ちょっとで「たまご→なまえ→あかちゃん→こども→おとな→おとしより→おわかれ→たね」が終わる。
 * 目的は「実物を続けられないガサツな人が、"なぜあれは愛されるのか" を1分で追体験できる」こと。
 * ルールを覚えさせる遊びではないので、この3つを憲法にしてある（design.md §0）:
 *
 * ・**押してはいけないものを作らない。** 間違えても首を振るだけで、減点は一切ない
 * ・**急がせない。** 反応の速さで点差をつけない。タイマーバーを出さない。最初の2回はあきらめない
 * ・**数字を競わせない。** 判定テキストを出さない。返すのは顔・動き・ハート
 *
 * v1（速さの3段階判定・押すな要素・倍率・タイマーバー）はオーナーの実機評価で
 * 「何を急ぐのか・何をスルーするのかを覚える作業になっている」となり、丸ごと捨てた。
 * 経緯は docs/plans/008-ippun-issho/design-v1.md §0・§18、v2 の設計は design.md。
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
  /** 呼びかけの間隔の倍率。大きいほどのんびりした一生になる */
  wantGap: 1,
  /** ふきだしが消えるまでの秒数。ガサツな人に届くかはここ1本で決まる */
  wantDur: 7,
  /** 寿命の基準（秒）。世話率・ゆらぎ・ながいき体質がこの上に乗る */
  lifeBase: 58,
};

/* ================================================================== *
 * 一生の時間割（design.md §3）
 *
 * 寿命 L は「おとな」になった瞬間（41秒）に決まる:
 *   L = lifeBase + 10×世話率 + rng(−1.5,+1.5) + (ながいき体質なら +5)
 * 41秒より後の予定は L の比率で置く（span = (L−8) − 41）。
 *
 * 🔴 不変条件（ここが崩れると「大人になる前に老人」「窓が反転」が起きる）:
 *      41 < ev2At（窓 41+0.10×span 〜 41+0.45×span の中で引く） < elderAt < L−8 < L
 *    lifeBase 58・世話率0・ゆらぎ−1.5 でも L ≥ 56.5 なので span ≥ 7.5 で必ず成り立つ。
 * ================================================================== */

/** たまごが自然に孵る時刻 */
const EGG_AT = 3.5;
/** ぽかぽか1回で孵化が早まる秒数 */
const EGG_WARM = 0.4;
/** どんなに温めてもこれより早くは孵らない */
const EGG_MIN = 2;
/** ぽかぽかが点になる回数 */
const EGG_TAPS = 3;
/** なまえを選ばないまま この秒数たったら自分で名乗る */
const NAME_WAIT = 8;
/** こどもになる */
const CHILD_AT = 19;
/** おとなになる（＝寿命が決まる） */
const ADULT_AT = 41;
/** 1回目・2回目のねんね */
const NAP1_AT = 14.5;
const NAP2_AT = 30;
/** ねんねの長さ */
const NAP_DUR = 2.5;
/** おわかれの長さ。ここは削らない（design.md §15） */
const BYE_LEN = 8;
/**
 * おわかれの時間割（byeT ＝ 経過秒。design.md §9 から順番を入れ替えてある）。
 *
 * 初見者テストで「生きて立っている本人の前で弔辞を読んでいる」「集計のあとに沈むので
 * 感情の山がレシートに潰される」と言われたので、**先に見送って、そのあとで思い出を読む**。
 *
 *   0.0 ばいばい → 1.0 ありがと（手を振る。空は夕方→夜）
 *   2.0 土に沈みはじめ（0.9秒）→ 3.0 たねが落ちる → 3.4 芽がぽんと出る
 *   4.0 記念の文を芽の上に0.7秒おきに4行（1〜3行目はタップで送れる）
 *   8.6 over（4行目が出てから2.5秒読める）
 */
const SINK_AT = 2;
const SINK_LEN = 0.9;
/** 沈む距離。帽子やナイトキャップまで床の下へ入る深さ */
const SINK_DEPTH = 92;
/** sinkT 基準。たねが落ちはじめる／芽が出る */
const SEED_AT = 1;
const SPROUT_AT = 1.4;
/** byeT 基準。記念の文が始まる */
const EPI_AT = 4;
/** おわかれに入ってから over を立てるまで（＝ L＋0.6秒） */
const BYE_TOTAL = 8.6;
/** せいちょうの文が出ているあいだ。ここでは新しい呼びかけを始めない */
const GROW_HOLD = 1.8;
/** しぐさの長さ。ここで先に渡せたら「わかってる！」 */
const GESTURE_T = 1.2;
/** 最初の2回のふきだしは長い（あきらめない） */
const WANT_DUR_FIRST = 10;
/** 3回目以降、この秒数からしょんぼり顔になる */
const WANT_SAD_AT = 5;
/** 「？」が自分から絵を見せるまで */
const HIDE_REVEAL_T = 3.5;
/** 絵を見せたあとの延長 */
const HIDE_EXTRA = 3;
/** 「まってたよ！」になる待たせ時間 */
const LATE_AT = 4;
/** なでるのクールタイム */
const PET_COOL = 1;
/** なでるが点になる上限（以後はハートだけ浮く） */
const PET_MAX = 15;
/** うんちが出るまで（ごはんの後） */
const POOP_MIN = 2;
const POOP_MAX = 4;
/** うんちが出る確率 */
const POOP_P = 0.4;
/** この秒数を過ぎてもまだ一度も出ていなければ、次のごはんで必ず出す */
const POOP_SURE = 26;
/** ごはんが来ないまま この秒数になったら、ひとりでに出す */
const POOP_LAST = 30;
/** うんちを放っておくとハエが来る */
const FLY_AT = 4;
/** うんちを放っておくとかぜをひく */
const POOP_SICK_AT = 8;
/** かぜが自然に治るまで */
const SICK_HEAL = 6;
/** できごとの長さ */
const EV_LEN = 6;
/** ながれぼしが光っているあいだ */
const STAR_LEN = 4.5;
/** 「ちがうの…」の首振り */
const NO_T = 0.6;
/** 正解のアニメ */
const ANIM_T = 1;
/** セリフが出ているあいだ */
const SAY_T = 0.6;
/** ふきだしを押したときに出る点線 */
const GUIDE_T = 0.5;
/**
 * 最初の2回だけ、ふきだしが出た瞬間に自動で出る点線。
 * 手で押したとき（0.5秒）より長い。ここは説明画面の代わりなので、
 * 「出た瞬間に一瞬光って消える」だと目に入らないまま終わる（静止画で確認した）。
 */
const GUIDE_AUTO_T = 1.4;
/** 記念の文の行送りと、芽の上に置く1行目の高さ */
const EPI_STEP = 0.7;
const EPI_Y = 92;
/** 操作の一行を2つ交互に出す時間と、切り替えの間隔 */
const HELP_SWAP_UNTIL = 30;
const HELP_SWAP = 4;
/** その子のすきなものを「いちばん すき」と言い切ってよい世話の回数 */
const FAV_KNOWN = 3;

/* ---- 画面の決まり（240×320。design.md §12）-------------------------- */

/** 部屋の上端（ここより上は共通HUDと、こちらの名前・年齢・芽の段） */
const ROOM_TOP = 32;
/** 床の線 */
const GROUND_Y = 200;
/** 部屋の下端 */
const ROOM_BOT = 228;
/** キャラの中心 */
const CHAR_X = 120;
const CHAR_Y = 160;
/** キャラの当たり判定の半径。**draw と step で同じ値を使う**（ずれると押しても効かない） */
const CHAR_R = 36;
/**
 * 体を描くときだけ下げる量。中心 (120,160) に 64px の体を置くと足が床から12px浮く。
 * 当たり判定は (120,160)・半径36 のままなので、押せる範囲は変わらない。
 */
const BODY_DY = 6;
/**
 * 待機で歩く幅。当たり判定は (120,160) 固定なので、
 * ここを大きくすると「見えている体を押したのに効かない」が起きる（設計の ±20 から下げた）。
 */
const WALK_X = 14;
/** ふだんのあくび（ねんねとは無関係）の周期と長さ */
const YAWN_EVERY = 12;
const YAWN_LEN = 0.8;
/** ふきだし */
const BUB_X = 120;
const BUB_Y = 100;
const BUB_W = 52;
const BUB_H = 44;
/** ボタン5つ */
const BTN_Y = 232;
const BTN_H = 62;
const BTN_W = 44;
const BTN_X0 = 4;
const BTN_GAP = 47;
/** 飾った花（左下） */
const FLOWER_X = 16;
const FLOWER_Y = 184;
/** うんち */
const POOP_X = 172;
const POOP_Y = 190;
/** ともだちが立つところ */
const FRIEND_X = 60;
const FRIEND_Y = 165;
/** ながれぼしが止まるところ */
const STAR_X = 180;
const STAR_Y = 60;
/** 空とみなす帯（ながれぼしを取るところ） */
const SKY_TOP = 32;
const SKY_BOT = 120;
/** なまえカード */
const CARD_Y = 112;
const CARD_W = 68;
const CARD_H = 36;
const CARD_X = [18, 86, 154];
/**
 * 右上の芽。5本で打ち止め（`x + 4 + 4 = 234 < 240` に収まる位置）。
 * ここを増やすと右端で切れる。増やしたくなったら幅から先に決めること。
 */
const SPROUT_MAX = 5;
const SPROUT_X0 = 158;
const SPROUT_GAP = 17;
const SPROUT_STEP = 20;

/** 頭上の文字（せいちょう・できごと・おわかれ） */
const HEAD_Y = 44;
const WHY_Y = 62;
/** セリフ */
const SAY_X = 158;
const SAY_Y = 150;
/** 長いセリフはここを右端にして右揃え（左へ伸ばす） */
const SAY_RIGHT = 232;
/** ドット絵の1マス。16×16 のドットで 64px になる */
const DOT = 4;

/* ---- 種類 ------------------------------------------------------------ */

/** 押せるもの。ボタン5つ＋ふきだし専用（なでて・？・おくりもの） */
type Kind = 'gohan' | 'asobu' | 'souji' | 'kusuri' | 'denki' | 'nade' | 'gift' | 'star';

/** ボタンの並び。この順は一生変わらない */
const BTN_KINDS: readonly Kind[] = ['gohan', 'asobu', 'souji', 'kusuri', 'denki'];
const BTN_LABEL: readonly string[] = ['ごはん', 'あそぶ', 'そうじ', 'くすり', 'でんき'];

type Stage = 'egg' | 'name' | 'baby' | 'child' | 'adult' | 'elder' | 'bye';

type Form =
  | 'aka'
  // こども4種
  | 'koro'
  | 'pyon'
  | 'poyo'
  | 'nora'
  // おとな9種＋かくれ1種
  | 'kira'
  | 'nebo'
  | 'mofu'
  | 'mochi'
  | 'manmaru'
  | 'tokotoko'
  | 'hane'
  | 'natsuki'
  | 'tabi';

const FORM_NAME: Record<Form, string> = {
  aka: 'まめ',
  koro: 'ころまめ',
  pyon: 'ぴょんまめ',
  poyo: 'ぽよまめ',
  nora: 'のらまめ',
  kira: 'きらまめ',
  nebo: 'ねぼまめ',
  mofu: 'もふまめ',
  mochi: 'もちまめ',
  manmaru: 'まんまるまめ',
  tokotoko: 'とことこまめ',
  hane: 'はねまめ',
  natsuki: 'なつきまめ',
  tabi: 'たびまめ',
};

const STAGE_NAME: Record<Stage, string> = {
  egg: 'たまご',
  name: 'あかちゃん',
  baby: 'あかちゃん',
  child: 'こども',
  adult: 'おとな',
  elder: 'おとしより',
  bye: 'おとしより',
};

/**
 * 名前の候補。**「っち」で終わる名前は入れない**（元作品の命名に寄せないため。design.md §16）。
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
 * **フラットに持つ。** できごと・ねんね・呼びかけの「予定」はすべてスカラー、
 * きらきらやハエなどの粒は `s.time` の関数にしてある（配列を持つと浅いコピーで壊れる）。
 * ------------------------------------------------------------------- */

export interface IppunIsshoState extends BaseState, FeelState {
  stage: Stage;
  /** いまの姿 */
  form: Form;
  /** 19秒で決まったこどもの姿。きらまめの体はここを土台にする */
  child: Form;
  name: string;
  /** 名前カードの候補（NAMES の添字）。3枚ぶんをスカラーで持つ */
  n0: number;
  n1: number;
  n2: number;

  /* たまご・なまえ */
  hatchAt: number;
  eggTaps: number;
  /** たまごを押した直後の揺れ */
  poke: number;
  nameWait: number;

  /* 寿命と予定 */
  life: number;
  lifeFixed: boolean;
  elderAt: number;
  /** 死んだときの年齢。記念と reason() で使う（時間が進んでもぶれないよう固定する） */
  endAge: number;

  /* できごとの予約（0=おくりもの 1=ともだち 2=ながれぼし） */
  ev1Kind: number;
  ev1At: number;
  ev1Done: boolean;
  ev2Kind: number;
  ev2At: number;
  ev2Done: boolean;

  /* ねんねの予約 */
  napAt: number;
  napCount: number;

  /* 呼びかけ */
  wantKind: Kind | '';
  /** 0=なし 1=しぐさ 2=ふきだし */
  wantPhase: number;
  wantT: number;
  wantMax: number;
  wantHidden: boolean;
  /** 「？」の絵を見せた時刻（wantT 基準）。-1 なら まだ見せていない */
  revealAt: number;
  wantWrong: number;
  wantWait: number;
  /** 何回目の呼びかけか。最初の2回は長く待ち、あきらめない */
  wantCount: number;
  /** 直前に呼んだ種類（3回続けないため） */
  lastWant: Kind | '';

  /* ねんね */
  /** 0=なし 1=あくび 2=横になってでんき待ち 3=ねむり */
  napPhase: number;
  napT: number;
  dark: boolean;
  /** 明かりをつけたまま寝かせた朝の「ねむそう…」 */
  sleepy: number;
  /** 起きているのにでんきを消したときの暗転 */
  blackout: number;
  /** 空を押されて、こちらをちらっと見ている残り */
  peek: number;
  /** そのとき目を寄せる向き（-1 左 / +1 右） */
  peekDir: number;

  /* うんち・かぜ */
  poop: number;
  poopPend: number;
  /** 一生で一度でもうんちをしたか。そうじの出番が0の一生を作らないための保険 */
  poopedOnce: boolean;
  sickT: number;
  /** おとな期に理由なくかぜをひく時刻（-1 なら ひかない） */
  coldAt: number;

  /* できごと（いま起きているもの） */
  evKind: number;
  evT: number;
  flower: boolean;
  flowerLook: number;

  /* せいちょう */
  grow: number;
  growText: string;
  growWhy: string;

  /* おわかれ */
  byeT: number;
  sinkT: number;
  epShown: number;
  epTimer: number;

  /* 演出 */
  say: string;
  sayT: number;
  heart: number;
  heartT: number;
  /** 小さいハート（なで・ぽかぽか）か */
  heartSmall: boolean;
  anim: number;
  animKind: Kind | '';
  noT: number;
  guideT: number;
  guideBtn: number;
  pressT: number;
  pressBtn: number;
  cardShake: number;
  petCool: number;
  lastPet: number;
  /** 待機動作の位相ずれ（子ごとに違う暮らしぶりに見せる） */
  poseSeed: number;

  /* 統計（flat）*/
  fed: number;
  played: number;
  cleaned: number;
  lit: number;
  naps: number;
  cured: number;
  petted: number;
  guessed: number;
  knew: number;
  ignored: number;
  /**
   * こども期（19〜41秒）の世話。**せいちょう②（41秒）はここを見る**。
   * 設計の表では「おとな期の」と書かれているが、41秒に判定する値なので
   * おとな期から数えると必ず 0 対 0 になり、分岐が片方へ固定される（実測: まんまる・とことこが 0回）。
   */
  fed2: number;
  played2: number;
  ignored2: number;
  /** こども期に応えた回数（なでても数える）。のら→なつき／たび の分かれ目に使う */
  answered2: number;
  answered: number;
  gift: boolean;
  friend: boolean;
  wished: boolean;
  sick: boolean;
  /** 非表示。きらまめになれる素質（28%） */
  lucky: boolean;
  /** 非表示。ながいき体質（25%） */
  longLife: boolean;
  /** その子のすきなもの。最期に明かす */
  fav: Kind;
  /** ボット用。しぐさから読める子か（40%） */
  readGesture: boolean;
}

/* ---- 小さな道具 ------------------------------------------------------ */

/**
 * しあわせを足す。きらまめは以後の加点が ×1.5（切り上げ）。ここを通さない加点を作らないこと。
 *
 * 🔴 **画面に「+3」のような数字は出さない。** 返すのはハートの数と大きさだけ（憲法「数字を競わせない」）。
 * 初見の人は浮く数字の差の理由を最後まで読み取れず、点取りゲームだと誤解する（初見者テスト 2026-08-22）。
 */
function gain(n: IppunIsshoState, base: number): void {
  n.score += n.form === 'kira' ? Math.ceil(base * 1.5) : base;
}

/** セリフ（「ちがうの…」「わかってる！」等）。判定テキストではなく、その子の言葉 */
function speak(n: IppunIsshoState, text: string): void {
  n.say = text;
  n.sayT = SAY_T;
}

/**
 * ハートを浮かべる。**これが唯一の「よかった」の返し方**。
 * なで＝小1／応えた＝1／先読み・「？」当て＝2／できごと＝2〜3。
 */
function hearts(n: IppunIsshoState, count: number, small = false): void {
  n.heart = count;
  n.heartT = 1;
  n.heartSmall = small;
}

/** 世話率。応えた数 ÷（応えた数 ＋ あきらめさせた数）。分母0なら 0 */
function careRate(s: IppunIsshoState): number {
  const total = s.answered + s.ignored;
  return total === 0 ? 0 : s.answered / total;
}

/**
 * 年齢。(孵化,0)→(19,6)→(41,18)→(おとしより,65)→(L, 80+1.5×(L−56)) を線形補間。
 * 最期は 80〜108さいに収まる。
 */
function ageAt(s: IppunIsshoState, t: number): number {
  const end = 80 + 1.5 * (s.life - 56);
  const pts: [number, number][] = [
    [s.hatchAt, 0],
    [CHILD_AT, 6],
    [ADULT_AT, 18],
    [s.elderAt, 65],
    [s.life, end],
  ];
  if (t <= pts[0][0]) return 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [t0, a0] = pts[i];
    const [t1, a1] = pts[i + 1];
    if (t <= t1) return a0 + ((a1 - a0) * (t - t0)) / Math.max(0.001, t1 - t0);
  }
  return end;
}

/**
 * 呼びかけの間隔。段階ごとにゆっくりになる。
 * 初見者テストで「半分が無風」と言われたので、急かさない範囲で 0.5秒ずつ詰めてある。
 */
function wantGap(stage: Stage, rng: Rng): number {
  const base =
    stage === 'adult' ? rng.range(4.5, 5.5) : stage === 'elder' ? rng.range(5.5, 6.5) : rng.range(4, 5);
  return base * TUNE.wantGap;
}

/**
 * 呼びかけの種類を引く。**その子のすきなもの（fav）は重みを +20**。
 * 同じ種類が3回続かないよう、直前と同じなら1回だけ引き直す。
 */
function pickWant(s: IppunIsshoState, rng: Rng): Kind {
  const table: Record<Stage, [number, number, number]> = {
    egg: [55, 20, 25],
    name: [55, 20, 25],
    baby: [55, 20, 25],
    child: [30, 45, 25],
    adult: [35, 30, 35],
    elder: [30, 10, 60],
    bye: [30, 10, 60],
  };
  const kinds: Kind[] = ['gohan', 'asobu', 'nade'];
  const draw = (): Kind => {
    const w = [...table[s.stage]];
    for (let i = 0; i < 3; i++) if (kinds[i] === s.fav) w[i] += 20;
    const total = w[0] + w[1] + w[2];
    let r = rng.range(0, total);
    for (let i = 0; i < 3; i++) {
      r -= w[i];
      if (r <= 0) return kinds[i];
    }
    return kinds[2];
  };
  let k = draw();
  if (k === s.lastWant) k = draw();
  return k;
}

/** 「？」にする率 */
function hideRate(stage: Stage): number {
  if (stage === 'baby' || stage === 'name') return 0.1;
  if (stage === 'child') return 0.35;
  if (stage === 'elder' || stage === 'bye') return 0.4;
  return 0.45;
}

/**
 * いま画面が「起きていて、何も起きていない」か。
 * 呼びかけ・できごと・ねんねは、ここが true のときだけ始める。
 */
function calm(s: IppunIsshoState): boolean {
  return (
    !s.over &&
    s.stage !== 'egg' &&
    s.stage !== 'name' &&
    s.stage !== 'bye' &&
    s.grow <= 0 &&
    s.napPhase === 0 &&
    s.sickT <= 0 &&
    s.evKind === 0
  );
}

/**
 * いま応えるべき用事。優先順位は `かぜ > ねんね > できごと > うんち > 呼びかけ`。
 * 高いものが出たら低いものは消さずに待機する（＝呼びかけの経過時間が止まる）。
 *
 * 🔴 **ふきだしの絵も、押したときの解釈も、必ずこの1か所から決めること。**
 * 以前 draw 側と入力側で順番が逆（かぜとねんね）になっていて、
 * 「ねんね中にかぜをひくと、くすりのふきだしが出ているのに押しても『すやすや…』」が起きていた。
 */
type Duty = 'sick' | 'nap' | 'event' | 'poop' | 'want' | 'none';

function dutyOf(s: IppunIsshoState): Duty {
  if (s.stage === 'bye' || s.over) return 'none';
  if (s.sickT > 0) return 'sick';
  if (s.napPhase > 0) return 'nap';
  if (s.evKind > 0) return 'event';
  if (s.poop > 0) return 'poop';
  if (s.wantPhase > 0) return 'want';
  return 'none';
}

/** その用事のふきだしに描く絵（''＝ふきだしを出さない。しぐさ中・あくび中・ながれぼし） */
function bubbleKind(s: IppunIsshoState): Kind | '' {
  switch (dutyOf(s)) {
    case 'sick':
      return 'kusuri';
    case 'nap':
      return s.napPhase === 2 ? 'denki' : '';
    case 'event':
      return s.evKind === 1 ? 'gift' : s.evKind === 2 ? 'asobu' : 'star';
    case 'poop':
      // うんちも、まず 1.2秒 そわそわのしぐさ。その間に そうじ を押せたら「わかってる！」
      return s.poop < GESTURE_T ? '' : 'souji';
    case 'want':
      return s.wantPhase === 2 ? s.wantKind : '';
    default:
      return '';
  }
}

/**
 * いまふきだしが指しているボタン（-1＝無し）。
 * 「？」のあいだは指さない（答えを見せてしまうため）。
 * draw はこれで枠を accent にし、step は点線の行き先に使う。
 */
function hintBtn(s: IppunIsshoState): number {
  const k = bubbleKind(s);
  if (k === '') return -1;
  if (dutyOf(s) === 'want' && s.wantHidden && s.revealAt < 0) return -1;
  return BTN_KINDS.indexOf(k as Kind);
}

/** 呼びかけの時計が止まっているか（横取りされている・そもそも動けない） */
function wantBlocked(s: IppunIsshoState): boolean {
  return !calm(s) || s.poop > 0;
}

/* ---- 当たり判定 ------------------------------------------------------ *
 * 順番は ボタン5つ → ふきだし → キャラ → 花 → 空 → それ以外。
 * ここで使う数値は draw と共有している定数だけ（ずれると押しても効かない）。
 * ------------------------------------------------------------------- */

type HitWhat = 'btn' | 'bubble' | 'char' | 'flower' | 'sky' | 'card' | 'none';

function hitTest(s: IppunIsshoState, px: number, py: number): { what: HitWhat; i: number } {
  // なまえ中はカードがいちばん上にある
  if (s.stage === 'name') {
    for (let i = 0; i < 3; i++) {
      if (px >= CARD_X[i] && px < CARD_X[i] + CARD_W && py >= CARD_Y && py < CARD_Y + CARD_H) {
        return { what: 'card', i };
      }
    }
    return { what: 'none', i: -1 };
  }
  for (let i = 0; i < 5; i++) {
    const x = BTN_X0 + i * BTN_GAP;
    if (px >= x && px < x + BTN_W && py >= BTN_Y && py < BTN_Y + BTN_H) return { what: 'btn', i };
  }
  if (bubbleKind(s) !== '' && Math.abs(px - BUB_X) < BUB_W / 2 && Math.abs(py - BUB_Y) < BUB_H / 2) {
    return { what: 'bubble', i: -1 };
  }
  const dx = px - CHAR_X;
  const dy = py - CHAR_Y;
  if (dx * dx + dy * dy < CHAR_R * CHAR_R) return { what: 'char', i: -1 };
  if (
    s.flower &&
    px >= FLOWER_X - 8 &&
    px < FLOWER_X + 8 &&
    py >= FLOWER_Y - 8 &&
    py < FLOWER_Y + 8
  ) {
    return { what: 'flower', i: -1 };
  }
  if (py >= SKY_TOP && py < SKY_BOT) return { what: 'sky', i: -1 };
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
    const pick3: number[] = [];
    for (let i = 0; i < 3; i++) pick3.push(pool.splice(rng.int(pool.length), 1)[0]);

    // できごとは3種から2つ
    const evPool = [0, 1, 2];
    const e1 = evPool.splice(rng.int(evPool.length), 1)[0];
    const e2 = evPool.splice(rng.int(evPool.length), 1)[0];

    return {
      ...createFeel(),
      score: 0,
      over: false,
      time: 0,

      stage: 'egg',
      form: 'aka',
      child: 'poyo',
      name: '',
      n0: pick3[0],
      n1: pick3[1],
      n2: pick3[2],

      hatchAt: EGG_AT,
      eggTaps: 0,
      poke: 0,
      nameWait: 0,

      // 41秒までの暫定値。おとなになった瞬間に確定させる
      life: 62,
      lifeFixed: false,
      elderAt: 54,
      endAge: 0,

      ev1Kind: e1,
      ev1At: rng.range(22, 38),
      ev1Done: false,
      ev2Kind: e2,
      ev2At: 0,
      ev2Done: false,

      napAt: NAP1_AT,
      napCount: 0,

      wantKind: '',
      wantPhase: 0,
      wantT: 0,
      wantMax: WANT_DUR_FIRST,
      wantHidden: false,
      revealAt: -1,
      wantWrong: 0,
      wantWait: 1.6,
      wantCount: 0,
      lastWant: '',

      napPhase: 0,
      napT: 0,
      dark: false,
      sleepy: 0,
      blackout: 0,
      peek: 0,
      peekDir: 1,

      poop: 0,
      poopPend: -1,
      poopedOnce: false,
      sickT: 0,
      coldAt: -1,

      evKind: 0,
      evT: 0,
      flower: false,
      flowerLook: 0,

      grow: 0,
      growText: '',
      growWhy: '',

      byeT: -1,
      sinkT: -1,
      epShown: 0,
      epTimer: 0,

      say: '',
      sayT: 0,
      heart: 0,
      heartT: 0,
      heartSmall: false,
      anim: 0,
      animKind: '',
      noT: 0,
      guideT: 0,
      guideBtn: -1,
      pressT: 0,
      pressBtn: -1,
      cardShake: 0,
      petCool: 0,
      lastPet: -9,
      poseSeed: rng.range(0, 7.2),

      fed: 0,
      played: 0,
      cleaned: 0,
      lit: 0,
      naps: 0,
      cured: 0,
      petted: 0,
      guessed: 0,
      knew: 0,
      ignored: 0,
      fed2: 0,
      played2: 0,
      ignored2: 0,
      answered2: 0,
      answered: 0,
      gift: false,
      friend: false,
      wished: false,
      sick: false,
      lucky: rng.chance(0.28),
      longLife: rng.chance(0.25),
      fav: rng.pick(['gohan', 'asobu', 'nade'] as const),
      readGesture: rng.chance(0.4),
    };
  },

  step(s, input, dt, rng) {
    const n = { ...s };
    if (!feelTick(n, input, dt)) return n;

    /* 1. 演出のタイマーを減らす */
    n.sayT = Math.max(0, n.sayT - dt);
    n.heartT = Math.max(0, n.heartT - dt);
    n.anim = Math.max(0, n.anim - dt);
    n.noT = Math.max(0, n.noT - dt);
    n.guideT = Math.max(0, n.guideT - dt);
    n.pressT = Math.max(0, n.pressT - dt);
    n.cardShake = Math.max(0, n.cardShake - dt);
    n.poke = Math.max(0, n.poke - dt);
    n.petCool = Math.max(0, n.petCool - dt);
    n.sleepy = Math.max(0, n.sleepy - dt);
    n.blackout = Math.max(0, n.blackout - dt);
    n.peek = Math.max(0, n.peek - dt);
    n.flowerLook = Math.max(0, n.flowerLook - dt);
    n.grow = Math.max(0, n.grow - dt);
    if (n.anim <= 0) n.animKind = '';

    const now = n.time + dt;

    /* 2. 段階を進める（境界は s.time + dt で比べる） */
    stepStage(n, now, dt, rng);

    /* 3. おわかれ。見送る → たね → 芽 → そのあとで記念の文（順番はここが正） */
    if (n.stage === 'bye') {
      const was = n.byeT;
      n.byeT += dt;
      // 沈みはじめ。sinkT は「沈みはじめからの経過」
      if (n.byeT >= SINK_AT) n.sinkT = n.byeT - SINK_AT;
      // 芽がぽんと出る瞬間に弾ませる（沈み始めに呼ぶと、芽のときには消えている）
      if (was < SINK_AT + SPROUT_AT && n.byeT >= SINK_AT + SPROUT_AT) addPop(n);
      // 記念の文（4行）。芽が出たあとに読む
      if (n.byeT >= EPI_AT && n.epShown === 0 && n.epTimer <= 0) {
        n.epShown = 1;
        n.epTimer = EPI_STEP;
      } else if (n.epTimer > 0) {
        n.epTimer -= dt;
        if (n.epTimer <= 0 && n.epShown < 4) {
          n.epShown++;
          n.epTimer = n.epShown < 4 ? EPI_STEP : 0;
        }
      }
      if (takeTap(n)) byeTap(n);
      if (n.byeT >= BYE_TOTAL) n.over = true;
      return n;
    }

    /* 5. かぜ・ねんね・うんち・できごとを進める */
    stepSick(n, dt);
    stepNap(n, now, dt);
    stepPoop(n, dt, rng);
    stepEvent(n, now, dt);

    /* 6. 呼びかけを進める（取り逃がしの判定は入力より先） */
    stepWant(n, dt, rng);

    /* 7. 入力。先行入力を拾う（hitStop の最中に押されたぶんを落とさない）。
       狙い先は「いま指がある座標」を使う（takeTap は押した事実だけを持ち越す） */
    if (takeTap(n)) handleTap(n, input.px, input.py, rng);

    return n;
  },

  draw(g, s) {
    const [sx, sy] = shakeOffset(s, s.time);
    drawRoom(g, s, sx, sy);
    drawInfo(g, s);
    if (s.stage === 'egg') {
      drawEgg(g, s, sx, sy);
    } else {
      drawFlower(g, s);
      drawPoop(g, s);
      if (s.evKind === 2) drawFriend(g, s, sx);
      if (s.evKind === 3) drawStar(g, s);
      drawChar(g, s, sx, sy);
    }
    if (s.stage === 'name') drawCards(g, s);
    drawBubble(g, s, sx);
    drawHead(g, s);
    drawSay(g, s);
    drawButtons(g, s);
    drawHelp(g, s);
  },

  /**
   * 上手い人。押すフレームだけ press を立てる（押しっぱなしにすると、
   * でたらめボットと同じで毎フレーム別の場所を押したことになってしまう）。
   */
  bot(s) {
    const frame = Math.round(s.time * 60);
    const idle = { press: false, px: 120, py: 160 };
    if (frame % 2 !== 0) return idle;

    const btn = (i: number) => ({
      press: true,
      px: BTN_X0 + i * BTN_GAP + BTN_W / 2,
      py: BTN_Y + BTN_H / 2,
    });
    const char = { press: true, px: CHAR_X, py: CHAR_Y };
    const answer = (k: Kind | '') => {
      if (k === 'nade') return char;
      const i = BTN_KINDS.indexOf(k as Kind);
      return i >= 0 ? btn(i) : idle;
    };

    if (s.sinkT >= 0 || s.stage === 'bye') return s.epShown > 0 ? char : idle;

    // たまごは 0.5秒おきに温める
    if (s.stage === 'egg') return s.eggTaps < EGG_TAPS && frame % 30 === 0 ? char : idle;
    // なまえは少し考えてから左のカード
    if (s.stage === 'name') {
      return s.nameWait >= 0.6
        ? { press: true, px: CARD_X[0] + CARD_W / 2, py: CARD_Y + CARD_H / 2 }
        : idle;
    }
    // かぜ・ねんね・うんちは見てから応える
    if (s.sickT > 0) return s.sickT >= 0.4 ? btn(3) : idle;
    if (s.napPhase === 2) return s.napT >= 0.3 ? btn(4) : idle;
    if (s.evKind === 1) return s.evT >= 0.5 ? char : idle;
    if (s.evKind === 2) return s.evT >= 0.5 ? btn(1) : idle;
    if (s.evKind === 3) return s.evT >= 0.5 ? { press: true, px: STAR_X, py: STAR_Y } : idle;
    if (s.poop > 0) return s.poop >= 0.4 ? btn(2) : idle;

    // しぐさから読める子は、ふきだしが出る前に渡す
    if (s.wantPhase === 1) {
      return s.readGesture && s.wantT >= 0.6 ? answer(s.wantKind) : idle;
    }
    if (s.wantPhase === 2) {
      if (!s.wantHidden) return s.wantT >= 0.35 ? answer(s.wantKind) : idle;
      // 「？」は 75% で当てる。当たりか外れかは state から決める（乱数だと毎フレーム変わる）
      const sure = (s.wantCount * 7 + s.n0) % 4 !== 0;
      if (sure || s.revealAt >= 0) {
        if (s.revealAt >= 0) return s.wantT >= s.revealAt + 0.3 ? answer(s.wantKind) : idle;
        return s.wantT >= 0.35 ? answer(s.wantKind) : idle;
      }
      // 外す回は別のボタンを1回だけ押して、絵が出るのを待つ
      if (s.wantWrong === 0 && s.wantT >= 0.4) {
        const right = BTN_KINDS.indexOf(s.wantKind as Kind);
        return btn(right === 0 ? 1 : 0);
      }
      return idle;
    }

    // 何も無いときはなでる
    if (s.petCool <= 0 && s.time - s.lastPet >= 2.5) return char;
    return idle;
  },

  reason: (s) =>
    `${s.name || 'まめ'}（${FORM_NAME[s.form]}）は ${Math.floor(s.endAge)}さいで たねになった`,

  tunables: {
    wantGap: {
      label: '呼びかけの間隔',
      min: 0.6,
      max: 1.8,
      get: () => TUNE.wantGap,
      set: (v) => {
        TUNE.wantGap = v;
      },
    },
    wantDur: {
      label: 'ふきだしの持続',
      min: 4,
      max: 12,
      get: () => TUNE.wantDur,
      set: (v) => {
        TUNE.wantDur = v;
      },
    },
    lifeBase: {
      label: '寿命の基準',
      min: 45,
      max: 80,
      get: () => TUNE.lifeBase,
      set: (v) => {
        TUNE.lifeBase = v;
      },
    },
  },
});

/* ================================================================== *
 * step の中身
 * ================================================================== */

/** たまご→なまえ→あかちゃん→こども→おとな→おとしより→おわかれ */
function stepStage(n: IppunIsshoState, now: number, dt: number, rng: Rng): void {
  if (n.stage === 'egg') {
    if (now >= n.hatchAt) {
      n.stage = 'name';
      n.nameWait = 0;
      gain(n, 2);
      speak(n, 'うまれた！');
      hearts(n, 2);
      addPop(n);
      hitStop(n, 0.06);
    }
    return;
  }

  if (n.stage === 'name') {
    n.nameWait += dt;
    if (n.nameWait >= NAME_WAIT) {
      n.name = NAMES[n.n0];
      n.stage = 'baby';
      speak(n, 'じぶんで なのった');
    }
    return;
  }

  // おわかれへ入る（呼びかけ・できごと・うんち・ねんねを止める）
  if (n.stage !== 'bye' && now >= n.life - BYE_LEN) {
    n.stage = 'bye';
    n.byeT = 0;
    n.endAge = ageAt(n, n.life);
    n.wantPhase = 0;
    n.wantKind = '';
    n.evKind = 0;
    n.poop = 0;
    n.poopPend = -1;
    n.napPhase = 0;
    n.sickT = 0;
    n.dark = false;
    // ながいきは、そのぶん長く一緒にいられたことへの加点
    const bonus = Math.min(16, Math.max(0, Math.round(n.life - 58)));
    if (bonus > 0) gain(n, bonus);
    return;
  }

  // おとしよりになる
  if (n.stage === 'adult' && now >= n.elderAt) {
    n.stage = 'elder';
    n.grow = GROW_HOLD;
    n.growText = 'おとしよりに なった';
    n.growWhy = '';
    gain(n, 3);
    addPop(n);
    return;
  }

  // せいちょう②（おとな）。ここで寿命が決まる
  if (n.stage === 'child' && now >= ADULT_AT) {
    n.stage = 'adult';
    growUp(n, adultForm(n), rng);
    fixLife(n, rng);
    return;
  }

  // せいちょう①（こども）
  if (n.stage === 'baby' && now >= CHILD_AT) {
    n.stage = 'child';
    const f = childForm(n);
    n.child = f;
    growUp(n, f, rng);
  }
}

/**
 * 19秒のこども4種。上から順に見る（design.md §8）。
 *
 * 差の基準を 2 → **1** に下げてある。あかちゃん期は実尺 16秒しかなく、
 * 呼びかけは多くて3回。差2を求めると 200回中 167回が「ぽよまめ」になり、
 * 設計 §11 の「上手い人の形態はばらける」が成立しなかった（実測）。
 */
function childForm(s: IppunIsshoState): Form {
  // あきらめさせたか、そもそも一度も触られていないか。
  // 設計の `ignored ≥ 3` は、最初の2回のふきだしが10秒あるため19秒までに到達できない
  // （実測: 放置プレイでも19秒時点の ignored は 0 で、のらまめが一度も出なかった）
  if (s.ignored >= 2 || (s.answered === 0 && s.petted === 0)) return 'nora';
  if (s.fed >= s.played + 1) return 'koro';
  if (s.played >= s.fed + 1) return 'pyon';
  return 'poyo';
}

/** 41秒のおとな9種＋かくれ1種 */
function adultForm(s: IppunIsshoState): Form {
  // `child !== 'nora'` を足してある。呼びかけの回数が一生で5〜7回しかないので
  // `ignored ≤ 1` だけだと、何もしていない人にも金色が出てしまう（実測: 放置の33%）
  if (s.lucky && s.ignored <= 1 && !s.sick && s.child !== 'nora') return 'kira';
  if (s.child === 'poyo') return s.lit < s.naps / 2 ? 'nebo' : 'mofu';
  if (s.child === 'koro') return s.played2 >= s.fed2 ? 'mochi' : 'manmaru';
  if (s.child === 'pyon') return s.fed2 > s.played2 ? 'tokotoko' : 'hane';
  // 「さいごまで そばに いてくれた」は、こども期に一度でも応えた人だけ。
  // ignored2 === 0 だけだと、**何もしていない人**（呼びかけがかぜやねんねに横取りされて
  // 時間切れにならなかっただけ）にも なつきまめ が出てしまう（実測: 放置の半分）
  return s.ignored2 === 0 && s.answered2 > 0 ? 'natsuki' : 'tabi';
}

const FORM_WHY: Record<Form, string> = {
  aka: '',
  nora: 'ひとりで いきてきたから',
  koro: 'ごはんが すきだったから',
  pyon: 'あそぶのが すきだったから',
  poyo: 'たくさん かまってもらったから',
  kira: 'だいじに そだてられたから',
  nebo: 'でんきが ついたまま ねたから',
  mofu: 'ぐっすり ねむれたから',
  mochi: 'あそぶのも すきになったから',
  manmaru: 'ごはんが だいすきだから',
  tokotoko: 'よく たべて よく あるいたから',
  hane: 'はねるのが すきだから',
  natsuki: 'さいごまで そばに いてくれたから',
  tabi: 'じぶんの みちを いくから',
};

/** せいちょうの瞬間。光って別の姿になり、**理由が1行**出る */
function growUp(n: IppunIsshoState, form: Form, _rng: Rng): void {
  n.form = form;
  n.grow = GROW_HOLD;
  n.growText = `${FORM_NAME[form]}に なった！`;
  n.growWhy = FORM_WHY[form];
  // 出ている呼びかけは**消さずに待機**させる（消すと「あきらめた」に数えられず、
  // 放置しても ignored がほとんど増えないまま きらまめになってしまう）。
  // せいちょうの1.8秒に**新しい**呼びかけを始めないだけにする
  if (n.wantPhase === 0) n.wantWait = Math.max(n.wantWait, GROW_HOLD + 0.6);
  hitStop(n, 0.08);
  addPop(n);
  // 🔴 gain() を通さない。n.form を先に代入しているので、通すと きらまめの +15 に
  //    さらに ×1.5 が掛かって +23 になる（設計は +15）
  n.score += form === 'kira' ? 15 : 5;
}

/**
 * 寿命を確定させ、41秒より後の予定を L の比率で置く。
 * 🔴 41 < ev2At（窓の上限 41+0.45×span） < elderAt（41+0.60×span） < L−8 < L を必ず満たすこと。
 */
function fixLife(n: IppunIsshoState, rng: Rng): void {
  n.life = TUNE.lifeBase + 10 * careRate(n) + rng.range(-1.5, 1.5) + (n.longLife ? 5 : 0);
  n.lifeFixed = true;
  const span = n.life - BYE_LEN - ADULT_AT;
  // 窓（41+0.10×span 〜 41+0.45×span）の中で引く。締切は おとしより より必ず手前
  n.ev2At = ADULT_AT + span * rng.range(0.1, 0.45);
  n.elderAt = ADULT_AT + 0.6 * span;
  // おとな期に 15% で理由なくかぜをひく。世話が良くても小さな生き物はかぜをひく（罰ではない）
  if (!n.sick && rng.chance(0.15)) n.coldAt = ADULT_AT + span * rng.range(0.2, 0.7);
  // 3回目のねんねは、おとな期が十分に長いときだけ
  n.napAt = span >= 14 ? ADULT_AT + 0.3 * span : -1;
  n.napCount = 2;
}

/* ---- かぜ ------------------------------------------------------------ */

function stepSick(n: IppunIsshoState, dt: number): void {
  // 予約してあった「理由なくひくかぜ」。世話の良し悪しとは関係ない
  if (n.sickT <= 0 && n.coldAt >= 0 && n.time >= n.coldAt && calm(n)) {
    n.coldAt = -1;
    catchCold(n);
    return;
  }
  if (n.sickT <= 0) return;
  n.sickT += dt;
  if (n.sickT >= SICK_HEAL) {
    n.sickT = 0;
    speak(n, 'なおった…');
  }
}

/** かぜをひかせる。一生に1回まで */
function catchCold(n: IppunIsshoState): void {
  if (n.sick || n.stage === 'bye' || n.over) return;
  n.sick = true;
  n.sickT = 0.001;
  speak(n, 'ぐすん…');
  pointAt(n, 'kusuri', GUIDE_AUTO_T);
  // このゲームで画面を揺らすのはここだけ（かぜの寒気）。失敗の合図ではない
  addShake(n, 0.2);
}

/* ---- ねんね ---------------------------------------------------------- */

function stepNap(n: IppunIsshoState, now: number, dt: number): void {
  if (n.napPhase === 0) {
    if (n.napAt >= 0 && now >= n.napAt && calm(n)) {
      n.napPhase = 1;
      n.napT = 0;
      n.napAt = n.napCount === 0 ? NAP2_AT : -1;
      n.napCount++;
      n.naps++;
      speak(n, 'ふぁ〜');
    }
    return;
  }
  n.napT += dt;
  if (n.napPhase === 1 && n.napT >= 0.8) {
    // あくび → 横になって「でんき」のふきだし。電球もボタンを線で指す
    n.napPhase = 2;
    n.napT = 0;
    pointAt(n, 'denki', GUIDE_AUTO_T);
  } else if (n.napPhase >= 2 && n.napT >= NAP_DUR) {
    // 朝。明かりは自動で戻る
    if (!n.dark) {
      n.sleepy = 3;
      speak(n, 'ねむそう…');
    }
    n.napPhase = 0;
    n.napT = 0;
    n.dark = false;
  }
}

/* ---- うんち ---------------------------------------------------------- */

function stepPoop(n: IppunIsshoState, dt: number, rng: Rng): void {
  if (n.poopPend > 0) {
    n.poopPend -= dt;
    if (n.poopPend <= 0) {
      n.poopPend = -1;
      // POOP_SURE 秒を過ぎてもまだ一度も出ていなければ、そうじの出番を作るために必ず出す
      const sure = !n.poopedOnce && n.time >= POOP_SURE;
      if (n.poop <= 0 && (sure || rng.chance(POOP_P))) {
        n.poop = 0.001;
        n.poopedOnce = true;
      }
    }
  }
  // ごはんが一度も来ないまま POOP_LAST 秒になったら、そこで出す
  if (!n.poopedOnce && n.poop <= 0 && n.time >= POOP_LAST && calm(n)) {
    n.poop = 0.001;
    n.poopedOnce = true;
  }
  if (n.poop > 0) {
    const before = n.poop;
    n.poop += dt;
    // そわそわのしぐさが終わって そうじ のふきだしが出た瞬間に、ボタンを線で指す
    if (before < GESTURE_T && n.poop >= GESTURE_T) pointAt(n, 'souji', GUIDE_AUTO_T);
    if (n.poop >= POOP_SICK_AT) {
      n.poop = 0;
      catchCold(n);
    }
  }
}

/* ---- できごと -------------------------------------------------------- */

function stepEvent(n: IppunIsshoState, now: number, dt: number): void {
  if (n.evKind > 0) {
    // かぜが始まったら できごとの時計も止める（呼びかけと同じ待避。ふきだしは くすり が優先）
    if (n.sickT > 0) return;
    n.evT += dt;
    const len = n.evKind === 3 ? STAR_LEN : EV_LEN;
    if (n.evT >= len) {
      // ほっとかれたときの終わり方。責めない
      if (n.evKind === 1) {
        n.flower = true;
        speak(n, 'かざった');
      } else if (n.evKind === 2) {
        speak(n, 'またね');
      }
      n.evKind = 0;
      n.evT = 0;
    }
    return;
  }
  if (!calm(n)) return;
  // 1回目・2回目とも「起きていて何も無い」まで先送りする（捨てるのは おわかれ に入ったときだけ）
  if (!n.ev1Done && now >= n.ev1At) {
    n.ev1Done = true;
    n.evKind = n.ev1Kind + 1;
    n.evT = 0;
    return;
  }
  if (n.lifeFixed && !n.ev2Done && now >= n.ev2At) {
    n.ev2Done = true;
    n.evKind = n.ev2Kind + 1;
    n.evT = 0;
  }
}

/* ---- 呼びかけ -------------------------------------------------------- */

function stepWant(n: IppunIsshoState, dt: number, rng: Rng): void {
  if (wantBlocked(n)) return;

  if (n.wantPhase === 0) {
    n.wantWait -= dt;
    if (n.wantWait <= 0) {
      n.wantCount++;
      n.wantKind = pickWant(n, rng);
      n.lastWant = n.wantKind;
      n.wantPhase = 1;
      n.wantT = 0;
      n.wantHidden = rng.chance(hideRate(n.stage));
      // 「？」のときは半分がその子のすきなもの。何度か遊ぶと読めてくる
      if (n.wantHidden && rng.chance(0.5)) n.wantKind = n.fav;
      n.revealAt = -1;
      n.wantWrong = 0;
      n.wantMax = n.wantCount <= 2 ? WANT_DUR_FIRST : TUNE.wantDur;
    }
    return;
  }

  n.wantT += dt;

  if (n.wantPhase === 1) {
    if (n.wantT >= GESTURE_T) {
      n.wantPhase = 2;
      n.wantT = 0;
      // 絵つきのふきだしは**毎回**、出た瞬間にボタンへ線を出す。
      // 最初の2回だけだと、3回目以降で「押していいか迷った」と言われた（初見者テスト）
      if (!n.wantHidden) pointAt(n, n.wantKind, GUIDE_AUTO_T);
    }
    return;
  }

  // 「？」は 3.5秒たったら自分から絵を見せて、ふきだしを延長する
  if (n.wantHidden && n.revealAt < 0 && n.wantT >= HIDE_REVEAL_T) {
    n.revealAt = n.wantT;
    n.wantMax = Math.max(n.wantMax, n.wantT + HIDE_EXTRA);
    pointAt(n, n.wantKind, GUIDE_AUTO_T);
  }

  if (n.wantT >= n.wantMax) {
    // 時間切れ。あきらめた（＝ignored）のはここだけ
    n.wantPhase = 0;
    n.wantKind = '';
    n.ignored++;
    if (n.stage === 'child') n.ignored2++;
    speak(n, '…');
    n.wantWait = wantGap(n.stage, rng);
    // 何度もあきらめさせていると、そのうち体をこわす
    if (n.ignored > 4 && rng.chance(0.3)) catchCold(n);
  }
}

/**
 * おわかれ中のタップは「次へ送る」。
 * 手を振っているあいだに押されたら記念の文を早め、途中なら1行進め、
 * 全部出ていたらハートを返す（**どこを押しても無反応にしない**）。
 */
function byeTap(n: IppunIsshoState): void {
  // 記念が始まる前に押されたら、そこから始める（見送りは飛ばさない）
  if (n.epShown === 0) {
    if (n.byeT < EPI_AT) {
      hearts(n, 1, true);
      return;
    }
    n.epShown = 1;
    n.epTimer = EPI_STEP;
    return;
  }
  // 1〜3行目だけ送れる。4行目（「◯◯さいで たねに なりました」）は自分の間で出す
  if (n.epShown < 3) {
    n.epShown++;
    n.epTimer = EPI_STEP;
    return;
  }
  hearts(n, 1, true);
}

/** ふきだしから、その絵のボタンへ点線を出す */
function pointAt(n: IppunIsshoState, kind: Kind | '', dur: number): void {
  const i = BTN_KINDS.indexOf(kind as Kind);
  if (i < 0) return;
  n.guideBtn = i;
  n.guideT = dur;
}

/* ---- 入力 ------------------------------------------------------------ *
 * **無反応をゼロにする。** どの状態でどこを押しても、必ず何かが返る。
 * ------------------------------------------------------------------- */

function handleTap(n: IppunIsshoState, px: number, py: number, rng: Rng): void {
  const hit = hitTest(n, px, py);

  /* たまご期: どこを押しても「ぽかぽか」 */
  if (n.stage === 'egg') {
    n.poke = 0.4;
    speak(n, 'ぽかぽか');
    if (n.eggTaps < EGG_TAPS) {
      n.eggTaps++;
      n.hatchAt = Math.max(EGG_MIN, n.hatchAt - EGG_WARM);
      gain(n, 1);
      hearts(n, 1, true);
    }
    return;
  }

  /* なまえ中: カードを選ぶ。それ以外はカードが揺れる */
  if (n.stage === 'name') {
    if (hit.what === 'card') {
      n.name = NAMES[[n.n0, n.n1, n.n2][hit.i]];
      n.stage = 'baby';
      speak(n, `${n.name}！`);
      hearts(n, 1);
      addPop(n);
    } else {
      n.cardShake = 0.4;
      speak(n, 'なまえを えらんでね');
    }
    return;
  }

  /* ボタンの押した合図（効いたかどうかに関わらず必ず返す） */
  if (hit.what === 'btn') {
    n.pressBtn = hit.i;
    n.pressT = 0.15;
  }

  /* ふきだしを押した → 同じ絵のボタンへ点線が飛ぶ */
  if (hit.what === 'bubble') {
    const k = bubbleKind(n);
    if (k === 'gift') {
      // おくりものはキャラに渡す。ふきだしを押したら、キャラを指す代わりに受け取る
      acceptGift(n);
      return;
    }
    if (k === 'star') {
      wish(n);
      return;
    }
    if (k === 'nade' || k === '') {
      speak(n, 'なでて…');
      return;
    }
    pointAt(n, k, GUIDE_T);
    return;
  }

  /* 飾った花を押した → 見に行く */
  if (hit.what === 'flower') {
    n.flowerLook = 0.8;
    speak(n, 'きれい');
    return;
  }

  /* 🔴 ここから先は dutyOf の順で見る（ふきだしの絵と同じ順。ずれると「絵と効くボタンが違う」が起きる） */
  const duty = dutyOf(n);

  /* かぜ: くすりだけ効く */
  if (duty === 'sick') {
    if (hit.what === 'btn' && BTN_KINDS[hit.i] === 'kusuri') {
      n.sickT = 0;
      n.cured++;
      gain(n, 3);
      speak(n, 'なおった！');
      hearts(n, 2);
      addPop(n);
    } else if (hit.what === 'char') {
      speak(n, 'つらそう…');
    } else {
      shakeNo(n);
    }
    return;
  }

  /* ねんね: でんきだけ効く */
  if (duty === 'nap') {
    if (n.napPhase === 1) {
      speak(n, 'ふぁ〜');
      return;
    }
    if (hit.what === 'btn' && BTN_KINDS[hit.i] === 'denki') {
      if (!n.dark) {
        n.dark = true;
        n.lit++;
        // 叶えたので「でんき」のふきだしと点線・黄色い枠をその場で下ろす
        // （残っていると「効いていないのでは」と不安になる）
        n.napPhase = 3;
        n.guideT = 0;
        n.guideBtn = -1;
        gain(n, 2);
        speak(n, 'ぐっすり');
        hearts(n, 1);
        addPop(n);
      } else {
        speak(n, 'すやすや…');
      }
    } else {
      speak(n, 'すやすや…');
    }
    return;
  }

  /* できごと */
  if (duty === 'event') {
    if (n.evKind === 1) {
      if (hit.what === 'char') acceptGift(n);
      else shakeNo(n);
      return;
    }
    if (n.evKind === 2) {
      if (hit.what === 'btn' && BTN_KINDS[hit.i] === 'asobu') {
        n.friend = true;
        gain(n, 6);
        speak(n, 'いっしょに！');
        hearts(n, 2);
        addPop(n);
        n.evKind = 0;
        n.evT = 0;
      } else if (hit.what === 'char') {
        speak(n, 'ともだちだよ');
      } else {
        shakeNo(n);
      }
      return;
    }
    if (hit.what === 'sky' || hit.what === 'char') wish(n);
    else shakeNo(n);
    return;
  }

  /* うんち。そわそわのしぐさ中（1.2秒）に そうじ を押せたら「わかってる！」 */
  if (duty === 'poop') {
    if (hit.what === 'btn' && BTN_KINDS[hit.i] === 'souji') {
      const early = n.poop < GESTURE_T;
      n.poop = 0;
      n.cleaned++;
      if (early) {
        n.knew++;
        gain(n, 5);
        speak(n, 'わかってる！');
        hearts(n, 2);
      } else {
        gain(n, 3);
        speak(n, 'きれいになった');
        hearts(n, 1);
      }
      addPop(n);
    } else if (hit.what === 'char') {
      speak(n, 'そわそわ…');
    } else {
      shakeNo(n);
    }
    return;
  }

  /* 呼びかけ（しぐさ中／ふきだし中） */
  if (duty === 'want') {
    const answered: Kind | '' =
      hit.what === 'btn' ? BTN_KINDS[hit.i] : hit.what === 'char' ? 'nade' : '';
    if (answered !== '' && answered === n.wantKind) {
      answerWant(n, rng);
    } else if (hit.what === 'char') {
      // 「なでて」以外のときのキャラタップは、答えではなく なで として受ける
      pet(n);
    } else if (answered !== '') {
      shakeNo(n);
      if (n.wantHidden) {
        n.wantWrong++;
        if (n.revealAt < 0) {
          n.revealAt = n.wantT;
          n.wantMax = Math.max(n.wantMax, n.wantT + HIDE_EXTRA);
          pointAt(n, n.wantKind, GUIDE_AUTO_T);
        }
      }
    } else if (hit.what === 'sky') {
      lookUp(n, px);
    } else {
      shakeNo(n);
    }
    return;
  }

  /* 何も起きていないとき */
  if (hit.what === 'char') {
    pet(n);
    return;
  }
  if (hit.what === 'btn') {
    // でんきは「起きているのに消した」。点も罰も無い
    if (BTN_KINDS[hit.i] === 'denki') {
      n.blackout = 1;
      speak(n, 'まっくら！');
      return;
    }
    speak(n, 'いま いらない');
    return;
  }
  if (hit.what === 'sky') {
    lookUp(n, px);
    return;
  }
  speak(n, 'ん？');
}

/** 呼びかけに応えた */
function answerWant(n: IppunIsshoState, rng: Rng): void {
  const kind = n.wantKind;
  const inGesture = n.wantPhase === 1;
  const late = !inGesture && n.wantT >= LATE_AT;

  n.answered++;
  if (n.stage === 'child') n.answered2++;
  if (kind === 'gohan') {
    n.fed++;
    if (n.stage === 'child') n.fed2++;
    // ごはんの2〜4秒後にうんちが出ることがある
    if (n.poopPend < 0 && n.poop <= 0) n.poopPend = rng.range(POOP_MIN, POOP_MAX);
  } else if (kind === 'asobu') {
    n.played++;
    if (n.stage === 'child') n.played2++;
  } else if (kind === 'nade') {
    n.petted++;
  }

  if (inGesture) {
    // しぐさの間に渡せた。ふきだしを出さずに済んだ
    n.knew++;
    gain(n, 5);
    speak(n, 'わかってる！');
    hearts(n, 2);
  } else if (n.wantHidden && n.wantWrong === 0) {
    n.guessed++;
    gain(n, 4);
    speak(n, late ? 'まってたよ！' : 'それ！');
    hearts(n, late ? 2 : 1);
  } else {
    gain(n, 3);
    speak(n, late ? 'まってたよ！' : 'それ！');
    hearts(n, late ? 2 : 1);
  }

  n.anim = ANIM_T;
  n.animKind = kind;
  n.wantPhase = 0;
  n.wantKind = '';
  // 「満たした1.2秒後に次のタイマーが走る」＝ 次の呼びかけまでが 4.5〜5.5秒。
  // ここを 1.2＋gap にすると1周 7秒を超え、あかちゃん期に呼びかけが2回しか入らなくなる（実測）
  n.wantWait = wantGap(n.stage, rng);
  addPop(n);
}

/** なでる。ふきだしが無いときだけ。15回まで点になる */
function pet(n: IppunIsshoState): void {
  if (n.petCool > 0) {
    speak(n, 'えへへ');
    return;
  }
  n.petCool = PET_COOL;
  n.lastPet = n.time;
  n.anim = 0.6;
  n.animKind = 'nade';
  hearts(n, 1, true);
  if (n.petted < PET_MAX) {
    n.petted++;
    gain(n, 1);
    speak(n, 'えへへ');
  } else {
    speak(n, 'もう じゅうぶん');
  }
}

/** おくりものを受け取る */
function acceptGift(n: IppunIsshoState): void {
  n.gift = true;
  n.flower = true;
  gain(n, 8);
  speak(n, 'あげる！');
  hearts(n, 3);
  addPop(n);
  n.evKind = 0;
  n.evT = 0;
}

/** ながれぼしにねがいごと */
function wish(n: IppunIsshoState): void {
  n.wished = true;
  gain(n, 10);
  speak(n, 'ねがいごと！');
  hearts(n, 3);
  addPop(n);
  hitStop(n, 0.06);
  n.evKind = 0;
  n.evT = 0;
}

/** 空を押した。押した方をちらっと見る（0.3秒・drawFace が目をずらす） */
function lookUp(n: IppunIsshoState, px: number): void {
  n.peek = 0.3;
  n.peekDir = px < CHAR_X ? -1 : 1;
  speak(n, 'ん？');
}

/** 間違い。首を振るだけで、点は動かない */
function shakeNo(n: IppunIsshoState): void {
  // 首振り中に押されたら短くして上書きする（入力を受け付けている、と分かるように）
  n.noT = n.noT > 0 ? 0.3 : NO_T;
  speak(n, 'ちがうの…');
}

/* ================================================================== *
 * 描画
 * ================================================================== */

/* ---- 部屋 ------------------------------------------------------------ */

function drawRoom(g: Painter, s: IppunIsshoState, sx: number, sy: number): void {
  g.clear('bg');
  const night = s.dark || s.blackout > 0 || (s.stage === 'bye' && s.byeT >= 2);
  const evening = s.stage === 'bye' && s.byeT < 2;

  g.rect(0, ROOM_TOP, W, ROOM_BOT - ROOM_TOP, night ? 'bg' : 'bg2');
  if (evening) {
    // 夕方。空だけを accent2 で薄く染める
    // 上ほど濃く。帯は整数座標・重なりなしで並べる（重ねると継ぎ目に線が出る）
    const strips = (GROUND_Y - ROOM_TOP) / 6;
    for (let i = 0; i < strips; i++) {
      g.alpha(0.2 * (1 - i / strips), () => g.rect(0, ROOM_TOP + i * 6, W, 6, 'accent2'));
    }
  }
  if (night) {
    // 星。粒は時間の関数（乱数を使わない）
    for (let i = 0; i < 18; i++) {
      const x = ((i * 61) % 226) + 7;
      const y = ROOM_TOP + 6 + ((i * 37) % 130);
      const tw = 0.35 + 0.65 * Math.sin(s.time * 3 + i * 1.7);
      g.alpha(Math.max(0.1, tw), () => g.rect(x, y, 2, 2, 'ink'));
    }
  }
  // 床
  g.rect(0, GROUND_Y, W, 2, 'line');
  g.rect(0, GROUND_Y + 2, W, ROOM_BOT - GROUND_Y - 2, night ? 'bg' : 'bg2');
  // 部屋の枠
  g.rectLine(0, ROOM_TOP, W, ROOM_BOT - ROOM_TOP, 'line');
  void sx;
  void sy;
}

/** 名前・段階・年齢と、右上の芽5つ */
function drawInfo(g: Painter, s: IppunIsshoState): void {
  if (s.stage === 'egg') {
    g.text('たまご', 6, 19, { size: 11, color: 'ink' });
  } else {
    // 🔴 おわかれに入ったら年齢を止める。ここが動き続けると、記念の
    //    「◯◯さいで たねに なりました」より上の年齢が表示され、「死んだのに歳が増える」に見える
    const age = Math.floor(s.stage === 'bye' ? s.endAge : ageAt(s, s.time));
    // 沈んだあとは現在進行形をやめる（「おとしより 97さい」のままだと、まだ生きているように見える）
    const label =
      s.sinkT >= 0
        ? `${s.name || 'まめ'}・${age}さいまで いきた`
        : s.name
          ? `${s.name}・${STAGE_NAME[s.stage]} ${age}さい`
          : `${STAGE_NAME[s.stage]} ${age}さい`;
    g.text(label, 6, 19, { size: 11, color: 'ink' });
  }
  // 芽（なかよしの目安）。しあわせ 20 ごとに1つ育ち、**5本で打ち止め**。
  // 育ちきったら双葉のまま増やさない（増やすと右端からはみ出して切れる）
  for (let i = 0; i < SPROUT_MAX; i++) {
    const x = SPROUT_X0 + i * SPROUT_GAP;
    const y = 31;
    const p = (s.score - i * SPROUT_STEP) / SPROUT_STEP;
    g.rect(x - 5, y - 2, 11, 2, p > 0 ? 'dim' : 'line');
    if (p <= 0) continue;
    if (p < 0.34) {
      // たね
      g.circle(x, y - 5, 3, 'dim');
    } else if (p < 0.67) {
      // 芽
      g.rect(x - 1, y - 9, 3, 7, 'good');
      g.circle(x + 4, y - 9, 3.5, 'good');
    } else {
      // 双葉
      g.rect(x - 1, y - 14, 3, 12, 'good');
      g.circle(x - 4, y - 12, 4, 'good');
      g.circle(x + 4, y - 12, 4, 'good');
    }
  }
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

/** 床に落ちる影。これが無いと、体が宙に浮いて見える */
function drawShadow(g: Painter, x: number): void {
  g.rect(x - 17, GROUND_Y - 4, 34, 2, 'bg');
  g.rect(x - 13, GROUND_Y - 6, 26, 2, 'bg');
}

function drawEgg(g: Painter, s: IppunIsshoState, sx: number, sy: number): void {
  const wob = Math.sin(s.time * (s.poke > 0 ? 26 : 4)) * (s.poke > 0 ? 4 : 2);
  g.sprite(EGG, CHAR_X + sx + wob, CHAR_Y + BODY_DY + sy, {
    scale: 4,
    colors: { X: 'ink' },
    center: true,
  });
  // あとどれくらいで生まれるか、は出さない（急がせないため）。温かさだけ見せる。
  // この輪が「ここを押せ」の唯一の合図なので、孵化まで薄く脈打たせて出しっぱなしにする
  drawShadow(g, CHAR_X + sx + wob * 0.4);
  const warm = s.poke > 0 ? 0.95 : 0.34 + 0.2 * Math.sin(s.time * 3);
  g.alpha(warm, () =>
    g.circleLine(CHAR_X + sx, CHAR_Y + BODY_DY + sy, 42, 'accent2', s.poke > 0 ? 3 : 2),
  );
}

/* ---- 体（16×16 ドット × DOT）---------------------------------------- *
 * こども4体のボディを土台にし、おとなはパーツ1〜2個の差分で作る。
 * 顔は 64px の空間に矩形と円で直接描く（16×16 に押し込むと半目・汗が描けない）。
 * ------------------------------------------------------------------- */

const BODY_AKA = [
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

/** ころまめ。まんまるで手足が小さい */
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

/** ぴょんまめ。長い耳と長い足 */
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

/** ぽよまめ。少し縦長でアホ毛が1本 */
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

/** のらまめ。葉っぱを乗せ、ほっぺに傷 */
const BODY_NORA = [
  '.......LL.......',
  '......LL........',
  '....XXXXXXXX....',
  '..XXXXXXXXXXXX..',
  '.XXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XCXXXXXXXXXXXXXX',
  '.XCXXXXXXXXXXXX.',
  '.XXXXXXXXXXXXXX.',
  '..XXXXXXXXXXXX..',
  '...XXXXXXXXXX...',
  '....XX....XX....',
  '................',
];

/** もちまめ。もちっとした楕円（ころまめの横長） */
const BODY_MOCHI = [
  '................',
  '................',
  '...XXXXXXXXXX...',
  '.XXXXXXXXXXXXXX.',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  'XXXXXXXXXXXXXXXX',
  '.XXXXXXXXXXXXXX.',
  '...XXXXXXXXXX...',
  '.....X....X.....',
  '................',
  '................',
];

/** まんまるまめ。さらにまるい（ころまめの拡大） */
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

/** ともだち。耳が三角で色がちがう */
const FRIEND = [
  '..X........X..',
  '..XX......XX..',
  '..XXXXXXXXXX..',
  '.XXXXXXXXXXXX.',
  '.XXXXXXXXXXXX.',
  '.XXXXXXXXXXXX.',
  '..XXXXXXXXXX..',
  '...X......X...',
];

const HEART = ['.X.X.', 'XXXXX', 'XXXXX', '.XXX.', '..X..'];

/** その姿の土台になる体。おとなはこどもの体を使い回す */
function bodyOf(s: IppunIsshoState, form: Form): readonly string[] {
  switch (form) {
    case 'aka':
      return BODY_AKA;
    case 'koro':
      return BODY_KORO;
    case 'pyon':
    case 'tokotoko':
    case 'hane':
      return BODY_PYON;
    case 'poyo':
    case 'nebo':
    case 'mofu':
      return BODY_POYO;
    case 'nora':
    case 'natsuki':
    case 'tabi':
      return BODY_NORA;
    case 'mochi':
      return BODY_MOCHI;
    case 'manmaru':
      return BODY_MANMARU;
    case 'kira':
      // きらまめは「その子が金色になった」姿なので、体はこどものときのまま
      return bodyOf(s, s.child);
  }
}

function colorsOf(form: Form): Record<string, ColorKey> {
  if (form === 'kira') return { X: 'accent', L: 'accent', C: 'accent' };
  if (form === 'nora' || form === 'tabi') return { X: 'dim', L: 'good', C: 'line' };
  // なつきまめはのらまめの体だが、色は戻る（そばに居てくれた子なので）
  if (form === 'natsuki') return { X: 'ink', L: 'good', C: 'line' };
  return { X: 'ink', L: 'good', C: 'line' };
}

/** おとしよりの色。ink→dim、dim→line で全体が褪せる */
function agedColors(base: Record<string, ColorKey>): Record<string, ColorKey> {
  const out: Record<string, ColorKey> = {};
  for (const k of Object.keys(base)) {
    const c = base[k];
    out[k] = c === 'ink' ? 'dim' : c === 'dim' ? 'line' : c;
  }
  return out;
}

/** 顔の置きどころ。体の形ごとに少しずらす */
function faceOf(form: Form): { dx: number; dy: number; mouth: number } {
  if (form === 'aka') return { dx: 6, dy: -4, mouth: 6 };
  if (form === 'pyon' || form === 'tokotoko' || form === 'hane') return { dx: 7, dy: -2, mouth: 9 };
  if (form === 'mochi') return { dx: 8, dy: -4, mouth: 7 };
  return { dx: 8, dy: -6, mouth: 6 };
}

type Mood = 'futsu' | 'niko' | 'shon' | 'nemu' | 'akubi' | 'hanme' | 'kaze' | 'toji';

function moodOf(s: IppunIsshoState): Mood {
  // 手を振っているあいだは笑っている。目を閉じるのは沈むとき
  if (s.stage === 'bye') return s.byeT < SINK_AT ? 'niko' : 'toji';
  if (s.sinkT >= 0) return 'toji';
  if (s.napPhase >= 2) return 'nemu';
  if (s.napPhase === 1) return 'akubi';
  if (s.sickT > 0) return 'kaze';
  if (s.sleepy > 0 || s.form === 'nebo') return 'hanme';
  if (s.anim > 0 || s.sayT > 0.15) {
    if (s.say === 'ちがうの…') return 'futsu';
    if (s.say === '…') return 'shon';
    return 'niko';
  }
  // 3回目以降の呼びかけは、5秒からしょんぼり顔になる
  if (s.wantPhase === 2 && s.wantCount > 2 && s.wantT >= WANT_SAD_AT) return 'shon';
  // 何も無いときは、ときどき自分であくびをする（ねんねとは無関係。生きている、の合図）
  if (idleYawn(s)) return 'akubi';
  return 'futsu';
}

/** ねんねと関係のない、ふだんのあくび。12秒に1回・0.8秒（時間の関数なので state を増やさない） */
function idleYawn(s: IppunIsshoState): boolean {
  if (s.wantPhase > 0 || s.evKind > 0 || s.poop > 0 || s.grow > 0 || s.anim > 0 || s.sayT > 0) {
    return false;
  }
  return (((s.time + s.poseSeed * 1.7) % YAWN_EVERY) + YAWN_EVERY) % YAWN_EVERY < YAWN_LEN;
}

/**
 * 待機動作。歩く → 座る → 歩く → こちらを見る（花があれば花のほうを見る）、を 7.2秒で1周。
 * 位置は時間の関数なので、state を増やさずに「勝手に暮らしている」が出る。
 *
 * 歩く幅を WALK_X より広げないこと。当たり判定は (120,160)・半径36 で固定なので、
 * 広げると「見えている体を押したのに効かない」が起きる。
 */
function idlePose(s: IppunIsshoState): {
  x: number;
  sit: boolean;
  look: boolean;
  flower: boolean;
} {
  const P = 7.2;
  const u = (((s.time + s.poseSeed) % P) + P) % P;
  const k = u / P;
  const base = { sit: false, look: false, flower: false };
  if (k < 0.35) return { ...base, x: -WALK_X + (2 * WALK_X * k) / 0.35 };
  if (k < 0.55) return { ...base, x: WALK_X, sit: true };
  if (k < 0.9) return { ...base, x: WALK_X - (2 * WALK_X * (k - 0.55)) / 0.35 };
  // 花が飾ってあれば、いちばん左まで来たときに花のほうを見に行く
  return { ...base, x: -WALK_X, look: !s.flower, flower: s.flower };
}

/** 待機動作を止めるべき状況か（drawChar と drawFace で同じ判定を使う） */
function still(s: IppunIsshoState): boolean {
  return (
    s.napPhase > 0 ||
    s.sickT > 0 ||
    s.stage === 'bye' ||
    s.grow > 0 ||
    s.evKind > 0 ||
    s.wantPhase > 0 ||
    s.poop > 0 ||
    s.anim > 0 ||
    s.flowerLook > 0
  );
}

function drawChar(g: Painter, s: IppunIsshoState, sx: number, sy: number): void {
  const pose = idlePose(s);
  let bx = CHAR_X + sx;
  let by = CHAR_Y + BODY_DY + sy;
  let scale = DOT;

  if (!still(s)) {
    bx += pose.x;
    // 歩くときだけ、ぴょこぴょこ弾む（おとしよりは跳ねない）
    if (!pose.sit && !pose.look && !pose.flower && s.stage !== 'elder') {
      by -= Math.abs(Math.sin(s.time * 6)) * 3;
    }
    if (pose.sit) by += 4;
  } else if (s.flowerLook > 0) {
    // 花を見に行く（押されたとき）
    bx -= 16;
  }

  // しぐさ（1.2秒・文字なし）
  if (s.wantPhase === 1) {
    if (s.wantKind === 'gohan') {
      // おなかが上下する（拡大率は整数しか使えないので、動きで「ふくらむ」を出す）
      by += Math.sin(s.wantT * 8) * 2;
    } else if (s.wantKind === 'asobu') {
      by -= Math.abs(Math.sin(s.wantT * 8)) * 5;
    } else if (s.wantKind === 'nade') {
      // こちらへ寄って見上げる（4px前へ・ひとまわり大きく）
      by += 4;
      scale = DOT + 1;
    }
  }
  if (s.anim > 0 && s.animKind === 'asobu') by -= Math.abs(Math.sin(s.time * 9)) * 6;
  if (s.napPhase >= 2) by += 16;
  // うんちのそわそわ（しぐさ中）
  if (s.poop > 0 && s.poop < GESTURE_T) bx += Math.sin(s.poop * 18) * 4;
  if (s.noT > 0) bx += Math.sin(s.noT * 40) * 5;
  if (s.grow > 0) scale = DOT * popScale(s, 0.25);
  if (s.sickT > 0) bx += Math.sin(s.time * 22) * 1.5;

  // せいちょうの0.6秒前から予告する。
  // 🔴 体を accent（金色）で塗らないこと。「病気？」と読まれた上に、
  //    金色の体は きらまめ だけの記号なので意味が壊れる。白っぽい明滅＋昇るきらきらにする
  const base = colorsOf(s.form);
  const colors = s.stage === 'elder' || s.stage === 'bye' ? agedColors(base) : base;
  const nextGrow =
    s.stage === 'baby' ? CHILD_AT : s.stage === 'child' ? ADULT_AT : s.stage === 'adult' ? s.elderAt : -1;
  const toGrow = nextGrow - s.time;
  const preGrow = toGrow > 0 && toGrow <= 0.6;
  // 明滅の下限は 0.7。これより暗くすると「消えかけている」に見えて、せいちょうの予告にならない
  const preAlpha = preGrow ? 0.7 + 0.3 * Math.abs(Math.sin(toGrow * 22)) : 1;

  // 土に沈む（ゆっくり。ここが見せ場なので急がない）。
  // 沈む距離は「いちばん高いパーツ（ナイトキャップ・帽子）も床より下へ行く」ぶん必要。
  // 足りないと、体が埋まったあとに帽子だけ地面に残る
  const sink = s.sinkT >= 0 ? Math.min(1, s.sinkT / SINK_LEN) * SINK_DEPTH : 0;

  // 沈むときは床でクリップする（床より下に体が見えていると「埋まった」に見えない）
  const clipH = (s.sinkT >= 0 ? GROUND_Y : ROOM_BOT) - ROOM_TOP;
  // 🔴 拡大率は整数だけ。小数を渡すとドットの間に1px の隙間ができ、体に格子が出る
  const iscale = Math.max(1, Math.round(scale));
  // 沈みきったら体は描かない（床の下に居るので、パーツだけが顔を出すことがある）
  const buried = s.sinkT >= SINK_LEN;
  g.clip(0, ROOM_TOP, W, clipH, () => {
    if (s.sinkT < 0) drawShadow(g, bx);
    if (buried) return;
    g.alpha(preAlpha, () => {
      g.sprite(bodyOf(s, s.form), bx, by + sink, { scale: iscale, colors, center: true });
      drawParts(g, s, bx, by + sink, iscale);
      // 沈むあいだも顔を描く（消すと、ただの灰色のかたまりが土に埋まる絵になる）
      drawFace(g, s, bx, by + sink, iscale);
    });
    // 予告のきらきらは体の上を昇る
    if (preGrow) {
      for (let i = 0; i < 6; i++) {
        const k = ((0.6 - toGrow) * 1.6 + i * 0.17) % 1;
        g.alpha(1 - k, () =>
          g.circle(bx - 22 + ((i * 37) % 45), by + 20 - k * 56, 2.2, 'accent'),
        );
      }
    }
  });

  // たね → 芽。次の一生がここから始まる、という絵
  if (s.sinkT >= 0) {
    // たねが落ちる（沈みきってから）
    if (s.sinkT >= SEED_AT && s.sinkT < SPROUT_AT) {
      const fall = Math.min(1, (s.sinkT - SEED_AT) / (SPROUT_AT - SEED_AT));
      g.circle(CHAR_X, 168 + fall * 30, 4, 'ink');
    }
    // 芽がぽんと出る。次の一生がここから始まる、という絵
    if (s.sinkT >= SPROUT_AT) {
      const k = popScale(s, 0.5);
      const hgt = Math.min(1, (s.sinkT - SPROUT_AT) / 0.25) * 22 * k;
      g.rect(CHAR_X - 6, GROUND_Y - 2, 12, 3, 'line');
      g.rect(CHAR_X - 1, GROUND_Y - hgt, 3, hgt, 'good');
      g.circle(CHAR_X - 6, GROUND_Y - hgt, 6 * k, 'good');
      g.circle(CHAR_X + 7, GROUND_Y - hgt, 6 * k, 'good');
    }
  }

  // おくりもの: 花を持って光っている（何を渡そうとしているのかを絵で見せる）
  if (s.evKind === 1 && s.sinkT < 0) {
    const tw = 0.45 + 0.55 * Math.sin(s.time * 6);
    g.alpha(tw, () => g.circleLine(bx, by, 40, 'accent', 2));
    const hx = bx + 30;
    const hy = by + 4;
    g.rect(hx - 1, hy - 2, 2, 12, 'good');
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + s.time * 0.6;
      g.circle(hx + Math.cos(a) * 5, hy - 6 + Math.sin(a) * 5, 3.2, 'accent2');
    }
    g.circle(hx, hy - 6, 2.5, 'accent');
  }

  // ハート・+点・しぐさの持ち物
  drawGesture(g, s, bx, by);
  drawAnim(g, s, bx, by);
  drawHearts(g, s, bx, by);
  // おわかれの手振り。腕を上げて、手のひらを左右に振る
  if (s.stage === 'bye' && s.byeT < SINK_AT) {
    const a = Math.sin(s.time * 8) * 0.4;
    g.at(bx + 22, by + 4, a, () => {
      g.rect(-3, -30, 6, 30, 'dim');
      g.circle(0, -32, 6, 'dim');
    });
  }
}

/** おとなのパーツ（羽・帽子・ナイトキャップ・胸のハート・ふち毛・杖） */
function drawParts(g: Painter, s: IppunIsshoState, bx: number, by: number, scale: number): void {
  const r = scale * 8;
  const aged = s.stage === 'elder' || s.stage === 'bye';
  const ink: ColorKey = aged ? 'dim' : 'ink';

  if (s.form === 'hane') {
    // 羽。左右に2枚
    for (const d of [-1, 1]) {
      g.poly(
        [
          bx + d * (r - 4),
          by - 10,
          bx + d * (r + 16),
          by - 20,
          bx + d * (r + 14),
          by - 2,
          bx + d * (r - 2),
          by + 4,
        ],
        'cool',
      );
    }
  } else if (s.form === 'tokotoko') {
    // 長い足
    for (const d of [-1, 1]) g.rect(bx + d * 8 - 2, by + r - 6, 4, 14, ink);
    for (const d of [-1, 1]) g.rect(bx + d * 8 - 5, by + r + 6, 9, 3, ink);
  } else if (s.form === 'nebo') {
    // ナイトキャップ
    g.poly([bx - 14, by - r + 6, bx + 12, by - r + 6, bx + 2, by - r - 18], 'cool');
    g.circle(bx + 2, by - r - 19, 4, 'ink');
  } else if (s.form === 'mofu') {
    // ふち毛。時間の関数でふわふわ揺れる
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const rr = r + 2 + Math.sin(s.time * 3 + i) * 2;
      g.circle(bx + Math.cos(a) * rr, by + Math.sin(a) * rr, 3.5, aged ? 'line' : 'dim');
    }
  } else if (s.form === 'natsuki') {
    g.sprite(HEART, bx, by + 15, { scale: 3, colors: { X: 'accent2' }, center: true });
  } else if (s.form === 'tabi') {
    // 帽子と首巻き
    g.rect(bx - 18, by - r + 2, 36, 4, 'accent2');
    g.rect(bx - 11, by - r - 8, 22, 10, 'accent2');
    g.rect(bx - 16, by + 10, 32, 5, 'cool');
    g.rect(bx + 10, by + 13, 5, 10, 'cool');
  } else if (s.form === 'kira') {
    // きらきら。粒は時間の関数
    for (let i = 0; i < 5; i++) {
      const a = i * 1.5 + s.time * 1.6;
      const tw = 0.4 + 0.6 * Math.sin(s.time * 7 + i * 1.3);
      g.alpha(tw, () => g.circle(bx + Math.cos(a) * (r + 8), by + Math.sin(a) * (r + 4), 2.5, 'accent'));
    }
  }

  // おとしよりの杖
  if (aged && s.sinkT < 0) {
    g.rect(bx + r - 2, by - 4, 3, 30, 'dim');
    g.rect(bx + r - 6, by - 6, 8, 3, 'dim');
  }
}

/** 顔。形態ごとに描き分けず、mood から矩形と円を重ねて作る */
function drawFace(g: Painter, s: IppunIsshoState, cx: number, cy: number, scale: number): void {
  const mood = moodOf(s);
  const f = faceOf(s.form);
  const k = scale / DOT;
  // 空を押されたら押した方を、飾った花があればふだんは花のほうを、ちらっと見る
  const gaze = s.peek > 0 ? s.peekDir * 3 : idlePose(s).flower && !still(s) ? -3 : 0;
  const ex = cx + gaze;
  const ey = cy + f.dy * k;
  const my = cy + f.mouth * k;
  const eye: ColorKey = 'bg';
  const dxx = f.dx * k;

  if (mood === 'niko' || mood === 'toji') {
    // ^ ^（閉じた目）
    for (const d of [-1, 1]) {
      const x = ex + d * dxx;
      g.rect(x - 4, ey, 3, 2, eye);
      g.rect(x - 1, ey - 3, 3, 2, eye);
      g.rect(x + 2, ey, 3, 2, eye);
    }
  } else if (mood === 'nemu') {
    for (const d of [-1, 1]) g.rect(ex + d * dxx - 4, ey, 8, 2, eye);
  } else if (mood === 'hanme' || mood === 'akubi' || mood === 'kaze') {
    for (const d of [-1, 1]) {
      g.rect(ex + d * dxx - 4, ey - 1, 8, 2, eye);
      g.circle(ex + d * dxx, ey + 2, 1.5, eye);
    }
  } else if (mood === 'shon') {
    for (const d of [-1, 1]) {
      const x = ex + d * dxx;
      g.circle(x, ey + 1, 2.5, eye);
      g.rect(x - 4, ey - 4, 8, 2, eye);
    }
  } else {
    for (const d of [-1, 1]) g.circle(ex + d * dxx, ey, 2.4, eye);
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
    // 大きく開いた口。これが「あくび」の主語
    g.circle(ex, my + 2, 6, eye);
  } else if (mood === 'nemu' || mood === 'toji') {
    g.rect(ex - 2, my, 5, 2, eye);
  } else {
    g.rect(ex - 2, my, 5, 2, eye);
    g.rect(ex - 4, my - 2, 2, 2, eye);
    g.rect(ex + 3, my - 2, 2, 2, eye);
  }

  // ぽよ系のほっぺ
  if (s.form === 'poyo' || s.form === 'mofu' || s.form === 'nebo') {
    g.circle(cx - dxx - 7, cy + 2 * k, 3, 'accent2');
    g.circle(cx + dxx + 7, cy + 2 * k, 3, 'accent2');
  }

  // おとしよりの白い眉
  if (s.stage === 'elder' || s.stage === 'bye') {
    for (const d of [-1, 1]) g.rect(ex + d * dxx - 5, ey - 8, 10, 2, 'ink');
  }

  // かぜの汗と震え
  if (mood === 'kaze') {
    g.circle(cx + 22, cy - 12, 3, 'cool');
    g.rect(cx + 21, cy - 18, 2, 5, 'cool');
  }
  // よだれは ねぼまめ だけ。あくびに付けると、目を閉じた青い雫が「泣いた」に読まれる
  if (mood === 'hanme' && s.form === 'nebo') {
    g.rect(ex + 3, my + 2, 2, 5, 'cool');
  }

  // ねんねの寝息。文字ではなく形で描く（画面に英語を出さないため）
  if (mood === 'nemu') {
    for (let i = 0; i < 3; i++) {
      const kk = (s.time * 0.7 + i * 0.33) % 1;
      g.alpha(1 - kk, () => g.circle(cx + 22 + kk * 14, cy - 14 - kk * 18, 2 + kk * 2, 'dim'));
    }
  }
}

/** しぐさの持ち物（おなかの手・転がってくるボール） */
function drawGesture(g: Painter, s: IppunIsshoState, bx: number, by: number): void {
  // うんちを見てそわそわ（1.2秒・文字なし）。この間に そうじ を押せたら「わかってる！」
  if (s.poop > 0 && s.poop < GESTURE_T) {
    const sway = Math.sin(s.poop * 18) * 4;
    for (let i = 0; i < 3; i++) {
      const k = (s.poop * 1.4 + i * 0.33) % 1;
      g.alpha(1 - k, () => g.circle(bx + 16 + sway, by - 26 - k * 12, 2.2, 'dim'));
    }
    // うんちのほうを見ている線。実線だと棒に見えるので点で置く
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      g.circle(bx + 22 + (POOP_X - 14 - (bx + 22)) * t, by - 6 + (POOP_Y - 8 - (by - 6)) * t, 1.4, 'line');
    }
    return;
  }
  if (s.wantPhase !== 1) return;
  if (s.wantKind === 'gohan') {
    // おなかを両手で押さえ、その横で「ぐるぐる」が回る（文字は出さない）
    const hand: ColorKey = s.stage === 'elder' ? 'line' : 'dim';
    for (const d of [-1, 1]) g.circle(bx + d * 12, by + 12, 5, hand);
    for (const d of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const a = i * 0.85 + s.time * 5 * d;
        const rr = 2 + i * 0.9;
        g.circle(bx + d * 30 + Math.cos(a) * rr, by + 6 + Math.sin(a) * rr, 1.6, 'dim');
      }
    }
  } else if (s.wantKind === 'asobu') {
    // ボールが床を転がってくる
    const p = Math.min(1, s.wantT / 0.8);
    const x = W - 20 - (W - 20 - (bx + 34)) * p;
    g.circle(x, GROUND_Y - 6, 6, 'accent2');
    g.rect(x - 6, GROUND_Y - 8, 12, 2, 'bg2');
  } else if (s.wantKind === 'nade') {
    // 前に出て見上げ、目がきらっとする
    const tw = Math.abs(Math.sin(s.wantT * 5));
    for (const d of [-1, 1]) {
      g.alpha(tw, () => {
        g.rect(bx + d * 9 - 5, by - 8, 10, 2, 'accent');
        g.rect(bx + d * 9 - 1, by - 12, 2, 10, 'accent');
      });
    }
    const k = (s.wantT * 1.6) % 1;
    g.alpha(1 - k, () => g.circle(bx, by - 36 - k * 8, 2.5, 'accent2'));
  }
}

/** 正解のアニメ（茶碗・ボール・目を細める） */
function drawAnim(g: Painter, s: IppunIsshoState, bx: number, by: number): void {
  if (s.anim <= 0) return;
  if (s.animKind === 'gohan') {
    // 茶碗は体の左どなり・床の上に置く。顔や体に重ねると何を食べているのか分からなくなる
    const cx = bx - 34;
    const cy = GROUND_Y - 14;
    const wob = Math.sin(s.time * 18) * 2;
    g.poly([cx - 12, cy, cx + 12, cy, cx + 7, cy + 11, cx - 7, cy + 11], 'ink');
    g.rect(cx - 14, cy - 2 + wob, 28, 3, 'ink');
    for (let i = 0; i < 2; i++) {
      const k = (s.time * 1.6 + i * 0.5) % 1;
      g.alpha(1 - k, () => g.circle(cx - 5 + i * 10, cy - 8 - k * 14, 2.5, 'dim'));
    }
  } else if (s.animKind === 'asobu') {
    const a = s.time * 6;
    g.circle(bx + Math.cos(a) * 30, by - 6 + Math.sin(a) * 14, 6, 'accent2');
  }
}

/**
 * ハート。**このゲームで「よかった」を返す唯一の手段**（浮く数字は出さない）。
 * 数と大きさだけで軽重を伝える: なで・ぽかぽか＝小1／応えた＝1／先読み・「？」当て＝2／できごと＝2〜3。
 */
function drawHearts(g: Painter, s: IppunIsshoState, bx: number, by: number): void {
  if (s.heartT <= 0) return;
  const k = 1 - s.heartT;
  const sc = s.heartSmall ? 2 : 4;
  const gap = s.heartSmall ? 12 : 22;
  // 記念の文（芽の上 y=92〜）が出ているあいだは、文字の帯に重ならないよう芽のそばで浮かせる
  const memorial = s.stage === 'bye' && s.epShown > 0;
  for (let i = 0; i < s.heart; i++) {
    const x = bx - ((s.heart - 1) * gap) / 2 + i * gap + Math.sin(s.time * 5 + i) * 3;
    const y = memorial ? by + 18 - k * 10 : by - 36 - k * 22;
    g.alpha(Math.max(0, s.heartT), () =>
      g.sprite(HEART, x, y, { scale: sc, colors: { X: 'accent2' }, center: true }),
    );
  }
}

/* ---- うんち・花・ともだち・ながれぼし ------------------------------- */

/** うんちは3つ山の丘型（渦巻きにしない。design.md §16） */
function drawPoop(g: Painter, s: IppunIsshoState): void {
  if (s.poop <= 0) return;
  const c: ColorKey = 'dim';
  // 夜（消灯中）は背景と同化して見えないので、ひとまわり大きく ink で敷いて縁取りにする
  if (s.dark || s.blackout > 0) {
    g.rect(POOP_X - 13, POOP_Y + 5, 26, 6, 'ink');
    g.circle(POOP_X - 7, POOP_Y + 5, 7, 'ink');
    g.circle(POOP_X + 7, POOP_Y + 5, 7, 'ink');
    g.circle(POOP_X, POOP_Y - 3, 8, 'ink');
  }
  g.rect(POOP_X - 12, POOP_Y + 6, 24, 4, c);
  g.circle(POOP_X - 7, POOP_Y + 5, 6, c);
  g.circle(POOP_X + 7, POOP_Y + 5, 6, c);
  g.circle(POOP_X, POOP_Y - 3, 7, c);
  // 4秒でハエ。粒は時間の関数
  if (s.poop >= FLY_AT) {
    for (let i = 0; i < 2; i++) {
      const a = s.time * (3 + i) + i * 2.4;
      g.circle(POOP_X + Math.cos(a) * 16, POOP_Y - 14 + Math.sin(a * 1.7) * 8, 2.2, 'ink');
    }
  }
}

function drawFlower(g: Painter, s: IppunIsshoState): void {
  if (!s.flower) return;
  g.rect(FLOWER_X - 1, FLOWER_Y - 2, 2, 12, 'good');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + s.time * 0.4;
    g.circle(FLOWER_X + Math.cos(a) * 5, FLOWER_Y - 6 + Math.sin(a) * 5, 3.2, 'accent2');
  }
  g.circle(FLOWER_X, FLOWER_Y - 6, 2.5, 'accent');
}

function drawFriend(g: Painter, s: IppunIsshoState, sx: number): void {
  const hop = Math.abs(Math.sin(s.time * 5)) * 4;
  g.rect(FRIEND_X + sx - 12, GROUND_Y - 4, 24, 2, 'bg');
  g.sprite(FRIEND, FRIEND_X + sx, FRIEND_Y - hop, {
    scale: 3,
    colors: { X: 'cool' },
    center: true,
  });
  for (const d of [-1, 1]) g.circle(FRIEND_X + sx + d * 6, FRIEND_Y - hop - 2, 2, 'bg');
}

/** ながれぼしは横切らせない。空の一点で止まってぴかぴか光る */
function drawStar(g: Painter, s: IppunIsshoState): void {
  const tw = 0.5 + 0.5 * Math.sin(s.time * 9);
  const r = 6 + tw * 3;
  g.alpha(0.3 + 0.7 * tw, () => {
    g.poly(
      [STAR_X, STAR_Y - r, STAR_X + r * 0.4, STAR_Y - r * 0.3, STAR_X + r, STAR_Y,
        STAR_X + r * 0.4, STAR_Y + r * 0.3, STAR_X, STAR_Y + r,
        STAR_X - r * 0.4, STAR_Y + r * 0.3, STAR_X - r, STAR_Y,
        STAR_X - r * 0.4, STAR_Y - r * 0.3],
      'accent',
    );
  });
  for (let i = 0; i < 4; i++) {
    const a = i * 1.57 + s.time * 2;
    g.alpha(tw * 0.7, () => g.circle(STAR_X + Math.cos(a) * 16, STAR_Y + Math.sin(a) * 16, 2, 'accent'));
  }
}

/* ---- ふきだしと絵 ---------------------------------------------------- */

function drawBubble(g: Painter, s: IppunIsshoState, sx: number): void {
  const kind = bubbleKind(s);
  if (kind === '') return;
  const x = BUB_X + sx;
  // ながれぼしはふきだしを出さない（空で光っているものが本体）
  if (kind === 'star') return;
  const hidden = dutyOf(s) === 'want' && s.wantHidden && s.revealAt < 0;

  const wob = Math.sin(s.time * 3) * 1.5;
  g.rect(x - BUB_W / 2, BUB_Y - BUB_H / 2 + wob, BUB_W, BUB_H, 'bg2');
  g.rectLine(x - BUB_W / 2, BUB_Y - BUB_H / 2 + wob, BUB_W, BUB_H, 'ink');
  // しっぽ
  g.poly(
    [x - 6, BUB_Y + BUB_H / 2 - 2 + wob, x + 6, BUB_Y + BUB_H / 2 - 2 + wob, x, BUB_Y + BUB_H / 2 + 8 + wob],
    'bg2',
  );
  g.line(x - 6, BUB_Y + BUB_H / 2 - 1 + wob, x, BUB_Y + BUB_H / 2 + 8 + wob, 'ink');
  g.line(x + 6, BUB_Y + BUB_H / 2 - 1 + wob, x, BUB_Y + BUB_H / 2 + 8 + wob, 'ink');

  if (hidden) {
    g.text('？', x, BUB_Y + wob, { size: 24, align: 'center', baseline: 'middle', color: 'ink' });
  } else {
    drawIcon(g, kind, x, BUB_Y + wob, 24, 'ink');
  }

  // ふきだしから、その絵のボタンへ点線
  if (s.guideT > 0 && s.guideBtn >= 0) {
    const tx = BTN_X0 + s.guideBtn * BTN_GAP + BTN_W / 2;
    const ty = BTN_Y - 2;
    const x0 = x;
    const y0 = BUB_Y + BUB_H / 2 + 10 + wob;
    for (let i = 0; i <= 10; i++) {
      if (i % 2 === 1) continue;
      const p = i / 10;
      g.circle(x0 + (tx - x0) * p, y0 + (ty - y0) * p, 2, 'accent');
    }
  }
}

/**
 * ボタンとふきだしの絵。**同じ関数で描く**（「絵が同じ」が唯一の手引き）。
 * size は 24 を基準にした一辺の長さ。
 */
function drawIcon(g: Painter, kind: Kind | '', cx: number, cy: number, size: number, c: ColorKey): void {
  const u = size / 24;
  switch (kind) {
    case 'gohan': {
      // 茶碗＋湯気
      g.poly([cx - 11 * u, cy + 1 * u, cx + 11 * u, cy + 1 * u, cx + 7 * u, cy + 10 * u, cx - 7 * u, cy + 10 * u], c);
      g.rect(cx - 12 * u, cy - 2 * u, 24 * u, 3 * u, c);
      g.rect(cx - 6 * u, cy - 10 * u, 2 * u, 6 * u, c);
      g.rect(cx + 4 * u, cy - 11 * u, 2 * u, 7 * u, c);
      break;
    }
    case 'asobu': {
      // 縞のボール
      g.circle(cx, cy, 10 * u, c);
      g.rect(cx - 10 * u, cy - 3 * u, 20 * u, 2 * u, 'bg2');
      g.rect(cx - 10 * u, cy + 2 * u, 20 * u, 2 * u, 'bg2');
      break;
    }
    case 'souji': {
      // ほうき
      g.rect(cx - 1 * u, cy - 11 * u, 3 * u, 13 * u, c);
      g.poly([cx - 8 * u, cy + 11 * u, cx + 9 * u, cy + 11 * u, cx + 5 * u, cy + 1 * u, cx - 4 * u, cy + 1 * u], c);
      break;
    }
    case 'kusuri': {
      // 斜めに置いたカプセル。まん中に分かれ目を入れて「薬」と読めるようにする
      g.circle(cx - 5 * u, cy + 5 * u, 6 * u, c);
      g.circle(cx + 5 * u, cy - 5 * u, 6 * u, c);
      g.poly([cx - 10 * u, cy + 1 * u, cx - 1 * u, cy - 9 * u, cx + 10 * u, cy - 1 * u, cx + 1 * u, cy + 9 * u], c);
      g.line(cx - 6 * u, cy - 4 * u, cx + 4 * u, cy + 6 * u, 'bg2', 2 * u);
      break;
    }
    case 'denki': {
      // 電球
      g.circle(cx, cy - 3 * u, 8 * u, c);
      g.rect(cx - 4 * u, cy + 4 * u, 8 * u, 4 * u, c);
      g.rect(cx - 3 * u, cy + 8 * u, 6 * u, 3 * u, c);
      break;
    }
    case 'nade': {
      // 手のひら
      g.rect(cx - 7 * u, cy - 1 * u, 14 * u, 11 * u, c);
      for (let i = 0; i < 4; i++) g.rect(cx - 7 * u + i * 4 * u, cy - 9 * u, 3 * u, 9 * u, c);
      g.rect(cx + 6 * u, cy + 1 * u, 4 * u, 5 * u, c);
      break;
    }
    case 'gift': {
      g.sprite(HEART, cx, cy, { scale: Math.max(1, Math.round(4 * u)), colors: { X: 'accent2' }, center: true });
      break;
    }
    default:
      break;
  }
}

/* ---- 文字 ------------------------------------------------------------ */

function drawHead(g: Painter, s: IppunIsshoState): void {
  // せいちょう・おとしより
  if (s.grow > 0) {
    g.text(s.growText, W / 2, HEAD_Y, { size: 15, align: 'center', color: 'accent' });
    if (s.growWhy) g.text(s.growWhy, W / 2, WHY_Y, { size: 9, align: 'center', color: 'dim' });
    // きらきら8粒（時間の関数）
    for (let i = 0; i < 8; i++) {
      const a = i * 0.79 + s.time * 2.2;
      const rr = 30 + Math.sin(s.time * 5 + i) * 10;
      g.alpha(Math.min(1, s.grow), () =>
        g.circle(CHAR_X + Math.cos(a) * rr, CHAR_Y + Math.sin(a) * rr * 0.8, 2.5, 'accent'),
      );
    }
    return;
  }
  // おわかれ。まず見送る
  if (s.stage === 'bye' && s.byeT < SINK_AT) {
    const word = s.byeT < 1 ? 'ばいばい' : 'ありがと';
    g.text(word, W / 2, HEAD_Y, { size: 15, align: 'center', color: 'ink' });
  }
  // 記念の文は、芽が出たあとに芽の上へ
  if (s.epShown > 0) drawEpitaph(g, s);
}

/**
 * 記念の文。flat な統計から draw で組み立てる（配列に持たない）。
 *
 * **たねになって芽が出たあと**（byeT 4.0〜）に、芽の上へ0.7秒おきに4行。
 * 生きているうちに出すと「本人の前で弔辞を読んでいる」ことになり、
 * 見送りの山が集計に潰される（初見者テスト 2026-08-22）。
 */
function drawEpitaph(g: Painter, s: IppunIsshoState): void {
  const lines: string[] = [];
  lines.push(`${s.name || 'まめ'}（${FORM_NAME[s.form]}）は、`);

  /* 2行目: 世話した回数を多い順に。短ければ、その一生にあったことを後ろに足す */
  const care: [string, number][] = [
    ['ごはん', s.fed],
    ['あそび', s.played],
    ['なでなで', s.petted],
    ['そうじ', s.cleaned],
    ['おくすり', s.cured],
    ['でんき', s.lit],
  ];
  const parts = care
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k} ${v}`);
  const extra: string[] = [];
  if (s.gift) extra.push('おくりもの');
  if (s.friend) extra.push('ともだち');
  if (s.wished) extra.push('ねがいごと');
  if (s.knew > 0) extra.push(`さきよみ ${s.knew}`);
  if (s.guessed > 0) extra.push(`よみあて ${s.guessed}`);
  let line2 = parts.join('・');
  for (const e of extra) {
    // 22文字を超えたら足さない（10px で 240px に収めるため）
    if (line2.length === 0 || line2.length + 1 + e.length > 22) continue;
    line2 += `・${e}`;
  }
  lines.push(line2 || 'ひとりで すごした');

  /* 3行目: 嘘にならないものを1つだけ。優先順 ひとり > ignored > かぜ > すきなもの */
  const favName = s.fav === 'gohan' ? 'ごはん' : s.fav === 'asobu' ? 'あそぶこと' : 'なでなで';
  const favCare = s.fav === 'gohan' ? s.fed : s.fav === 'asobu' ? s.played : s.petted;
  // 🔴 「いちばん すきだった」は、fav が**世話の中で実際に1位**のときだけ。
  //    なでなで15・あそび4 で「いちばん すきだったのは あそぶこと」と出て嘘に見えた
  const favTop = favCare >= FAV_KNOWN && favCare >= Math.max(s.fed, s.played, s.petted);
  if (s.answered === 0 && s.petted === 0) lines.push('ひとりでも げんきに いきた');
  else if (s.ignored >= 5) lines.push('ひとりの じかんが ながかった');
  else if (s.sick) lines.push('かぜも ひいたけど');
  else if (favTop) lines.push(`いちばん すきだったのは ${favName}`);
  // 気づいてもらえなかった側。「すきだった」と言い切らないので嘘にならない
  else lines.push(`ほんとうは ${favName}が すきだった`);

  /* 4行目: たねになる瞬間だけ */
  lines.push(
    `${s.longLife ? 'ながいきして ' : ''}${Math.floor(s.endAge)}さいで たねに なりました`,
  );

  for (let i = 0; i < Math.min(s.epShown, 4); i++) {
    g.text(lines[i], W / 2, EPI_Y + i * 20, { size: 10, align: 'center', color: 'ink' });
  }
}

function drawSay(g: Painter, s: IppunIsshoState): void {
  // ふだんのあくびは「ふぁ〜」を出す（state を持たずに時間の関数で出す）
  if (s.sayT <= 0 && idleYawn(s)) {
    g.text('ふぁ〜', SAY_X, SAY_Y, { size: 10, align: 'left', color: 'ink' });
    return;
  }
  if (s.sayT <= 0 || !s.say) return;
  // なまえ中はカード（y 112〜148）に触れるので、上段へ逃がす
  if (s.stage === 'name') {
    g.text(s.say, W / 2, HEAD_Y, { size: 12, align: 'center', color: 'ink' });
    return;
  }
  // 長いセリフは右端 232 を基準に右揃え。短いものは x=158 のまま（はみ出しゼロ）
  if (s.say.length > 6) {
    g.text(s.say, SAY_RIGHT, SAY_Y, { size: 10, align: 'right', color: 'ink' });
    return;
  }
  g.text(s.say, SAY_X, SAY_Y, { size: 10, align: 'left', color: 'ink' });
}

/* ---- ボタン ---------------------------------------------------------- */

function drawButtons(g: Painter, s: IppunIsshoState): void {
  const dimAll = s.stage === 'egg' || s.stage === 'name' || s.stage === 'bye' || s.sinkT >= 0;
  for (let i = 0; i < 5; i++) {
    const x = BTN_X0 + i * BTN_GAP;
    g.rect(x, BTN_Y, BTN_W, BTN_H, 'bg2');
    // ふきだしが出ているあいだ、その絵のボタンは枠を accent にしたままにする
    // （点線が消えたあと「押していいのか」が分からなくなる、と言われた）
    const asked = hintBtn(s) === i;
    const pointed = s.guideT > 0 && s.guideBtn === i;
    const pressed = s.pressT > 0 && s.pressBtn === i;
    const hot = asked || pointed || pressed;
    g.rectLine(x, BTN_Y, BTN_W, BTN_H, hot ? 'accent' : 'line', asked || pointed ? 2 : 1);
    const c: ColorKey = dimAll ? 'dim' : 'ink';
    drawIcon(g, BTN_KINDS[i], x + BTN_W / 2, BTN_Y + 24, 24, c);
    // 🔴 ラベルは常に dim。`line` で文字を書くと薄すぎて出ていないのと同じになる
    g.text(BTN_LABEL[i], x + BTN_W / 2, BTN_Y + 44, { size: 9, align: 'center', color: 'dim' });
  }
}

function drawCards(g: Painter, s: IppunIsshoState): void {
  const sh = s.cardShake > 0 ? Math.sin(s.cardShake * 50) * 4 : 0;
  g.text('なまえを つけてね', W / 2, 84, { size: 12, align: 'center', color: 'ink' });
  const ids = [s.n0, s.n1, s.n2];
  for (let i = 0; i < 3; i++) {
    const x = CARD_X[i] + sh;
    g.rect(x, CARD_Y, CARD_W, CARD_H, 'bg2');
    g.rectLine(x, CARD_Y, CARD_W, CARD_H, 'accent');
    g.text(NAMES[ids[i]], x + CARD_W / 2, CARD_Y + CARD_H / 2, {
      size: 16,
      align: 'center',
      baseline: 'middle',
      color: 'ink',
    });
  }
}

/**
 * 最下段の手引き。**消さない**（設計の「最初の10秒だけ」から変えた）。
 * 初見者テストで、なまえに迷った人は最初のふきだしを見ないまま手引きが消えていた。
 * 最初の30秒だけ2文を4秒おきに入れ替え、以後は操作の一行に固定する。dim・9px なので邪魔にならない。
 */
function drawHelp(g: Painter, s: IppunIsshoState): void {
  // おわかれに入ったら消す。世話が終わっているのに「ボタンで おせわ」が出ていると案内が嘘になる
  if (s.stage === 'bye') return;
  const alt = s.time < HELP_SWAP_UNTIL && Math.floor(s.time / HELP_SWAP) % 2 === 1;
  const text = alt ? 'みぎうえの め は なかよし' : 'ボタンで おせわ・キャラを タップで なでなで';
  g.text(text, W / 2, 304, { size: 9, align: 'center', color: 'dim' });
}
