/**
 * 遊んで確かめた記録の読み書き。
 * 対話する側（playtest.ts）と確認する側（ship-check.ts）の両方から使う。
 */

import { createHash } from 'node:crypto';

/**
 * 遊んだあとに答える問い。
 * どれも「面白かったか」ではなく、**起きた事実**を聞いている。
 * 感想は人によってぶれるが、事実ならぶれない。
 */
export const QUESTIONS = [
  '説明を読まずに、何をすればいいか分かった？',
  '最初の10秒のうちに、1回は失敗した？',
  '失敗したとき、なぜ失敗したのか自分で分かった？',
  'うまくいった瞬間、気持ちよかった？',
  '終わったあと、指が勝手にもう一回押した？',
  '音を消して30秒眺めて、何が起きているか分かる？',
] as const;

export interface PlaytestRecord {
  slug: string;
  testedAt: string;
  /** 実装の指紋。コードを直すとここが変わり、記録が古いと分かる */
  codeHash: string;
  answers: { q: string; yes: boolean }[];
  verdict: 'pass' | 'fail';
  memo: string;
}

export function recordPath(slug: string): string {
  return `docs/records/playtest/${slug}.json`;
}

/** ゲーム実装の指紋をとる */
export async function codeHashOf(slug: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const parts: string[] = [];
  for (const f of ['game.ts', 'meta.ts']) {
    try {
      parts.push(await readFile(path.join(process.cwd(), 'src/games', slug, f), 'utf8'));
    } catch {
      // ファイルが無ければ空として扱う
    }
  }
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

export async function readRecord(slug: string): Promise<PlaytestRecord | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const text = await readFile(path.join(process.cwd(), recordPath(slug)), 'utf8');
    return JSON.parse(text) as PlaytestRecord;
  } catch {
    return null;
  }
}

export async function writeRecord(record: PlaytestRecord): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(process.cwd(), recordPath(record.slug));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}
