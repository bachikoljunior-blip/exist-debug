// QA一巡(第3レンズ): スキル説明の「+N%/-N%」が実測と一致するか。
// この形の誤表示は今サイクルで3件見つかっている(金色の匂い/太陽反応/狩りの合図が1.8倍係数を無視していた)。
// やり方: 説明から (対象語, 符号, 数値) を取り、その対象に対応する観測面で「そのスキルだけ持った/持たない」比を測る。
// 判定器の自己検査つき(対応が取れない対象は「未対応」として報告し、黙って合格にしない)。
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
    // 判定器の汚染を避ける(2026-07-26 実測で判明した2つ):
    //  ①研究を全部持たせると、毎秒生産に反応する研究(月面発酵 段2のノルマ余裕率など)が
    //    スキルで増えた生産にさらに反応して比が膨らむ(実測: clickSkillMultiplier は 1→1.75 ちょうどなのに
    //    最終タップ比が1.806になる)。スキル単体の主張を測るので研究は持たせない。
    //  ②効果が複数あるスキル(タップ+全生産など)は、1つの主張に全変化を帰属させると桁違いの誤警報になる。
    //    主張と効果が1対1のスキルだけを対象にする。
    const base = () => { state = freshState(); ensureState();
      UPGRADES.forEach(u => state.upgrades[u.id] = 8);
      state.cookies = D('1e40'); state.stage = 1; state.maxQuotaStage = 3; state.maxQuotaStageEver = 3;
      state.monstersDefeated = 200; state.totalClicks = 5000; state.prestige = 1e6; };
    const num = v => { const n = Number(String(v)); return Number.isFinite(n) ? n : null; };
    // 対象語 → 測る関数(比の向き: 増える系は on/off、短縮系は 1-on/off)
    const AXES = [
      [/タップ生産|^タップ$/, () => num(currentClickPower()), 'up', ['click']],
      [/毎秒生産/, () => num(currentCps()), 'up', ['cps']],
      [/全生産/, () => num(currentCps()), 'up', ['all']],
      [/金クッキー出現間隔|キー出現間隔/, () => num(goldenSpawnFactor()), 'down', ['goldenRate']],
      [/モンスター出現間隔|ター出現間隔/, () => num(monsterSpawnFactor()), 'down', ['monsterRate']],
      [/モンスター滞在|ンスター滞在/, () => num(monsterStayDurationMs()), 'up', ['monsterStay']],
      [/最終ダメージ|モンスターダメージ|ターダメージ/, () => num(monsterDamageMultiplier({ typeId: 'normal', hp: 1e6, maxHp: 1e6 })), 'up', ['monsterDamage','hunt']],
      [/金獲得量|金クッキー即時獲得量|ー即時獲得量/, () => num(goldenAmountMultiplier()), 'up', ['goldenAmount']],
      [/モンスターHP|ンスターHP/, () => num(Math.exp(-Math.max(0, skillEffect('monsterHpDown')))), 'down', ['monsterHpDown']],
      [/研究費用/, () => num(researchDiscount ? researchDiscount() : null), 'down', ['researchDiscount']],
      [/アップグレード費用|グレード費用/, () => num(upgradeDiscount()), 'down', ['upgradeDiscount']],
    ];
    const rows = [];
    for (const s of SKILL_NODES) {
      if (s.retired) continue;
      const d = String(s.desc || '');
      const nEff = (s.effects || []).length;
      for (const mm of d.matchAll(/([ァ-ヶーぁ-んーa-zA-Z一-龥]+?)\s*([-＋+])\s*([0-9.]+)\s*%/g)) {
        const word = mm[1], sign = mm[2], claim = Number(mm[3]);
        const ax = AXES.find(([re]) => re.test(word));
        if (!ax) { rows.push({ id: s.id, name: s.name, word, claim, sign, 実測: null, note: '未対応の対象語' }); continue; }
        // 効果が複数あるスキルは、主張に対応する効果1つだけを残した状態で測る(隔離)。
        // まとめて測ると1つの主張に全変化が帰属して桁違いの誤警報になる(実測で確認)。
        // 隔離は SKILLS に対して行う(2026-07-26 実測: const SKILLS = SKILL_NODES.map(...) の
        // コピーなので、SKILL_NODES 側を書き換えても skillEffect には一切効かず、隔離が黙って
        // 失敗して桁違いの誤警報になっていた)。
        const live = SKILLS.find(x => x.id === s.id);
        const all = (live && live.effects) || [];
        const want = ax[3];                       // その対象語が対応する effect.type
        const only = all.filter(e => want.includes(e.type));
        if (!live) { rows.push({ id: s.id, name: s.name, word, claim, sign, 実測: null, note: 'SKILLSに無い' }); continue; }
        if (all.length > 1 && only.length !== 1) { rows.push({ id: s.id, name: s.name, word, claim, sign, 実測: null, note: `効果を隔離できない(${all.map(e=>e.type).join('/')})` }); continue; }
        base(); const off = ax[1]();
        const saved = live.effects; if (all.length > 1) live.effects = only;
        state.skills[s.id] = true; const on = ax[1]();
        live.effects = saved;
        if (off == null || on == null || off === 0) { rows.push({ id: s.id, name: s.name, word, claim, sign, 実測: null, note: '測れない' }); continue; }
        const pct = ax[2] === 'down' ? (1 - on / off) * 100 : (on / off - 1) * 100;
        rows.push({ id: s.id, name: s.name, word, claim, sign, 実測: Math.round(pct * 10) / 10, note: '' });
      }
    }
    return rows;
  });

  const num = x => x.実測;
  const bad = out.filter(x => x.実測 != null && Math.abs(x.実測 - x.claim) > Math.max(1, x.claim * 0.06));
  const un = out.filter(x => x.実測 == null);
  console.log(`検査した主張: ${out.length}件 / 対応できた: ${out.length - un.length}件`);
  console.log(`=== 表示と実測がずれている ${bad.length}件 ===`);
  bad.forEach(x => console.log(`  ${x.name}(${x.id}) 「${x.word} ${x.sign}${x.claim}%」→ 実測 ${x.実測}%`));
  console.log(`=== 未対応/測れない ${un.length}件(黙って合格にしない) ===`);
  un.slice(0, 14).forEach(x => console.log(`  ${x.name} 「${x.word} ${x.sign}${x.claim}%」 ${x.note}`));
  if (un.length > 14) console.log(`  … 他${un.length - 14}件`);
  console.log('errs:', errs.length);
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
