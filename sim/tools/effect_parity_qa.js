// 「効果の式」の sim↔ゲーム parity 検問(2026-07-27)。
//
// なぜ要るか(2026-07-27 に同日6件踏んだ): `parity_check.js` は**費用表**しか見ていないので、
// 効果の式が片側だけ古いまま腐っても検出できなかった。実際に見つかったのは:
//   設備増幅研究3件のレート / 異世界接続網の自己倍率 / 研究連動の全生産倍率(ゲームに丸ごと無し) /
//   銀行配当の直送係数 / 金の即時獲得・ブースト・出現の旧飽和と旧係数 / 延長狩りの窓中短縮(1/10) /
//   生産連動タップに銀行配当を重ね掛け。どれも「同じ盤面で数字を比べる」まで見えない。
//
// やること: 何通りかの**同じ盤面**(設備台数・研究・段階・スキル・報酬Lv・層・所持額・周回経過秒)を
// sim と実機の両方に入れて、外から見える量(毎秒生産・タップ力・金相場・出現間隔・直送5系統)を比べる。
// 比が 1±TOL から外れたら NG(exit 1)。盤面は固定表=毎回同じ(再現性のため乱数を使わない)。
//
// 実行: node sim/tools/effect_parity_qa.js   (env: TOL=0.01)
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const S = require(path.join(ROOT, 'sim/sim.js'));
const { STRATEGIES } = require(path.join(ROOT, 'sim/strategies.js'));
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const TOL = Number(process.env.TOL || 0.01);
const INDEX = process.env.GAME_INDEX || path.join(ROOT, 'index.html');

// 盤面(固定表): 序盤・中盤・報酬厚め・上位設備ありの4通り。
const BOARDS = [
  { name: '序盤', kills: 5, ups: { finger: 20, grandma: 15, oven: 30 }, res: ['ovenBatch', 'grandmaCrowd'], perks: {}, layer: 3, runs: 0, cookies: 1e7, elapsed: 300 },
  { name: '中盤', kills: 40, ups: { finger: 66, grandma: 45, oven: 140, factory: 106, bank: 24, spiceRack: 58, portal: 45 },
    res: ['ovenBatch', 'grandmaCrowd', 'factoryNetwork', 'spiceBlend', 'portalNetwork', 'bankClickDividend', 'fingerTechnique'],
    perks: { goldenRate: 4, goldenPower: 3, goldenAmount: 5, monsterRate: 3, monsterDamage: 4 }, layer: 9, runs: 1, cookies: 2.5e9, elapsed: 1600 },
  { name: '報酬厚め', kills: 120, ups: { finger: 80, grandma: 60, oven: 200, factory: 150, bank: 60, spiceRack: 90, portal: 70 },
    res: ['ovenBatch', 'grandmaCrowd', 'factoryNetwork', 'spiceBlend', 'portalNetwork', 'bankClickDividend', 'fingerTechnique'],
    perks: { goldenRate: 12, goldenPower: 10, goldenAmount: 14, monsterRate: 9, monsterDamage: 11, monsterStay: 6,
      goldenChain: 5, goldenTarget: 4, goldenFirstHit: 3, beastScent: 2, crackedFang: 5, huntingCore: 3, brandHunt: 2, deepPursuit: 4 },
    layer: 22, runs: 3, cookies: 4e14, elapsed: 2400 },
  { name: '上位設備', kills: 300, ups: { finger: 120, grandma: 90, oven: 300, factory: 220, bank: 120, spiceRack: 150, portal: 140, moonBakery: 40, galaxyFactory: 25, timeOven: 30 },
    res: ['ovenBatch', 'grandmaCrowd', 'factoryNetwork', 'spiceBlend', 'portalNetwork', 'bankClickDividend', 'fingerTechnique', 'moonGlobalYeast'],
    perks: { goldenRate: 20, goldenPower: 18, goldenAmount: 25, monsterRate: 15, monsterDamage: 20, goldenChain: 8, huntingCore: 6 },
    layer: 40, runs: 5, cookies: 8e22, elapsed: 3000 }
];

function applyToSim(sim, b) {
  const r = sim.run;
  for (const id in r.upgrades) r.upgrades[id] = b.ups[id] || 0;
  for (const id in r.research) r.research[id] = b.res.includes(id);
  for (const id in r.perks) r.perks[id] = b.perks[id] || 0;
  r.maxStage = b.layer; r.cookies = b.cookies; r.runCookies = b.cookies;
  r.quotaMonsterKills = b.kills || 0;
  // 実績研究は両側とも「無し」に揃える(sim は 0.02h の暖機中に安い実績研究を自動購入してしまうため。
  // 揃えないとオーブンだけ比0.956と出て parity破れに見える=2026-07-27 実測)
  r.ms = { up: {}, click: 1, cps: 1, all: 1, golden: 1, hunt: 1, dropAdd: 0, bought: {}, cpsAdd: 0, own: {}, sup: {}, critAdd: 0, momentum: false };
  r._msRepeatT = {}; // 討伐系の全生産倍率(killMul)はノルマ中討伐数で伸びる=両側で揃える
  r.startT = 0; sim.t = b.elapsed; sim.prestigeRuns = b.runs;
  sim._stT = null; // currentStage のキャッシュを落とす
  return sim;
}

(async () => {
  const st = STRATEGIES.find(x => x.id === 'S1');
  const b0 = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', headless: true });
  const p = await b0.newPage({ viewport: { width: 430, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install();
  await p.goto('file://' + INDEX, { waitUntil: 'load', timeout: 60000 });
  await p.clock.runFor(1200);
  await p.click('#audioGate').catch(() => {}); await p.clock.runFor(600);
  await p.click('#titleStartBtn').catch(() => {}); await p.clock.runFor(800);

  const bad = [];
  for (const b of BOARDS) {
    // sim 側: 1周回だけ回した sim を作って盤面を差し替える(経済は変えない=読み出しのみ)
    const sim = applyToSim(S.simulate(st, { hours: 0.02, noIdleCut: true }), b);
    const prod = S.computeProd(sim);
    const simVals = {
      cps: prod.cps, clickEV: prod.clickEV,
      goldenRate: S.goldenRateParts(sim).cpsBranch >= 0 ? (() => { const g = S.goldenRateParts(sim); const inst = Math.max(g.cpsBranch, g.clickBranch) * g.amt * g.early; return (inst + Math.max(0, g.mult - 1) * prod.cps * g.dur) / 2 / g.interval; })() : 0,
      goldenSpawn: S.spawnFactors(sim).golden, monsterSpawn: S.spawnFactors(sim).monster,
      direct: (() => { const d = S.directBreakdown(sim); return d.equip + d.golden + d.hunt + d.tap + d.bank; })()
    };
    const gameVals = await p.evaluate((b) => {
      for (const u of UPGRADES) state.upgrades[u.id] = b.ups[u.id] || 0;
      for (const r of RESEARCH) state.research[r.id] = b.res.includes(r.id);
      for (const k in state.perks) state.perks[k] = b.perks[k] || 0;
      state.maxQuotaStage = b.layer; state.maxQuotaStageEver = b.layer;
      state.prestigeRuns = b.runs; state.cookies = D(b.cookies);
      state.runStart = Date.now() - b.elapsed * 1000; state.quotaPausedMs = 0;
      state.quotaMonsterKills = b.kills || 0;
      const n = x => Number(String(x));
      const clickEV = n(currentClickPower()) * (1 + n(fingerCritChance()) * (n(fingerCritMultiplier()) - 1));
      return { cps: n(currentCps()), clickEV, goldenRate: n(expectedGoldenRateCps()),
        goldenSpawn: n(goldenSpawnFactor()), monsterSpawn: n(monsterSpawnFactor()), direct: n(directIncomeTotalCps()) };
    }, b);
    // NG のときは全体倍率の内訳も出す(どの層でずれているかを毎回手で追わないため)
    const simG = S.globalFactors(sim);
    const gameG = await p.evaluate(() => {
      const n = x => Number(String(x));
      return { cpsSkill: n(cpsSkillMultiplier()) * n(msMulOf('all')) * n(msMulOf('cps')), prestige: n(prestigeMultiplier()),
        globalRes: n(globalResearchMultiplier()), reward: n(runRewardAllMultiplier()) * n(runRewardCpsMultiplier()),
        rawSum: UPGRADES.reduce((a, u) => a + n(rawUpgradeCps(u)), 0) + n(lineageBonusCps()) + n(msCpsAdd()) };
    });
    console.log(`  [${b.name}] 内訳(sim/実機): 素合計 ${simG.cpsRaw.toExponential(3)}/${gameG.rawSum.toExponential(3)} 比${(gameG.rawSum / simG.cpsRaw).toFixed(4)} ・ スキル系 ${simG.cpsSkillMul.toFixed(3)}/${gameG.cpsSkill.toFixed(3)} ・ 転生 ${simG.prestigeMul.toFixed(3)}/${gameG.prestige.toFixed(3)} ・ 研究全体 ${simG.globalRes.toFixed(4)}/${gameG.globalRes.toFixed(4)} ・ 討伐系 ${(simG.killMulAll * simG.killMulCps).toFixed(3)}/${gameG.reward.toFixed(3)}`);
    // 局在用: 設備ごとの直接生産と、タップ力の内訳(NGのとき手で追わないため常に出す)
    const simContrib = S.upgradeContribs(sim), simC = S.clickParts(sim);
    const gameDet = await p.evaluate(() => {
      const n = x => Number(String(x));
      const per = {}; for (const u of UPGRADES) { const v = n(rawUpgradeCps(u)); if (v > 0) per[u.id] = v; }
      let craw = 1; for (const u of UPGRADES) if (u.type === 'click') craw += n(rawUpgradeContribution(u));
      return { per, lineage: n(lineageBonusCps()), presence: n(presenceBonusCps()),
        clickRaw: craw, bankM: n(bankClickMultiplier()), prodLink: n(productionLinkClickPower()), base: n(baseClickPower()) };
    });
    const diffUp = Object.keys(simContrib).filter(id => {
      const a = simContrib[id] || 0, g = gameDet.per[id] || 0;
      return a > 0 && Math.abs(g / a - 1) > TOL;
    }).map(id => `${id} ${(gameDet.per[id] / simContrib[id]).toFixed(4)}`);
    if (diffUp.length) {
      console.log(`    設備ごとに違うもの: ${diffUp.join(' / ')}`);
      const det = await p.evaluate(() => {
        const n = x => Number(String(x));
        const u = UPGRADES.find(x => x.id === 'oven');
        return { value: u.value, owned: state.upgrades.oven || 0, personal: n(upgradePersonalMultiplier(u)),
          research: n(researchUpgradeMultiplier(u)), support: n(supportUpgradeMultiplier(u)),
          mastery: n(masteryMultiplier(u)), msOwnSup: n(msDiverseUpgradeMul(u)) };
      });
      const simPer = (simContrib.oven || 0) / (det.owned * det.value);
      const gamePer = (det.personal * det.research * det.support * det.mastery * det.msOwnSup);
      console.log(`    oven 1台あたり倍率: sim ${simPer.toExponential(4)} / 実機 ${gamePer.toExponential(4)}(個別${det.personal.toFixed(3)} 研究${det.research.toExponential(3)} 支援${det.support.toFixed(4)} 熟練${det.mastery.toFixed(3)} 実績${det.msOwnSup.toFixed(3)})`);
    }
    console.log(`    系列/初台(実機) ${gameDet.lineage.toExponential(2)}/${gameDet.presence.toExponential(2)} ・ タップ: 加算 ${simC.clickRaw.toExponential(3)}/${gameDet.clickRaw.toExponential(3)} ・ 銀行 ${simC.bankM.toFixed(3)}/${gameDet.bankM.toFixed(3)} ・ 素 ${simC.baseClick.toExponential(3)}/${gameDet.base.toExponential(3)} ・ 生産連動(実機) ${gameDet.prodLink.toExponential(3)}`);
    for (const k of Object.keys(simVals)) {
      const a = simVals[k], g = gameVals[k];
      if (!(a > 0) && !(g > 0)) { console.log(`  ${b.name}/${k}: 両方0(判定対象外)`); continue; }
      const ratio = a > 0 ? g / a : Infinity;
      const ok = Math.abs(ratio - 1) <= TOL;
      console.log(`  ${ok ? 'OK' : 'NG'} ${b.name}/${k}: sim ${a.toExponential(3)} / 実機 ${g.toExponential(3)} 比 ${ratio.toFixed(4)}`);
      if (!ok) bad.push(`${b.name}/${k} 比 ${ratio.toFixed(4)}`);
    }
  }
  console.log(`pageエラー ${errs.length}`);
  await b0.close();
  if (bad.length) { console.log(`効果式 parity NG ${bad.length}件:\n - ` + bad.join('\n - ')); process.exit(1); }
  console.log(`効果式 parity OK: 盤面${BOARDS.length}通り × 6量 すべて ±${TOL * 100}% 以内`);
})().catch(e => { console.error('FATAL ' + e.message); process.exit(1); });
