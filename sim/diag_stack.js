'use strict';
// ㉚リスケール診断: 転生時点の生産倍率スタック(log10)を周回ごとに一覧——どの倍率が爆発源かを特定する。
// 使い方: node diag_stack.js [S1] [hours=30] [EXTRA=paramパッチ]
const P = require('./params.js');
if (process.env.EXTRA) {
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
const hours = Number(process.argv[3] || 30);
const s = STRATEGIES.find(x => x.id === id);
const sim = G.simulate(s, { hours, diagStack: true });
const L = x => (x > 0 ? Math.log10(x) : -99).toFixed(1);
console.log(`${id} ${hours}h: 転生時スタック(log10)`);
console.log('run    cps cpsRaw glbRes sklCps  killM boostM critEV  eqAll  eqCps  bankM  msAll  msCps');
let prev = null;
for (const st of sim._stackLog || []) {
  const row = [st.cps, st.cpsRaw, st.globalRes, st.cpsSkillMul, st.killMulAll, st.boostM, st.critEV, st.eqAll, st.eqCps, st.bankM, st.msAll, st.msCps];
  console.log(String(st.runIdx).padStart(3) + row.map(v => L(v).padStart(7)).join(''));
  prev = st;
}
