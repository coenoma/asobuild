/**
 * 人が実際に遊んで確かめた記録を残す。
 *
 *   npm run playtest -- tamago
 *
 * なぜこれが要るのか。
 *
 * 面白さゲートは「面白くなりようがない状態」を弾くだけで、**面白さは保証しない**。
 * それを知っていたのに、緑になった時点で人の確認を止めて「完成」と言ってしまったことがある
 * （たまごポン初版。遊ぶと何をすればいいか分からないゲームだった）。
 *
 * 問題は確認を怠ったこと自体ではなく、**怠ったことが誰にも分からなかった**こと。
 * だからここでは「人が遊んだ」を成果物として残し、
 * 実装が変わったら記録が自動的に古くなるようにしている。
 */

import { createInterface } from 'node:readline/promises';
import { metas } from '../src/games/registry';
import { codeHashOf, QUESTIONS, recordPath, writeRecord, type PlaytestRecord } from './playtest-record';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
};

async function main(): Promise<void> {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug || !metas.some((m) => m.slug === slug)) {
    console.error(`使い方: npm run playtest -- <slug>`);
    console.error(`登録されているゲーム: ${metas.map((m) => m.slug).join(', ')}`);
    process.exit(1);
  }
  const meta = metas.find((m) => m.slug === slug)!;

  if (!process.stdin.isTTY) {
    console.error('この記録は人が答えるものなので、対話できる画面から実行してください。');
    process.exit(1);
  }

  console.log(`
${C.bold}${meta.title}${C.reset} を遊んだ記録をつけます。

  ${C.yellow}先に実際に3回遊んでください。${C.reset}
  ${C.dim}npm run dev → http://localhost:3020/g/${slug}${C.reset}

  面白さゲートは「面白くなりようがない状態」を弾くだけで、
  面白さそのものは保証しません。ここが最後の関所です。
`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answers: { q: string; yes: boolean }[] = [];

  try {
    for (const q of QUESTIONS) {
      let yes: boolean | null = null;
      while (yes === null) {
        const a = (await rl.question(`  ${q} ${C.dim}[y/n]${C.reset} `)).trim().toLowerCase();
        if (a === 'y' || a === 'yes') yes = true;
        else if (a === 'n' || a === 'no') yes = false;
        else console.log(`  ${C.dim}y か n で答えてください${C.reset}`);
      }
      answers.push({ q, yes });
    }

    const failed = answers.filter((a) => !a.yes);
    const verdict: 'pass' | 'fail' = failed.length === 0 ? 'pass' : 'fail';
    const memo = (await rl.question(`  気づいたこと（任意） `)).trim();

    const record: PlaytestRecord = {
      slug,
      testedAt: new Date().toISOString().slice(0, 10),
      codeHash: await codeHashOf(slug),
      answers,
      verdict,
      memo,
    };
    await writeRecord(record);

    console.log('');
    if (verdict === 'pass') {
      console.log(`  ${C.green}記録しました。公開してよい状態です。${C.reset}`);
    } else {
      console.log(`  ${C.red}まだ出せません。${failed.length}個ひっかかっています${C.reset}`);
      for (const f of failed) console.log(`    ${C.red}・${f.q}${C.reset}`);
      console.log(`\n  ${C.yellow}直してから、もう一度遊んで記録し直してください。${C.reset}`);
      console.log(`  ${C.dim}ここで妥協すると、遊ぶ人には必ず伝わります。${C.reset}`);
    }
    console.log(`  ${C.dim}${recordPath(slug)}${C.reset}\n`);
  } finally {
    rl.close();
  }
}

void main();
