// 面白さF12: 最小タップ床=ワンパン虚無が無い。高火力でも通常4/戦車8/ボス16タップ要るか。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,80)));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html',{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500); await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  const R=await p.evaluate(()=>{
    debugMode=true; state.cookies=D('1e40'); state.runCookies=D('1e40'); state.stageUnlocked=6;
    // 火力を極大に(ワンパンしたくなる状況を作る)
    for(const u of UPGRADES){if(u.type==='click')state.upgrades[u.id]=500;}
    state.perks=state.perks||{}; state.perks.monsterDamage=200; state.perks.crackedFang=100;
    const out={};
    for(const type of ['normal','tank','boss']){
      try{
        // 既存を除去
        if(typeof monsters!=='undefined'&&monsters)for(const m of monsters.slice()){for(let z=0;z<50&&monsters.indexOf(m)>=0;z++)hitMonster(m.id);}
        showMonster(type);
        const m=monsters[monsters.length-1];
        if(!m){out[type]='no spawn';continue;}
        const id=m.id; let taps=0;
        while(monsters.indexOf(m)>=0 && taps<200){ hitMonster(id); taps++; }
        out[type]={tapsToKill:taps, hp:m.maxHp?Number(String(m.maxHp)):'?'};
      }catch(e){out[type]='ERR:'+e.message.slice(0,50);}
    }
    return out;
  });
  console.log('最小タップ床(高火力): '+JSON.stringify(R));
  console.log('期待: normal≥4 tank≥8 boss≥16(ワンパン虚無が無い) | errs:',errs.length);
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
