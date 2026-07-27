// QA一巡(表示 vs 実装): 報酬パーク・実績研究・料理が「取っても何も動かない」ものになっていないか。
// 注意: 判定器自身の欠陥を避けるため ①state は freshState() 相当で全キー0埋め(perks={} だと
// Math.max(0, undefined)=NaN が伝播して全項目「動かない」と誤判定する) ②観測面は広く取り、
// 全設備を1台以上持たせる(0台だと設備別の効果が構造的に動かない) ③NaN が出たら面ごとに落とす。
//
// 相対許容差(1e-9)は加算効果を潰す: 深い進行では「毎秒 +50」が相対3.6e-10 で埋もれる。
// 「動かない」と出た件は必ず絶対差で個別確認する(2026-07-26 実測: 出た8件すべてが
// 観測面の外(金の即時獲得倍率/会心率/ドロップ数)か許容差の下で、新規欠陥はゼロだった)。
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
    // 測定中は時間を止める(2026-07-26 実測): off と on の間に偽クロックが進むため
    // runTempoRamp() などの時間依存項が両者で変わり、比較が実行ごとに揺れる。
    // Date.now を固定すると time 依存項が完全に一致し、厳密比較が意味を持つ。
    const __realNow = Date.now; const __T = __realNow();
    Date.now = () => __T;
    const rep = { perks: [], ms: [], dishes: [], probeCheck: null };
    const base = () => {
      state = freshState();                     // 全キーが定義された素の状態(NaN汚染を避ける)
      ensureState();
      // freshState() は state しか戻さない。金ブースト・余熱・編成倍率などは**モジュール変数**なので
      // 残ったまま probe に混ざり、同一ビルドでも実行ごとに結果が揺れる(2026-07-26 実測:
      // 同じビルドを3回走らせて 死に札が 5件/2件/1件 と変わった=合否の門にならない)。毎回明示的に消す。
      try { clearGoldenBoosts(); } catch (e) {}
      activeGoldenBoosts = []; activeGoldenAfterheats = []; boostUntil = 0; ensembleMul = 1;
      try { hideMonster(false); } catch (e) {}
      try { monsters = []; } catch (e) {}
      // 効果の前提として説明文に明記されている研究だけは持たせる(会心率系は「要 研究『指先の型』」)。
      // 研究を全部持たせると生産に反応する研究が比を汚すので、必要な1本に限る。
      state.research.fingerTechnique = true;
      UPGRADES.forEach(u => state.upgrades[u.id] = 5);   // 全設備を5台=設備別の効果も観測できる
      state.research.ovenBatch = true; state.research.factoryNetwork = true;
      state.cookies = D('1e30'); state.stage = 1; state.maxQuotaStage = 3; state.maxQuotaStageEver = 3;
      state.monstersDefeated = 100; state.totalClicks = 100;
      state.skills = { workshop_1: true, workshop_2: true, reward_synergy: true };
    };
    // 許容差 1e-6 の根拠(2026-07-26 実測): runTempoRamp() が偽クロックの微小進みで
    // 1e-7 ほど揺れるため、1e-9 だと「動いた」と誤判定して同一ビルドでも結果が変わる
    // (死に札が 5件/2件/1件 と揺れた)。実効果は最小でも0.1%あるので 1e-6 で分離できる。
    const num = v => { const n = Number(String(v)); return Number.isFinite(n) ? n : null; };
    const probe = () => ({
      毎秒: num(currentCps()), タップ: num(currentClickPower()),
      討伐間隔: num(monsterSpawnFactor()), 金間隔: num(goldenSpawnFactor()),
      与ダメ: num(monsterDamageMultiplier({ typeId: 'normal', hp: 1e9, maxHp: 1e9 })),
      金倍率: num(goldenBoostMultiplier()), 金持続: num(goldenBoostDuration()),
      金獲得: num(goldenAmountMultiplier()),          // 金の即時獲得(これが無いと金系が全部「動かない」に見える)
      滞在: num(monsterStayDurationMs()), 割引: num(upgradeDiscount()),
      炉倍率: num(ovenStageMultiplier()), 深追HP: num(deepPursuitHpPenalty()),
      ボス周期: num(bossCycleFor(1)), 料理時間: num(dishDurationMs()),
      会心率: num(fingerCritChance()),                 // critAdd 系
      ドロップ: num(msMulOf('dropAdd')),               // dropAdd 系
      報酬Lv: num(skillEffect('rewardBonus')),   // 存在しない関数への三項フォールバックは書かない(判定が黙って死ぬ)
      連鎖倍率: num(chainProductionMultiplier()),
      ノルマ圧縮: num(blackHoleQuotaCompressionMultiplier()),
      ノルマ制御: num(quotaControlMultiplier()),
      直接収入: num(directIncomeTotalCps()),
      次HP予約: num(state.nextMonsterHpMultiplier),
      次湧き予約: num(state.nextMonsterSpawnMultiplier),
      次報酬数: num(state.nextRewardCountBonus),
      狩猟集中Lv: num(state.huntFocusLv),
    });
    // 3分類にする(2026-07-26): 相対許容差だけだと ①1e-9 では偽クロックの揺れ(1e-7)を拾って
    // 結果が実行ごとに変わり ②1e-6 に上げると小さいが実在する加算効果(毎秒+50 が 1e11 の上では
    // 相対3.6e-10)を「動かない」と誤断する。相対で動く/絶対差はあるが小さい/絶対差も完全に0 を分ける。
    // 真の死に札は3番目だけ。
    const moved = (off, on) => Object.keys(off).filter(k => off[k] != null && on[k] != null
      && Math.abs(on[k] - off[k]) > 1e-6 * Math.max(1, Math.abs(off[k])));
    const anyDelta = (off, on) => Object.keys(off).some(k => off[k] != null && on[k] != null && on[k] !== off[k]);
    // 事象駆動(撃破時・金ブースト中の撃破・次の1体への予約・確率発動)は静的な観測では動かない。
    // 「動かない=死に札」と混ぜると永久に誤警報が出るので、文面から判別して対象外にする。
    // 静的観測では動かない効果の種類(2026-07-26 実コードで4件を個別確認して確定):
    //   事象駆動: 撃破時・攻撃ごと・連鎖・確率発動  例) 甘噛み回収=攻撃ごとにクッキー回収
    //   条件付き: 金ブースト中だけ/ノルマ維持中だけ  例) 金色標的= goldenBoostActive() のときだけ加算
    //   購入時:   効果中に買った設備に後から効く      例) 星屑パフェ
    // これらを「動かない=死に札」と混ぜると永久に誤警報が出るので文面から判別して分ける。
    const EVENT = /撃破|倒す|倒し|攻撃ごと|連続|次の|次に|確率|チェイン|連鎖|取得した直後|時間切れ|ブースト中|維持中|効果中に購入|購入した設備|進行がゆっくり/;
    // 「進行がゆっくり」= 霜降りケーキ。毎tickで quotaPausedMs を加算する実装なので静的な倍率には出ない。
    // 別途 時間を進めて実測済み(2026-07-26): ノルマ進行の比 0.449 = 図鑑の主張「-55%」と一致。

    // 判定器の自己検査: 確実に効くもの(強い指+1台/金出現パーク)で面が動くこと
    base(); const s0 = probe(); state.upgrades.finger += 50; const s1 = probe();
    base(); const g0 = probe(); state.perks.goldenRate = 5; const g1 = probe();
    rep.probeCheck = { 強い指50台で動いた面: moved(s0, s1).join(','), 金出現パークで動いた面: moved(g0, g1).join(','),
      観測できた面: Object.entries(s0).filter(([, v]) => v != null).map(([k]) => k).join(',') };

    for (const r of REWARD_POOL) {
      base(); const off = probe(); state.perks[r.id] = 3; const on = probe();
      rep.perks.push({ id: r.id, name: r.name, 動いた面: moved(off, on).join(','), 絶対差: anyDelta(off, on), 事象駆動: EVENT.test(String(typeof r.desc === 'function' ? r.desc(3) : (r.desc || ''))) });
    }
    for (const m of MILESTONE_RESEARCH) {
      base(); const off = probe(); state.msResearch[m.id] = true; const on = probe();
      rep.ms.push({ id: m.id, name: m.name, 動いた面: moved(off, on).join(','), 絶対差: anyDelta(off, on), 事象駆動: EVENT.test(String(m.fxText || '')) });
    }
    for (const d of DISHES) {
      base(); const off = probe(); state.activeDishes = [{ id: d.id, until: Date.now() + 600000 }]; const on = probe();
      rep.dishes.push({ id: d.id, name: d.name, 動いた面: moved(off, on).join(','), 絶対差: anyDelta(off, on), 事象駆動: EVENT.test(String((typeof d.effect === 'function' ? d.effect() : d.effect) || d.desc || '')) });
    }
    Date.now = __realNow;
    return rep;
  });

  console.log('=== 判定器の自己検査 ===');
  console.log('  観測できた面:', out.probeCheck.観測できた面);
  console.log('  強い指50台で動いた面:', out.probeCheck.強い指50台で動いた面 || '(なし=判定器が壊れている)');
  console.log('  金出現パークで動いた面:', out.probeCheck.金出現パークで動いた面 || '(なし=判定器が壊れている)');
  for (const [label, arr] of [['報酬パーク', out.perks], ['実績研究', out.ms], ['料理', out.dishes]]) {
    const big = arr.filter(x => x.動いた面);
    const tiny = arr.filter(x => !x.動いた面 && x.絶対差);
    const zeroAll = arr.filter(x => !x.動いた面 && !x.絶対差);
    const ev = zeroAll.filter(x => x.事象駆動);
    const zero = zeroAll.filter(x => !x.事象駆動);
    console.log(`=== ${label}: 相対で動く ${big.length} / 効くが小さい ${tiny.length} / 事象駆動(静的観測の対象外) ${ev.length} / **説明できない0 ${zero.length}** (計${arr.length}) ===`);
    if (tiny.length) console.log('   効くが小さい: ' + tiny.slice(0, 8).map(x => x.name || x.id).join(' ') + (tiny.length > 8 ? ` …他${tiny.length - 8}` : ''));
    if (ev.length) console.log('   事象駆動: ' + ev.map(x => x.name || x.id).join(' '));
    zero.forEach(x => console.log(`   ★説明できない0(要調査): ${x.name || x.id}`));
  }
  console.log('errs:', errs.length, errs.slice(0, 3).join(' | '));
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
