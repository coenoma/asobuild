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

function opt(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

function usage(slug: string): void {
  console.error(`
この記録は${C.bold}人が遊んで答えるもの${C.reset}です。対話できる画面がないときは、答えを引数で渡してください。

  ${C.yellow}npm run playtest -- ${slug} --a yyyyyy --memo "ひとこと"${C.reset}

  --a は6文字の y/n。順番はこの問いに対応します:`);
  QUESTIONS.forEach((q, i) => console.error(`    ${i + 1}. ${q}`));
  console.error(`
  ${C.dim}※ この引数は「遊んだ人」が答えを渡すためのものです。
     遊んでいない人（AIを含む）が埋めてよいものではありません。${C.reset}
`);
}

async function main(): Promise<void> {
  const slug = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!slug || !metas.some((m) => m.slug === slug)) {
    console.error(`使い方: npm run playtest -- <slug>`);
    console.error(`登録されているゲーム: ${metas.map((m) => m.slug).join(', ')}`);
    process.exit(1);
  }
  const meta = metas.find((m) => m.slug === slug)!;

  // 答えを引数で受け取る形。Claude Code の `!` 実行のように、
  // 対話はできないが人が答えを持っている場面のためにある
  const given = (opt('a') ?? opt('answers'))?.trim().toLowerCase();
  if (given) {
    if (!/^[yn]+$/.test(given) || given.length !== QUESTIONS.length) {
      console.error(`${C.red}--a は y と n を ${QUESTIONS.length}文字ならべてください（例: yyynyy）${C.reset}`);
      usage(slug);
      process.exit(1);
    }
    const answers = QUESTIONS.map((q, i) => ({ q, yes: given[i] === 'y' }));
    const failed = answers.filter((a) => !a.yes);
    const verdict: 'pass' | 'fail' = failed.length === 0 ? 'pass' : 'fail';
    await writeRecord({
      slug,
      testedAt: new Date().toISOString().slice(0, 10),
      codeHash: await codeHashOf(slug),
      answers,
      verdict,
      memo: (opt('memo') ?? '').trim(),
    });
    console.log('');
    for (const a of answers) {
      console.log(`  ${a.yes ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`} ${a.q}`);
    }
    console.log('');
    if (verdict === 'pass') {
      console.log(`  ${C.green}記録しました。公開してよい状態です。${C.reset}`);
    } else {
      console.log(`  ${C.red}まだ出せません。${failed.length}個ひっかかっています${C.reset}`);
      console.log(`  ${C.yellow}直してから、もう一度遊んで記録し直してください。${C.reset}`);
    }
    console.log(`  ${C.dim}${recordPath(slug)}${C.reset}\n`);
    return;
  }

  if (!process.stdin.isTTY) {
    usage(slug);
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
