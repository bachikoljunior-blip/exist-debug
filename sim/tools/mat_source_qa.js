// 素材庫の「入手:」行の実機確認: 素材を見た状態にして工房タブを開き、はみ出し/文言/エラーを見る。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const p = await b.newPage({ viewport: { width: 430, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html', { waitUntil: 'load', timeout: 60000 });
  await p.clock.runFor(1200);
  await p.click('#audioGate').catch(() => {});
  await p.clock.runFor(600);
  await p.click('#titleStartBtn').catch(() => {});
  await p.clock.runFor(800);
  const r = await p.evaluate(() => {
    state.skills = state.skills || {}; state.skills.workshop_1 = true; state.skills.workshop_2 = true;
    const ids = ['ore_t1', 'ore_t3', 'butter', 'flour', 'cacao', 'lavaSugar', 'ironShard', 'goldDust', 'omniFlour', 'bossCore2', 'deepCore', 'voidSugar', 'stardust', 'silentCore', 'cometShard', 'frostSugar', 'mint', 'spice'];
    for (const id of ids) { state.materials[id] = 7; state.materialsSeen[id] = true; }
    equip2SubTab = 'mats';
    try { openEquip(); } catch (e) {}
    try { renderEquip2Tab(); } catch (e) {}
    const texts = ids.map(id => id + ' → ' + matSourceText(id));
    return { texts };
  });
  await p.clock.runFor(600);
  console.log(r.texts.join('\n'));
  const ov = await p.evaluate(() => ({
    wide: [...document.querySelectorAll('.matSource')].filter(e => e.scrollWidth > e.clientWidth + 2).length,
    rows: document.querySelectorAll('.matSource').length,
    bodyOver: document.body.scrollWidth > window.innerWidth + 1
  }));
  console.log('matSource行=' + ov.rows + ' 横はみ出し=' + ov.wide + ' body横スクロール=' + ov.bodyOver);
  await p.screenshot({ path: process.env.SHOT || '/tmp/mat_source.jpg', type: 'jpeg', quality: 62, fullPage: false });
  console.log('pageerrors=' + errs.length + (errs.length ? ' ' + errs.slice(0, 2).join(' | ') : ''));
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
