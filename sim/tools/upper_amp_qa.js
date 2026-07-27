// 上位設備の増幅研究7件が「実際に直送収入を倍率どおり動かす」ことの実機確認(2026-07-27)。
// 移植の自己検査: コードを入れただけで満足せず、研究ONで directIncomeTotalCps() が表の倍率どおり動くかを測る。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const p = await b.newPage({ viewport: { width: 430, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html', { waitUntil: 'load', timeout: 60000 });
  await p.clock.runFor(1200); await p.click('#audioGate').catch(() => {});
  await p.clock.runFor(600); await p.click('#titleStartBtn').catch(() => {});
  await p.clock.runFor(800);
  const r = await p.evaluate(() => {
    // 直送が立つ状態を作る(段階2のゲートを満たし、設備と層を持たせる)
    const pin = Date.now; Date.now = () => 1700000000000; // 測定中は時刻を固定(判定器の揺れ対策)
    try {
      state.maxQuotaStage = 30;
      for (const id of ['oven','grandma','finger','factory','bank','spiceRack','portal','moonBakery','timeOven','blackHoleMixer','universeOven','cookieSingularity','antimatterOven','godFinger']) state.upgrades[id] = 120;
      for (const r of RESEARCH) state.research[r.id] = true;
      state.researchStages = state.researchStages || {};
      for (const r of RESEARCH) state.researchStages[r.id] = 3;
      state.skills = state.skills || {};
      for (const s of SKILLS) state.skills[s.id] = true;
      for (const id in UPPER_AMP_RES) state.research[id] = false; // 7件はいったんOFF
      // 暖機(2026-07-27): 初回呼び出しはキャッシュ(equip2Fxなど)が冷えていて値が僅かに違う。
      // 暖機せずに基準を取ると、全件の比が同じ係数(実測1.0294)だけ上振れした=判定器側の罠。
      // 直送合計を「毎秒生産で正規化」して測る(2026-07-27 実測でこうしないと判定が嘘になる):
      // このゲームには「研究を1つ持つほど全生産が伸びる」一般効果がある(例: 量子防湿=研究数の指数)。
      // なので研究をONにすると毎秒生産そのものが動き(実測 ×1.0294)、直送のアンカー(=毎秒生産)も動く。
      // 素の直送合計で比を取ると 期待×1.70 に対し ×1.75 と出て、移植のバグに見えてしまった。
      // 直送/毎秒生産 で見ればアンカーの変化が割れて、上位設備の倍率だけが残る。
      const warm = () => Number(directIncomeTotalCps().toString ? directIncomeTotalCps().toString() : directIncomeTotalCps()) / Number(currentCps().toString());
      warm(); warm();
      const base = warm();
      const rows = [];
      for (const id in UPPER_AMP_RES) {
        state.research[id] = true;
        const on = warm();
        state.research[id] = false;
        rows.push({ id, want: 1 + UPPER_AMP_RES[id], got: on / base });
      }
      // 全部ONの複合(積になっているか)
      let wantAll = 1; for (const id in UPPER_AMP_RES) { state.research[id] = true; wantAll *= 1 + UPPER_AMP_RES[id]; }
      const all = warm();
      return { base, rows, all: all / base, wantAll };
    } finally { Date.now = pin; }
  });
  let bad = 0;
  console.log('直送合計(7件OFF)=' + r.base.toExponential(3));
  for (const x of r.rows) {
    const ok = Math.abs(x.got / x.want - 1) < 1e-9;
    if (!ok) bad++;
    console.log(`  ${ok ? 'OK' : 'NG'} ${x.id.padEnd(18)} 期待×${x.want.toFixed(2)} 実測×${x.got.toFixed(6)}`);
  }
  const okAll = Math.abs(r.all / r.wantAll - 1) < 1e-9;
  if (!okAll) bad++;
  console.log(`  ${okAll ? 'OK' : 'NG'} 7件同時         期待×${r.wantAll.toFixed(3)} 実測×${r.all.toFixed(6)}`);
  console.log('不一致=' + bad + ' pageerrors=' + errs.length);
  await b.close();
  if (bad || errs.length) process.exit(1);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
