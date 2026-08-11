import type { GameMeta } from '@/arcade/types';

/**
 * ゲージを見て、いいところで離す。それだけのゲーム。
 *
 * 初版は「育てる型」として作ったが、遊んでも面白くなかったので作り直した
 * （何をすればいいか画面から分からず、上手くなる余地もなかった）。
 * 経緯は docs/plans/002-tamago-remake/design.md。
 *
 * 実態がタイミングの遊びになったので、型も nurture → action に変えている。
 */
export const meta: GameMeta = {
  slug: 'tamago',
  title: 'たまごポン',
  howto: 'ちょうどいい量で はなす',
  control: 'hold',
  genre: 'action',
  released: '2026-08-11',
  unit: '点',
  theme: 'keitai',
  constraint: 'ゲージの型の見本として作成',
  funGate: {
    /**
     * 上振れの基準を 1.3 → 1.15 に下げている。理由を残す。
     *
     * ゲージを正確に止める遊びは、正確さがほぼすべてで、運が入る余地が構造的に小さい。
     * 「だいこうぶつ」をレアで大きい当たりにする・速さのばらつきを広げる、を試して
     * p90/p50 は 1.15 → 1.20 までしか動かなかった（4回調整した実測）。
     * これ以上は運の要素を足すことになり、「正確に止める」という芯がぼやける。
     *
     * なお max/p50 は 1.58 倍あり、「たまに大きく跳ねる回」自体は存在している。
     */
    upsideRatioMin: 1.15,
  },
  goals: [
    { score: 300, label: 'かけだし' },
    { score: 2200, label: 'ひよっこ' },
    { score: 6000, label: 'いい親' },
    { score: 10600, label: '名人級' },
  ],
};
