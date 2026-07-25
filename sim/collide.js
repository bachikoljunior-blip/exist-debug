'use strict';
// ㉚衝突センサス(HANDOFF_30 の collide.js 再作成・今回はコミットして残す):
// 各方針の <30s 衝突ペア(前後のイベントID+その時点の通算クッキー=配置オラクル)と、
// 各周回の開始/終了 totalCookies(フレッシュバンド=スロット割当ての実測アンカー)をダンプする。
// 使い方: node collide.js S1,S2,...   (省略=全方針)   [--json out.json]
//   V100_HOURS で固定時間走行(省略時 runUntilDone)。
const fs = require('fs');
const G = require('./sim.js');
const { STRATEGIES } = require('./strategies.js');

const arg = process.argv[2];
const ids = (arg && !arg.startsWith('--')) ? arg.split(',') : STRATEGIES.map(s => s.id);
const jsonOut = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null; })();
const hours = process.env.V100_HOURS ? Number(process.env.V100_HOURS) : null;

const dump = {};
const pairCount = {}; // "a→b" -> {n, tcs: []}
for (const id of ids) {
  const s = STRATEGIES.find(x => x.id === id);
  if (!s) continue;
  const sim = G.simulate(s, hours ? { hours } : { runUntilDone: true });
  const ev = (sim.unlockEvents || []).slice().sort((a, b) => a.t - b.t);
  const moments = [];
  for (const e of ev) {
    const last = moments[moments.length - 1];
    if (last && e.t - last.t <= 1e-9) { last.ids.push(e.kind + ':' + e.id); if (e.tc != null) last.tc = e.tc; continue; }
    moments.push({ t: e.t, tc: e.tc, ids: [e.kind + ':' + e.id] });
  }
  const full = sim.runs.filter(r => !r.partial);
  const runOf = t => { for (let i = 0; i < full.length; i++) if (t <= full[i].endT) return i; return full.length; };
  const bad = [];
  for (let i = 1; i < moments.length; i++) {
    const g = moments[i].t - moments[i - 1].t;
    if (g >= 30) continue;
    const a = moments[i - 1].ids.join(','), b = moments[i].ids.join(',');
    bad.push({ t: moments[i].t, gap: g, a, b, tc: moments[i].tc, run: runOf(moments[i].t) });
    const key = a + ' → ' + b;
    const pc = pairCount[key] || (pairCount[key] = { n: 0, tcs: [] });
    pc.n++; if (moments[i].tc != null) pc.tcs.push(moments[i].tc);
  }
  // 周回帯プロファイル: 各周回の開始/終了 totalCookies(近似=累積 runCookies)と周回内ウォレットピーク(runCookies)
  let cum = 0;
  const bands = full.map(r => { const start = cum; cum += r.runCookies; return { run: r.idx, dur: Math.round(r.duration), tcStart: start, tcEnd: cum, wallet: r.runCookies }; });
  dump[id] = { bad, bands, moments: moments.map(m => ({ t: Math.round(m.t), tc: m.tc, ids: m.ids })) };
  console.log(`${id}: <30s ${bad.length}本 / 周回${full.length}`);
  for (const b of bad) console.log(`  run${b.run} ${Math.round(b.t)}s Δ${b.gap.toFixed(1)}s ${b.a} → ${b.b} @${b.tc != null ? b.tc.toExponential(1) : '?'}`);
}
// ペア集計(頻度順)
const pairs = Object.entries(pairCount).sort((a, b) => b[1].n - a[1].n);
if (pairs.length) {
  console.log('---- ペア集計(全方針・頻度順) ----');
  for (const [k, v] of pairs) {
    const lo = v.tcs.length ? Math.min(...v.tcs).toExponential(1) : '?';
    const hi = v.tcs.length ? Math.max(...v.tcs).toExponential(1) : '?';
    console.log(`  ×${v.n} ${k} @${lo}${v.tcs.length > 1 ? '〜' + hi : ''}`);
  }
}
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(dump, null, 1)); console.log('saved ' + jsonOut); }
