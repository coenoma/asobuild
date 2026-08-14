'use client';

/**
 * 面白さゲートをブラウザで走らせて見せる。
 *
 * 判定は `runFunGateAsync` を通しており、コマンドラインの `npm run fun` と同じ経路。
 * 「見せるためだけの別実装」を作ると、そのうち食い違って誰も信じなくなる。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { runFunGateAsync, type GateProgress, type GateReport } from '@/arcade/fun-gate';
import { loaders } from '@/games/registry';
import type { GameMeta } from '@/arcade/types';
import styles from './gate.module.css';

const POLICY_LABEL: Record<string, string> = {
  idle: '放置ボット',
  random: 'でたらめボット',
  smart: '上手いボット',
};

const RUN_CHOICES = [100, 300, 800] as const;

export function GateView({ metas }: { metas: GameMeta[] }) {
  const [slug, setSlug] = useState(metas[0]?.slug ?? '');
  const [runs, setRuns] = useState<number>(300);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<GateProgress | null>(null);
  const [report, setReport] = useState<GateReport | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const startedAt = useRef(0);

  const draw = useCallback((scores: number[], label: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (scores.length === 0) return;
    const max = Math.max(...scores, 1);
    const bins = 24;
    const counts = new Array<number>(bins).fill(0);
    for (const s of scores) {
      const i = Math.min(bins - 1, Math.floor((s / max) * bins));
      counts[i]++;
    }
    const peak = Math.max(...counts, 1);
    const bw = w / bins;

    ctx.fillStyle = '#ffd23f';
    for (let i = 0; i < bins; i++) {
      const bh = (counts[i] / peak) * (h - 22);
      ctx.fillRect(i * bw + 1, h - bh - 18, bw - 2, bh);
    }
    ctx.fillStyle = '#7e8d9c';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('0', 2, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(max)}`, w - 2, h - 4);
    ctx.textAlign = 'center';
    ctx.fillText(`${label}のスコア分布`, w / 2, h - 4);
  }, []);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 100);
    return () => clearInterval(id);
  }, [running]);

  const run = useCallback(async () => {
    const load = loaders[slug];
    if (!load || running) return;
    setRunning(true);
    setReport(null);
    setProgress(null);
    startedAt.current = Date.now();
    setElapsed(0);
    try {
      const mod = await load();
      const rep = await runFunGateAsync(mod.default, {
        runs,
        onProgress: (p) => {
          setProgress(p);
          draw(p.scores, POLICY_LABEL[p.policy] ?? p.policy);
        },
      });
      setReport(rep);
    } finally {
      // 速く終わると計測用のタイマーが一度も動かないので、最後に必ず入れ直す
      setElapsed((Date.now() - startedAt.current) / 1000);
      setRunning(false);
    }
  }, [slug, runs, running, draw]);

  const meta = metas.find((m) => m.slug === slug);

  return (
    <section className={styles.panel}>
      <div className={styles.controls}>
        <div className={styles.chips}>
          {metas.map((m) => (
            <button
              key={m.slug}
              type="button"
              className={m.slug === slug ? styles.chipOn : styles.chip}
              onClick={() => setSlug(m.slug)}
              disabled={running}
            >
              {m.title}
            </button>
          ))}
        </div>
        <div className={styles.chips}>
          {RUN_CHOICES.map((n) => (
            <button
              key={n}
              type="button"
              className={n === runs ? styles.chipOn : styles.chip}
              onClick={() => setRuns(n)}
              disabled={running}
            >
              {n}回
            </button>
          ))}
        </div>
        <button type="button" className={styles.go} onClick={run} disabled={running || !meta}>
          {running ? '検定中…' : '検定をはじめる'}
        </button>
      </div>

      <div className={styles.stage}>
        <div className={styles.statusRow}>
          <span className={styles.status}>
            {running && progress
              ? `${POLICY_LABEL[progress.policy]} ${progress.done} / ${progress.total} 回`
              : report
                ? `のべ ${report.stats.idle.runs + report.stats.random.runs + report.stats.smart.runs} 回 遊びました`
                : 'ボタンを押すと、ボットが遊びはじめます'}
          </span>
          {(running || report) && <span className={styles.elapsed}>{elapsed.toFixed(1)}秒</span>}
        </div>

        <div className={styles.barTrack}>
          <div
            className={styles.barFill}
            style={{
              width: progress ? `${(progress.done / progress.total) * 100}%` : report ? '100%' : '0%',
            }}
          />
        </div>

        <canvas ref={canvasRef} width={560} height={150} className={styles.canvas} />
      </div>

      {report && (
        <div className={styles.result}>
          <div className={report.pass ? styles.verdictPass : styles.verdictFail}>
            {report.pass ? '合格' : `のこり ${report.checks.filter((c) => !c.pass).length}項目`}
          </div>
          <ul className={styles.checks}>
            {report.checks.map((c) => (
              <li key={c.id} className={c.pass ? styles.ok : styles.ng}>
                <span className={styles.mark}>{c.pass ? '✓' : '✗'}</span>
                <span className={styles.checkLabel}>{c.label}</span>
                <span className={styles.checkValue}>{c.actual}</span>
              </li>
            ))}
          </ul>
          {/* でたらめ役の差し替えは必ず見えるようにする（CLI と同じ透明性を画面にも） */}
          {report.customNovice && (
            <p className={styles.reasons}>
              「でたらめ」役はゲーム側の novice() が担っています。
              共通のでたらめボットより甘くなりえます。
            </p>
          )}
          {report.topReasons.length > 0 && (
            <p className={styles.reasons}>
              上手いボットの死因:{' '}
              {report.topReasons.map((r) => `${r.reason}（${r.count}回）`).join(' / ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
