/**
 * 文書のリンク切れ検査。
 *
 *   npm run links      # 一瞬で終わる。npm run check にも入っている
 *
 * このリポジトリは「地図」の文書（CLAUDE.md・platforms.md・genre-map・はじめかた…）が
 * 互いにリンクで繋がっていることで成り立っている。リンクが切れていても誰も気づかないと、
 * 新しく来た人がそこで迷子になる。ここでは **md の相対リンクの行き先が実在するか** だけを見る。
 *
 * 見ないもの:
 *   ・外部URL（http/https）— ネットに出ない
 *   ・アンカー（#見出し）— ファイルの存在だけ確認して、見出しの有無までは見ない
 *   ・コードブロックの中 — 例示のパスが混ざるため
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** 検査する md を集める。生成物と外部のものは見ない */
function collectMd(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', '.next', '.live', 'out', 'public'].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      collectMd(full, out);
    } else if (name.endsWith('.md')) {
      out.push(full);
    }
  }
}

const files: string[] = [];
collectMd(ROOT, files);

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

let broken = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  let inFence = false;
  lines.forEach((line, i) => {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const m of line.matchAll(LINK)) {
      const raw = m[1];
      // 外部・アンカーのみ・メールは対象外
      if (/^(https?:|mailto:|#|data:)/.test(raw)) continue;
      const target = raw.split('#')[0];
      if (!target) continue;
      const resolved = target.startsWith('/')
        ? path.join(ROOT, target)
        : path.resolve(path.dirname(file), target);
      if (!existsSync(resolved)) {
        const rel = path.relative(ROOT, file);
        console.log(`✗ ${rel}:${i + 1}  →  ${raw}`);
        broken += 1;
      }
    }
  });
}

if (broken === 0) {
  console.log(`リンク切れはありません（md ${files.length}件を検査）`);
} else {
  console.log(`\n${broken} 件のリンクが切れています。行き先を直すか、リンクを外してください。`);
}
process.exit(broken === 0 ? 0 : 1);
