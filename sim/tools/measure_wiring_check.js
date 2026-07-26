#!/usr/bin/env node
// 測定配線の検問(2026-07-26 実装)。目的: 「判定器は動いているつもりで、実は常に0を読んでいた」を二度と起こさない。
//
// 実際に起きた失敗(これを恒久的に止めるための機械):
//   sim.js で r.waveMulSum / r.waveTicks を積んだが、判定器が読む replayRun の戻り値は
//   フィールドを明示列挙して組み立てており、そこにカウンタが無かった=判定は常に0を受け取り
//   「波が立っていない=測定不能」で NG。それでも「検出力は保持」とコミットしてしまった。
//   人の注意では再発する。だから構造で止める:
//     ①判定器(runner.js の MECH ブロック)が on.X / off.X として読む名前を抽出し、
//     ②その名前が sim.js の全ての周回記録リテラル(sim.runs.push({...}) と replayRun の return {...})
//       に含まれていることを検査する。1つでも欠けたら exit 1。
//   静的検査なので即時(pre-commit で使える)。動的な実測は sim/tools/mech_probe 相当を別途走らせる。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const simSrc = fs.readFileSync(path.join(ROOT, 'sim', 'sim.js'), 'utf8');
const runnerSrc = fs.readFileSync(path.join(ROOT, 'sim', 'runner.js'), 'utf8');

// --- ① 判定器が読む測定カウンタ名を抽出(MECH = { ... } のブロック内の on.X / off.X) ---
function mechBlock(src) {
  const at = src.indexOf('const MECH = {');
  if (at < 0) return '';
  let depth = 0, i = src.indexOf('{', at);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return src.slice(i);
}
const block = mechBlock(runnerSrc);
if (!block) { console.error('measure_wiring: runner.js に MECH ブロックが無い(判定器の名前が変わった?)'); process.exit(1); }
const names = new Set();
for (const m of block.matchAll(/\b(?:on|off)\.([A-Za-z_$][\w$]*)\b/g)) names.add(m[1]);
if (names.size === 0) { console.error('measure_wiring: MECH が読むカウンタを1つも抽出できなかった'); process.exit(1); }

// --- ② 周回記録リテラルを列挙(sim.runs.push({...}) 全件 + replayRun の return {...}) ---
function braceSlice(src, openIdx) {
  let depth = 0;
  for (let j = openIdx; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(openIdx, j + 1); }
  }
  return null;
}
const records = [];
for (const m of simSrc.matchAll(/sim\.runs\.push\(\s*\{/g)) {
  const open = simSrc.indexOf('{', m.index);
  const body = braceSlice(simSrc, open);
  if (body) records.push({ label: `sim.runs.push@${simSrc.slice(0, m.index).split('\n').length}`, body });
}
const rr = simSrc.indexOf('function replayRun');
if (rr >= 0) {
  const retAt = simSrc.indexOf('return {', rr);
  if (retAt >= 0) {
    const body = braceSlice(simSrc, simSrc.indexOf('{', retAt));
    if (body) records.push({ label: `replayRun return@${simSrc.slice(0, retAt).split('\n').length}`, body });
  }
}
if (records.length < 2) { console.error('measure_wiring: 周回記録リテラルを2件以上見つけられなかった'); process.exit(1); }

// --- ③ 検査 ---
let bad = 0;
for (const rec of records) {
  const missing = [...names].filter(n => !new RegExp(`\\b${n}\\s*:`).test(rec.body));
  if (missing.length) {
    console.error(`測定配線の欠落 [${rec.label}]: ${missing.join(', ')} が周回記録に載っていない`);
    console.error('  → 判定器は 0 を読み「機構が動いていない」と誤NGを出す(2026-07-26 の実失敗と同型)。記録に追加すること。');
    bad = 1;
  }
}
if (!bad) console.log(`measure_wiring OK: ${[...names].join(',')} が ${records.length} 件の周回記録すべてに載っている`);
process.exit(bad);
