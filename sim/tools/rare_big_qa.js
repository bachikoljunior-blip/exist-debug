// 面白さF9/F27: ユーザー最愛「稀で特大」= 金大当たり(jackpot)+超会心 が 稀に・特大に 出るか実測。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html',{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500); await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  const R=await p.evaluate(()=>{
    debugMode=true; state.cookies=D('1e18'); state.runCookies=D('1e18');
    for(const u of UPGRADES)state.upgrades[u.id]=100;
    // 金クッキー: instant金を沢山引いて jackpot率と倍率を測る
    let goldN=0, jack=0, gains=[], jackGains=[];
    for(let i=0;i<800;i++){
      if(typeof drawGoldenJackpot==='function'){ const j=drawGoldenJackpot(); const mul=j?(typeof GOLDEN_JACKPOT_K!=='undefined'?GOLDEN_JACKPOT_K:'?'):(typeof GOLDEN_JACKPOT_M!=='undefined'?GOLDEN_JACKPOT_M:'?');
        goldN++; if(j){jack++; jackGains.push(mul);} else gains.push(mul); }
    }
    // 超会心: 会心のうち超会心の率(SUPER_CRIT系)
    const superInfo={ P:(typeof SUPER_CRIT_P!=='undefined'?SUPER_CRIT_P:(typeof SUPERCRIT_P!=='undefined'?SUPERCRIT_P:'?')),
                      K:(typeof SUPER_CRIT_K!=='undefined'?SUPER_CRIT_K:(typeof SUPERCRIT_MUL!=='undefined'?SUPERCRIT_MUL:'?')) };
    return { goldN, jackRate:(jack/goldN*100).toFixed(1)+'%', jackMul:jackGains[0], normalMul:gains[0],
      jackpotConst:{K:(typeof GOLDEN_JACKPOT_K!=='undefined'?GOLDEN_JACKPOT_K:'?'), M:(typeof GOLDEN_JACKPOT_M!=='undefined'?GOLDEN_JACKPOT_M:'?'), P:(typeof GOLDEN_JACKPOT_P!=='undefined'?GOLDEN_JACKPOT_P:'?')},
      superCrit:superInfo };
  });
  console.log('金大当たり(jackpot): 率='+R.jackRate+' (n='+R.goldN+') 大当たり倍率='+R.jackMul+' vs 通常='+R.normalMul);
  console.log('jackpot定数:',JSON.stringify(R.jackpotConst));
  console.log('超会心定数:',JSON.stringify(R.superCrit));
  console.log('期待: jackpotは稀(数%)で倍率K≫通常M=「稀で特大」/ 超会心も低率×特大');
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
