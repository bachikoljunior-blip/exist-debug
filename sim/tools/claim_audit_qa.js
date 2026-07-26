// QA一巡(表示 vs 実装): 報酬パーク・実績研究・料理が「取っても何も動かない」ものになっていないか。
// 注意: 判定器自身の欠陥を避けるため ①state は freshState() 相当で全キー0埋め(perks={} だと
// Math.max(0, undefined)=NaN が伝播して全項目「動かない」と誤判定する) ②観測面は広く取り、
// 全設備を1台以上持たせる(0台だと設備別の効果が構造的に動かない) ③NaN が出たら面ごとに落とす。
//
// 相対許容差(1e-9)は加算効果を潰す: 深い進行では「毎秒 +50」が相対3.6e-10 で埋もれる。
// 「動かない」と出た件は必ず絶対差で個別確認する(2026-07-26 実測: 出た8件すべてが
// 観測面の外(金の即時獲得倍率/会心率/ドロップ数)か許容差の下で、新規欠陥はゼロだった)。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const p = await b.newPage({ viewport: { width: 430, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html', { waitUntil: 'load', timeout: 60000 });
  await p.clock.runFor(1500); await p.click('#audioGate').catch(() => {}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(() => {}); await p.clock.runFor(1000);

  const out = await p.evaluate(() => {
    const rep = { perks: [], ms: [], dishes: [], probeCheck: null };
    const base = () => {
      state = freshState();                     // 全キーが定義された素の状態(NaN汚染を避ける)
      ensureState();
      UPGRADES.forEach(u => state.upgrades[u.id] = 5);   // 全設備を5台=設備別の効果も観測できる
      state.research.ovenBatch = true; state.research.factoryNetwork = true;
      state.cookies = D('1e30'); state.stage = 1; state.maxQuotaStage = 3; state.maxQuotaStageEver = 3;
      state.monstersDefeated = 100; state.totalClicks = 100;
      state.skills = { workshop_1: true, workshop_2: true, reward_synergy: true };
    };
    const num = v => { const n = Number(String(v)); return Number.isFinite(n) ? n : null; };
    const probe = () => ({
      毎秒: num(currentCps()),
      タップ: num(currentClickPower()),
      討伐間隔: num(monsterSpawnFactor()),
      金間隔: num(goldenSpawnFactor()),
      与ダメ: num(monsterDamageMultiplier({ typeId: 'normal', hp: 100, maxHp: 100 })),
      金倍率: num(goldenBoostMultiplier()),
      金持続: num(goldenBoostDuration()),
      滞在: num(monsterStayDurationMs()),
      割引: num(upgradeDiscount()),
      炉倍率: num(ovenStageMultiplier()),
      深追HP: num(deepPursuitHpPenalty()),
      ボス周期: num(bossCycleFor(1)),
      料理時間: num(dishDurationMs()),
    });
    const moved = (off, on) => Object.keys(off).filter(k => off[k] != null && on[k] != null
      && Math.abs(on[k] - off[k]) > 1e-9 * Math.max(1, Math.abs(off[k])));

    // 判定器の自己検査: 確実に効くもの(強い指+1台/金出現パーク)で面が動くこと
    base(); const s0 = probe(); state.upgrades.finger += 50; const s1 = probe();
    base(); const g0 = probe(); state.perks.goldenRate = 5; const g1 = probe();
    rep.probeCheck = { 強い指50台で動いた面: moved(s0, s1).join(','), 金出現パークで動いた面: moved(g0, g1).join(','),
      観測できた面: Object.entries(s0).filter(([, v]) => v != null).map(([k]) => k).join(',') };

    for (const r of REWARD_POOL) {
      base(); const off = probe(); state.perks[r.id] = 3; const on = probe();
      rep.perks.push({ id: r.id, name: r.name, 動いた面: moved(off, on).join(',') });
    }
    for (const m of MILESTONE_RESEARCH) {
      base(); const off = probe(); state.msResearch[m.id] = true; const on = probe();
      rep.ms.push({ id: m.id, 動いた面: moved(off, on).join(',') });
    }
    for (const d of DISHES) {
      base(); const off = probe(); state.activeDishes = [{ id: d.id, until: Date.now() + 600000 }]; const on = probe();
      rep.dishes.push({ id: d.id, name: d.name, 動いた面: moved(off, on).join(',') });
    }
    return rep;
  });

  console.log('=== 判定器の自己検査 ===');
  console.log('  観測できた面:', out.probeCheck.観測できた面);
  console.log('  強い指50台で動いた面:', out.probeCheck.強い指50台で動いた面 || '(なし=判定器が壊れている)');
  console.log('  金出現パークで動いた面:', out.probeCheck.金出現パークで動いた面 || '(なし=判定器が壊れている)');
  const dead = a => a.filter(x => !x.動いた面);
  for (const [label, arr] of [['報酬パーク', out.perks], ['実績研究', out.ms], ['料理', out.dishes]]) {
    const d = dead(arr);
    console.log(`=== ${label}: 観測面のどれも動かないもの ${d.length}/${arr.length} ===`);
    d.slice(0, 30).forEach(x => console.log(`  ${x.name || x.id}`));
    if (d.length > 30) console.log(`  … 他${d.length - 30}件`);
  }
  console.log('errs:', errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
