#!/usr/bin/env node
/**
 * ゲームの雛形を作る。
 *
 *   npm run new -- potato --title "ポテトのばし" --howto "長押しでのばす" --control hold --constraint "マックのポテトM"
 *
 * 生成されるのは「動くが単調な」状態。ここから面白さゲート（npm run fun -- <slug>）を
 * 見ながら肉付けしていくのが基本の進め方。最初から完成形を書こうとしないこと。
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));

function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

if (!slug || !/^[a-z][a-z0-9-]*$/.test(slug)) {
  console.error('使い方: npm run new -- <slug> [--title タイトル] [--howto あそびかた] [--control tap|hold|tap-hold|aim] [--genre action|puzzle|nurture|chance|oneshot] [--constraint 制約] [--unit 点]');
  console.error('slug は半角英小文字・数字・ハイフンのみ（例: potato-nobashi）');
  process.exit(1);
}

const title = opt('title', slug);
const howto = opt('howto', 'タップでうごかす');
const control = opt('control', 'tap');
const genre = opt('genre', 'action');
const unit = opt('unit', '点');
const constraint = opt('constraint', '');
const today = new Date().toISOString().slice(0, 10);
const camel = slug.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const dir = path.join(ROOT, 'src/games', slug);

if (existsSync(dir)) {
  console.error(`すでに存在します: src/games/${slug}`);
  process.exit(1);
}

const metaTs = `import type { GameMeta } from '@/arcade/types';

export const meta: GameMeta = {
  slug: '${slug}',
  title: '${title}',
  // 20文字以内。読まなくても分かる一行にする
  howto: '${howto}',
  control: '${control}',
  genre: '${genre}',
  released: '${today}',
  unit: '${unit}',
  theme: 'keitai',${constraint ? `\n  constraint: '${constraint}',` : ''}
};
`;

const gameTs = `/**
 * ${title}
 *
 * TODO: 何が起きたら成功で、何が起きたら終わりなのかを1行で書く。
 * ここが書けないゲームは、遊ぶ人にも伝わらない。
 *
 * この雛形は、生成した時点では面白さゲート（npm run fun -- ${slug}）に落ちる。
 * 落ちた項目を1つずつ潰していく作業が、そのままゲーム作りになる。
 */

import { defineGame, VIRTUAL_H, VIRTUAL_W, type BaseState } from '@/arcade/types';
import type { Painter } from '@/arcade/painter';
import { meta } from './meta';

/** プレイヤーの初期位置など、調整する数値は名前をつけて上にまとめる */
const GROUND_Y = 260;
const LIVES = 3;

export interface ${camel[0].toUpperCase()}${camel.slice(1)}State extends BaseState {
  /** 主役の位置 */
  y: number;
  vy: number;
  lives: number;
  /** 難度の中心になる値。時間とともに上げていく */
  speed: number;
  spawnTimer: number;
  targets: { x: number; y: number; hit: boolean }[];
  deathReason: string;
}

export default defineGame<${camel[0].toUpperCase()}${camel.slice(1)}State>({
  meta,

  init() {
    return {
      score: 0,
      over: false,
      time: 0,
      y: GROUND_Y,
      vy: 0,
      lives: LIVES,
      speed: 60,
      spawnTimer: 0.6,
      targets: [],
      deathReason: '',
    };
  },

  step(s, input, dt, rng) {
    const n = { ...s };

    // 1) 時間とともに圧を上げる。これが無いと「放置しても死なない」ゲートに落ちる
    n.speed = 60 + s.time * 4;

    // 2) 入力に応える。tap / hold / release のどれを使うかは meta.control と揃える
    if (input.tap) {
      n.vy = -180;
    }
    n.vy += 520 * dt;
    n.y = Math.min(GROUND_Y, s.y + n.vy * dt);

    // 3) 出現と移動
    n.spawnTimer = s.spawnTimer - dt;
    const targets = s.targets.map((t) => ({ ...t, x: t.x - n.speed * dt })).filter((t) => t.x > -20);
    if (n.spawnTimer <= 0) {
      n.spawnTimer += Math.max(0.35, 1.1 - s.time * 0.02) * rng.range(0.8, 1.2);
      targets.push({ x: VIRTUAL_W + 20, y: GROUND_Y - rng.range(20, 70), hit: false });
    }

    // 4) 当たり判定と得点。取り逃がしに代償があるから緊張が生まれる
    for (const t of targets) {
      if (t.hit) continue;
      if (Math.abs(t.x - 60) < 14 && Math.abs(t.y - n.y) < 16) {
        t.hit = true;
        n.score += 1;
      } else if (t.x < 40) {
        t.hit = true;
        n.lives -= 1;
        n.deathReason = '取り逃がしが多すぎた';
      }
    }
    n.targets = targets;

    // 5) 終わり方。reason() で「なぜ終わったか」が伝わるようにする
    if (n.lives <= 0) n.over = true;

    return n;
  },

  draw(g: Painter, s) {
    g.rect(0, GROUND_Y + 12, VIRTUAL_W, VIRTUAL_H, 'bg2');
    g.line(0, GROUND_Y + 12, VIRTUAL_W, GROUND_Y + 12, 'line');

    for (const t of s.targets) {
      if (t.hit) continue;
      g.circle(t.x, t.y, 7, 'accent');
    }

    g.rect(60 - 7, s.y - 7, 14, 14, 'ink');

    for (let i = 0; i < LIVES; i++) {
      g.circle(12 + i * 13, 26, 4, i < s.lives ? 'good' : 'line');
    }
  },

  /**
   * 面白さゲート用のボット。「上手い人ならこう動く」を10行で書く。
   * ここが書けないなら、ルールがまだ複雑すぎるサイン。
   */
  bot(s) {
    const next = s.targets.filter((t) => !t.hit && t.x > 50).sort((a, b) => a.x - b.x)[0];
    if (!next) return { press: false };
    return { press: next.x < 110 && s.y >= GROUND_Y - 2 };
  },

  reason(s) {
    return s.deathReason || 'おわり';
  },
});
`;

await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'meta.ts'), metaTs, 'utf8');
await writeFile(path.join(dir, 'game.ts'), gameTs, 'utf8');

// 登録簿への追記（手で書き忘れると一覧に出ないので自動化している）
const registryPath = path.join(ROOT, 'src/games/registry.ts');
let registry = await readFile(registryPath, 'utf8');

registry = registry.replace(
  /(import \{ meta as \w+ \} from '\.\/[^']+\/meta';\n)(?![\s\S]*import \{ meta as)/,
  `$1import { meta as ${camel} } from './${slug}/meta';\n`,
);
registry = registry.replace(
  /export const metas: GameMeta\[\] = \[([^\]]*)\];/,
  (_m, inner) => `export const metas: GameMeta[] = [${inner.trim() ? `${inner.trim()}, ` : ''}${camel}];`,
);
registry = registry.replace(
  /(export const loaders: Record<string, \(\) => Promise<\{ default: AnyGame \}>> = \{\n)/,
  `$1  ${slug.includes('-') ? `'${slug}'` : slug}: () => import('./${slug}/game'),\n`,
);

await writeFile(registryPath, registry, 'utf8');

// 収録カンペへ。作業の節目が勝手に出るようにしてある（意識して流すと流れないため）
const { live, say } = await import('./live-log.mjs');
await live({ kind: 'phase', phase: 'じっそう' });
await say(`「${title}」の雛形ができた`);

console.log(`\n作りました:`);
console.log(`  src/games/${slug}/meta.ts`);
console.log(`  src/games/${slug}/game.ts`);
console.log(`  src/games/registry.ts に登録`);
console.log(`\n次にやること:`);
console.log(`  1. npm run dev      → http://localhost:3020/g/${slug} で触ってみる`);
console.log(`  2. npm run fun -- ${slug}   → 面白さゲートの数字を見て直す`);
console.log(`  3. docs/design/fun-doctrine.md の「見送る判断」まで入れられたら合格ライン`);
if (genre !== 'action') {
  console.log(`\n⚠️ 雛形の中身は action（反射）用です。`);
  console.log(`   ${genre} の作りは docs/design/genre-map.md を読んでから step/draw/bot を書き換えてください。`);
  console.log(`   型が変わると、面白さゲートが見る項目も変わります。`);
}
console.log('');
