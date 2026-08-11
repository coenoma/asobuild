import { NextResponse } from 'next/server';

/**
 * 収録1回分をまとめて、エンディングカードの材料にする。**開発時だけ**動く。
 *
 * カンペのログ（何時に何が起きたか）と git（どれだけ書いたか）を突き合わせる。
 * 動画の締めに出すカードを毎回手で作らなくて済むようにするのが目的。
 */
export const dynamic = 'force-dynamic';

interface LiveEvent {
  t: number;
  kind: string;
  phase?: string;
  slug?: string;
  pass?: boolean;
  topReason?: string | null;
  action?: string;
  label?: string;
  seconds?: number;
}

async function git(args: string[]): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  try {
    const { stdout } = await run('git', args, { cwd: process.cwd(), maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } catch {
    return '';
  }
}

/** `--numstat` の出力（追加\t削除\tパス）を足し合わせる */
function sumNumstat(text: string): { added: number; removed: number; files: Set<string> } {
  let added = 0;
  let removed = 0;
  const files = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
    if (!m) continue;
    // バイナリは `-` で出るので数えない
    if (m[1] !== '-') added += Number(m[1]);
    if (m[2] !== '-') removed += Number(m[2]);
    files.add(m[3]);
  }
  return { added, removed, files };
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('not found', { status: 404 });
  }

  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');

  let events: LiveEvent[] = [];
  try {
    const text = await readFile(path.join(process.cwd(), '.live', 'status.jsonl'), 'utf8');
    events = text
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as LiveEvent;
        } catch {
          return null;
        }
      })
      .filter((e): e is LiveEvent => e !== null);
  } catch {
    // ログが無ければ空のカードを返す
  }

  if (events.length === 0) {
    return NextResponse.json({ empty: true });
  }

  const startedAt = events[0].t;
  const endedAt = events[events.length - 1].t;

  // フェーズごとの所要時間
  const phaseEvents = events.filter((e) => e.kind === 'phase');
  const phases = phaseEvents.map((e, i) => ({
    name: e.phase ?? '',
    seconds: Math.max(0, ((phaseEvents[i + 1]?.t ?? endedAt) - e.t) / 1000),
  }));

  // ゲートは何回走らせて、何回目で通ったか
  const gates = events.filter((e) => e.kind === 'gate');
  const passedIndex = gates.findIndex((g) => g.pass);
  const topReason = [...gates].reverse().find((g) => g.topReason)?.topReason ?? null;
  const slugs = [...new Set(gates.map((g) => g.slug).filter(Boolean))] as string[];

  // 制限時間つきの企画だったか
  const timerStart = events.find((e) => e.kind === 'timer' && e.action === 'start');

  // どれだけ書いたか（収録開始以降のコミット＋まだコミットしていない分）
  const since = new Date(startedAt).toISOString();
  const [logOut, diffOut, commitsOut] = await Promise.all([
    git(['log', `--since=${since}`, '--numstat', '--pretty=format:']),
    git(['diff', '--numstat', 'HEAD']),
    git(['log', `--since=${since}`, '--oneline']),
  ]);
  const a = sumNumstat(logOut);
  const b = sumNumstat(diffOut);

  return NextResponse.json({
    empty: false,
    startedAt,
    endedAt,
    totalSeconds: (endedAt - startedAt) / 1000,
    phases,
    limit: timerStart ? { label: timerStart.label ?? '制限時間', seconds: timerStart.seconds ?? 0 } : null,
    gate: {
      attempts: gates.length,
      passedAt: passedIndex >= 0 ? passedIndex + 1 : null,
      topReason,
      slugs,
    },
    code: {
      added: a.added + b.added,
      removed: a.removed + b.removed,
      files: new Set([...a.files, ...b.files]).size,
      commits: commitsOut.split('\n').filter(Boolean).length,
    },
  });
}
