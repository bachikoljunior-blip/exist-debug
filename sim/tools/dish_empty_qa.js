// 料理セクションが空のときの案内文の実機確認(工房は開いているが素材が無い状態)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const p = await b.newPage({ viewport: { width: 430, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html', { waitUntil: 'load', timeout: 60000 });
  await p.clock.runFor(1200); await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(600);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  const r = await p.evaluate(() => {
    state.skills = state.skills || {}; state.skills.workshop_1 = true;
    state.wsSubTab = 'dish'; activeTab = 'workshopTab';
    try { switchTab('workshopTab'); } catch (e) {}
    try { renderWorkshop(); } catch (e) {}
    const box = document.getElementById('workshopPanel');
    return { text: box ? box.textContent.replace(/\s+/g,' ').trim().slice(0, 400) : '(パネル無し)',
      over: box ? [...box.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+2).length : -1 };
  });
  await p.clock.runFor(400);
  console.log(r.text); console.log('はみ出し要素=' + r.over + ' pageerrors=' + errs.length);
  await p.screenshot({ path: process.env.SHOT || '/tmp/dish_empty.jpg', type: 'jpeg', quality: 62 });
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
