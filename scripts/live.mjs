#!/usr/bin/env node
/**
 * 収録カンペ（/live）へ、いまの状況を流す。
 *
 *   npm run say -- "ボットが全滅した"        いまの一言（画面の主役）
 *   npm run live -- phase じっそう           フェーズを進める
 *   npm run live -- timer start 25 ポテトM   制限時間を開始（分）
 *   npm run live -- timer stop               制限時間を止める
 *   npm run live -- clear                    収録の開始時にログを空にする
 *   npm run live -- archive                  台本として docs/worklog/ へ移す
 *
 * 追記しかしない1行1JSONのログにしてある。書き手（ここ・面白さゲート）と
 * 読み手（/live）が疎結合なので、どちらが落ちてももう一方は壊れない。
 * 収録中に止まらないことを最優先している。
 */

import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.live');
const FILE = path.join(DIR, 'status.jsonl');

async function append(event) {
  await mkdir(DIR, { recursive: true });
  await appendFile(FILE, `${JSON.stringify({ t: Date.now(), ...event })}\n`, 'utf8');
}

function usage() {
  console.log(`収録カンペに流す

  npm run say -- "文言"                 いまの一言
  npm run live -- phase <きかく|じっそう|けんてい|ためし>
  npm run live -- timer start <分> [ラベル]
  npm run live -- timer stop
  npm run live -- clear                 ログを空にする（収録開始時）
  npm run live -- archive               docs/worklog/ へ移して台本にする

カンペは開発サーバーの http://localhost:3020/live で開く。`);
}

const [cmd, ...rest] = process.argv.slice(2);

switch (cmd) {
  case 'say': {
    const text = rest.join(' ').trim();
    if (!text) {
      console.error('文言がありません: npm run say -- "文言"');
      process.exit(1);
    }
    await append({ kind: 'say', text });
    console.log(`カンペ: ${text}`);
    break;
  }

  case 'phase': {
    const phase = rest.join(' ').trim();
    if (!phase) {
      console.error('フェーズを指定してください（きかく / じっそう / けんてい / ためし）');
      process.exit(1);
    }
    await append({ kind: 'phase', phase });
    console.log(`フェーズ: ${phase}`);
    break;
  }

  case 'timer': {
    const action = rest[0];
    if (action === 'start') {
      const minutes = Number(rest[1]);
      if (!minutes || minutes <= 0) {
        console.error('分を指定してください: npm run live -- timer start 25 ポテトM');
        process.exit(1);
      }
      const label = rest.slice(2).join(' ') || '制限時間';
      await append({ kind: 'timer', action: 'start', seconds: Math.round(minutes * 60), label });
      console.log(`計測開始: ${label} ${minutes}分`);
    } else if (action === 'stop') {
      await append({ kind: 'timer', action: 'stop' });
      console.log('計測終了');
    } else {
      console.error('timer は start か stop');
      process.exit(1);
    }
    break;
  }

  case 'clear': {
    await mkdir(DIR, { recursive: true });
    // 空にする前に退避する。台本にし忘れた収録が消えないように
    try {
      const prev = await readFile(FILE, 'utf8');
      if (prev.trim()) {
        const first = JSON.parse(prev.split('\n').filter(Boolean)[0]);
        const stamp = new Date(first.t).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
        await rename(FILE, `${FILE}.${stamp}.bak`);
        console.log(`前のログは status.jsonl.${stamp}.bak に退避しました`);
      }
    } catch {
      // ログが無い・壊れている場合はそのまま空にする
    }
    await writeFile(FILE, '', 'utf8');
    console.log('カンペのログを空にしました');
    break;
  }

  case 'archive': {
    if (!existsSync(FILE)) {
      console.error('ログがありません');
      process.exit(1);
    }
    const text = await readFile(FILE, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    if (lines.length === 0) {
      console.error('ログが空です');
      process.exit(1);
    }
    const first = JSON.parse(lines[0]);
    const stamp = new Date(first.t).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const outDir = path.join(ROOT, 'docs/worklog');
    await mkdir(outDir, { recursive: true });

    // そのまま読める台本にする（何分に何が起きたか）
    const start = first.t;
    const md = [`# 収録ログ ${new Date(first.t).toLocaleString('ja-JP')}`, ''];
    for (const line of lines) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const sec = Math.max(0, Math.round((e.t - start) / 1000));
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      if (e.kind === 'say') md.push(`- \`${mm}:${ss}\` ${e.text}`);
      else if (e.kind === 'phase') md.push(`- \`${mm}:${ss}\` **［${e.phase}］**`);
      else if (e.kind === 'timer')
        md.push(`- \`${mm}:${ss}\` ${e.action === 'start' ? `⏱ ${e.label} 開始` : '⏱ 終了'}`);
      else if (e.kind === 'gate')
        md.push(`- \`${mm}:${ss}\` 🧪 ${e.slug}: ${e.pass ? '合格' : `不合格（${e.checks.filter((c) => !c.pass).map((c) => c.label).join('・')}）`}`);
    }
    const out = path.join(outDir, `${stamp}-収録ログ.md`);
    await writeFile(out, `${md.join('\n')}\n`, 'utf8');
    await rename(FILE, `${FILE}.${stamp}.bak`);
    console.log(`台本にしました: ${path.relative(ROOT, out)}`);
    break;
  }

  default:
    usage();
    process.exit(cmd ? 1 : 0);
}
