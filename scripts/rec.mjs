#!/usr/bin/env node
/**
 * 収録モードで開発サーバーを立てる。
 *
 *   npm run dev:rec
 *
 * 普通の `npm run dev` との違いは3つ。
 *   1. カンペのログを空にしてから始める（前回の収録が混ざらない）
 *   2. 立ち上がったらカンペ（/live）を自動で開く
 *   3. 収録前のチェックリストを出す（映り込み事故の予防）
 *
 * 画面隅の開発バッジは next.config.ts の devIndicators: false で消してある。
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '3020';
const BASE = `http://localhost:${PORT}`;

const LOG = path.join(ROOT, '.live/status.jsonl');
await mkdir(path.join(ROOT, '.live'), { recursive: true });

// 前回のログは、空にする前に必ず退避する。
// ここで無条件に潰していたため、archive し忘れた収録の台本が消える状態だった
let carried = '';
try {
  const prev = await readFile(LOG, 'utf8');
  if (prev.trim()) {
    const first = JSON.parse(prev.split('\n').filter(Boolean)[0]);
    const stamp = new Date(first.t).toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    await rename(LOG, `${LOG}.${stamp}.bak`);
    carried = `\n  ⚠️ 前回のログを .live/status.jsonl.${stamp}.bak に退避しました\n     台本にするなら: npm run live -- archive（退避ファイルを戻してから）\n`;
  }
} catch {
  // ログが無い・壊れている場合はそのまま始める
}
await writeFile(LOG, '', 'utf8');

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  収録モード
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  撮る前に

    □ 通知を切った（Slack・メール・カレンダー）
    □ 他プロジェクトのウィンドウを閉じた
       ※ このリポジトリは PUBLIC。映ったものは公開されると思って扱う
    □ ブラウザのタブとブックマークバーを整理した
    □ 制約の現物（ポテト・コーヒー等）を用意した

  つかうもの

    カンペ   ${BASE}/live      ← 別ウィンドウで開いて録画に映す
    サイト   ${BASE}

  収録中のコマンド

    npm run live -- timer start 12 "ポテトM"
    npm run live -- phase じっそう
    npm run say -- "ボットが全滅した"

  終わったら

    npm run live -- archive      台本を docs/worklog/ に書き出す

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${carried}`);

const dev = spawn('npm', ['run', 'dev'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PORT },
});

// 立ち上がるのを待ってからカンペを開く
async function openWhenReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/live`);
      if (res.ok) {
        if (process.platform === 'darwin') {
          spawn('open', [`${BASE}/live`], { stdio: 'ignore', detached: true }).unref();
          console.log(`\nカンペを開きました → ${BASE}/live\n`);
        } else {
          console.log(`\nカンペはこちら → ${BASE}/live\n`);
        }
        return;
      }
    } catch {
      // まだ立ち上がっていないだけ
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`\nカンペを開けませんでした。手で開いてください → ${BASE}/live\n`);
}

void openWhenReady();

dev.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => dev.kill('SIGINT'));
process.on('SIGTERM', () => dev.kill('SIGTERM'));
