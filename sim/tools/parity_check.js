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
// ---- 研究・実績研究のコスト表(2026-07-27 追加: 同じ腐り方をする場所を全部機械にする) ----
// 今は全件一致しているが、一致しているうちに検問へ入れておくのが目的(片側更新は必ず後から起きる)。
const S = require(path.join(ROOT, 'sim/sim.js'));
const P = S.P;
// 研究の基礎費用: ゲームは q5cost 適用後の絶対値を持つ
{
  const seg = html.slice(html.indexOf('const RESEARCH = ['));
  const g2 = {};
  const re = /\{\s*id:\s*"(\w+)"[\s\S]*?cost:\s*([\d.e+]+)/g;
  let mm; const lim = seg.indexOf('\n];');
  const body = seg.slice(0, lim > 0 ? lim : 200000);
  while ((mm = re.exec(body))) g2[mm[1]] = Number(mm[2]);
  // sim が模型化していないゲーム内容(BACKLOG OPEN1 で追跡中)。ここに無い新規が出たら落とす。
  const KNOWN_UNMODELED = ['bankVault', 'moonBake', 'timeLayer', 'eventHorizon', 'cosmicConvection', 'singularityFlow', 'annihilationCore'];
  for (const id in P.resCost) {
    if (g2[id] == null) { bad.push(`研究 ${id}: sim にあるがゲームに無い`); continue; }
    const w = S.q5cost(P.resCost[id]);
    if (w !== g2[id] && Math.abs(w / g2[id] - 1) > 1e-12) bad.push(`研究費用 ${id}: sim(q5)=${w} game=${g2[id]}`);
  }
  for (const id in g2) {
    if (P.resCost[id] != null) continue;
    if (!KNOWN_UNMODELED.includes(id)) bad.push(`研究 ${id} が sim に無い(=判定基準が見ていない内容)。模型化するか KNOWN_UNMODELED に理由付きで載せること`);
  }
  if (Object.keys(g2).length < 14) bad.push(`自己検査: ゲームから読めた研究が ${Object.keys(g2).length} 件=抽出が壊れている`);
}
// 研究段階(s2/s3)の費用: sim は q5cost(基礎費用×段階倍率)
{
  const mm = /const RESEARCH_STAGE_COST = (\{.*?\});/.exec(html);
  if (!mm) bad.push('RESEARCH_STAGE_COST が見つからない=この検査が空振りする');
  else {
    const g3 = JSON.parse(mm[1].replace(/([{,])(\w+):/g, '$1"$2":'));
    let n = 0;
    for (const id in g3) {
      const each = (P.resStageCostEach || {})[id];
      if (!each) { bad.push(`研究段階 ${id}: sim に段階倍率が無い`); continue; }
      for (const k of ['s2', 's3']) {
        const w = S.q5cost(P.resCost[id] * each[k]), gv = Number(g3[id][k]); n++;
        if (w !== gv && Math.abs(w / gv - 1) > 1e-12) bad.push(`研究段階費用 ${id}.${k}: sim=${w} game=${gv}`);
      }
    }
    if (n < 20) bad.push(`自己検査: 段階費用の比較が ${n} 件=抽出が壊れている`);
  }
}
// 実績研究(msk_/ms_)の費用表
{
  const mm = /const MS_COST_TABLE = (\{.*?\});/.exec(html);
  if (!mm) bad.push('MS_COST_TABLE が見つからない=この検査が空振りする');
  else {
    const g4 = JSON.parse(mm[1]);
    const s4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'sim/ms_costs.json'), 'utf8'));
    const ids = [...new Set([...Object.keys(s4), ...Object.keys(g4)])];
    for (const id of ids) {
      const a = s4[id], b = g4[id];
      if (a === undefined || b === undefined) { bad.push(`実績研究 ${id}: ${b === undefined ? 'simのみ' : 'gameのみ'}`); continue; }
      if (Number(a) !== Number(b)) bad.push(`実績研究費用 ${id}: sim=${a} game=${b}`);
    }
    if (ids.length < 200) bad.push(`自己検査: 実績研究の比較が ${ids.length} 件=抽出が壊れている`);
  }
}

// 報酬カードの id と系統(効果値の式は個別検証。ここは「片側にだけ在る/系統が違う」を止める)
{
  const i0 = html.indexOf('const REWARD_POOL');
  const seg = html.slice(i0, html.indexOf('\n];', i0));
  const g5 = {}; let mm;
  const re = /\{\s*id:\s*"(\w+)",\s*name:\s*"[^"]*",\s*category:\s*"(\w+)"/g;
  while ((mm = re.exec(seg))) g5[mm[1]] = mm[2];
  const s5 = {}; for (const r of S.REWARD_POOL) s5[r.id] = r.category;
  for (const id of new Set([...Object.keys(s5), ...Object.keys(g5)])) {
    if (s5[id] === undefined) bad.push(`報酬カード ${id}: ゲームにだけ存在`);
    else if (g5[id] === undefined) bad.push(`報酬カード ${id}: sim にだけ存在`);
    else if (s5[id] !== g5[id]) bad.push(`報酬カード ${id} の系統: sim=${s5[id]} game=${g5[id]}`);
  }
  if (Object.keys(g5).length < 18) bad.push(`自己検査: ゲームから読めた報酬カードが ${Object.keys(g5).length} 件=抽出が壊れている`);
}

// 自己検査: 抽出が壊れていれば「不一致0件」に見えてしまうので、読めた件数と代表idを確認する
if (Object.keys(game).length < 14) bad.push(`自己検査: ゲームから読めた設備が ${Object.keys(game).length} 件=抽出が壊れている`);
if (Object.keys(simM).length < 14) bad.push(`自己検査: sim から読めた設備が ${Object.keys(simM).length} 件=抽出が壊れている`);
for (const k of ['finger', 'godFinger', 'oven', 'grandma']) {
  if (!game[k]) bad.push(`自己検査: 代表設備 ${k} をゲームから読めていない`);
  if (!simM[k]) bad.push(`自己検査: 代表設備 ${k} を sim から読めていない`);
}

if (bad.length) {
  console.error('parity NG: ' + bad.length + '件');
  for (const b of bad) console.error('  ' + b);
  console.error('sim が判定基準。ゲームを sim に合わせる(sim を変えるなら平均保存の確認込みでバッテリー再走)。');
  process.exit(1);
}
console.log(`parity OK: 設備${ids.length}件(cps+click)・研究費用14件・研究段階26件・実績研究216件・報酬カード20件・すべて一致(sim未模型のゲーム研究7件は BACKLOG OPEN1 で追跡)`);
