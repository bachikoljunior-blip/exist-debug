// 実プレイヤーのスキル取得ルール(共有部品・2026-07-27 ユーザー指示A)。
// 実況ドライバと確認プローブが同じものを使う=片方だけ賢い状態を作らない(buy_policy.js と同じ方針)。
//
// 旧実装(配列順で買える最初のものを取る)は「作者が書いた順に従うだけの偽プレイヤ」で、
// 5PTの入口ノードを飛ばして隣の枝を埋め、工房(前提込み7PT)に永久に届かなかった(実測: 8個取って残4PT・工房false)。
// 実プレイヤの判断を2つだけ入れる:
//   (1) 新しいシステム/報酬が開くノードは、前提込みの鎖が安ければ先に取る(=新しい遊びが増えること自体に価値)
//   (2) 残りは「仮に取ったら画面の数字がどれだけ伸びるか」を実測して、PTあたりの伸びで選ぶ
// 測れない効果(モンスターHP減・出現率・金獲得量など。後の行動で効くもの)は、カード文面どおり効くものとして
// 一律 +8%相当に置く。ここは判断であり、測定ではない(値の根拠は「安ければ実プレイヤは取る」)。
const UNLOCK_VALUE = 1.25; // 新システム/新報酬の価値=生産+25%相当
const UNMEASURED_VALUE = 1.08; // 静的には測れない効果の期待値
// 「欲しいシステムのためにPTを貯める」射程(2026-07-27)。PTは転生しても減らないので、
// 目標が今のPTのこの倍率以内(=あと1〜2回の転生で届く)なら実プレイヤは寄り道せずに貯める。
// 3.0 の根拠: 転生1回のPT供給は前回比1.4〜1.7倍(pG=0.023の供給式)なので、2回ぶんで概ね3倍。
const RESERVE_REACH = 3.0;

async function installSkillPolicy(page, opt) {
  const cfg = Object.assign({ unlockValue: UNLOCK_VALUE, unmeasuredValue: UNMEASURED_VALUE, reserveReach: RESERVE_REACH }, opt || {});
  await page.evaluate((cfg) => {
    window.__SKILLPOL = cfg;
    window.__takeSkillsSmart = function () {
      const got = [];
      if (typeof SKILLS === 'undefined' || typeof skillCanBuy !== 'function') return got;
      const score = () => {
        let cps = 0, clk = 0, dmg = 1;
        // 収入は currentCps だけでは足りない(2026-07-27 実測): このゲームの毎秒収入は
        // 「currentCps() + directIncomeTotalCps()」で、直送収入が総収入のほぼ全部を占める段がある
        // (毎tickの earn も両方を足している)。旧スコアは直送を見ていなかったので、直送を開く手が
        // 「効果0」に見え、実プレイヤなら真っ先に取る枝を永久に選ばなかった。
        try { cps = Number(currentCps().toString()) + ((typeof directIncomeTotalCps === 'function') ? Number(directIncomeTotalCps().toString()) : 0); } catch (e) {}
        try { clk = Number(baseClickPower().toString()); } catch (e) {}
        try { dmg = Number(monsterBaseDamage()) * Number(monsterDamageMultiplier(null)); } catch (e) {}
        return { cps, clk, dmg };
      };
      // 生産を主・火力を従(0.6/0.25/0.15)。プレイヤが「どれが効くか」を見る重みに合わせる。
      const gain = (a, b) => { const r = (x, y) => ((y > 0 && x > 0) ? (x / y) : 1);
        return Math.pow(r(a.cps, b.cps), 0.6) * Math.pow(r(a.clk, b.clk), 0.25) * Math.pow(r(a.dmg, b.dmg), 0.15); };
      // 「新しく買えるものが増える手」を全部 unlock として扱う(2026-07-27 実測して拡張)。
      // 旧判定は effects の unlockSystem/unlockReward だけを見ていたので、**研究の段階2/3を解放する
      // スキル**(RES_STAGE2/RES_STAGE3 のゲート)が普通の伸び札として扱われ、静的には効果0に見えて
      // 一度も選ばれなかった。段階2は設備直送/金直送/討伐直送の入口=この経済の主要な収入源なので、
      // 実プレイヤ(カード文面を読む人)なら必ず取る。実測: この扱いを入れるまで段階研究の購入は0件。
      const stageGate = new Set();
      try { for (const k in RES_STAGE2) stageGate.add(RES_STAGE2[k]); } catch (e) {}
      try { for (const k in RES_STAGE3) stageGate.add(RES_STAGE3[k]); } catch (e) {}
      const unlocks = s => (s.effects || []).some(e => e.type === 'unlockSystem' || e.type === 'unlockReward') || stageGate.has(s.id);
      // 未所持ノードに到達するのに必要な前提の合計(自分含む)。安い鎖なら実プレイヤは一気に辿る。
      const chain = (s, seen) => {
        seen = seen || new Set();
        if (hasSkill(s.id) || seen.has(s.id)) return { cost: 0, path: [] };
        seen.add(s.id);
        let cost = s.cost, path = [];
        for (const q of s.prereqs) { const qn = SKILLS.find(x => x.id === q); if (!qn) continue; const c = chain(qn, seen); cost += c.cost; path = path.concat(c.path); }
        return { cost, path: path.concat([s]) };
      };
      // 貯める判断(2026-07-27 実測して追加): 旧実装は毎回「PT単価が最良のノード」を買い切っていたので、
      // 前提込み148PTの注文ボードのような**高い入口**には永久に届かなかった(1PTのノードの単価が常に勝つ)。
      // 実プレイヤはPTを持ち越せる(転生しても減らない)ので、欲しいシステムが射程に入ったら貯める。
      // 射程=「今のPTの reserveReach 倍以内」(=あと1〜2回の転生で届く)。それより遠いなら普通に伸びを買う。
      const cheapestUnlockChain = () => {
        let best = null;
        for (const s of SKILLS) {
          if (s.retired || hasSkill(s.id)) continue;
          if (!(s.effects || []).some(e => e.type === 'unlockSystem' || e.type === 'unlockReward')) continue;
          const ch = chain(s);
          if (ch.cost <= 0) continue;
          if (!best || ch.cost < best.cost) best = { cost: ch.cost, ids: new Set(ch.path.map(x => x.id)), name: s.name };
        }
        return best;
      };
      const target = cheapestUnlockChain();
      const pt = Number(state.prestige || 0);
      const saving = !!(target && target.cost > pt && target.cost <= pt * window.__SKILLPOL.reserveReach);
      window.__SKILL_SAVING = saving ? { name: target.name, cost: target.cost, pt } : null;
      if (saving) return [];   // 目標のシステムまで貯める(このPTでは何も買わない)
      for (let n = 0; n < 300; n++) {
        const base = score();
        let best = null;
        for (const s of SKILLS) {
          if (s.retired || hasSkill(s.id)) continue;
          const ch = chain(s);
          if (ch.cost <= 0 || ch.cost > Number(state.prestige || 0)) continue; // 前提込みで今は買えない
          let v;
          if (unlocks(s)) v = window.__SKILLPOL.unlockValue;
          else {
            const on = [];
            for (const q of ch.path) if (!state.skills[q.id]) { state.skills[q.id] = true; on.push(q.id); }
            v = gain(score(), base);
            for (const id of on) delete state.skills[id];
            if (v <= 1.0001) v = window.__SKILLPOL.unmeasuredValue; // 静的に測れない効果
          }
          const perPt = (v - 1) / ch.cost;
          if (v > 1 && (!best || perPt > best.perPt)) best = { s, ch, perPt };
        }
        if (!best) break;
        let ok = true;
        for (const q of best.ch.path) {
          if (hasSkill(q.id)) continue;
          if (!skillCanBuy(q)) { ok = false; break; }
          selectSkill(q.id); takeSelectedSkill();
          if (!hasSkill(q.id)) { ok = false; break; }
          got.push(q.name || q.id);
        }
        if (!ok) break;
      }
      return got;
    };
  }, cfg);
  return cfg;
}

module.exports = { installSkillPolicy };
