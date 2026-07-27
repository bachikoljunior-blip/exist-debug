// QA一巡(第2レンズ): スキル75ノードと新装備(EQUIP2)の効果が、取っただけで何も動かない札になっていないか。
// 判定器の罠は claim_audit_qa と同じ3つ(NaN汚染/観測面の狭さ/相対許容差)。ここでも自己検査を先に通す。
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
    const base = () => {
      state = freshState(); ensureState();
      UPGRADES.forEach(u => state.upgrades[u.id] = 8);
      RESEARCH.forEach(r => state.research[r.id] = true);   // 研究前提のスキルも観測できるように
      state.cookies = D('1e40'); state.stage = 2; state.stageUnlocked = 3;
      state.maxQuotaStage = 5; state.maxQuotaStageEver = 5; state.monstersDefeated = 200;
      state.prestige = 1e6; state.prestigeRuns = 2; state.totalClicks = 5000;
      state.materials = {}; MATERIALS.forEach(m => state.materials[m.id] = 500);
    };
    // 許容差 1e-6 の根拠(2026-07-26 実測): runTempoRamp() が偽クロックの微小進みで
    // 1e-7 ほど揺れるため、1e-9 だと「動いた」と誤判定して同一ビルドでも結果が変わる
    // (死に札が 5件/2件/1件 と揺れた)。実効果は最小でも0.1%あるので 1e-6 で分離できる。
    const num = v => { const n = Number(String(v)); return Number.isFinite(n) ? n : null; };
    const probe = () => ({
      毎秒: num(currentCps()), タップ: num(currentClickPower()),
      討伐間隔: num(monsterSpawnFactor()), 金間隔: num(goldenSpawnFactor()),
      与ダメ: num(monsterDamageMultiplier({ typeId: 'normal', hp: 1e6, maxHp: 1e6 })),
      金倍率: num(goldenBoostMultiplier()), 金持続: num(goldenBoostDuration()),
      滞在: num(monsterStayDurationMs()), 割引: num(upgradeDiscount()),
      炉倍率: num(ovenStageMultiplier()), 深追HP: num(deepPursuitHpPenalty()),
      ボス周期: num(bossCycleFor(2)), 料理時間: num(dishDurationMs()),
      会心率: num(fingerCritChance()), ドロップ: num(msMulOf('dropAdd')),
      オフライン: num(skillEffect('offlineHours')), 報酬数: num(skillEffect('rewardChoices')),
      系統: num(rewardCategoryBonus('golden')),
    });
    const moved = (off, on) => Object.keys(off).filter(k => off[k] != null && on[k] != null
      && Math.abs(on[k] - off[k]) > 1e-6 * Math.max(1, Math.abs(off[k])));

    // 自己検査
    base(); const c0 = probe(); state.upgrades.finger += 100; const c1 = probe();
    const selfA = moved(c0, c1).join(',');
    base(); const d0 = probe(); state.skills.click_1 = true; const d1 = probe();
    const selfB = moved(d0, d1).join(',');

    const skills = [];
    for (const s of SKILL_NODES) {
      base(); const off = probe(); state.skills[s.id] = true; const on = probe();
      skills.push({ id: s.id, name: s.name, retired: !!s.retired, 動いた面: moved(off, on).join(','),
        effects: JSON.stringify(s.effects || []) });
    }
    // 新装備: 各カテゴリ×色銘の代表(ティア1)を装備して測る
    const eq = [];
    for (const it of equip2Items().filter(x => x.tier === 1)) {
      base(); const off = probe();
      state.eq2Owned[it.id] = 1; state.eq2Equipped[it.cat] = it.id;
      const on = probe();
      eq.push({ id: it.id, name: it.name, fxText: it.fxText, 動いた面: moved(off, on).join(',') });
    }
    return { selfA, selfB, skills, eq, 面: Object.keys(c0).filter(k => c0[k] != null).join(',') };
  });

  console.log('観測できた面:', out.面);
  console.log('自己検査 強い指+100:', out.selfA || '(なし=判定器が壊れている)');
  console.log('自己検査 スキルclick_1:', out.selfB || '(なし=判定器が壊れている)');
  const deadS = out.skills.filter(x => !x.動いた面 && !x.retired);
  const deadE = out.eq.filter(x => !x.動いた面);
  console.log(`=== スキル: 動かないもの ${deadS.length}/${out.skills.filter(x=>!x.retired).length}(退役${out.skills.filter(x=>x.retired).length}件は除外) ===`);
  deadS.forEach(x => console.log(`  ${x.name}(${x.id}) effects=${x.effects}`));
  console.log(`=== 新装備ティア1: 動かないもの ${deadE.length}/${out.eq.length} ===`);
  deadE.slice(0, 20).forEach(x => console.log(`  ${x.name}(${x.id}) 表示=${x.fxText}`));
  if (deadE.length > 20) console.log(`  … 他${deadE.length - 20}件`);
  console.log('errs:', errs.length, errs.slice(0, 2).join(' | '));
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
