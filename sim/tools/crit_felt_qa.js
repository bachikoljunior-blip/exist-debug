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
    // 会心コンボ/フィーバーは「指先の型 段2」の機能。段2が無い状態でコンボを数えても常に0=
    // 旧実装はそれを「会心0回」と報告していた(判定器の欠陥・2026-07-26 修正)。段2を立てて測る。
    // 段2の条件は「研究段2の購入」+「解放スキル(RES_STAGE2.fingerTechnique='click_2')の所持」の両方
    state.researchStages = state.researchStages || {}; state.researchStages.fingerTechnique = 2;
    state.skills = state.skills || {}; state.skills[RES_STAGE2.fingerTechnique] = true;
    return {fingers:state.upgrades.finger||0, fingerTech:boughtRes, stage2:(typeof resStage2==='function'?resStage2('fingerTechnique'):null),
      critChanceFn:(typeof fingerCritChance==='function'),
      critChance:(typeof fingerCritChance==='function'?(fingerCritChance()*100).toFixed(2)+'%':'?')};
  });
  // タップして会心を観測(1刻みで丁寧に=フロート/コンボが出る)
  const obs=await p.evaluate(async()=>{
    let crits=0, taps=0, maxCombo=0, feverFired=false, comboVisibleEver=false, critFloatsEver=0;
    // 会心の直接計測: drawSuperCrit は tapCookie の会心分岐でだけ呼ばれる(段の有無に依らない)ので包んで数える。
    // ・旧実装のコンボ増分プロキシは段2依存=段2が無いと常に0(会心15回を「0回」と報告していた)
    // ・fingerCritMultiplier はROI計算(clickEV)からも呼ばれるので数えると過大(400タップで410回)
    const origDraw=window.drawSuperCrit;
    window.drawSuperCrit=function(){ crits++; return origDraw.apply(this,arguments); };
    for(let i=0;i<400;i++){
      tapCookie(); taps++;
      const combo=state.critCombo||0;
      if(combo>maxCombo)maxCombo=combo;
      if(typeof feverActive==='function'&&feverActive())feverFired=true;
      const cc=document.getElementById('critCombo');
      if(cc&&cc.style.display!=='none')comboVisibleEver=true;
      const floats=document.querySelectorAll('.critFloat').length; if(floats>critFloatsEver)critFloatsEver=floats;
    }
    window.drawSuperCrit=origDraw;
    return {taps, crits, critRate:(crits/taps*100).toFixed(1)+'%', maxCombo, feverFired, comboVisibleEver, critFloatsSeen:critFloatsEver,
      critChanceNow:(typeof fingerCritChance==='function'?(fingerCritChance()*100).toFixed(2)+'%':'?'), FEVER_COMBO:(typeof FEVER_COMBO!=='undefined'?FEVER_COMBO:'?')};
  });
  console.log('setup:',JSON.stringify(setup));
  console.log('観測(強い指60=会心率2.9%):',JSON.stringify(obs));

  // 第2相: フィーバーが「実際に点火する状態」があることまで見る(点火しない結果だけでは
  // 機構が生きているのか死んでいるのか区別できない=判定の検出力が無い・2026-07-26 追加)。
  // 会心率が育った盤面(強い指2000台)で、100msずつ実時間を進めながらタップ=30秒の途切れ判定も効かせる。
  // 2回目の観測はクールダウンも戻す(2026-07-28 修正): 1回目の点火で critFeverCooldownUntil=+45秒 が残り、
  // この観測窓(400タップ×100ms=40秒)では点火できない=「機構が死んでいる」ように見えていた(判定器の穴)。
  await p.evaluate(()=>{ state.cookies=D('1e30'); state.critCombo=0; state.critFeverUntil=0; state.critFeverCooldownUntil=0; state.superBank=0;
    for(let i=0;i<2000;i++)buyUpgrade('finger'); });
  const rate2=await p.evaluate(()=>(fingerCritChance()*100).toFixed(1)+'%');
  await p.evaluate(()=>{ window.__crits=0; const o=window.drawSuperCrit;
    window.__origDraw=o; window.drawSuperCrit=function(){window.__crits++;return o.apply(this,arguments);}; });
  let feverSeen=false, maxCombo2=0;
  for(let i=0;i<400;i++){
    await p.evaluate(()=>tapCookie());
    await p.clock.runFor(100);
    const st=await p.evaluate(()=>({f:(typeof feverActive==='function')?feverActive():null, c:state.critCombo||0}));
    if(st.f)feverSeen=true; if(st.c>maxCombo2)maxCombo2=st.c;
    if(feverSeen && i>20) break;
  }
  const obs2=await p.evaluate(()=>{ const c=window.__crits; window.drawSuperCrit=window.__origDraw; return c; });
  console.log('観測(強い指2060=会心率'+rate2+'):',JSON.stringify({crits:obs2, maxCombo:maxCombo2, feverFired:feverSeen, FEVER_COMBO:15}),
    '(期待 feverFired=true=点火機構が生きている)');
  console.log('errs:',errs.length, errs.slice(0,3).join(' | '));
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
