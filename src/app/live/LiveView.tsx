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
}

function derive(events: LiveEvent[]): Derived {
  const d: Derived = {
    phase: '',
    say: '',
    sayAt: 0,
    timer: null,
    gate: null,
    log: [],
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

/** カウントダウン用。1時間を超えたら h:mm:ss にする（99:00 のような桁あふれを出さない） */
function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** できごとの時刻。経過ではなく**そのとき何時だったか**を出す（人が読むのはこちら） */
function hhmm(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 「どれくらい前か」。数字を読ませずに、ひと目で古さが分かる言い方にする。
 * ここを mm:ss にしていたため、ログが数日ぶんたまると `1681:55` のような表示になっていた。
 */
function agoText(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}びょうまえ`;
  if (s < 3600) return `${Math.floor(s / 60)}ふんまえ`;
  const h = Math.floor(s / 3600);
  return h < 24 ? `${h}じかんまえ` : `${Math.floor(h / 24)}にちまえ`;
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

  // 終わってから30分以上たった計測は、もう表示しない。
  // 収録が終わってもログは残るので、そのままだと「じかんぎれ」が何時間も出たままになる
  const timerStale = d.timer !== null && now - d.timer.startedAt > d.timer.seconds * 1000 + 30 * 60 * 1000;
  const timer = timerStale ? null : d.timer;
  const remain = timer ? timer.seconds - (now - timer.startedAt) / 1000 : null;
  const ratio = timer && timer.seconds > 0 ? Math.max(0, Math.min(1, (remain ?? 0) / timer.seconds)) : 0;
  const timeUp = remain !== null && remain <= 0;
  const hurry = remain !== null && timer !== null && remain > 0 && remain < timer.seconds * 0.2;

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
        <p className={styles.sayAge}>{agoText(sayAge)}</p>
      )}

      <div className={styles.panels}>
        <section className={styles.panel}>
          <h2 className={styles.panelTitle}>{timer ? timer.label : 'のこり時間'}</h2>
          {timer ? (
            <>
              <div className={`${styles.clock} ${timeUp ? styles.clockUp : hurry ? styles.clockHurry : ''}`}>
                {timeUp ? 'じかんぎれ' : clock(remain ?? 0)}
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
            おもしろさゲート{d.gate ? ` — ${d.gate.slug}` : ''}
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
              <span className={styles.logTime}>{hhmm(l.t)}</span>
              {l.text}
            </li>
          ))}
      </ul>

      {offline && <div className={styles.offline}>カンペのログを読めていません（開発サーバーは動いていますか）</div>}
    </div>
  );
}
