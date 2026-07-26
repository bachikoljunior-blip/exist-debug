// 批判監査(dim4/6): 数値フォーマッタと実HUDを極大値で叩く。NaN/Infinity/[object]/undefined/空/壊れ表示を洗う。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',headless:true});
  const p=await b.newPage({viewport:{width:430,height:780}});
  const issues=[]; p.on('console',m=>{const t=m.type();if(t==='error'||t==='warning')issues.push(t+':'+m.text().slice(0,120));});
  p.on('pageerror',e=>issues.push('PAGEERR:'+e.message.slice(0,120)));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html',{waitUntil:'load',timeout:60000});
  await p.clock.runFor(1500); await p.click('#audioGate').catch(()=>{}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(()=>{}); await p.clock.runFor(800);
  const R=await p.evaluate(()=>{
    const bad=[]; const isBad=s=>{ s=String(s); return /NaN|Infinity|undefined|\[object|null/.test(s)||s.trim()===''; };
    // 1) 全フォーマッタを 1e0..1e308 で叩く
    // 定義域は関数ごとに分ける(2026-07-26 修正)。旧実装は fmtTime にも 1e308「秒」を渡して
    // Infinity:NaN:NaN を6件BADとして出していたが、fmtTime の呼び出し元は注文タイマー/バフ残り/
    // ノルマ保持秒だけで、いずれも実タイマー由来の有界値=定義域外の誤警報だった(常時赤は判定を
    // 無視する訓練になるので潰す)。極大値で叩くべきはクッキー量のフォーマッタ。
    const bigFmts=['fmt','fmtShort','fmtShortJapaneseUnitNumber','fmtSixSigMantissa'];
    const mags=[0,1,3,6,9,12,15,30,60,100,150,200,250,300,308];
    let tested=0;
    for(const fn of bigFmts){ if(typeof window[fn]!=='function')continue;
      for(const m of mags)for(const mant of [1.23456,4.759,9.9999,1.0001,3.14159]){ const v=mant*Math.pow(10,m);
        let out; try{ out=window[fn](typeof D==='function'?D(v):v); }catch(e){ out='ERR:'+e.message; }
        tested++; if(isBad(out)||/ERR:/.test(String(out))) bad.push(`${fn}(1e${m})=${out}`);
      }
    }
    // 時間表示は「現実に渡り得る秒」で叩く(0秒〜約31年。注文間隔/バフ/ノルマ保持の実上限を十分に超える)
    if(typeof window.fmtTime==='function'){
      for(const v of [0,0.4,1,59,60,61,3599,3600,3601,86399,86400,1e6,1e9]){
        let out; try{ out=fmtTime(v); }catch(e){ out='ERR:'+e.message; }
        tested++; if(isBad(out)||/ERR:/.test(String(out))) bad.push(`fmtTime(${v})=${out}`);
      }
    }
    // 文字列後処理は「実際に渡る整形済み文字列」で叩く
    if(typeof window.spaceAfterDecimalPoint==='function'){
      const srcs=['0','1','1.5','1234','1.23e+45','1000幻星冥河紋','12.34兆','-0.5'];
      for(const v of srcs){ let out; try{ out=spaceAfterDecimalPoint(v); }catch(e){ out='ERR:'+e.message; }
        tested++; if(isBad(out)||/ERR:/.test(String(out))) bad.push(`spaceAfterDecimalPoint("${v}")=${out}`); }
    }
    // 2) 実HUDを極大state で描画→表示文字列を検査
    try{ debugMode=true; state.cookies=D('1e250'); state.runCookies=D('1e250'); state.totalCookies=D('1e250');
      for(const u of UPGRADES){state.upgrades[u.id]=200;} state.prestige=1e9; state.prestigeTotal=1e9; state.stageUnlocked=6;
      if(typeof updateTopOnly==='function')updateTopOnly(); if(typeof renderAllTabs==='function')renderAllTabs();
    }catch(e){bad.push('SETUP:'+e.message);}
    // 実在しないidを黙って読み飛ばしていた(cookieCount/cps は存在せず検査が空振り)。
    // 実idに直し、要素が見つからない場合も欠陥として報告する(検査が無言で消えないように)。
    const ids=['cookies','cookieCps','message'];
    for(const id of ids){ const el=document.getElementById(id);
      if(!el){ bad.push(`#${id} が存在しない(検査が空振りしている)`); continue; }
      if(isBad(el.textContent)) bad.push(`#${id}="${el.textContent.slice(0,40)}"`); }
    // 強化カード/研究カードの表示文字列
    const cards=[...document.querySelectorAll('#shopTab, #researchTab, #prestigeTab')].map(e=>e.textContent).join(' ');
    if(/NaN|Infinity|undefined|\[object/.test(cards)) bad.push('CARD text has bad token');
    return {tested, badCount:bad.length, bad:bad.slice(0,20)};
  });
  console.log('formatter/HUD tests:',R.tested,'| BAD:',R.badCount);
  R.bad.forEach(x=>console.log('  BAD:',x));
  console.log('console/page issues:',[...new Set(issues)].length, [...new Set(issues)].slice(0,4).join(' | '));
  await b.close();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
