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
  // タップの稼働率(2026-07-26 実測して二段にした)。旧実装は各ステップで stepSec×6 回タップ=
  // 何日でも毎秒6回叩き続ける人間という前提で、実在しないプレイヤだった。その前提のまま買い方を
  // 正直に評価すると強い指の1クッキーあたり毎秒増が最良になり続け、毎秒生産0のまま進む(実走で確認)。
  // 逆に稼働率を一律2%にすると、序盤2分で13タップ=最初の1台(100クッキー)も買えず動かない(これも実走で確認)。
  // 実プレイヤは「最初の数分はほぼ叩き続け、その後は置いて時々戻る」なので二段にする:
  //   ゲーム内 ACTIVE_SEC(既定300秒)までは実クロックで DUTY_HI(既定0.8)で叩き、それ以降は
  //   「離席AWAY_H時間(オフライン生産)+戻って ACTIVE_WIN 秒遊ぶ」の繰り返し=平均稼働は自動的に数%になる。
  // 行動(タップ数)と買い方の評価(クリック収入の割引)に必ず同じ値を使う=模型と行動を食い違わせない。
  // どのステップも黙って固まらせない(2026-07-26): 離席モデルを入れた後、i=36の活動窓で
  // ログが進まなくなる現象を観測した。原因調査より先に「固まったら分かる」ようにする。
  const STEP_TIMEOUT=Number(process.env.STEP_TIMEOUT||45000);
  let timedOut=null;
  const withTO=async(label,fn)=>{
    let t; const timer=new Promise((_,rej)=>{ t=setTimeout(()=>rej(new Error('TIMEOUT '+label)),STEP_TIMEOUT); });
    try{ return await Promise.race([fn(),timer]); }
    finally{ clearTimeout(t); }
  };
  const TPS_SELF=Number(process.env.TPS||6);
  const ACTIVE_SEC=Number(process.env.ACTIVE_SEC||300);
  const DUTY_HI=Math.max(0,Math.min(1,Number(process.env.DUTY_HI||0.8)));
  // 離席の刻み(2026-07-26 実測して決めた): 活動窓を実クロックで進める費用が支配的で、
  // 15秒刻み×180秒=12回のクロック前進で1周あたり実時間60秒かかっていた(=固まって見えた原因。
  // 固まりではなく遅さだったことは、ステップ毎のタイムアウトが一度も発火しないことで確定)。
  // 湧きは42〜60秒間隔なので30秒刻みでも取りこぼさない。窓を120秒に縮め、離席を8時間に伸ばす=
  // 同じ実時間でカバーできるゲーム内時間を約6倍にする。
  const AWAY_H=Number(process.env.AWAY_H||8);           // 1回の離席時間(時間)
  const ACTIVE_WIN=Number(process.env.ACTIVE_WIN||120); // 戻ってきて遊ぶ時間(秒)
  const ACTIVE_SUB=Number(process.env.ACTIVE_SUB||30000); // 活動窓のクロック刻み(ms)
  // 狩りに座る1回の長さ(2026-07-26 ユーザー指示A「討伐でステージ進行」): 離席中は湧きが起きないので
  // 討伐は1体も進まない。次のステージが討伐クエストの残りだけで開くなら、実プレイヤは離れずに座って狩る。
  // 湧きは42〜60秒間隔なので、1200秒の窓で20体前後が見込める。
  const HUNT_WIN=Number(process.env.HUNT_WIN||1200);
  // 1ステップの連続タップ上限(2026-07-26 実測): 狩り窓1200秒×6タップ/秒=5760回を1回の evaluate で
  // 叩くとステップ制限(45秒)を超えて中断する(実走で TIMEOUT stepActions を観測)。実プレイヤも
  // 一息に5000回は叩かないので、1ステップぶんを上限で切る(買い方に渡す実効タップ率は別管理)。
  const TAP_CAP=Number(process.env.TAP_CAP||900);
  const BUYCFG = await installBuyPolicy(p, process.env.TPS_EFF?undefined:{tps:TPS_SELF*DUTY_HI});
  console.log(`買い方: ${BUYCFG.policy}(タップ${TPS_SELF}/s×稼働${DUTY_HI}・最初の${ACTIVE_SEC}秒は実クロック→以降は離席${AWAY_H}h+${ACTIVE_WIN}s遊ぶの繰り返し)`);

  const L=[]; let shotN=0;
  const gt=async()=>withTO('gt',()=>p.evaluate(()=>{try{return Math.round(state.totalPlaySec||0);}catch(e){return 0;}}));
  const fmtT=s=>{s=Math.round(s);const h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;return (h?h+'時間':'')+((m||h)?m+'分':'')+ss+'秒';};
  const rec=async(op,inc)=>{ inc=(inc==null?1:inc); const t=await gt(); const last=L[L.length-1];
    if(last && last.op===op){ last.count+=inc; last.t=fmtT(t); await withTO('screenshot(同一操作)',()=>p.screenshot({path:DIR+'/'+last.n+'.jpg',type:'jpeg',quality:50})); return; }
    shotN++; const nm=String(shotN).padStart(3,'0'); await withTO('screenshot',()=>p.screenshot({path:DIR+'/'+nm+'.jpg',type:'jpeg',quality:50})); L.push({n:nm,t:fmtT(t),op,count:inc}); };

  await rec('タイトルから開始',0);
  for(let i=0;i<12;i++)await p.click('#cookie').catch(()=>{});
  await rec('クッキーをタップ',12);

  // クエスト(次のステージ解放)の状況。実プレイヤの「今なにが足りないか」の判断材料。
  const questSnap=async()=>withTO('questSnap',()=>p.evaluate(()=>{
    try{
      const q=(typeof questProgress==='function')?questProgress():null;
      return { ok:!!q, done:!!(q&&q.done), st:(q&&q.st)||0, got:(q&&q.got)||0, need:(q&&q.need)||0,
        remain:(q&&q.remain)||0, boss:((state.frontierBossPending||0)===((q&&q.st)||0)),
        kills:state.monstersDefeated||0 };
    }catch(e){ return { ok:false }; }
  }));
  const snap=async()=>withTO('snap',()=>p.evaluate(()=>({sec:Math.round(state.totalPlaySec||0),cookies:Number(state.cookies.toString()),cps:Number(currentCps().toString()),
    unlocked:!!(prestigeUnlocked&&prestigeUnlocked()),gain:(prestigeGain?Number(prestigeGain()):0),cost:(prestigeCookieCost?Number(prestigeCookieCost()):0),
    runs:state.prestigeRuns||0,skills:Object.values(state.skills||{}).filter(Boolean).length})));

  // 1刻みの処理を発生順に返す(討伐→報酬→金→研究→設備→タップ)。実プレイヤの購入判断=価値/費用の貪欲(毎手ROI再評価)。
  // bank=true=転生貯蓄中は設備購入を止め(タップ/討伐/金/研究は続ける)、cookiesを1e8ラッチ→1e9転生まで貯める。
  const stepActions=async(tapN,bank)=>withTO('stepActions(討伐/報酬/金/研究/買い物/タップ)',()=>p.evaluate(({tapN,bank})=>{
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
  },{tapN,bank}));

  // 2026-07-26 修正: スキルを取っただけでは周回が始まらない。転生後は awaitingSkillChoice で
  // プレイ画面が止まり、totalPlaySec も進まない(実走で確認: 転生後に7反復ぶんゲーム内時間が
  // 40時間15分10秒のまま凍結・cps0・タップは全てスキル画面を開くだけ)。ゲーム同様に
  // 「スキルを取る→ステージを選んで周回開始(beginRunAfterSkills)」まで進める。
  const takeSkills=async()=>{ const res=await withTO('takeSkills',()=>p.evaluate(()=>{ const got=[];
      if(typeof SKILLS!=='undefined'&&skillCanBuy){ for(let n=0;n<80;n++){ const s=SKILLS.find(x=>skillCanBuy(x)); if(!s)break; selectSkill(s.id); takeSelectedSkill(); got.push(s.name||s.id);} }
      let started=false, stage=0;
      try{
        // 実プレイヤはクエストが進むステージ(フロンティア=最新解放)を選ぶ
        if(typeof maxUnlockedStageNo==='function'){ const f=Math.max(1,Math.min(maxUnlockedStageNo(), state.stageUnlocked||1)); state.stage=f; stage=f; }
        if(typeof closeStageChoiceScreen==='function')closeStageChoiceScreen();
        if(typeof beginRunAfterSkills==='function'&&state.awaitingSkillChoice){ beginRunAfterSkills(); started=true; }
      }catch(e){}
      return { got, started, stage, awaiting:!!state.awaitingSkillChoice };
    }));
    for(const nm of res.got)await rec('スキル「'+nm+'」を取得',1);
    if(res.started)await rec(`ステージ${res.stage}を選んで新しい周回を開始`,1);
    if(res.awaiting)console.log('   ⚠ 周回開始に失敗(awaitingSkillChoiceが残った)=時間が進まない状態');
  };

  const TPS=Number(process.env.TPS||6); // 実プレイヤの連続タップ(毎秒)
  // 転生直後は毎秒生産が0に戻るので、そのまま離席しても回収は+0(実測: 「離席8時間 → 戻って回収(+0)」が2連続)。
  // 実プレイヤは転生後に少し遊んで設備を建て直してから離れるので、転生のたびに能動セッションを挟む。
  let activeUntilSec=ACTIVE_SEC;
  const wall0=now(); let reason='blkcap', stallCount=0, banking=false, huntDry=0;
  try{
  for(let i=0;i<8000;i++){
    let s=await snap();
    // 転生: 貯蓄が実って cookies>=cost なら転生→スキル取得(ゲームの第2の柱)
    if(s.unlocked && s.gain>0 && s.cookies>=s.cost){
      const pr=await withTO('転生',()=>p.evaluate(()=>{try{if(state.cookies.gte(prestigeCookieCost())&&prestigeGain()>0){prestigeReset();return 1;}}catch(e){}return 0;}));
      if(pr){ await rec('転生(スキルツリー解放)',1); await takeSkills(); banking=false; s=await snap(); stallCount=0;
        activeUntilSec=(s.sec||0)+ACTIVE_SEC; } // 立て直しの能動セッション(離席しても+0なので)
    }
    // 数分の貯蓄で cost に届くなら銀行モード(1e8ラッチ→1e9転生)。純経済で到達=stage進行(討伐100体)より現実的。
    // 狩り判断(2026-07-26 ユーザー指示A): 次のステージが「討伐クエストの残り」だけで開くなら座って狩る。
    // 離席中は湧きが起きない=討伐は1体も進まないので、離れるのは進行の放棄にあたる。
    // 守護ボス待機中は最優先(2.5秒で登場する)。狩っても実りが無い(窓で0体)ときだけ離席に戻して火力を育てる。
    const q=await questSnap();
    const wantHunt = q.ok && !q.done && (q.boss || q.remain>0) && huntDry<2;
    if(!banking && s.gain>0 && (s.cookies + s.cps*600) >= s.cost) banking=true;
    if(wantHunt) banking=false; // 狩り中は設備を止めない(火力=タップと毎秒生産)
    const sec=s.sec;
    // 時間の進め方(2026-07-26 ユーザー指示A「本物到達を延ばす」への対処):
    // 実クロックだけで進めると、初転生(1e9クッキー)に要するゲーム内時間が現実の実行時間を超えるので
    // 序盤数分から先へ行けなかった(実走: 10分で毎秒57・転生0)。実プレイヤの時間の使い方は
    // 「戻ってきて数分遊ぶ→離れる(その間はゲーム自身のオフライン生産)」なので、そのとおりに刻む:
    //   ・最初の ACTIVE_SEC 秒: 実クロックで細かく(初出の一手・討伐・金クッキーを取りこぼさない)
    //   ・以降: 離席 AWAY_H 時間(ゲームの offline式 earn(baseCps×秒) を直呼び)+ 実クロックで ACTIVE_WIN 秒遊ぶ
    // 離席中に湧きや金が起きないのは実際のゲームと同じ(オフラインは生産だけ)。偽の加速はしていない。
    let step, stepSec;
    if(sec < activeUntilSec){
      step=8000; stepSec=step/1000;
      let done=0; const sub=4000; while(done<step){ const st=Math.min(sub,step-done); await withTO('clock(序盤)',()=>p.clock.runFor(st)); done+=st;
        if(done<step)await withTO('序盤の処理',()=>p.evaluate(()=>{ for(let n=0;n<8;n++){ if(!(rewardModalOpen&&rewardModalOpen()))break; revealRewardChoices&&revealRewardChoices(); if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]); else break; }
          if(typeof monsters!=='undefined'&&monsters&&monsters.length&&hitMonster)for(const m of monsters.slice())for(let k=0;k<200&&monsters.indexOf(m)>=0;k++)hitMonster(m.id);
          if(typeof goldenVisible!=='undefined'&&goldenVisible&&collectGoldenCookie)collectGoldenCookie(); })); }
    } else if(wantHunt){
      // 狩りセッション: 座って湧きを待ち、出たら倒す。討伐が進めば報酬・素材・クエストが同時に進む。
      // 待ち方は「次の湧き時刻までクロックを飛ばす」(2026-07-26 実測で固定刻みから変更):
      // 固定30秒刻みだと通常モンスターの滞在(11〜16秒)を跨いで取りこぼし、しかも1窓40回の
      // クロック前進で実時間を食う。実タイマー(monsterSpawnDeadline)まで飛ばせば1体あたり1回で済む。
      step=HUNT_WIN*1000; stepSec=HUNT_WIN;
      const k0=q.kills;
      let done=0, guard=0;
      while(done<step && guard++<80){
        const wait=await withTO('次の湧きまで',()=>p.evaluate(()=>{
          try{
            const r=(monsterSpawnPausedRemaining!=null)?monsterSpawnPausedRemaining
              :(monsterSpawnDeadline!=null?monsterSpawnDeadline-Date.now():null);
            return (r==null||!isFinite(r))?null:Math.max(0,Math.round(r));
          }catch(e){ return null; }
        }));
        const jump=Math.min(step-done, (wait==null?ACTIVE_SUB:wait+800));
        await withTO('clock(狩り: 次の湧きまで)',()=>p.clock.runFor(jump)); done+=jump;
        await withTO('狩りの処理',()=>p.evaluate(()=>{ for(let n=0;n<8;n++){ if(!(rewardModalOpen&&rewardModalOpen()))break; revealRewardChoices&&revealRewardChoices(); if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]); else break; }
          if(typeof monsters!=='undefined'&&monsters&&monsters.length&&hitMonster)for(const m of monsters.slice())for(let k=0;k<400&&monsters.indexOf(m)>=0;k++)hitMonster(m.id);
          if(typeof goldenVisible!=='undefined'&&goldenVisible&&collectGoldenCookie)collectGoldenCookie(); }));
      }
      const q2=await questSnap();
      const killed=Math.max(0,(q2.kills||0)-k0);
      if(killed>0){ huntDry=0; await rec(`ステージ${q.st}に座って狩る(クエスト ${q2.got}/${q2.need})`,1); }
      else { huntDry++; await rec(`ステージ${q.st}で狩ったが倒せない(火力不足=離席で育て直す)`,1); }
      if(q2.boss&&!q.boss)await rec('討伐ノルマ達成！守護ボスが現れる',1);
      if((q2.st||0)>(q.st||0))await rec(`守護ボス撃破！ステージ${q2.st}を解放`,1);
    } else {
      const awaySec=Math.round(AWAY_H*3600);
      const got=await withTO('離席のオフライン計算',()=>p.evaluate((asec)=>{ const bc=Math.max(0,Number(baseCps().toString()));
        const g=earn(D(bc).mul(asec)); state.totalPlaySec=(state.totalPlaySec||0)+asec;
        return { gain:String(g), cps:bc }; }, awaySec));
      await rec(`離席${AWAY_H}時間 → 戻って回収(+${got.gain.length>12?Number(got.gain).toExponential(2):got.gain})`,1);
      step=ACTIVE_WIN*1000; stepSec=ACTIVE_WIN;
      let done=0; const sub=ACTIVE_SUB; while(done<step){ const st=Math.min(sub,step-done); await withTO('clock(活動窓)',()=>p.clock.runFor(st)); done+=st;
        await withTO('活動窓の処理',()=>p.evaluate(()=>{ for(let n=0;n<8;n++){ if(!(rewardModalOpen&&rewardModalOpen()))break; revealRewardChoices&&revealRewardChoices(); if(pendingRewardChoices&&pendingRewardChoices.length)chooseReward(pendingRewardChoices[0]); else break; }
          if(typeof monsters!=='undefined'&&monsters&&monsters.length&&hitMonster)for(const m of monsters.slice())for(let k=0;k<200&&monsters.indexOf(m)>=0;k++)hitMonster(m.id);
          if(typeof goldenVisible!=='undefined'&&goldenVisible&&collectGoldenCookie)collectGoldenCookie(); })); }
    }
    // 実クロックで進めた区間は「居る」区間なので、その中では稼働HIで叩く。買い方の評価に渡す
    // 実効タップ率は「1日の中でどれだけ叩くか」なので、離席込みの平均(活動窓/(活動窓+離席))で出す。
    // 狩り中は座っているので稼働HI(離席込みの平均で割り引かない)
    const sitting=(sec<activeUntilSec)||wantHunt;
    const tapN=Math.min(TAP_CAP, Math.round(stepSec*TPS*DUTY_HI*(sitting?1:DUTY_HI)));
    const avgDuty=sitting?DUTY_HI:(ACTIVE_WIN*DUTY_HI/(ACTIVE_WIN+AWAY_H*3600));
    await withTO('稼働率の更新',()=>p.evaluate((v)=>{ if(window.__BUY)window.__BUY.tps=v; }, TPS*avgDuty));
    const acts=await stepActions(tapN,banking);
    let progressed=false;
    for(const [label,cnt] of acts){ await rec(label,cnt); if(!/タップ/.test(label))progressed=true; }
    if(progressed||banking) stallCount=0; else stallCount++;
    const s2=await gt();
    if(L.length>=MAXBLK){reason='blkcap';break;}
    if(s2>=MAXSEC && !banking){reason='seccap';break;}
    if(stallCount>=20){reason='stall(経済頭打ち)';break;}
    if((now()-wall0)>WALLCAP){reason='wallcap';break;}
    if(i%3===0){ try{fs.writeFileSync(DIR+'/ops.json',JSON.stringify(L,null,1));}catch(e){}
      console.log(`i=${i} ${fmtT(s2)} blk=${L.length} ${wantHunt?'狩り':'離席'} bank=${banking} stage=${q.st} quest=${q.got}/${q.need}${q.boss?'(守護待)':''} runs=${s.runs} sk=${s.skills} cps=${s.cps.toExponential(1)} wall=${((now()-wall0)/1000).toFixed(0)}s`); }
  }
  }catch(e){ timedOut=e.message; reason='中断: '+e.message.slice(0,60); }
  fs.writeFileSync(DIR+'/ops.json',JSON.stringify(L,null,1));
  console.log('DONE reason='+reason,'blocks='+L.length,'lastT='+(L.length?L[L.length-1].t:'-'),'errors='+errs.length);
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
