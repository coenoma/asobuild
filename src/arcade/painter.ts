/**
 * 描画ヘルパ。
 *
 * ゲームは 240x320 の仮想解像度にだけ描く。実画面への拡大は GameCanvas が
 * ニアレストネイバーでやるので、何を描いても勝手にドットが粗くなり、
 * 「昔のケータイの画面」に見える。ここが見た目を揃える一番の仕掛け。
 */

import { getPalette, type ColorKey, type Palette } from './palette';
import { VIRTUAL_H, VIRTUAL_W, type ThemeName } from './types';

export interface TextOptions {
  color?: ColorKey;
  /** 文字サイズ（仮想座標系 px）。既定 12 */
  size?: number;
  align?: 'left' | 'center' | 'right';
  /** 縦位置の基準。既定 'top' */
  baseline?: 'top' | 'middle' | 'bottom';
}

export interface SpriteOptions {
  /** 1ドットの大きさ。既定 1 */
  scale?: number;
  /** パターン中の文字と色の対応。既定は X→ink */
  colors?: Record<string, ColorKey>;
  /** x,y をスプライト中心として扱う。既定 false（左上基準） */
  center?: boolean;
}

export class Painter {
  readonly w = VIRTUAL_W;
  readonly h = VIRTUAL_H;
  readonly p: Palette;
  /** Canvas の font 指定に使うフォントファミリ */
  fontFamily = '"DotGothic16", monospace';

  constructor(
    private ctx: CanvasRenderingContext2D,
    theme: ThemeName = 'keitai',
  ) {
    this.p = getPalette(theme);
  }

  /** 色キーを実際の色文字列へ。生の hex を渡されても一応通すが、規約では禁止 */
  color(key: ColorKey | string): string {
    return (this.p as unknown as Record<string, string>)[key as string] ?? String(key);
  }

  clear(color: ColorKey = 'bg'): void {
    this.ctx.fillStyle = this.color(color);
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  rect(x: number, y: number, w: number, h: number, color: ColorKey = 'ink'): void {
    this.ctx.fillStyle = this.color(color);
    this.ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  rectLine(x: number, y: number, w: number, h: number, color: ColorKey = 'ink', width = 1): void {
    this.ctx.strokeStyle = this.color(color);
    this.ctx.lineWidth = width;
    this.ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  }

  circle(x: number, y: number, r: number, color: ColorKey = 'ink'): void {
    this.ctx.fillStyle = this.color(color);
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.fill();
  }

  circleLine(x: number, y: number, r: number, color: ColorKey = 'ink', width = 1): void {
    this.ctx.strokeStyle = this.color(color);
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  line(x1: number, y1: number, x2: number, y2: number, color: ColorKey = 'ink', width = 1): void {
    this.ctx.strokeStyle = this.color(color);
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();
  }

  /** 多角形。points は [x, y, x, y, ...] */
  poly(points: number[], color: ColorKey = 'ink'): void {
    if (points.length < 6) return;
    this.ctx.fillStyle = this.color(color);
    this.ctx.beginPath();
    this.ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) this.ctx.lineTo(points[i], points[i + 1]);
    this.ctx.closePath();
    this.ctx.fill();
  }

  text(str: string, x: number, y: number, opts: TextOptions = {}): void {
    const size = opts.size ?? 12;
    this.ctx.fillStyle = this.color(opts.color ?? 'ink');
    this.ctx.font = `${size}px ${this.fontFamily}`;
    this.ctx.textAlign = opts.align ?? 'left';
    this.ctx.textBaseline = opts.baseline ?? 'top';
    this.ctx.fillText(str, Math.round(x), Math.round(y));
  }

  /** テキストの表示幅（仮想座標系）。レイアウト調整用 */
  measure(str: string, size = 12): number {
    this.ctx.font = `${size}px ${this.fontFamily}`;
    return this.ctx.measureText(str).width;
  }

  /**
   * ドット絵。パターンは文字列の配列で書く。
   *
   *   g.sprite(['.XX.', 'XXXX', '.XX.'], 100, 100, { scale: 3, colors: { X: 'accent' } })
   *
   * 空白と '.' は透明。それ以外の文字は colors で色を引く（既定は ink）。
   */
  sprite(pattern: readonly string[], x: number, y: number, opts: SpriteOptions = {}): void {
    const scale = opts.scale ?? 1;
    const colors = opts.colors ?? {};
    const rows = pattern.length;
    const cols = Math.max(...pattern.map((r) => r.length));
    let ox = Math.round(x);
    let oy = Math.round(y);
    if (opts.center) {
      ox = Math.round(x - (cols * scale) / 2);
      oy = Math.round(y - (rows * scale) / 2);
    }
    for (let row = 0; row < rows; row++) {
      const linePattern = pattern[row];
      for (let col = 0; col < linePattern.length; col++) {
        const ch = linePattern[col];
        if (ch === '.' || ch === ' ') continue;
        this.ctx.fillStyle = this.color(colors[ch] ?? 'ink');
        this.ctx.fillRect(ox + col * scale, oy + row * scale, scale, scale);
      }
    }
  }

  /** 透明度つきで描く（オーバーレイ・点滅演出用） */
  alpha(a: number, fn: () => void): void {
    const prev = this.ctx.globalAlpha;
    this.ctx.globalAlpha = a;
    fn();
    this.ctx.globalAlpha = prev;
  }

  /** 座標変換して描く（回転する物体など） */
  at(x: number, y: number, rotation: number, fn: () => void): void {
    this.ctx.save();
    this.ctx.translate(x, y);
    if (rotation) this.ctx.rotate(rotation);
    fn();
    this.ctx.restore();
  }

  /** 矩形でクリップして描く */
  clip(x: number, y: number, w: number, h: number, fn: () => void): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.ctx.clip();
    fn();
    this.ctx.restore();
  }
}
