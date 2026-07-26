'use strict';
// 10プレイ方針。プレイヤーから見える情報(コスト・所持・現在/次の増分・ノルマ表示・報酬プレビュー)のみで判断。
// 各方針は数値条件まで固定。全周回のクッキー合計最大化を狙う設計(シミュ条件は考慮しない)。
const G = require('./sim.js');

function branchOf(id) {
  if (id === 'core') return 'core';
  if (id.startsWith('click_')) return 'click';
  if (id.startsWith('golden_')) return 'golden';
  if (id.startsWith('auto_') || id === 'bake_temperature') return 'auto';
  if (id.startsWith('monster_') || id === 'hunt_analysis') return 'monster';
  if (id.startsWith('economy_') || id === 'order_board') return 'economy';
  if (id.startsWith('research_')) return 'research';
  if (id.startsWith('upgrade_')) return 'upgrade';
  if (id.startsWith('unlock_reward_') || id.startsWith('reward_')) return 'reward';
  if (id.startsWith('start_') || id === 'offline_1') return 'start';
  return 'master';
}

// スキル順: 系統優先→安い順。優先系統にないものも後で買う(全取得を目指す)。
// 生産・解放ノードを先に、解析系QoLノードは余りPTで後から取る
// 方針入口の増幅ノード(_amp)は価格こそQoL枠だが効果は生産増幅=プレイヤーは通常のスキルとして
// 安い順・系統順で普通に買う(「+75%が8PT」を余りPT扱いで後回しにするのは不自然)。
function isDeferredUtility(id) { return G.isUtilitySkill(id) && !/_amp$|_stall$|_peddler$|_echo$|^ensemble$/.test(id); }
// 署名スキルの相互排除(2026-07-16 ユーザー指示「各方針は他方針が取らないスキルを1つ以上取る」):
// この方針の取得順から「他方針の署名スキル」を除外する。自分の署名は残す=自分だけが取り、他は取らない。
// 署名は全て葉ノードなので除外しても前提連鎖に影響なし。
function excludeForeignSignatures(sim, ids) {
  const foreign = G.foreignSignatures(sim.strat.id);
  return ids.filter(id => !foreign.has(id));
}
function skillOrderByBranch(priority) {
  return function (sim) {
    const nodes = G.SKILL_NODES.slice();
    nodes.sort((a, b) => {
      const ua = isDeferredUtility(a.id) ? 1 : 0; const ub = isDeferredUtility(b.id) ? 1 : 0;
      if (ua !== ub) return ua - ub;
      const pa = priority.indexOf(branchOf(a.id)); const pb = priority.indexOf(branchOf(b.id));
      const qa = pa < 0 ? 99 : pa; const qb = pb < 0 ? 99 : pb;
      if (qa !== qb) return qa - qb;
      return G.skillCostOf(a) - G.skillCostOf(b);
    });
    return excludeForeignSignatures(sim, nodes.map(n => n.id));
  };
}
const cheapestFirst = function (sim) {
  return excludeForeignSignatures(sim, G.SKILL_NODES.slice().sort((a, b) => {
    const ua = isDeferredUtility(a.id) ? 1 : 0; const ub = isDeferredUtility(b.id) ? 1 : 0;
    if (ua !== ub) return ua - ub;
    return G.skillCostOf(a) - G.skillCostOf(b);
  }).map(n => n.id));
};

function cheapestNextSkillCost(sim) {
  // プレイヤーは生産・解放に効くノードを転生目標にする(解析系QoLノードはついで取り)。
  // 相乗り段バンドル(2026-07-14 ④修復): 同じ段(コスト同帯)の未取得スキルは1回の転生でまとめて
  // 買い切る前提で「合計」を目標にする。pG平坦下では最安1本狙いだと2本目のために同じ8.5桁を
  // 再耕作する周回(④比×1.0)が生まれる=R18実測。合計狙いなら同一しきい値で両方買えて毎転生フル段前進。
  // 他方針の署名スキルは買わない(=転生目標にもしない。さもないと永久に届かない目標で停滞する)
  const foreign = G.foreignSignatures(sim.strat.id);
  let best = Infinity, bestAny = Infinity, bundle = 0;
  for (const n of G.SKILL_NODES) {
    if (sim.skills[n.id] || foreign.has(n.id)) continue;
    if (!n.prereqs.every(q => sim.skills[q])) continue;
    const c = G.skillCostOf(n);
    bestAny = Math.min(bestAny, c);
    if (!G.isUtilitySkill(n.id)) best = Math.min(best, c);
  }
  if (best !== Infinity) {
    for (const n of G.SKILL_NODES) {
      if (sim.skills[n.id] || foreign.has(n.id)) continue;
      if (G.isUtilitySkill(n.id)) continue;
      if (!n.prereqs.every(q => sim.skills[q])) continue;
      const c = G.skillCostOf(n);
      if (c <= best * 1.1) bundle += c; // 同帯(±10%)は同段の相乗り=まとめ買い対象
    }
    return Math.max(best, bundle);
  }
  if (bestAny !== Infinity) return bestAny;
  return null;
}

function pickRewardByPriority(priority) {
  return function (sim, offer) {
    for (const want of priority) {
      const c = offer.find(o => o.kind === 'perk' && o.id === want);
      if (c) return c;
    }
    // 優先リストに無い枠: まだ1枚も持っていない札(新規解放=所持0)が出ていれば1枚拾う
    // (プレイヤー視点=新しく解放された報酬は一度は試す)。それ以外は従来どおり先頭。
    // 旧・offer[0]固定だと新規解放した札(goldenBeastMutation等)が回転任せで取り漏れる問題を解消しつつ、
    // 既取得の札の配分は変えない(所持数最小へ全面的に寄せると金の複利が暴走し最終周回がInfinity化するため最小限に留める)。
    const fresh = offer.find(o => o.kind === 'perk' && (sim.run.perks[o.id] || 0) === 0);
    if (fresh) return fresh;
    const up = offer.find(o => o.kind === 'upgrade');
    if (up) return up;
    return offer[0] || null;
  };
}
// 相性優先(2026-07-06 第9次): 報酬選択画面には「倒した種類と相性倍率」が表示される。
// 直前に倒した種類の相性が2倍以上のカテゴリに「自分が欲しい札」があれば、それを先に拾う。
// 「同じ1枠でも実入りが2倍以上になる瞬間はそれを拾うのが得。ただし欲しくない札(反動つきの
// リスク札など)は相性が良くても取らない」というプレイヤー判断。
// 毎周回1枚確保(2026-07-14): リストの札を「この周回でまだ0枚」の間だけ最優先で拾い、
// 確保後は基本ピッカーに戻る。優先リスト末尾の札が周回によって取り漏れて③-c
// (毎周回取る方針の実在)が崩れる問題への対処(プレイヤー挙動=「回復系は毎周回1枚は確保」)。
function pickRewardOncePerRunFirst(onceList, basePicker) {
  return function (sim, offer) {
    for (const want of onceList) {
      if ((sim.run.perks[want] || 0) > 0) continue;
      const c = offer.find(o => o.kind === 'perk' && o.id === want);
      if (c) return c;
    }
    return basePicker(sim, offer);
  };
}
// 序盤スキップ(2026-07-14 ③goldenRate対策): 指定札を最初のminRuns周回では取らない(オファーから除外)。
// S3のrun1はgolden基盤(量/威力)が薄くgoldenRateのliftが1.04に希釈される=「金率は基盤が乗る3周目から」
// というプレイヤー挙動で、低lift周回の取得自体を無くす(③は「取得した全周回で≥1.1」判定のため)。
function pickRewardSkipEarly(skipList, minRuns, basePicker) {
  return function (sim, offer) {
    if (sim.runs.length < minRuns) {
      const filtered = offer.filter(o => !(o.kind === 'perk' && skipList.includes(o.id)));
      if (filtered.length) return basePicker(sim, filtered);
    }
    return basePicker(sim, offer);
  };
}
function pickRewardAffinityAware(priority) {
  const base = pickRewardByPriority(priority);
  const catOf = {}; G.REWARD_POOL.forEach(r => catOf[r.id] = r.category);
  return function (sim, offer) {
    const t = sim.run.lastKillType;
    const aff = (G.P.mtype && G.P.mtype.affinity && G.P.mtype.affinity[t]) || null;
    if (aff) {
      // 自分の優先リストの中で、相性2倍以上のカテゴリに入っている札を優先
      for (const want of priority) {
        const c = offer.find(o => o.kind === 'perk' && o.id === want && (aff[catOf[o.id]] || 1) >= 2.0);
        if (c) return c;
      }
      // 設備強化カード(equipment)も相性2倍以上なら拾う(個別強化は反動なし)
      if ((aff.equipment || 1) >= 2.0) {
        const up = offer.find(o => o.kind === 'upgrade');
        if (up) return up;
      }
    }
    return base(sim, offer);
  };
}
// 個別強化優先(最上位設備の強化を選ぶ)
function pickRewardUpgradeFirst(fallback) {
  return function (sim, offer) {
    const ups = offer.filter(o => o.kind === 'upgrade');
    if (ups.length > 0) {
      ups.sort((a, b) => (G.UPGRADES.findIndex(u => u.id === b.id)) - (G.UPGRADES.findIndex(u => u.id === a.id)));
      return ups[0];
    }
    return pickRewardByPriority(fallback)(sim, offer);
  };
}

// 研究購入枠: 段1に加え、解放済みの段2/段3カードも同じ予算基準で買う(購入対象リストが増えるだけ)
function buyResearchLine(sim, id, ratio) {
  // 支援研究は支援先が育ってから買う(2026-07-14 ①grandmaCrowd序盤希釈対策)。
  // 大量雇用(支援型=×1.003^おばあちゃん台数)は run0(1台)/run1(15-33台)ではほぼ無効果
  // (lift1.00-1.02のNG源)。台数200以降(diag実測でlift1.5超に立ち上がる帯)まで買い控えるのは
  // プレイヤー挙動としても自然。コスト側を動かさないので weave/⑨段階の梯子には無影響。
  if (id === 'grandmaCrowd' && ((sim.run.upgrades.grandma || 0) < 200)) return;
  G.tryBuyResearch(sim, id, ratio);
  G.tryBuyResearchStage(sim, id, 2, ratio);
  G.tryBuyResearchStage(sim, id, 3, ratio);
}

// 研究一括パス: 全研究ラインを予算比で購入試行
function buyAllResearch(sim, ratio) {
  for (const r of G.RESEARCH) buyResearchLine(sim, r.id, ratio);
}

// 標準買い物: 研究(段階含む)→効率良アップグレード→(設備購入で解放された研究の即時購入)
// 最後の研究パスは「設備を買った直後に出現した研究カードをその場で買う」プレイヤー動作の再現
function standardBuy(researchRatio, upgradeRatio) {
  return function (sim, prod) {
    // 研究: 安い順に、コストが所持のresearchRatio以下なら買う(段2/段3カードも同枠)
    buyAllResearch(sim, researchRatio);
    // アップグレード: 効率最良を、コストが所持のupgradeRatio以下の間買い続ける(最大30回/秒)
    // ※効率最良(novelty込み)が予算外のときは買わずに貯める=「次の新設備のための貯金」。
    //   「買える中での最良」に変えると細かい買い物で財布が減り第0回の解放が遅れる(中央値0.82→1.23=実測)
    for (let i = 0; i < 30; i++) {
      const u = G.bestEfficiency(sim, prod, null);
      if (!u) break;
      if (!G.tryBuyUpgrade(sim, u, upgradeRatio)) break;
    }
    buyAllResearch(sim, researchRatio);
  };
}

// 「次に欲しいスキル」= その方針の取得順で最初に未取得のノード(ついで枠は目標にしない)。
// 2026-07-12 ④対策: 旧・全体最安基準だと「買い物は系統順・転生目安は最安」のズレで、系統の高いノードを
// 貯める間ずっと同じ額で転生を繰り返す(×1.0の反復周回=S5/S8/S9で計7-9本)。目安を本当に欲しい物に揃える。
function nextTargetSkillCost(sim) {
  const strat = sim.strat;
  if (strat && strat.skillOrder) {
    const order = strat.skillOrder(sim);
    for (const id of order) {
      if (sim.skills[id]) continue;
      const n = G.SKILL_NODES.find(x => x.id === id);
      if (!n || !n.prereqs.every(q => sim.skills[q])) continue;
      if (isDeferredUtility(id)) continue;
      return G.skillCostOf(n);
    }
  }
  return cheapestNextSkillCost(sim);
}
// 転生床1200秒(2026-07-14 T1序盤クラスタ対策): 「20分は育ててから転生」= T1下限そのもの。
// 序盤周回(run1-4)が2-14分で終わるのは金の序盤ブースト+安い序盤段の複合で、梯子側(tune)では
// 押し込めなかった(FAIL:0->1)。全方針の最低経過時間を120-180→1200秒へ。
function prestigeWhen(minElapsedSec, gainFactor) {
  // 「この周回の獲得予定PTだけで、次に欲しいスキルのコストに届いたら転生」
  // 目標の単調化(2026-07-14 ④修復の恒久解): 目標 = max(次スキル束, 前回目標×1.57)。
  // スキル束(入口4本=5PT等)や個別上書きで梯子の段差が×1.57未満になるペアは、前回目標×1.57が下駄になる
  // =転生しきい値の比が常に≥×1.57(pG0.023で=10^8.5=④の1e8+余裕)。プレイヤー語: 「前回より上を目指してから転生」。
  return function (sim) {
    // ⑧対応(2026-07-16): 到達連動ノルマが「この戦略の実際の転生条件」に未達を係留できるよう公開
    sim._prGainFactor = gainFactor; sim._prMinSec = minElapsedSec;
    if (sim.t - sim.run.startT < minElapsedSec) return false;
    if (sim.run.cookies < G.prestigeCostOf(sim)) return false; // 転生には所持クッキー(10のべき乗・前回より大)が必要
    const next = cheapestNextSkillCost(sim);
    if (next === null) {
      // 勝利の一周(2026-07-16 ③深部報酬対策・ユーザー決定「時間が問題なら地平を伸ばして達成でよい」):
      // ツリー完成の転生で最深スキル(巨砕ミル/金獣変異の解禁等)を買った「完成後の一周」を、従来は
      // 永遠の部分周回にしていた=解禁済み報酬を持つ完全な周回がゼロで③の判定が構造的に不可能だった。
      // 完成後に一度だけ、従来と同じ梯子目標(前回目標×1.57)で転生する=「完成状態で一周だけ回ってから引退」。
      // その一周は最終スキル束(master_final等)を持つ=④(前周回超)も自然に満たす。2周目以降は従来どおり引退。
      if (sim._victoryLapDone) return false;
      // 発火予約(_victoryLapArm)と実施済み(_victoryLapDone)を分離(2026-07-17 バグ修正): 判断trueと同時に
      // Doneを立てると、⑧インターセプト(未達→転生を次秒に遅らせる)がtrueを飲み込んだ後、次tickの
      // このガードが転生を永久拒否=完成後の一周が消える(S4 run9が7200s部分周回化を実測)。
      // Armは判断時、Doneは実転生時(doPrestige)に立てる。Arm中は同じ判断を返し続ける。
      if (sim._victoryLapArm) return true;
      const target = (sim._prTarget || 0) * 1.57;
      const gain = G.prestigeGainOf(sim.run.runCookies);
      if (gain >= target * gainFactor && gain >= 1) { sim._victoryLapArm = true; sim._prTarget = Math.max(target, gain / gainFactor); return true; }
      // 見切り(2時間)——ただし「前回の記録(周回総生産)を超えてから」見切る(プレイヤー語: 記録更新までは粘る)。
      // ④は合格条件=エンジン強制・ゲームロックはしない(2026-07-26 ユーザー指摘で撤回)。この自然な記録意識と
      // 実績丸ごとラチェットの組で④が全周回成立することを verify100 で測る。見切り完全撤去は不可
      // (gain×1.57目標は平坦収入下で×205の時間を要し全方針停滞=全解放×をv32で実測)。
      if (sim.t - sim.run.startT >= Math.min(7200, G.PRESTIGE_MAX_SEC) - 1 && gain >= 1 && sim.run.runCookies > (sim._prevRC || 0)) { sim._victoryLapArm = true; sim._prTarget = Math.max(target, gain / gainFactor); return true; }
      return false;
    }
    // 転生しきい値=次スキル束(相乗り段=約1e8×間隔)or 前回目標×1.57 の高い方(2026-07-14 ④修復の恒久解)。
    // 段が1e8×間隔=毎周回1段前進で cookies比≈1e8(④)。「生産の勢い」(momentum)が時間で必ず伸びる=
    // どの段の目標にも上限時間内に到達=中盤停滞が起きない(勢い導入前は到達できず停滞していた)。
    const target = Math.max(next, (sim._prTarget || 0) * 1.57);
    const gain = G.prestigeGainOf(sim.run.runCookies);
    // 梯子は「目標と達成PTの高い方」を積む(2026-07-15 ④修復): 1200s下限のオーバーシュートで
    // 実PTが目標を超えた分も次の床に反映=次周回は必ず前回実PTの1.57倍超が要る=生産段を毎回前進。
    if (gain >= target * gainFactor && gain >= 1) { sim._prTarget = Math.max(target, gain / gainFactor); return true; }
    // 見切り(2時間)——ただし「前回の記録を超えてから」(プレイヤー語: 記録更新までは粘る)。④は合格条件=
    // エンジン強制・ゲームロックなし(2026-07-26)。ラチェットは実績丸ごと(上限なし)=目標到達周回の④も自然成立。
    if (sim.t - sim.run.startT >= Math.min(7200, G.PRESTIGE_MAX_SEC) - 1 && gain >= 1 && sim.run.runCookies > (sim._prevRC || 0)) { sim._prTarget = Math.max(target, gain / gainFactor); return true; }
    return false;
  };
}

const STRATEGIES = [
  {
    id: 'S1', name: 'バランス効率型',
    // タップ4/秒。研究はコスト<=所持30%、強化は効率最良をコスト<=所持25%で購入。
    // 転生は「所持PT+獲得見込みPT >= 次スキル最安コスト×1.2」かつ経過300秒以上。
    tapRate: 4, goldenTake: 1,
    pickPolicy: sim => 'bake',
    buy: standardBuy(0.30, 0.25),
    // beastScent(S1署名報酬)+goldenFirstHitを毎周回1枚確保(2026-07-16 ③-c対策): fresh拾い任せだと
    // 取り漏れ周回が出て③-c(毎回取る方針の実在)が崩れる。gFHの③-a(min≥1.1)はS4が担ぐ=S1はカバレッジ専任
    // (③-cは保持の存在だけを見る=S1のgFH liftの高低は判定に無関係)。
    pickReward: pickRewardOncePerRunFirst(['beastScent', 'goldenFirstHit'], pickRewardAffinityAware(['beastHeatFerment', 'goldenAmount', 'monsterDamage', 'huntingCore', 'goldenRate', 'monsterRate', 'goldenPower', 'crackedFang', 'monsterStay'])),
    shouldPrestige: prestigeWhen(1200, 1.2),
    skillOrder: cheapestFirst
  },
  {
    id: 'S2', name: 'クリック会心型',
    // タップ7/秒。クリック系強化はコスト<=所持40%、設備の買い増し<=10%。ただし「まだ1台も
    // 持っていない新設備」は<=25%まで出す(クリック力は毎秒生産に連動すると画面に表示される=
    // 新設備の解放はクリック型にも素直に嬉しいので一度は試す)。研究は指先の型・銀行配当を<=50%で優先。
    tapRate: 7, goldenTake: 1,
    pickPolicy: sim => 'click',
    buy: function (sim, prod) {
      buyResearchLine(sim, 'fingerTechnique', 0.50);
      buyResearchLine(sim, 'bankClickDividend', 0.50);
      for (const r of G.RESEARCH) buyResearchLine(sim, r.id, 0.20);
      // クリック系40%と設備予算は独立。旧実装は「クリックが買えた秒は設備を見ない」で、
      // 指が常に買える序盤は設備購入が止まりっぱなしだった(第0回grandma=22分・中央値1.98=実測)。
      // 設備を一律25%にすると中盤の経済が強くなりすぎ周回が縮む(T1 27→14/48=実測)ため初台のみ。
      for (let i = 0; i < 30; i++) {
        const clicks = G.visibleUpgrades(sim).filter(u => u.type === 'click');
        let done = false;
        for (const u of clicks) { if (G.tryBuyUpgrade(sim, u, 0.40)) { done = true; break; } }
        const c = G.bestEfficiency(sim, prod, 'cps', 0.25);
        if (c && G.tryBuyUpgrade(sim, c, (sim.run.upgrades[c.id] || 0) === 0 ? 0.25 : 0.10)) done = true;
        if (!done) break;
      }
      buyResearchLine(sim, 'fingerTechnique', 0.50);
      buyResearchLine(sim, 'bankClickDividend', 0.50);
      buyAllResearch(sim, 0.20);
    },
    pickReward: pickRewardByPriority(['monsterDamage', 'crackedFang', 'goldenAmount', 'goldenTarget', 'brandHunt', 'goldenRate', 'beastHeatFerment']),
    shouldPrestige: prestigeWhen(1200, 1.0),
    skillOrder: skillOrderByBranch(['core', 'click', 'golden', 'economy', 'research', 'monster', 'auto', 'upgrade', 'reward', 'start', 'master'])
  },
  {
    id: 'S3', name: '金クッキー特化型',
    // タップ4/秒。香料棚はコスト<=所持35%で優先購入。研究は香料調合<=60%優先。
    tapRate: 4, goldenTake: 1,
    pickPolicy: sim => 'golden',
    buy: function (sim, prod) {
      buyResearchLine(sim, 'spiceBlend', 0.60);
      for (const r of G.RESEARCH) buyResearchLine(sim, r.id, 0.25);
      for (let i = 0; i < 30; i++) {
        const spice = G.UPGRADES.find(u => u.id === 'spiceRack');
        const vis = G.visibleUpgrades(sim);
        let done = false;
        if (vis.includes(spice)) done = G.tryBuyUpgrade(sim, spice, 0.35);
        if (!done) {
          const u = G.bestEfficiency(sim, prod, null);
          if (!u || !G.tryBuyUpgrade(sim, u, 0.20)) break;
        }
      }
      buyResearchLine(sim, 'spiceBlend', 0.60);
      buyAllResearch(sim, 0.25);
    },
    pickReward: pickRewardSkipEarly(['goldenRate'], 2, pickRewardByPriority(['goldenRate', 'goldenPower', 'goldenAmount', 'beastScent', 'goldenChain', 'goldenTarget', 'goldenFirstHit', 'beastHeatFerment'])),
    shouldPrestige: prestigeWhen(1200, 1.2),
    skillOrder: skillOrderByBranch(['core', 'golden', 'click', 'economy', 'research', 'auto', 'monster', 'upgrade', 'reward', 'start', 'master'])
  },
  {
    id: 'S4', name: '狩猟特化型',
    // タップ6/秒。ノルマ比(今回/必要)が2.0未満なら効率最良強化を<=50%で購入、それ以外<=20%。
    tapRate: 6, goldenTake: 1,
    pickPolicy: sim => 'hunt',
    buy: function (sim, prod) {
      for (const r of G.RESEARCH) buyResearchLine(sim, r.id, 0.30);
      const quota = Math.max(1, G.quotaAtElapsed(sim, sim.t - sim.run.startT));
      const ratio = sim.run.runCookies / quota;
      const budget = ratio < 2.0 ? 0.50 : 0.20;
      for (let i = 0; i < 30; i++) {
        const u = G.bestEfficiency(sim, prod, null);
        if (!u || !G.tryBuyUpgrade(sim, u, budget)) break;
      }
      buyAllResearch(sim, 0.30);
    },
    // ③-a対策(2026-07-16・goldenRate skipEarlyと同型のプレイヤー挙動):
    // - monsterRateはrun0では取らない(確立周回=狩猟基盤が薄く出現率のliftが1.08に希釈。run1+は全て≥1.11)
    // - goldenFirstHitはrun5から毎周回1枚確保(初回入手直後の周回は金基盤が薄くlift1.01-1.09。
    //   run5+は[1.14..1.45]=③-a「取得した全周回≥1.1」を確実に満たす帯)
    // - 勝利の一周(ツリー完成後)ではgFHを取らない(一周は金ブースト飽和でliftが1.09に希釈=③-aのminを割る。
    //   一周のgFHカバレッジ(③-c)はS1が毎周回確保で担う)
    pickReward: (function (base) {
      return function (sim, offer) {
        // gFHはrun5-7だけ保持(③-aのmin≥1.1担ぎ): 序盤(<5)は金基盤が薄く、末期(≥8=最終通常周回と勝利の一周)は
        // 金ブースト飽和でliftが1.0-1.04に希釈される(装備挙動の変更のたびに弱い周回が動く=両端を切るのが頑健)。
        // 末期のgFHカバレッジ(③-c)はS1の毎周回確保が担う。
        const late = sim.runs.length >= 8 || sim._allSkills;
        const off = late ? offer.filter(o => !(o.kind === 'perk' && o.id === 'goldenFirstHit')) : offer;
        return base(sim, off);
      };
    })(pickRewardSkipEarly(['monsterRate'], 1,
      pickRewardSkipEarly(['goldenFirstHit'], 6,
        pickRewardOncePerRunFirst(['biteRecovery', 'goldenFirstHit'],
          pickRewardByPriority(['monsterRate', 'monsterDamage', 'beastHeatFerment', 'huntingCore', 'crackedFang', 'monsterStay', 'chainPrep', 'biteRecovery']))))),
    shouldPrestige: prestigeWhen(1200, 1.2),
    skillOrder: skillOrderByBranch(['core', 'monster', 'auto', 'economy', 'research', 'reward', 'click', 'golden', 'upgrade', 'start', 'master'])
  },
  {
    id: 'S5', name: '研究貯蓄型',
    // タップ3/秒。研究はコスト<=所持80%で最優先。強化はコスト<=所持8%のみ。
    // ただし「まだ1台も持っていない新設備」は研究の入口(買うとその研究カードが開くと
    // ゲームに表示される)なので、通常の強化とは別枠で<=65%まで出して1台買う
    // (45%だと第0回のgrandma/bank初台が帯域比1.87/1.62に遅れ中央値1.13=T2第0回NG。2026-07-10)。
    tapRate: 3, goldenTake: 1,
    pickPolicy: sim => 'bake',
    buy: function (sim, prod) {
      for (const r of G.RESEARCH) buyResearchLine(sim, r.id, 0.80);
      // 新設備の別枠(効率比較の土俵に乗せず「見えたら1台」= 研究の入口を開ける動き)
      for (const u of G.visibleUpgrades(sim)) {
        if ((sim.run.upgrades[u.id] || 0) > 0) continue;
        if (G.tryBuyUpgrade(sim, u, 0.85)) break;
      }
      for (let i = 0; i < 30; i++) {
        const u = G.bestEfficiency(sim, prod, null);
        if (!u || !G.tryBuyUpgrade(sim, u, 0.08)) break;
      }
      buyAllResearch(sim, 0.80);
    },
    pickReward: pickRewardUpgradeFirst(['beastHeatFerment', 'goldenAmount', 'monsterDamage', 'goldenRate']),
    shouldPrestige: prestigeWhen(1200, 2.0),
    skillOrder: skillOrderByBranch(['core', 'economy', 'research', 'auto', 'upgrade', 'click', 'golden', 'monster', 'reward', 'start', 'master'])
  },
  {
    id: 'S6', name: '早回し転生型',
    // タップ5/秒。強化<=30%。転生は経過240秒以上で「PT合計>=次スキル最安×1.0」になった瞬間。
    tapRate: 5, goldenTake: 1,
    pickPolicy: sim => 'balanced',
    buy: standardBuy(0.30, 0.30),
    pickReward: pickRewardAffinityAware(['goldenAmount', 'monsterDamage', 'beastHeatFerment', 'goldenRate', 'monsterRate']),
    shouldPrestige: prestigeWhen(1200, 1.0),
    skillOrder: cheapestFirst
  },
  {
    id: 'S7', name: '長期育成型',
    // タップ4/秒。転生は「PT合計>=次スキル最安×4.0」または経過5400秒以上で獲得PT>=1。
    tapRate: 4, goldenTake: 1,
    pickPolicy: sim => 'bake',
    buy: standardBuy(0.35, 0.25),
    pickReward: pickRewardAffinityAware(['huntingCore', 'beastHeatFerment', 'goldenAmount', 'monsterDamage', 'goldenPower', 'goldenRate']),
    // 転生は「次スキルコストの4倍」を貯めてから(まとめ買い派)。最短600秒。
    shouldPrestige: prestigeWhen(1200, 4.0),
    skillOrder: cheapestFirst
  },
  {
    id: 'S8', name: '最新設備ラッシュ型',
    // タップ4/秒。常に可視最上位の設備を狙って貯金(それ以外はコスト<=所持5%のみ)。研究<=22%。
    tapRate: 4, goldenTake: 1,
    pickPolicy: sim => 'bake',
    buy: function (sim, prod) {
      for (const r of G.RESEARCH) buyResearchLine(sim, r.id, 0.22);
      const vis = G.visibleUpgrades(sim);
      const top = vis[vis.length - 1];
      for (let i = 0; i < 30; i++) {
        let done = false;
        if (top) done = G.tryBuyUpgrade(sim, top, 1.0);
        if (!done) {
          const u = G.bestEfficiency(sim, prod, null);
          if (!u || !G.tryBuyUpgrade(sim, u, 0.05)) break;
        }
      }
      buyAllResearch(sim, 0.22);
    },
    pickReward: pickRewardUpgradeFirst(['monsterDamage', 'beastHeatFerment', 'goldenAmount']),
    shouldPrestige: prestigeWhen(1200, 1.5),
    skillOrder: skillOrderByBranch(['core', 'economy', 'auto', 'upgrade', 'research', 'monster', 'click', 'golden', 'reward', 'start', 'master'])
  },
  {
    id: 'S9', name: 'ノルマ死守型',
    // タップ5/秒。ノルマ比<1.3で効率最良強化を<=60%で即購入。ノルマ失敗したら即転生(獲得PT>=1)。
    tapRate: 5, goldenTake: 1,
    pickPolicy: sim => 'hunt',
    buy: function (sim, prod) {
      for (const r of G.RESEARCH) buyResearchLine(sim, r.id, 0.30);
      const quota = Math.max(1, G.quotaAtElapsed(sim, sim.t - sim.run.startT));
      const ratio = sim.run.runCookies / quota;
      const budget = ratio < 1.3 ? 0.60 : 0.15;
      for (let i = 0; i < 30; i++) {
        const u = G.bestEfficiency(sim, prod, null);
        if (!u || !G.tryBuyUpgrade(sim, u, budget)) break;
      }
      buyAllResearch(sim, 0.30);
    },
    // goldenPowerを毎周回1枚確保(2026-07-16 ③-c対策・beastScent/S1と同型): ③-cの金威力カバレッジは
    // オファー回転頼みで担い手が消えることがある(勝利の一周導入で再発を実測)。③-a(min≥1.1)はS4等の保持が
    // 担うため、毎周回確保の担ぎ手は薄マージン測定を持たないS9に置く。
    pickReward: pickRewardOncePerRunFirst(['goldenPower'], pickRewardByPriority(['monsterRate', 'beastHeatFerment', 'monsterDamage', 'huntingCore', 'monsterStay', 'goldenAmount'])),
    // ノルマ失敗後は目標達成し次第すぐ転生、ノルマ維持中は1.5倍まで粘る。
    // 目標の単調化(2026-07-14): prestigeWhenと同じ「前回目標×1.57」の床を敷く。
    // S9だけ床が無く即転生が④(前回比1e8)を迂回していた(baseline R19: S9のみ16/32)。
    shouldPrestige: function (sim) {
      const gain = G.prestigeGainOf(sim.run.runCookies);
      const next = cheapestNextSkillCost(sim);
      const factor0 = sim.run.quotaFailed ? 1.0 : 1.5;
      sim._prGainFactor = factor0; sim._prMinSec = 1200; // ⑧対応: 実際の転生条件を公開(S9は未達後1.0/維持中1.5)
      if ((sim.t - sim.run.startT) < 1200) return false;
      if (sim.run.cookies < G.prestigeCostOf(sim)) return false; // 転生には所持クッキー(10のべき乗・前回より大)が必要
      const factor = factor0;
      if (next === null) {
        // 勝利の一周(prestigeWhenと同じ・2026-07-16): ツリー完成後に一度だけ梯子目標で転生
        if (sim._victoryLapDone) return false;
        if (sim._victoryLapArm) return true; // 発火予約中(⑧インターセプトの1秒遅延を消化)=prestigeWhenと同じ
        const target = (sim._prTarget || 0) * 1.57;
        if (gain >= target * factor && gain >= 1) { sim._victoryLapArm = true; sim._prTarget = target; return true; }
        // 見切り(2時間・記録更新後)——prestigeWhenと同じ(2026-07-26)
        if ((sim.t - sim.run.startT) >= Math.min(7200, G.PRESTIGE_MAX_SEC) - 1 && gain >= 1 && sim.run.runCookies > (sim._prevRC || 0)) { sim._victoryLapArm = true; sim._prTarget = Math.max(target, gain / factor); return true; }
        return false;
      }
      const target = Math.max(next, (sim._prTarget || 0) * 1.57);
      // 達成gainを梯子に反映(2026-07-17 ④修復: prestigeWhenと同じ床。S9だけ target のみ保存で、
      // 1200s床のオーバーシュート(実績5倍超過等)が記録されず次周回の目標が実績を下回り④が割れていた)
      if (gain >= target * factor && gain >= 1) { sim._prTarget = Math.max(target, gain / factor); return true; }
      // 見切り(2時間・記録更新後)——prestigeWhenと同じ(2026-07-26)
      if ((sim.t - sim.run.startT) >= Math.min(7200, G.PRESTIGE_MAX_SEC) - 1 && gain >= 1 && sim.run.runCookies > (sim._prevRC || 0)) { sim._prTarget = Math.max(target, gain / factor); return true; }
      return false;
    },
    skillOrder: skillOrderByBranch(['core', 'monster', 'auto', 'reward', 'economy', 'research', 'click', 'golden', 'upgrade', 'start', 'master'])
  },
  // S10(のんびり放置型)は削除(2026-07-13 ユーザー指示「プレイ方針は総クッキーを増やすことを目指すので、のんびりとか論外」)
  // ==== R17(2026-07-17 ユーザー指示「プレイ方針のパターンが少ないなら、シミュ条件を考慮せず追加」) ====
  // 追加4種はいずれも実在するプレイヤー類型で、総クッキー最大化を自分の流儀で狙う(シミュ条件は考慮しない)。
  // 装備の好み(eq2Taste)が既存5方針の既定選好と違う=自然に別の装備を「自分の最良」として着る。
  {
    id: 'S10', name: 'リスク愛好型',
    // 豪快なギャンブラー: 金クッキーの波で一気に稼ぐ。装備は代償つき(B型)の強い上げを平気で使い、
    // 会心や討伐ダメージの博打ステータスを好む。買い物も強気(高予算比)。
    tapRate: 4, goldenTake: 1,
    pickPolicy: sim => 'golden',
    buy: standardBuy(0.35, 0.30),
    // 張り先は金と討伐に分散(金パワー系の三点積み=goldenPower+Amount+Chainは複利が暴走し
    // 転生周回がInfinity化する=「転生周回は有限」の教義違反を実測。博打好きでも張り先は散らすのが自然)
    pickReward: pickRewardByPriority(['crackedFang', 'goldenPower', 'monsterDamage', 'goldenTarget', 'brandHunt', 'goldenAmount']),
    shouldPrestige: prestigeWhen(1200, 1.0),
    skillOrder: skillOrderByBranch(['core', 'golden', 'click', 'monster', 'economy', 'auto', 'research', 'upgrade', 'reward', 'start', 'master']),
    eq2Taste: { fav: new Set(['goldenAmtMul', 'goldenBoostMul', 'critAdd', 'dmgMul']), bAversion: 0.5, cFreqMul: 1 }
  },
  {
    id: 'S11', name: '状況殺法型',
    // 状況を使いこなす機会主義者: ボス・モンスター交戦・金ブーストなどの「その瞬間」に強い
    // C型(状況起動)装備を信頼して使う。討伐の間合いで稼ぐ。
    tapRate: 5, goldenTake: 1,
    pickPolicy: sim => 'hunt',
    buy: standardBuy(0.30, 0.30),
    pickReward: pickRewardAffinityAware(['monsterDamage', 'monsterRate', 'crackedFang', 'beastHeatFerment', 'monsterStay', 'goldenAmount']),
    shouldPrestige: prestigeWhen(1200, 1.1),
    skillOrder: skillOrderByBranch(['core', 'monster', 'auto', 'economy', 'reward', 'research', 'click', 'golden', 'upgrade', 'start', 'master']),
    eq2Taste: { fav: new Set(['dmgMul', 'critAdd', 'spawnMul', 'stayMul', 'killValMul', 'goldenAmtMul']), bAversion: 6, cFreqMul: 3 }
  },
  {
    id: 'S12', name: '職人型',
    // 工房を愛するクラフター: 素材・ドロップ・色素材が増える装備を好み、料理と装備作成で経済を回す。
    // 生産は堅実に焼成で稼ぐ。
    tapRate: 4, goldenTake: 1,
    pickPolicy: sim => 'bake',
    buy: standardBuy(0.30, 0.25),
    pickReward: pickRewardByPriority(['beastHeatFerment', 'monsterStay', 'monsterDamage', 'monsterRate', 'goldenAmount', 'biteRecovery']),
    shouldPrestige: prestigeWhen(1200, 1.2),
    skillOrder: skillOrderByBranch(['core', 'economy', 'auto', 'monster', 'research', 'reward', 'click', 'golden', 'upgrade', 'start', 'master']),
    eq2Taste: { fav: new Set(['dropMul', 'dropRateAdd', 'dropLuck', 'oreAdd', 'resDisc', 'upDisc']), bAversion: 6, cFreqMul: 1 }
  },
  {
    id: 'S13', name: '堅実割引型',
    // 無駄嫌いの倹約家: 割引・維持ボーナスなどの確実に効く装備だけを信じ、代償つき(B型)は嫌い、
    // 状況起動(C型)は信用しない。買い物は慎重(低予算比)でコツコツ伸ばす。
    tapRate: 4, goldenTake: 1,
    pickPolicy: sim => 'balanced',
    buy: standardBuy(0.25, 0.20),
    pickReward: pickRewardAffinityAware(['goldenAmount', 'monsterDamage', 'beastHeatFerment', 'goldenRate', 'monsterRate']),
    shouldPrestige: prestigeWhen(1200, 1.2),
    skillOrder: cheapestFirst,
    eq2Taste: { fav: new Set(['upDisc', 'resDisc', 'cpsMul', 'holdBonus']), bAversion: 10, cFreqMul: 0.5 }
  },
  // ==== R18(2026-07-18 装備(b)着用拡大の続き): 未着用の色銘ニッチを自然に好む類型を追加 ====
  {
    id: 'S14', name: '会心一点型',
    // 会心にロマンを感じる一点豪華主義のクリッカー: 会心率と一撃の重さを最優先で積む。
    tapRate: 7, goldenTake: 1,
    pickPolicy: sim => 'click',
    buy: standardBuy(0.30, 0.30),
    pickReward: pickRewardByPriority(['crackedFang', 'monsterDamage', 'goldenAmount', 'goldenTarget', 'brandHunt']),
    shouldPrestige: prestigeWhen(1200, 1.0),
    skillOrder: skillOrderByBranch(['core', 'click', 'monster', 'golden', 'economy', 'auto', 'research', 'upgrade', 'reward', 'start', 'master']),
    eq2Taste: { fav: new Set(['critAdd', 'clickMul']), bAversion: 2, cFreqMul: 2 }
  },
  {
    id: 'S15', name: '守りの砦型',
    // 腰を据えた籠城派: モンスターを長く留めて捌き、ノルマ維持ボーナスと毎秒生産で堅く積む。
    tapRate: 3, goldenTake: 1,
    pickPolicy: sim => 'bake',
    buy: standardBuy(0.30, 0.25),
    pickReward: pickRewardByPriority(['monsterStay', 'beastHeatFerment', 'goldenAmount', 'monsterDamage', 'biteRecovery']),
    shouldPrestige: prestigeWhen(1200, 1.2),
    skillOrder: skillOrderByBranch(['core', 'auto', 'economy', 'monster', 'research', 'reward', 'click', 'golden', 'upgrade', 'start', 'master']),
    eq2Taste: { fav: new Set(['stayMul', 'holdBonus', 'cpsMul']), bAversion: 8, cFreqMul: 0.8 }
  },
  {
    id: 'S17', name: '報酬蒐集型',
    // 報酬レベルと戦利品の実入りを追う堅実ハンター: 報酬Lvと討伐報酬、運任せのおまけドロップを好む。
    tapRate: 5, goldenTake: 1,
    pickPolicy: sim => 'hunt',
    buy: standardBuy(0.30, 0.30),
    pickReward: pickRewardAffinityAware(['huntingCore', 'monsterDamage', 'beastHeatFerment', 'monsterRate', 'goldenAmount']),
    shouldPrestige: prestigeWhen(1200, 1.1),
    skillOrder: skillOrderByBranch(['core', 'monster', 'reward', 'economy', 'auto', 'research', 'click', 'golden', 'upgrade', 'start', 'master']),
    eq2Taste: { fav: new Set(['rewardLvAdd', 'killValMul', 'dropLuck', 'goldenAmtMul']), bAversion: 5, cFreqMul: 1.2 }
  }
];

module.exports = { STRATEGIES, cheapestNextSkillCost };
