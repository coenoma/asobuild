import type { GameMeta } from '@/arcade/types';

/**
 * 育てる型（nurture）の見本。
 *
 * 反射ゲームとは要求が正反対で、「放置しても壊れない」ことがゲートの必須項目になる。
 * 型を変えると何が変わるのかを、実物で示すために置いている。
 */
export const meta: GameMeta = {
  slug: 'tamago',
  title: 'たまごポン',
  howto: 'タップでえさ・長押しでなでる',
  control: 'tap-hold',
  genre: 'nurture',
  released: '2026-08-11',
  unit: 'そだち',
  theme: 'keitai',
  constraint: '育てる型のテンプレとして作成',
  goals: [
    { score: 60, label: 'かけだし' },
    { score: 200, label: 'ひよっこ' },
    { score: 430, label: 'いい親' },
    { score: 700, label: '名人級' },
  ],
};
