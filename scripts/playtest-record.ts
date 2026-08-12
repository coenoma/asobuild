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
  /**
   * 過去の記録。
   *
   * ここが無いと、直して遊び直した瞬間に **fail のときの指摘が上書きで消える**。
   * 指摘こそが手触りカタログの原料なので、消えると学びが1回で終わってしまう。
   * （実際、`tamatsunagi` の「通ったはずなのにスルーされた」は
   *   人の記憶から手で写して残した。次も同じ運を期待しない）
   */
  history?: PastPlaytest[];
}

export interface PastPlaytest {
  testedAt: string;
  codeHash: string;
  verdict: 'pass' | 'fail';
  /** ひっかかった問い */
  failed: string[];
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

  // 前の記録を履歴に送ってから上書きする。
  // 特に fail の指摘は、直したあとの記録で消えてしまうと二度と読めない
  const prev = await readRecord(record.slug);
  const history = [...(prev?.history ?? [])];
  if (prev && prev.codeHash !== record.codeHash) {
    history.push({
      testedAt: prev.testedAt,
      codeHash: prev.codeHash,
      verdict: prev.verdict,
      failed: prev.answers.filter((a) => !a.yes).map((a) => a.q),
      memo: prev.memo,
    });
  }

  const file = path.join(process.cwd(), recordPath(record.slug));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({ ...record, ...(history.length ? { history } : {}) }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * これまでに遊んで出た指摘を、全ゲームから集める。
 *
 * 次のゲームを作るときにいちばん効くのは、原則よりも
 * **前に実際に言われたこと**なので、読める場所に出しておく。
 */
export async function collectFindings(
  slugs: string[],
): Promise<{ slug: string; testedAt: string; failed: string[]; memo: string }[]> {
  const out: { slug: string; testedAt: string; failed: string[]; memo: string }[] = [];
  for (const slug of slugs) {
    const rec = await readRecord(slug);
    if (!rec) continue;
    const rows: PastPlaytest[] = [
      ...(rec.history ?? []),
      {
        testedAt: rec.testedAt,
        codeHash: rec.codeHash,
        verdict: rec.verdict,
        failed: rec.answers.filter((a) => !a.yes).map((a) => a.q),
        memo: rec.memo,
      },
    ];
    for (const r of rows) {
      // 通っていても、メモが残っているなら気づきとして拾う
      if (r.failed.length === 0 && !r.memo) continue;
      out.push({ slug, testedAt: r.testedAt, failed: r.failed, memo: r.memo });
    }
  }
  return out.sort((a, b) => (a.testedAt < b.testedAt ? 1 : -1));
}
