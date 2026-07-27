// 設備テーブルの sim↔ゲーム parity 検問。
// 2026-07-27 拡張(この日の教訓「片側parity」): 旧版は ①type:"cps" だけを見ていて **クリック系設備を検査していなかった**
// ②不一致を print するだけで exit 0 だった=pre-commit に載せても止められなかった。実際に旧版の穴から漏れていたもの:
//   finger(強い指) の base が sim=0.0506 / game=0.0184(=ゲームだけ 1.83倍安い。sim側が第7次で更新され、ゲームは旧値)。
// これは「強い指偏重」の一因でもある(判定基準より安い台が1つだけ混じっていた)。
// 今の版は全 type を突き合わせ、1件でも違えば exit 1 で止める。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sim = fs.readFileSync(path.join(ROOT, 'sim/sim.js'), 'utf8');
let x;
const game = {};
const gre = /id:\s*"(\w+)",\s*name:\s*"[^"]*",\s*type:\s*"(cps|click)",\s*value:\s*([\d.e+]+),\s*base:\s*([\d.e+]+),\s*growth:\s*([\d.e+]+)/g;
while ((x = gre.exec(html))) game[x[1]] = { type: x[2], value: +x[3], base: +x[4], growth: +x[5] };
const simM = {};
const sre = /id:\s*'(\w+)',\s*type:\s*'(cps|click)',\s*value:\s*([\d.e+]+),\s*base:\s*([\d.e+]+),\s*growth:\s*([\d.e+]+)/g;
while ((x = sre.exec(sim))) simM[x[1]] = { type: x[2], value: +x[3], base: +x[4], growth: +x[5] };

const ids = [...new Set([...Object.keys(game), ...Object.keys(simM)])];
const bad = [];
for (const id of ids) {
  const g = game[id], s = simM[id];
  if (!g || !s) { bad.push(`${id}: ${g ? 'ゲームにだけ存在' : 'sim にだけ存在'}`); continue; }
  const d = [];
  if (g.type !== s.type) d.push(`type sim=${s.type} game=${g.type}`);
  if (g.base !== s.base) d.push(`base sim=${s.base} game=${g.base}`);
  if (g.growth !== s.growth) d.push(`growth sim=${s.growth} game=${g.growth}`);
  if (g.value !== s.value) d.push(`value sim=${s.value} game=${g.value}`);
  if (d.length) bad.push(`${id}: ${d.join(' | ')}`);
}
// 自己検査: 抽出が壊れていれば「不一致0件」に見えてしまうので、読めた件数と代表idを確認する
if (Object.keys(game).length < 14) bad.push(`自己検査: ゲームから読めた設備が ${Object.keys(game).length} 件=抽出が壊れている`);
if (Object.keys(simM).length < 14) bad.push(`自己検査: sim から読めた設備が ${Object.keys(simM).length} 件=抽出が壊れている`);
for (const k of ['finger', 'godFinger', 'oven', 'grandma']) {
  if (!game[k]) bad.push(`自己検査: 代表設備 ${k} をゲームから読めていない`);
  if (!simM[k]) bad.push(`自己検査: 代表設備 ${k} を sim から読めていない`);
}

if (bad.length) {
  console.error('設備 parity NG: ' + bad.length + '件');
  for (const b of bad) console.error('  ' + b);
  console.error('sim が判定基準。ゲームを sim に合わせる(sim を変えるなら平均保存の確認込みでバッテリー再走)。');
  process.exit(1);
}
console.log(`設備 parity OK: ${ids.length}件(cps+click)が value/base/growth/type すべて一致`);
