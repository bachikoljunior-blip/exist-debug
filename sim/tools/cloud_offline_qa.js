// 通信が遮断された環境で「クラウド保存にログイン」を押したときの案内を実機で確認する(2026-07-28)。
// 見つけ方の教訓もここに残す: 最初 DOM の click() で押して「無反応」に見えたが、ゲームのボタンは
// addTap(pointerdown/pointerup)で拾うので DOM click では発火しない=**判定器側の穴**だった。
// 実ポインタで押すとダイアログが出る。ここでは「offline なら理由が分かる文面か」を見る。
// 実行: node sim/tools/cloud_offline_qa.js
// Firebase(gstatic)が読めない状態で「Googleでログイン」を押したときの挙動を実機で見る
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const dialogs=[]; p.on('dialog',d=>{dialogs.push(d.message()); d.dismiss().catch(()=>{});});
  await p.route('**gstatic.com/**', r=>r.abort());
  await p.clock.install();
  await p.goto('file://' + require('path').resolve(__dirname,'../../index.html'),{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500);
  await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(600);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(1200);
  const before = await p.evaluate(()=>{ const e=document.getElementById('cloudSyncStatus'); return e?e.textContent.trim():'(なし)'; });
  // addTap は pointerdown/pointerup で拾うので、DOMの click() では発火しない(2026-07-28 実測)。
  await p.click('#settingsBtn').catch(async()=>{ await p.evaluate(()=>{ $('settingsOverlay').classList.add('active'); }); });
  await p.clock.runFor(500);
  await p.click('#cloudLoginBtn', {force:true}).catch(e=>console.log('click失敗:'+e.message));
  await p.clock.runFor(3000);
  const after = await p.evaluate(()=>{ const e=document.getElementById('cloudSyncStatus'); return e?e.textContent.trim():'(なし)'; });
  console.log('押す前:', before);
  console.log('押した後:', after);
  console.log('ダイアログ:', JSON.stringify(dialogs));
  const ok = dialogs.length === 1 && /ネットワーク/.test(dialogs[0]);
  console.log('pageerrors:', errs.length, errs.slice(0,2).join(' | '));
  console.log(ok ? 'OK: 遮断時に理由の分かる案内が出る' : 'NG: 遮断時の案内が出ない/文面が汎用のまま');
  if (!ok) process.exitCode = 1;
  await b.close();
})();
