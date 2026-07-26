// open_playthrough.js の ops.json + スクショから実況HTMLを生成(画面を出し、その下に実況・操作ごと)。
// 実行: SRC=/path/out CUT=60 HTMLOUT=/path/op_jikkyo.html node sim/tools/open_report.js
const fs=require('fs'), path=require('path'), os=require('os');
const DIR=process.env.SRC||path.join(os.tmpdir(),'open_playthrough');
const OUT=process.env.HTMLOUT||path.join(DIR,'op_jikkyo.html');
const CUT=Number(process.env.CUT||0);
let ops=JSON.parse(fs.readFileSync(DIR+'/ops.json','utf8'));
if(CUT>0)ops=ops.slice(0,CUT);
const b64=n=>'data:image/jpeg;base64,'+fs.readFileSync(DIR+'/'+n+'.jpg').toString('base64');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const kind=op=>{ if(/転生/.test(op))return['転生','p']; if(/スキル/.test(op))return['スキル','s']; if(/装備/.test(op))return['装備','e'];
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
+`<h1>クッキーストラテジャー<span>実際のプレイを、最初から・操作ひとつずつ（${ops.length}操作／${esc(last.t)}）</span></h1>`
+`<p class="lede">実機ブラウザで<strong>そのまま遊んだ操作列</strong>（注入・並べ替え無し）を合成クロックで短時間に再現。画面を一つ出し、その下に実況。連続した同じ操作は<strong>ひとつにまとめ</strong>、画像は<strong>最後の場面</strong>、各行に<strong>現実プレイ時間</strong>と<strong>回数</strong>。</p></header>`
+`<div class="stream">${entries}</div>`
+`<footer class="foot"><strong>ここまでが「実プレイで短時間に本物として撮れる」範囲</strong>。芯の輪（タップ→討伐→報酬→金→設備）が回り数値が伸びる。ステージ2解放＝討伐100体・転生＝1e9クッキーで現実で長い設計（実測）。全6ステージ・75スキル・6ティア装備・無限深層＝完走は数百時間規模で、実プレイ自動化では序盤しか本物で撮れない（クロック早送りは実時間の約0.3倍コスト）。各操作の実画面で「作りとして気持ちいいか」を確認するためのもの。</footer></div>`;
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
.t-o{background:#8a7a5c}.t-t{background:#c77f2b}.t-b{background:#4f7d5a}.t-m{background:#b04a3a}.t-w{background:#9a6cae}.t-g{background:#c9a227;color:#2a2210}.t-r{background:#3f7391}.t-p{background:#7a4fae}.t-s{background:#2f8a7a}.t-e{background:#6d6a8c}.t-idle{background:#6b7a86}
.step{font-size:11px;font-variant-numeric:tabular-nums;color:var(--muted);font-weight:700}
.time{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:800;color:var(--accent);background:var(--accent-soft);border-radius:999px;padding:3px 11px;font-size:12.5px}
.what{margin:0;font-size:18px;font-weight:750;line-height:1.35;text-wrap:balance}
.count{display:inline-block;margin-left:8px;font-size:12.5px;font-weight:800;color:var(--muted);background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:1px 8px;vertical-align:middle;font-variant-numeric:tabular-nums}
.foot{margin-top:30px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;max-width:60ch}
@media (max-width:520px){.shot img{width:210px}.head h1{font-size:26px}}`;
fs.writeFileSync(OUT, `<style>${css}</style>\n${html}`);
console.log('wrote',OUT,'entries:',ops.length,'size:',(Buffer.byteLength(fs.readFileSync(OUT))/1024/1024).toFixed(2)+'MB');
