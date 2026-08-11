import { NextResponse } from 'next/server';

/**
 * 収録カンペ（/live）が読むログ。**開発時だけ**動く。
 *
 * このリポジトリは PUBLIC で、本番サイトに開発用の口は要らないので
 * 本番ビルドでは 404 を返す。
 */
export const dynamic = 'force-dynamic';

/** 画面に出すのは直近だけでよい。増え続けても重くならないようにする */
const MAX_EVENTS = 400;

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('not found', { status: 404 });
  }

  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(process.cwd(), '.live', 'status.jsonl');

  try {
    const text = await readFile(file, 'utf8');
    const events = text
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          // 書き込み途中の行を読んだ場合。捨てて先に進む
          return null;
        }
      })
      .filter((e): e is Record<string, unknown> => e !== null)
      .slice(-MAX_EVENTS);
    return NextResponse.json({ events });
  } catch {
    // ログがまだ無いのは正常な状態
    return NextResponse.json({ events: [] });
  }
}
