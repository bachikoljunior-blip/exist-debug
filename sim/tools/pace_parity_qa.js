// sim と実機の「到達ペース差」を、同じ購入内容に揃えて突き合わせる測定器(2026-07-27)。
//
// なぜ必要か(実測して分かった食い違い):
//   sim(=経済の判定基準・S1)は run0 が 27分・1e11 クッキー、run1 が 48分・6.5e38。
//   実機を実プレイヤ模型で通すと **74ゲーム時間で転生1回・毎秒 3.0e8+直送1.7e10**。
//   この差が「模型(ドライバ)が弱い」のか「ゲームがsimと違う経済になっている(parity破れ)」のか、
//   通し走行の結果だけでは分けられない。分けるには**購入内容を揃えて収入だけを比べる**しかない。
//
// やること: sim を run0 の終わり際まで進める → そのときの購入内容(設備台数・研究・段階2/3・スキル)を
//   実機に同じだけ入れる → 両者の「毎秒生産」と「直送収入の合計」を読んで比率を出す。
//   比が1に近ければゲームはsimどおり=遅いのはドライバ(=模型を直す)。桁で違えばゲーム側の欠落を疑う。
//
// 実行: node sim/tools/pace_parity_qa.js  (env: STRAT=S1 / MARGIN=30 秒手前で止める)
// 注意: これは測定専用。ゲームにもsimにも経済の変更は入れない(sim側は読み出しの口を足しただけ)。
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const S = require(path.join(ROOT, 'sim/sim.js'));
const { STRATEGIES } = require(path.join(ROOT, 'sim/strategies.js'));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const STRAT = process.env.STRAT || 'S1';
const MARGIN = Number(process.env.MARGIN || 30); // run0 終了の何秒手前で止めるか
const INDEX = process.env.GAME_INDEX || path.join(ROOT, 'index.html');

(async () => {
  const st = STRATEGIES.find(x => x.id === STRAT);
  if (!st) { console.error('戦略が無い: ' + STRAT); process.exit(1); }

  // 1) run0 の終了時刻を知る(1時間で足りる: 実測 27分)
  const probe = S.simulate(st, { hours: 1, noIdleCut: true });
  const r0 = probe.runs.find(r => !r.partial);
  if (!r0) { console.error('1時間以内に run0 が終わらない=この測り方が使えない'); process.exit(1); }
  const stopAt = Math.max(60, r0.endT - MARGIN);

  // 2) 終わり際まで進めて購入内容と収入を読む
  const sim = S.simulate(st, { hours: stopAt / 3600, noIdleCut: true });
  const run = sim.run;
  const prod = S.computeProd(sim);   // prod.stage = sim のノルマ層(層は生産倍率に効く=実機にも同じ層を入れる)
  const simDirect = S.directAllOf(sim);
  const ups = {}; for (const id in run.upgrades) if (run.upgrades[id] > 0) ups[id] = run.upgrades[id];
  const res = Object.keys(run.research).filter(k => run.research[k]);
  const res2 = Object.keys(run.research2).filter(k => run.research2[k]);
  const res3 = Object.keys(run.research3).filter(k => run.research3[k]);
  const skills = Object.keys(sim.skills).filter(k => sim.skills[k]);
  // 実績研究(ms)と討伐報酬(perk)も揃える(2026-07-27 最初の版で入れ忘れ、実機だけ倍率が欠けた状態で
  // 比べてしまった=判定器を先に測る原則どおり、比を出す前に「両者が同じ盤面か」を揃える)。
  const msBought = Object.assign({}, (run.ms && run.ms.bought) || {});
  // 一時窓(金取得後の香料ブースト等)も揃える: sim がその窓の中にいるなら実機も中にする。
  // 揃えないと「香料棚だけ比が0.08」と出て parity破れに見える(2026-07-27 実際にそう見えた)。
  const spiceBoostOn = (run.spiceBoostUntil || 0) > sim.t;
  const perks = {}; for (const k in (run.perks || {})) if (run.perks[k] > 0) perks[k] = run.perks[k];
  console.log(`== sim ${STRAT} を run0 の ${Math.round(stopAt)}秒(終了${Math.round(r0.endT)}秒の${MARGIN}秒前)まで進めた ==`);
  console.log(`  設備 ${Object.keys(ups).length}種/計${Object.values(ups).reduce((a, b) => a + b, 0)}台 / 研究${res.length}件(段2=${res2.length}・段3=${res3.length}) / スキル${skills.length}個 / 実績研究${Object.keys(msBought).length}件 / 報酬perk${Object.keys(perks).length}種 / ノルマ層${Math.round(prod.stage || 1)} / 金ブースト×${(prod.boostM || 1).toFixed(2)} / 香料窓${spiceBoostOn ? '中' : '外'}`);
  console.log(`  sim: 毎秒生産 ${prod.cps.toExponential(3)} / 直送合計 ${simDirect.toExponential(3)} / 合計 ${(prod.cps + simDirect).toExponential(3)} / 所持 ${run.cookies.toExponential(2)}`);

  // 3) 実機に同じ購入内容を入れて収入を読む
  const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', headless: true });
  const p = await b.newPage({ viewport: { width: 430, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install();
  await p.goto('file://' + INDEX, { waitUntil: 'load', timeout: 60000 });
  await p.clock.runFor(1200);
  await p.click('#audioGate').catch(() => {});
  await p.clock.runFor(600);
  await p.click('#titleStartBtn').catch(() => {});
  await p.clock.runFor(800);

  const game = await p.evaluate(({ ups, res, res2, res3, skills, stage, kills, msBought, perks, spiceBoostOn, cookies, layer }) => {
    // 購入内容をそのまま置く(=同じ盤面にする)。経済の式には触らない。
    for (const id in ups) state.upgrades[id] = ups[id];
    for (const id of res) state.research[id] = true;
    state.researchStages = state.researchStages || {};
    for (const id of res2) state.researchStages[id] = 2;
    for (const id of res3) state.researchStages[id] = 3;
    for (const id of skills) state.skills[id] = true;
    state.msResearch = state.msResearch || {};
    for (const id in msBought) state.msResearch[id] = msBought[id];
    state.perks = state.perks || {};
    for (const id in perks) state.perks[id] = perks[id];
    state.monstersDefeated = kills || 0;
    // 所持クッキーも揃える(2026-07-27 追加): 銀行配当の貯蓄項 log1p(log10(cookies)) が効くので、
    // 揃えないと同じ盤面にならない(実測でこの項だけずれていた)。
    if (cookies > 0) state.cookies = D(cookies);
    if (spiceBoostOn) state.spiceBoostUntil = Date.now() + 30000;
    // ノルマ層(=生産倍率に効く)。ここを揃えないと「同じ盤面」にならない(2026-07-27 実測で追加)。
    if (layer > 1) { state.maxQuotaStage = layer; state.maxQuotaStageEver = Math.max(layer, state.maxQuotaStageEver || 1); }
    if (stage > 1) { state.stageUnlocked = Math.max(state.stageUnlocked || 1, stage); state.stage = stage; }
    const num = x => Number(String(x));
    const missing = { upgrades: [], research: [], skills: [] };
    for (const id in ups) if (!UPGRADES.some(u => u.id === id)) missing.upgrades.push(id);
    for (const id of res) if (!RESEARCH.some(r => r.id === id)) missing.research.push(id);
    for (const id of skills) if (!SKILLS.some(s => s.id === id)) missing.skills.push(id);
    missing.ms = Object.keys(msBought).filter(id => !MILESTONE_RESEARCH.some(m => m.id === id));
    missing.perk = Object.keys(perks).filter(id => !(id in state.perks));
    return {
      baseCps: num(baseCps()), currentCps: num(currentCps()),
      direct: (typeof directIncomeTotalCps === 'function') ? num(directIncomeTotalCps()) : 0,
      missing
    };
  }, { ups, res, res2, res3, skills, stage: run.maxStage || 1, kills: run.kills || 0, msBought, perks, spiceBoostOn, cookies: run.cookies || 0, layer: Math.max(1, Math.round(prod.stage || 1)) });

  // 設備ごとの内訳(どこで桁が違うか)。同じ台数のはずなので、比が1から外れた設備が原因の所在。
  const simContrib = S.upgradeContribs(sim);
  const gameContrib = await p.evaluate(() => {
    const out = {};
    for (const u of UPGRADES) {
      try {
        const v = Number(String(rawUpgradeCps(u))); if (!(v > 0)) continue;
        out[u.id] = { v, value: u.value,
          personal: Number(String(upgradePersonalMultiplier(u))),
          research: Number(String(researchUpgradeMultiplier(u))),
          support: Number(String(supportUpgradeMultiplier(u))),
          mastery: Number(String(masteryMultiplier(u))),
          msOwnSup: Number(String(msDiverseUpgradeMul(u))) };
      } catch (e) {}
    }
    return out;
  });
  console.log('  設備ごとの直接生産(実機/sim):');
  for (const id of Object.keys(ups)) {
    const g = gameContrib[id] || {}, a = g.v || 0, b2 = simContrib[id] || 0;
    const perUnitSim = b2 / ups[id], perUnitGame = a / ups[id];
    console.log(`    ${id.padEnd(16)} 台数${String(ups[id]).padStart(4)}  sim ${b2.toExponential(2)}  実機 ${a.toExponential(2)}  比 ${(b2 > 0 ? a / b2 : NaN).toFixed(4)}`);
    console.log(`      1台あたり: sim ${perUnitSim.toExponential(2)} / 実機 ${perUnitGame.toExponential(2)}  実機の内訳: 素値${g.value} × 個別${(g.personal || 1).toFixed(2)} × 研究${(g.research || 1).toExponential(2)} × 支援${(g.support || 1).toFixed(2)} × 熟練${(g.mastery || 1).toFixed(2)} × 実績own/sup${(g.msOwnSup || 1).toFixed(2)}`);
  }

  // 全体倍率の内訳(設備ごとが全部1.0000になったあとの残差はここにしか無い)
  const simG = S.globalFactors(sim);
  const gameG = await p.evaluate(() => {
    const n = x => Number(String(x));
    return {
      cpsSkill: n(cpsSkillMultiplier()), prestige: n(prestigeMultiplier()), globalRes: n(globalResearchMultiplier()),
      runRewardAll: n(runRewardAllMultiplier()), runRewardCps: n(runRewardCpsMultiplier()), bake: n(bakeCpsMultiplier()),
      orderTemp: n(orderTempCpsMultiplier()), dish: n(dishProductionMultiplier()), equip: n(equipProductionMultiplier()),
      msAll: n(msMulOf('all')), msCps: n(msMulOf('cps')), lineage: n(lineageBonusCps()), presence: n(presenceBonusCps()),
      msCpsAdd: n(msCpsAdd()), rawSum: UPGRADES.reduce((a, u) => a + n(rawUpgradeCps(u)), 0)
    };
  });
  const simRawSum = Object.values(simContrib).reduce((a, b) => a + b, 0);
  console.log('  全体倍率(sim / 実機):');
  console.log(`    スキル系 ${simG.cpsSkillMul.toFixed(4)} / ${(gameG.cpsSkill * gameG.msAll * gameG.msCps).toFixed(4)}(実機=cpsSkill×ms(all)×ms(cps))`);
  console.log(`    転生     ${simG.prestigeMul.toFixed(4)} / ${gameG.prestige.toFixed(4)}`);
  console.log(`    研究全体 ${simG.globalRes.toFixed(4)} / ${gameG.globalRes.toFixed(4)}`);
  console.log(`    討伐系   ${(simG.killMulAll * simG.killMulCps).toFixed(4)} / ${(gameG.runRewardAll * gameG.runRewardCps).toFixed(4)}(実機=報酬all×報酬cps)`);
  console.log(`    その他実機のみ: 焼成${gameG.bake.toFixed(3)} 注文${gameG.orderTemp.toFixed(3)} 料理${gameG.dish.toFixed(3)} 装備${gameG.equip.toFixed(3)}`);
  console.log(`    加算・系列: sim cpsAdd ${simG.msCpsAdd} / 実機 cpsAdd ${gameG.msCpsAdd}・系列 ${gameG.lineage.toExponential(2)}・初台 ${gameG.presence.toExponential(2)}`);
  console.log(`    設備合計(系列前): sim ${simRawSum.toExponential(3)} / 実機 ${gameG.rawSum.toExponential(3)} 比 ${(gameG.rawSum / simRawSum).toFixed(4)}`);
  console.log(`    系列込みの素合計: sim ${simG.cpsRaw.toExponential(3)} / 実機 ${(gameG.rawSum + gameG.lineage + gameG.msCpsAdd).toExponential(3)} 比 ${((gameG.rawSum + gameG.lineage + gameG.msCpsAdd) / simG.cpsRaw).toFixed(4)}`);

  // 直送の内訳(5系統)
  const simD = S.directBreakdown(sim);
  const gameD = await p.evaluate(() => {
    const n = x => Number(String(x));
    return { equip: n(equipDirectCps()), golden: n(goldenDirectCps()), hunt: n(huntPeddlerCps()),
      tap: n(tapStallCps()), bank: n(bankDirectCps()), goldenRate: n(expectedGoldenRateCps()) };
  });
  // 金相場の内訳(直送のアンカーなのでここがずれると全直送がずれる)
  const simGold = S.goldenRateParts(sim);
  const gameGold = await p.evaluate(() => {
    const n = x => Number(String(x));
    const clickEV = n(currentClickPower()) * (1 + n(fingerCritChance()) * (n(fingerCritMultiplier()) - 1));
    return { interval: Math.max(1, 65000 * n(goldenSpawnFactor()) / 1000), clickEV,
      cpsBranch: n(currentCps()) * 4, clickBranch: clickEV * n(clickAnchorCoef()),
      amt: n(goldenAmountMultiplier()), early: n(goldenEarlyMultiplier()), eq: n(equip2Fx().goldenAmtMul),
      mult: n(goldenMultiplier()), dur: n(goldenBoostDuration()) / 1000 };
  });
  console.log('  金相場の内訳(sim / 実機):');
  console.log(`    間隔 ${simGold.interval.toFixed(2)} / ${gameGold.interval.toFixed(2)} ・ cps枝 ${simGold.cpsBranch.toExponential(3)} / ${gameGold.cpsBranch.toExponential(3)} ・ click枝 ${simGold.clickBranch.toExponential(3)} / ${gameGold.clickBranch.toExponential(3)}`);
  console.log(`    金量 ${simGold.amt.toFixed(4)} / ${gameGold.amt.toFixed(4)} ・ 序盤 ${simGold.early.toFixed(3)} / ${gameGold.early.toFixed(3)} ・ 倍率 ${simGold.mult.toFixed(3)} / ${gameGold.mult.toFixed(3)} ・ 持続 ${simGold.dur.toFixed(1)} / ${gameGold.dur.toFixed(1)}`);

  console.log('  直送の内訳(sim / 実機 / 比):');
  for (const k of ['equip', 'golden', 'hunt', 'tap', 'bank', 'goldenRate']) {
    console.log(`    ${k.padEnd(11)} ${simD[k].toExponential(3)} / ${gameD[k].toExponential(3)} / ${(simD[k] > 0 ? gameD[k] / simD[k] : NaN).toFixed(4)}`);
  }

  const total = game.currentCps + game.direct;
  const simTotal = prod.cps + simDirect;
  console.log(`  実機: 毎秒生産 ${game.currentCps.toExponential(3)} / 直送合計 ${game.direct.toExponential(3)} / 合計 ${total.toExponential(3)}`);
  console.log(`  比(実機/sim): 毎秒 ${(game.currentCps / prod.cps).toFixed(4)} / 直送 ${(simDirect > 0 ? game.direct / simDirect : NaN).toFixed(4)} / 合計 ${(total / simTotal).toFixed(4)}`);
  for (const k of ['upgrades', 'research', 'skills', 'ms', 'perk']) {
    if ((game.missing[k] || []).length) console.log(`  ⚠ 実機に無いID(${k}): ${game.missing[k].join(',')}`);
  }
  console.log(`  pageエラー ${errs.length}${errs.length ? ': ' + errs[0] : ''}`);
  // 判定は出さない(何倍なら合格かは決めていない)。数字を残して次の判断材料にする。
  await b.close();
})().catch(e => { console.error('FATAL ' + e.message); process.exit(1); });
