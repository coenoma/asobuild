'use client';

/**
 * 収録カンペ本体。
 *
 * `.live/status.jsonl` を短い間隔で読み直し、イベント列から現在の状態を作って出す。
 * 状態そのものは保存していないので、途中から読んでも最後まで再生すれば同じ状態になる。
 */

import { useEffect, useMemo, useState } from 'react';
import styles from './live.module.css';

const PHASES = ['きかく', 'じっそう', 'けんてい', 'ためし'] as const;

type LiveEvent =
  | { t: number; kind: 'say'; text: string }
  | { t: number; kind: 'phase'; phase: string }
  | { t: number; kind: 'timer'; action: 'start' | 'stop'; seconds?: number; label?: string }
  | {
      t: number;
      kind: 'gate';
      slug: string;
      pass: boolean;
      checks: { label: string; pass: boolean }[];
    };

interface Derived {
  phase: string;
  say: string;
  sayAt: number;
  timer: { startedAt: number; seconds: number; label: string } | null;
  gate: { slug: string; pass: boolean; checks: { label: string; pass: boolean }[] } | null;
  log: { t: number; text: string }[];
  startedAt: number;
}

function derive(events: LiveEvent[]): Derived {
  const d: Derived = {
    phase: '',
    say: '',
    sayAt: 0,
    timer: null,
    gate: null,
    log: [],
    startedAt: events[0]?.t ?? Date.now(),
  };
  for (const e of events) {
    if (e.kind === 'phase') {
      d.phase = e.phase;
      d.log.push({ t: e.t, text: `［${e.phase}］` });
    } else if (e.kind === 'say') {
      d.say = e.text;
      d.sayAt = e.t;
      d.log.push({ t: e.t, text: e.text });
    } else if (e.kind === 'timer') {
      if (e.action === 'start') {
        d.timer = { startedAt: e.t, seconds: e.seconds ?? 0, label: e.label ?? '制限時間' };
        d.log.push({ t: e.t, text: `${e.label ?? '制限時間'} スタート` });
      } else {
        d.timer = null;
        d.log.push({ t: e.t, text: '計測おわり' });
      }
    } else if (e.kind === 'gate') {
      d.gate = { slug: e.slug, pass: e.pass, checks: e.checks };
      const ng = e.checks.filter((c) => !c.pass).length;
      d.log.push({
        t: e.t,
        text: e.pass ? `${e.slug} ゲート合格！` : `${e.slug} ゲート ${ng}項目のこり`,
      });
    }
  }
  return d;
}

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function LiveView() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const res = await fetch('/api/live', { cache: 'no-store' });
        if (!res.ok) throw new Error('bad status');
        const json = (await res.json()) as { events: LiveEvent[] };
        if (!alive) return;
        setEvents(json.events ?? []);
        setOffline(false);
      } catch {
        if (alive) setOffline(true);
      }
    };
    void pull();
    const id = setInterval(pull, 500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const d = useMemo(() => derive(events), [events]);

  const remain = d.timer ? d.timer.seconds - (now - d.timer.startedAt) / 1000 : null;
  const ratio = d.timer && d.timer.seconds > 0 ? Math.max(0, Math.min(1, (remain ?? 0) / d.timer.seconds)) : 0;
  const timeUp = remain !== null && remain <= 0;
  const hurry = remain !== null && remain > 0 && remain < d.timer!.seconds * 0.2;

  // 一言は出たばかりだと目立たせる
  const fresh = d.say && now - d.sayAt < 2500;

  // 何分しゃべっていないか。無言の時間が動画の敵なので、経過を見えるようにしておく
  const sayAge = d.say ? (now - d.sayAt) / 1000 : null;
  const stale = sayAge !== null && sayAge > 90;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.brand}>アソビルド かいはつ中</span>
        <ol className={styles.phases}>
          {PHASES.map((p) => (
            <li key={p} className={p === d.phase ? styles.phaseOn : styles.phase}>
              {p}
            </li>
          ))}
        </ol>
      </header>

      <div className={`${styles.say} ${fresh ? styles.sayFresh : ''} ${stale ? styles.sayStale : ''}`}>
        {d.say || 'じゅんびちゅう…'}
      </div>
      {sayAge !== null && sayAge > 20 && (
        <p className={styles.sayAge}>{mmss(sayAge)} まえ</p>
      )}

      <div className={styles.panels}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{d.timer ? d.timer.label : 'のこり時間'}</h2>
          {d.timer ? (
            <>
              <div className={`${styles.clock} ${timeUp ? styles.clockUp : hurry ? styles.clockHurry : ''}`}>
                {timeUp ? 'じかんぎれ' : mmss(remain ?? 0)}
              </div>
              <div className={styles.barTrack}>
                <div
                  className={`${styles.barFill} ${hurry || timeUp ? styles.barFillHurry : ''}`}
                  style={{ width: `${ratio * 100}%` }}
                />
              </div>
            </>
          ) : (
            <p className={styles.empty}>
              計測していません
              <br />
              <code>npm run live -- timer start 25 ポテトM</code>
            </p>
          )}
        </section>

        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>
            めんどうさゲート{d.gate ? ` — ${d.gate.slug}` : ''}
          </h2>
          {d.gate ? (
            <>
              <div className={d.gate.pass ? styles.gatePass : styles.gateFail}>
                {d.gate.pass ? '合格' : `のこり ${d.gate.checks.filter((c) => !c.pass).length}項目`}
              </div>
              <ul className={styles.checks}>
                {[...d.gate.checks]
                  .sort((a, b) => Number(a.pass) - Number(b.pass))
                  .slice(0, 8)
                  .map((c) => (
                    <li key={c.label} className={c.pass ? styles.checkOk : styles.checkNg}>
                      <span className={styles.mark}>{c.pass ? '✓' : '✗'}</span>
                      {c.label}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p className={styles.empty}>
              まだ検定していません
              <br />
              <code>npm run fun -- &lt;slug&gt;</code>
            </p>
          )}
        </section>
      </div>

      <ul className={styles.log}>
        {[...d.log]
          .reverse()
          .slice(0, 4)
          .map((l, i) => (
            <li key={`${l.t}-${i}`} className={i === 0 ? styles.logHead : undefined}>
              <span className={styles.logTime}>{mmss((l.t - d.startedAt) / 1000)}</span>
              {l.text}
            </li>
          ))}
      </ul>

      {offline && <div className={styles.offline}>カンペのログを読めていません（開発サーバーは動いていますか）</div>}
    </div>
  );
}
