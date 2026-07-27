// 工房ルールの高速確認: 転生→スキル(工房まで)→狩りで素材を集める→__workshopActions() が実際に何を作るか。
// 30分の通し走行を待たずに「装備も料理も作られない」原因を切り分けるための最短経路。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const p = await b.newPage({ viewport: { width: 430, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept().catch(() => {}));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html', { waitUntil: 'load', timeout: 60000 });
  await p.clock.runFor(1200);
  await p.click('#audioGate').catch(() => {});
  await p.clock.runFor(600);
  await p.click('#titleStartBtn').catch(() => {});
  await p.clock.runFor(800);
  const { installSkillPolicy } = require('/home/user/exist-debug/sim/tools/skill_policy.js');
  const { installWorkshopPolicy, installGatherPolicy } = require('/home/user/exist-debug/sim/tools/workshop_policy.js');
  await installSkillPolicy(p); await installWorkshopPolicy(p); await installGatherPolicy(p);
  // 転生してスキルを取る(工房まで届くのは pt_probe で実測済み)
  const sk = await p.evaluate(() => {
    state.runCookies = 1e11; state.cookies = D(1e11); state.prestigeUnlockedEver = true;
    prestigeReset();
    const got = window.__takeSkillsSmart();
    state.stageUnlocked = 2;
    try { state.stage = 2; if (typeof closeStageChoiceScreen === 'function') closeStageChoiceScreen();
      if (typeof beginRunAfterSkills === 'function' && state.awaitingSkillChoice) beginRunAfterSkills(); } catch (e) {}
    return { got, ws: workshopTabUnlocked(), craft: workshopCraftUnlocked() };
  });
  console.log(`スキル${sk.got.length}個 / 工房=${sk.ws} 作成=${sk.craft}`);
  // 素材集めの帰省: いまステージ2で、料理素材(バター/小麦粉)を1つも持っていない状態から
  const g0 = await p.evaluate(() => ({ gs: window.__gatherStage(), cur: currentStageNo(), revealed: DISHES.filter(dishRecipeRevealed).length }));
  console.log('帰省判断: 行き先=ステージ' + g0.gs + '(今=' + g0.cur + ' 開示済み料理=' + g0.revealed + ')');
  if (g0.gs > 0) { const to = await p.evaluate((n) => window.__travelStage(n), g0.gs); console.log('移動後の現ステージ=' + to); }
  // 少し設備を建てて火力を作り、狩って素材を集める
  await p.evaluate(() => { state.cookies = D(1e9); for (let i = 0; i < 40; i++) { try { buyUpgrade('grandma'); buyUpgrade('finger'); } catch (e) {} } });
  const rounds = Number(process.env.ROUNDS || 12);
  let made = [];
  for (let r = 0; r < rounds; r++) {
    // 湧きまで飛ばして倒す→報酬→素材アイコンを拾う
    const wait = await p.evaluate(() => {
      try { const w = (monsterSpawnPausedRemaining != null) ? monsterSpawnPausedRemaining : (monsterSpawnDeadline != null ? monsterSpawnDeadline - Date.now() : null);
        return (w == null || !isFinite(w)) ? 30000 : Math.max(0, Math.round(w)) + 900; } catch (e) { return 30000; }
    });
    await p.clock.runFor(Math.min(60000, wait));
    await p.evaluate(() => {
      if (typeof monsters !== 'undefined' && monsters && monsters.length && hitMonster) for (const m of monsters.slice()) for (let k = 0; k < 400 && monsters.indexOf(m) >= 0; k++) hitMonster(m.id);
      for (let n = 0; n < 8; n++) { if (!(rewardModalOpen && rewardModalOpen())) break; revealRewardChoices && revealRewardChoices();
        if (pendingRewardChoices && pendingRewardChoices.length) chooseReward(pendingRewardChoices[0]); else break; }
      for (const el of document.querySelectorAll('.matDrop')) { try { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); } catch (e) {} }
    });
    await p.clock.runFor(8000); // 自動回収ぶんも進める
    const acts = await p.evaluate(() => window.__workshopActions());
    for (const a of acts) made.push(a[0]);
  }
  const fin = await p.evaluate(() => {
    const mats = {}; for (const k in (state.materials || {})) if (state.materials[k] > 0) mats[k] = state.materials[k];
    const seen = Object.keys(state.materialsSeen || {}).filter(k => state.materialsSeen[k]);
    const dishes = DISHES.map(d => d.id + (dishRecipeRevealed(d) ? ':開示' : ':未') + (dishActive(d.id) ? '(効果中)' : ''));
    let craftable = [], afford = 0, stageOk = 0;
    for (const it of equip2Items()) { const a = equip2Afford(it), c = equip2CraftableNow(it); if (a) afford++; if (c) stageOk++; if (a && c) craftable.push(it.name); }
    return { mats, seen, dishes, craftableCount: craftable.length, craftableSample: craftable.slice(0, 5), afford, stageOk,
      owned: Object.keys(state.eq2Owned || {}).filter(k => state.eq2Owned[k] > 0), equipped: state.eq2Equipped,
      kills: state.monstersDefeated || 0, craftedThisRun: state.eq2CraftTotalThisRun || 0 };
  });
  console.log('作った行動: ' + (made.length ? made.join(' / ') : '(なし)'));
  console.log('討伐=' + fin.kills + ' 所持素材=' + JSON.stringify(fin.mats));
  console.log('見た素材=' + fin.seen.join(','));
  console.log('料理の開示: ' + fin.dishes.join(' '));
  console.log('装備: 素材足りる=' + fin.afford + ' ステージ条件OK=' + fin.stageOk + ' 両方=' + fin.craftableCount + ' 例=' + fin.craftableSample.join(','));
  console.log('所持装備=' + fin.owned.length + ' 装着=' + JSON.stringify(fin.equipped) + ' 周回作成数=' + fin.craftedThisRun);
  console.log('pageerrors=' + errs.length + (errs.length ? ' ' + errs.slice(0, 2).join(' | ') : ''));
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
