/**
 * 効果音。音源ファイルは持たない（WebAudio で矩形波を鳴らすだけ）。
 *
 * 音のためにアセットを用意し始めると 15 分では終わらない。
 * ピコピコ鳴っていればガラケー感は出るので、これで十分。
 */

type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine';

/** 音の並びの1つ。f に配列を渡すと和音（当時にならって3音まで） */
interface Note {
  /** 周波数。0 を渡すと休符 */
  f: number | number[];
  /** 長さ（秒） */
  d: number;
  /** 音量 */
  v?: number;
}

/** よく使う音階。数字はオクターブ */
const N = {
  C4: 261.63,
  E4: 329.63,
  G4: 392.0,
  B4: 493.88,
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  C6: 1046.5,
  E6: 1318.51,
  G6: 1567.98,
} as const;

interface BeepOptions {
  freq: number;
  /** 秒 */
  dur?: number;
  type?: Wave;
  vol?: number;
  /** 終端の周波数（指定すると鳴っている間に滑らせる） */
  to?: number;
}

const MUTE_KEY = 'asobuild:mute';

class Sfx {
  private ctx: AudioContext | null = null;
  private muted = false;

  init(): void {
    if (typeof window === 'undefined') return;
    this.muted = window.localStorage.getItem(MUTE_KEY) === '1';
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    }
    return this.muted;
  }

  beep(opts: BeepOptions): void {
    if (this.muted) return;
    if (!this.ctx) this.init();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const dur = opts.dur ?? 0.08;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.type ?? 'square';
    osc.frequency.setValueAtTime(opts.freq, ctx.currentTime);
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), ctx.currentTime + dur);
    const vol = (opts.vol ?? 0.12);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  /** 押した感触 */
  tap(): void {
    this.beep({ freq: 660, dur: 0.04, vol: 0.07 });
  }
  /** 加点 */
  score(pitch = 0): void {
    this.beep({ freq: 880 + pitch * 60, dur: 0.06, type: 'square', vol: 0.1 });
  }
  /** 連続成功。音程が上がっていくと気持ちいい */
  combo(step: number): void {
    this.beep({ freq: 660 + Math.min(step, 12) * 55, dur: 0.06, vol: 0.1 });
  }
  /** 失敗・被弾 */
  hit(): void {
    this.beep({ freq: 220, to: 90, dur: 0.16, type: 'sawtooth', vol: 0.12 });
  }
  /** ゲームオーバー */
  over(): void {
    this.beep({ freq: 330, to: 70, dur: 0.5, type: 'triangle', vol: 0.14 });
  }
  /**
   * 音の並びを鳴らす。`f` に配列を渡すと和音になる。
   *
   * 当時のケータイの着メロは同時に鳴らせる音が3つまでで、
   * あの「和音メロディ」の手触りはその制約から来ている。ここでも3音までに収める。
   *
   * setTimeout ではなく WebAudio の時刻指定で並べているので、
   * 画面が重いときでもリズムが崩れない。
   */
  sequence(notes: Note[], opts: { type?: Wave; gap?: number; vol?: number } = {}): void {
    if (this.muted) return;
    if (!this.ctx) this.init();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    let at = ctx.currentTime;
    const gap = opts.gap ?? 0.012;
    for (const note of notes) {
      const freqs = (Array.isArray(note.f) ? note.f : [note.f]).filter((f) => f > 0).slice(0, 3);
      // 和音は音量を分ける。分けないと音が割れる
      const vol = (note.v ?? opts.vol ?? 0.1) / Math.max(1, freqs.length);
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = opts.type ?? 'square';
        osc.frequency.setValueAtTime(f, at);
        gain.gain.setValueAtTime(vol, at);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + note.d);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + note.d);
      }
      at += note.d + gap;
    }
  }

  /** ゲーム開始 */
  jingleStart(): void {
    this.sequence([
      { f: N.G5, d: 0.07 },
      { f: [N.C6, N.E6], d: 0.16 },
    ]);
  }

  /** ハイスコア更新 */
  best(): void {
    this.sequence([
      { f: N.C6, d: 0.09 },
      { f: N.E6, d: 0.09 },
      { f: N.G6, d: 0.09 },
      { f: [N.C6, N.E6, N.G6], d: 0.34 },
    ]);
  }

  /** 称号を取った。いちばん派手にする */
  jingleGoal(): void {
    this.sequence([
      { f: [N.C5, N.E5], d: 0.1 },
      { f: [N.E5, N.G5], d: 0.1 },
      { f: [N.G5, N.C6], d: 0.1 },
      { f: [N.C6, N.E6, N.G6], d: 0.45 },
    ]);
  }

  /** 力尽きた。下がりながら消える */
  jingleOver(): void {
    this.sequence(
      [
        { f: [N.G4, N.B4], d: 0.13 },
        { f: [N.E4, N.G4], d: 0.13 },
        { f: [N.C4, N.E4], d: 0.42 },
      ],
      { type: 'triangle', vol: 0.13 },
    );
  }
  /** カウントダウン等 */
  tick(): void {
    this.beep({ freq: 440, dur: 0.03, vol: 0.06, type: 'triangle' });
  }
}

export const sfx = new Sfx();
