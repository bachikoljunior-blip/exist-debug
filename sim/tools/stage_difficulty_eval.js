// R35難度レバー評価(sim先行): 討伐必要数(quest2.killsNeed)のスケールを振り、
// 各ステージの解放時刻(ゲーム内時間)がどう動くかを戦略別に測る。
// 目的: 「最新ステージが簡単に達成できてしまう」を、100h地平の後半に着地する"手強さ"へ調整する当て所を得る。
// 経済(クッキー生産/費用)には一切触れない=killsNeedは解放タイミングのみを動かす。ゲーム側は不変。
// 実行: node tools/stage_difficulty_eval.js [hours=100] [sids=S1,S2,S4]
const P = require('../params.js');
const BASE = P.quest2.killsNeed.slice();
const G = require('../sim.js');
const { STRATEGIES } = require('../strategies.js');
const hours = Number(process.argv[2] || 100);
const sids = (process.argv[3] || 'S1,S2,S4').split(',');
const SCALES = [1, 1.5, 2, 3];
const fmtH = t => !isFinite(t) ? '未' : (t / 3600).toFixed(1) + 'h';
for (const scale of SCALES) {
  P.quest2.killsNeed = BASE.map(x => Math.round(x * scale));
  console.log(`\n=== killsNeed ×${scale} = [${P.quest2.killsNeed}] ===`);
  for (const sid of sids) {
    const s = STRATEGIES.find(x => x.id === sid);
    if (!s) continue;
    let sim;
    try { sim = G.simulate(s, { hours }); } catch (e) { console.log(`${sid}: ERR ${e.message.slice(0, 60)}`); continue; }
    const st = {};
    for (const e of (sim.unlockEvents || [])) {
      if (e.kind === 'ws' && /^stage:/.test(e.id || '')) st[(e.id.split(':')[1])] = e.t;
    }
    const row = [2, 3, 4, 5, 6].map(n => `st${n}=${fmtH(st[n] != null ? st[n] : Infinity)}`).join(' ');
    console.log(`${sid}(${s.name}): ${row}`);
  }
}
P.quest2.killsNeed = BASE;
