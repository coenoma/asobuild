import type { GameMeta } from '@/arcade/types';

export const meta: GameMeta = {
  slug: 'tamatsunagi',
  title: 'たまつなぎ',
  // 20文字以内。読まなくても分かる一行にする
  howto: 'あなの真ん中で つきあげる',
  control: 'tap',
  genre: 'action',
  released: '2026-08-11',
  unit: '点',
  theme: 'keitai',
  constraint: '「狭いところを通す」だけで作る',
  // 糸まわりの言葉で刻む。最初の「みならい」は1〜2プレイで届く線
  goals: [
    { score: 40, label: 'みならい' },
    { score: 150, label: 'いとぐち' },
    { score: 420, label: '玉さばき' },
    { score: 1000, label: 'ひとすじ' },
  ],
  inspiration: {
    from: '2000年代のケータイゲームにあった「狭い隙間を通す」手触り',
    borrowed:
      '極小の穴を狙って通す気持ちよさと、「大きく外すより、かすったほうが致命傷」という緊張の作り方',
    original:
      '遊びの仕組み（降りてくる玉を下から突き上げて糸に通す／下ほど中央に寄る／かすると糸が切れる）・玉と針と糸の絵・画面構成・音・称号・判定幅と難度の数値・コード',
  },
};
