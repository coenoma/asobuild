#!/usr/bin/env node
/**
 * 仕上げの音量合わせ（ラウドネス正規化）。
 *
 *   node scripts/master.mjs out/001-nuimichi.mp4   → out/001-nuimichi-master.mp4
 *
 * **なぜ要るか。** YouTube は -14 LUFS を基準に音量を「下げる」ことはするが「上げてくれない」。
 * うちの書き出しは実測 -20 LUFS 前後で、**他の動画より一段小さく聞こえていた**（数万再生
 * クラスとの客観的な差）。声・BGM・効果音のバランスは保ったまま、全体をまとめて持ち上げる。
 *
 * ffmpeg の loudnorm を2回通す（1回目で測り、2回目で線形に当てる）。
 * 映像は再圧縮しない（コピー）。
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const src = process.argv[2];
if (!src) { console.error('使い方: node scripts/master.mjs <動画>'); process.exit(1); }
const inPath = resolve(process.cwd(), src);
const outPath = inPath.replace(/\.mp4$/, '-master.mp4');

const TARGET = 'I=-14:TP=-1.0:LRA=11';

// 1回目: 測る
const p1 = spawnSync('ffmpeg', ['-hide_banner', '-i', inPath, '-af', `loudnorm=${TARGET}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
const jsonText = (p1.stderr.match(/\{[\s\S]*\}/) ?? [null])[0];
if (!jsonText) { console.error('測定に失敗しました'); console.error(p1.stderr.slice(-800)); process.exit(1); }
const m = JSON.parse(jsonText);
console.log(`いま: ${m.input_i} LUFS（頂点 ${m.input_tp} dBTP）→ 目標 -14 LUFS`);

// 2回目: 線形に当てる（measured_* を渡すと linear=true が効き、音の質感を変えずに持ち上がる）
const af = `loudnorm=${TARGET}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
const p2 = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', inPath, '-af', af, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', outPath], { encoding: 'utf8' });
if (p2.status !== 0) { console.error(p2.stderr); process.exit(1); }

// 検算
const p3 = spawnSync('ffmpeg', ['-hide_banner', '-i', outPath, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
const v = JSON.parse((p3.stderr.match(/\{[\s\S]*\}/) ?? ['{}'])[0]);
console.log(`あと: ${v.input_i} LUFS（頂点 ${v.input_tp} dBTP） → ${outPath.split('/').pop()}`);
