// 提案8の係数掃引: params の trialCoef/trialStartLayer を実行時に差し替え、全方針で
// T3a(未達が先)の full/full と未達位置中央値を測る。目標: 全方針で T3a=満点かつ位置が50〜100%。
// 各点ごとに結果を OUT ファイルへ追記(進捗が見える・バッファ消失しない)。
// 【廃止 2026-07-27】この掃引の対象(層の試練 trialCoef/trialStartLayer)はユーザー指示
// 「ノルマは経過秒でのみ変化」で機構ごと撤去済み(params からキーも削除)。走らせても何も変わらない(記録として残置)。
if (!process.env.RUN_OBSOLETE) {
  console.log('[廃止] 層の試練は撤去済み(2026-07-27)。この掃引は何も変えません。RUN_OBSOLETE=1 で強制実行。');
  process.exit(0);
}

const fs = require('fs');
const P = require('./params.js');
const G = require('./sim.js');
const { STRATEGIES } = require('./strategies.js');
const hours = Number(process.env.HOURS || 40);
const OUT = process.env.OUT || '/home/user/exist-debug/sim/results/sweep8.txt';
const only = process.env.STRATS ? process.env.STRATS.split(',') : null;
const strats = STRATEGIES.filter(s => !only || only.includes(s.id));
function med(a){ if(!a.length) return null; const b=a.slice().sort((x,y)=>x-y); const m=b.length>>1; return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function emit(s){ fs.appendFileSync(OUT, s + '\n'); }
const grid = (process.argv[2] || '0.08,10;0.5,3;0.5,1;1,3;1,1;2,3;2,1;2,0;4,1;4,0').split(';').map(s=>{const [c,st]=s.split(',').map(Number);return {c,st};});
emit(`# sweep8  hours=${hours}  strats=${strats.map(s=>s.id).join(',')}  ${new Date === undefined ? '' : ''}`);
for (const g of grid){
  P.quota.trialCoef = g.c; P.quota.trialStartLayer = g.st;
  const parts=[]; let totFail=0, totRun=0; const allPos=[];
  for (const s of strats){
    const sim = G.simulate(s, { hours });
    const full = sim.runs.filter(r=>!r.partial);
    let ok=0; const pos=[];
    for (const r of full){ if(r.quotaFailAt!=null && r.quotaFailAt<r.duration){ ok++; const p=r.quotaFailAt/r.duration; pos.push(p); allPos.push(p);} }
    totFail+=ok; totRun+=full.length;
    const mp=med(pos);
    parts.push(`${s.id}=${ok}/${full.length}${mp==null?'':'@'+(mp*100).toFixed(0)+'%'}`);
  }
  const gmp=med(allPos);
  emit(`coef=${String(g.c).padStart(4)} start=${String(g.st).padStart(2)} | 全体 ${totFail}/${totRun} 位置中央値${gmp==null?'-':(gmp*100).toFixed(0)+'%'}`);
  emit('        ' + parts.join('  '));
}
emit('# done');
