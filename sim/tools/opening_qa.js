// 「始めて最初の3分」が壊れていないかを実機で測る恒久検問(2026-07-28 新設)。
// 見るもの: 初購入までの秒数 / 初モンスター・初討伐 / 60・120・180秒の所持と設備台数。
// 作る過程で自分の測り方の穴を2つ踏んだので、同じ穴に落ちないよう形を固定してある:
//   ①タップを討伐に振り替えていた → クッキーのタップは湧いていても通る(実測)。両方叩く。
//   ②討伐後の報酬カードを選ばず放置していた → 選ぶまで進行が止まる(仕様)。毎回選ぶ。
// 判定: 初購入が180秒以内・180秒で設備≥3台・pageエラー0。
// 新経済(2026-07-27〜28の移植後)で「始めて最初の3分」が壊れていないかを実機で測る。
// 見るもの: 初購入までの秒数 / 3分時点の所持・毎秒 / 初討伐・初金クッキー・初研究の有無。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.clock.install();
  await p.goto('file://'+(process.env.GAME_INDEX||'/home/user/exist-debug/index.html'),{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500);
  await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(600);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  const marks={};
  for(let sec=1; sec<=180; sec++){
    // 実測(2026-07-28): モンスターが出ていてもクッキーのタップは通る。初心者はクッキーを叩きつつ、
    // 湧いた敵も叩く。両方やる形にする(前版は討伐に振り替えていて「増えない」ように見えた=測り方の穴)。
    const hadMon = await p.evaluate(()=>{
      for(let i=0;i<3;i++) tapCookie();
      const on = (typeof monsters!=='undefined' && monsters.length>0);
      if(on) for(const m of monsters.slice()) for(let k=0;k<3;k++) hitMonster(m.id);
      // 討伐すると報酬カードの選択が開き、選ぶまで進行が止まる(仕様)。初心者も選ぶので選ぶ。
      for(let n=0;n<6;n++){ if(!(rewardModalOpen&&rewardModalOpen()))break;
        revealRewardChoices&&revealRewardChoices();
        if(pendingRewardChoices&&pendingRewardChoices.length) chooseReward(pendingRewardChoices[0]); else break; }
      return on ? 1 : 0;
    });
    marks.monSec = (marks.monSec||0) + hadMon;
    await p.clock.runFor(1000);
    const st=await p.evaluate(()=>({
      cookies:Number(String(state.cookies)), cps:Number(String(currentCps())),
      ups:Object.values(state.upgrades||{}).reduce((a,b)=>a+b,0),
      kills:state.monstersDefeated||0, res:Object.keys(state.research||{}).filter(k=>state.research[k]).length,
      goldSeen:(state.goldenTaken||0), mon:(typeof monsters!=='undefined'&&monsters.length)?1:0 }));
    // 買えるものがあれば1つ買う(初心者らしく最安を1つずつ)
    await p.evaluate(()=>{ try{ const c=UPGRADES.filter(u=>upgradeUnlocked(u)&&state.cookies.gte(costOf(u)))
      .sort((a,b)=>Number(String(costOf(a)))-Number(String(costOf(b)))); if(c[0])buyUpgrade(c[0].id); }catch(e){} });
    if(!marks.firstBuy && st.ups>0) marks.firstBuy=sec;
    if(!marks.firstMonster && st.mon) marks.firstMonster=sec;
    if(!marks.firstKill && st.kills>0) marks.firstKill=sec;
    if(!marks.firstRes && st.res>0) marks.firstRes=sec;
    if(sec===120) marks.at120={cookies:st.cookies, ups:st.ups};
    if(sec===60) marks.at60={cookies:st.cookies, cps:st.cps, ups:st.ups};
    if(sec===180) marks.at180={cookies:st.cookies, cps:st.cps, ups:st.ups, kills:st.kills};
    // モンスターが出ていたら叩く(初心者もタップはする)

  }
  console.log(JSON.stringify(marks,null,1));
  console.log('pageerrors:',errs.length, errs.slice(0,2).join(' | '));
  const ok = marks.firstBuy && marks.firstBuy <= 180 && marks.at180 && marks.at180.ups >= 3 && errs.length === 0;
  console.log(ok ? 'OK: 序盤の輪が回っている(初購入' + marks.firstBuy + '秒・180秒で' + marks.at180.ups + '台)'
                 : 'NG: 序盤が止まっている');
  if (!ok) process.exitCode = 1;
  await b.close();
})();
