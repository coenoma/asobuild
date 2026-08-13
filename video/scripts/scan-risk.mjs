#!/usr/bin/env node
/**
 * 画面収録から「映してはいけないものが映っていそうな区間」を洗い出す。
 *
 * 撮影中に気をつけるだけでは必ず漏れる（実際に漏れた: docs/video/safety-checklist.md 末尾）。
 * **編集の工程として機械的に通す**ためのもの。
 *
 *   node scripts/scan-risk.mjs ~/path/画面収録.mov
 *   node scripts/scan-risk.mjs ~/path/画面収録.mov --contact   # 候補のコマ画像も出す
 *
 * 機械にできるのは「いつもと違う画になっている」を見つけるところまで。
 * **出てきた候補は必ず人が見ること。**
 */

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

// `~` を展開する（EDL と同じ書き方で渡せるように）
const raw = process.argv[2];
const file = raw && raw.startsWith('~/') ? resolve(homedir(), raw.slice(2)) : raw;
if (!raw) {
  console.error('使い方: node scripts/scan-risk.mjs <画面収録.mov> [--contact]');
  process.exit(1);
}
const wantContact = process.argv.includes('--contact');

const W = 32, H = 20, FPS = 1;
const BYTES = W * H * 3;
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

console.log('読み込み中（1秒に1コマ）…');

const frames = await new Promise((res, rej) => {
  const out = [];
  let buf = Buffer.alloc(0);
  const ff = spawn('ffmpeg', [
    '-hide_banner', '-v', 'error', '-i', file,
    '-vf', `fps=${FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ]);
  ff.stdout.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= BYTES) {
      out.push(Uint8Array.from(buf.subarray(0, BYTES)));
      buf = buf.subarray(BYTES);
    }
  });
  ff.stderr.on('data', (d) => process.stderr.write(d));
  ff.on('close', (c) => (c === 0 ? res(out) : rej(new Error(`ffmpeg 終了コード ${c}`))));
});

console.log(`${frames.length}コマ（${mmss(frames.length / FPS)}）\n`);

/**
 * 「いつもと違う」を、平均からの遠さでは測れない。
 * 開発画面は正しく使っていても中身がどんどん変わるので、平均はどのコマとも似ていない。
 *
 * 代わりに **めったに出てこない見た目** を探す。
 * 想定どおりのウィンドウ配置は何分も続くが、映ってはいけないものは数秒しか出ない。
 * だから「ざっくりした見た目」で数えて、少数派を疑う。
 */
function signature(f) {
  // 2×2 のブロックごとに平均色を取り、4段階に丸める。
  // ここを細かくすると、ターミナルの文字が流れただけで別物と判定されて使い物にならない
  // （実測: 4×3・8段階では 102件出て、ほとんどが誤検出だった）。
  // **狙うのは「画面全体の見た目が入れ替わった」瞬間だけ**。
  const sig = [];
  for (let by = 0; by < 2; by++) {
    for (let bx = 0; bx < 2; bx++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = Math.floor((by * H) / 2); y < Math.floor(((by + 1) * H) / 2); y++) {
        for (let x = Math.floor((bx * W) / 2); x < Math.floor(((bx + 1) * W) / 2); x++) {
          const i = (y * W + x) * 3;
          r += f[i]; g += f[i + 1]; b += f[i + 2]; n++;
        }
      }
      sig.push(((r / n) >> 6), ((g / n) >> 6), ((b / n) >> 6));
    }
  }
  return sig.join(',');
}

const sigs = frames.map(signature);
const counts = new Map();
for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1);

// 全体の 2% 以下しか出てこない見た目を「めずらしい」とみなす。
// 想定内のウィンドウ配置は必ずこれより長く映っている
const rareLimit = Math.max(5, Math.round(frames.length * 0.02));
const flagged = [];
for (let i = 0; i < sigs.length; i++) if (counts.get(sigs[i]) <= rareLimit) flagged.push(i / FPS);
const dist = sigs.map((s) => counts.get(s));

/** 前後3秒でつながっているものは1つの区間にまとめる */
const segs = [];
for (const t of flagged) {
  const last = segs[segs.length - 1];
  if (last && t - last[1] <= 3) last[1] = t;
  else segs.push([t, t]);
}

// 一瞬のちらつき（ウィンドウの切り替わりの途中など）は拾わない
const shown = segs.filter(([a, b]) => b - a >= 1.5);

console.log(`めずらしい見た目（${rareLimit}秒以下しか出てこない画）`);
console.log('──────────────────────────────────────────────');
if (segs.length === 0) {
  console.log('  候補なし。ただし「机の上の紙」「通知の一瞬」までは見えていない。目でも通すこと。');
} else {
  for (const [a, b] of shown) {
    const rarest = Math.min(...dist.slice(Math.floor(a * FPS), Math.floor(b * FPS) + 1));
    console.log(`  ${mmss(a)} → ${mmss(b)}   ${(b - a + 1).toFixed(0)}秒   この見た目は全体で ${rarest}秒`);
  }
  console.log(`\n  ${shown.length}件（${segs.length - shown.length}件は一瞬なので省いた）。--contact を付けるとコマ画像が出る。`);
}

if (wantContact && shown.length) {
  const dir = resolve('out/risk');
  mkdirSync(dir, { recursive: true });
  console.log(`\nコマ画像 → ${dir}`);
  for (const [a, b] of shown) {
    const at = a + (b - a) / 2;
    execFileSync('ffmpeg', [
      '-hide_banner', '-v', 'error', '-y', '-ss', String(at), '-i', file,
      '-frames:v', '1', '-vf', 'scale=1280:-1', resolve(dir, `risk_${Math.round(at)}s.jpg`),
    ]);
  }
}

console.log('\n見つかったら docs/video/safety-checklist.md §2 の対応表に従う。');
console.log('他プロジェクトの内容が読めるものは、ぼかしではなく**区間ごとカット**。');
