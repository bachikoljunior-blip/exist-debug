'use strict';
// ㉚リスケール作動点実験(HANDOFF_30 追記5の作業列(1)(2)):
// 環境変数で params を上書きしてから sim を読み、probe_rate 相当の周回表を出す。
//   OWNPOW=0.33 PG=0.085 RESET_TABLES=1 node exp_op.js S1 20
// RESET_TABLES=1: rung_costs.json / prestige_costs.json の焼き込みを外し、
//   スキル=純粋はしご C0×rho^k(相乗り段は維持)・転生コスト=動的式(毎秒×500の10べき)で走る。
// FXMUL: fx全キー一律倍率 / NODEM: nodeM.all&cps&click 上書き / EXTRA: JSONで任意paramパッチ。
const P = require('./params.js');
if (process.env.OWNPOW) P.upCost.ownPow = Number(process.env.OWNPOW);
if (process.env.OWNPOW2) P.upCost.ownPow2 = Number(process.env.OWNPOW2);
if (process.env.PG) P.prestige.pG = Number(process.env.PG);
if (process.env.PB) P.prestige.pB = Number(process.env.PB);
if (process.env.RHO) P.skillCost.rho = Number(process.env.RHO);
if (process.env.RESET_TABLES === '1') { P.prestige.costTable = []; P.skillCost.rungCosts = []; }
if (process.env.FXMUL) { const m = Number(process.env.FXMUL); for (const k of Object.keys(P.fx)) P.fx[k] *= m; }
if (process.env.NODEM) { const v = Number(process.env.NODEM); P.nodeM.all = v; P.nodeM.cps = v; P.nodeM.click = Math.max(1.2, v - 0.2); }
if (process.env.EXTRA) { // 深いキーのパッチ: {"res.ovenOwn":0.02, "prestige.firstCost":1e7}
  const patch = JSON.parse(process.env.EXTRA);
  for (const [path, v] of Object.entries(patch)) {
    const ks = path.split('.'); let o = P;
    for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = v;
  }
}
const G = require('./sim.js');
const { STRATEGIES } = require('./strategies.js');
const id = process.argv[2] || 'S1';
const hours = Number(process.argv[3] || 20);
const s = STRATEGIES.find(x => x.id === id);
const sim = G.simulate(s, { hours, measure: process.env.INV === '1', partsDetail: process.env.INV === '1' });
const full = sim.runs.filter(r => !r.partial);
console.log(`${id} ${hours}h ownPow=${P.upCost.ownPow} pG=${P.prestige.pG}: 完全周回${full.length}`);
console.log('run   長さ(s)   桁(log10RC)   桁/分    gain   スキル T1');
let prevD = 0;
for (const r of sim.runs) {
  const d = r.runCookies > 1 ? Math.log10(r.runCookies) : 0;
  const rate = d / Math.max(1, r.duration) * 60;
  const t1 = r.partial ? 'part' : (r.duration >= 1200 && r.duration <= 7200 ? 'ok' : 'NG');
  let inv = '';
  if (r.measure && r.measure.invLast) {
    const u = r.measure.invLast;
    inv = '  [' + Object.entries(u).filter(([, c]) => c > 0).map(([k, c]) => k.slice(0, 4) + c).join(' ') + '] st' + (r.maxStage || 0);
  }
  console.log(`${String(r.idx).padStart(3)} ${String(Math.round(r.duration)).padStart(8)} ${d.toFixed(1).padStart(10)} (+${(d - prevD).toFixed(1)}) ${rate.toFixed(3).padStart(6)} ${String(r.gain).padStart(7)} ${String(r.skillsBought || 0).padStart(4)}  ${t1}${inv}`);
  prevD = d;
}
