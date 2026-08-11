/**
 * 効果音。音源ファイルは持たない（WebAudio で矩形波を鳴らすだけ）。
 *
 * 音のためにアセットを用意し始めると 15 分では終わらない。
 * ピコピコ鳴っていればガラケー感は出るので、これで十分。
 */

type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine';

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
  /** ハイスコア更新 */
  best(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => {
      window.setTimeout(() => this.beep({ freq: f, dur: 0.1, vol: 0.12 }), i * 90);
    });
  }
  /** カウントダウン等 */
  tick(): void {
    this.beep({ freq: 440, dur: 0.03, vol: 0.06, type: 'triangle' });
  }
}

export const sfx = new Sfx();
