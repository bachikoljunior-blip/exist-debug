// 実プレイ実況の生成器(序盤=実プレイで本物に撮れる範囲・イベント駆動・注入なし)。
// 実機ブラウザで「そのまま遊んだ操作列」を、合成クロックで短時間に再現。各操作を発生順に記録し、
// 連続同操作はまとめ・画像は最後の場面・累積現実プレイ時間+回数を付ける(native 430x780)。
//
// 実行: OUT=/path/out node sim/tools/open_playthrough.js  → OUT に 001.jpg.. と ops.json
// 生成HTML: SRC=/path/out CUT=60 node sim/tools/open_report.js  → op_jikkyo.html
//
// なぜ「序盤だけ」か(実測・2026-07-23): このゲームは設計上コンテンツ完走に現実で数百時間かかる
//  (ステージ2解放だけで討伐100体・転生は1e9クッキー)。ブラウザ実行のクロック早送りは実時間の約0.3倍
//  コスト=数百時間ぶんは現実的に回せない。かつ手書き自動プレイヤは stage1 経済(cps~2000)で頭打ち。
//  よって「実プレイで本物として短時間に撮れる」のは序盤=芯の輪(タップ→討伐→報酬→金→設備→研究)。
//  深部(ステージ2-6/スキル75/装備6ティア/転生ループ)は別手段(sim由来の時刻・コンテンツ地図)で補う。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const os = require('os');
const now=()=>Number(require('process').hrtime.bigint())/1e6;
const INDEX = process.env.GAME_INDEX || path.resolve(__dirname, '../../index.html');
const DIR = process.env.OUT || path.join(os.tmpdir(), 'open_playthrough');
const MAXBLK=Number(process.env.MAXBLK||95);
const MAXSEC=Number(process.env.MAXSEC||1500);
const WALLCAP=Number(process.env.WALLCAP||1400)*1000;
const fs=require('fs'); try{fs.mkdirSync(DIR,{recursive:true});}catch(e){}
(async()=>{
  const b=await chromium.launch({executablePath:process.env.PW_CHROMIUM||'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message));
  await p.clock.install();
  await p.goto('file://'+INDEX,{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500);
  await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  await p.evaluate(()=>{try{buyMode="1";}catch(e){}});
  // 実プレイヤーの購入判断(共有部品)。stage_playthrough と同じものを使う=片方だけ賢い状態を作らない。
  const { installBuyPolicy } = require('./buy_policy.js');
  // このドライバは実クロックで連続タップする(TPS既定6/s)ので、クリック収入の割引率はその実測値を渡す。
  // 既定0.05は「offline式で貯める stage_playthrough」向けの値=ここで使うとタップ設備を過小評価する。
  const TPS_SELF=Number(process.env.TPS||6);
  const BUYCFG = await installBuyPolicy(p, process.env.TPS_EFF?undefined:{tps:TPS_SELF});
  console.log(`買い方: ${BUYCFG.policy}(実効タップ${BUYCFG.tps}/s・貯める閾値${BUYCFG.saveRatio}倍/手持ち${BUYCFG.saveReach}倍以内)`);

  const L=[]; let shotN=0;
  const gt=async()=>p.evaluate(()=>{try{return Math.round(state.totalPlaySec||0);}catch(e){return 0;}});
  const fmtT=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;return (h?h+'時間':'')+((m||h)?m+'分':'')+ss+'秒';};
  const rec=async(op,inc)=>{ inc=(inc==null?1:inc); const t=await gt(); const last=L[L.length-1];
    if(last && last.op===op){ last.count+=inc; last.t=fmtT(t); await p.screenshot({path:DIR+'/'+last.n+'.jpg',type:'jpeg',quality:50}); return; }
    shotN++; const nm=String(shotN).padStart(3,'0'); await p.screenshot({path:DIR+'/'+nm+'.jpg',type:'jpeg',quality:50}); L.push({n:nm,t:fmtT(t),op,count:inc}); };

  await rec('タイトルから開始',0);
  for(let i=0;i<12;i++)await p.click('#cookie').catch(()=>{});
  await rec('クッキーをタップ',12);

  const snap=async()=>p.evaluate(()=>({sec:Math.round(state.totalPlaySec||0),cookies:Number(state.cookies.toString()),cps:Number(currentCps().toString()),
    unlocked:!!(prestigeUnlocked&&prestigeUnlocked()),gain:(prestigeGain?Number(prestigeGain()):0),cost:(prestigeCookieCost?Number(prestigeCookieCost()):0),
    runs:state.prestigeRuns||0,skills:Object.values(state.skills||{}).filter(Boolean).length}));

  // 1刻みの処理を発生順に返す(討伐→報酬→金→研究→設備→タップ)。実プレイヤの購入判断=価値/費用の貪欲(毎手ROI再評価)。
  // bank=true=転生貯蓄中は設備購入を止め(タップ/討伐/金/研究は続ける)、cookiesを1e8ラッチ→1e9転生まで貯める。
  const stepActions=async(tapN,bank)=>p.evaluate(({tapN,bank})=>{
    const out=[]; const add=(l,c)=>{ if(c>0)out.push([l,c]); };
    if(typeof monsters!=='undefined'&&monsters&&monsters.length&&hitMonster){ const b4=state.monstersDefeated||0; for(const m of monsters.slice())for(let k=0;k<200&&monsters.indexOf(m)>=0;k++)hitMonster(m.id); add('モンスターを討伐',(state.monstersDefeated||0)-b4); }
    { let c=0; for(let n=0;n<12;n++){ if(!(rewardModalOpen&&rewardModalOpen()))break; revealRewardChoices&&revealRewardChoices(); if(pendingRewardChoices&&pendingRewardChoices.length){chooseReward(pendingRewardChoices[0]);c++;}else break; } add('討伐報酬を選択',c); }
    if(typeof goldenVisible!=='undefined'&&goldenVisible&&collectGoldenCookie){collectGoldenCookie();add('金クッキーを回収',1);}
    if(typeof RESEARCH!=='undefined')for(const r of RESEARCH){try{ if(!state.research[r.id]&&(typeof researchUnlocked!=='function'||researchUnlocked(r))&&state.cookies.gte(D(r.cost))){ buyResearch(r.id); add('研究「'+r.name+'」を購入',1);} }catch(e){}}
    // 購入判断は buy_policy.js の共有ルール(回収時間+次ティアへ貯める)。旧「価値/費用」貪欲は
    // 強い指を常に最優先に選んでいた=強い指偏重(2026-07-26 ユーザー指示Aで是正)。
    if(!bank){ const sp=window.__buySpree(400);
      for(const [nm,cnt] of sp.order)add(nm+'を購入',cnt);
      if(sp.saved)add('次のティアへ貯める(今より格段に良い台が射程に入った)',1); }
    if(tapCookie&&tapN>0){for(let k=0;k<tapN;k++)tapCookie();add('クッキーをタップ',tapN);}
    return out;
  },{tapN,bank});

  const takeSkills=async()=>{ const names=await p.evaluate(()=>{ const got=[]; if(typeof SKILLS!=='undefined'&&skillCanBuy){ for(let n=0;n<80;n++){ const s=SKILLS.find(x=>skillCanBuy(x)); if(!s)break; selectSkill(s.id); takeSelectedSkill(); got.push(s.name||s.id);} } return got; }); for(const nm of names)await rec('スキル「'+nm+'」を取得',1); };

  const TPS=Number(process.env.TPS||6); // 実プレイヤの連続タップ(毎秒)
  const wall0=now(); let reason='blkcap', stallCount=0, banking=false;
  for(let i=0;i<8000;i++){
    let s=await snap();
    // 転生: 貯蓄が実って cookies>=cost なら転生→スキル取得(ゲームの第2の柱)
    if(s.unlocked && s.gain>0 && s.cookies>=s.cost){
      const pr=await p.evaluate(()=>{try{if(state.cookies.gte(prestigeCookieCost())&&prestigeGain()>0){prestigeReset();return 1;}}catch(e){}return 0;});
      if(pr){ await rec('転生(スキルツリー解放)',1); await takeSkills(); banking=false; s=await snap(); stallCount=0; }
    }
    // 数分の貯蓄で cost に届くなら銀行モード(1e8ラッチ→1e9転生)。純経済で到達=stage進行(討伐100体)より現実的。
    if(!banking && s.gain>0 && (s.cookies + s.cps*600) >= s.cost) banking=true;
    const sec=s.sec;
    // 序盤(最初の5分)は細かく=初出の一手を丁寧に。以降の反復グラインドは大きく早送り(まとめ前提)=転生を可視範囲に収める。
    let step=8000; if(sec>=300)step=60000; if(sec>=1200)step=180000; if(banking)step=Math.max(step,120000);
    const stepSec=step/1000;
    // クロックはsub分割で進める(討伐/報酬を取りこぼさない・報酬ポーズで生産が止まらない)
    { let done=0; const sub=15000; while(done<step){ const st=Math.min(sub,step-done); await p.clock.runFor(st); done+=st;
        if(done<step)await p.evaluate(()=>{ for(let n=0;n<8;n++){ if(!(rewardModalOpen&&rewardModalOpen()))break; revealRewardChoices&&revealRewardChoices(); if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]); else break; }
          if(typeof monsters!=='undefined'&&monsters&&monsters.length&&hitMonster)for(const m of monsters.slice())for(let k=0;k<200&&monsters.indexOf(m)>=0;k++)hitMonster(m.id);
          if(typeof goldenVisible!=='undefined'&&goldenVisible&&collectGoldenCookie)collectGoldenCookie(); }); } }
    const tapN=Math.round(stepSec*TPS);
    const acts=await stepActions(tapN,banking);
    let progressed=false;
    for(const [label,cnt] of acts){ await rec(label,cnt); if(!/タップ/.test(label))progressed=true; }
    if(progressed||banking) stallCount=0; else stallCount++;
    const s2=await gt();
    if(L.length>=MAXBLK){reason='blkcap';break;}
    if(s2>=MAXSEC && !banking){reason='seccap';break;}
    if(stallCount>=20){reason='stall(経済頭打ち)';break;}
    if((now()-wall0)>WALLCAP){reason='wallcap';break;}
    if(i%6===0){ try{fs.writeFileSync(DIR+'/ops.json',JSON.stringify(L,null,1));}catch(e){}
      console.log(`i=${i} ${fmtT(s2)} blk=${L.length} bank=${banking} runs=${s.runs} sk=${s.skills} cps=${s.cps.toExponential(1)} wall=${((now()-wall0)/1000).toFixed(0)}s`); }
  }
  fs.writeFileSync(DIR+'/ops.json',JSON.stringify(L,null,1));
  console.log('DONE reason='+reason,'blocks='+L.length,'lastT='+(L.length?L[L.length-1].t:'-'),'errors='+errs.length);
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
