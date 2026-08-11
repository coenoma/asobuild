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
import { loaders, metas } from '../src/games/registry';

const args = process.argv.slice(2);
const all = args.includes('--all');
const runsArg = args.find((a) => a.startsWith('--runs='));
const runs = runsArg ? Number(runsArg.split('=')[1]) : 200;
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

function printReport(rep: GateReport): void {
  const head = rep.pass ? `${C.green}合格${C.reset}` : `${C.red}不合格${C.reset}`;
  console.log(`\n${C.bold}${rep.title}${C.reset} ${C.dim}(${rep.slug})${C.reset}  ${head}`);
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

  if (rep.topReasons.length) {
    console.log(`\n  ${C.dim}上手いボットの死因:${C.reset}`);
    for (const r of rep.topReasons) {
      console.log(`    ${C.cyan}${r.reason}${C.reset} ${C.dim}× ${r.count}${C.reset}`);
    }
  }
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
    const rep = runFunGate(mod.default, { runs });
    printReport(rep);
    if (!rep.pass) failed++;

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
}

void main();
