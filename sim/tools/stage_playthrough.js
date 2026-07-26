// 実プレイ実況(ステージ進行版・一般的な人間プレイヤー):
//   最初→タップ/設備→初討伐→初転生→スキル→[バンク→討伐→転生]の周回ループでステージを本物到達。
//   ・バンク=ゲーム自身のoffline式 earn(baseCps×秒) を直呼び(=「遊ぶ→離れて戻る」の放置生産・reload不要で激安)。
//   ・討伐=実タイマーのモンスター出現を fastForward(~50s刻み)で発火させ hitMonster で倒す(=cadence/quotaは本物のまま)。
//   ・転生前に「転生できるまで放置」を offline式で忠実に補填(balance>=prestigeCookieCost)=quota時計をreset。
//   questKills は転生持ち越し(ゲーム仕様)なので、周回を重ねると累計討伐がクエスト100体に届きステージ2+へ。偽加速なし。
//   各操作を発生順に記録(連続同操作まとめ・画像は最後の場面・累積現実プレイ時間+回数)。native 430x780。
// 実行: OUT=/out node sim/tools/stage_playthrough.js → 001.jpg.. + ops.json
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path=require('path'), os=require('os'), fs=require('fs');
const now=()=>Number(require('process').hrtime.bigint())/1e6;
const INDEX=process.env.GAME_INDEX||path.resolve(__dirname,'../../index.html');
const DIR=process.env.OUT||path.join(os.tmpdir(),'stage_playthrough');
const TARGET_STAGE=Number(process.env.TARGET_STAGE||2);
const FF_STEP=Number(process.env.FF_STEP||50000); // 討伐fastForward刻み(粗くすると速いが粒度が落ちる)。速度改善ループで調整。
const HUNT_STEPS=Math.max(30,Math.round(110*50000/FF_STEP)); // 総game-timeを一定に保つ
const WALLCAP=Number(process.env.WALLCAP||600)*1000;
const MAXBLK=Number(process.env.MAXBLK||220);
try{fs.mkdirSync(DIR,{recursive:true});}catch(e){}
(async()=>{
  const b=await chromium.launch({executablePath:process.env.PW_CHROMIUM||'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  // 批判監査F1: pageerrorだけでなく console.error/warning/requestfailed も監視(旧QAは見逃していた)。
  const errs=[]; const consoleIssues=[];
  p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
  p.on('console',m=>{const t=m.type();if(t==='error'||t==='warning')consoleIssues.push(t+': '+m.text().slice(0,140));});
  p.on('requestfailed',r=>consoleIssues.push('reqfail: '+r.url().slice(0,90)));
  await p.clock.install();
  await p.goto('file://'+INDEX,{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500);
  await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  await p.evaluate(()=>{buyMode="max";});

  const L=[]; let shotN=0;
  const gt=async()=>p.evaluate(()=>{try{return Math.round(state.totalPlaySec||0);}catch(e){return 0;}});
  const fmtT=s=>{s=Math.round(s);
    if(s>=48*3600){ const d=Math.floor(s/86400),h=Math.floor(s%86400/3600); return d+'日'+(h?h+'時間':''); }
    const h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;return (h?h+'時間':'')+((m||h)?m+'分':'')+ss+'秒';};
  const shoot=async(nm)=>{await p.screenshot({path:DIR+'/'+nm+'.jpg',type:'jpeg',quality:52});};
  const rec=async(op,inc)=>{ inc=(inc==null?1:inc); if(inc<=0&&op.indexOf('放置')<0&&op.indexOf('転生')<0&&op.indexOf('クエスト')<0)return;
    const t=await gt(); const last=L[L.length-1];
    if(last&&last.op===op&&op.indexOf('放置')<0){ last.count+=inc; last.t=fmtT(t); await shoot(last.n); return; }
    shotN++; const nm=String(shotN).padStart(3,'0'); await shoot(nm); L.push({n:nm,t:fmtT(t),op,count:inc}); };

  const snap=async()=>p.evaluate(()=>({sec:Math.round(state.totalPlaySec||0),cps:Number(currentCps().toString()),
    unlocked:!!(prestigeUnlocked&&prestigeUnlocked()),gain:(prestigeGain?Number(prestigeGain()):0),
    runs:state.prestigeRuns||0,skills:Object.values(state.skills||{}).filter(Boolean).length,
    stage:state.stageUnlocked||1, qk:(state.questKills||{})[state.stageUnlocked||1]||0,
    need:(typeof QUEST_KILLS_NEED!=='undefined'?(QUEST_KILLS_NEED[(state.stageUnlocked||1)-1]||0):0),
    kills:state.monstersDefeated||0}));

  // 実プレイヤーの購入判断(2026-07-26 ユーザー指示A)。判断そのものは sim/tools/buy_policy.js に置き、
  // 実況ドライバ2本(stage_playthrough / open_playthrough)が同じものを使う=片方だけ賢い状態を作らない。
  const { installBuyPolicy } = require('./buy_policy.js');
  const BUYCFG = await installBuyPolicy(p);
  console.log(`買い方: ${BUYCFG.policy}(実効タップ${BUYCFG.tps}/s・貯める閾値${BUYCFG.saveRatio}倍/手持ち${BUYCFG.saveReach}倍以内)`);

  // 序盤: タップ→設備を1手ずつ(初出を丁寧に)。初討伐・研究・金クッキーが発生順で入る。
  await rec('タイトルから開始',1);
  for(let i=0;i<12;i++)await p.click('#cookie').catch(()=>{});
  await rec('クッキーをタップ',12);
  for(let w=0; w<10; w++){
    await p.clock.runFor(8000);
    const acts=await p.evaluate(()=>{ const out=[]; const add=(l,c)=>{if(c>0)out.push([l,c]);};
      for(let k=0;k<40;k++)tapCookie();
      // 初討伐(出ていれば)
      for(let n=0;n<10;n++){if(!(typeof rewardModalOpen==='function'&&rewardModalOpen()))break;revealRewardChoices&&revealRewardChoices();if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]);else break;}
      if(typeof monsters!=='undefined'&&monsters&&monsters.length&&hitMonster){const b4=state.monstersDefeated||0;for(const m of monsters.slice())for(let z=0;z<300&&monsters.indexOf(m)>=0;z++)hitMonster(m.id);add('モンスターを討伐',(state.monstersDefeated||0)-b4);}
      for(let n=0;n<10;n++){if(!(typeof rewardModalOpen==='function'&&rewardModalOpen()))break;revealRewardChoices&&revealRewardChoices();if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]);else break;}
      if(typeof goldenVisible!=='undefined'&&goldenVisible&&collectGoldenCookie){collectGoldenCookie();
        // 金の payoff(全生産ブースト/大当たり/エコー)を実況ラベルに反映=「金クッキー活用」を見せる。
        let gm=''; try{gm=(document.getElementById('message')||{}).textContent||'';}catch(e){}
        gm=gm.replace(/^💰?\s*/,'').trim();
        add(gm?('金クッキーを回収 → '+gm):'金クッキーを回収',1);}
      if(typeof RESEARCH!=='undefined')for(const r of RESEARCH){try{if(!state.research[r.id]&&(typeof researchUnlocked!=='function'||researchUnlocked(r))&&state.cookies.gte(D(r.cost))){buyResearch(r.id);add('研究「'+r.name+'」を購入',1);}}catch(e){}}
      const sp=window.__buySpree(200);
      for(const [nm,cnt] of sp.order)add(nm+'を購入',cnt);
      if(sp.saved)add('次のティアへ貯める(今の一番良い台より格段に良い台が射程に入った)',1);
      return out; },{});
    for(const [label,cnt] of acts) await rec(label,cnt);
    const s=await snap();
    if(s.unlocked&&s.gain>0){ break; } // 初転生の条件が立ったら周回ループへ
  }

  // 会心の一撃を1つ捕捉=タップの"気持ちよさ"(面白さF1)を実況に写す。一過性なのでフロートが出た瞬間を撮る。
  // 2026-07-26 修正: 会心の前提「指先の型」は researchUnlocked が「その周回で強い指を1台以上所持」を
  // 要求する(RES_EQUIP.fingerTechnique='finger')。転生直後は所持0なので研究が買えず会心率0=
  // 220タップ叩いても永久に捕まらなかった(旧ログの「crit not caught」の正体。旧ルールでも同じ)。
  // 実プレイヤも会心を楽しむなら先に強い指を数台買うので、その順序に直す。捕まらなかった場合は
  // 会心率と前提の状態を出す(「捕まらない」だけでは原因が分からない=判定の空振りと同じ)。
  const critSetup=await p.evaluate(()=>{
    // 会心を見るには「強い指を1台以上(研究の解放条件)+指先の型(研究費)」の両方が要る。
    // 転生直後は所持クッキーが少なく研究費に届かないので、実プレイヤと同じく少し稼いでから買う
    // (このドライバの稼ぎ方=ゲーム自身のoffline式 earn(baseCps×秒))。届かなければ状態を報告する。
    const rs=(typeof RESEARCH!=='undefined')?RESEARCH.find(r=>r.id==='fingerTechnique'):null;
    let banked=0;
    try{
      const fu=UPGRADES.find(u=>u.id==='finger');
      for(let iter=0; iter<48; iter++){
        for(let i=0;i<5;i++){ if(!fu)break; let c; try{c=costOf(fu);}catch(e){break;} if(!state.cookies.gte(c))break; buyUpgrade('finger'); }
        if(!state.research.fingerTechnique && rs){
          const need=(typeof researchCost==='function')?researchCost(rs):D(rs.cost);
          if(state.cookies.gte(need)){ buyResearch('fingerTechnique'); }
        }
        if(state.research.fingerTechnique && (state.upgrades.finger||0)>0) break;
        const bc=Math.max(1,Number(baseCps().toString()));
        const sec=3600; earn(D(bc).mul(sec)); state.totalPlaySec=(state.totalPlaySec||0)+sec; banked+=sec;
      }
    }catch(e){}
    return { fingers:state.upgrades.finger||0, tech:!!state.research.fingerTechnique, bankedH:Math.round(banked/3600),
      cost:(rs&&typeof researchCost==='function')?String(researchCost(rs)):null,
      rate:(typeof fingerCritChance==='function')?+(fingerCritChance()*100).toFixed(2):null };
  });
  { let caught=false, taps=0;
    for(let t=0; t<220 && !caught; t++){
      const crit=await p.evaluate(()=>{ const fa=document.getElementById('floatArea'); if(fa)fa.innerHTML=''; tapCookie(); return document.querySelectorAll('.critFloat').length>0; });
      taps++;
      if(crit){ await p.clock.runFor(120); await rec('会心の一撃！(タップの手応え)',1); caught=true; }
    }
    console.log(`   会心: ${caught?('捕捉('+taps+'タップ目)'):'捕まらず'} 強い指${critSetup.fingers}台・指先の型${critSetup.tech?'有':'無'}(費用${critSetup.cost})・研究費のために${critSetup.bankedH}h稼ぎ・会心率${critSetup.rate}%`);
  }

  // offline式で放置生産→設備/研究を建て直し。runCookiesを厚く積む(=討伐窓を延ばし転生回数を減らす=実プレイヤの立ち回り)。
  const BANK_TARGET=Number(process.env.BANK_TARGET||1e18);
  // 放置チャンク(10h)の上限。多いほど周回内cps複利が回り転生待ちが縮む。決定的掃引(TARGET_STAGE=3):
  // 40=24076日/60=21658/100=10431(谷)/150=18755/300=16233 → stage3狙いはBANK_ITERS=100が最良(28.6年)。
  // 既定は40のまま=正典stage2パス(33日8時間)を不変に保つ。深部の健全ラベル(月〜年)には依然強いプレイモデルが要る。
  const BANK_ITERS=Number(process.env.BANK_ITERS||40);
  const bankRun=async(target)=>p.evaluate(([target,iters])=>{
    const log={idleSec:0, builds:[], researches:[], gainStr:''}; const before=state.cookies;
    for(let r=0;r<iters;r++){
      const bc=Math.max(1,Number(baseCps().toString()));
      const sec=3600*10; earn(D(bc).mul(sec)); state.totalPlaySec=(state.totalPlaySec||0)+sec; log.idleSec+=sec;
      const sp=window.__buySpree(300);
      for(const row of sp.order){ const hit=log.builds.find(x=>x[0]===row[0]);
        if(hit)hit[1]+=row[1]; else log.builds.push([row[0],row[1]]); }
      if(typeof RESEARCH!=='undefined')for(const rr of RESEARCH){try{if(!state.research[rr.id]&&(typeof researchUnlocked!=='function'||researchUnlocked(rr))&&state.cookies.gte(D(rr.cost))){buyResearch(rr.id);log.researches.push(rr.name);}}catch(e){}}
      // 研究の段階2/3(実プレイヤの複利源=directive A): 生産系のみ買う(生産に効かない段階へ大金を流すと
      // cps複利が細り転生+1回=1e25の壁を踏む=決定的A/Bで実測)。buyResearchStageが条件/費用を検査。
      if(typeof buyResearchStage==='function'&&typeof RESEARCH!=='undefined'){
        const PROD_RS=['ovenBatch','factoryNetwork','grandmaCrowd','moonGlobalYeast','galaxyAssembly','antimatterRecipe'];
        for(const rid of PROD_RS){try{
          if(!state.research[rid])continue;
          const b4=Math.max(1,Math.floor(Number((state.researchStages||{})[rid])||1)); if(b4>=3)continue;
          buyResearchStage(rid,b4+1);
          const af=Math.max(1,Math.floor(Number((state.researchStages||{})[rid])||1));
          if(af>b4){const rr=RESEARCH.find(x=>x.id===rid);log.researches.push((rr?rr.name:rid)+' 段階'+af);}}catch(e){}}}
      if(state.runCookies.gte(D(target)))break; // 討伐窓を賄える厚みまで積んだら終い
    }
    log.cps=Number(currentCps().toString()); log.rc=Number(state.runCookies.toString());
    log.gainStr=(typeof fmt==='function')?fmt(state.cookies.sub(before)):String(state.cookies.sub(before));
    return log; },[target,BANK_ITERS]);

  // 討伐フェーズ: fastForwardで出現を発火→倒す。ボスは別ブロックで捕捉、ステージ解放の瞬間も捕捉。
  // huntPhase自身が通常討伐/ボス/報酬をrec(=ボス出現前に通常討伐をflushして時系列を保つ)。
  const msCount=async()=>p.evaluate(()=>{try{return Object.values(state.msResearch||{}).filter(Boolean).length;}catch(e){return 0;}});
  const huntPhase=async()=>{
    let killed=0, rewards=0, stageUp=null, moved=null, bossSeen=0, goldCount=0;
    let pendKills=0, pendRew=0; const ms0=await msCount();
    const flush=async()=>{ if(pendKills>0){await rec('モンスターを討伐',pendKills);pendKills=0;} if(pendRew>0){await rec('討伐報酬を選択',pendRew);pendRew=0;}
      if(goldCount>0){ await rec('金クッキーを回収',goldCount); goldCount=0; }
      const msn=await msCount(); if(msn>flush._ms){ await rec('🎖️ 実績を達成',msn-flush._ms); flush._ms=msn; } };
    flush._ms=ms0;
    // 解放済みの最新ステージへ移動(実プレイヤは矢印で移動して新ステージのモンスターを狩る=クエスト加算はcurrentStage基準)。
    moved=await p.evaluate(()=>{ try{ let m=null; while(currentStageNo()<maxUnlockedStageNo()){ moveStageBy(1); m=currentStageNo(); } return m?stageInfo(m).name:null; }catch(e){return null;} });
    if(moved) await rec(`ステージ「${moved}」へ移動`,1);
    for(let step=0; step<HUNT_STEPS; step++){ // quota壁(quotaFailed)まで長めに狩る=1窓の討伐数を最大化し転生回数を減らす
      await p.clock.fastForward(FF_STEP);
      // まずボス出現を検出(倒す前に=ボスが画面に居る瞬間を撮る)。守護ボス(解放を懸けた戦い)は別格で見せる。
      const boss=await p.evaluate(()=>{ try{ const has=!!(typeof monsters!=='undefined'&&monsters&&monsters.some(m=>m&&m.typeId==='boss'));
        return {has, guardian: has && (state.frontierBossPending||0)===currentStageNo()}; }catch(e){return {has:false};} });
      if(boss.has){ await flush(); await rec(boss.guardian?'👑 守護ボスが現れた！(倒せばステージ解放)':'👑 ボスが出現',1); bossSeen++; }
      const r=await p.evaluate(()=>{
        const before=state.stageUnlocked||1; const bBoss=Object.values(state.bossKills||{}).reduce((a,b)=>a+(Number(b)||0),0); let rew=0;
        for(let n=0;n<12;n++){if(!(typeof rewardModalOpen==='function'&&rewardModalOpen()))break;revealRewardChoices&&revealRewardChoices();if(pendingRewardChoices&&pendingRewardChoices.length){chooseReward(pendingRewardChoices[0]);rew++;}else break;}
        let k=0;if(typeof monsters!=='undefined'&&monsters&&monsters.length&&hitMonster){const b4=state.monstersDefeated||0;for(const m of monsters.slice())for(let z=0;z<600&&monsters.indexOf(m)>=0;z++)hitMonster(m.id);k=(state.monstersDefeated||0)-b4;}
        for(let n=0;n<12;n++){if(!(typeof rewardModalOpen==='function'&&rewardModalOpen()))break;revealRewardChoices&&revealRewardChoices();if(pendingRewardChoices&&pendingRewardChoices.length){chooseReward(pendingRewardChoices[0]);rew++;}else break;}
        // 金クッキーは出ていれば回収(経済の忠実性=実プレイヤは狩り中も拾う)。ブロックは乱発せず窓ごとに集約(下でgoldCount)。
        let gold=false;if(typeof goldenVisible!=='undefined'&&goldenVisible&&typeof collectGoldenCookie==='function'){collectGoldenCookie();gold=true;}
        const after=state.stageUnlocked||1; const aBoss=Object.values(state.bossKills||{}).reduce((a,b)=>a+(Number(b)||0),0);
        return {k, rew, bossK:Math.max(0,aBoss-bBoss), gold, up:(after>before?after:null), qf:!!state.quotaFailed};
      });
      killed+=r.k; rewards+=r.rew; if(r.gold)goldCount++;
      if(r.bossK>0){ if(r.up)await flush(); await rec(r.up?'👑 守護ボスを撃破！！':'👑 ボスを撃破',r.bossK); pendKills+=Math.max(0,r.k-r.bossK); pendRew+=r.rew; }
      else { pendKills+=r.k; pendRew+=r.rew; }
      if(r.up){ await flush(); stageUp=r.up; break; } // 解放の瞬間で止めてスクショ
      if(r.qf){ await flush(); break; } // quota壁=この周回のハント終了→転生へ
      if(step===109) await flush();
    }
    return {killed, rewards, stageUp, moved, bossSeen};
  };

  const doPrestige=async()=>p.evaluate(()=>{
    // 「転生できるまで放置」の補填(2026-07-26 修正)。旧実装は「今のcpsで cost×2 に届くまでの秒数」を
    // 一度に足していた=待つ間に何も買わない模型。cpsが低い局面ではこれ1回で天文学的な時間になり
    // (実測: stage3狙いで 7.4e11日)、プレイの良し悪しでなく模型の粗さが結果を支配していた。
    // 実プレイヤは長い待ちの間に設備を伸ばして待ち時間そのものを縮めるので、
    // 「残りの5%だけ進める→回収が残り時間より速い買い物だけする→cps再評価」の反復にする。
    const cost=D(prestigeCookieCost());
    let guard=0;
    while(state.cookies.lt(cost)&&guard<20000){ guard++;
      let bc=Math.max(1,Number(baseCps().toString()));
      let need=Number(cost.sub(state.cookies).toString());
      if(!isFinite(need)||need<=0)break;
      const remain=need/bc;
      try{ window.__investForDeadline(remain); }catch(e){}
      bc=Math.max(1,Number(baseCps().toString()));
      need=Number(cost.sub(state.cookies).toString());
      if(!isFinite(need)||need<=0)break;
      const step=Math.max(60,Math.min(86400*30,Math.ceil((need/bc)*0.05)));
      earn(D(bc).mul(step)); state.totalPlaySec=(state.totalPlaySec||0)+step;
    }
    try{ if(prestigeUnlocked()&&prestigeGain()>0&&state.cookies.gte(D(prestigeCookieCost()))){ prestigeReset(); return 1; } }catch(e){}
    return 0; });
  const takeSkills=async()=>{ const ids=await p.evaluate(()=>{ const got=[];
      const score=(s)=>{let v=0;for(const e of(s.effects||[])){const t=e.type,val=Number(e.value)||0;if(t==='all')v+=val*1000;else if(t==='cps'||t==='cpsMul')v+=val*100;else if(t==='monsterRate')v+=val*600;else if(t==='click')v+=val*40;else if(t==='startCookies')v+=Math.log10(Math.max(10,val))*30;else v+=1;}return v;};
      if(typeof SKILLS!=='undefined'&&skillCanBuy){for(let n=0;n<80;n++){const cand=SKILLS.filter(x=>skillCanBuy(x));if(!cand.length)break;cand.sort((a,b)=>score(b)-score(a));selectSkill(cand[0].id);takeSelectedSkill();got.push(cand[0].name||cand[0].id);}}
      try{if(typeof beginRunAfterSkills==='function'&&state.awaitingSkillChoice)beginRunAfterSkills();}catch(e){}
      return got; });
    if(ids.length)await rec('スキル「'+ids.join('・')+'」を取得',1); return ids.length; };

  const wall0=now(); let reason='target';
  for(let cyc=0; cyc<60; cyc++){
    const s0=await snap();
    if(s0.stage>=TARGET_STAGE){reason='target';break;}
    if((now()-wall0)>WALLCAP){reason='wallcap';break;}
    if(L.length>=MAXBLK){reason='blkcap';break;}

    // バンク(放置→設備→研究)
    const bk=await bankRun(BANK_TARGET);
    if(bk.idleSec>0){ const t=await gt(); shotN++; const nm=String(shotN).padStart(3,'0'); await shoot(nm);
      const dLbl=bk.idleSec>=86400?`約${Math.round(bk.idleSec/86400)}日`:`約${Math.round(bk.idleSec/3600)}時間`;
      L.push({n:nm,t:fmtT(t),op:`放置 ${dLbl}(遊んで離れて戻る・+${bk.gainStr})`,count:0}); }
    for(const [nm2,c] of bk.builds) await rec(nm2+'を購入',c);
    for(const rn of [...new Set(bk.researches)]) await rec('研究「'+rn+'」を購入',1);

    // 討伐(ステージ進行)。移動はhunt冒頭で行うが実況の並びを保つため先に記録。
    // huntPhaseが通常討伐/ボス/報酬をrec済み(=ボスを別ブロックで surface)。
    const h=await huntPhase();
    if(h.stageUp){ const snm=await p.evaluate(n=>stageInfo(n).name,h.stageUp);
      await rec(`守護ボス撃破！ステージ${h.stageUp}「${snm}」解放`,1);
      console.log(`*** STAGE ${h.stageUp} 「${snm}」 unlocked at cyc=${cyc} wall=${((now()-wall0)/1000).toFixed(0)}s`);
      if(h.stageUp>=TARGET_STAGE){
        // 到達ステージの中身を「味見」: 新ステージへ移動し、同一周回のまま少しだけ狩る(=転生を増やさず時間ラベルを保つ)。
        const mv=await p.evaluate(n=>{try{while(currentStageNo()<n)moveStageBy(1);return stageInfo(currentStageNo()).name;}catch(e){return null;}},h.stageUp);
        if(mv) await rec(`ステージ「${mv}」へ移動`,1);
        let taste=0;
        for(let step=0; step<Math.round(40*50000/FF_STEP) && taste<12; step++){ await p.clock.fastForward(FF_STEP);
          const k=await p.evaluate(()=>{ for(let n=0;n<10;n++){if(!(typeof rewardModalOpen==='function'&&rewardModalOpen()))break;revealRewardChoices&&revealRewardChoices();if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]);else break;}
            let k=0;if(typeof monsters!=='undefined'&&monsters&&monsters.length&&hitMonster){const b4=state.monstersDefeated||0;for(const m of monsters.slice())for(let z=0;z<600&&monsters.indexOf(m)>=0;z++)hitMonster(m.id);k=(state.monstersDefeated||0)-b4;}
            for(let n=0;n<10;n++){if(!(typeof rewardModalOpen==='function'&&rewardModalOpen()))break;revealRewardChoices&&revealRewardChoices();if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]);else break;}
            return {k, qf:!!state.quotaFailed}; },{});
          taste+=k.k; if(k.qf&&taste===0)break; if(k.qf)break;
        }
        if(taste>0){ await rec(`「${mv}」でモンスターを討伐`,taste); }
        console.log(`   taste hunt on ${mv}: ${taste} kills`);
      }
      continue; }

    // 転生→スキル(quota時計reset・questKillsは持ち越し)
    const pr=await doPrestige();
    if(pr){ await rec('転生(スキルツリー解放)',1); await takeSkills(); }

    const s2=await snap();
    fs.writeFileSync(DIR+'/ops.json',JSON.stringify(L,null,1));
    console.log(`cyc=${cyc} idle=${Math.round(bk.idleSec/3600)}h cps=${bk.cps.toExponential(1)} killed=${h.killed} rew=${h.rewards} stageUp=${h.stageUp||'-'} pr=${pr} | stage=${s2.stage} qk=${s2.qk}/${s2.need} runs=${s2.runs} sk=${s2.skills} blk=${L.length} wall=${((now()-wall0)/1000).toFixed(0)}s`);
  }
  fs.writeFileSync(DIR+'/ops.json',JSON.stringify(L,null,1));
  const fin=await snap();
  const uniqIssues=[...new Set(consoleIssues)];
  console.log(`DONE reason=${reason} stage=${fin.stage} runs=${fin.runs} skills=${fin.skills} blocks=${L.length} lastT=${L.length?L[L.length-1].t:'-'} pageerrors=${errs.length} consoleIssues=${uniqIssues.length}`, errs.slice(0,3).join(' | '));
  if(uniqIssues.length) console.log('  console/network:', uniqIssues.slice(0,6).join(' | '));
  await b.close();
})().catch(e=>{console.error('FATAL',e.message,e.stack);process.exit(1);});
