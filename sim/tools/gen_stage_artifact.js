// 実況アーティファクト生成: stage_playthrough.js の ops.json + 画面を、暖色トークンの縦積みHTMLに。
// 各操作=画面を一つ出し、その下に実況(事象カテゴリの色チップ・現実プレイ時間・回数)。画像はdata URIで自己完結。
// 実行: SRC=/out HTMLOUT=/path.html node sim/tools/gen_stage_artifact.js
const fs=require('fs');
const DIR=process.env.SRC||'/tmp/stage_playthrough';
const OUT=process.env.HTMLOUT||'/tmp/stage_jikkyo.html';
let ops=JSON.parse(fs.readFileSync(DIR+'/ops.json','utf8'));
const b64=n=>'data:image/jpeg;base64,'+fs.readFileSync(DIR+'/'+n+'.jpg').toString('base64');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const kind=op=>{
  if(/守護ボス撃破！ステージ/.test(op))return['ステージ','stg']; // 解放の瞬間はステージ扱い(強調枠)
  if(/ボス/.test(op))return['ボス','boss'];
  if(/会心/.test(op))return['会心','crit'];
  if(/実績/.test(op))return['実績','ach'];
  if(/クエスト|ステージ/.test(op))return['ステージ','stg'];
  if(/転生/.test(op))return['転生','p'];
  if(/スキル/.test(op))return['スキル','s'];
  if(/装備/.test(op))return['装備','e'];
  if(/研究/.test(op))return['研究','r'];
  if(/討伐|モンスター/.test(op))return['討伐','m'];
  if(/報酬/.test(op))return['報酬','w'];
  if(/金クッキー/.test(op))return['金','g'];
  if(/放置|離席/.test(op))return['放置','idle']; // 離席=open_playthroughの「離れて戻る」ブロック
  if(/タップ/.test(op))return['タップ','t'];
  if(/開始/.test(op))return['開始','o'];
  return['設備','b'];
};
const entries=ops.map((o,i)=>{
  const cnt=o.count>0?`<span class="count">×${o.count}</span>`:'';
  const [kl,kc]=kind(o.op);
  const hi=(kc==='stg'||kc==='boss')?' op-hi':'';
  return `<article class="op${hi}">
    <figure class="shot"><img src="${b64(o.n)}" alt="${esc(o.op)}の画面" loading="lazy" width="430" height="780"></figure>
    <div class="say">
      <div class="meta"><span class="tag t-${kc}">${kl}</span><span class="step">#${i+1}</span><span class="time">${esc(o.t)}</span></div>
      <h2 class="what">${esc(o.op)}${cnt}</h2>
    </div>
  </article>`;
}).join('\n');
const last=ops[ops.length-1];
const html=`<div class="wrap">
  <header class="head">
    <p class="eyebrow">実プレイ実況 — 手を動かし切った効率的な一周・実プレイと同じ結果を短時間で</p>
    <h1>クッキーストラテジャー<span>最初 → 初転生 → スキル → ステージ2「チョコレート火山」到達（${ops.length}操作／プレイ時間 ${esc(last.t)}）</span></h1>
    <p class="lede">一般的な人間プレイヤーの範疇で、<strong>手を動かし切った効率的な一周</strong>を注入・並べ替え無しで再現（＝出た金クッキーは回収し、湧いた敵は狩り、設備・研究は価値順に買う"熱心な"プレイ。超人的ではない）。<strong>手を動かす所は本物どおり</strong>（タップ／討伐／報酬／金クッキー／設備・研究の購入）。<strong>討伐はゲーム実タイマーのモンスター出現を発火</strong>＝出現のcadenceもノルマ判定も本物のまま、放置区間は<strong>ゲーム自身の放置生産で一発計算</strong>。「遊ぶ→離れて戻る」を繰り返し、討伐数は転生を跨いで累積＝<strong>クエスト100体でステージ2が解放</strong>。プレイ時間<strong>${esc(last.t)}</strong>ぶんの歩みを実時間わずか約30秒で収録。画面を一つ出し、その下に実況。連続した同じ操作はまとめ、画像は最後の場面、各行に現実プレイ時間と回数。</p>
  </header>
  <div class="stream">
${entries}
  </div>
  <footer class="foot">序盤の芯の輪（タップ→討伐→報酬→金→設備）で毎秒生産を立ち上げ、<strong>放置</strong>で厚く貯めてから<strong>モンスターを狩る</strong>——これを転生で繰り返す。討伐数は転生を跨いで貯まり、<strong>累計100体でクエスト達成＝ステージ2「チョコレート火山」が解放</strong>。ここまでを実プレイと同じ手順・同じ結果で、プレイ時間${esc(last.t)}ぶんを短時間で通した。<strong>ステージ2までがプレイ時間約1ヶ月の正直な到達点</strong>——ステージ3以降は転生費が1回ごとに1億倍ずつ跳ね上がるロングテール設計で、どんな熱心な人間プレイでも実プレイ時間は月〜年単位になる(能動プレイの上積みも実測1.8倍程度=壁を桁で縮めるものではない)。これはidleジャンルの意図的な長期壁であり、収録の限界ではない。各操作の実画面で「作りとして気持ちいいか」を確認するためのもの。</footer>
</div>`;
const css=`
:root{
  --bg:#F7F3EC; --panel:#FFFDF9; --ink:#241E18; --muted:#786B5C; --line:#E7DECF;
  --accent:#C67A1E; --accent-soft:#F2E5CE; --chip:#F1EADD;
  --shadow:0 1px 2px rgba(70,45,15,.05),0 10px 26px rgba(70,45,15,.07);
}
@media (prefers-color-scheme:dark){:root{
  --bg:#14110D; --panel:#1E1913; --ink:#F0E8DB; --muted:#A79883; --line:#332A1E;
  --accent:#E4A94D; --accent-soft:#382A16; --chip:#241D15;
  --shadow:0 1px 2px rgba(0,0,0,.45),0 12px 30px rgba(0,0,0,.5);
}}
:root[data-theme="light"]{--bg:#F7F3EC;--panel:#FFFDF9;--ink:#241E18;--muted:#786B5C;--line:#E7DECF;--accent:#C67A1E;--accent-soft:#F2E5CE;--chip:#F1EADD;--shadow:0 1px 2px rgba(70,45,15,.05),0 10px 26px rgba(70,45,15,.07);}
:root[data-theme="dark"]{--bg:#14110D;--panel:#1E1913;--ink:#F0E8DB;--muted:#A79883;--line:#332A1E;--accent:#E4A94D;--accent-soft:#382A16;--chip:#241D15;--shadow:0 1px 2px rgba(0,0,0,.45),0 12px 30px rgba(0,0,0,.5);}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font-family:ui-sans-serif,system-ui,-apple-system,"Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif;
  line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:600px;margin:0 auto;padding:40px 18px 76px}
.head{border-bottom:1px solid var(--line);padding-bottom:26px}
.eyebrow{margin:0 0 10px;font-size:11.5px;letter-spacing:.15em;text-transform:uppercase;color:var(--accent);font-weight:800}
.head h1{margin:0;font-size:31px;line-height:1.16;font-weight:800;letter-spacing:-.01em;text-wrap:balance}
.head h1 span{display:block;font-size:15px;font-weight:600;color:var(--muted);margin-top:9px;letter-spacing:0}
.lede{margin:17px 0 0;color:var(--muted);font-size:14.5px;max-width:60ch}
.lede strong{color:var(--ink);font-weight:700}
.stream{display:flex;flex-direction:column;gap:16px;margin-top:26px}
.op{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:16px 16px 18px;box-shadow:var(--shadow);
  display:flex;flex-direction:column;gap:13px}
.op-hi{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft),var(--shadow)}
.shot{margin:0;display:flex;justify-content:center}
.shot img{width:250px;max-width:82%;height:auto;display:block;border-radius:14px;border:1px solid var(--line);
  box-shadow:0 2px 6px rgba(0,0,0,.12)}
.say{min-width:0}
.meta{display:flex;align-items:center;gap:9px;margin-bottom:5px}
.tag{font-size:11px;font-weight:800;letter-spacing:.02em;border-radius:7px;padding:2px 8px;color:#fff;line-height:1.5}
.t-o{background:#8a7a5c}.t-t{background:#c77f2b}.t-b{background:#4f7d5a}.t-m{background:#b04a3a}
.t-w{background:#9a6cae}.t-g{background:#c9a227;color:#2a2210}.t-r{background:#3f7391}.t-p{background:#7a4fae}
.t-s{background:#2f8a7a}.t-e{background:#6d6a8c}.t-idle{background:#6b7a86}.t-stg{background:#c0562e}.t-boss{background:#b3132e}.t-ach{background:#b8860b}.t-crit{background:#d4a017;color:#2a2210}
.step{font-size:11px;font-variant-numeric:tabular-nums;color:var(--muted);font-weight:700}
.time{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:800;color:var(--accent);
  background:var(--accent-soft);border-radius:999px;padding:3px 11px;font-size:12.5px}
.what{margin:0;font-size:18px;font-weight:750;line-height:1.35;text-wrap:balance}
.count{display:inline-block;margin-left:8px;font-size:12.5px;font-weight:800;color:var(--muted);
  background:var(--chip);border:1px solid var(--line);border-radius:8px;padding:1px 8px;vertical-align:middle;font-variant-numeric:tabular-nums}
.foot{margin-top:30px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px;max-width:60ch}
@media (max-width:520px){.shot img{width:210px}.head h1{font-size:26px}}
`;
fs.writeFileSync(OUT, `<style>${css}</style>\n${html}`);
const bytes=Buffer.byteLength(fs.readFileSync(OUT));
console.log('wrote',OUT,'entries:',ops.length,'size:',(bytes/1024/1024).toFixed(2)+'MB');
