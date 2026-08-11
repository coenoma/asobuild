/**
 * 公開してよい状態かを確かめる。
 *
 *   npm run ship            # ぜんぶ
 *   npm run ship -- tamago  # 1本だけ
 *
 * `npm run check`（型・ゲート・ビルド）は開発中の確認。
 * こちらは**外に出す前**の確認で、機械では代われない部分を見る。
 *
 *   ・人が実際に遊んで確かめたか（npm run playtest の記録）
 *   ・その記録が今の実装のものか（直したのに記録が古いままでないか）
 *   ・着想元があるなら権利の確認を通したか
 *
 * ゲートが緑でも面白いとは限らない。ここが最後の関所。
 */

import { metas } from '../src/games/registry';
import { codeHashOf, readRecord } from './playtest-record';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets = args.length > 0 ? args : metas.map((m) => m.slug);
  let ng = 0;

  console.log(`\n${C.bold}公開前の確認${C.reset}\n`);

  for (const slug of targets) {
    const meta = metas.find((m) => m.slug === slug);
    if (!meta) {
      console.log(`  ${C.red}✗${C.reset} ${slug}: 登録されていません`);
      ng++;
      continue;
    }
    // ボツ棚のものは「出さない」と決めたものなので、確認の対象外
    if (meta.status === 'botsu') {
      console.log(`  ${C.dim}−${C.reset} ${meta.title} ${C.dim}（ボツ棚なので対象外）${C.reset}`);
      continue;
    }

    const rec = await readRecord(slug);
    const now = await codeHashOf(slug);

    if (!rec) {
      console.log(`  ${C.red}✗${C.reset} ${meta.title}: ${C.red}まだ人が遊んでいません${C.reset}`);
      console.log(`      ${C.yellow}→ npm run playtest -- ${slug}${C.reset}`);
      ng++;
    } else if (rec.codeHash !== now) {
      console.log(`  ${C.red}✗${C.reset} ${meta.title}: ${C.red}記録が古い（${rec.testedAt} 以降に実装が変わっています）${C.reset}`);
      console.log(`      ${C.yellow}→ もう一度遊んで npm run playtest -- ${slug}${C.reset}`);
      ng++;
    } else if (rec.verdict !== 'pass') {
      const failed = rec.answers.filter((a) => !a.yes);
      console.log(`  ${C.red}✗${C.reset} ${meta.title}: ${C.red}遊んだ結果、まだ出せない判定です${C.reset}`);
      for (const f of failed) console.log(`      ${C.dim}・${f.q}${C.reset}`);
      ng++;
    } else {
      console.log(`  ${C.green}✓${C.reset} ${meta.title} ${C.dim}（${rec.testedAt} に確認済み）${C.reset}`);
      if (rec.memo) console.log(`      ${C.dim}${rec.memo}${C.reset}`);
    }

    if (meta.inspiration) {
      console.log(`      ${C.yellow}着想元あり: ${meta.inspiration.from}${C.reset}`);
      console.log(`      ${C.dim}docs/design/rights-and-originality.md のチェックリストを通したか確認${C.reset}`);
    }
  }

  console.log('');
  if (ng > 0) {
    console.log(`${C.red}${ng}本がまだ公開できる状態ではありません。${C.reset}`);
    console.log(`${C.dim}ゲートが緑でも、遊んで確かめるまでは終わりではありません。${C.reset}\n`);
    process.exit(1);
  }
  console.log(`${C.green}公開してよい状態です。${C.reset}\n`);
}

void main();
