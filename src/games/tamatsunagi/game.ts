/**
 * たまつなぎ
 *
 * 上から降りてくる玉を、下から針を突き上げて糸に通す。
 * 穴の真ん中なら通る。ふちにかすると糸が切れる。大きく外すのは何も起きない。
 *
 * ・玉は下に降りるほど揺れ幅が小さくなり、糸の真上に寄ってくる
 *   → 放っておけば必ず糸を切られる。下で通すのは簡単だが1点しか入らない
 * ・稼ぐには上で通すしかない。上は揺れが大きく、針が届くまでの間に動く分を読む必要がある
 *
 * この2つが「初見でも点が入る」と「腕前が効く」を同時に作っている。
 * 「大きく外すのは無傷／かすったら致命傷」という判定が、狭いところを通すときの緊張そのもの。
 */

import { defineGame, FIXED_DT, VIRTUAL_H, VIRTUAL_W, type BaseState } from '@/arcade/types';
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
  takeTap,
  type FeelState,
  type Tumble,
} from '@/arcade/feel';
import { meta } from './meta';

/**
 * 収録中に触ることになる数値。`npm run tune` が動かせるよう、定数ではなく入れ物にしてある
 * （通常のプレイでは変わらない）。
 */
const TUNE = {
  /** 玉が降りてくる速さの初期値。大きいほど最初から忙しい */
  fallBase: 68,
  /** 落下の速くなり方（毎秒）。難度の上がり方はここ1本で決まる */
  fallGain: 1.15,
  /** 玉の間隔の初期値 */
  spawnBase: 1.55,
};

/* ---- 画面の決まり（240×320）---------------------------------------- */

/** ねらい線。針はここを一直線に上がる */
const LANE_X = VIRTUAL_W / 2;
/** 玉が出てくる高さ */
const SPAWN_Y = -34;
/** 針が届く一番上 */
const REACH_Y = 22;
/** 針の先の定位置。玉がここまで降りたら糸に当たる */
const REST_Y = 268;
/** 糸の根もと（台の高さ） */
const BASE_Y = 300;
/** 通した玉を並べる高さ */
const BEAD_Y = 311;
/**
 * 10個たまると「ひとふさ」になって列が空になる。
 * 並べっぱなしにすると15個くらいで画面が埋まりきり、そこから先は手ごたえが増えなくなる
 * （実測でそうなった）。刻みを入れておくと最後まで小さな達成が続く。
 */
const BEAD_ROW = 10;

/** ここより上で通すと5点 */
const HIGH_Y = 105;
/**
 * ここより上で通すと3点（それ以下は1点）。
 * ここから下に入った玉は赤くする。1点しか入らないことと、糸を切られる危険が
 * 近いことは同じ話なので、同じ色で言い切ったほうが伝わる（予告は0.5〜1.0秒前）。
 */
const MID_Y = 200;

/* ---- 玉の大きさと判定 ------------------------------------------------ */

/** 穴の見た目の半径 */
const HOLE_DRAW = 15;
/** 穴の判定。見た目より少し広い＝甘い側に外す（feel-catalog A章） */
const HOLE_HIT = 17;
/** 輪の見た目の半径 */
const RING_DRAW = 26;
/** 輪の判定。見た目より少し狭い＝理不尽な「かすり」を減らす */
const RING_HIT = 24;

/** 揺れ幅。上ほど大きく、糸の高さでは中央に寄りきる */
const AMP_TOP = 96;
const AMP_BOTTOM = 8;

/* ---- 針 -------------------------------------------------------------- */

const SHOT_SPEED = 940;
const BACK_SPEED = 1500;
/** 糸を結び直すのにかかる時間。ここが連打の抑止になる */
const CT_CUT = 0.42;
const LIVES = 3;

interface Tama {
  id: number;
  y: number;
  /** 揺れの位相 */
  ph: number;
  /** 揺れの速さ（ラジアン毎秒） */
  om: number;
}

/** 通した玉が糸を伝って降りていく演出 */
interface Slide {
  from: number;
  t: number;
}

/** 通った瞬間に広がる光の輪 */
interface Flash {
  x: number;
  y: number;
  t: number;
}

/** 糸が切れて散らばる玉 */
interface Spill {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
}

export interface TamatsunagiState extends BaseState, FeelState {
  tamas: Tama[];
  nextId: number;
  lives: number;
  combo: number;
  bestCombo: number;
  /** いまの落下速度。難度の中心 */
  fall: number;
  spawnTimer: number;
  /** 針の先の高さ */
  tipY: number;
  mode: 'idle' | 'up' | 'back';
  cool: number;
  /** 糸に通した玉の数（画面下の列に並べる） */
  beads: number;
  slides: Slide[];
  flashes: Flash[];
  spill: Spill[];
  judgeText: string;
  judgeGood: boolean;
  judgeTimer: number;
  deathReason: string;
  /** 糸が切れたときに飛んでいく針 */
  tumble: Tumble;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** その高さでの揺れ幅。下ほど中央に寄る */
function ampAt(y: number): number {
  const t = clamp01((y - SPAWN_Y) / (REST_Y - SPAWN_Y));
  return AMP_TOP + (AMP_BOTTOM - AMP_TOP) * t;
}

/** 高さと位相から横位置を出す。判定・描画・ボットの予測がすべてこれを通る */
function xAt(y: number, ph: number): number {
  return LANE_X + ampAt(y) * Math.sin(ph);
}

const tamaX = (t: Tama): number => xAt(t.y, t.ph);

/** その高さで通したときの点。上ほど大きい＝上を狙う理由になる */
function valueAt(y: number): number {
  return y < HIGH_Y ? 5 : y < MID_Y ? 3 : 1;
}

/** 経過時間から玉の間隔。詰まってくることが唯一の緊張の軸 */
function spawnInterval(time: number): number {
  return Math.max(0.42, TUNE.spawnBase - time * 0.016);
}

/** 揺れの速さ。落下と一緒に上げるので、遊ぶ側には「速くなった」の1本に見える */
function swaySpeed(time: number): number {
  return 1.5 + time * 0.014;
}

/** 画面下に並ぶ玉の横位置 */
const beadX = (i: number): number => 12 + (i % BEAD_ROW) * 19;

export default defineGame<TamatsunagiState>({
  meta,

  init() {
    return {
      ...createFeel(),
      score: 0,
      over: false,
      time: 0,
      tamas: [],
      nextId: 1,
      lives: LIVES,
      combo: 0,
      bestCombo: 0,
      fall: TUNE.fallBase,
      spawnTimer: 0.35,
      tipY: REST_Y,
      mode: 'idle',
      cool: 0,
      beads: 0,
      slides: [],
      flashes: [],
      spill: [],
      judgeText: '',
      judgeGood: true,
      judgeTimer: 0,
      deathReason: '',
      tumble: createTumble(),
    };
  },

  step(s, input, dt, rng) {
    const n: TamatsunagiState = { ...s };

    // 糸が切れたあとも呼ばれる。ここは演出だけを進める見せ場
    if (s.over) {
      n.tumble = { ...s.tumble };
      stepTumble(n.tumble, dt);
      n.spill = s.spill.map((p) => ({
        x: p.x + p.vx * dt,
        y: p.y + p.vy * dt,
        vx: p.vx,
        // 重力はプレイ中よりわざと弱くしてある。落ちきるまでの間が「見せる時間」になる
        vy: p.vy + 420 * dt,
        rot: p.rot + dt * 5,
      }));
      n.tamas = s.tamas.map((t) => ({ ...t, y: t.y + s.fall * 0.35 * dt }));
      n.judgeTimer = Math.max(0, s.judgeTimer - dt);
      return n;
    }

    // 通った瞬間の「止め」の最中は世界を進めない（手応えを作る）
    if (!feelTick(n, input, dt)) return n;

    const setJudge = (text: string, good: boolean) => {
      n.judgeText = text;
      n.judgeGood = good;
      n.judgeTimer = 0.5;
    };

    // 1) タイマーと難度
    n.cool = Math.max(0, s.cool - dt);
    n.judgeTimer = Math.max(0, s.judgeTimer - dt);
    n.flashes = s.flashes.map((f) => ({ ...f, t: f.t - dt })).filter((f) => f.t > 0);
    n.slides = s.slides.map((v) => ({ ...v, t: v.t - dt * 4 })).filter((v) => v.t > 0);
    n.fall = TUNE.fallBase + s.time * TUNE.fallGain;

    // 2) 玉を降ろす
    let tamas: Tama[] = s.tamas.map((t) => ({
      ...t,
      y: t.y + n.fall * dt,
      ph: t.ph + t.om * dt,
    }));

    // 3) 糸の高さまで降りてきた玉の判定（放置するとここで必ず死ぬ）
    //    入力より先に見る。逆にすると「押したのに落とした扱い」が起きる
    const alive: Tama[] = [];
    for (const t of tamas) {
      if (t.y >= REST_Y) {
        if (Math.abs(tamaX(t) - LANE_X) <= RING_HIT) {
          n.lives -= 1;
          n.combo = 0;
          addShake(n, 1);
          hitStop(n, 0.06);
          n.deathReason = '玉を下まで落とした';
          setJudge('おとした！', false);
          continue;
        }
        if (t.y > VIRTUAL_H + RING_DRAW) continue;
      }
      alive.push(t);
    }
    tamas = alive;

    // 4) 出現。間隔を揺らして、詰まりはじめる瞬間を毎回ずらす
    n.spawnTimer = s.spawnTimer - dt;
    if (n.spawnTimer <= 0) {
      n.spawnTimer += spawnInterval(s.time) * rng.range(0.8, 1.25);
      tamas.push({
        id: n.nextId,
        y: SPAWN_Y,
        ph: rng.range(0, Math.PI * 2),
        om: swaySpeed(s.time) * rng.range(0.85, 1.2),
      });
      n.nextId += 1;
    }

    // 5) 針を突き上げる。撃ったあとは変えられない（そこが「思い切る」になる）
    if (n.mode === 'idle' && n.cool <= 0 && takeTap(n)) {
      n.mode = 'up';
      n.tipY = REST_Y;
    }

    if (n.mode === 'up') {
      const prevTip = n.tipY;
      let tip = prevTip - SHOT_SPEED * dt;
      // 針が跨いだ玉を、下にあるものから順に見る
      const crossed = tamas
        .filter((t) => t.y <= prevTip && t.y >= tip)
        .sort((a, b) => b.y - a.y);

      let hit = 0;
      let gained = 0;
      let topY = REST_Y;
      for (const t of crossed) {
        const dx = Math.abs(tamaX(t) - LANE_X);
        if (dx <= HOLE_HIT) {
          // 通った。玉は糸を伝って下へ降りていく
          hit += 1;
          gained += valueAt(t.y);
          topY = Math.min(topY, t.y);
          n.flashes = [...n.flashes, { x: tamaX(t), y: t.y, t: 0.28 }];
          n.slides = [...n.slides, { from: t.y, t: 1 }];
          tamas = tamas.filter((o) => o.id !== t.id);
        } else if (dx <= RING_HIT) {
          // ふちにかすった。針が止まり、糸が切れる
          n.lives -= 1;
          n.combo = 0;
          n.cool = CT_CUT;
          tip = t.y;
          n.mode = 'back';
          addShake(n, 1);
          hitStop(n, 0.08);
          n.deathReason = 'あなのふちに かすった';
          setJudge('かすった！', false);
          tamas = tamas.filter((o) => o.id !== t.id);
          break;
        }
        // それより外は針に触れていない。何も起きない
      }

      // 跨いだのに1つも通らなかった＝外した。
      // ここで何も出さないと「通ったはずなのにスルーされた」と見える（遊んでの指摘）。
      // どちら側に外したかまで出すと、次に何を直せばいいかが分かる
      if (hit === 0 && crossed.length > 0 && n.mode === 'up' && s.judgeTimer <= 0) {
        const near = crossed[0];
        const off = tamaX(near) - LANE_X;
        setJudge(Math.abs(off) <= RING_HIT + 14 ? 'おしい！' : off > 0 ? 'まだ右' : 'まだ左', false);
      }

      if (hit > 0) {
        n.combo += hit;
        n.bestCombo = Math.max(n.bestCombo, n.combo);
        // 一突きで何個通したかが、いちばん大きく点を動かす（上振れの源）
        const multi = hit >= 3 ? 3 : hit === 2 ? 2 : 1;
        const comboMult = 1 + Math.min(2, Math.floor(n.combo / 6));
        n.score += gained * multi * comboMult;
        n.beads += hit;
        addPop(n);
        hitStop(n, hit > 1 ? 0.07 : 0.045);
        setJudge(
          hit >= 3 ? `${hit}れんぬき！` : hit === 2 ? '2れんぬき' : topY < HIGH_Y ? 'たかぬき' : 'ぬけた',
          true,
        );
      }

      if (n.mode === 'up' && tip <= REACH_Y) {
        tip = REACH_Y;
        n.mode = 'back';
      }
      n.tipY = tip;
    } else if (n.mode === 'back') {
      n.tipY = s.tipY + BACK_SPEED * dt;
      if (n.tipY >= REST_Y) {
        n.tipY = REST_Y;
        n.mode = 'idle';
      }
    }

    n.tamas = tamas;

    // 6) 終わり方
    if (n.lives <= 0) {
      n.over = true;
      // 針が手を離れて飛んでいき、通した玉がほどけて散らばる。
      // 積み上げたものが一瞬で散る絵にする（feel-catalog F章）
      n.tumble = { ...s.tumble };
      launchTumble(n.tumble, LANE_X, n.tipY, { vx: 58, vy: -180, vrot: 7 });
      addShake(n, 1);
      // 切れた瞬間は、列に見えている分だけでなく**通した玉が全部**ほどけて散る。
      // ここは正確さより「積み上げたものが一瞬で散る」絵を優先している
      const shown = Math.min(BEAD_ROW * 2, n.beads);
      const spill: Spill[] = [];
      for (let i = 0; i < shown; i++) {
        spill.push({
          x: beadX(i),
          y: BEAD_Y - (i >= BEAD_ROW ? 13 : 0),
          vx: rng.range(-95, 95),
          vy: rng.range(-265, -155),
          rot: 0,
        });
      }
      n.spill = spill;
    }
    return n;
  },

  draw(g: Painter, s) {
    const [shakeX] = shakeOffset(s, s.time);

    // 点の刻み。玉の色は「その高さで何点か」を表しているので、
    // 目盛りと色を並べて置いて、色の意味がその場で分かるようにする
    // （薄すぎて見えず「色が変わる意味が分からない」と言われたので濃くした）
    for (const [y, label, col] of [
      [HIGH_Y, '5てん', 'accent'],
      [MID_Y, '3てん', 'ink'],
    ] as const) {
      for (let x = 6; x < VIRTUAL_W - 6; x += 8) g.rect(x, y, 4, 1, 'line');
      g.circle(10, y - 8, 4, col);
      g.text(label, 18, y - 13, { size: 9, color: 'dim' });
    }
    g.circle(10, MID_Y + 16, 4, 'bad');
    g.text('1てん・きけん', 18, MID_Y + 11, { size: 9, color: 'dim' });

    // ねらい線。針が通る道が常に見えていること
    for (let y = REACH_Y; y < REST_Y; y += 7) {
      g.rect(LANE_X, y, 1, 3, 'line');
    }

    // 玉。役割を色で固定する（下＝危ない＝赤、上＝高得点＝黄）
    for (const t of s.tamas) {
      const x = tamaX(t) + shakeX;
      if (t.y < SPAWN_Y - RING_DRAW || t.y > VIRTUAL_H + RING_DRAW) continue;
      const col = t.y >= MID_Y ? 'bad' : t.y < HIGH_Y ? 'accent' : 'ink';
      g.circle(x, t.y, RING_DRAW, col);
      g.circleLine(x, t.y, RING_DRAW, 'bg', 1);
      g.circle(x, t.y, HOLE_DRAW, 'bg');
      g.circleLine(x, t.y, HOLE_DRAW, col, 1);
    }

    // 通った瞬間の光の輪
    for (const f of s.flashes) {
      const k = 1 - f.t / 0.28;
      g.alpha(1 - k, () => g.circleLine(f.x + shakeX, f.y, HOLE_DRAW + k * 16, 'good', 2));
    }

    // 台と糸と針
    g.rect(0, BASE_Y, VIRTUAL_W, VIRTUAL_H - BASE_Y, 'bg2');
    g.rect(0, BASE_Y, VIRTUAL_W, 1, 'line');
    if (!s.tumble.on) {
      const tip = s.tipY;
      g.rect(LANE_X - 1, tip, 3, BASE_Y - tip, s.cool > 0 ? 'line' : 'ink');
      g.poly([LANE_X - 4, tip + 7, LANE_X + 4, tip + 7, LANE_X, tip - 5], s.cool > 0 ? 'line' : 'accent');
      if (s.cool > 0) {
        g.text('むすび直し', LANE_X - 10, BASE_Y - 16, { size: 8, align: 'right', color: 'dim' });
      }
    }

    // 糸を伝って降りていく玉
    for (const v of s.slides) {
      const y = v.from + (BEAD_Y - v.from) * (1 - v.t);
      g.circle(LANE_X, y, 5, 'good');
      g.circle(LANE_X, y, 2, 'bg');
    }

    // 通した玉の列。ここが伸びていくのがそのまま手ごたえになる
    g.rect(0, BEAD_Y, VIRTUAL_W, 1, 'dim');
    if (s.tumble.on) {
      for (const p of s.spill) {
        g.at(p.x, p.y, p.rot, () => {
          g.circle(0, 0, 6, 'accent');
          g.circle(0, 0, 2, 'bg');
        });
      }
    } else {
      for (let i = 0; i < s.beads % BEAD_ROW; i++) {
        g.circle(beadX(i), BEAD_Y, 6, 'accent');
        g.circle(beadX(i), BEAD_Y, 2, 'bg2');
      }
      const fusa = Math.floor(s.beads / BEAD_ROW);
      if (fusa > 0) {
        g.text(`${fusa}ふさ`, VIRTUAL_W - 6, BEAD_Y - 6, { size: 11, align: 'right', color: 'accent2' });
      }
    }

    // 飛んでいく針
    if (s.tumble.on) {
      g.at(s.tumble.x, s.tumble.y, s.tumble.rot, () => {
        g.rect(-1, -14, 3, 28, 'ink');
        g.poly([-4, -14, 4, -14, 0, -24], 'accent');
      });
    }

    // 残りの糸
    for (let i = 0; i < LIVES; i++) {
      g.circle(12 + i * 13, 26, 4, i < s.lives ? 'good' : 'line');
    }

    // 連続。玉が後ろを通るので、下に一枚敷かないと読めなくなる
    if (s.combo >= 4) {
      g.alpha(0.72, () => g.rect(VIRTUAL_W - 70, 18, 68, s.combo >= 6 ? 30 : 16, 'bg'));
      g.text(`${s.combo}れんぞく`, VIRTUAL_W - 8, 22, { size: 10, align: 'right', color: 'accent' });
      const mult = 1 + Math.min(2, Math.floor(s.combo / 6));
      if (mult > 1) {
        g.text(`×${mult}`, VIRTUAL_W - 8, 34, { size: 12, align: 'right', color: 'accent2' });
      }
    }

    // 判定表示。決まった瞬間だけ一瞬大きくなる。
    // ねらい線の真上に出るので、ここも下に一枚敷かないと針の軸が字を割る
    if (s.judgeTimer > 0) {
      const size = Math.round(15 * popScale(s, 0.4));
      const w = g.measure(s.judgeText, size) + 14;
      g.alpha(0.78, () => g.rect(LANE_X - w / 2, 241, w, size + 7, 'bg'));
      g.text(s.judgeText, LANE_X, 244, {
        size,
        align: 'center',
        color: s.judgeGood ? 'good' : 'bad',
      });
    }
  },

  /**
   * 上手い人の再現。針が届く瞬間の位置を先に計算して、
   * 「かすらない」かつ「通せる」ときだけ撃つ。
   */
  bot(s) {
    if (s.mode !== 'idle' || s.cool > 0) return { press: false };
    const list = s.tamas.filter((t) => t.y < REST_Y).sort((a, b) => b.y - a.y);
    let hit = 0;
    let gained = 0;
    for (const t of list) {
      // 針と玉が出会うまでのフレーム数（互いに近づくので速度は足し算）
      const f = Math.ceil((REST_Y - t.y) / ((SHOT_SPEED + s.fall) * FIXED_DT));
      const y = t.y + s.fall * FIXED_DT * f;
      const dx = Math.abs(xAt(y, t.ph + t.om * FIXED_DT * f) - LANE_X);
      if (dx <= HOLE_HIT - 2) {
        hit += 1;
        gained += valueAt(y);
      } else if (dx <= RING_HIT + 2) {
        return { press: false }; // かする。この一突きは捨てる
      }
    }
    if (hit === 0) return { press: false };
    const lowest = list.length ? list[0].y : SPAWN_Y;
    // 2個以上／高い所／落としそうな玉があるとき、のいずれかで撃つ
    return { press: hit >= 2 || gained >= 5 || lowest > MID_Y + 14 || (gained >= 3 && lowest > MID_Y - 40) };
  },

  reason(s) {
    return s.deathReason || '糸が切れた';
  },

  tunables: {
    fallBase: {
      label: '玉の落ちる速さ',
      min: 40,
      max: 110,
      get: () => TUNE.fallBase,
      set: (v) => {
        TUNE.fallBase = v;
      },
    },
    fallGain: {
      label: '速くなり方',
      min: 0.4,
      max: 2.5,
      get: () => TUNE.fallGain,
      set: (v) => {
        TUNE.fallGain = v;
      },
    },
    spawnBase: {
      label: '玉の間隔',
      min: 0.9,
      max: 2.4,
      get: () => TUNE.spawnBase,
      set: (v) => {
        TUNE.spawnBase = v;
      },
    },
  },
});
