/**
 * ブラウザ入力を「押しているか」の1ビットに畳む。
 *
 * マウス・タッチ・スペースキー・Enter をすべて同じ扱いにする。
 * ゲーム側が入力の種類を意識しなくていいので、
 * 「スマホでもPCでも遊べる」が毎回タダで手に入る。
 */

import { VIRTUAL_H, VIRTUAL_W } from './types';

export class InputSource {
  press = false;
  px = VIRTUAL_W / 2;
  py = VIRTUAL_H / 2;
  /** 一度でも入力があったか（音の解禁判定に使う） */
  touched = false;

  private pointers = new Set<number>();
  private keys = new Set<string>();

  attach(el: HTMLElement): () => void {
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
      if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      this.keys.add(e.key);
      this.sync();
    };
    const keyUp = (e: KeyboardEvent) => {
      this.keys.delete(e.key);
      this.sync();
    };
    const blur = () => {
      this.pointers.clear();
      this.keys.clear();
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
    if (next) this.touched = true;
    this.press = next;
  }
}
