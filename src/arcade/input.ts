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

  /**
   * 左右の傾き。-1（左）／0（まっすぐ）／+1（右）の3値。
   *
   * 矢印キーが優先。押していなければ、指が画面のどちら側にあるかで決める。
   * 中央には不感帯を置いてある（まっすぐ走りたいときに勝手に曲がらないように）。
   */
  get steer(): number {
    const left = this.arrows.has('ArrowLeft');
    const right = this.arrows.has('ArrowRight');
    if (left !== right) return left ? -1 : 1;
    if (!this.opts.steer || this.pointers.size === 0) return 0;
    const half = VIRTUAL_W / 2;
    const dead = VIRTUAL_W * 0.08;
    if (this.px < half - dead) return -1;
    if (this.px > half + dead) return 1;
    return 0;
  }

  attach(el: HTMLElement, opts: InputOptions = {}): () => void {
    this.opts = opts;
    const rectToVirtual = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      this.px = ((clientX - r.left) / r.width) * VIRTUAL_W;
      this.py = ((clientY - r.top) / r.height) * VIRTUAL_H;
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
    const next = this.pointers.size > 0 || this.keys.size > 0;
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
