'use strict';
// ㉚リスケール ステップ4(HANDOFF_30 追記5): 初回開発コスト表の桁圧縮リマップ生成。
// 旧はしご(L7: e9〜e177・2.5桁間隔)を 新経済(pG=0.085: 2.3桁/周回・終盤e77)へ線形写像:
//   new = LO + (old - LO) × (HI_NEW - LO)/(HI_OLD - LO)   (log10空間・LO=9未満は据え置き=ゾーンA)
// 順序と交互配置(ms/段階/設備の混在)は保存される。間隔は約2.5桁→約1.0桁(=金ブースト×7の0.85桁より広い)。
// 使い方: node ladder_remap.js        → 新テーブルをJSリテラルで出力(params.js に貼る)
//         node ladder_remap.js 80    → HI_NEW を変える
const P = require('./params.js');
const G = require('./sim.js');
const LO = 9, HI_OLD = 177.5, HI_NEW = Number(process.argv[2] || 77.5);
const K = (HI_NEW - LO) / (HI_OLD - LO);
const map = v => {
  const d = Math.log10(v);
  if (d < LO) return v; // ゾーンA(run0-1)は据え置き
  return G.q5cost(Math.pow(10, LO + (d - LO) * K));
};
const emit = (name, obj) => {
  const pairs = Object.entries(obj).map(([k, v]) => {
    const nv = map(v);
    const key = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) ? k : `'${k}'`;
    return `${key}: ${nv < 1e15 ? nv : nv.toExponential(2).replace('e+', 'e+')}`;
  });
  console.log(`  ${name}: {\n    ${pairs.join(', ')}\n  },`);
};
console.log('// ==== ladder_remap.js 生成(旧e9-e177→新e9-e' + HI_NEW + '・ゾーンA据え置き) ====');
emit('msCostTable', P.msResearch.costTable);
emit('resFirstCost', P.resFirstCost);
emit('resStageCostAbs', P.resStageCostAbs);
emit('firstUnitCost', P.upCost.firstUnitCost);
// 検証: 全アイテムを桁順に並べ、隣接間隔を出す
const all = [];
for (const [k, v] of Object.entries(P.msResearch.costTable)) all.push(['ms:' + k, map(v)]);
for (const [k, v] of Object.entries(P.resFirstCost)) all.push(['res:' + k, map(v)]);
for (const [k, v] of Object.entries(P.resStageCostAbs)) all.push(['st:' + k, map(v)]);
for (const [k, v] of Object.entries(P.upCost.firstUnitCost)) all.push(['up:' + k, map(v)]);
all.sort((a, b) => a[1] - b[1]);
console.log('// ---- 桁順・隣接間隔 ----');
let prev = null;
for (const [k, v] of all) {
  const d = Math.log10(v);
  console.log(`//  e${d.toFixed(2).padStart(6)}  Δ${prev == null ? '  -  ' : (d - prev).toFixed(2).padStart(5)}  ${k}`);
  prev = d;
}
