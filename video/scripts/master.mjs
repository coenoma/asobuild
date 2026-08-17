#!/usr/bin/env node
/**
 * 仕上げの音量合わせ（ラウドネス正規化）。
 *
 *   node scripts/master.mjs out/001-nuimichi.mp4   → out/001-nuimichi-master.mp4
 *
 * YouTube は -14 LUFS 基準で「下げる」ことはするが「上げてくれない」。
 * うちの書き出しは -20 LUFS 前後で、他の動画より一段小さく聞こえていた。
 *
 * 🔴 loudnorm フィルタ1本に任せない。持ち上げ幅が頂点の余裕を超えると
 * **ダイナミックモードに落ちて声がうねる**（001で実際に起き、「声がおかしい」になった。
 * ついでにサンプルレートも 96kHz に勝手に変わる）。
 *
 * so やることを分ける:
 *   1. loudnorm で**測るだけ**（いま何LUFSか）
 *   2. 足りないぶんを volume で**一定量**持ち上げる（声の質感は変わらない）
 *   3. 頂点だけ alimiter で -1 dBTP に収める（効くのはジングルの山の数msだけ）
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const src = process.argv[2];
if (!src) { console.error('使い方: node scripts/master.mjs <動画>'); process.exit(1); }
const inPath = resolve(process.cwd(), src);
const outPath = inPath.replace(/\.mp4$/, '-master.mp4');

const TARGET_I = -14;

// 1. 測る
const p1 = spawnSync('ffmpeg', ['-hide_banner', '-i', inPath, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
const jsonText = (p1.stderr.match(/\{[\s\S]*\}/) ?? [null])[0];
if (!jsonText) { console.error('測定に失敗しました'); process.exit(1); }
const m = JSON.parse(jsonText);
const gain = Number((TARGET_I - Number(m.input_i)).toFixed(2));
console.log(`いま: ${m.input_i} LUFS（頂点 ${m.input_tp} dBTP）→ ${gain >= 0 ? '+' : ''}${gain}dB 持ち上げる`);

// 2+3. 一定量持ち上げて、頂点だけ抑える。サンプルレートは 48kHz を保つ
const af = `volume=${gain}dB,alimiter=level_in=1:level_out=1:limit=0.891:attack=5:release=80:level=false`;
const p2 = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', inPath, '-af', af,
  '-ar', '48000', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-movflags', '+faststart', outPath], { encoding: 'utf8' });
if (p2.status !== 0) { console.error(p2.stderr); process.exit(1); }

// 検算
const p3 = spawnSync('ffmpeg', ['-hide_banner', '-i', outPath, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
const v = JSON.parse((p3.stderr.match(/\{[\s\S]*\}/) ?? ['{}'])[0]);
console.log(`あと: ${v.input_i} LUFS（頂点 ${v.input_tp} dBTP） → ${outPath.split('/').pop()}`);
