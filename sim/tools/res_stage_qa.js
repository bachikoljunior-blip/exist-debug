// QA一巡(第4レンズ): 研究の段階2/3が実際に効いているか。
// 今サイクルで「オーブン大量焼成 段階3が恒久×1.00」を1件見つけた領域。残り全段階を実測で当たる。
// 判定器の罠(既知の3つ)を踏まないようにする: freshStateで全キー埋め/観測面は広く/相対許容差でなく
// 「まったく動かない(比==1)」を探す。段階の前提(解放スキル+下の段階購入)を必ず満たしてから測る。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const p = await b.newPage({ viewport: { width: 430, height: 780 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await p.clock.install();
  await p.goto('file:///home/user/exist-debug/index.html', { waitUntil: 'load', timeout: 60000 });
  await p.clock.runFor(1500); await p.click('#audioGate').catch(() => {}); await p.clock.runFor(700);
  await p.click('#titleStartBtn').catch(() => {}); await p.clock.runFor(1000);

  const out = await p.evaluate(() => {
    const N = v => { const n = Number(String(v)); return Number.isFinite(n) ? n : null; };
    // その研究だけを持った状態を作る(他研究の相互作用で比が汚れるのを避ける)
    const only = (id) => {
      state = freshState(); ensureState();
      UPGRADES.forEach(u => state.upgrades[u.id] = 30);
      state.cookies = D('1e60'); state.stage = 1;
      state.maxQuotaStage = 12; state.maxQuotaStageEver = 12;   // 層依存の段階効果が観測できる深さ
      state.monstersDefeated = 300; state.totalClicks = 9000; state.quotaMonsterKills = 40;
      state.research[id] = true;
    };
    const probe = () => ({
      毎秒: N(currentCps()), タップ: N(currentClickPower()),
      与ダメ: N(monsterDamageMultiplier({ typeId: 'normal', hp: 1e9, maxHp: 1e9 })),
      金倍率: N(goldenMultiplier()), 金獲得: N(goldenAmountMultiplier()),
      金間隔: N(goldenSpawnFactor()), 討伐間隔: N(monsterSpawnFactor()),
      滞在: N(monsterStayDurationMs()), 割引: N(upgradeDiscount()),
      ノルマ圧縮: N(blackHoleQuotaCompressionMultiplier()),
      直接収入: N(typeof directIncomeTotalCps === 'function' ? directIncomeTotalCps() : null),
      会心率: N(fingerCritChance()), ボス周期: N(bossCycleFor(1)),
    });
    const moved = (a, b2) => Object.keys(a).filter(k => a[k] != null && b2[k] != null
      && Math.abs(b2[k] - a[k]) > 1e-12 * Math.max(1, Math.abs(a[k])));

    const rows = [];
    for (const r of RESEARCH) {
      for (const st of [2, 3]) {
        // 段階を持たない研究(s2/s3の文も解放スキルも無い)は検査対象外。
        // 全研究に段階2/3があると仮定すると16件の誤警報が出る(2026-07-26 実測)。
        const gate = (st === 2 ? RES_STAGE2 : RES_STAGE3)[r.id];
        const claims = st === 2 ? r.s2 : r.s3;
        if (!gate && !claims) { rows.push({ id: r.id, name: r.name, st, note: '段階を持たない研究(対象外)' }); continue; }
        if (!gate && claims) { rows.push({ id: r.id, name: r.name, st, note: `段階${st}の文があるのに解放スキルが無い=買えない` }); continue; }
        only(r.id);
        state.skills[RES_STAGE2[r.id]] = true;                 // 段階2の解放は常に必要
        if (st === 3) state.skills[RES_STAGE3[r.id]] = true;
        state.researchStages[r.id] = st - 1;                    // 直前の段階まで購入済み
        const off = probe();
        state.researchStages[r.id] = st;                        // その段階を購入
        const on = probe();
        const mv = moved(off, on);
        rows.push({ id: r.id, name: r.name, st, 動いた面: mv.join(','),
          文: st === 2 ? String(r.s2 || '') : String(r.s3 || '') });
      }
    }
    // 自己検査: 効くと分かっている段階で面が動くこと
    only('ovenBatch'); state.skills[RES_STAGE2.ovenBatch] = true;
    state.researchStages.ovenBatch = 1; const a0 = probe();
    state.researchStages.ovenBatch = 2; const a1 = probe();
    return { rows, self: moved(a0, a1).join(','), 面: Object.keys(a0).filter(k => a0[k] != null).join(',') };
  });

  console.log('観測できた面:', out.面);
  console.log('自己検査(オーブン大量焼成 段階2で動く面):', out.self || '(なし=判定器が壊れている)');
  const dead = out.rows.filter(x => x.動いた面 === '');
  const nogate = out.rows.filter(x => x.note);
  console.log(`=== 段階を買っても観測面がどれも動かない ${dead.length}/${out.rows.length - nogate.length}件 ===`);
  dead.forEach(x => console.log(`  ${x.name}(${x.id}) 段階${x.st} 「${x.文}」`));
  const noGateButClaims = nogate.filter(x => /買えない/.test(x.note));
  console.log(`=== 段階の文があるのに解放スキルが無い(買えない) ${noGateButClaims.length}件 ===`);
  noGateButClaims.forEach(x => console.log(`  ${x.name} 段階${x.st}`));
  console.log(`(段階を持たない研究 ${nogate.length - noGateButClaims.length}件は対象外)`);
  console.log('errs:', errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
