import type { GameMeta } from '@/arcade/types';

/**
 * メタ情報だけを本体と分けているのは、一覧ページや OGP がゲーム本体を
 * 読み込まずに済むようにするため（ゲームが増えても一覧が重くならない）。
 */
export const meta: GameMeta = {
  slug: 'hanko',
  title: 'ハンコ課長',
  howto: 'ワクに来たら押す・赤はダメ',
  control: 'tap',
  released: '2026-08-11',
  unit: '点',
  theme: 'keitai',
  constraint: 'テンプレの見本として作成',
  // 出世が「次もやる理由」になる。最後の「部長」で一区切りつく幅にしてある
  goals: [
    { score: 100, label: '主任' },
    { score: 300, label: '係長' },
    { score: 700, label: '課長' },
    { score: 1050, label: '部長' },
  ],
};
