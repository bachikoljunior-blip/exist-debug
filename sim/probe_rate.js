'use strict';
// 収益率プローブ(㉚リスケール作業用): 各周回の 周回長 / 桁数 / 桁/分 / gain / スキル数 / 転生コスト桁 を一覧。
// 目標帯(HANDOFF_30): 桁/分 ≈ 0.05〜0.10(=1桁/10〜20分)・T1 1200〜7200s・毎周回 gain≥1。
// 使い方: node probe_rate.js [S1] [hours=20]
const G = require('./sim.js');
const { STRATEGIES } = require('./strategies.js');
const id = process.argv[2] || 'S1';
const hours = Number(process.argv[3] || 20);
const s = STRATEGIES.find(x => x.id === id);
const sim = G.simulate(s, { hours });
const full = sim.runs.filter(r => !r.partial);
console.log(`${id} ${hours}h: 完全周回${full.length} (部分含む${sim.runs.length})`);
console.log('run   長さ(s)   桁(log10RC)  桁/分    gain      スキル  T1');
let prevD = 0;
for (const r of sim.runs) {
  const d = r.runCookies > 1 ? Math.log10(r.runCookies) : 0;
  const rate = d / Math.max(1, r.duration) * 60;
  const t1 = r.partial ? 'part' : (r.duration >= 1200 && r.duration <= 7200 ? 'ok' : 'NG');
  console.log(`${String(r.idx).padStart(3)} ${String(Math.round(r.duration)).padStart(8)} ${d.toFixed(1).padStart(10)} (+${(d - prevD).toFixed(1)}) ${rate.toFixed(3).padStart(6)} ${String(r.gain).padStart(9)} ${String(r.skillsBought || 0).padStart(5)}  ${t1}`);
  prevD = d;
}
