// 実プレイヤーの購入判断(2026-07-26 ユーザー指示A)。実況ドライバ2本が同じ判断を使うための共有部品。
//
// なぜ作ったか: 旧ルールは「価値/費用」の貪欲で、強い指(安い・per-tapの数字が大きい)を常に最優先に
// 選び、クリック上限25で辻褄を合わせていた=「強い指偏重」。実プレイヤは per-tap の数字ではなく
// 「その買い物で毎秒がどれだけ増えるか / いくらか」=回収時間で選ぶ。しかも放置が主体のプレイでは
// タップ由来の収入を稼働率で割り引かないと過大評価になる(同じ罠を能動/放置比ツールでも踏んだ)。
//
// 使い方:
//   const { installBuyPolicy } = require('./buy_policy.js');
//   const cfg = await installBuyPolicy(page);   // env: BUY_POLICY/TPS_EFF/SAVE_RATIO/SAVE_REACH
//   // 以後ページ内で window.__buySpree(maxSteps) が使える({order:[[名前,個数]..], saved:bool})
'use strict';

function readEnv() {
  return {
    policy: process.env.BUY_POLICY || 'payback', // payback=新(既定) / roi=旧(比較用)
    tps: Number(process.env.TPS_EFF || 0.05),    // 放置主体の実効タップ毎秒(10h放置に数分の能動)
    // 「次のティアへ貯める」は既定オフ(2026-07-26 実測で決定)。stage3到達までのゲーム内時間を
    // 決定的に比較したところ、貯める規則は入れるほど遅い:
    //   旧roi=1929日 / payback(貯めない)=836日 / payback+貯める2倍3倍=1351日 / +貯める5倍1.5倍=2770日
    // 手元にクッキーを寝かせる間だけ複利が止まるので、この経済では「今いちばん回収が速い台を買い続ける」
    // ほうが強い。実プレイヤの我慢を見せたい時は SAVE_RATIO=2 等で明示的に有効化する(遅くなる代償つき)。
    saveRatio: Number(process.env.SAVE_RATIO || Infinity), // 未購入の台がこの倍率以上に良ければ貯める
    saveReach: Number(process.env.SAVE_REACH || 3.0),      // ただし手持ちのこの倍以内で買える台に限る
  };
}

async function installBuyPolicy(page, override) {
  const cfg = Object.assign(readEnv(), override || {});
  await page.evaluate(({ policy, tps, saveRatio, saveReach }) => {
    window.__BUY = { policy, tps, saveRatio, saveReach };

    // 1台買ったときの毎秒の増分。全体倍率(研究/スキル/perk等)は全候補に共通なので順位付けでは
    // 相殺する=個別強化ぶんだけ乗せれば十分。クリック系は実効タップ毎秒で毎秒換算する。
    window.__margCps = (u) => {
      const per = Number(u.value) || 0;
      let pm = 1; try { pm = upgradePersonalMultiplier(u); } catch (e) {}
      return (u.type === 'click') ? per * pm * window.__BUY.tps : per * pm;
    };

    window.__candidates = () => {
      const out = [];
      for (const u of UPGRADES) {
        if (typeof upgradeUnlocked === 'function' && !upgradeUnlocked(u)) continue;
        let c; try { c = costOf(u); } catch (e) { continue; }
        const cn = Number(c.toString());
        if (!isFinite(cn) || cn <= 0) continue;
        const mc = window.__margCps(u);
        if (!(mc > 0)) continue;
        out.push({ u, cost: cn, marg: mc, eff: mc / cn }); // eff=1クッキーあたりの毎秒増(回収時間の逆数)
      }
      return out;
    };

    // 1手選ぶ。買えるものの中で最良。ただし「あと少し貯めれば saveRatio 倍以上に良い台」が
    // 手持ちの saveReach 倍以内にあるなら買わずに待つ(=次のティアへ貯める実プレイヤの判断)。
    window.__pickBuy = () => {
      const cs = window.__candidates();
      if (!cs.length) return null;
      const have = Number(state.cookies.toString());
      const afford = cs.filter(x => state.cookies.gte(x.cost));
      if (!afford.length) return null;
      afford.sort((a, b) => b.eff - a.eff);
      const best = afford[0];
      const wait = cs.filter(x => !state.cookies.gte(x.cost) && x.cost <= have * window.__BUY.saveReach)
        .sort((a, b) => b.eff - a.eff)[0];
      if (wait && wait.eff >= best.eff * window.__BUY.saveRatio) return { save: true };
      return { u: best.u, cost: best.cost };
    };

    // 旧ルール(比較用に残す): 価値/費用の貪欲・クリックは×5でクリック上限25
    window.__pickBuyRoi = () => {
      let best = null, bestR = 0, bestC = null;
      for (const u of UPGRADES) {
        if (typeof upgradeUnlocked === 'function' && !upgradeUnlocked(u)) continue;
        if (u.type === 'click' && (state.upgrades[u.id] || 0) >= 25) continue;
        let c; try { c = costOf(u); } catch (e) { continue; }
        const cn = Number(c.toString());
        if (!isFinite(cn) || cn <= 0) continue;
        const marg = (u.type === 'click') ? ((u.value || 1) * 5) : (u.value || 1);
        const rr = marg / cn;
        if (rr > bestR) { bestR = rr; best = u; bestC = cn; }
      }
      if (!best || !state.cookies.gte(bestC)) return null;
      return { u: best, cost: bestC };
    };

    // 期限つきの再投資: 「回収がこの残り時間より速い買い物」だけをする。
    // 転生待ちのような長い放置では、実プレイヤは黙って待たずに設備を伸ばして待ち時間そのものを縮める。
    // 逆に残りが短いなら手を出さない(貯金を溶かして転生を遠ざけない)。
    window.__investForDeadline = (remainSec) => {
      let bought = 0;
      for (let step = 0; step < 300; step++) {
        const cs = window.__candidates().filter(x => state.cookies.gte(x.cost));
        if (!cs.length) break;
        cs.sort((a, b) => b.eff - a.eff);
        const best = cs[0];
        const payback = best.cost / best.marg;      // 何秒で元が取れるか
        if (!(payback < remainSec * 0.5)) break;    // 残りの半分以内に回収できないなら見送る
        const b4 = state.upgrades[best.u.id] || 0;
        buyUpgrade(best.u.id);
        if ((state.upgrades[best.u.id] || 0) <= b4) break;
        bought++;
      }
      return bought;
    };

    // まとめ買い(実況の1ブロック分): 買った台と数を集約して返す
    window.__buySpree = (maxSteps) => {
      const agg = {}, order = [];
      let saved = false;
      for (let step = 0; step < (maxSteps || 200); step++) {
        const pick = (window.__BUY.policy === 'roi') ? window.__pickBuyRoi() : window.__pickBuy();
        if (!pick) break;
        if (pick.save) { saved = true; break; }
        const b4 = state.upgrades[pick.u.id] || 0;
        buyUpgrade(pick.u.id);
        const bt = (state.upgrades[pick.u.id] || 0) - b4;
        if (bt <= 0) break;
        if (!agg[pick.u.id]) { agg[pick.u.id] = [pick.u.name, 0]; order.push(pick.u.id); }
        agg[pick.u.id][1] += bt;
      }
      return { order: order.map(id => agg[id]), saved };
    };
  }, cfg);
  return cfg;
}

module.exports = { installBuyPolicy, readEnv };
