#!/usr/bin/env node
/**
 * 動画を出してよい状態かを、1コマンドで確かめる。ゲーム側の `npm run ship` の動画版。
 *
 *   npm run ship            # 最新の回。機械の関所＋人手の記録を照合
 *   npm run ship -- 001-nuimichi
 *   npm run ship -- --record        # 人手チェックの記録をつける（対話）
 *
 * これまで、動画の関所は3つバラバラだった:
 *   ・sync-check.mjs（機械。時計・反応の先回り・無音）
 *   ・edit-checklist.md（人手。台本・メリハリ・可読性）
 *   ・safety-checklist.md（人手。映り込み・権利）
 * 「出す前にこれを叩けば全部通る」入口が無く、人手のは通し忘れが起きうる。
 *
 * ここで束ねる。人手チェックは**記録に残し、EDL の指紋で照合する**。
 * EDL を直すと指紋が変わり、記録が古くなって落ちる——ゲーム側 playtest と同じ
 * 「直したら確かめ直すまで出せない」構造。機械では代われない部分を人に渡すのが目的。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REPO = resolve(ROOT, '..');
const EDL_DIR = resolve(ROOT, 'edl');
const REC_DIR = resolve(REPO, 'docs/records/video');

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m' };
const OK = `${C.green}✓${C.reset}`;
const NG = `${C.red}✗${C.reset}`;

const args = process.argv.slice(2);
const record = args.includes('--record');
const slugArg = args.find((a) => !a.startsWith('--'));

function latestSlug() {
  const s = readdirSync(EDL_DIR).filter((f) => /^\d.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')).sort().reverse();
  return s[0];
}
const slug = slugArg ?? latestSlug();
if (!slug) {
  console.error('edl/ に回がありません');
  process.exit(1);
}
const edlPath = resolve(EDL_DIR, `${slug}.json`);
if (!existsSync(edlPath)) {
  console.error(`見つかりません: edl/${slug}.json`);
  process.exit(1);
}
const recPath = resolve(REC_DIR, `${slug}.json`);

/**
 * 編集の中身の指紋。**EDL だけでは足りない**——字幕と声の源は原稿（voice/<slug>.json）で、
 * 間詰め・捨て区間（tighten / drops）も最終の音を変える。どれを直しても
 * 「人手チェックの記録は古い」になるべきなので、あるものを全部まとめてハッシュする。
 */
function edlHash() {
  const parts = [
    edlPath,
    resolve(ROOT, 'voice', `${slug}.json`),
    resolve(ROOT, 'voice', `${slug}.atereco.json`),
    resolve(ROOT, 'voice', `${slug}.tighten.json`),
    resolve(ROOT, 'voice', `${slug}.drops.json`),
  ];
  const h = createHash('sha256');
  for (const p of parts) if (existsSync(p)) h.update(readFileSync(p, 'utf8'));
  return h.digest('hex').slice(0, 16);
}

/**
 * 人手チェックの要点。全項目ではなく「機械では代われない・忘れると事故る」ものだけ。
 * 出典: safety-checklist.md §5 と edit-checklist.md §3。
 */
const QUESTIONS = [
  { key: 'risk-all', q: 'scan-risk の候補を全部見て、危ない区間は EDL の risks に書き写した？' },
  { key: 'no-original', q: '原作の画像・ロゴ・タイトルが1フレームも入っていない？' },
  { key: 'no-leak', q: '通知・メニュー・Dock・他プロジェクト・個人情報が映っていない？' },
  { key: 'url-prod', q: 'URL は本番のものだけ？' },
  { key: 'mitai', q: '題材への言及が「〜みたいな」「〜風」になっている（誤認させる書き方をしていない）？' },
  { key: 'voice-real', q: 'AIが実際にやったことと、言っていることが合っている（確かめていないことを断言していない）？' },
  { key: 'watched', q: '通しで1回、人が最後まで見た？（声と画のズレ・のっぺりを目で確認した）' },
];

/* ---------- --record（対話で記録をつける） ---------- */

if (record) {
  // readline の question をトップレベル await で回すと、パイプ入力（複数行を一度に流す）で
  // 2問目以降が宙に浮く。line イベントで1問ずつ順に処理する形にする（対話でもパイプでも動く）
  console.log(`\n${C.bold}${slug} の公開前チェック${C.reset}（y/n。1つでも n があると出せません）\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answers = [];
  const prompt = () => process.stdout.write(`  ${QUESTIONS[answers.length].q} [y/n] `);
  prompt();
  rl.on('line', (line) => {
    const a = String(line).trim().toLowerCase();
    const item = QUESTIONS[answers.length];
    answers.push({ key: item.key, q: item.q, yes: a === 'y' || a === 'yes' });
    if (answers.length < QUESTIONS.length) prompt();
    else rl.close();
  });
  rl.on('close', () => {
    const allYes = answers.length === QUESTIONS.length && answers.every((x) => x.yes);
    // 日付は環境から（Date.now は使わずコマンドで撮る。ゲーム側の作法に揃える）
    const today = spawnSync('date', ['+%Y-%m-%d'], { encoding: 'utf8' }).stdout.trim();
    mkdirSync(REC_DIR, { recursive: true });
    writeFileSync(
      recPath,
      JSON.stringify({ slug, checkedAt: today, edlHash: edlHash(), verdict: allYes ? 'pass' : 'fail', answers }, null, 2) + '\n',
      'utf8',
    );
    console.log(`\n記録しました: docs/records/video/${slug}.json（${allYes ? 'pass' : 'fail'}）`);
    if (!allYes) {
      console.log(`${C.yellow}n の項目を直してから、もう一度 --record してください。${C.reset}`);
      process.exit(1);
    }
    console.log(`次: npm run ship -- ${slug}（機械の関所とあわせて最終確認）`);
    process.exit(0);
  });
} else {
  runGate();
}

/* ---------- 通常（機械の関所＋記録の照合） ---------- */

function runGate() {
  console.log(`\n${C.bold}公開前の関所 ── ${slug}${C.reset}\n`);
  let ng = 0;

  // 1. 型
  const tc = spawnSync('npx', ['tsc', '--noEmit'], { cwd: ROOT, encoding: 'utf8' });
  if (tc.status === 0) console.log(`  ${OK} 型`);
  else { console.log(`  ${NG} 型（npm run typecheck で詳細）`); ng++; }

  // 2. sync-check（✗があると exit 1）
  const sc = spawnSync('node', ['scripts/sync-check.mjs', `edl/${slug}.json`], { cwd: ROOT, encoding: 'utf8' });
  if (sc.status === 0) console.log(`  ${OK} 編集と声のズレ（sync-check）`);
  else { console.log(`  ${NG} sync-check に ✗（node scripts/sync-check.mjs edl/${slug}.json）`); ng++; }

  // 3. 人手チェックの記録が、いまの EDL のものか
  if (!existsSync(recPath)) {
    console.log(`  ${NG} 人手チェックの記録がない → ${C.yellow}npm run ship -- ${slug} --record${C.reset}`);
    ng++;
  } else {
    const rec = JSON.parse(readFileSync(recPath, 'utf8'));
    if (rec.verdict !== 'pass') {
      console.log(`  ${NG} 人手チェックが pass でない（n の項目が残っている）→ --record で直す`);
      ng++;
    } else if (rec.edlHash !== edlHash()) {
      console.log(`  ${NG} ${C.red}記録が古い（${rec.checkedAt}のあとで編集の中身＝EDL/原稿/間詰めを直した）${C.reset} → もう一度 --record`);
      ng++;
    } else {
      console.log(`  ${OK} 人手チェック済み（${rec.checkedAt}・いまの EDL と一致）`);
    }
  }

  console.log('');
  if (ng === 0) {
    console.log(`${C.green}出してよい状態です。${C.reset}`);
    console.log(`${C.dim}公開当日の段取り（概要欄・固定コメント・meta.video）は docs/video/publish-checklist.md${C.reset}\n`);
    process.exit(0);
  }
  console.log(`${C.red}まだ出せません（${ng}件）。${C.reset}`);
  console.log(`${C.dim}関所の中身: edit-checklist.md / safety-checklist.md${C.reset}\n`);
  process.exit(1);
}
