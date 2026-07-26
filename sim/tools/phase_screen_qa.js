// P2全画面一巡QA: 進行フェーズ(タイトル/最序盤/序盤/中盤/深層/エンド)ごとにメイン画面を構成して撮影し、
// 機械検査(可視テキストのNaN/undefined/Infinity・横はみ出し・主要ラベル空)+目視用スクショを出す再現機構。
// 実行: OUT=/out node sim/tools/phase_screen_qa.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path=require('path'), os=require('os'), fs=require('fs');
const INDEX=process.env.GAME_INDEX||path.resolve(__dirname,'../../index.html');
const DIR=process.env.OUT||path.join(os.tmpdir(),'phase_screen_qa'); fs.mkdirSync(DIR,{recursive:true});
(async()=>{
  const b=await chromium.launch({executablePath:process.env.PW_CHROMIUM||'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  const errs=[];p.on('pageerror',e=>errs.push(e.message.slice(0,120)));
  await p.clock.install();
  await p.goto('file://'+INDEX,{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500); await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(700);

  const inspect=async(name)=>{
    await p.clock.runFor(4000); // ステージ移動直後の画面遷移フラッシュ(~2-3s)を跨いで安定画面を撮る
    const r=await p.evaluate(()=>{
      const bad=[]; const walk=(el)=>{ if(!el||el.offsetParent===null&&el.tagName!=='BODY')return;
        for(const c of el.children)walk(c);
        if(el.children.length===0){ const t=(el.textContent||'').trim();
          if(t && /\b(NaN|undefined|Infinity|null)\b/.test(t)) bad.push((el.id||el.className||el.tagName)+': '+t.slice(0,60)); } };
      walk(document.body);
      // はみ出し検査(2026-07-26修正): 旧セレクタ'#game *'は#game不在で空振り=検査が形骸化していた。
      // body全域を走査し、横スクロール容器(overflow-x:auto/scroll/hidden)内の要素は内部スクロール=設計として除外。
      const inScroller=(el)=>{ for(let e2=el.parentElement;e2&&e2!==document.body;e2=e2.parentElement){
        const ox=getComputedStyle(e2).overflowX; if(ox==='auto'||ox==='scroll'||ox==='hidden')return true; } return false; };
      const wide=[]; for(const el of document.querySelectorAll('body *')){
        if(el.offsetParent===null)continue; const r2=el.getBoundingClientRect();
        if(r2.width>0&&(r2.right>window.innerWidth+6||r2.left<-6)&&!inScroller(el)) { wide.push((el.id||el.className.split(' ')[0]||el.tagName)+'@'+Math.round(r2.left)+'..'+Math.round(r2.right)); if(wide.length>4)break; } }
      // ページ実スクロールは documentElement 基準(bodyのscrollWidthは内部スクロール容器で偽陽性を出す実測)
      return {bad:bad.slice(0,6), wide:wide.slice(0,5), scrollW:document.documentElement.scrollWidth, winW:window.innerWidth};
    });
    await p.screenshot({path:DIR+'/'+name+'.png'});
    const ok = r.bad.length===0 && r.wide.length===0 && r.scrollW<=r.winW+2;
    console.log(`${ok?'OK':'NG'} ${name} badText=${r.bad.length} wide=${r.wide.length} scrollW=${r.scrollW}/${r.winW}`+(r.bad.length?' | '+r.bad.join(' ; '):'')+(r.wide.length?' | '+r.wide.join(' ; '):''));
    return ok;
  };

  let allOk=true;
  // 1) タイトル
  allOk&=await inspect('1_title');
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(900);
  // 2) 最序盤(手つかず)
  allOk&=await inspect('2_earliest');
  // 3) 序盤(数買い+初討伐圏)
  await p.evaluate(()=>{ try{ state.cookies=D(5000); for(let i=0;i<8;i++)buyUpgrade('finger'); for(let i=0;i<3;i++)buyUpgrade('grandma'); }catch(e){} });
  allOk&=await inspect('3_early');
  // 4) 中盤(ステージ2・研究・スキル・1e8圏)
  await p.evaluate(()=>{ try{ debugMode=true;
    state.cookies=D(1e10); state.runCookies=D(1e10);
    ['fingerTechnique','grandmaCrowd','ovenBatch','factoryNetwork','spiceBlend'].forEach(id=>{if(!state.research[id])state.research[id]=true;});
    state.skills=state.skills||{}; ['core','click_1','auto_1','monster_1'].forEach(id=>state.skills[id]=true);
    state.stageUnlocked=2; while(currentStageNo()<2)moveStageBy(1);
    for(let i=0;i<40;i++){buyUpgrade('oven');buyUpgrade('factory');}
    debugMode=false; renderAllTabs&&renderAllTabs(); }catch(e){console.log('SETUP4',e.message);} });
  allOk&=await inspect('4_mid');
  // 5) 深層(stage6・深層第3層・大数)
  await p.evaluate(()=>{ try{ debugMode=true;
    state.cookies=D('1e60'); state.runCookies=D('1e60'); state.stageUnlocked=6; state.deepLayer=3;
    while(currentStageNo()<6)moveStageBy(1); applyStageTheme&&applyStageTheme();
    debugMode=false; renderAllTabs&&renderAllTabs(); }catch(e){console.log('SETUP5',e.message);} });
  allOk&=await inspect('5_deep');
  // 6) エンド(極大数・深層深部)
  await p.evaluate(()=>{ try{ debugMode=true;
    state.cookies=D('1e300'); state.runCookies=D('1e300'); state.deepLayer=50; applyStageTheme&&applyStageTheme();
    state.prestigePoints=Math.floor(9e9); debugMode=false; renderAllTabs&&renderAllTabs(); updateTopOnly&&updateTopOnly(); }catch(e){console.log('SETUP6',e.message);} });
  allOk&=await inspect('6_end');

  console.log(`DONE allOk=${!!allOk} pageerrors=${errs.length}`, errs.slice(0,3).join(' | '));
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
