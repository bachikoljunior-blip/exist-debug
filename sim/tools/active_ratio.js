// directive A / F3: 放置生産(baseCps)と能動生産(タップ/会心)の比を測る。
//
// 2026-07-26 全面改訂(旧実装は判定として無意味だった):
//   旧: state.upgrades を「全cps設備を一律N台(最大300台)+強い指10〜25」に固定して測っていた。
//       これは実プレイヤが通る盤面ではない(最上位設備を300台持ちながら強い指25台という状態は
//       購入順のどの点にも存在しない)。結果は全条件で比=1.00×=「能動は無意味」と読めるが、
//       実プレイの実測は 1.84×。判定が現実と逆の結論を出していた。
//       さらにクリック威力を素の currentClickPower() で見ており、会心の期待値を無視していた
//       (会心は低率×特大なので期待値で見ないと能動の価値を大きく取りこぼす)。
//   新: 実プレイヤと同じ買い方で盤面を作る=予算Bを与えて「価値/費用が最大の設備」を買えるだけ買う
//       (open_playthrough のROI貪欲と同じ規則)。研究も買えるものは買う。クリック威力は
//       期待値 currentClickPower×(1+会心率×(会心倍率-1)) で評価する。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const TPS = Number(process.env.TPS || 8); // 人間の連続タップ毎秒
const BUDGETS = (process.env.BUDGETS || '1e4,1e6,1e9,1e12,1e18').split(',');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,90)));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html',{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500); await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  const R=await p.evaluate(({TPS,BUDGETS})=>{
    const out=[];
    for(const Bs of BUDGETS){
      // 盤面を作り直す: 設備0・研究なしから、予算BをROI貪欲で使い切る(実プレイヤの購入判断)
      // 全idを0/falseで初期化する(空オブジェクトにすると costOf が undefined 台数で NaN を返し
      // 「1台も買えない」= 比が Infinity になる。ゲームは ensureState で常に全id在りを保証している)
      state.upgrades={}; UPGRADES.forEach(u=>state.upgrades[u.id]=0);
      state.research={}; RESEARCH.forEach(r=>state.research[r.id]=false);
      state.researchStages={}; state.upgradePerks={}; UPGRADES.forEach(u=>state.upgradePerks[u.id]=0);
      state.cookies=D(Bs); state.runCookies=D(Bs); state.totalCookies=D(Bs);
      let bought=0;
      for(let step=0;step<4000;step++){
        // 研究は即買い(実プレイヤの判断・解放条件を満たすものだけ)
        let didRes=false;
        for(const r of RESEARCH){ try{
          if(!state.research[r.id] && (typeof researchUnlocked!=='function'||researchUnlocked(r)) && state.cookies.gte(D(r.cost))){ buyResearch(r.id); didRes=true; }
        }catch(e){} }
        let best=null,bestR=0,bestC=null;
        for(const u of UPGRADES){ if(typeof upgradeUnlocked==='function'&&!upgradeUnlocked(u))continue;
          let c; try{c=costOf(u);}catch(e){continue;} const cn=Number(c.toString());
          if(!isFinite(cn)||cn<=0)continue; const roi=(u.value||1)/cn; if(roi>bestR){bestR=roi;best=u;bestC=cn;} }
        if(!best||!state.cookies.gte(bestC)){ if(!didRes) break; else continue; }
        const b4=state.upgrades[best.id]||0; buyUpgrade(best.id);
        if((state.upgrades[best.id]||0)<=b4) break; bought++;
      }
      const base=Number(baseCps().toString());
      const raw=Number((typeof currentClickPower==='function'?currentClickPower():D(0)).toString());
      const cc=(typeof fingerCritChance==='function')?fingerCritChance():0;
      const cm=(typeof fingerCritMultiplier==='function')?fingerCritMultiplier():1;
      const clickEV=raw*(1+cc*(cm-1)); // 会心は低率×特大なので期待値で見る
      const activePerSec=base+clickEV*TPS;
      const counts={}; Object.keys(state.upgrades).forEach(k=>{ if(state.upgrades[k]>0)counts[k]=state.upgrades[k]; });
      out.push({budget:Bs, bought, fingers:state.upgrades.finger||0,
        research:Object.keys(state.research).filter(k=>state.research[k]).length,
        baseCps:base, clickEV, tapPerSec:clickEV*TPS, critRate:cc, critMul:cm,
        ratio: base>0?(activePerSec/base):Infinity, tiers:Object.keys(counts).length});
    }
    return out;
  },{TPS,BUDGETS});
  console.log(`TPS=${TPS} (能動/放置比 = (baseCps + 会心期待値込みクリック威力×TPS) / baseCps)`);
  console.log('盤面の作り方: 予算をROI貪欲で使い切る(実プレイヤの購入判断)・研究は買えるものを即買い');
  for(const r of R) console.log(`予算${r.budget}: 設備${r.bought}台(種${r.tiers}・強い指${r.fingers})研究${r.research}件 | `
    +`放置${r.baseCps.toExponential(2)}/s タップ${r.tapPerSec.toExponential(2)}/s `
    +`(会心${(r.critRate*100).toFixed(1)}%×${r.critMul.toFixed(1)}) → 能動/放置=${r.ratio.toFixed(2)}×`);
  console.log('注: ROI貪欲は「強い指」を厚く買う(価値/費用が高い)ので、この比は能動寄りビルドの上限側。');
  console.log('   予算1e4はcps設備0台=収入が100%能動なので比はInfinity(ゲーム開始直後の事実)。');
  console.log('参照(実プレイ実測・正典stage2ドライバ=ノルマ駆動の混合ビルド): 能動/放置=1.84×');
  console.log('errs:',errs.length, errs.slice(0,2).join(' | '));
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
