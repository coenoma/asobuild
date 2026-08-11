/**
 * たまごポン
 *
 * 押している間ゲージが伸びる。離した位置が「あげるえさの量」。
 * ちょうどいい量は、そのときのおなかの空き具合で変わる（減っていれば多め、満ちていれば少なめ）。
 *
 * ・手前で離す → たりない（おなかが減ったままで次が忙しくなる）
 * ・伸ばしすぎ → あげすぎ（げんきが削れる）
 * ・端まで行く → こぼす（大失敗＝押しっぱなしを罰する）
 *
 * 「ゲージを見て、いいところで離す」だけなので、何をすべきかが画面から分かる。
 * ピッタリ入った瞬間が気持ちよく、外したときも理由が自分で分かる。
 * 作り直した経緯は docs/plans/002-tamago-remake/design.md。
 */

import { defineGame, VIRTUAL_W, type BaseState } from '@/arcade/types';
import type { Painter } from '@/arcade/painter';
import type { Rng } from '@/arcade/rng';
import {
  addPop,
  addShake,
  createFeel,
  createTumble,
  feelTick,
  hitStop,
  launchTumble,
  popScale,
  shakeOffset,
  stepTumble,
  type FeelState,
  type Tumble,
} from '@/arcade/feel';
import { meta } from './meta';

/** 収録中に触る数値。npm run tune が動かせるよう入れ物にしてある */
const TUNE = {
  /** ゲージが伸びる速さ（毎秒）。上げるほど忙しい */
  gaugeSpeed: 0.92,
  /** ちょうどいいゾーンの広さ。狭いほど難しい */
  zoneWidth: 0.15,
  /** おなかの減り（毎秒） */
  haraDrain: 10.5,
  /**
   * 時間とともにゲージが速くなる度合い。
   * これが無いと、上手い人が永遠に失敗せず終わらない（ゲートで実測済み）。
   * 速くなるとフレームあたりの移動量がドンピシャ幅を超え、やがてゾーンも越える。
   */
  speedRamp: 0.045,
};

const GAUGE_X = 26;
const GAUGE_W = VIRTUAL_W - GAUGE_X * 2;
const GAUGE_Y = 250;
const GAUGE_H = 22;

/** ゾーンの中心にどれだけ近ければ「ドンピシャ」か */
const PERFECT = 0.028;
/** 1回ごとのゲージ速度の揺れ。同じ手癖で押せないようにする */
const SPEED_JITTER = 0.34;
const GENKI_MAX = 100;

type Special = 'none' | 'fast' | 'narrow' | 'feast';

export interface TamagoState extends BaseState, FeelState {
  /** おなか 0..100。ちょうどいい量はここから決まる */
  hara: number;
  /** げんき。0で終わり */
  genki: number;
  /** ゲージを伸ばしている最中か */
  charging: boolean;
  /** ゲージの現在値 0..1 */
  gauge: number;
  /** 今回のゲージ速度 */
  gaugeSpeed: number;
  /** ちょうどいいゾーンの中心と幅 */
  zoneCenter: number;
  zoneWidth: number;
  /** 今回の特別なお題 */
  special: Special;
  /** 次にあげられるまでの待ち */
  cooldown: number;
  combo: number;
  judgeText: string;
  judgeGood: boolean;
  judgeTimer: number;
  /** 直前に離した位置（どれくらい外したかを見せるために残す） */
  lastGauge: number;
  lastShown: number;
  eat: number;
  deathReason: string;
  tumble: Tumble;
}

/** おなかの空き具合から「ちょうどいい量」を決める。減っているほど多めが正解 */
function idealAmount(hara: number): number {
  return Math.max(0.16, Math.min(0.86, (100 - hara) / 100));
}

/** 次の一口のお題を決める */
function nextBite(s: TamagoState, rng: Rng): void {
  s.gauge = 0;
  s.charging = false;
  s.zoneCenter = idealAmount(s.hara);
  s.special = 'none';
  s.zoneWidth = TUNE.zoneWidth;
  s.gaugeSpeed =
    TUNE.gaugeSpeed * (1 + s.time * TUNE.speedRamp) * rng.range(1 - SPEED_JITTER, 1 + SPEED_JITTER);

  // だいこうぶつは、めったに来ないが来ると大きい。
  // これが「今日は乗ってる」を作る（よく出る小さいボーナスだと平均化されて何も起きない）
  if (rng.chance(0.045)) {
    s.special = 'feast';
    s.zoneWidth *= 1.5;
  } else {
    // 時間が経つほど、やりにくいお題が出やすくなる（＝だんだん難しくなる）
    const chaos = Math.min(0.55, s.time * 0.008);
    if (rng.chance(chaos)) {
      if (rng.chance(0.55)) {
        s.special = 'fast';
        s.gaugeSpeed *= 1.7;
      } else {
        s.special = 'narrow';
        s.zoneWidth *= 0.55;
      }
    }
  }
  // ゾーンが端に寄りすぎないようにする（届かない／避けようがない、をなくす）
  s.zoneCenter = Math.max(s.zoneWidth / 2 + 0.05, Math.min(0.92, s.zoneCenter));
}

export default defineGame<TamagoState>({
  meta,

  init(rng) {
    const s: TamagoState = {
      ...createFeel(),
      score: 0,
      over: false,
      time: 0,
      hara: 45,
      genki: GENKI_MAX,
      charging: false,
      gauge: 0,
      gaugeSpeed: TUNE.gaugeSpeed,
      zoneCenter: 0.5,
      zoneWidth: TUNE.zoneWidth,
      special: 'none',
      cooldown: 0.35,
      combo: 0,
      judgeText: '',
      judgeGood: true,
      judgeTimer: 0,
      lastGauge: -1,
      lastShown: 0,
      eat: 0,
      deathReason: '',
      tumble: createTumble(),
    };
    nextBite(s, rng);
    return s;
  },

  step(s, input, dt, rng) {
    const n: TamagoState = { ...s };

    // 力尽きた後も呼ばれる。ここは演出だけ
    if (s.over) {
      n.tumble = { ...s.tumble };
      stepTumble(n.tumble, dt);
      n.judgeTimer = Math.max(0, s.judgeTimer - dt);
      return n;
    }

    if (!feelTick(n, input, dt)) return n;

    n.judgeTimer = Math.max(0, s.judgeTimer - dt);
    n.lastShown = Math.max(0, s.lastShown - dt);
    n.eat = Math.max(0, s.eat - dt * 3);
    n.cooldown = Math.max(0, s.cooldown - dt);

    // おなかは放っておくと減る。空になるとげんきが削れる
    n.hara = Math.max(0, s.hara - TUNE.haraDrain * dt);
    if (n.hara <= 0) {
      n.genki = Math.max(0, n.genki - 30 * dt);
      n.deathReason = 'おなかをすかせたまま';
    }

    const judge = (text: string, good: boolean) => {
      n.judgeText = text;
      n.judgeGood = good;
      n.judgeTimer = 0.75;
    };

    /** 離したときの判定 */
    const release = (amount: number, spilled: boolean) => {
      n.charging = false;
      n.lastGauge = amount;
      n.lastShown = 0.8;
      n.cooldown = 0.32;
      n.eat = 1;

      if (spilled) {
        n.genki -= 16;
        n.combo = 0;
        addShake(n, 1);
        n.deathReason = 'こぼしすぎた';
        judge('こぼした！', false);
      } else {
        const diff = Math.abs(amount - n.zoneCenter);
        const half = n.zoneWidth / 2;
        n.hara = Math.min(100, n.hara + amount * 78);
        if (diff <= PERFECT) {
          n.combo += 1;
          const mult = 1 + Math.min(8, Math.floor(n.combo / 3));
          n.score += (n.special === 'feast' ? 140 : 12) * mult;
          n.genki = Math.min(GENKI_MAX, n.genki + 4);
          addPop(n);
          hitStop(n, 0.06);
          judge('ドンピシャ！', true);
        } else if (diff <= half) {
          n.combo += 1;
          const mult = 1 + Math.min(8, Math.floor(n.combo / 3));
          n.score += (n.special === 'feast' ? 60 : 6) * mult;
          n.genki = Math.min(GENKI_MAX, n.genki + 1);
          addPop(n);
          judge('ちょうどいい', true);
        } else if (amount < n.zoneCenter) {
          n.combo = 0;
          n.genki -= 6;
          n.deathReason = 'たりない が続いた';
          judge('たりない', false);
        } else {
          n.combo = 0;
          n.genki -= 9;
          addShake(n, 0.5);
          n.deathReason = 'あげすぎた';
          judge('あげすぎ', false);
        }
      }

      if (n.genki > 0) nextBite(n, rng);
    };

    // ゲージ。押している間だけ伸びる
    if (n.cooldown <= 0) {
      if (input.hold) {
        if (!n.charging) {
          n.charging = true;
          n.gauge = 0;
        } else {
          n.gauge = s.gauge + n.gaugeSpeed * dt;
          // 端まで行ったら、その時点でこぼす（押しっぱなしを罰する）
          if (n.gauge >= 1) {
            n.gauge = 1;
            release(1, true);
          }
        }
      } else if (s.charging) {
        release(s.gauge, false);
      }
    }

    if (n.genki <= 0) {
      n.genki = 0;
      n.over = true;
      n.tumble = { ...s.tumble };
      launchTumble(n.tumble, VIRTUAL_W / 2, 150, { vx: -34, vy: -165, vrot: 5.5 });
      addShake(n, 1);
    }

    return n;
  },

  draw(g: Painter, s) {
    const [sx, sy] = shakeOffset(s, s.time);

    // 上のメーター
    g.text('おなか', 8, 24, { size: 9, color: 'dim' });
    g.rect(46, 25, 70, 7, 'bg2');
    g.rect(46, 25, (s.hara / 100) * 70, 7, s.hara < 22 ? 'bad' : 'good');
    g.rectLine(46, 25, 70, 7, 'line', 1);

    g.text('げんき', 130, 24, { size: 9, color: 'dim' });
    g.rect(168, 25, 64, 7, 'bg2');
    g.rect(168, 25, (s.genki / 100) * 64, 7, s.genki < 35 ? 'accent' : 'cool');
    g.rectLine(168, 25, 64, 7, 'line', 1);

    if (s.combo >= 2) {
      g.text(`${s.combo}れんぞく`, VIRTUAL_W - 8, 40, { size: 10, align: 'right', color: 'accent' });
    }

    // 本体
    const cx = VIRTUAL_W / 2 + sx;
    const cy = 140 + Math.sin(s.time * 2.2) * 3 + sy;
    const r = 30 * (1 + s.eat * 0.12) * popScale(s, 0.1);
    if (s.tumble.on) {
      g.at(s.tumble.x, s.tumble.y, s.tumble.rot, () => {
        g.circle(0, 0, 30, 'dim');
        g.line(-9, -6, -3, -2, 'bg', 3);
        g.line(3, -6, 9, -2, 'bg', 3);
      });
    } else {
      g.circle(cx, cy + 3, r, 'ink');
      const hungry = s.hara < 25;
      if (hungry) {
        g.rect(cx - 14, cy - 6, 9, 3, 'bg');
        g.rect(cx + 5, cy - 6, 9, 3, 'bg');
      } else {
        g.circle(cx - 10, cy - 5, 4, 'bg');
        g.circle(cx + 10, cy - 5, 4, 'bg');
      }
      if (s.eat > 0.2) {
        g.circle(cx, cy + 12, 5 + s.eat * 5, 'bg');
      } else if (s.combo >= 2) {
        g.rect(cx - 7, cy + 11, 14, 3, 'bg');
        g.rect(cx - 9, cy + 8, 2, 3, 'bg');
        g.rect(cx + 7, cy + 8, 2, 3, 'bg');
      } else {
        g.rect(cx - 5, cy + 12, 10, 3, 'bg');
      }
    }

    // 判定表示
    if (s.judgeTimer > 0) {
      g.text(s.judgeText, VIRTUAL_W / 2, 196, {
        size: Math.round(16 * popScale(s, 0.35)),
        align: 'center',
        color: s.judgeGood ? 'good' : 'bad',
      });
    }

    // お題
    const label =
      s.special === 'fast'
        ? 'はやぐい！'
        : s.special === 'narrow'
          ? 'こばら（せまい）'
          : s.special === 'feast'
            ? 'だいこうぶつ！'
            : 'ちょうどいい量で はなす';
    g.text(label, VIRTUAL_W / 2, 226, {
      size: 10,
      align: 'center',
      color: s.special === 'none' ? 'dim' : 'accent',
    });

    // ゲージ
    g.rect(GAUGE_X, GAUGE_Y, GAUGE_W, GAUGE_H, 'bg2');
    const zl = GAUGE_X + (s.zoneCenter - s.zoneWidth / 2) * GAUGE_W;
    const zw = s.zoneWidth * GAUGE_W;
    g.rect(zl, GAUGE_Y, zw, GAUGE_H, s.special === 'feast' ? 'accent' : 'good');
    // 中心線（ここがドンピシャ）
    const zc = GAUGE_X + s.zoneCenter * GAUGE_W;
    g.rect(zc - 1, GAUGE_Y - 4, 2, GAUGE_H + 8, 'ink');
    // 伸びているぶん
    if (s.charging) {
      g.alpha(0.55, () => g.rect(GAUGE_X, GAUGE_Y, s.gauge * GAUGE_W, GAUGE_H, 'cool'));
      const hx = GAUGE_X + s.gauge * GAUGE_W;
      g.rect(hx - 2, GAUGE_Y - 6, 4, GAUGE_H + 12, 'ink');
    }
    // 直前に離した位置を少し残す（どれくらい外したかが分かる）
    if (!s.charging && s.lastShown > 0 && s.lastGauge >= 0) {
      const lx = GAUGE_X + s.lastGauge * GAUGE_W;
      g.alpha(Math.min(1, s.lastShown * 1.4), () =>
        g.rect(lx - 1, GAUGE_Y - 6, 3, GAUGE_H + 12, 'accent2'),
      );
    }
    g.rectLine(GAUGE_X, GAUGE_Y, GAUGE_W, GAUGE_H, 'line', 1);

    g.text(
      s.cooldown > 0 ? '…' : s.charging ? 'はなす！' : 'おしっぱなしで のばす',
      VIRTUAL_W / 2,
      GAUGE_Y + GAUGE_H + 10,
      { size: 10, align: 'center', color: s.charging ? 'accent' : 'dim' },
    );
  },

  /**
   * 上手い人の再現。ゲージが中心を越える直前に離す。
   * 「10行で書ける」＝ルールが一言で説明できている証拠でもある。
   */
  bot(s) {
    if (s.cooldown > 0) return { press: false };
    if (!s.charging) return { press: true };
    // 次のフレームで中心を越えるなら、いま離す
    return { press: s.gauge + s.gaugeSpeed / 60 < s.zoneCenter };
  },

  reason(s) {
    return s.deathReason || 'うまく育たなかった';
  },

  tunables: {
    gaugeSpeed: {
      label: 'ゲージの速さ',
      min: 0.5,
      max: 2.2,
      get: () => TUNE.gaugeSpeed,
      set: (v) => {
        TUNE.gaugeSpeed = v;
      },
    },
    zoneWidth: {
      label: 'ちょうどいい幅',
      min: 0.06,
      max: 0.3,
      get: () => TUNE.zoneWidth,
      set: (v) => {
        TUNE.zoneWidth = v;
      },
    },
    haraDrain: {
      label: 'おなかの減り',
      min: 3,
      max: 16,
      get: () => TUNE.haraDrain,
      set: (v) => {
        TUNE.haraDrain = v;
      },
    },
  },
});
