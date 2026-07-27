// reachMaxSec(denom上限クランプ)の掃引。T3a full/full と未達位置中央を全方針で測る。
// 【廃止 2026-07-27】この掃引の対象(到達連動ノルマの時間比 reachCoef/reachPow/reachMinSec/reachMaxSec)は
// ユーザー指示「ノルマ前回周回長に依存するのやめて」で機構ごと撤去済み。params からキーも消えているため
// 走らせても未達位置は一切動かない(記録として残置)。未達は reachGainFrac(転生の一歩手前)だけで決まる。
if (!process.env.RUN_OBSOLETE) {
  console.log('[廃止] 到達連動ノルマの時間比は撤去済み(2026-07-27)。この掃引は何も変えません。RUN_OBSOLETE=1 で強制実行。');
  process.exit(0);
}

const fs = require('fs');
const P = require('./params.js');
const G = require('./sim.js');
const { STRATEGIES } = require('./strategies.js');
const hours = Number(process.env.HOURS || 60);
const OUT = process.env.OUT || '/home/user/exist-debug/sim/results/sweep_maxsec.txt';
function med(a){ if(!a.length) return null; const b=a.slice().sort((x,y)=>x-y); const m=b.length>>1; return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function emit(s){ fs.appendFileSync(OUT, s + '\n'); console.log(s); }
const vals = (process.argv[2] || '0;5000;4000;3000;2500').split(';').map(Number);
emit(`# sweep_maxsec hours=${hours} coef=${P.quota.reachCoef} pow=${P.quota.reachPow} min=${P.quota.reachMinSec}`);
for (const mx of vals){
  P.quota.reachMaxSec = mx;
  const parts=[]; let totFail=0, totRun=0; const allPos=[];
  for (const s of STRATEGIES){
    const sim = G.simulate(s, { hours });
    const full = sim.runs.filter(r=>!r.partial);
    let ok=0, t3b=0; const pos=[];
    for (const r of full){
      if(r.quotaFailAt!=null && r.quotaFailAt<r.duration){ ok++; const p=r.quotaFailAt/r.duration; pos.push(p); allPos.push(p);}
      if(r.quotaHold >= 0.5*r.duration) t3b++;
    }
    totFail+=ok; totRun+=full.length;
    const mp=med(pos);
    parts.push(`${s.id}=T3a${ok}/${full.length}${mp==null?'':'@'+(mp*100).toFixed(0)+'%'}/T3b${t3b}`);
  }
  const gmp=med(allPos);
  emit(`maxSec=${String(mx).padStart(5)} | 全体 ${totFail}/${totRun}(${(100*totFail/totRun).toFixed(0)}%) 位置中央${gmp==null?'-':(gmp*100).toFixed(0)+'%'}`);
  emit('        ' + parts.join('  '));
}
emit('# done');
