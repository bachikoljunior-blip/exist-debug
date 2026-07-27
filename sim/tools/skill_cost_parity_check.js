// スキルコスト/転生PT供給の sim↔ゲーム parity 検問(2026-07-27)。
//
// なぜ必要か(実際に起きた腐り): sim は第13次で PT供給(pB=14/pG=0.023)とスキルコスト梯子
// (C0=13・rho=1.57・QoL枠=前提×0.35)を再設計したが、ゲーム側は旧値(11/0.075 と旧梯子)のまま
// 残っていた。結果、ゲームだけが「工房=105PT(=前提の21倍)・装備作成T2=5000PT」という価格になり、
// 初回転生の予算(18〜26PT)では素材/料理/装備/注文ボードに永久に届かなかった。
// sim(=経済の判定基準)は装備・料理・注文が生きている前提で全バッテリーを緑にしているので、
// これは「ゲームだけが承認済み設計から外れていた」parity破れ。目視では気づけない(両方それぞれ整合して見える)。
//
// 検査:
//  1) sim の全スキルノードについて skillCostOf(node) == ゲームの cost フィールド
//  2) ゲーム固有ノード(sim に無い)は sim の QoL規則で導出した値と一致
//  3) totalPrestigeFromCookies の係数が P.prestige.pB / pG と一致
// 使い方: node sim/tools/skill_cost_parity_check.js   (pre-commit が index.html / sim変更時に自動実行)
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const S = require(path.join(ROOT, 'sim/sim.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const want = {};
for (const n of S.SKILL_NODES) want[n.id] = S.skillCostOf(n);
// ゲーム固有ノードは sim の QoL規則(前提コスト×utilRatio)で導出する。増やすときはここに足す。
const GAME_ONLY = { endless_oven: () => S.q5cost(want['start_2'] * (S.P.skillCost.utilRatio || 0.35)) };

const got = {};
for (const L of html.split('\n')) {
  if (!/branchId:\s*"/.test(L) || !/cost:\s*[\d.e+]+/.test(L)) continue;
  const m = /id:\s*"(\w+)"/.exec(L);
  if (!m) continue;
  got[m[1]] = Number(/cost:\s*([\d.e+]+)/.exec(L)[1]);
}

const bad = [];
for (const id in want) {
  if (got[id] == null) { bad.push(`ゲームにノードが無い: ${id}(sim=${want[id]})`); continue; }
  if (got[id] !== want[id]) bad.push(`コスト不一致 ${id}: sim=${want[id]} game=${got[id]}`);
}
for (const id in got) {
  if (want[id] != null) continue;
  if (GAME_ONLY[id]) { const w = GAME_ONLY[id](); if (got[id] !== w) bad.push(`ゲーム固有ノードの導出値と不一致 ${id}: 規則値=${w} game=${got[id]}`); continue; }
  bad.push(`sim に無いノードが増えている: ${id}(cost=${got[id]})=導出規則を GAME_ONLY に決めて書くこと`);
}

// 転生PT供給の係数
const pB = S.P.prestige.pB, pG = S.P.prestige.pG, pA = S.P.prestige.pA, pMin = S.P.prestige.pMin;
const fn = /function totalPrestigeFromCookies\(totalCookies\)[\s\S]{0,1400}?\n}/.exec(html);
if (!fn) bad.push('totalPrestigeFromCookies が見つからない(名前が変わった?=この検問が空振りする)');
else {
  const body = fn[0];
  const coefs = [...body.matchAll(/Math\.floor\(([\d.]+) \* Math\.pow\(/g)].map(m => Number(m[1]));
  const exps = [...body.matchAll(/,\s*([\d.]+)\)\)|Math\.pow\(10,\s*([\d.]+) \*/g)].map(m => Number(m[1] != null ? m[1] : m[2]));
  if (!coefs.length) bad.push('PT係数(pB相当)を式から抽出できない=この検問が空振りする');
  for (const c of coefs) if (c !== pB) bad.push(`PT係数 不一致: sim pB=${pB} game=${c}`);
  for (const e of exps) if (e !== pG) bad.push(`PT指数 不一致: sim pG=${pG} game=${e}`);
  if (pA !== 0) bad.push(`sim P.prestige.pA=${pA}≠0: ゲーム式は pA項を省略しているので移植し直しが必要`);
  if (!new RegExp('lt\\(' + pMin + '\\)').test(body)) bad.push(`PT下限 不一致: sim pMin=${pMin} がゲームのガードに無い`);
}

// 自己検査: 抽出が本当に効いているか(=名前変更や正規表現の腐りで空振りしていないか)
const selfKeys = ['workshop_1', 'workshop_2', 'core', 'master_final'];
for (const k of selfKeys) if (got[k] == null) bad.push(`自己検査: 代表ノード ${k} をゲームから読めていない=抽出が壊れている`);
if (Object.keys(got).length < 60) bad.push(`自己検査: ゲームから読めたノードが ${Object.keys(got).length} 件しかない=抽出が壊れている`);

if (bad.length) {
  console.error('スキルコスト/PT parity NG: ' + bad.length + '件');
  for (const b of bad.slice(0, 40)) console.error('  ' + b);
  if (bad.length > 40) console.error('  ...ほか' + (bad.length - 40) + '件');
  console.error('sim が判定基準。ゲームを sim の実効値へ合わせる(sim を変えるなら平均保存の確認込みでバッテリー再走)。');
  process.exit(1);
}
console.log(`スキルコスト/PT parity OK: ノード${Object.keys(want).length}件一致(ゲーム固有${Object.keys(GAME_ONLY).length}件は導出規則で一致)・PT式 pB=${pB} pG=${pG} pMin=${pMin}`);
