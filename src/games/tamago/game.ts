/**
 * たまごポン
 *
 * たまごから出てきたやつを、100秒のあいだ世話して育てる。
 * タップでえさ、長押しでなでる。減っていくのは「はら」と「きげん」で、
 * どちらかが尽きると「げんき」が削れ、げんきが尽きたら終わり。
 *
 * 育ての良さ＝満腹すぎず空腹すぎない状態を保てた時間。
 * だから「とにかく食わせる」では点が伸びない。ここが判断の置きどころ。
 *
 * 反射ゲームと違い、**放置しても即座には壊れない**のがこの型の条件
 * （docs/design/genre-map.md ③）。見ていない時間があるのが前提のゲーム。
 */

import { defineGame, VIRTUAL_H, VIRTUAL_W, type BaseState } from '@/arcade/types';
import type { Painter } from '@/arcade/painter';
import {
  addPop,
  addShake,
  createFeel,
  createTumble,
  feelTick,
  launchTumble,
  popScale,
  shakeOffset,
  stepTumble,
  type FeelState,
  type Tumble,
} from '@/arcade/feel';
import { meta } from './meta';

/** 育てきるまでの時間 */
const GOAL_TIME = 100;
/**
 * これより短く押したら「えさ」、長く押したら「なでる」。
 * ここを分けないと、なでようとするたびに えさ が入ってしまう
 * （実際に最初そうなっていて、ボットが100秒で1064回も給餌していた）。
 */
const TAP_MAX = 0.25;
/** はらの減り（毎秒）。放置に耐える時間を決めている */
const HARA_DRAIN = 2.25;
/** だいこうぶつを食べさせられたときの育ち */
const FEAST_SCORE = 175;
/**
 * だいこうぶつは、これより空腹でないと食べてくれない。
 * つまり「そなえて腹を空かせておく」という判断が生まれ、
 * ふだんの良い腹具合（HARA_BEST）との間で悩むことになる。
 */
const FEAST_HUNGRY = 55;
/** きげんの減り（毎秒） */
const KIGEN_DRAIN = 2;
/** どちらかが尽きているときに、げんきが削れる速さ */
const GENKI_DRAIN = 5.5;
/** 調子がよいときにげんきが戻る速さ */
const GENKI_HEAL = 2.4;
/** えさ1回の回復量 */
const FEED = 24;
/** えさの間隔（連打で満腹にできないようにする） */
const FEED_CT = 0.7;
/** なでている間のきげん回復（毎秒） */
const PET_HEAL = 16;
/** いちばん機嫌よく育つ「はら」の値。ここから離れるほど育ちが悪い */
const HARA_BEST = 62;
/** 満腹すぎるライン。超えると気持ち悪がる */
const HARA_FULL = 88;

export interface TamagoState extends BaseState, FeelState {
  hara: number;
  kigen: number;
  genki: number;
  /** 見た目の成長段階 0..3 */
  age: number;
  feedCt: number;
  /** いま押し続けている長さ。えさ と なでる を分けるために測る */
  holdTime: number;
  /** 1秒ごとに育ちを加算するためのタイマー */
  growTimer: number;
  /** ごきげんななめが来るまで */
  moodTimer: number;
  /** ごほうびタイム（育ちが2倍）の残り */
  bonus: number;
  /** ごほうびが来るまで */
  bonusTimer: number;
  /** だいこうぶつが出ている残り時間。ここで食べさせられるかで結果が変わる */
  feast: number;
  feastTimer: number;
  feastGot: number;
  petting: boolean;
  eatAnim: number;
  message: string;
  messageTimer: number;
  deathReason: string;
  tumble: Tumble;
}

/** いまの世話の良さ 0..1。満腹すぎても空腹すぎても下がる */
function careQuality(s: { hara: number; kigen: number }): number {
  const haraQ = Math.max(0, 1 - Math.abs(s.hara - HARA_BEST) / HARA_BEST);
  const kigenQ = Math.max(0, s.kigen / 100);
  return haraQ * kigenQ;
}

export default defineGame<TamagoState>({
  meta,

  init() {
    return {
      ...createFeel(),
      score: 0,
      over: false,
      time: 0,
      hara: 85,
      kigen: 88,
      genki: 100,
      age: 0,
      feedCt: 0,
      holdTime: 0,
      growTimer: 1,
      moodTimer: 14,
      bonus: 0,
      bonusTimer: 22,
      feast: 0,
      feastTimer: 16,
      feastGot: 0,
      petting: false,
      eatAnim: 0,
      message: '',
      messageTimer: 0,
      deathReason: '',
      tumble: createTumble(),
    };
  },

  step(s, input, dt, rng) {
    const n: TamagoState = { ...s };

    // 終わったあとも呼ばれる。ここは演出だけ進める
    if (s.over) {
      n.tumble = { ...s.tumble };
      stepTumble(n.tumble, dt);
      n.messageTimer = Math.max(0, s.messageTimer - dt);
      return n;
    }

    if (!feelTick(n, input, dt)) return n;

    const say = (text: string) => {
      n.message = text;
      n.messageTimer = 1.1;
    };

    n.feedCt = Math.max(0, s.feedCt - dt);
    n.eatAnim = Math.max(0, s.eatAnim - dt * 3);
    n.messageTimer = Math.max(0, s.messageTimer - dt);
    n.bonus = Math.max(0, s.bonus - dt);
    n.feast = Math.max(0, s.feast - dt);
    n.feastGot = Math.max(0, s.feastGot - dt * 2);
    n.age = Math.min(3, Math.floor((s.time / GOAL_TIME) * 4));

    // だいこうぶつ。出る回数も、そのとき腹に余裕があるかも運なので、
    // 同じ育て方でも結果が大きくぶれる（＝上振れが生まれる）
    n.feastTimer = s.feastTimer - dt;
    if (n.feastTimer <= 0) {
      n.feastTimer = rng.range(20, 38);
      n.feast = 5;
      say('だいこうぶつ！');
    }

    // 世話。押している長さで えさ と なでる を分ける
    n.holdTime = input.hold ? s.holdTime + dt : 0;
    const shortTap = input.release && s.holdTime > 0 && s.holdTime < TAP_MAX;
    if (shortTap && n.feedCt <= 0) {
      const wasHungry = s.hara < FEAST_HUNGRY;
      n.feedCt = FEED_CT;
      n.hara = Math.min(100, s.hara + FEED);
      n.eatAnim = 1;
      addPop(n);
      if (n.feast > 0 && wasHungry) {
        n.score += FEAST_SCORE;
        n.feast = 0;
        n.feastGot = 1;
        say('だいこうぶつ ゲット！');
      } else if (n.feast > 0) {
        say('おなかいっぱいで たべない');
      } else {
        say(n.hara > HARA_FULL ? 'もう おなかいっぱい' : 'もぐもぐ');
      }
    }
    n.petting = input.hold && n.holdTime >= TAP_MAX;
    if (n.petting) {
      n.kigen = Math.min(100, s.kigen + PET_HEAL * dt);
    }

    // 時間で減る
    n.hara = Math.max(0, n.hara - HARA_DRAIN * dt);
    n.kigen = Math.max(0, n.kigen - KIGEN_DRAIN * dt);
    // 食べさせすぎは機嫌を落とす（とにかく食わせる、を封じている）
    if (n.hara > HARA_FULL) n.kigen = Math.max(0, n.kigen - 7 * dt);

    // ごきげんななめ。いつ来るかが運なので、同じ育て方でも結果がぶれる
    n.moodTimer = s.moodTimer - dt;
    if (n.moodTimer <= 0) {
      n.moodTimer = rng.range(11, 22);
      n.kigen = Math.max(0, n.kigen - rng.range(14, 26));
      addShake(n, 0.5);
      say('ごきげんななめ');
    }

    // ごほうびタイム。ここを取りこぼさないのが上手い人
    n.bonusTimer = s.bonusTimer - dt;
    if (n.bonusTimer <= 0) {
      n.bonusTimer = rng.range(20, 34);
      n.bonus = 8;
      say('ごきげんタイム！');
    }

    // げんきの増減
    const bad = n.hara <= 0 || n.kigen <= 0;
    if (bad) {
      n.genki = Math.max(0, n.genki - GENKI_DRAIN * dt);
    } else if (careQuality(n) > 0.5) {
      n.genki = Math.min(100, n.genki + GENKI_HEAL * dt);
    }

    // 育ち（1秒ごとに整数で加算する。毎フレーム増やすと何が起きたか目で追えない）
    n.growTimer = s.growTimer - dt;
    if (n.growTimer <= 0) {
      n.growTimer += 1;
      // 日々の世話ぶんは控えめにしてある。だいこうぶつを取れたかどうかで
      // 結果が変わるようにするため（毎回同じ点で終わると3回で飽きる）
      const gain = Math.round(careQuality(n) * 6 * (n.bonus > 0 ? 2 : 1));
      if (gain > 0) n.score += gain;
    }

    // 終わり方は2つ。育てきるか、力尽きるか
    if (n.genki <= 0) {
      n.over = true;
      n.deathReason =
        n.hara <= 0 ? 'おなかがすいて弱った' : 'さみしくて弱った';
      n.tumble = { ...s.tumble };
      launchTumble(n.tumble, VIRTUAL_W / 2, 172, { vx: -30, vy: -150, vrot: 5 });
      addShake(n, 1);
    } else if (s.time >= GOAL_TIME) {
      n.over = true;
      n.cleared = true;
      n.deathReason = '';
      say('そだてきった！');
    }

    return n;
  },

  draw(g: Painter, s) {
    const [sx, sy] = shakeOffset(s, s.time);

    // メーター
    const bar = (y: number, label: string, v: number, color: 'good' | 'accent' | 'cool') => {
      g.text(label, 8, y, { size: 9, color: 'dim' });
      g.rect(40, y + 1, 62, 7, 'bg2');
      g.rect(40, y + 1, Math.max(0, Math.min(62, (v / 100) * 62)), 7, color);
      g.rectLine(40, y + 1, 62, 7, 'line', 1);
    };
    bar(24, 'はら', Math.min(100, s.hara), s.hara > 88 ? 'accent' : 'good');
    bar(36, 'きげん', s.kigen, 'cool');
    bar(48, 'げんき', s.genki, s.genki < 35 ? 'accent' : 'good');

    if (s.feast > 0) {
      g.text('だいこうぶつ！', VIRTUAL_W - 8, 24, { size: 10, align: 'right', color: 'accent' });
      g.circle(VIRTUAL_W - 20, 68, 7 + Math.sin(s.time * 9) * 1.5, 'accent');
      g.text('たべさせて', VIRTUAL_W - 8, 78, { size: 8, align: 'right', color: 'accent' });
    } else if (s.bonus > 0) {
      g.text('ごきげんタイム', VIRTUAL_W - 8, 24, { size: 9, align: 'right', color: 'accent2' });
    }
    if (s.feastGot > 0) {
      g.text(`+${FEAST_SCORE}`, VIRTUAL_W / 2, 128, {
        size: Math.round(14 * popScale(s, 0.5)),
        align: 'center',
        color: 'accent',
      });
    }
    g.text(`のこり ${Math.max(0, Math.ceil(100 - s.time))}秒`, VIRTUAL_W - 8, 48, {
      size: 9,
      align: 'right',
      color: 'dim',
    });

    // 地面
    g.rect(0, 232, VIRTUAL_W, VIRTUAL_H - 232, 'bg2');
    g.line(0, 232, VIRTUAL_W, 232, 'line');

    // 本体
    const cx = VIRTUAL_W / 2 + sx;
    const bob = Math.sin(s.time * 2.4) * (s.petting ? 3.5 : 1.6);
    const cy = 172 + bob + sy;
    const r = 15 + s.age * 3;
    const scale = popScale(s, 0.18);
    const q = careQuality(s);

    if (s.tumble.on) {
      // 力尽きたところ。ころんと転がって落ちていく
      g.at(s.tumble.x, s.tumble.y, s.tumble.rot, () => {
        g.circle(0, 0, r, 'dim');
        g.line(-6, -4, -2, -1, 'bg', 2);
        g.line(2, -4, 6, -1, 'bg', 2);
      });
    } else {
      if (s.age === 0) {
        // まだ卵
        g.circle(cx, cy + 4, r * scale, 'ink');
        g.circle(cx, cy - 2, r * 0.86 * scale, 'ink');
        for (let i = 0; i < 3; i++) {
          g.rect(cx - 10 + i * 8, cy + 2, 4, 2, 'bg2');
        }
      } else {
        g.circle(cx, cy, r * scale, 'ink');
        // 目。調子が悪いと細くなる
        const eyeY = cy - 4;
        if (q > 0.35) {
          g.circle(cx - 6, eyeY, 2, 'bg');
          g.circle(cx + 6, eyeY, 2, 'bg');
        } else {
          g.rect(cx - 8, eyeY, 5, 2, 'bg');
          g.rect(cx + 3, eyeY, 5, 2, 'bg');
        }
        // 口
        if (s.eatAnim > 0) {
          g.circle(cx, cy + 5, 3 + s.eatAnim * 2, 'bg');
        } else if (q > 0.6) {
          g.rect(cx - 4, cy + 5, 8, 2, 'bg');
          g.rect(cx - 5, cy + 4, 1, 2, 'bg');
          g.rect(cx + 4, cy + 4, 1, 2, 'bg');
        } else {
          g.rect(cx - 3, cy + 6, 6, 2, 'bg');
        }
        if (s.age >= 2) {
          g.rect(cx - r - 3, cy + 2, 4, 2, 'ink');
          g.rect(cx + r - 1, cy + 2, 4, 2, 'ink');
        }
        if (s.age >= 3) {
          g.poly([cx - 5, cy - r, cx, cy - r - 7, cx + 5, cy - r], 'accent');
        }
      }
    }

    // なでている印
    if (s.petting && !s.tumble.on) {
      g.text('なでなで', cx, cy - r - 20, { size: 10, align: 'center', color: 'cool' });
    }

    // ひとこと
    if (s.messageTimer > 0) {
      g.text(s.message, VIRTUAL_W / 2, 248, { size: 11, align: 'center', color: 'ink' });
    } else {
      const hint = s.hara < 25 ? 'おなかがすいたみたい' : s.kigen < 25 ? 'かまってほしそう' : '';
      if (hint) g.text(hint, VIRTUAL_W / 2, 248, { size: 10, align: 'center', color: 'accent2' });
    }

    // 操作の目安
    g.text('タップ=えさ　長押し=なでる', VIRTUAL_W / 2, VIRTUAL_H - 22, {
      size: 9,
      align: 'center',
      color: 'dim',
    });
  },

  /**
   * 世話をする人の再現。
   * 「腹が減ったら食わせる、機嫌が落ちたらなでる」だけだが、
   * 満腹にしすぎない判断が入るので、放置ボットとは大きく差がつく。
   */
  bot(s) {
    if (s.feast > 0) {
      // だいこうぶつが出ている間は、空腹になるのを待ってから食べさせる。
      // 間に合うかどうかは、出た瞬間の腹具合しだい＝運
      if (s.hara >= FEAST_HUNGRY) return { press: false };
      if (s.feedCt <= 0) return { press: s.holdTime < 0.08 };
    }
    const wantFeed = s.feedCt <= 0 && s.hara < HARA_BEST - 8 && s.hara < HARA_FULL - FEED;
    // えさ は「短く押して離す」。押し始めてすぐ離すと短いタップになる
    if (wantFeed) return { press: s.holdTime < 0.08 };
    if (s.kigen < 74) return { press: true };
    return { press: false };
  },

  reason(s) {
    if (s.cleared) return '';
    return s.deathReason || 'うまく育たなかった';
  },
});
