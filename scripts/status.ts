/**
 * リポジトリの健康状態を1コマンドで出す。
 *
 *   npm run status
 *
 * 「いま何が終わっていて、何が終わっていないか」が
 * git・ゲート記録・遊んだ記録・OGP・公開状態と、複数の場所に散っている。
 * それを1画面にまとめて、**やり残しが見える状態**にするためのもの。
 *
 * 特に見たいのはこの3つ。
 *   ・公開されているのに、まだ人が遊んで確かめていないもの
 *   ・実装を直したのに、記録が古いままのもの
 *   ・コミットされずに置き去りになっているもの
 */

import { FUN_GATE_DEFAULT } from '../src/arcade/fun-gate';
import { metas } from '../src/games/registry';
import { codeHashOf, readRecord as readPlaytest } from './playtest-record';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

const OK = `${C.green}✓${C.reset}`;
const NG = `${C.red}✗${C.reset}`;
const WARN = `${C.yellow}▲${C.reset}`;

async function sh(cmd: string, args: string[]): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  try {
    const { stdout } = await promisify(execFile)(cmd, args, { cwd: process.cwd() });
    return stdout.trim();
  } catch {
    return '';
  }
}

async function exists(rel: string): Promise<boolean> {
  try {
    const { access } = await import('node:fs/promises');
    const path = await import('node:path');
    await access(path.join(process.cwd(), rel));
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    return JSON.parse(await readFile(path.join(process.cwd(), rel), 'utf8')) as T;
  } catch {
    return null;
  }
}

/** 各ゲームの仕上がり具合 */
async function games(): Promise<number> {
  console.log(`\n${C.bold}ゲーム${C.reset}`);
  let problems = 0;

  for (const meta of metas) {
    const botsu = meta.status === 'botsu';
    const gate = await readJson<{ pass: boolean; recordedAt: string }>(
      `docs/records/gate/${meta.slug}.json`,
    );
    const play = await readPlaytest(meta.slug);
    const hash = await codeHashOf(meta.slug);
    const ogp = await exists(`public/ogp/${meta.slug}.png`);
    const plan = await exists(`docs/plans`);

    const marks: string[] = [];
    if (!gate) marks.push(`${NG} ゲート未実施`);
    else if (!gate.pass) marks.push(`${NG} ゲート不合格`);
    else marks.push(`${OK} ゲート`);

    if (botsu) {
      marks.push(`${C.dim}ボツ棚（確認の対象外）${C.reset}`);
    } else if (!play) {
      marks.push(`${NG} ${C.red}まだ人が遊んでいない${C.reset}`);
      problems++;
    } else if (play.codeHash !== hash) {
      marks.push(`${NG} ${C.red}遊んだ記録が古い（${play.testedAt}以降に実装が変わった）${C.reset}`);
      problems++;
    } else if (play.verdict !== 'pass') {
      marks.push(`${NG} ${C.red}遊んだ結果、まだ出せない判定${C.reset}`);
      problems++;
    } else {
      marks.push(`${OK} 遊んで確認済み（${play.testedAt}）`);
    }

    if (!ogp) {
      marks.push(`${WARN} OGP未生成`);
    }
    if (meta.inspiration) {
      marks.push(`${WARN} 着想元あり（権利チェック要）`);
    }
    void plan;

    console.log(`  ${C.bold}${meta.title}${C.reset} ${C.dim}(${meta.slug})${C.reset}`);
    for (const m of marks) console.log(`    ${m}`);
  }
  return problems;
}

/** git の状態。置き去りになっている成果物を見つける */
async function repo(): Promise<number> {
  console.log(`\n${C.bold}リポジトリ${C.reset}`);
  let problems = 0;

  const dirty = await sh('git', ['status', '--porcelain']);
  const lines = dirty.split('\n').filter(Boolean);
  if (lines.length === 0) {
    console.log(`  ${OK} 未コミットの変更なし`);
  } else {
    console.log(`  ${WARN} ${C.yellow}未コミットの変更が ${lines.length}件${C.reset}`);
    for (const l of lines.slice(0, 8)) console.log(`      ${C.dim}${l}${C.reset}`);
    if (lines.length > 8) console.log(`      ${C.dim}…ほか ${lines.length - 8}件${C.reset}`);
    problems++;
  }

  const ahead = await sh('git', ['rev-list', '--count', 'origin/main..HEAD']);
  if (ahead && ahead !== '0') {
    console.log(`  ${WARN} ${C.yellow}push していないコミットが ${ahead}件${C.reset}`);
    problems++;
  } else {
    console.log(`  ${OK} push 済み`);
  }
  return problems;
}

/**
 * ドキュメントの目安と、ゲートの実際のしきい値を並べる。
 * 一度ここが食い違っていて（原則40〜90秒／実際の上限240秒）、
 * 明らかに長すぎるゲームが素通りしたことがある。
 */
function thresholds(): void {
  console.log(`\n${C.bold}ゲートのしきい値（原則との対応）${C.reset}`);
  const rows: [string, string, string][] = [
    ['1プレイ（上手い人）', '40〜90秒', `${FUN_GATE_DEFAULT.smartSurvivalMinSec}〜${FUN_GATE_DEFAULT.smartSurvivalMaxSec}秒`],
    ['1プレイ（初見）', '10〜20秒', `${FUN_GATE_DEFAULT.randomSurvivalMinSec}〜${FUN_GATE_DEFAULT.randomSurvivalMaxSec}秒`],
    ['ひととおり遊ぶ', '15〜30分', `${FUN_GATE_DEFAULT.sessionMinutesMin}〜${FUN_GATE_DEFAULT.sessionMinutesMax}分（ボット基準）`],
    ['放置で終わるまで', '—', `${FUN_GATE_DEFAULT.idleSurvivalMaxSec}秒以内`],
    ['腕前の差', '—', `${FUN_GATE_DEFAULT.skillRatioMin}倍以上`],
    ['上振れ', '—', `${FUN_GATE_DEFAULT.upsideRatioMin}倍以上`],
    ['画面が動く間隔', '—', `${FUN_GATE_DEFAULT.eventIntervalMinSec}〜${FUN_GATE_DEFAULT.eventIntervalMaxSec}秒`],
  ];
  console.log(`  ${C.dim}${'項目'.padEnd(20)} ${'原則の目安'.padEnd(12)} 実際の基準${C.reset}`);
  for (const [k, doc, gate] of rows) {
    console.log(`  ${k.padEnd(20)} ${C.dim}${doc.padEnd(12)}${C.reset} ${gate}`);
  }
  console.log(
    `  ${C.dim}原則は docs/design/fun-doctrine.md §6。食い違っていたらどちらかが古い${C.reset}`,
  );
}

/** 作った仕組みが使われているか */
async function tools(): Promise<void> {
  console.log(`\n${C.bold}仕組みの使われ方${C.reset}`);
  const live = await readJson<unknown>('.live/status.jsonl').catch(() => null);
  void live;
  try {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const text = await readFile(path.join(process.cwd(), '.live/status.jsonl'), 'utf8');
    const events = text
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as { kind: string };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { kind: string }[];
    const say = events.filter((e) => e.kind === 'say').length;
    const gate = events.filter((e) => e.kind === 'gate').length;
    if (say === 0) {
      console.log(`  ${WARN} カンペ: 手で書いた一言が0件（自動記録 ${gate}件のみ）`);
      console.log(`      ${C.dim}収録するなら npm run say -- "文言" で流す${C.reset}`);
    } else {
      console.log(`  ${OK} カンペ: 一言 ${say}件 / ゲートの自動記録 ${gate}件`);
    }
  } catch {
    console.log(`  ${C.dim}−  カンペ: ログなし（収録していなければ正常）${C.reset}`);
  }
}

/** AIには確認できないこと。ここを人に渡さないと完成にならない */
function limits(): void {
  console.log(`\n${C.bold}AIでは確かめられないこと${C.reset}`);
  console.log(`  ${C.dim}・実際に遊ぶ（裏に回ったタブではフレームが止まるため触れない）`);
  console.log(`  ・見た目の良し悪しを決める（静止画で撮れるのは機能確認まで）`);
  console.log(`  ・playtest の記録をつける（遊んでいないので答える資格がない）${C.reset}`);
}

async function main(): Promise<void> {
  console.log(`${C.bold}アソビルドの状態${C.reset}`);
  const p1 = await games();
  const p2 = await repo();
  thresholds();
  await tools();
  limits();

  console.log('');
  const total = p1 + p2;
  if (total === 0) {
    console.log(`${C.green}やり残しはありません。${C.reset}\n`);
  } else {
    console.log(`${C.yellow}やり残しが ${total}件あります。${C.reset}`);
    console.log(`${C.dim}公開の前には npm run ship を通すこと。${C.reset}\n`);
  }
}

void main();
