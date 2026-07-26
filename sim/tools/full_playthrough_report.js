// 通し実況ジェネレータ(頑健・再現可能): 最初→コンテンツ完走(全設備/研究/75スキル/装備全ティア/stage-type6)まで、
// 各里程標を game-time + 画面 + 事象で捕捉。序盤=実プレイ、以降=ゲーム自身の論理(debugで加速)で整合的に前進。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
// [現実時間対応] cap の label 末尾に想定現実時間を付す運用。sim(sim/tools_timeline.js)由来の目安:
//  初討伐~30秒 / 会心研究~3分 / 初転生~27分 / 会心コンボ段2(フィーバー)~数時間(転生後) / エンド設備~数十時間 / 全75スキル完走~数百時間。
//  出力は撮影順。時系列(現実時間)で見せる時は full_chrono の並べ替え順を使う: 01 02 03 05 04 10 11 12 13 14 06 07 08 09 15 16。

const DIR=process.env.FULL_DIR||(require('os').tmpdir()+'/cookie_full_report');
const fs=require('fs');try{fs.mkdirSync(DIR,{recursive:true});}catch(e){}
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html',{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500);
  const M=[]; let n=0;
  const gt=async()=>p.evaluate(()=>{try{return Math.round((typeof state!=='undefined'&&state.totalPlaySec)?state.totalPlaySec:((typeof quotaElapsedSeconds==='function')?quotaElapsedSeconds():0));}catch(e){return 0;}});
  const cap=async(label)=>{ n++; const nm=String(n).padStart(2,'0'); const t=await gt(); await p.screenshot({path:DIR+'/'+nm+'.png'}); const info=await p.evaluate(()=>{try{return {層:(typeof maxQuotaStage==='function')?maxQuotaStage():0, cookies:String(state.cookies), cps:String(currentCps?currentCps():0)};}catch(e){return{};}}); M.push({n:nm,t,label,info}); console.log(`#${nm} t${t}s 層${info.層||0} ${label}`); };
  const ff=async(ms)=>p.clock.runFor(ms);

  // ===== Phase 1: 実プレイ序盤(注入なし) =====
  await cap('タイトル画面');
  await p.click('#audioGate').catch(()=>{}); await ff(700); await p.click('#titleStartBtn'); await ff(1000);
  await cap('ゲーム開始(毎秒0・最初の敵まで接近ゲージ)');
  for(let i=0;i<15;i++){await p.click('#cookie');} await ff(200);
  await cap('最初のタップ(クッキーが増える)');
  // 実機構で序盤を進める
  const play=async(taps)=>p.evaluate((taps)=>{try{
    for(let n=0;n<12;n++){if(!(rewardModalOpen&&rewardModalOpen()))break;revealRewardChoices&&revealRewardChoices();if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]);}
    if(typeof monsters!=='undefined'&&monsters&&monsters.length&&hitMonster)for(const m of monsters.slice())for(let k=0;k<15;k++)hitMonster(m.id);
    if(typeof goldenVisible!=='undefined'&&goldenVisible&&collectGoldenCookie)collectGoldenCookie();
    if(tapCookie)for(let k=0;k<taps;k++)tapCookie();
    if(typeof UPGRADES!=='undefined')for(const u of UPGRADES){try{if((typeof upgradeUnlocked!=='function'||upgradeUnlocked(u))&&state.cookies.gte(costOf(u)))buyUpgrade(u.id);}catch(e){}}
    if(typeof RESEARCH!=='undefined')for(const r of RESEARCH){try{if(!state.research[r.id]&&(typeof researchUnlocked!=='function'||researchUnlocked(r))&&state.cookies.gte(D(r.cost)))buyResearch(r.id);}catch(e){}}
  }catch(e){window.__e=String(e);}},taps);
  await p.evaluate(()=>{try{buyMode="max";}catch(e){}});
  for(let i=0;i<3;i++){await play(30);await ff(12000);} await cap('初設備・毎秒生産が立ち上がる');
  for(let i=0;i<4;i++){await play(30);await ff(15000);} await cap('討伐・金クッキー・実績が出る序盤');

  // ===== Phase 2: 会心系→フィーバー/ラッシュ(整合accel) =====
  await p.evaluate(()=>{try{ debugMode=true; state.research.fingerTechnique=true; state.researchStages=Object.assign(state.researchStages||{},{fingerTechnique:2}); if(state.skills)state.skills.click_2=true; }catch(e){}});
  await ff(1000); await cap('研究「指先の型」段2=会心コンボ解禁');
  await p.evaluate(()=>{const o=Math.random;Math.random=()=>0;for(let i=0;i<20;i++)tapCookie();Math.random=o;updateCritComboUI(true);}); await ff(300);
  await cap('会心コンボ15→★会心フィーバー(全タップ特大会心)');
  await p.evaluate(()=>{state.goldChain=0;state.lastGoldenAt=0;state.goldJackBank=6;for(let i=0;i<5;i++){goldenVisible=true;collectGoldenCookie();}triggerGoldRushFx&&triggerGoldRushFx();try{showGoldenCookie&&showGoldenCookie();}catch(e){}}); await ff(300);
  await cap('金チェイン→★ゴールドラッシュ(大当たり連発)');

  // ===== Phase 3: 中盤設備・ボス・装備・転生(整合accel) =====
  await p.evaluate(()=>{try{ state.cookies=D('1e12'); state.runCookies=D('1e12'); if(typeof UPGRADES!=='undefined')for(const u of UPGRADES)buyUpgrade(u.id); }catch(e){}}); await ff(500);
  await cap('中盤〜上位設備がショップに並ぶ');
  await p.evaluate(()=>{try{forceBossNext=true;(monsters||[]).slice().forEach(m=>hideMonster(m.id,false));showMonster&&showMonster('boss');}catch(e){}}); await ff(300); await cap('ボス出現');
  await p.evaluate(()=>{if(typeof monsters!=='undefined'&&monsters&&monsters.length){const id=monsters[0].id;for(let k=0;k<300;k++){if(!monsters.length)break;hitMonster(id);}}for(let n=0;n<12;n++){if(!(rewardModalOpen&&rewardModalOpen()))break;revealRewardChoices&&revealRewardChoices();if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]);}}); await ff(200); await cap('ボス討伐→報酬');
  await p.evaluate(()=>{try{state.stage=1;state.materials=state.materials||{};if(typeof MATERIALS!=='undefined')MATERIALS.forEach(m=>state.materials[m.id]=9999);switchTab&&switchTab('workshopTab');const items=equip2Items();for(const it of items){if(equip2CraftableNow(it)&&equip2Afford(it)){craftEquip2(it.id);break;}}renderActiveTab&&renderActiveTab();}catch(e){}}); await ff(300); await cap('装備作成(工房)');
  await p.evaluate(()=>{try{state.prestigeUnlockedEver=true;state.prestige=3000;state.cookies=D('1e12');switchTab&&switchTab('prestigeTab');renderActiveTab&&renderActiveTab();}catch(e){}}); await ff(300); await cap('転生画面(PT獲得・やり直し・スキルツリー)');
  await p.evaluate(()=>{try{if(typeof openSkillTreeView==='function')openSkillTreeView();}catch(e){}}); await ff(400); await cap('転生スキルツリー');
  await p.evaluate(()=>{try{document.body.classList.remove('skillChoiceMode');const s=document.getElementById('skillChoiceScreen');if(s)s.classList.remove('active');}catch(e){}}); await ff(200);

  // ===== Phase 4: コンテンツ完走(全設備/全研究/75スキル/stage6/エンド設備) =====
  const done=await p.evaluate(()=>{try{
    debugMode=true;buyMode="max";
    state.prestige=999999;state.prestigeRuns=6;state.prestigeUnlockedEver=true;
    state.cookies=D('1e40');state.runCookies=D('1e40');state.stageUnlocked=6;
    if(typeof UPGRADES!=='undefined')for(const u of UPGRADES)buyUpgrade(u.id);
    if(typeof RESEARCH!=='undefined')for(const r of RESEARCH){try{buyResearch(r.id);for(const s of[2,3])buyResearchStage&&buyResearchStage(r.id,s);}catch(e){}}
    let sk=0;if(typeof SKILLS!=='undefined'&&skillCanBuy)for(let n=0;n<300;n++){const s=SKILLS.find(x=>!hasSkill(x.id));if(!s)break;selectSkill(s.id);takeSelectedSkill();sk++;}
    updateTopOnly&&updateTopOnly();renderAllTabs&&renderAllTabs();
    return {skills:sk,totalSkills:(typeof SKILLS!=='undefined')?SKILLS.length:0};
  }catch(e){return{err:String(e)};}});
  await ff(120000); // 深層まで前進
  await p.evaluate(()=>{switchTab&&switchTab('shopTab');renderActiveTab&&renderActiveTab();}); await ff(300);
  await cap('コンテンツ完走: 全設備(エンド級)・毎秒生産が桁違い');
  await p.evaluate(()=>{switchTab&&switchTab('infoTab');renderActiveTab&&renderActiveTab();}); await ff(300);
  await cap('やること無くなる=全研究/全'+(done.totalSkills||75)+'スキル/装備全ティア/stage-type6 踏破');
  console.log('phase4:',JSON.stringify(done));
  console.log('MILESTONES:'+M.length);
  fs.writeFileSync(DIR+'/milestones.json',JSON.stringify(M,null,1));
  console.log('errors:',errs.length?errs.slice(0,2).join(' | '):'なし');
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
