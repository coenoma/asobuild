/**
 * 機種の登録簿。
 *
 * 「アソビルド」の射程は 2000年前後〜2000年代なかばの遊び文化で、
 * その中の「どの画面で遊ばれていたか」をここで1機種＝1プリセットにしている。
 * ゲームは meta.platform で機種を選ぶだけで、寸法・向き・描画の質感・
 * 入力の想定がまとめて決まる。
 *
 * 🔴 **その機種でゲームが1本でも公開されたら、寸法と描画方式は変えない。**
 * 変えると、その機種の既存ゲームの座標が全部ずれる（.claude/rules/arcade.md）。
 *
 * 機種の選び方・増やすときの手順は docs/design/platforms.md。
 */

import type { GameMeta, PlatformName, ThemeName } from './types';
import { VIRTUAL_H, VIRTUAL_W } from './types';

export interface Platform {
  name: PlatformName;
  /** 画面や文書に出す短い名前 */
  label: string;
  /** どの時代の何か。一覧やゲームページの説明に使える一行 */
  era: string;
  /** 論理解像度。ゲームはこの座標系にだけ描く */
  w: number;
  h: number;
  /**
   * ドット拡大（true）か、なめらか描画（false）か。
   *
   * keitai / arcade はドットが時代の実物。
   * flash は当時からベクター描画（寿司打もドット絵ではない）なので、なめらか。
   */
  pixelated: boolean;
  /** meta.theme を省略したときのテーマ（palette.ts と対応） */
  defaultTheme: ThemeName;
  /** タイトル画面に出す機種由来の操作の補足。無ければ出ない */
  extraHint?: string;
}

export const PLATFORMS: Record<PlatformName, Platform> = {
  keitai: {
    name: 'keitai',
    label: 'ケータイ',
    era: '2000年代なかばのカラーケータイ',
    w: VIRTUAL_W,
    h: VIRTUAL_H,
    pixelated: true,
    defaultTheme: 'keitai',
  },
  flash: {
    name: 'flash',
    label: 'PCブラウザ',
    era: '2000年前後〜の個人サイトの Flash ゲーム',
    // Flash MX の既定ステージそのまま（550×400）。当時いちばん多かった寸法
    w: 550,
    h: 400,
    pixelated: false,
    defaultTheme: 'flash',
  },
  arcade: {
    name: 'arcade',
    label: 'ゲーセン',
    era: '90年代末〜2000年前後のゲームセンター',
    // CPS2（スト2などの基板）の実寸。横に広いのでレース・ベルト・格闘に向く
    w: 384,
    h: 224,
    pixelated: true,
    defaultTheme: 'arcade',
    extraHint: 'ゲームパッドでも遊べます',
  },
};

/** メタ情報から機種を引く。省略時は keitai */
export function platformOf(meta: Pick<GameMeta, 'platform'>): Platform {
  return PLATFORMS[meta.platform ?? 'keitai'];
}
