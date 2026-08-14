/**
 * ブラウザ入力を「押しているか」の1ビットに畳む。
 *
 * マウス・タッチ・スペースキー・Enter をすべて同じ扱いにする。
 * ゲーム側が入力の種類を意識しなくていいので、
 * 「スマホでもPCでも遊べる」が毎回タダで手に入る。
 *
 * 例外として、操作そのものが題材になっている遊び（曲がる・打つ）だけ、
 * attach() の指定で左右と打鍵を拾えるようにしてある。
 * **既定では拾わない。** 常に拾うと、ページの矢印キー操作や文字入力を奪ってしまう。
 */

import { VIRTUAL_H, VIRTUAL_W } from './types';

/** 1ビットに畳まない入力を、使うゲームでだけ有効にする */
export interface InputOptions {
  /** 左右キーと、画面の左右どちら側を押しているかをハンドルとして拾う（control:'steer'） */
  steer?: boolean;
  /** 打った文字を拾う（control:'type'）。スペースも「文字」になり、押下には使われなくなる */
  text?: boolean;
  /** 機種の論理解像度。ポインタ座標をこの座標系に変換する。省略時は keitai */
  dims?: { w: number; h: number };
}

export class InputSource {
  press = false;
  /**
   * 直近のフレーム処理より後に押し始めたか。
   *
   * これが無いと、押してすぐ離す素早いタップ（down と up が同じフレーム内で起きる）を
   * 取りこぼす。`press` の変化だけを見ていると、フレーム処理のときには既に false に
   * 戻っていて「押されなかった」ことになってしまう。
   */
  justPressed = false;
  justReleased = false;
  px = VIRTUAL_W / 2;
  py = VIRTUAL_H / 2;
  /** 一度でも入力があったか（音の解禁判定に使う） */
  touched = false;
  /**
   * このフレームで打たれた文字（打った順）。text を有効にしたときだけ入る。
   * endFrame() で空に戻るので、1フレームのあいだだけ有効。
   */
  typed: string[] = [];

  private pointers = new Set<number>();
  private keys = new Set<string>();
  private arrows = new Set<string>();
  private opts: InputOptions = {};
  private dims = { w: VIRTUAL_W, h: VIRTUAL_H };
  /** ゲームパッドの状態（pollGamepad が毎フレーム入れ替える） */
  private padPress = false;
  private padSteer = 0;

  /**
   * 左右の傾き。-1（左）／0（まっすぐ）／+1（右）の3値。
   *
   * 矢印キー → ゲームパッド → 画面のどちら側を押しているか、の順で見る。
   * 中央には不感帯を置いてある（まっすぐ走りたいときに勝手に曲がらないように）。
   */
  get steer(): number {
    const left = this.arrows.has('ArrowLeft');
    const right = this.arrows.has('ArrowRight');
    if (left !== right) return left ? -1 : 1;
    if (this.padSteer !== 0) return this.padSteer;
    if (!this.opts.steer || this.pointers.size === 0) return 0;
    const half = this.dims.w / 2;
    const dead = this.dims.w * 0.08;
    if (this.px < half - dead) return -1;
    if (this.px > half + dead) return 1;
    return 0;
  }

  /**
   * ゲームパッドを読む。ループ側が毎フレーム呼ぶ（イベントが来ない入力なので）。
   *
   * 十字キーとスティックは steer に、面ボタンのどれかは「押す」に写すだけ。
   * ボタンごとの意味づけはしない——増やすなら docs/design/platforms.md の
   * 「複数ボタン」の手順から（黙って軸を増やすと「入力は1つ」が崩れる）。
   */
  pollGamepad(): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
    let press = false;
    let steer = 0;
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      // 十字キー（標準マッピングの 14=左 / 15=右）優先、無ければ左スティックをデジタル化
      if (pad.buttons[14]?.pressed) steer = -1;
      else if (pad.buttons[15]?.pressed) steer = 1;
      else {
        const x = pad.axes[0] ?? 0;
        if (x < -0.5) steer = -1;
        else if (x > 0.5) steer = 1;
      }
      // 面ボタン（A/B/X/Y）はどれも「押す」。押し分けはさせない
      if ([0, 1, 2, 3].some((i) => pad.buttons[i]?.pressed)) press = true;
    }
    this.padSteer = steer;
    if (press || steer !== 0) this.touched = true;
    if (press !== this.padPress) {
      this.padPress = press;
      this.sync();
    }
  }

  attach(el: HTMLElement, opts: InputOptions = {}): () => void {
    this.opts = opts;
    if (opts.dims) {
      this.dims = opts.dims;
      this.px = opts.dims.w / 2;
      this.py = opts.dims.h / 2;
    }
    const rectToVirtual = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      this.px = ((clientX - r.left) / r.width) * this.dims.w;
      this.py = ((clientY - r.top) / r.height) * this.dims.h;
    };

    const down = (e: PointerEvent) => {
      e.preventDefault();
      this.pointers.add(e.pointerId);
      rectToVirtual(e.clientX, e.clientY);
      this.sync();
    };
    const move = (e: PointerEvent) => {
      if (this.pointers.size === 0) return;
      rectToVirtual(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.sync();
    };
    const keyDown = (e: KeyboardEvent) => {
      // 修飾キーつきはブラウザやOSの操作なので横取りしない（再読み込み・タブ切り替え等）
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // 日本語入力の変換中は、キーがそのまま文字になっていない
      if (e.isComposing) return;

      if (opts.steer && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        this.arrows.add(e.key);
        this.touched = true;
        return;
      }

      if (opts.text) {
        // 打鍵は「押しているか」ではなく「打たれた文字」として扱う。
        // ここでスペースを押下に混ぜると、スペースを打てないゲームになる
        if (e.key.length === 1) {
          e.preventDefault();
          this.typed.push(e.key);
          this.touched = true;
          return;
        }
        // 始める・もう一回は Enter に寄せる（スペースは文字として使うため）
        if (e.key !== 'Enter') return;
      } else if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'ArrowUp') {
        return;
      }

      e.preventDefault();
      this.keys.add(e.key);
      this.sync();
    };
    const keyUp = (e: KeyboardEvent) => {
      this.arrows.delete(e.key);
      this.keys.delete(e.key);
      this.sync();
    };
    const blur = () => {
      this.pointers.clear();
      this.keys.clear();
      this.arrows.clear();
      this.sync();
    };

    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', blur);

    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', blur);
    };
  }

  private sync() {
    const next = this.pointers.size > 0 || this.keys.size > 0 || this.padPress;
    if (next && !this.press) {
      this.justPressed = true;
      this.touched = true;
    }
    if (!next && this.press) this.justReleased = true;
    this.press = next;
  }

  /** 1フレーム分の処理が終わったら呼ぶ。押した／離した／打った の記録を消す */
  endFrame(): void {
    this.justPressed = false;
    this.justReleased = false;
    // 中身を消すのではなく作り直す。
    // このフレームの配列はリプレイの記録として持ち越されているので、消すと過去が書き換わる
    if (this.typed.length > 0) this.typed = [];
  }
}
