// open_playthrough.js の ops.json + スクショから実況HTMLを生成(画面を出し、その下に実況・操作ごと)。
// 実行: SRC=/path/out CUT=60 HTMLOUT=/path/op_jikkyo.html node sim/tools/open_report.js
const fs=require('fs'), path=require('path'), os=require('os');
const DIR=process.env.SRC||path.join(os.tmpdir(),'open_playthrough');
const OUT=process.env.HTMLOUT||path.join(DIR,'op_jikkyo.html');
const CUT=Number(process.env.CUT||0);
let ops=JSON.parse(fs.readFileSync(DIR+'/ops.json','utf8'));
if(CUT>0)ops=ops.slice(0,CUT);
// 通し実況が長くなったら間引く(2026-07-26 ステージ3到達で356ブロック=23MBになったため)。
// 間引くのは繰り返しの同種ブロックだけで、山(ステージ解放・守護ボス・転生・スキル・研究・狩り・
// 離席・初出の設備)は必ず残す=読んで進行が追える形を保つ。KEEPALL=1 で無効化。
const MAXENT=Number(process.env.MAXENT||120);
let TOTAL=0; // 間引き前の総操作数(表示を嘘にしないため保持)
if(!process.env.KEEPALL && ops.length>MAXENT){
  const must=/守護ボス|を解放|^転生|^スキル|^研究|^装備|^料理|^注文|座って狩る|狩ったが倒せない|^離席|タイトル|周回を開始/;
  const seen=new Set(); const keep=new Array(ops.length).fill(false);
  ops.forEach((o,i)=>{ const key=o.op.replace(/\(.*/,'').replace(/[0-9]+/g,'N');
    if(must.test(o.op)){keep[i]=true;return;}          // 山は全部残す
    if(!seen.has(key)){seen.add(key);keep[i]=true;} }); // 初出は残す
  // 残り枠は等間隔で埋める(進行の連続感を保つ)
  let room=MAXENT-keep.filter(Boolean).length;
  if(room>0){ const rest=ops.map((o,i)=>i).filter(i=>!keep[i]);
    const stride=Math.max(1,Math.ceil(rest.length/room));
    for(let k=0;k<rest.length&&room>0;k+=stride){ keep[rest[k]]=true; room--; } }
  const before=ops.length; TOTAL=before; ops=ops.filter((_,i)=>keep[i]);
  console.log(`間引き: ${before} → ${ops.length} ブロック(山は全部・初出は全部・残りは等間隔)`);
}
const b64=n=>'data:image/jpeg;base64,'+fs.readFileSync(DIR+'/'+n+'.jpg').toString('base64');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// 到達の要約は**間引き前の全操作から数える**(2026-07-27)。以前は footer に前回の実測値を手書きしていて、
// 撮り直すたびに古い数字が残る=同じ「明示列挙の腐り」。数えるのはツールの仕事。
const REACH=(()=>{
  const all=JSON.parse(fs.readFileSync(DIR+'/ops.json','utf8'));
  const n=re=>all.filter(o=>re.test(o.op)).reduce((s,o)=>s+(o.count||1),0);
  const parts=[];
  const stg=n(/を解放/), boss=n(/守護ボス撃破/), pres=n(/^転生/), sk=n(/^スキル/), kills=n(/モンスターを討伐/),
    eq=n(/^装備/), dish=n(/^料理/), ord=n(/^注文を達成/), res=n(/^研究/), gold=n(/金クッキーを回収/);
  // 狩りセッション中の討伐は1ブロックにまとまる(内訳はクエスト進捗に出る)ので、
  // 「実況に単発で出た討伐数」だけを討伐として数え、進行はクエストの最終値で示す=数字を嘘にしない。
  const hunt=all.filter(o=>/座って狩る/.test(o.op)).length;
  let qLast=null; for(const o of all){ const m=/クエスト\s*(\d+)\/(\d+)/.exec(o.op); if(m)qLast=m[1]+'/'+m[2]; }
  if(kills)parts.push(`単発の討伐${kills}体`);
  if(hunt)parts.push(`狩りセッション${hunt}回${qLast?`（討伐クエスト最終${qLast}）`:''}`);
  if(gold)parts.push(`金クッキー${gold}枚`);
  if(res)parts.push(`研究${res}件`);
  if(boss)parts.push(`守護ボス撃破${boss}回`);
  if(stg)parts.push(`ステージ解放${stg}回`);
  if(pres)parts.push(`転生${pres}回`);
  if(sk)parts.push(`スキル${sk}個`);
  if(eq)parts.push(`装備の作成/装着${eq}回`);
  if(dish)parts.push(`料理${dish}品`);
  if(ord)parts.push(`注文達成${ord}件`);
  const lastAll=all[all.length-1];
  return parts.join(' / ')+`（ゲーム内${lastAll?lastAll.t:'-'}・全${all.length}ブロック）`;
})();
const kind=op=>{
  // ステージ解放・守護ボスは実況の山なので独自区分にする(2026-07-26 狩りセッション追加に合わせて。
  // 入れないと「設備」に落ちて嘘になる=離席のときと同じ取り違え)
  if(/守護ボス|を解放/.test(op))return['ステージ','stg'];
  if(/座って狩る|狩ったが倒せない/.test(op))return['狩り','hunt'];
  // 料理・注文は「設備」に落とすと嘘になる(離席・ステージのときと同じ取り違え)。2026-07-27 に区分を追加。
  if(/料理/.test(op))return['料理','dish'];
  if(/注文/.test(op))return['注文','ord'];
  if(/転生/.test(op))return['転生','p']; if(/スキル/.test(op))return['スキル','s']; if(/装備/.test(op))return['装備','e'];
  if(/研究/.test(op))return['研究','r']; if(/討伐|モンスター/.test(op))return['討伐','m']; if(/金クッキー/.test(op))return['金','g'];
  if(/報酬/.test(op))return['報酬','w']; if(/タップ/.test(op))return['タップ','t']; if(/開始/.test(op))return['開始','o'];
  // 離席/放置は「設備」に落とすと嘘になる(何も買っていない)ので独自区分にする(2026-07-26 離席モデル追加に合わせて)
  if(/放置|離席/.test(op))return['放置','idle'];
  return['設備','b']; };
const entries=ops.map((o,i)=>{ const cnt=o.count>0?`<span class="count">×${o.count}</span>`:''; const [kl,kc]=kind(o.op);
  return `<article class="op"><figure class="shot"><img src="${b64(o.n)}" alt="${esc(o.op)}の画面" loading="lazy" width="430" height="780"></figure>`
    +`<div class="say"><div class="meta"><span class="tag t-${kc}">${kl}</span><span class="step">#${i+1}</span><span class="time">${esc(o.t)}</span></div>`
    +`<h2 class="what">${esc(o.op)}${cnt}</h2></div></article>`; }).join('\n');
const last=ops[ops.length-1];
const html=`<div class="wrap"><header class="head"><p class="eyebrow">実プレイ実況 — 実機・自然順・現実時間・操作ごと</p>`
+`<h1>クッキーストラテジャー<span>実際のプレイを、最初から・操作ひとつずつ（${TOTAL?`全${TOTAL}操作から${ops.length}を抜粋`:`${ops.length}操作`}／ゲーム内${esc(last.t)}）</span></h1>`
+`<p class="lede">実機ブラウザで<strong>そのまま遊んだ操作列</strong>（注入・並べ替え無し）を合成クロックで短時間に再現。画面を一つ出し、その下に実況。連続した同じ操作は<strong>ひとつにまとめ</strong>、画像は<strong>最後の場面</strong>、各行に<strong>ゲーム内の経過時間</strong>と<strong>回数</strong>。${TOTAL?'長くなったので<strong>山（ステージ解放・守護ボス・転生・スキル・研究・狩り）は全部残し</strong>、繰り返しの同種ブロックだけ等間隔で間引いている。':''}</p></header>`
+`<div class="stream">${entries}</div>`
+`<footer class="foot"><strong>ここまでが「実プレイでそのまま撮れた範囲」</strong>。芯の輪（タップ→討伐→報酬→金→設備→研究）が回って数値が伸び、<strong>討伐クエストを埋めて守護ボスを倒す→次のステージが開く</strong>という長期目標がそのまま進む。この通しで実際に起きたこと（注入なし・間引き前の全操作から集計）: <strong>${esc(REACH)}</strong>。ドライバは「次のステージが討伐の残りだけで開くなら離れずに座って狩る／終わったら離れて貯める」「新しいシステムが開くスキルは安ければ先に取る」「作った装備は実際に伸びる方を着ける」という実プレイヤの判断で動いている。全6ステージ・75スキル・6ティア装備・無限深層の完走はさらに先で、そこは現実で長い設計（転生=1e9クッキー）。各操作の実画面で「作りとして気持ちいいか」を確認するためのもの。</footer></div>`;
const css=`:root{--bg:#F7F3EC;--panel:#FFFDF9;--ink:#241E18;--muted:#786B5C;--line:#E7DECF;--accent:#C67A1E;--accent-soft:#F2E5CE;--chip:#F1EADD;--shadow:0 1px 2px rgba(70,45,15,.05),0 10px 26px rgba(70,45,15,.07);}
@media (prefers-color-scheme:dark){:root{--bg:#14110D;--panel:#1E1913;--ink:#F0E8DB;--muted:#A79883;--line:#332A1E;--accent:#E4A94D;--accent-soft:#382A16;--chip:#241D15;--shadow:0 1px 2px rgba(0,0,0,.45),0 12px 30px rgba(0,0,0,.5);}}
:root[data-theme="light"]{--bg:#F7F3EC;--panel:#FFFDF9;--ink:#241E18;--muted:#786B5C;--line:#E7DECF;--accent:#C67A1E;--accent-soft:#F2E5CE;--chip:#F1EADD;}
:root[data-theme="dark"]{--bg:#14110D;--panel:#1E1913;--ink:#F0E8DB;--muted:#A79883;--line:#332A1E;--accent:#E4A94D;--accent-soft:#382A16;--chip:#241D15;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:0 auto;padding:40px 18px 76px}.head{border-bottom:1px solid var(--line);padding-bottom:26px}
.eyebrow{margin:0 0 10px;font-size:11.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--accent);font-weight:800}
.head h1{margin:0;font-size:31px;line-height:1.16;font-weight:800;letter-spacing:-.01em;text-wrap:balance}
.head h1 span{display:block;font-size:15px;font-weight:600;color:var(--muted);margin-top:9px;letter-spacing:0}
.lede{margin:17px 0 0;color:var(--muted);font-size:14.5px;max-width:60ch}.lede strong{color:var(--ink);font-weight:700}
.stream{display:flex;flex-direction:column;gap:16px;margin-top:26px}
.op{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px 16px 18px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:13px}
.shot{margin:0;display:flex;justify-content:center}.shot img{width:250px;max-width:82%;height:auto;display:block;border-radius:14px;border:1px solid var(--line);box-shadow:0 2px 6px rgba(0,0,0,.12)}
.say{min-width:0}.meta{display:flex;align-items:center;gap:9px;margin-bottom:5px}
.tag{font-size:11px;font-weight:800;border-radius:7px;padding:2px 8px;color:#fff;line-height:1.5}
.t-o{background:#8a7a5c}.t-t{background:#c77f2b}.t-b{background:#4f7d5a}.t-m{background:#b04a3a}.t-w{background:#9a6cae}.t-g{background:#c9a227;color:#2a2210}.t-r{background:#3f7391}.t-p{background:#7a4fae}.t-s{background:#2f8a7a}.t-e{background:#6d6a8c}.t-idle{background:#6b7a86}.t-stg{background:#c2562e;color:#fff}.t-hunt{background:#8f3f30}.t-dish{background:#a4527a}.t-ord{background:#4a6f8f}
.step{font-size:11px;font-variant-numeric:tabular-nums;color:var(--muted);font-weight:700}
.time{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:800;color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:3px 11px;font-size:12.5px}
.what{margin:0;font-size:18px;font-weight:750;line-height:1.35;text-wrap:balance}
.count{display:inline-block;margin-left:8px;font-size:12.5px;font-weight:800;color:var(--muted);background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:1px 8px;vertical-align:middle;font-variant-numeric:tabular-nums}
.foot{margin-top:30px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;max-width:60ch}
@media (max-width:520px){.shot img{width:210px}.head h1{font-size:26px}}`;
fs.writeFileSync(OUT, `<style>${css}</style>\n${html}`);
console.log('wrote',OUT,'entries:',ops.length,'size:',(Buffer.byteLength(fs.readFileSync(OUT))/1024/1024).toFixed(2)+'MB');
