// 工房での実プレイヤー行動(共有部品・2026-07-27)。実況ドライバと確認プローブが同じものを使う。
//
// 初版(ドライバ内に直書き)は「仮に装着したときの毎秒生産/タップ力/討伐火力の伸びが1%未満なら作らない」
// という規則にしていた。実走(ゲーム内1時間42分・工房解放済み)で **装備も料理も1つも作られなかった**。
// 原因: ティア1装備の多くは素材ドロップ率・出現短縮・報酬Lvなど**静的には生産に出ない効果**で、
// 伸びが1.000 と測れて全部見送られる=スキル選択で踏んだのと同じ「測れない効果を0点にする」穴。
// 実プレイヤの判断はもっと単純: **空の枠には作れるものを入れる**(空は何も生まない)。
// 埋まっている枠は「実測で良くなるときだけ」入れ替える。測れない効果は+5%相当として扱う。
const EMPTY_SLOT_VALUE = 1.30;   // 空き枠を埋めること自体の価値(生産+30%相当)
const UNMEASURED_VALUE = 1.05;   // 静的に測れない効果(ドロップ率・出現短縮・報酬Lvなど)
const REPLACE_MIN = 1.01;        // 埋まっている枠を入れ替える最低の伸び

async function installWorkshopPolicy(page, opt) {
  const cfg = Object.assign({ emptySlot: EMPTY_SLOT_VALUE, unmeasured: UNMEASURED_VALUE, replaceMin: REPLACE_MIN }, opt || {});
  await page.evaluate((cfg) => {
    window.__WSPOL = cfg;
    window.__workshopActions = function () {
      const out = [];
      try {
        if (typeof workshopTabUnlocked !== 'function' || !workshopTabUnlocked()) return out;
        const score = () => {
          let cps = 0, clk = 0, dmg = 1;
          try { cps = Number(currentCps().toString()); } catch (e) {}
          try { clk = Number(baseClickPower().toString()); } catch (e) {}
          try { dmg = Number(monsterBaseDamage()) * Number(monsterDamageMultiplier(null)); } catch (e) {}
          return { cps, clk, dmg };
        };
        const gain = (a, b) => { const r = (x, y) => ((y > 0 && x > 0) ? (x / y) : 1);
          return Math.pow(r(a.cps, b.cps), 0.6) * Math.pow(r(a.clk, b.clk), 0.25) * Math.pow(r(a.dmg, b.dmg), 0.15); };
        // 1) 装備: 空き枠を優先して埋め、埋まっている枠は実測で良くなるときだけ入れ替える
        if (typeof workshopCraftUnlocked === 'function' && workshopCraftUnlocked() && typeof equip2Items === 'function') {
          const cap = (typeof EQUIP2_CFG !== 'undefined' ? (EQUIP2_CFG.craftPerRunCap || 5) : 5);
          for (let n = 0; n < cap + 1; n++) {
            if ((state.eq2CraftTotalThisRun || 0) >= cap) break;
            const base = score();
            let best = null;
            for (const it of equip2Items()) {
              if (!equip2CraftableNow(it) || !equip2Afford(it)) continue;
              const cur = (state.eq2Equipped || {})[it.cat] || null;
              let v;
              state.eq2Equipped[it.cat] = it.id;
              const measured = gain(score(), base);
              state.eq2Equipped[it.cat] = cur;
              if (!cur) v = Math.max(window.__WSPOL.emptySlot, measured); // 空き枠は埋めるだけで価値がある
              else v = (measured <= 1.0001) ? window.__WSPOL.unmeasured : measured;
              const need = cur ? window.__WSPOL.replaceMin : 1.0;
              if (v <= need) continue;
              if (!best || v > best.v) best = { it, v, empty: !cur, measured };
            }
            if (!best) break;
            const owned0 = (state.eq2Owned || {})[best.it.id] || 0;
            try { craftEquip2(best.it.id); } catch (e) {}
            if (((state.eq2Owned || {})[best.it.id] || 0) <= owned0) break; // 作れなかった(周回上限など)
            try { equipItemToSlot(best.it.id, best.it.cat); } catch (e) {}
            const pct = Math.round((best.measured - 1) * 100);
            out.push([`装備「${best.it.name}」を作成して${best.empty ? '空き枠に装着' : '付け替え'}${pct > 0 ? `(生産+${pct}%)` : ''}`, 1]);
          }
        }
        // 2) 料理: 効果が切れているものを、素材が足りる範囲で作る(最大3品)
        if (typeof DISHES !== 'undefined' && typeof cookDish === 'function') {
          for (const d of DISHES) {
            if (activeDishList().length >= MAX_ACTIVE_DISHES) break;
            if (!dishRecipeRevealed(d) || dishActive(d.id)) continue;
            if (!canAffordMaterials(d.cost)) continue;
            const n0 = activeDishList().length;
            try { cookDish(d.id); } catch (e) {}
            if (activeDishList().length > n0) out.push([`料理「${d.name}」を調理`, 1]);
          }
        }
      } catch (e) { out.push([`(工房で例外: ${String(e.message || e).slice(0, 40)})`, 1]); }
      return out;
    };
  }, cfg);
  return cfg;
}

module.exports = { installWorkshopPolicy };
