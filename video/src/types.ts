/**
 * 編集台本（EDL）の形。
 *
 * **コードには「どう描くか」だけを置き、「何をどの順で出すか」は edl/*.json に置く。**
 * こうしておくと、ナレーションが上がってきたあとに章の尺を調整して
 * 描き直すだけで済む（docs/video/structure.md §ナレーションは後から乗せる）。
 */

/** 元素材。startedAt は「その録画が始まった実時刻」 */
export interface Source {
  file: string;
  startedAt: string;
}

/** 元素材のどこを切り取るか。out を書くと切ったあとに縮める */
export interface Crop {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  out?: { w: number; h: number };
}

/** 切り出す1本。in は元素材の中での秒数 */
export interface Clip {
  src: string;
  crop: string;
  in: number;
  dur: number;
  speed?: number;
  /** 何の画か。編集中に自分が読むためのメモ */
  note?: string;
}

/** 画面のどこに置くか。1920×1080 の中の位置（%指定） */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Layer =
  /** 素材を出す */
  | {
      type: 'shot';
      clip: string;
      at: number;
      dur: number;
      box?: Box;
      /** 枠に対して埋める（はみ出しは切る）か、収める */
      fit?: 'cover' | 'contain';
      /** 寄り・引き。1 で等倍、1.2 で 20% 寄る。[from, to] を渡すと動く */
      zoom?: number | [number, number];
      /** 寄る中心（0〜1）。既定は中央 */
      origin?: [number, number];
      /** ワイプ（自撮りの小窓）。主役のショットではない、という印 */
      wipe?: boolean;
      /** 枠線をつける（ワイプに使う） */
      frame?: boolean;
    }
  /** テロップ */
  | {
      type: 'telop';
      at: number;
      dur: number;
      text: string;
      style?: 'main' | 'sub' | 'note' | 'chapter' | 'credit';
      /** voice.mjs --apply が生成した字幕の印。手で書かない（apply のたびに入れ替わる） */
      gen?: boolean;
      /** 画面のどこに置くか。既定は下 */
      place?: 'bottom' | 'top' | 'center' | 'lower-left';
      color?: keyof typeof import('./brand').C;
    }
  /** 数字の強調（スコアなど） */
  | { type: 'number'; at: number; dur: number; value: string; unit?: string; label?: string; color?: 'accent' | 'good' | 'bad'; place?: 'center' | 'right' }
  /** 経過時間の判子。場面が変わったことと、いま何分かを、まとめてバシッと出す */
  | { type: 'timeStamp'; at: number; dur: number; value: string; note?: string; sub?: string; color?: 'accent' | 'good' | 'bad' | 'cool'; variant?: 'stamp' | 'chip' }
  /** 画面のここを見て、と指す（枠＋跳ねる矢印） */
  | { type: 'spot'; at: number; dur: number; box: Box; label?: string; from?: 'left' | 'right' | 'top' | 'bottom'; color?: 'accent' | 'good' | 'bad' | 'cool' }
  /** 下の映像を暗くする。映像を残したまま文字を主役にしたいとき */
  | { type: 'scrim'; at: number; dur: number; amount?: number }
  /** 章タイトル */
  | { type: 'chapterCard'; at: number; dur: number; no: string; title: string }
  /** 確かめた／確かめていない。毎回ここで終わるので使い回せる形にしてある */
  | { type: 'checklist'; at: number; dur: number; title: string; items: { ok: boolean; text: string }[] }
  /** 面白さゲートの結果 */
  | { type: 'gate'; at: number; dur: number; pass: boolean; failed?: string[]; total?: number }
  /** 自作の図解（原作の画は使えないので、仕組みだけ自分で描く） */
  | { type: 'diagram'; at: number; dur: number; kind: 'thread' | 'shift' }
  /** 場面転換のローディング（ゲームの「よみこみ中…」と同じ様式）。連発しない */
  | { type: 'loading'; at: number; dur: number; text?: string; note?: string }
  /** 黒コマ */
  | { type: 'black'; at: number; dur: number }
  /** タイトルカード */
  | { type: 'titleCard'; at: number; dur: number; title: string; sub: string }
  /** 締めのカード */
  | { type: 'endCard'; at: number; dur: number; url: string; lines?: string[] }
  /** 効果音 */
  | { type: 'sfx'; at: number; name: string; volume?: number };

export interface Chapter {
  id: string;
  /** 番組バーに出す章名。空なら出さない */
  label?: string;
  /**
   * この章の心情。**章は出来事ではなく心情で切る**（docs/video/structure.md）。
   * 絵コンテ（scripts/storyboard.mjs）にそのまま出るので、撮った人の言葉で書く。
   */
  mood?: string;
  dur: number;
  /**
   * この章が開発の何分ごろにあたるか（秒）。番組バーの経過とカップの残量に使う。
   * 動画は前に飛んだり後ろに戻ったりするので、**実時間はここで明示する**。
   */
  devFrom?: number;
  devTo?: number;
  /** 番組バーを出さない章（フックと締め） */
  noBar?: boolean;
  layers: Layer[];
}

/**
 * 使ってはいけない区間（元素材の秒数）。
 *
 * scan-risk.mjs が出した候補を人が見て、危ないものをここへ書き写す。
 * **書いておけば extract.mjs が、うっかりその区間を使った EDL を弾いてくれる。**
 * 候補一覧を見て「気をつける」だけでは漏れる（実際に漏れた）。
 */
export interface Risk {
  src: string;
  from: number;
  to: number;
  why: string;
  /**
   * 効く切り出しの名前。省略すると素材ぜんぶに効く。
   * 「ブラウザ側にだけ映っている」ような危険は、ここを絞らないと
   * 同じ時刻のターミナル側まで使えなくなる。
   */
  crops?: string[];
}

export interface Edl {
  meta: {
    slug: string;
    title: string;
    fps: number;
    width: number;
    height: number;
    /** 番組バーに出す、その回の制約 */
    constraint: string;
    /** 開発の実時間（秒）。番組バーの経過表示に使う */
    devSeconds: number;
    /**
     * 開発の時計 = 画面収録の時刻 + これ（秒）。
     * 001は48。実測で、AIの「◯m◯s thinking」表示とこの値が一致する
     * （依頼を投げたのは収録開始の48秒前だった）。
     */
    devOffset?: number;
  };
  sources: Record<string, Source>;
  /** 使ってはいけない区間。extract.mjs がここと clips を突き合わせる */
  risks?: Risk[];
  crops: Record<string, Crop>;
  clips: Record<string, Clip>;
  chapters: Chapter[];
}
