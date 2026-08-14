import next from 'eslint-config-next/core-web-vitals';

/**
 * ESLint の設定。
 *
 * ここが見るのは2つ。
 *
 * 1. Next / React / TypeScript の一般的な間違い → `eslint-config-next` にまかせる
 * 2. **このリポジトリの絶対ルールのうち、機械で見られるもの** → 下の asobuild/games
 *
 * 2 がこのファイルの本題。
 * CLAUDE.md と .claude/rules/games.md に日本語で書いてある「やってはいけないこと」は、
 * これまで人とAIの注意力だけが頼りだった。破っても、面白さゲートが「再現性」で
 * 落ちてはじめて気づく（しかも何が原因かは推測になる）。
 * **書いてあるだけのルールは、そのうち必ず破られる。** 機械で見られるものはここで止める。
 *
 * ルールを足すときは、必ず日本語の message に「なぜ駄目か」と「代わりに何を使うか」を書くこと。
 * 止めるだけで直し方が出ないルールは、書いた人以外には嫌がらせにしかならない。
 *
 * なお `next lint` は Next 16 で廃止されたので、eslint を直接呼んでいる（package.json）。
 */
const config = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      // video/ は独自の package.json を持つ別プロジェクト。あちらで別に見る
      'video/**',
    ],
  },

  ...next,

  {
    /**
     * TypeScript として当然見たいもの。
     *
     * `any` は既定では見ていないが、このリポジトリのコードには前から
     * `eslint-disable-next-line @typescript-eslint/no-explicit-any` が置いてある
     * ＝**書いた人は止めるつもりだった**。ルールを有効にして、その意図に実体を持たせる。
     * どうしても要る場所（型を問わずゲームを持ち回す AnyGame など）は、
     * これまでどおり1行ずつ理由つきで外す。
     */
    name: 'asobuild/typescript',
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  {
    /**
     * ゲーム本体の絶対ルール。
     *
     * 対象を src/games/** に絞っているのは、共通ランタイム（src/arcade/）が
     * 描画・ループ・乱数の種を持つ層で、ここに挙げたものを**使う側**だから。
     * 根拠は .claude/rules/games.md「やってはいけないこと」。
     */
    name: 'asobuild/games',
    files: ['src/games/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            '再現性が消えて、面白さゲートもリプレイも機能しなくなります。乱数は init/step が受け取る rng を使ってください。',
        },
        {
          object: 'Date',
          property: 'now',
          message:
            '再現性が消えます。経過時間は state.time（ランタイムが dt を積算しています）を使ってください。',
        },
        {
          object: 'performance',
          property: 'now',
          message: '再現性が消えます。経過時間は state.time を使ってください。',
        },
      ],

      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message:
            'Node 上でゲートを回すときに落ちます。画面に触れるのは draw(g) の Painter だけです。',
        },
        {
          name: 'document',
          message: '同じく Node 上で落ちます。画面に触れるのは draw(g) の Painter だけです。',
        },
        {
          name: 'localStorage',
          message: '記録の保存は共通シェル（arcade/storage.ts）が持っています。',
        },
        {
          name: 'setTimeout',
          message:
            'ループは共通シェルが持っています。待ち時間は state にタイマーを持って dt で減らしてください。',
        },
        {
          name: 'setInterval',
          message: '同上。待ち時間は state のタイマーと dt で作ってください。',
        },
        {
          name: 'requestAnimationFrame',
          message: '同上。step は共通シェルが固定タイムステップで呼びます。',
        },
      ],

      'no-restricted-syntax': [
        'error',
        {
          // 色をキー名で指定させる。生の #hex が混ざると、シリーズとしての見た目が揃わなくなる
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message:
            '生の #hex は使えません。色は palette.ts のキー名（例: "ink" "bad" "accent"）で指定してください。',
        },
      ],
    },
  },

  {
    // 開発用スクリプトは Node で動く。ここは上の制限の対象外
    name: 'asobuild/scripts',
    files: ['scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
];

export default config;
