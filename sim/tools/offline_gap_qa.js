// 「閉じている間の収入」と「開いている間の収入」の差を実機で測る(2026-07-27)。
//
// なぜ測るか: ゲームの放置生産は `grantIdleProduction` = `baseCps()×秒`(上限8時間・終わらぬ焼窯で無制限)で、
// **直送収入(directIncomeTotalCps)を含まない**。この経済では直送が総収入のほぼ全部を占める段があるので、
// 「閉じている間はほぼ0」になり得る。まず段ごとに何倍開くのかを数字にする(仕様を決めるのは数字を見た後)。
// sim は離席を模型化していない=承認済み経済の外なので、ここは**ゲーム単独の設計判断**になる。
//
// 実行: node sim/tools/offline_gap_qa.js
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const INDEX = process.env.GAME_INDEX || path.join(ROOT, 'index.html');

// effect_parity_qa と同じ盤面(揃えておけば数字を並べて読める)
const BOARDS = [
  { name: '序盤', ups: { finger: 20, grandma: 15, oven: 30 }, res: ['ovenBatch', 'grandmaCrowd'], stages: [], perks: {}, layer: 3, runs: 0, cookies: 1e7 },
  { name: '中盤', ups: { finger: 66, grandma: 45, oven: 140, factory: 106, bank: 24, spiceRack: 58, portal: 45 },
    res: ['ovenBatch', 'grandmaCrowd', 'factoryNetwork', 'spiceBlend', 'portalNetwork', 'bankClickDividend', 'fingerTechnique'],
    stages: ['ovenBatch'], perks: { goldenRate: 4, goldenPower: 3, goldenAmount: 5 }, layer: 9, runs: 1, cookies: 2.5e9 },
  { name: '直送フル', ups: { finger: 80, grandma: 60, oven: 200, factory: 150, bank: 60, spiceRack: 90, portal: 70 },
    res: ['ovenBatch', 'grandmaCrowd', 'factoryNetwork', 'spiceBlend', 'portalNetwork', 'bankClickDividend', 'fingerTechnique'],
    stages: ['ovenBatch', 'spiceBlend', 'portalNetwork', 'fingerTechnique'],
    perks: { goldenRate: 12, goldenPower: 10, goldenAmount: 14, monsterRate: 9, monsterDamage: 11, goldenChain: 5, huntingCore: 3 }, layer: 22, runs: 3, cookies: 4e14 }
];

(async () => {
  const b0 = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', headless: true });
  const p = await b0.newPage({ viewport: { width: 430, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install();
  await p.goto('file://' + INDEX, { waitUntil: 'load', timeout: 60000 });
  await p.clock.runFor(1200);
  await p.click('#audioGate').catch(() => {}); await p.clock.runFor(600);
  await p.click('#titleStartBtn').catch(() => {}); await p.clock.runFor(800);

  for (const b of BOARDS) {
    const r = await p.evaluate((b) => {
      for (const u of UPGRADES) state.upgrades[u.id] = b.ups[u.id] || 0;
      for (const rr of RESEARCH) state.research[rr.id] = b.res.includes(rr.id);
      state.researchStages = {};
      for (const id of b.stages) state.researchStages[id] = 2;
      for (const k in state.perks) state.perks[k] = b.perks[k] || 0;
      // 段階2のゲートスキルも入れる(段階が効くにはスキル所持が要る)
      for (const id of b.stages) { const sk = RES_STAGE2[id]; if (sk) state.skills[sk] = true; }
      state.maxQuotaStage = b.layer; state.maxQuotaStageEver = b.layer;
      state.prestigeRuns = b.runs; state.cookies = D(b.cookies); state.runStart = Date.now() - 1800 * 1000;
      const n = x => Number(String(x));
      const base = n(baseCps()), cur = n(currentCps()), dir = n(directIncomeTotalCps());
      return { base, cur, dir, online: cur + dir, offline8h: base * 28800, online8h: (cur + dir) * 28800 };
    }, b);
    const gap = r.online / Math.max(1e-300, r.base);
    console.log(`${b.name}: 開いている間 ${r.online.toExponential(3)}/秒(毎秒${r.cur.toExponential(2)}+直送${r.dir.toExponential(2)})`);
    console.log(`  閉じている間 ${r.base.toExponential(3)}/秒(=baseCps。直送を含まない) → **開/閉 = ${gap.toFixed(2)}倍**`);
    console.log(`  8時間ぶん: 閉 ${r.offline8h.toExponential(3)} / 開 ${r.online8h.toExponential(3)}`);
  }
  console.log(`pageエラー ${errs.length}`);
  await b0.close();
})().catch(e => { console.error('FATAL ' + e.message); process.exit(1); });
