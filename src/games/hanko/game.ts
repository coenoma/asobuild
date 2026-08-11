/**
 * ハンコ課長
 *
 * 流れてくる書類がワクに来た瞬間にハンコを押す。ただし赤い「差戻」は押してはいけない。
 * ・押す/押さないの判断に代償がある（カラ振りするとハンコが戻るまで押せない）
 * ・時間とともに書類の間隔が詰まり、いつか必ず捌ききれなくなる
 * この2つが「連打では勝てない」「上手くてもいつか終わる」を作っている。
 */

import { defineGame, VIRTUAL_H, VIRTUAL_W, type BaseState } from '@/arcade/types';
import type { Painter } from '@/arcade/painter';
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

/**
 * 収録中に触ることになる数値。`npm run tune` がここを動かして当たりを探せるよう、
 * 定数ではなく書き換えられる入れ物にしてある（通常のプレイでは変わらない）。
 */
const TUNE = {
  /** 書類の間隔の初期値。小さいほど最初から忙しい */
  spawnBase: 1.2,
  /** 速度の上がり方（毎秒）。大きいほど早く難しくなる */
  speedGain: 3.5,
};

/** 判定ワクの中心 Y */
const ZONE_Y = 214;
/** ドンピシャ／ナイス／セーフ の判定幅 */
const WIN_PERFECT = 5;
const WIN_GOOD = 14;
const WIN_OK = 26;
/** 成功したときにハンコが戻るまで */
const CT_HIT = 0.12;
/** カラ振り・誤爆したときにハンコが戻るまで（ここが連打の抑止になる） */
const CT_MISS = 0.34;
const LIVES = 3;
const DOC_W = 88;
const DOC_H = 38;

interface Doc {
  id: number;
  /** 書類の中心 Y */
  y: number;
  /** 差戻（押してはいけない書類） */
  bad: boolean;
  /** 特急便（速く流れるが得点が大きい） */
  express: boolean;
  /** 判定が済んだか */
  done: boolean;
  /** ハンコが押された演出の残り時間 */
  stamped: number;
}

/** 特急便の速度倍率。速いぶん判定が狭く、取れるかどうかで点差がつく */
const EXPRESS_SPEED = 1.7;

export interface HankoState extends BaseState, FeelState {
  docs: Doc[];
  nextId: number;
  lives: number;
  combo: number;
  bestCombo: number;
  speed: number;
  spawnTimer: number;
  cooldown: number;
  stampAnim: number;
  judgeText: string;
  judgeGood: boolean;
  judgeTimer: number;
  deathReason: string;
  /** クビになった瞬間に飛んでいくハンコ */
  tumble: Tumble;
}

/** 押したときにどの書類が選ばれるか。プレイヤーとボットで同じ規則を使う */
function pickTarget(docs: Doc[]): Doc | null {
  let best: Doc | null = null;
  let bestDist = Infinity;
  for (const d of docs) {
    if (d.done) continue;
    const dist = Math.abs(d.y - ZONE_Y);
    if (dist <= WIN_OK && dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best;
}

/** 経過時間から現在の書類の間隔。50秒あたりで成功後の硬直より短くなり、破綻が始まる */
function spawnInterval(time: number): number {
  return Math.max(0.1, TUNE.spawnBase - time * 0.022);
}

/** 差戻の出やすさ。開始8秒は出さない（最初の成功体験を邪魔しない） */
function badRate(time: number): number {
  return Math.min(0.32, Math.max(0, (time - 8) * 0.012));
}

/** 特急便の出やすさ。運で山が来る幅を作るため、一定確率で出し続ける */
function expressRate(time: number): number {
  return time < 4 ? 0 : 0.14;
}

export default defineGame<HankoState>({
  meta,

  init() {
    return {
      ...createFeel(),
      score: 0,
      over: false,
      time: 0,
      docs: [],
      nextId: 1,
      lives: LIVES,
      combo: 0,
      bestCombo: 0,
      speed: 50,
      spawnTimer: 0.55,
      cooldown: 0,
      stampAnim: 0,
      judgeText: '',
      judgeGood: true,
      judgeTimer: 0,
      deathReason: '',
      tumble: createTumble(),
    };
  },

  step(s, input, dt, rng) {
    const n: HankoState = { ...s };

    // やられた後も呼ばれる。ここは演出だけを進める見せ場
    if (s.over) {
      n.tumble = { ...s.tumble };
      stepTumble(n.tumble, dt);
      n.docs = s.docs.map((d) => ({ ...d, y: d.y + 30 * dt }));
      n.judgeTimer = Math.max(0, s.judgeTimer - dt);
      return n;
    }

    // 当たった瞬間の「止め」の最中は世界を進めない（手応えを作る）
    if (!feelTick(n, input, dt)) return n;

    n.speed = 50 + s.time * TUNE.speedGain;
    n.cooldown = Math.max(0, s.cooldown - dt);
    n.stampAnim = Math.max(0, s.stampAnim - dt * 5);
    n.judgeTimer = Math.max(0, s.judgeTimer - dt);

    const setJudge = (text: string, good: boolean) => {
      n.judgeText = text;
      n.judgeGood = good;
      n.judgeTimer = 0.5;
    };

    // 移動
    const docs: Doc[] = [];
    for (const d of s.docs) {
      const y = d.y + n.speed * (d.express ? EXPRESS_SPEED : 1) * dt;
      if (y > VIRTUAL_H + DOC_H) continue;
      docs.push({ ...d, y, stamped: Math.max(0, d.stamped - dt * 4) });
    }

    // ワクを通り過ぎた書類の判定
    for (const d of docs) {
      if (d.done || d.y <= ZONE_Y + WIN_OK) continue;
      d.done = true;
      if (d.bad) {
        // 差戻を見送るのは正解。ただし加点は控えめ（待つだけでは稼げない）
        n.score += 1;
        setJudge('見おくり', true);
      } else {
        n.lives -= 1;
        n.combo = 0;
        addShake(n, 1);
        n.deathReason = '見のがしが多すぎた';
        setJudge('見のがし', false);
      }
    }

    // 出現
    n.spawnTimer = s.spawnTimer - dt;
    if (n.spawnTimer <= 0) {
      // 間隔を揺らしているのは、破綻が始まる瞬間を毎回ずらすため。
      // ここが一定だと「毎回まったく同じ点数で終わる」ゲームになる（面白さゲートで検出済み）
      n.spawnTimer += spawnInterval(s.time) * rng.range(0.7, 1.3);
      const roll = rng();
      const bad = roll < badRate(s.time);
      docs.push({
        id: n.nextId,
        y: -DOC_H,
        bad,
        express: !bad && roll > 1 - expressRate(s.time),
        done: false,
        stamped: 0,
      });
      n.nextId += 1;
    }

    // 押した
    if (input.tap && n.cooldown <= 0) {
      const target = pickTarget(docs);
      n.stampAnim = 1;
      if (!target) {
        n.cooldown = CT_MISS;
        n.combo = 0;
        setJudge('カラぶり', false);
      } else if (target.bad) {
        target.done = true;
        target.stamped = 1;
        n.lives -= 1;
        n.combo = 0;
        n.cooldown = CT_MISS;
        addShake(n, 1);
        hitStop(n, 0.08);
        n.deathReason = '差戻にハンコを押した';
        setJudge('それ差戻！', false);
      } else {
        const dist = Math.abs(target.y - ZONE_Y);
        target.done = true;
        target.stamped = 1;
        n.combo += 1;
        n.bestCombo = Math.max(n.bestCombo, n.combo);
        n.cooldown = CT_HIT;
        const mult = 1 + Math.min(4, Math.floor(n.combo / 5));
        const base = dist <= WIN_PERFECT ? 3 : dist <= WIN_GOOD ? 2 : 1;
        n.score += base * mult * (target.express ? 5 : 1);
        addPop(n);
        // ど真ん中で捉えたときだけ強く止める。全部止めると重くなる
        if (base === 3 || target.express) hitStop(n, target.express ? 0.07 : 0.045);
        setJudge(
          target.express ? '特急ゲット！' : base === 3 ? 'ドンピシャ' : base === 2 ? 'ナイス' : 'セーフ',
          true,
        );
      }
    }

    n.docs = docs;
    if (n.lives <= 0) {
      n.over = true;
      // 手からハンコがすっぽ抜けて、回りながら落ちていく。
      // この一瞬の絵が、そのゲームの記憶になる（docs/design/feel-catalog.md F章）
      n.tumble = { ...s.tumble };
      launchTumble(n.tumble, 185, 262, { vx: -62, vy: -175, vrot: 6.5 });
      addShake(n, 1);
    }
    return n;
  },

  draw(g: Painter, s) {
    const [shakeX] = shakeOffset(s, s.time);

    // 机とベルト
    g.rect(0, 16, VIRTUAL_W, VIRTUAL_H - 16, 'bg');
    const beltX = (VIRTUAL_W - DOC_W) / 2 - 10;
    g.rect(beltX, 16, DOC_W + 20, VIRTUAL_H - 16, 'bg2');
    const flow = (s.time * s.speed) % 16;
    for (let y = 16 - 16 + flow; y < VIRTUAL_H; y += 16) {
      g.line(beltX, y, beltX + DOC_W + 20, y, 'line', 1);
    }

    // 判定ワク
    g.rectLine(beltX - 4, ZONE_Y - WIN_OK, DOC_W + 28, WIN_OK * 2, 'accent', 1);
    g.line(beltX - 10, ZONE_Y, beltX, ZONE_Y, 'accent', 1);
    g.line(beltX + DOC_W + 20, ZONE_Y, beltX + DOC_W + 30, ZONE_Y, 'accent', 1);

    // 書類
    for (const d of s.docs) {
      const x = (VIRTUAL_W - DOC_W) / 2 + shakeX;
      const top = d.y - DOC_H / 2;
      if (top > VIRTUAL_H || top < -DOC_H) continue;
      g.rect(x, top, DOC_W, DOC_H, d.bad ? 'bad' : d.express ? 'accent' : 'ink');
      g.rectLine(x, top, DOC_W, DOC_H, 'bg', 1);
      for (let i = 0; i < 3; i++) {
        g.rect(x + 8, top + 9 + i * 8, DOC_W - 30, 2, 'dim');
      }
      g.text(d.bad ? '差戻' : d.express ? '特急' : '決裁', x + DOC_W - 24, top + 6, {
        size: 9,
        color: 'bg',
        align: 'center',
      });
      if (d.stamped > 0) {
        g.circleLine(x + DOC_W - 20, top + DOC_H / 2 + 4, 8 + d.stamped * 4, 'accent2', 2);
      } else if (d.done && !d.bad) {
        g.circleLine(x + DOC_W - 20, top + DOC_H / 2 + 4, 8, 'accent2', 2);
      }
    }

    // ハンコ。クビになったら手から飛んでいく
    if (s.tumble.on) {
      g.at(s.tumble.x, s.tumble.y, s.tumble.rot, () => {
        g.rect(-7, -26, 14, 26, 'dim');
        g.circle(0, 0, 13, 'accent2');
        g.circleLine(0, 0, 13, 'bg', 2);
        g.text('印', 0, -6, { size: 11, align: 'center', color: 'bg' });
      });
    } else {
      const stampY = 268 + (s.stampAnim > 0 ? -10 * s.stampAnim : 0);
      const ready = s.cooldown <= 0;
      g.rect(178, stampY - 26, 14, 26, ready ? 'dim' : 'line');
      g.circle(185, stampY, 13, ready ? 'accent2' : 'line');
      g.circleLine(185, stampY, 13, 'bg', 2);
      g.text('印', 185, stampY - 5, { size: 11, align: 'center', color: 'bg' });
      if (!ready) {
        g.text('もどり中', 185, stampY + 18, { size: 8, align: 'center', color: 'dim' });
      }
    }

    // 残ライフ
    for (let i = 0; i < LIVES; i++) {
      g.circle(12 + i * 13, 26, 4, i < s.lives ? 'good' : 'line');
    }

    // コンボ
    if (s.combo >= 3) {
      g.text(`${s.combo}れんぞく`, VIRTUAL_W - 8, 22, { size: 10, align: 'right', color: 'accent' });
      const mult = 1 + Math.min(4, Math.floor(s.combo / 5));
      if (mult > 1) {
        g.text(`×${mult}`, VIRTUAL_W - 8, 34, { size: 12, align: 'right', color: 'accent2' });
      }
    }

    // 判定表示。決まった瞬間だけ一瞬大きくなる
    if (s.judgeTimer > 0) {
      g.text(s.judgeText, VIRTUAL_W / 2, 168, {
        size: Math.round(15 * popScale(s, 0.4)),
        align: 'center',
        color: s.judgeGood ? 'good' : 'bad',
      });
    }
  },

  bot(s) {
    if (s.cooldown > 0) return { press: false };
    const target = pickTarget(s.docs);
    // いま押すと差戻に当たる状況では手を出さない
    if (target?.bad) return { press: false };

    let next: Doc | null = null;
    for (const d of s.docs) {
      if (d.done || d.bad) continue;
      if (d.y > ZONE_Y + WIN_PERFECT) continue;
      if (next === null || d.y > next.y) next = d;
    }
    if (!next) return { press: false };
    // 次のフレームで中心をまたぐなら、いま押すのが最善
    const per = (s.speed * (next.express ? EXPRESS_SPEED : 1)) / 60;
    return { press: next.y + per >= ZONE_Y };
  },

  reason(s) {
    return s.deathReason || '書類が捌けなくなった';
  },

  tunables: {
    spawnBase: {
      label: '書類の間隔',
      min: 0.7,
      max: 2.2,
      get: () => TUNE.spawnBase,
      set: (v) => {
        TUNE.spawnBase = v;
      },
    },
    speedGain: {
      label: '速度の上がり方',
      min: 1.5,
      max: 7,
      get: () => TUNE.speedGain,
      set: (v) => {
        TUNE.speedGain = v;
      },
    },
  },
});
