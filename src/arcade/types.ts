/**
 * アソビルド共通ランタイムの型定義。
 *
 * ここが「1ゲーム＝2ファイルで書ける」の根拠になっている。
 * ゲーム作者が書くのは init / step / draw / bot の 4 関数だけで、
 * 入力・ループ・スコア・ハイスコア・リトライ・共有・レトロ描画は
 * すべて共通ランタイム側が持つ。
 *
 * 最重要の制約: step は「純粋関数」であること。
 * 同じ state・同じ input・同じ dt からは必ず同じ結果が出ること。
 * これが崩れると面白さゲート（npm run fun）が機能しなくなる。
 */

import type { Painter } from './painter';
import type { Rng } from './rng';

/**
 * keitai 機種の仮想解像度（ガラケーの QVGA 縦持ち）。
 *
 * 歴史的にこの定数名のまま各ゲームが import しているので残してある。
 * 機種ごとの解像度は platforms.ts が持つ。keitai 以外の機種で作るときは
 * この定数ではなく `PLATFORMS.<機種>.w / .h` を使うこと。
 */
export const VIRTUAL_W = 240;
/** keitai 機種の仮想解像度の高さ */
export const VIRTUAL_H = 320;
/** 固定タイムステップ（秒）。可変 dt は非決定論になるので使わない */
export const FIXED_DT = 1 / 60;

/** 1フレーム分の入力。操作は原則「1ボタン」に閉じる */
export interface Input {
  /** このフレームで押し始めたか */
  tap: boolean;
  /** 押され続けているか */
  hold: boolean;
  /** このフレームで離したか */
  release: boolean;
  /** ポインタ X（仮想解像度 0..VIRTUAL_W）。control:'aim' 以外は使わない */
  px: number;
  /** ポインタ Y（仮想解像度 0..VIRTUAL_H）。control:'aim' 以外は使わない */
  py: number;
  /**
   * 左右の傾き。-1（左）／0（まっすぐ）／+1（右）の3値。control:'steer' 以外は常に 0。
   *
   * わざと3値にしてある。中間の角度を入力側で作ると、ゲームごとに感度がばらついて
   * シリーズとしての手触りが揃わなくなる。滑らかさはゲーム側で
   * 「いまの角度をこの向きへ少しずつ寄せる」形で作ること（feel.ts と同じ考え方）。
   */
  steer: number;
  /**
   * このフレームで打たれた文字。control:'type' 以外は常に空。
   *
   * 打った順に入る。ほとんどのフレームは0個か1個で、
   * 速い人が同じフレームに2文字打つことがあるので配列にしてある。
   */
  typed: readonly string[];
}

/** すべてのゲーム状態が必ず持つフィールド */
export interface BaseState {
  /** 現在スコア。整数で持つ（表示のブレを防ぐため） */
  score: number;
  /** true になった瞬間にゲームオーバー。step 内で立てる */
  over: boolean;
  /** 開始からの経過秒。ランタイムが自動加算するので step 内で触らない */
  time: number;
  /** 最後まで到達して終わったか（ステージ制など、終わりがあるゲームで使う） */
  cleared?: boolean;
  /**
   * 「呼びかけ」の回数。ゲームがこれを増やすと、共通シェルが短いビープ（ピピッ）を鳴らす。
   *
   * ゲームは音を直接鳴らせない（step は純粋関数で、Node 上のゲートでも走る）。
   * 得点が動いたときの音は共通シェルが勝手に鳴らすが、「得点は動かないが知らせたい」瞬間
   * （育てる型の呼び出しなど）のために、この数を進めるだけで鳴る口を用意してある。
   */
  cue?: number;
}

/**
 * 到達目標。「次もやる理由」と「やりきった感」はここから生まれる。
 *
 * スコアが伸び続けるだけのゲームは、3回遊ぶと飽きる。
 * 段階的な称号があると、1回ごとに「あと少しで次」が生まれ、
 * 全部埋めた時点で「やりきった」が成立する。
 */
export interface Goal {
  /** この点数に到達したら与える */
  score: number;
  /** 称号（4〜6文字） */
  label: string;
}

/**
 * 1フレーム分の操作。
 *
 * ボットの意思・実プレイの操作・リプレイの記録を、**すべて同じ形**で持つ。
 * 別々の形にすると、そのうち食い違って「リプレイだけ結果が違う」が起きる。
 */
export interface Frame {
  /** ボタンを押しているか */
  press: boolean;
  /** control:'aim' のときの狙い先 */
  px?: number;
  py?: number;
  /** control:'steer' のときの左右。-1 / 0 / +1 */
  steer?: number;
  /** control:'type' のときに、このフレームで打った文字 */
  typed?: readonly string[];
}

/** ボットの1フレーム分の意思。press だけで戦えるのが良いゲームの証拠 */
export type BotAction = Frame;

/**
 * 操作方式。これ以外を増やすときは docs/design/fun-doctrine.md を先に更新すること。
 *
 * 上の4つが基本で、原則は「入力は1つ」（fun-doctrine ①）。
 * 下の2つは**操作そのものが題材になっている遊び**のための例外で、
 * 使うとその分だけ遊べる人が減る。迷ったら上の4つで作ること。
 */
export type Control =
  /** 押した瞬間だけ意味がある（例: ジャンプ、ハンコ） */
  | 'tap'
  /** 押している長さが意味を持つ（例: 溜める、伸ばす） */
  | 'hold'
  /** tap と hold の両方を使う */
  | 'tap-hold'
  /** 画面のどこを押したかが意味を持つ（例: 落ちものを指で払う） */
  | 'aim'
  /**
   * 左右に曲げることが遊びの中心（例: 走り続けるものを曲げる）。
   * PCは矢印キー、スマホは画面の左右half。`input.steer` を見る。
   */
  | 'steer'
  /**
   * 打った文字そのものが遊び（例: タイピング）。`input.typed` を見る。
   *
   * 🔴 **これだけはスマホで遊べない。** ゲームページに注意が出る。
   * 採用するかは企画ごとの判断で、既定にしてはいけない。
   */
  | 'type';

/** 見た目のテーマ。増やすときは palette.ts と対で */
export type ThemeName = 'keitai' | 'mono' | 'flash' | 'arcade';

/**
 * 機種。どの時代の・どの画面で遊ばれていたか、の単位。
 *
 * 遊びの型（Genre）が「面白さゲートの見る項目」を決めるのに対し、
 * 機種は「画面の寸法・向き・描画の質感・入力の想定」を決める。
 * 実物の値は platforms.ts、選び方と増やし方は docs/design/platforms.md。
 */
export type PlatformName =
  /** 2000年代なかばのカラーケータイ。240×320 縦・ドット。既定 */
  | 'keitai'
  /** 2000年前後〜の個人サイトの Flash ゲーム。550×400 横・なめらか。PC想定 */
  | 'flash'
  /** 90年代末〜2000年前後のゲームセンター。384×224 横・ドット。パッド想定 */
  | 'arcade';

/**
 * 遊びの型。当時のケータイゲームを、作り方が変わる単位で5つに分けたもの。
 *
 * これは飾りではなく、**面白さゲートで何を見るかが変わる**。
 * 例えば action では「放置すると死ぬ」が必須だが、nurture では逆に
 * 「放置しても壊れない」ことを見る。取り違えると正しいゲームが不合格になる。
 *
 * どの型で作るかの判断は docs/design/genre-map.md。
 */
export type Genre =
  /** 反射・回避・タイミング。糸通し／チャリ走の系統。既定 */
  | 'action'
  /** 手を選ぶ。盤面と手数があり、時間ではなく判断で進む */
  | 'puzzle'
  /** 育てる・世話する。時間が味方で、放置そのものが遊びの一部 */
  | 'nurture'
  /** 引き・収集。運の波が主役で、判断がそれを少し曲げる */
  | 'chance'
  /** 1回たどり着いて終わり。謎解き・クイズ・診断 */
  | 'oneshot';

/**
 * 面白さゲートのしきい値。
 * 既定値は FUN_GATE_DEFAULT（fun-gate.ts）にあり、
 * ゲームごとに meta.funGate で部分的に上書きできる。
 */
export interface FunGate {
  /** 放置ボットがこの秒数より長く生き残ったら不合格（＝緊張がない）。action 系で効く */
  idleSurvivalMaxSec: number;
  /**
   * 放置ボットがこの秒数より早く終わったら不合格。nurture 系で効く。
   * 「ほったらかしにしても即座に壊れない」ことを見る（action とは真逆の要求）。
   */
  idleSurvivalMinSec: number;
  /** ランダムボットの生存中央値の下限（＝理不尽に即死しない） */
  randomSurvivalMinSec: number;
  /** ランダムボットの生存中央値の上限（＝適当でも無双できてしまう、を防ぐ） */
  randomSurvivalMaxSec: number;
  /** 上手いボットの生存中央値の下限（＝上手ければ続く） */
  smartSurvivalMinSec: number;
  /** 上手いボットの生存中央値の上限（＝無限に終わらない） */
  smartSurvivalMaxSec: number;
  /** スコア中央値 smart/random の下限（＝腕前が効く。運ゲー判定） */
  skillRatioMin: number;
  /** smart スコアの p90/p50 の下限（＝「今日は乗ってる」が起きる） */
  upsideRatioMin: number;
  /**
   * 目に見えることが起きる間隔（秒）の許容範囲。
   * 動画で見ている人にとって、長すぎる無風は「何も起きていない」に見え、
   * 短すぎると何が起きたのか追えなくなる。
   */
  eventIntervalMinSec: number;
  eventIntervalMaxSec: number;
  /**
   * 最後の称号に届くまでの想定時間（分）の許容範囲。meta.goals があるときだけ効く。
   * ボット基準の数字なので、人間が遊ぶ時間はこれより長くなる。
   * 「一気に遊んで15〜30分でやりきれる」を狙って 6〜30分を既定にしている。
   */
  sessionMinutesMin: number;
  sessionMinutesMax: number;
}

/**
 * 着想元の記録。
 *
 * 既存作を下敷きにした企画では**必ず書く**。
 * 何を借りて何を自分で作ったかを残しておくことが、
 * 「公開してよいか」を判断するときの材料になる。
 * 詳しい線引きは docs/design/rights-and-originality.md。
 */
export interface Inspiration {
  /** 何から着想したか（ジャンル・時代・作品) */
  from: string;
  /** 借りたもの。遊びの仕組みだけであるべき */
  borrowed: string;
  /** 自分で作ったもの（キャラ・絵・音・UI・配置・タイトル・コード） */
  original: string;
}

/** ゲームのメタ情報。一覧・OGP・共有文・面白さゲートがここを読む */
export interface GameMeta {
  /** URL に出る識別子。半角英小文字とハイフンのみ */
  slug: string;
  /** 表示名（日本語可・全角8文字程度まで） */
  title: string;
  /** あそびかた。20文字以内・読まなくても分かる一行にする */
  howto: string;
  /** 操作方式 */
  control: Control;
  /**
   * 遊びの型。省略すると 'action' として扱う。
   * ここを間違えると面白さゲートが見当違いの判定をするので、必ず合わせること。
   */
  genre?: Genre;
  /** 公開日 YYYY-MM-DD */
  released: string;
  /** 収録企画の制約（例: 「マックのポテトM」）。一覧に出る */
  constraint?: string;
  /**
   * 機種。省略すると 'keitai'。
   *
   * 画面の寸法・向き・描画の質感・入力の想定がここで決まる。
   * **その機種でゲームが1本でも公開されたら、機種側の寸法は変えられない**
   * （既存ゲームの座標が全部ずれるため。詳細は .claude/rules/arcade.md）。
   */
  platform?: PlatformName;
  /** 見た目テーマ。既定は機種ごとの既定テーマ（platforms.ts） */
  theme?: ThemeName;
  /** スコアの単位（例: 「点」「m」「個」） */
  unit: string;
  /**
   * 到達目標。3〜5個を並べる（点数の小さい順でなくてよい。ランタイム側で並べ替える）。
   * 最初のひとつは数プレイで届く線に、最後のひとつは
   * 「一気に遊んで15〜30分で届く」線に置く。この幅が1セッションの長さを決める。
   */
  goals?: Goal[];
  /** 面白さゲートの部分上書き */
  funGate?: Partial<FunGate>;
  /** 一覧の並びを固定したいときだけ。大きいほど上 */
  pin?: number;
  /** 動画 URL（あれば一覧からリンクする） */
  video?: string;
  /**
   * 一覧での扱い。既定は 'live'。
   *
   * 'botsu' にしても消さずに遊べるまま残す。うまくいかなかったものを
   * 理由つきで並べておくこと自体が、この番組の中身になる
   * （docs/design/broadcast-design.md「失敗が面白い」）。
   */
  status?: 'live' | 'botsu';
  /** ボツにした理由。ボツ棚にそのまま出るので、正直に短く書く */
  botsuReason?: string;
  /**
   * 着想元がある場合は必ず書く（何も下敷きにしていないなら省略してよい）。
   * ゲームページにそのまま表示される。隠さず出すことが誠実さの表明になる。
   */
  inspiration?: Inspiration;
  /** 一覧カードの背景色（palette のキー名）。省略時はテーマ既定 */
  accent?: string;
  /**
   * 終わり方の扱い。育てる型のように「終わり＝失敗ではない」ゲームのためのもの。
   *
   * - color: 結果画面で reason() を描く色。既定は 'bad'（死因は赤、という従来の見え方）
   * - share: 共有文と記録カードに reason() を1行足す。既定は false
   *   （「ぽちは 92さいで たねになった」のように、終わり方そのものが人に言いたいことになるゲーム用。
   *   既存ゲームの共有文を変えないため、明示したゲームだけに効く）
   */
  ending?: { color?: 'bad' | 'ink' | 'dim' | 'good'; share?: boolean };
}

/**
 * ゲーム本体。games/<slug>/game.ts が default export する形。
 *
 * bot() を必須にしているのは意図的。
 * 「10行のボットが書けない」＝「ルールが一言で説明できない」なので、
 * その時点でこのチャンネルのゲームとしては不合格。
 */
export interface GameDefinition<S extends BaseState = BaseState> {
  meta: GameMeta;
  /** 初期状態を作る。乱数は必ず引数の rng を使う（Math.random 禁止） */
  init(rng: Rng): S;
  /**
   * 1フレーム進める。引数を書き換えず、新しい state を返すこと。
   * 乱数は必ず引数の rng を使う（ここで Math.random を使うと再現性が消える）。
   */
  step(state: S, input: Input, dt: number, rng: Rng): S;
  /** 描画。state を書き換えないこと */
  draw(g: Painter, state: S): void;
  /** 面白さゲート用の簡易 AI。上手い人の再現を狙う */
  bot(state: S, rng: Rng): BotAction;
  /**
   * 「何も分かっていない人」の代わり。省略すると共通のでたらめボットが使われる。
   *
   * 書いてよいのは、**共通のでたらめボットでは構造的に一度も成功できない**ときだけ。
   * 例: タイピング。でたらめに文字を打つ人は一度も正解できないので、
   * 「初見でも点が入るか」がゲームの出来ではなくボットの都合で決まってしまう
   * （長押しゲームで同じ失敗をしたことがある。runner.ts の makeRandomPolicy を参照）。
   *
   * 🔴 ゲートを通すために強く書かないこと。ここは「下手な人」であって「そこそこの人」ではない。
   * 書くと `npm run fun` の出力に明示される（黙って基準を下げられないようにするため）。
   */
  novice?(state: S, rng: Rng, frame: number): BotAction;
  /** 死因を一行で（リザルト画面に出る）。「なぜ死んだか」が伝わると次が回る */
  reason?(state: S): string;
  /**
   * 調整してよい数値。`npm run tune` がここを動かして当たりを探す。
   * 書かなくても動くが、書いておくと難度調整が一気に速くなる。
   */
  tunables?: Record<string, Tunable>;
}

/**
 * 調整する数値に名前をつけて外から触れるようにしたもの。
 *
 * 収録中の「ここの数字を上げて」→ ゲート → また上げて、の往復が
 * いちばん時間を食う。`npm run tune` が自動で当たりを探せるように、
 * 触ってよい値だけを名前つきで公開しておく。
 */
export interface Tunable {
  /** 人に伝わる名前（例:「書類の間隔」） */
  label: string;
  /** 探索してよい範囲 */
  min: number;
  max: number;
  get(): number;
  set(value: number): void;
}

/** 型を書かずに定義を作るためのヘルパ（games 側はこれを使う） */
export function defineGame<S extends BaseState>(def: GameDefinition<S>): GameDefinition<S> {
  return def;
}

/**
 * 状態の型を問わずゲームを持ち回すための型。
 * 共通シェルや登録簿は個々のゲームの状態を知る必要がないのでこれを使う。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameDefinition<any>;
