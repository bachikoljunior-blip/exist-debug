'use strict';
// ㉚はしご第2版生成: 全初回開発(e9以上)を正準順に「間隔ランプ」(序盤0.8桁→終盤1.45桁)へ再割付し、
// rung_costs.json に終盤テーパ(末尾9段 rho=2.2)を書き込む。
// 設計(2026-07-25 衝突センサス): 終盤周回はオーバーシュート(+4〜11桁/周回)するため間隔1.0桁では<30秒。
// rungテーパで木の完成資産をe77→e93へ広げ、終盤アイテムを1.45桁間隔で置く(金ブースト0.85桁も跳べない)。
// 使い方: node ladder2.js        → params.js 用のJSリテラル+検証表を出力
const fs = require('fs');
const P = require('./params.js');
const G = require('./sim.js');

// ---- rungテーパ ----
const C0 = 13, RHO = 1.57, TAPER_FROM = 99, RHO2 = 1.57, NRUNG = 40;
const rungs = [];
for (let k = 0; k < NRUNG; k++) {
  rungs.push(k < TAPER_FROM ? C0 * Math.pow(RHO, k) : C0 * Math.pow(RHO, TAPER_FROM) * Math.pow(RHO2, k - TAPER_FROM));
}
fs.writeFileSync('rung_costs.json', JSON.stringify(rungs.map(v => Math.round(v * 1000) / 1000)));
console.log('// rung_costs.json 更新: 0-24 rho1.57 / 25-33 rho2.2 top=' + rungs[NRUNG - 1].toExponential(2));

// ---- はしご再割付 ----
const src = [];
for (const [k, v] of Object.entries(P.msResearch.costTable)) src.push({ tbl: 'ms', k, v });
for (const [k, v] of Object.entries(P.resFirstCost)) src.push({ tbl: 'resFirst', k, v });
for (const [k, v] of Object.entries(P.resStageCostAbs)) src.push({ tbl: 'stageAbs', k, v });
for (const [k, v] of Object.entries(P.upCost.firstUnitCost)) src.push({ tbl: 'firstUnit', k, v });
const zoneA = src.filter(s => Math.log10(s.v) < 9);
const items = src.filter(s => Math.log10(s.v) >= 9).sort((a, b) => a.v - b.v);
// 間隔ランプ: i番目のギャップ(桁) = 0.9 → 1.35 へ滑らかに(前半ゆるやか・後半広く)
// +ジャンプ考慮の追加ギャップ(2026-07-25 実測): 初回解放が収入を瞬間跳躍させるアイテムの「後ろ」は
// 跳躍幅ぶん余計に離す(大物研究=own指数の積み上がり解放でe1.2前後・跳躍源の設備初号機=+0.3)。
const EXTRA = {
  'resFirst:moonGlobalYeast': 0.9, 'resFirst:galaxyAssembly': 0.9, 'resFirst:blackHoleCompression': 0.9,
  'resFirst:quantumProofing': 0.9, 'resFirst:antimatterRecipe': 0.9, 'resFirst:portalGlobalFold': 1.2,
  'firstUnit:moonBakery': 0.4, 'firstUnit:timeOven': 0.25, 'firstUnit:galaxyFactory': 0.4,
  'firstUnit:blackHoleMixer': 0.25, 'firstUnit:universeOven': 0.25, 'firstUnit:godFinger': 0.25,
  'firstUnit:cookieSingularity': 0.25, 'firstUnit:quantumBakery': 0.25, 'firstUnit:antimatterOven': 0.25,
  'ms:ms_prestige_r3': 0.5, 'ms:ms_prestige_r4': 0.4, 'ms:ms_taps_p4': 0.3
};
const N = items.length;
let d = 9.0;
const pos = [d];
for (let i = 1; i < N; i++) {
  const t = i / (N - 1);
  const prev = items[i - 1];
  d += 0.88 + (1.18 - 0.88) * Math.pow(t, 1.6) + (EXTRA[prev.tbl + ':' + prev.k] || 0);
  pos.push(d);
}
console.log('// はしご第2版: ' + N + '項目 e9〜e' + d.toFixed(1));
const out = { ms: {}, resFirst: {}, stageAbs: {}, firstUnit: {} };
for (const z of zoneA) out[z.tbl][z.k] = z.v;
items.forEach((it, i) => { out[it.tbl][it.k] = G.q5cost(Math.pow(10, pos[i])); });
const lit = obj => '{ ' + Object.entries(obj).map(([k, v]) => {
  const key = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) ? k : `'${k}'`;
  return `${key}: ${v < 1e15 ? v : v.toExponential(2)}`;
}).join(', ') + ' }';
console.log('MS_TABLE = ' + lit(out.ms));
console.log('RES_FIRST = ' + lit(out.resFirst));
console.log('STAGE_ABS = ' + lit(out.stageAbs));
console.log('FIRST_UNIT = ' + lit(out.firstUnit));
items.forEach((it, i) => console.log(`//  e${pos[i].toFixed(2).padStart(6)}  Δ${i ? (pos[i] - pos[i - 1]).toFixed(2) : '  -  '}  ${it.tbl}:${it.k}`));
