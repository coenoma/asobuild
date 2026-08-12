/**
 * ぬいみち
 *
 * 押している間だけ上がり、離すと落ちる。その上下だけで、立ちならぶ針の「めど」に糸を通していく。
 * 1本でも外して針に当たったら、そこで終わり。
 *
 * ・上がる加速度と落ちる加速度をほぼ同じにし、速さに上限を置いてある
 *   → 押しっぱなしでも離しっぱなしでも急な動きにならず、軌跡がひとりでにうねる
 * ・針は「太い針（めどが広い・1点）」と「細い針（めどがせまい・5点）」が上下に並んで立つ
 *   → 細い方は少し離れた高さにあるので、取りに行くと次の針までの持ち直しがきつくなる
 * ・通した数がそのまま倍率になる。続くほど1本の重みが増していく
 *
 * 面白さの中心は「1つの穴を正確に通す」ではなく「**続けて通す**」ほうに置いてある。
 * 後半ほど1本が重くなるので、同じ操作をしていても緊張だけが上がっていく。
 *
 * ⚠️ ライフを持たせていない（fun-doctrine §6 の目安は「ライフ3」）。
 * 下敷きにした遊びの「静かに一発で終わる」ところが懐かしさの芯で、
 * 3回まで耐えると、その終わり方が3回に薄まってしまうため。
 * 代わりに判定を見た目より甘くし（PAD）、最初の数本は易しく置いて理不尽さを消している。
 */

import { defineGame, VIRTUAL_W, type BaseState } from '@/arcade/types';
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
 * 収録中に触ることになる数値。`npm run tune` が動かせるよう、定数ではなく入れ物にしてある
 * （通常のプレイでは変わらない）。
 */
const TUNE = {
  /** 布が流れる速さの初期値。大きいほど最初から忙しい */
  scrollBase: 58,
  /** 速くなり方（毎秒）。難度の上がり方はここ1本で決まる */
  scrollGain: 1.2,
  /** 針と針の間隔（距離）。時間ではなく距離で置くので、速くなるほど間隔が詰まって見える */
  gapX: 74,
};

/* ---- 画面の決まり（240×320）---------------------------------------- */

/** 布の上端（ここより上は共通シェルのスコア表示と、こちらの状態表示の段） */
const TOP = 32;
/** 布の下端 */
const BOT = 300;
/** 糸の先の横位置。糸は横に動かない。動くのは布のほう */
const PIN_X = 62;
/** 針の太さ */
const NEEDLE_W = 8;

/* ---- 動き ------------------------------------------------------------ */

/** 落ちる加速度 */
const G = 440;
/** 押しているときの上向きの加速度。落ちる側とほぼ同じにするのが手触りの肝 */
const LIFT = 480;
/** 上下の速さの上限。上げも下げも同じ値にしてある（片方が速いとうねらない） */
const V_MAX = 148;

/* ---- めど（穴）と判定 ------------------------------------------------ */

/** 太い針のめど、その半分の高さ（見た目） */
const EYE_WIDE = 23;
/** 細い針のめど、その半分の高さ（見た目） */
const EYE_THIN = 12;
/**
 * 太い針と細い針のあいだ（針の胴の厚み）。
 *
 * ⚠️ ここは必ず `PAD * 2` より厚くすること。
 * 甘さは両側のめどに足されるので、桟が薄いと**両方の判定が重なって桟が消える**。
 * 見た目は塞がっているのに素通りできる状態になり、遊ぶと必ず「ルールが分からない」と言われる
 * （実測: BAR=11 / PAD=6 で桟が完全に消えていた。2026-08-12 の指摘）。
 */
const BAR = 22;
/** 判定は見た目より少し甘くする（手触りカタログ A章） */
const PAD = 6;
/** ど真ん中とみなす幅 */
const CORE = 8;

/**
 * 糸が入ってくる高さ。画面の上のほうから垂れてくる。
 * 最初の数本のめどはこの高さの近くに置く（下記 EASY_POSTS）。
 */
const START_Y = TOP + 52;

/**
 * 最初の何本かは、めどを大きく・この高さの近くに置く（A章「開始直後の保護」）。
 * 1回当たれば終わるゲームなので、ここが無いと初見が一度も通せないまま帰る
 * （実測: 保護なしだと、でたらめ操作の中央値が 0点・生存2.9秒で、面白さゲートに落ちた）。
 */
const EASY_POSTS = 4;

/** 糸の跡を何フレームごとに打つか。細かくしすぎると配列のコピーだけが増える */
const TRAIL_STEP = 4;
/** 糸の跡の保持数。画面の横幅ぶんあれば足りる */
const TRAIL_MAX = 62;

/** 縫い目の列を1行に何目まで並べるか */
const STITCH_ROW = 12;

interface Eye {
  /** めどの中心の高さ */
  y: number;
  /** めどの半分の高さ */
  h: number;
  /** 細い針（高得点） */
  thin: boolean;
  /** ここに糸が通ったか（通った針は糸をつけたまま流れていく） */
  threaded: boolean;
}

interface Needle {
  id: number;
  /** 置かれた位置（累積距離）。画面上の x はここから毎回計算する */
  d: number;
  eyes: Eye[];
  /** 判定が済んだか */
  done: boolean;
  /** ここで当たった（描画で赤くする） */
  hit: boolean;
}

/** 糸の跡。位置ではなく距離で持つと、毎フレーム全部を動かさずに済む */
interface Trail {
  d: number;
  y: number;
}

/** 通った瞬間に出す点数と光。音を消していても取れたことが分かるように出す */
interface Float {
  d: number;
  y: number;
  t: number;
  text: string;
  thin: boolean;
  /** 文字が動く向き。画面のふちに寄っている針では、内側へ逃がす */
  dir: number;
}

export interface NuimichiState extends BaseState, FeelState {
  /** 糸の先の高さ */
  y: number;
  vy: number;
  /** 布が流れた累積距離。針も糸の跡もこれを基準に置いてある */
  dist: number;
  speed: number;
  needles: Needle[];
  /** 次の針を置く距離 */
  nextNeedleD: number;
  /** 直前に置いた太い針のめどの高さ。次の配置の基準になる */
  lastEyeY: number;
  nextId: number;
  trail: Trail[];
  trailTick: number;
  floats: Float[];
  /** 通した本数。そのまま倍率になる */
  passed: number;
  judgeText: string;
  judgeGood: boolean;
  judgeTimer: number;
  /** 判定文字を下の段に出すか。通しためどと重ならない側へ寄せる */
  judgeLow: boolean;
  deathReason: string;
  /** 当たったところ（糸が切れた印） */
  cutD: number;
  cutY: number;
  /** 力尽きたときに落ちていく糸の先 */
  tumble: Tumble;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 針の画面上の x（中心） */
const needleX = (dist: number, p: Needle): number => PIN_X + (p.d - dist);

/**
 * 次の針までに上下へ動ける距離。
 * 速くなるほど短くなるので、これを配置の振れ幅の上限に使えば理不尽な配置が出ない。
 */
function reachAt(speed: number): number {
  const t = TUNE.gapX / speed;
  const tAcc = V_MAX / G;
  if (t <= tAcc) return 0.5 * G * t * t;
  return 0.5 * V_MAX * tAcc + V_MAX * (t - tAcc);
}

/** その高さにあるめど（判定は見た目より甘い）。無ければ null＝針の胴に当たっている */
function eyeAt(p: Needle, y: number): Eye | null {
  for (const e of p.eyes) {
    if (Math.abs(y - e.y) <= e.h + PAD) return e;
  }
  return null;
}

/** いちばん近いめど。抜けた瞬間の評価に使う（判定の取りこぼしを作らないため） */
function nearestEye(p: Needle, y: number): Eye {
  let best = p.eyes[0];
  for (const e of p.eyes) {
    if (Math.abs(y - e.y) < Math.abs(y - best.y)) best = e;
  }
  return best;
}

/**
 * 倍率。通した本数だけで決まる。
 * 1回でも当たれば終わるので、これは「そのプレイがどこまで続いたか」そのものになる。
 * 後半ほど1本が重くなり、同じ操作をしていても緊張だけが上がっていく。
 */
const multOf = (passed: number): number => 1 + Math.min(4, Math.floor(passed / 8));

export default defineGame<NuimichiState>({
  meta,

  init() {
    return {
      ...createFeel(),
      score: 0,
      over: false,
      time: 0,
      // 糸は画面の上のほうから垂れて入ってくる。最初の数本のめどもこの高さに置く
      y: START_Y,
      vy: 0,
      dist: 0,
      speed: TUNE.scrollBase,
      needles: [],
      // 最初の針まで2.4秒ほど間を空ける。開始直後にいきなり判定を出さない
      nextNeedleD: 145,
      lastEyeY: START_Y,
      nextId: 1,
      trail: [],
      trailTick: 0,
      floats: [],
      passed: 0,
      judgeText: '',
      judgeGood: true,
      judgeTimer: 0,
      judgeLow: false,
      deathReason: '',
      cutD: -999,
      cutY: 0,
      tumble: createTumble(),
    };
  },

  step(s, input, dt, rng) {
    const n: NuimichiState = { ...s };

    // 当たったあとも呼ばれる。ここは演出だけを進める見せ場。
    // 布は流れ続け、糸の先は物理どおり、ただし現実よりゆっくり落ちていく（手触りカタログ F章）
    if (s.over) {
      n.tumble = { ...s.tumble };
      stepTumble(n.tumble, dt, 380);
      n.dist = s.dist + s.speed * 0.4 * dt;
      n.judgeTimer = Math.max(0, s.judgeTimer - dt);
      n.floats = s.floats.map((f) => ({ ...f, t: f.t - dt })).filter((f) => f.t > 0);
      return n;
    }

    // 通った瞬間の「止め」の最中は世界を進めない
    if (!feelTick(n, input, dt)) return n;

    // 1) タイマーと難度
    n.judgeTimer = Math.max(0, s.judgeTimer - dt);
    n.floats = s.floats.map((f) => ({ ...f, t: f.t - dt })).filter((f) => f.t > 0);
    n.speed = TUNE.scrollBase + s.time * TUNE.scrollGain;
    n.dist = s.dist + n.speed * dt;

    // 2) 糸の先を動かす。押している間だけ上がり、離すと落ちる。
    //    上下とも同じ上限で頭打ちにするので、押しっぱなしでも離しっぱなしでも暴れない
    n.vy = clamp(s.vy + (input.hold ? -LIFT : G) * dt, -V_MAX, V_MAX);
    n.y = s.y + n.vy * dt;
    if (n.y < TOP + 4) {
      n.y = TOP + 4;
      n.vy = 0;
    } else if (n.y > BOT - 4) {
      n.y = BOT - 4;
      n.vy = 0;
    }

    // 3) 糸の跡。位置ではなく距離で持っているので、打った点はもう動かさない
    n.trailTick = s.trailTick + 1;
    if (n.trailTick >= TRAIL_STEP) {
      n.trailTick = 0;
      const pts = [...s.trail, { d: n.dist, y: n.y }];
      n.trail = pts.length > TRAIL_MAX ? pts.slice(pts.length - TRAIL_MAX) : pts;
    }

    // 4) 針の判定。糸の先は動かないので、針のほうが糸の位置を通り過ぎていく
    const needles: Needle[] = [];
    for (const p of s.needles) {
      const x = needleX(n.dist, p);
      if (x < -NEEDLE_W * 2) continue;
      // まだ手前、または判定済みならそのまま持ち越す（コピーしない）
      if (p.done || x - NEEDLE_W / 2 > PIN_X) {
        needles.push(p);
        continue;
      }

      const np: Needle = { ...p };
      if (x + NEEDLE_W / 2 >= PIN_X) {
        // 通過中。めどから外れていたら針の胴に当たっている
        if (!eyeAt(np, n.y)) {
          np.done = true;
          np.hit = true;
          n.over = true;
          n.cutD = n.dist;
          n.cutY = n.y;
          addShake(n, 0.8);
          hitStop(n, 0.07);
          n.deathReason = '針に あたった';
          n.judgeText = 'あ…';
          n.judgeGood = false;
          n.judgeTimer = 1.2;
          n.judgeLow = n.y < (TOP + BOT) / 2;
          // 派手に散らさない。糸の先が手を離れて、糸を引いたまま静かに落ちていく
          n.tumble = { ...s.tumble };
          launchTumble(n.tumble, PIN_X, n.y, { vx: 24, vy: -92, vrot: 2.4 });
        }
      } else {
        // 抜けきった
        np.done = true;
        const eye = eyeAt(np, n.y) ?? nearestEye(np, n.y);
        const dy = Math.abs(n.y - eye.y);
        np.eyes = np.eyes.map((e) => (e === eye ? { ...e, threaded: true } : e));
        n.passed += 1;
        const base = eye.thin ? 5 : dy <= CORE ? 2 : 1;
        const gain = base * multOf(n.passed);
        n.score += gain;
        addPop(n);
        // ⚠️ ここでヒットストップを入れてはいけない。
        // 「当たった瞬間に世界を止める」は手応えの定番（feel-catalog B章）だが、
        // このゲームは主人公が上下に動き続けているので、止めると手応えではなく
        // **操作が引っかかった**ように感じる（遊んで「かくっとなる」と指摘が出た）。
        // 手応えは時間を止めずに、光と文字の大きさだけで出す。
        // 音を消していても取れたことが分かるように、点数そのものを飛ばす。
        // 上のほうのめどで上に飛ばすと画面外と状態表示にかぶるので、内側へ逃がす
        const dir = eye.y < TOP + 70 ? 1 : -1;
        n.floats = [...n.floats, { d: n.dist, y: eye.y, t: 0.6, text: `+${gain}`, thin: eye.thin, dir }];
        n.judgeText = eye.thin ? 'ほそ針！' : dy <= CORE ? 'ど真ん中' : 'とおった';
        n.judgeGood = true;
        n.judgeTimer = 0.45;
        // 判定文字は、いま通しためどと反対側の段に出す（針と字が重なると読めない）
        n.judgeLow = eye.y < (TOP + BOT) / 2;
      }
      needles.push(np);
    }

    // 5) 出現。次の針は「いまの速さなら届く範囲」に置く。
    //    速くなるほど届く範囲が狭まるので、配置を触らなくても難度が上がる
    while (n.nextNeedleD < n.dist + (VIRTUAL_W - PIN_X) + 30) {
      // 最初の数本は、めどを大きく・振れ幅を小さくして、必ず1本は通せるようにする。
      // 置く高さも糸の入り口（START_Y）へ寄せる。1回当たれば終わるゲームなので、
      // ここを削ると初見が一度も通せないまま帰る
      const ease = Math.max(0, 1 - (n.nextId - 1) / EASY_POSTS);
      const wideH = EYE_WIDE + 30 * ease;
      // 届く距離のうち、どこまで使い切る配置にするか。
      // 速くなるほど届く距離そのものが縮むので、これを一定にしていると
      // 終盤は「めどがほぼ一直線に並ぶ」＝逆に易しくなってしまう
      // （実測: 上手いボットの最高が中央値の10倍まで伸びた）。40秒すぎから余裕を詰める。
      const tight = 0.75 + Math.min(0.2, Math.max(0, (s.time - 40) * 0.005));
      const reach = reachAt(n.speed) * tight * (1 - 0.8 * ease);
      const base = n.lastEyeY + (START_Y - n.lastEyeY) * ease * 0.7;
      const eyeY = clamp(
        base + rng.range(-reach, reach),
        TOP + wideH + 5,
        BOT - wideH - 5,
      );
      const eyes: Eye[] = [{ y: eyeY, h: wideH, thin: false, threaded: false }];

      // 細い針は太い針のすぐ隣に立てる。取りに行くと次の針まで持ち直す距離が増える、
      // というだけの代償にしておく（遠くに置くと運任せになる）
      const off = wideH + BAR + EYE_THIN;
      if (s.time > 8 && rng.chance(0.42)) {
        const up = eyeY - off >= TOP + EYE_THIN + 5;
        const down = eyeY + off <= BOT - EYE_THIN - 5;
        const dir = up && down ? (rng.chance(0.5) ? -1 : 1) : up ? -1 : down ? 1 : 0;
        if (dir !== 0) {
          eyes.push({ y: eyeY + dir * off, h: EYE_THIN, thin: true, threaded: false });
        }
      }

      needles.push({ id: n.nextId, d: n.nextNeedleD, eyes, done: false, hit: false });
      n.nextId += 1;
      n.lastEyeY = eyeY;
      n.nextNeedleD += TUNE.gapX;
    }
    n.needles = needles;

    return n;
  },

  draw(g: Painter, s) {
    const [shakeX, shakeY] = shakeOffset(s, s.time);

    // 布。流れているのが分かるように、織り目を距離に合わせて動かす
    g.rect(0, TOP, VIRTUAL_W, BOT - TOP, 'bg2');
    const weave = s.dist % 18;
    for (let x = VIRTUAL_W - weave; x > -18; x -= 18) {
      g.rect(x, TOP, 1, BOT - TOP, 'line');
    }
    g.rect(0, TOP, VIRTUAL_W, 1, 'line');
    g.rect(0, BOT - 1, VIRTUAL_W, 1, 'line');

    // 針。布に立ててある。めどのところだけ胴がふくらむ（針の形はここで決まる）
    for (const p of s.needles) {
      const cx = needleX(s.dist, p) + shakeX;
      if (cx > VIRTUAL_W + 8 || cx < -12) continue;
      const x = Math.round(cx - NEEDLE_W / 2);
      const col = p.hit ? 'bad' : 'ink';

      g.rect(x, TOP, NEEDLE_W, BOT - TOP, col);
      // 金属の照り。1本の線を入れるだけで「棒」ではなく「針」に見える
      g.rect(x + 1, TOP, 1, BOT - TOP, p.hit ? 'bad' : 'dim');
      // 先端（上）
      g.poly([x, TOP + 7, x + NEEDLE_W, TOP + 7, x + NEEDLE_W / 2, TOP - 4], col);

      for (const e of p.eyes) {
        const edge = e.thin ? 'accent' : 'dim';
        // めどのまわりのふくらみ
        g.rect(x - 2, e.y - e.h - 7, NEEDLE_W + 4, e.h * 2 + 14, col);
        g.rect(x - 2, e.y - e.h - 7, 1, e.h * 2 + 14, p.hit ? 'bad' : 'dim');
        // めど（穴）。布ごと抜けて背景が見える
        g.rect(x - 1, e.y - e.h, NEEDLE_W + 2, e.h * 2, 'bg');
        g.rect(x - 1, e.y - e.h - 1, NEEDLE_W + 2, 1, edge);
        g.rect(x - 1, e.y + e.h, NEEDLE_W + 2, 1, edge);
        // 細い針は、めどのそばに点数を書いておく。
        // 凡例を下段に置くだけでは、遊んでいる最中の視線は針にあるので届かない（E章「予告」）
        if (e.thin && !p.hit) {
          g.text('5', x + NEEDLE_W + 4, e.y - 6, { size: 11, color: 'accent' });
        }
        // 通した針は糸をつけたまま流れていく。ここが「通した」の証拠になる
        if (e.threaded) {
          g.rect(x - 2, e.y - 1, NEEDLE_W + 4, 3, 'accent2');
          g.circle(x + NEEDLE_W / 2, e.y, 2, 'good');
        }
      }
    }

    // 糸。ここに残る線が、そのまま「さっき自分がどう動いたか」になる
    let prev: { x: number; y: number } | null = null;
    for (const t of s.trail) {
      const x = PIN_X - (s.dist - t.d) + shakeX;
      const y = t.y + shakeY;
      if (prev) g.line(prev.x, prev.y, x, y, 'accent2', 2);
      prev = { x, y };
    }
    const tipX = (s.tumble.on ? s.tumble.x : PIN_X) + shakeX;
    const tipY = (s.tumble.on ? s.tumble.y : s.y) + shakeY;
    if (prev) g.line(prev.x, prev.y, tipX, tipY, 'accent2', 2);

    // 糸が切れた印
    if (s.over && s.tumble.on) {
      const cx = PIN_X - (s.dist - s.cutD) + shakeX;
      g.circleLine(cx, s.cutY + shakeY, 6, 'bad', 2);
    }

    // 糸の先
    g.at(tipX, tipY, s.tumble.on ? s.tumble.rot : 0, () => {
      g.rect(-14, -1, 19, 3, 'accent2');
      g.poly([5, -4, 5, 4, 13, 0], 'accent');
    });

    // 取れた点数。音を消していても、取れたか取れていないかがここで分かる
    for (const f of s.floats) {
      const k = 1 - f.t / 0.6;
      const x = PIN_X - (s.dist - f.d) + shakeX;
      g.alpha(1 - k * k, () => {
        // 細い針は輪を大きく太くする。時間を止められないぶん、ここで手応えを出す
        g.circleLine(x, f.y + shakeY, (f.thin ? 10 : 8) + k * (f.thin ? 24 : 14), f.thin ? 'accent' : 'good', f.thin ? 3 : 2);
        g.text(f.text, x, f.y + f.dir * (12 + k * 16) - 6, {
          size: f.thin ? 14 : 12,
          align: 'center',
          color: f.thin ? 'accent' : 'good',
        });
      });
    }

    // 状態の段。何本通したか・いま何倍か・どうなったら終わりか、を1行で置く
    g.text(`${s.passed}本`, 8, 19, { size: 12, color: 'ink' });
    const stitches = s.passed === 0 ? 0 : s.passed % STITCH_ROW || STITCH_ROW;
    for (let i = 0; i < stitches; i++) {
      g.rect(46 + i * 8, 24, 5, 3, 'accent2');
    }
    const mult = multOf(s.passed);
    g.text(`×${mult}`, VIRTUAL_W - 8, 18, {
      size: 14,
      align: 'right',
      color: mult > 1 ? 'accent' : 'dim',
    });

    // 凡例。色に意味を持たせたら意味を、終わり方は終わり方を、画面に出しておく
    // （「どうなったら終わりか分からない」「色の意味が分からない」は遊ぶと必ず出る指摘）
    g.rect(8, BOT + 8, 10, 2, 'accent');
    g.rect(8, BOT + 13, 10, 2, 'accent');
    g.text('金のめど 5てん', 23, BOT + 5, { size: 9, color: 'dim' });
    g.text('あたったら おわり', VIRTUAL_W - 8, BOT + 5, {
      size: 9,
      align: 'right',
      color: 'bad',
    });

    // 判定表示。決まった瞬間だけ一瞬大きくなる
    if (s.judgeTimer > 0) {
      const size = Math.round(15 * popScale(s, 0.4));
      const w = g.measure(s.judgeText, size) + 14;
      // 通しためどと反対側の段に出す。上に固定すると、上のめどを通したとき字が針に埋もれる
      const jy = s.judgeLow ? BOT - 30 : TOP + 7;
      g.alpha(0.8, () => g.rect(PIN_X - w / 2, jy, w, size + 7, 'bg'));
      g.text(s.judgeText, PIN_X, jy + 3, {
        size,
        align: 'center',
        color: s.judgeGood ? 'good' : 'bad',
      });
    }
  },

  /**
   * 上手い人の再現。次の針のめどに高さを合わせに行くだけ。
   * 細い針は「いまの速さで届くなら」取りに行く（届かないのに欲張ると当たる）。
   */
  bot(s) {
    let next: Needle | null = null;
    for (const p of s.needles) {
      if (p.done) continue;
      if (needleX(s.dist, p) + NEEDLE_W < PIN_X) continue;
      if (!next || p.d < next.d) next = p;
    }
    if (!next) return { press: s.y > (TOP + BOT) / 2 };

    const room = V_MAX * Math.max(0.05, (needleX(s.dist, next) - PIN_X) / s.speed);
    let target = nearestEye(next, s.y).y;
    for (const e of next.eyes) {
      if (e.thin && Math.abs(e.y - s.y) <= room * 0.75) target = e.y;
    }
    // 0.1秒後、いま押していなければどこにいるか。目標より下に落ちるなら押す
    const t = 0.1;
    const vy2 = Math.min(V_MAX, s.vy + G * t);
    return { press: s.y + ((s.vy + vy2) / 2) * t > target };
  },

  reason(s) {
    return s.deathReason || '糸が切れた';
  },

  tunables: {
    scrollBase: {
      label: '布が流れる速さ',
      min: 38,
      max: 95,
      get: () => TUNE.scrollBase,
      set: (v) => {
        TUNE.scrollBase = v;
      },
    },
    scrollGain: {
      label: '速くなり方',
      min: 0.5,
      max: 3.5,
      get: () => TUNE.scrollGain,
      set: (v) => {
        TUNE.scrollGain = v;
      },
    },
    gapX: {
      label: '針の間隔',
      min: 52,
      max: 110,
      get: () => TUNE.gapX,
      set: (v) => {
        TUNE.gapX = v;
      },
    },
  },
});
