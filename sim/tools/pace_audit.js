// F3切り分け: 各転生を「賄えるまで最大バンク」して、必要な実プレイ時間(totalPlaySec差)とcpsを記録。
// 発散(転生ごとに時間が跳ね上がる)ならBOT弱さでなく設計のゲート。強プレイ寄り(設備をmax・研究・スキル全取り)で測る。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html',{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500); await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  await p.evaluate(()=>{buyMode="max";for(let t=0;t<400;t++)tapCookie();});
  // 賄えるまでバンク(設備max+研究)→そのcostに必要だった実時間を測る
  // 2026-07-26 修正: 旧実装は「今のbaseCpsで cost に届くまでの秒数」を一気に進めていた。
  // 周回開始直後は cps≈1 なので、1e9クッキーに対して 1e9秒=11574日 という桁の跳びを最初の1回で
  // totalPlaySec に入れてしまい、その後に設備を買っても取り返せない=「転生に1e61日かかる」という
  // 現実離れした数字を出していた(実プレイ実測はステージ2到達まで33日)。実プレイヤは貯める間ずっと
  // 再投資して cps を伸ばすので、時間は「短い刻みで進める+毎刻み買い物」で積む。
  const bankToAfford=async(costNum)=>p.evaluate((costNum)=>{
    const cost=D(costNum); let guard=0;
    const buyAll=()=>{
      for(let s=0;s<400;s++){ let best=null,bR=0,bC=null;
        for(const u of UPGRADES){ if(typeof upgradeUnlocked==='function'&&!upgradeUnlocked(u))continue;
          let c; try{c=costOf(u);}catch(e){continue;} const cn=Number(c.toString());
          if(!isFinite(cn)||cn<=0)continue;
          const marg=(u.type==='click')?((u.value||1)*5):(u.value||1);
          if(marg/cn>bR){bR=marg/cn;best=u;bC=cn;} }
        if(!best||!state.cookies.gte(bC))break; buyUpgrade(best.id); }
      if(typeof RESEARCH!=='undefined')for(const rr of RESEARCH){ try{
        if(!state.research[rr.id]&&(typeof researchUnlocked!=='function'||researchUnlocked(rr))&&state.cookies.gte(D(rr.cost)))buyResearch(rr.id);
      }catch(e){} }
    };
    while(state.cookies.lt(cost)&&guard<20000){ guard++;
      buyAll();
      const bc=Math.max(1,Number(baseCps().toString()));
      const needMore=cost.sub(state.cookies);
      const naive=Math.ceil(Number(needMore.div(bc).toString()));
      // 1刻み=残り所要時間の5%(下限60秒・上限1日)。固定1時間刻みだと数百日規模の貯蓄で刻み数が
      // 尽きて途中打ち切りになり、逆に一気に進めると再投資(cps成長)を反映できない。5%刻みなら
      // どの桁でも「残りの5%進む→買う→cps再評価」を繰り返すので、成長を反映しつつ収束する。
      const step=isFinite(naive)?Math.ceil(naive*0.05):3600;
      const sec=Math.max(60,Math.min(86400,step));
      earn(D(bc).mul(sec)); state.totalPlaySec=(state.totalPlaySec||0)+sec;
    }
    // ここで買い物をしてはいけない: cost に届いた瞬間の残高を使い切ってしまい転生できなくなる
    // (実プレイヤも転生直前に貯金を溶かさない)。旧実装のこの最後の buyAll が「転生できず」の原因だった。
    // 転生解放のラッチはゲームのtick(checkPrestigeUnlockNotice)が立てる。このツールは earn() で
    // 時間を進めるのでtickを踏まないため、同じ判定関数を明示的に呼ぶ(条件はゲームと同一=1億超え)。
    try{ if(typeof checkPrestigeUnlockNotice==='function') checkPrestigeUnlockNotice(); }catch(e){}
    const bc=Math.max(1,Number(baseCps().toString()));
    const short=cost.sub(state.cookies);
    const shortNum=Number(short.toString());
    return {cps:Number(currentCps().toString()), sec:state.totalPlaySec||0, iters:guard,
      // 打ち切りを黙って隠さない(打ち切った結果を測定値として読ませない)
      truncated: state.cookies.lt(cost), shortfall: shortNum>0?shortNum:0,
      naiveDaysLeft: shortNum>0?(shortNum/bc/86400):0,
      unlocked:(typeof prestigeUnlocked==='function')?prestigeUnlocked():null,
      gain:(typeof prestigeGain==='function')?prestigeGain():null};
  },costNum);
  const takeSkills=async()=>p.evaluate(()=>{if(typeof SKILLS!=='undefined'&&skillCanBuy){for(let n=0;n<80;n++){const cand=SKILLS.filter(x=>skillCanBuy(x));if(!cand.length)break;cand.sort((a,b)=>{const sc=s=>{let v=0;for(const e of(s.effects||[])){const t=e.type,val=Number(e.value)||0;if(t==='all')v+=val*1000;else if(t==='cps')v+=val*100;else v+=1;}return v;};return sc(b)-sc(a);});selectSkill(cand[0].id);takeSelectedSkill();}}try{if(state.awaitingSkillChoice)beginRunAfterSkills();}catch(e){}});
  const fmtT=s=>{s=Math.round(s);if(s>=86400)return (s/86400).toFixed(1)+'日';if(s>=3600)return (s/3600).toFixed(1)+'時間';return s+'秒';};
  let prevSec=0;
  for(let run=0; run<7; run++){
    const cost=await p.evaluate(()=>Number(String(prestigeCookieCost())));
    const r=await bankToAfford(cost);
    const dt=r.sec-prevSec; prevSec=r.sec;
    if(r.truncated){
      console.log(`prestige#${run}: cost=${cost.toExponential(1)} cps=${r.cps.toExponential(2)} → 打ち切り(刻み上限${r.iters}回=${fmtT(dt)}貯めても未達・不足${r.shortfall.toExponential(1)}・この時点のcpsなら残り約${r.naiveDaysLeft.toFixed(0)}日)`);
    } else {
      console.log(`prestige#${run}: cost=${cost.toExponential(1)} cps=${r.cps.toExponential(2)} この転生に必要な実プレイ時間=${fmtT(dt)} (累計 ${fmtT(r.sec)}・刻み${r.iters}回)`);
    }
    const pr=await p.evaluate(()=>{try{if(prestigeUnlocked()&&prestigeGain()>0&&state.cookies.gte(D(prestigeCookieCost()))){prestigeReset();return 1;}}catch(e){}return 0;});
    if(!pr){console.log(`  (転生できず: unlocked=${r.unlocked} gain=${r.gain} cookies>=cost=${await p.evaluate(()=>state.cookies.gte(D(prestigeCookieCost())))})`);break;}
    await takeSkills();
  }
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
