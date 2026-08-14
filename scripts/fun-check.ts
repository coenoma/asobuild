/**
 * 面白さゲートを走らせる。
 *
 *   npm run fun -- hanko      # 1本だけ見る
 *   npm run fun:all           # 全部見る（CI と同じ）
 *
 * 「面白いか」は人が決めるが、「面白くなりようがない」は機械で潰せる。
 * 落ちた項目には必ず直し方が出るので、そこだけ読んで直せばよい。
 */

import { runFunGate, type GateReport } from '../src/arcade/fun-gate';
import { trySnap } from './snap';
import { loaders, metas } from '../src/games/registry';

const args = process.argv.slice(2);
const all = args.includes('--all');
const runsArg = args.find((a) => a.startsWith('--runs='));
const runs = runsArg ? Number(runsArg.split('=')[1]) : 200;
const offsetArg = args.find((a) => a.startsWith('--seed-offset='));
const seedOffset = offsetArg ? Number(offsetArg.split('=')[1]) : 0;
/** いまの数字を「これが正」として記録し直す */
const record = args.includes('--record');
const targets = all ? metas.map((m) => m.slug) : args.filter((a) => !a.startsWith('--'));

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const GENRE_LABEL: Record<string, string> = {
  action: '反射・タイミング',
  puzzle: '手を選ぶ',
  nurture: '育てる',
  chance: '引き・収集',
  oneshot: '1回たどり着いて終わり',
};

function printReport(rep: GateReport): void {
  const head = rep.pass ? `${C.green}合格${C.reset}` : `${C.red}不合格${C.reset}`;
  const genre = GENRE_LABEL[rep.genre] ?? rep.genre;
  console.log(
    `\n${C.bold}${rep.title}${C.reset} ${C.dim}(${rep.slug} / ${genre})${C.reset}  ${head}`,
  );
  console.log(`${C.dim}${'─'.repeat(60)}${C.reset}`);

  for (const [key, label] of [
    ['idle', '放置  '],
    ['random', 'でたらめ'],
    ['smart', '上手い'],
  ] as const) {
    const s = rep.stats[key];
    console.log(
      `  ${C.dim}${label}${C.reset} ` +
        `生存 ${String(Math.round(s.seconds.p50)).padStart(3)}秒 ` +
        `${C.dim}(p10 ${Math.round(s.seconds.p10)} / p90 ${Math.round(s.seconds.p90)})${C.reset}  ` +
        `スコア ${String(Math.round(s.score.p50)).padStart(4)} ` +
        `${C.dim}(p90 ${Math.round(s.score.p90)} / 最高 ${s.score.max})${C.reset}`,
    );
  }

  console.log('');
  for (const c of rep.checks) {
    const mark = c.pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    console.log(`  ${mark} ${c.label} ${C.dim}… ${c.actual}（基準 ${c.expected}）${C.reset}`);
    if (!c.pass) console.log(`      ${C.yellow}→ ${c.fix}${C.reset}`);
  }

  // でたらめ役を差し替えていることは必ず見えるようにする。
  // 黙って甘い基準で通していると、次から誰もこの数字を信じなくなる
  if (rep.customNovice) {
    console.log(`\n  ${C.yellow}「でたらめ」役はゲーム側の novice() が担っています${C.reset}`);
    console.log(
      `  ${C.dim}共通のでたらめボットより甘くなりえます。「初見でも点が入る」は人が確かめること。${C.reset}`,
    );
  }

  if (rep.topReasons.length) {
    console.log(`\n  ${C.dim}上手いボットの死因:${C.reset}`);
    for (const r of rep.topReasons) {
      console.log(`    ${C.cyan}${r.reason}${C.reset} ${C.dim}× ${r.count}${C.reset}`);
    }
  }
}

interface GateRecord {
  slug: string;
  genre: string;
  recordedAt: string;
  runs: number;
  pass: boolean;
  idle: { secondsP50: number };
  random: { secondsP50: number; scoreP50: number };
  smart: { secondsP50: number; scoreP50: number; scoreP90: number };
}

function recordPath(slug: string): string {
  return `docs/records/gate/${slug}.json`;
}

function toRecord(rep: GateReport, runCount: number): GateRecord {
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    slug: rep.slug,
    genre: rep.genre,
    recordedAt: new Date().toISOString().slice(0, 10),
    runs: runCount,
    pass: rep.pass,
    idle: { secondsP50: round(rep.stats.idle.seconds.p50) },
    random: {
      secondsP50: round(rep.stats.random.seconds.p50),
      scoreP50: round(rep.stats.random.score.p50),
    },
    smart: {
      secondsP50: round(rep.stats.smart.seconds.p50),
      scoreP50: round(rep.stats.smart.score.p50),
      scoreP90: round(rep.stats.smart.score.p90),
    },
  };
}

async function writeRecord(rep: GateReport, runCount: number): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(process.cwd(), recordPath(rep.slug));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(toRecord(rep, runCount), null, 2)}\n`, 'utf8');
  console.log(`  ${C.dim}記録を更新: ${recordPath(rep.slug)}${C.reset}`);
}

async function readRecord(slug: string): Promise<GateRecord | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const text = await readFile(path.join(process.cwd(), recordPath(slug)), 'utf8');
    return JSON.parse(text) as GateRecord;
  } catch {
    return null;
  }
}

/**
 * 前回の記録と見比べて、手触りが大きく変わっていないか見る。
 *
 * 共通ランタイムを触ったときに、既存のゲームが知らないうちに変わってしまうのを
 * 機械が見張るための仕組み。意図した変更なら記録を更新すればよい。
 */
function findDrift(rep: GateReport, prev: GateRecord): string[] {
  const now = toRecord(rep, 0);
  const drift: string[] = [];
  const check = (label: string, before: number, after: number, tolerance = 0.25) => {
    if (before === 0 && after === 0) return;
    const base = Math.max(Math.abs(before), 1);
    const diff = (after - before) / base;
    if (Math.abs(diff) > tolerance) {
      drift.push(`${label} ${before} → ${after}（${diff > 0 ? '+' : ''}${Math.round(diff * 100)}%）`);
    }
  };
  check('上手い人のスコア中央値', prev.smart.scoreP50, now.smart.scoreP50);
  check('上手い人の生存中央値', prev.smart.secondsP50, now.smart.secondsP50);
  check('でたらめの生存中央値', prev.random.secondsP50, now.random.secondsP50);
  check('放置の生存中央値', prev.idle.secondsP50, now.idle.secondsP50);
  return drift;
}

/**
 * 収録カンペ（/live）へ結果を流す。
 * カンペが無くても検定は成立するので、失敗しても黙って進む（live-log 側で握る）。
 */
async function pushToLive(rep: GateReport): Promise<void> {
  const { live } = await import('./live-log.mjs');
  await live({
    kind: 'gate',
    slug: rep.slug,
    pass: rep.pass,
    checks: rep.checks.map((c) => ({ label: c.label, pass: c.pass })),
    topReason: rep.topReasons[0]?.reason ?? null,
  });
}

async function main(): Promise<void> {
  if (targets.length === 0) {
    console.log('使い方: npm run fun -- <slug>   /   npm run fun:all');
    console.log(`登録されているゲーム: ${metas.map((m) => m.slug).join(', ') || '（まだない）'}`);
    process.exit(1);
  }

  let failed = 0;
  for (const slug of targets) {
    const load = loaders[slug];
    if (!load) {
      console.error(`${C.red}ゲームが見つかりません: ${slug}${C.reset}`);
      console.error(`src/games/registry.ts に登録されているか確認してください。`);
      failed++;
      continue;
    }
    const mod = await load();
    const rep = runFunGate(mod.default, { runs, seedOffset });
    // いまの見た目を1枚残す（.live/shots/。動画の素材になる。撮れなくてもゲートは止めない）
    await trySnap(slug);
    printReport(rep);
    await pushToLive(rep);
    // ボツ棚のものは「基準に届かなかった記録」なので、合否では止めない
    const isBotsu = mod.default.meta.status === 'botsu';
    if (isBotsu) {
      console.log(`  ${C.dim}（ボツ棚。合否は問いません）${C.reset}`);
    } else if (!rep.pass) {
      failed++;
    }

    if (record) {
      await writeRecord(rep, runs);
    } else if (seedOffset === 0) {
      // 種をずらして測っているときは、ぶれて当然なので比べない
      const prev = await readRecord(rep.slug);
      if (prev) {
        const drift = findDrift(rep, prev);
        if (drift.length > 0) {
          console.log(`\n  ${C.yellow}前回の記録から手触りが変わっています${C.reset}`);
          for (const d of drift) console.log(`    ${C.yellow}${d}${C.reset}`);
          console.log(
            `  ${C.dim}意図した変更なら記録を更新してください: npm run fun -- ${rep.slug} --record${C.reset}`,
          );
          failed++;
        }
      }
    }

    const insp = mod.default.meta.inspiration;
    if (insp) {
      console.log(`\n  ${C.yellow}着想元の記録あり: ${insp.from}${C.reset}`);
      console.log(`  ${C.dim}借りたもの: ${insp.borrowed}${C.reset}`);
      console.log(`  ${C.dim}自作した部分: ${insp.original}${C.reset}`);
      console.log(
        `  ${C.yellow}→ 公開前に docs/design/rights-and-originality.md のチェックリストを通すこと。${C.reset}`,
      );
    }
  }

  console.log('');
  if (failed > 0) {
    console.log(`${C.red}${failed} 本が基準を満たしていません。${C.reset}`);
    console.log(`${C.dim}※ 基準は目安です。意図があって外すときは meta.funGate で上書きし、理由をコメントに書いてください。${C.reset}`);
    process.exit(1);
  }
  console.log(`${C.green}すべて基準を満たしています。${C.reset}`);
  console.log(
    `${C.yellow}ただし、これは「面白くなりようがない状態ではない」というだけです。${C.reset}`,
  );
  console.log(`${C.dim}面白いかどうかは、実際に3回遊んで人が決めます:${C.reset}`);
  console.log(`${C.dim}  npm run dev  →  npm run playtest -- <slug>${C.reset}`);
}

void main();
