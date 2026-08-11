---
paths:
  - "src/games/**/*.ts"
---

# ゲーム実装の規約

## state の作り方

- フラットに持つ（ネストした構造にしない）。`{...s}` の浅いコピーで済む形を保つ
- 調整する数値（速度・判定幅・ライフ数）は **ファイル冒頭の定数**にまとめ、名前をつける
  → 収録中に「ここの数字を上げて」で通じるようにするため
- 演出専用の値（点滅タイマー・画面揺れ）も state に持つ。`draw` の中で時間を進めない

## step の書き順

この順に書くと、判定の取りこぼしが起きにくい。

1. タイマー類を減らす（クールタイム・演出）
2. 難度パラメータを更新する（`n.speed = 基準 + s.time * 係数`）
3. 物を動かす／画面外を捨てる
4. **通り過ぎたものの判定**（取り逃がし）
5. 出現
6. 入力の処理
7. 終了判定（`n.over = true`）

4 を 6 より先にやる。逆にすると「押したのに取り逃がし扱い」が起きる。

## やってはいけないこと

- `Math.random()` / `Date.now()` / `performance.now()` を使う（再現性が壊れる）
- 引数の `state` を書き換える（`s.score += 1` ではなく `n.score += 1`）
- `draw` の中で state を変える
- `setTimeout` / `requestAnimationFrame` を自前で呼ぶ（ループは共通シェルが持っている）
- DOM や `window` を触る（Node 上のゲート実行で落ちる）

## bot() の書き方

「上手い人ならこう動く」を10行で。完璧でなくてよいが、**弱すぎると `上手ければ続く` が不当に落ちる**。

```ts
bot(s) {
  if (s.cooldown > 0) return { press: false };        // 押せない状況を先に弾く
  const target = 次に処理すべきもの;
  if (!target) return { press: false };
  const per = s.speed / 60;                            // 1フレームの移動量
  return { press: target.y + per >= 判定ライン };       // 次フレームで跨ぐなら今押す
}
```

判定ラインを跨ぐ瞬間を予測して押す形にすると、速度が上がっても正確に動く。
「距離が◯以内なら押す」だと、速度が上がったときに窓を飛び越して押せなくなる。

## reason() は必ず書く

死因はリザルト画面にそのまま出る。プレイヤーが次に何を直せばいいか分かる文にする。

- ⭕️「見のがしが多すぎた」「差戻にハンコを押した」
- ❌「ゲームオーバー」「ライフが0になった」

死因は「そうなった瞬間」に `state.deathReason` へ入れる。最後にまとめて判定しない。

## 手触りは自前で書かない

先行入力・猶予・ヒットストップ・画面ゆれ・弾みは `src/arcade/feel.ts` にある。
自前で似たものを書くと、ゲームごとに数値がばらついてシリーズとしての手触りが揃わなくなる。

```ts
export interface MyState extends BaseState, FeelState {}

init() { return { ...createFeel(), score: 0, over: false, time: 0, /* ... */ }; },

step(s, input, dt, rng) {
  const n = { ...s };
  if (!feelTick(n, input, dt)) return n;   // 「止め」の最中は世界を進めない
  if (takeTap(n) && 条件) { /* 先行入力つきの判定 */ }
  ...
}
```

何がなぜ効くのか・目安の数値は [docs/design/feel-catalog.md](../../docs/design/feel-catalog.md)。
新しく効く工夫を見つけたら、実装を `feel.ts` に、理由をカタログに足す。

## 検証

コードを書いたら必ず `npm run fun -- <slug>`。
落ちた項目の `→` の指示から手をつける。全部緑になったら実際に3回遊ぶ。
