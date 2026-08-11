/**
 * 難度の当たりを自動で探す。
 *
 *   npm run tune -- hanko --param spawnBase --target smartSec=45
 *
 * 収録中にいちばん時間を食うのは「数字をいじる → ゲート → またいじる」の往復。
 * そこを二分探索に任せる。**コードは書き換えない**（提案するだけ）。
 * 自動で書き換えると、何をどう変えたのか分からないまま数字だけ合ってしまう。
 */

import { runFunGate } from '../src/arcade/fun-gate';
import { loaders } from '../src/games/registry';
import type { AnyGame, Tunable } from '../src/arcade/types';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const opt = (name: string) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

/** 何を目標にするか。ゲートの数字と対応させている */
const METRICS = {
  smartSec: { label: '上手いボットの生存中央値', unit: '秒', pick: (r: ReturnType<typeof runFunGate>) => r.stats.smart.seconds.p50 },
  smartScore: { label: '上手いボットのスコア中央値', unit: '点', pick: (r: ReturnType<typeof runFunGate>) => r.stats.smart.score.p50 },
  randomSec: { label: 'でたらめボットの生存中央値', unit: '秒', pick: (r: ReturnType<typeof runFunGate>) => r.stats.random.seconds.p50 },
  idleSec: { label: '放置ボットの生存中央値', unit: '秒', pick: (r: ReturnType<typeof runFunGate>) => r.stats.idle.seconds.p50 },
} as const;

type MetricKey = keyof typeof METRICS;

function usage(game?: AnyGame): void {
  console.log(`使い方:
  npm run tune -- <slug> --param <name> --target <metric>=<value> [--runs 80]

  metric: ${Object.keys(METRICS).join(' / ')}
  例: npm run tune -- hanko --param spawnBase --target smartSec=45`);
  if (game?.tunables) {
    console.log(`\n${slug} で触れる値:`);
    for (const [key, t] of Object.entries(game.tunables as Record<string, Tunable>)) {
      console.log(`  ${key.padEnd(12)} ${t.label}  いま ${t.get()}（${t.min}〜${t.max}）`);
    }
  }
}

async function main(): Promise<void> {
  if (!slug || !loaders[slug]) {
    console.error(`${C.red}ゲームを指定してください${C.reset}`);
    usage();
    process.exit(1);
  }
  const game = (await loaders[slug]()).default;
  const tunables = game.tunables as Record<string, Tunable> | undefined;

  const paramName = opt('param');
  const targetRaw = opt('target');
  if (!paramName || !targetRaw) {
    usage(game);
    process.exit(1);
  }
  if (!tunables?.[paramName]) {
    console.error(`${C.red}${slug} に「${paramName}」はありません${C.reset}`);
    usage(game);
    process.exit(1);
  }

  const [metricKey, valueRaw] = targetRaw.split('=');
  const metric = METRICS[metricKey as MetricKey];
  const goal = Number(valueRaw);
  if (!metric || !Number.isFinite(goal)) {
    console.error(`${C.red}目標の指定が読めません: ${targetRaw}${C.reset}`);
    usage(game);
    process.exit(1);
  }

  const runs = Number(opt('runs') ?? 80);
  const t = tunables[paramName];
  const original = t.get();
  const measure = (v: number): number => {
    t.set(v);
    return metric.pick(runFunGate(game, { runs }));
  };

  console.log(`\n${C.bold}${game.meta.title}${C.reset} の「${t.label}」を動かして`);
  console.log(`${metric.label}が ${C.bold}${goal}${metric.unit}${C.reset} になる値を探します`);
  console.log(`${C.dim}（1回あたり ${runs} プレイで測定。コードは書き換えません）${C.reset}\n`);

  try {
    const atMin = measure(t.min);
    const atMax = measure(t.max);
    console.log(`  ${t.min} のとき ${Math.round(atMin * 10) / 10}${metric.unit}`);
    console.log(`  ${t.max} のとき ${Math.round(atMax * 10) / 10}${metric.unit}`);

    const lowest = Math.min(atMin, atMax);
    const highest = Math.max(atMin, atMax);
    if (goal < lowest || goal > highest) {
      console.log(
        `\n${C.yellow}この範囲では ${goal}${metric.unit} に届きません（${Math.round(lowest)}〜${Math.round(highest)}${metric.unit}）。${C.reset}`,
      );
      console.log(`${C.dim}別の値を動かすか、min/max を広げてください。${C.reset}\n`);
      return;
    }

    // 値を増やすと指標が上がるのか下がるのかを見てから、二分探索する
    const increasing = atMax > atMin;
    let lo = t.min;
    let hi = t.max;
    let best = original;
    let bestDiff = Infinity;

    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      const got = measure(mid);
      const diff = Math.abs(got - goal);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = mid;
      }
      process.stdout.write(
        `  ${C.dim}探索 ${i + 1}/10: ${Math.round(mid * 1000) / 1000} → ${Math.round(got * 10) / 10}${metric.unit}${C.reset}\n`,
      );
      if ((got < goal) === increasing) lo = mid;
      else hi = mid;
    }

    const rounded = Math.round(best * 1000) / 1000;
    const finalValue = measure(best);

    console.log(`\n${C.green}見つかりました${C.reset}`);
    console.log(`  ${t.label}: ${C.bold}${original} → ${rounded}${C.reset}`);
    console.log(
      `  ${metric.label}: ${Math.round(measure(original) * 10) / 10} → ${C.bold}${Math.round(finalValue * 10) / 10}${metric.unit}${C.reset}（目標 ${goal}）`,
    );
    console.log(
      `\n${C.yellow}反映するには src/games/${slug}/game.ts の TUNE.${paramName} を ${rounded} にしてください。${C.reset}`,
    );
    console.log(`${C.dim}変えたあとは npm run fun -- ${slug} で他の項目が崩れていないか必ず見ること。${C.reset}\n`);
  } finally {
    // 探索で動かした値は必ず元に戻す
    t.set(original);
  }
}

void main();
