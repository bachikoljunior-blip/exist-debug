// 面白さ監査 F1-F4: 会心が到達域の序盤で実際に発火し視認できるか。指先の型+強い指を用意しタップ→
// 会心率/コンボ表示(#critCombo)/フィーバー発火/会心フロート を実測。console監視。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,80)));
  p.on('console',m=>{if(m.type()==='error'&&!/ERR_TUNNEL|firebase|gstatic/i.test(m.text()))errs.push('con:'+m.text().slice(0,70));});
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html',{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500); await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  // 到達域の妥当な状態: 強い指を少し(会心率は√強い指で上がる)+指先の型研究
  const setup=await p.evaluate(()=>{
    state.cookies=D(1e12); state.runCookies=D(1e12);
    for(let i=0;i<60;i++)buyUpgrade('finger'); // 強い指60台=会心率が乗る
    // 指先の型(会心解禁)を研究
    let boughtRes=false; try{ if(state.cookies.gte(D(2500))){ buyResearch('fingerTechnique'); boughtRes=!!state.research.fingerTechnique; } }catch(e){}
    return {fingers:state.upgrades.finger||0, fingerTech:boughtRes, critRateFn:(typeof critChance==='function')};
  });
  // タップして会心を観測(1刻みで丁寧に=フロート/コンボが出る)
  const obs=await p.evaluate(async()=>{
    let crits=0, taps=0, maxCombo=0, feverFired=false, comboVisibleEver=false, critFloatsEver=0;
    const before={};
    for(let i=0;i<400;i++){ const b4=state.critCombo||0;
      tapCookie(); taps++;
      const combo=state.critCombo||0;
      if(combo>b4) crits++; // コンボが増えた=会心
      if(combo>maxCombo)maxCombo=combo;
      if(typeof feverActive==='function'&&feverActive())feverFired=true;
      const cc=document.getElementById('critCombo');
      if(cc&&cc.style.display!=='none')comboVisibleEver=true;
      const floats=document.querySelectorAll('.critFloat').length; if(floats>critFloatsEver)critFloatsEver=floats;
    }
    return {taps, crits, critRate:(crits/taps*100).toFixed(1)+'%', maxCombo, feverFired, comboVisibleEver, critFloatsSeen:critFloatsEver,
      critChanceNow:(typeof critChance==='function'?(critChance()*100).toFixed(1)+'%':'?'), FEVER_COMBO:(typeof FEVER_COMBO!=='undefined'?FEVER_COMBO:'?')};
  });
  console.log('setup:',JSON.stringify(setup));
  console.log('観測:',JSON.stringify(obs));
  console.log('errs:',errs.length, errs.slice(0,3).join(' | '));
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
