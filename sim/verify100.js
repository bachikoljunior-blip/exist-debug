'use strict';
// ㉚100%検証(HANDOFF_30 の verify100 再作成・今回はコミットして残す):
// 全方針で「解放イベント間隔<30秒 = 0本」+ 成長インバリアントを1画面で見る。
// 判定基準は runner unlockgap と同一(同一tickの解放=1モーメント・全解放イベント計上・除外なし)。
// 成長側: T1(各周回1200〜7200s・全スキル解放後の放置周回は対象外) / ④(前周回超の単調増加) /
// ⑭相当(各転生の獲得PT≥1) / 全解放(スキル完了) / 収益率(各周回の桁/秒の中央値: 目標1/900〜1/1200)。
// 使い方: node verify100.js [S1,S2|all] [--json out.json]
//   環境変数 V100_HOURS を与えると runUntilDone でなく固定時間で走る(高速プレビュー用)。
const fs = require('fs');
const G = require('./sim.js');
const { STRATEGIES } = require('./strategies.js');

const arg = process.argv[2];
const ids = (arg && arg !== 'all') ? arg.split(',') : STRATEGIES.map(s => s.id);
const jsonOut = (() => { const i = process.argv.indexOf('--json'); return i > 0 ? process.argv[i + 1] : null; })();
const hours = process.env.V100_HOURS ? Number(process.env.V100_HOURS) : null;

const out = [];
let totBad = 0, totPolicies = 0, badPolicies = 0, growthBad = 0;
for (const id of ids) {
  const s = STRATEGIES.find(x => x.id === id);
  if (!s) { console.log('unknown strategy: ' + id); continue; }
  const t0 = Date.now();
  const sim = G.simulate(s, hours ? { hours } : { runUntilDone: true });
  const ev = (sim.unlockEvents || []).slice().sort((a, b) => a.t - b.t);
  // 同一tick=1モーメント(runner unlockgap と同じ)
  const moments = [];
  for (const e of ev) {
    const last = moments[moments.length - 1];
    if (last && e.t - last.t <= 1e-9) { last.ids.push(e.kind + ':' + e.id); if (e.tc != null) last.tc = e.tc; continue; }
    moments.push({ t: e.t, tc: e.tc, ids: [e.kind + ':' + e.id] });
  }
  const bad = [];
  for (let i = 1; i < moments.length; i++) {
    const g = moments[i].t - moments[i - 1].t;
    if (g < 30) bad.push({ t: moments[i].t, gap: g, a: moments[i - 1].ids.join(','), b: moments[i].ids.join(','), tc: moments[i].tc });
  }
  const full = sim.runs.filter(r => !r.partial);
  // 全スキル解放時刻
  let fullT = Infinity, n = 0;
  for (const e of ev) { if (e.kind !== 'skill') continue; n += e.n || 1; if (n >= G.SKILL_NODES.length) { fullT = e.t; break; } }
  // T1: 全スキル解放前に開始した完全周回のみ判定
  const t1runs = full.filter(r => r.startT < fullT);
  const t1bad = t1runs.filter(r => r.duration < 1200 || r.duration > 7200);
  // ④: 前周回超(完全周回・単調増加)
  let monoBad = 0, monoAll = 0;
  for (let i = 1; i < full.length; i++) { monoAll++; if (!(full[i].runCookies > full[i - 1].runCookies)) monoBad++; }
  // ⑭相当: 各転生の獲得PT≥1
  const ptBad = full.filter(r => !(r.gain >= 1)).length;
  // 収益率: log10(周回クッキー)/周回長 の中央値(桁/秒)
  const rates = t1runs.map(r => (r.runCookies > 1 ? Math.log10(r.runCookies) : 0) / Math.max(1, r.duration)).sort((a, b) => a - b);
  const medRate = rates.length ? rates[(rates.length - 1) >> 1] : 0;
  const secPerDigit = medRate > 0 ? Math.round(1 / medRate) : Infinity;
  const allSk = Number.isFinite(fullT);
  const growth = { t1bad: t1bad.length, t1all: t1runs.length, monoBad, monoAll, ptBad, allSk };
  const gBad = t1bad.length + monoBad + ptBad + (allSk ? 0 : 1);
  totPolicies++; totBad += bad.length; if (bad.length) badPolicies++; growthBad += gBad;
  out.push({ id, events: ev.length, moments: moments.length, bad, growth, medRate, secPerDigit, runs: full.length, fullT, sec: (Date.now() - t0) / 1000 });
  console.log(`${bad.length === 0 && gBad === 0 ? 'OK ' : 'NG '}${id} <30s:${String(bad.length).padStart(3)}/${moments.length - 1}本 | T1 ${t1runs.length - t1bad.length}/${t1runs.length} ④ ${monoAll - monoBad}/${monoAll} PT≥1 ${full.length - ptBad}/${full.length} 全解放${allSk ? '○' : '×'} | 周回${full.length} 1桁${Number.isFinite(secPerDigit) ? secPerDigit + 's' : '-'} | ${Math.round((Date.now() - t0) / 1000)}s`);
  if (bad.length) {
    for (const b of bad.slice(0, 6)) console.log(`    ${Math.round(b.t)}s Δ${b.gap.toFixed(1)}s ${b.a} → ${b.b} @${b.tc != null ? b.tc.toExponential(1) : '?'}`);
    if (bad.length > 6) console.log(`    ... 他${bad.length - 6}本`);
  }
}
console.log(`==== ㉚<30s合計 ${totBad}本 / 違反方針 ${badPolicies}/${totPolicies} / 成長違反 ${growthBad}件 ====`);
if (jsonOut) { fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1)); console.log('saved ' + jsonOut); }
