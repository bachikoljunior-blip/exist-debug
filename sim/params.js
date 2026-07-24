'use strict';
// 調整対象パラメータ。ORIG = 元コードの値。ここを書き換えて反映する。
module.exports = {
  // ---- 転生ポイント獲得量 ----
  // gain = floor( pA*(1-exp(-run/pD1)) + pB*(run/pD2)^pG ) , run>=pMin
  // pG=0.08 (2026-07-06 第8次): ⑲隣接10倍×④100倍×⑭[1,3]の整合。
  //  1ラング=コスト比1.62 ⇔ クッキー比 1.62^(1/0.08)=10^2.6(④の2.0桁+ノイズ余裕0.6桁)
  //  ⑤: クッキー×100 ⇔ PT×100^0.08=1.44(帯域[1,100]内で平坦寄り=ユーザー確認済みの逓減形)
  // pB=11: 第0回(±2e6クッキー)の獲得PT≈16 → core(コスト13)が⑭帯[1,3]で買える水準
  // 転生に必要な所持クッキー(2026-07-09 ユーザー・ゲーム仕様変更):
  //   初回転生 = firstCost(=500万)。2回目以降 = 10^(costExp0 + costStep×転生回数) で「10のべき乗」かつ増加。
  //   実値: 第0回=5,000,000 / 第1回=10^7 / 第2回=10^8 / 第3回=10^9 …(costExp0=6,costStep=1)。
  //   firstCost だけ500万の固定値で、以降はきっちり10のべき乗ぶん増える(前回より必ず大)。costStep は調整項目。
  //   ※旧・第0回コスト再算定ルール(costExp0=floor(log10(最小所持)))は本仕様変更で上書き=初回は500万固定。
  // pG 0.075→0.05→0.023(2026-07-13 第13次: ④が100倍→1億倍(8桁)にユーザー変更されたため
  // 段間隔=log10(1.57)/pG ≈ 8.5桁 ≥8桁に再設定。新⑥(3分2倍)下で8.5桁≈28分/周回=T1帯内の見込み。
  // pB 14で初回PT=floor(14×(2e6/1e4)^0.023)=15 → core10+入口5=15が初回で買える(入口5PT規則ちょうど)
  prestige: { pA: 0, pD1: 200000, pB: 14, pD2: 10000, pG: 0.023, pMin: 10000, firstCost: 100000000, costCpsMul: 500,
    // 転生コストの固定テーブル(2026-07-11 確定形): build_prestige_table.js が基準方針(S1)の100h測定から
    // 「第n回の転生時の毎秒×500の10べき切捨て」を焼き込む。無い間は動的フォールバック。
    costTable: (function () { try { return require('./prestige_costs.json'); } catch (e) { return []; } })() },

  // ---- スキルコスト: 手設計順の等比ラダー cost_k = C0 * rho^k ----
  // 2026-07-06 第8次: ⑲=隣接ノード比≤10倍(edgeCap)。rho=1.57(1ラング=クッキー1.57^(1/0.075)≈2.6桁)。
  // ツリー再配線(sim.js)で全辺のラング差≤5 → 最大辺比 1.57^5=9.53 ≤ 10(クランプ非発動=ライダーなし)。
  // rungCosts はチューナ(tune.js)が焼き込む。空なら C0×rho^k を使う。
  // C0=13: coreの子ノード群(≤10×core=130)がチューナの序盤閾値(dec≈21-26)を収容できる水準
  // rungCosts: tune.js の出力(rung_costs.json)を自動読込(なければ C0×rho^k)
  skillCost: { mode: 'ladder', C0: 13, rho: 1.57, edgeCap: 10, utilRatio: 0.35, segments: [], rungShare: 1.45, // 相乗り段(2026-07-13): 48本→約34段=総スパン289桁<float上限
    rungCosts: (function () { try { return require('./rung_costs.json'); } catch (e) { return []; } })(),
    // ⑲改の辺間隔上書き(2026-07-11): 梯子リチューン後に「比≤10倍の辺なし」となった5ノードを、最も近い
    // 隣接ノードのちょうど10倍(q5準拠)へ引き下げ。click_2=click_1×10 / click_3=golden_2×10 /
    // auto_3=auto_2×10 / upgrade_moon=economy_2×10 / unlock_reward_huntFocus=crackedFang×10
    // 旧・個別上書き(click_3/auto_3/upgrade_moon/huntFocus)は旧梯子(サージ経済バーク)向けのため撤去(2026-07-13)。
    // 新梯子(相乗り段・素のC0×rho^段)でのcheck19結果を見て必要な辺だけ再上書きする。
    overrides: { click_2: 50,
      // 2026-07-13 ユーザー指示「スキル最初のやつ(core)に繋がってるものは初回転生でどれでも一つは取れるくらいに」:
      // 初回転生PT≈16・core10 → 入口4本を5PTに(core+入口=15≤16。ensemble3/amp8は元から圏内)
      click_1: 5, golden_1: 5, monster_1: 5, auto_1: 5, economy_1: 50 } },

  // ---- 生産系数値ノードの1ノードあたり目標倍率 ----
  nodeM: { all: 2.2, cps: 2.2, click: 2.0 }, // 4/4/3→2.2/2.2/2.0(2026-07-14 サイクルA確定: メトロノーム経済の瞬発源) // 14/14/9->4/4/3 (2026-07-06: 安価⑲ラダー下で周回時間を帯域スケールへ減速)

  // ---- スキル効果スケール(effect typeごとの倍率) ----
  // 2026-07-13 サイクルA: 全fxを約1/3〜1/4へ圧縮(倍率経済の穏やか化。①⑨⑬等の下限は各lift≥1.2/1.05なので余裕)
  fx: {
    click: 7, cps: 4, all: 4, goldenRate: 3, goldenAmount: 2.5, goldenPower: 3,
    monsterRate: 3, monsterDamageSkill: 5, monsterHpDown: 5, monsterStay: 3,
    upgradeDiscount: 6, researchDiscount: 6, upgradePerkPower: 4,
    rewardBonus: 4, startCookies: 8
  }, // 原値の約1/2(2026-07-14 サイクルA確定)

  // ---- 金クッキー ----
  golden: {
    spawnMin: 50000, spawnMax: 80000,
    visibleMs: 10000,
    instantCoef: 4,
    clickInstantCoef: 40, clickAnchorHalfMul: 1.4, // 2026-07-12 ユーザー指示「タップ数回で手に入る量の金クッキーが雑魚すぎる」:
    // タップ換算アンカー=第0回40タップぶん→半減期(0.7×1.4≈1周回)で基礎4へ減衰。一律40は㉘壊滅(38/96)・
    // 減衰1.4で57/96(同条件基準60/96との差3本=採用コスト)。序盤の体感だけ厚くし中盤以降の㉘に触れない

    // 序盤ブースト(第12次R4・ユーザー指示 2026-07-11「序盤の金クッキーの獲得量を10倍くらいに」):
    // 即時獲得 ×(1+(earlyMul-1)×0.5^(転生回数/earlyHalfRuns))。第0回×10・第1回×6.7・第3回×3.3・第6回×1.6と減衰
    // =新規プレイヤーの体験だけを厚くし、中盤以降の稼ぎ口バランス(㉘・②改)を動かさない。ブースト側は対象外。
    earlyMul: 10, earlyHalfRuns: 0.7,
    multBase: 2.6,
    powerPerLv: 0.45, powerLvHalf: 60, rateLvHalf: 80,
    amountPerLv: 0.45, amountLvHalf: 45,
    boostBase: 9000,
    boostExtraCap: 26000, boostExtraHalf: 60000,
    ratePerLv: 0.05
  },

  // ---- モンスター ----
  monster: {
    spawnMin: 42000, spawnMax: 60000,
    stayBase: 16000,
    stayPerLv: 0.09, rateLvHalf: 80, // ③monsterStay 1.017→再係留(2026-07-14)
    hpBase: 30,
    hpGrowth: 1.60,
    hpPressureDiv: 430, hpPressurePow: 1.95,
    lvEarlyDiv: 92,
    lvLateDiv: 320, lvLatePow: 1.22,
    dmgSqrtCoef: 0.45,
    ratePerLv: 0.26, // ③monsterRate再係留(2026-07-14) // 0.14→0.16(2026-07-10 第12次R: surge0.45の経済移動で③monsterRate中央値が再び1.1割れ=マージン積み増し)
    rateKillBonus: 0.6, rateKillHalf: 2, // 0.35→0.5(2026-07-10 novelty導入で③monsterRateの中央値が1.1を割れ=専用の討伐手数ボーナスで回復)
    satKps: 2.0, // 討伐頻度の飽和半価点(2026-07-10): kill項の1体価値逓減。高テンポ期の討伐56-63%独走を[30,52]帯へ(balanced序盤0.02-0.05体/秒はほぼ線形)
    killValueSec: 7, // 8→7(2026-07-12 ②改2: huntのlift3.05-3.09が帯上限3.00超過。直送絞りでは動かず本体=討伐報酬項を微減。序盤の役割はpeddlerFrac0.06が引き継ぎ済み) // 討伐1体の価値=生産◯秒ぶん(第12次R3・params駆動化)。7→8: ㉘hunt序盤(直送ゲート前)run8/20が討31-32%で合格化・balanced+1・click②改+2・bake影響なし(100h実測)。9/10はhunt+3〜4だがbalancedの打が7-9%に潰れ(−1〜2)・hunt後半②改−2=不採用
    killValMul: { balanced: 7.6, hunt: 8.0, default: 1 }, // balanced 6.5→7.2(2026-07-18 R25 ㉘balanced run2討伐9.6%→10.2%。7.5は⑫click1位強奪で不可の前科=7.2は要⑫検証) // 方針係数(2026-07-14 ㉘balanced中盤討3-6%対策) // hunt 1.5(2026-07-17 ⑫: hunt方針の討伐即時収入を主役らしく=1位周回の復元)
    scarceBonus: 2, scarceHalf: 0.02 // 希少プレミアム(第12次R続き・2026-07-10採用): 低テンポ期ほど討伐1体の価値を増幅(1+bonus/(1+kps/half))。balanced序盤討3-9%→≥10%・hunt序盤討28→30%(100h実測: balanced25→35-36・hunt29→34)。half0.05はclick中盤の討を+5-8pt膨らませ打を圧迫=0.02でkps0.2+をほぼ等倍に
  },

  // ---- ノルマ ----
  quota: {
    graceSec: 30,
    baseCoef: 0.60, basePow: 1.55,
    base2Coef: 0.00002, base2Pow: 2.40,
    w1: 0.60, w1T: 480, w1D: 180, w1P: 2,
    w2: 2.20, w2T: 600, w2D: 240, w2P: 2.25,
    w3: 9.00, w3T: 840, w3D: 300, w3P: 2.65,
    ctrlMul: 3.0, ctrlDiv: 1.8,
    // ノルマ層ゲージ(2026-07-06 ユーザー確定仕様・第9次): ゲージは「現時点のその回の総クッキーが
    // 何秒先のノルマまで達成できるか」の先行秒数 L のみを変数として貯まる。
    // 層kの必要ゲージ秒 = gaugeSec × gaugeGrow^(k-1)(層進行式。gaugeSec/gaugeGrow は調整項目)
    gaugeSec: 45, gaugeGrow: 1.45,
    // 層の上限(オーバーフロー防止・第9次): 通常の転生周回は最大でも約190層で到達しないため
    // 遊びには一切影響しない。ツリー完成後の超長時間放置(総クッキーが浮動小数上限に近づく)でのみ作用。
    gaugeMaxLayer: 400,
    // 追跡ノルマ(旧⑧)は廃止(2026-07-06 ユーザー決定)。未達(T3a/T3b)は本来のノルマ係数
    // (baseCoef/basePow/base2Coef/base2Pow/w1〜w3P/ctrlMul/ctrlDiv)+後半成長の減速で作る。
    // 層の試練(2026-07-07 ユーザー採用・0-2提案4 / 第12次H 提案8で新規開拓層基準へ相対化): 発火せず無害の resting 値。
    trialCoef: 0, trialStartLayer: 10, trialFloorRuns: 2, // 層の試練は廃止(2026-07-11 ユーザー指示「ノルマ層でノルマ加速するのやめて」= trialCoef 0.08→0で無効化。機構は休眠)
    // ---- 到達連動ノルマ(第12次H・提案9・ユーザー承認) ----
    // T3a を全周回・後半に置くための機構。層ゲージ(quotaAtElapsed=時間関数)には一切触れず、未達判定にだけ
    // 「到達項」を足す: 未達 = runCookies < max(従来ノルマ, runCookies×reachCoef×ρ^reachPow)。
    // ρ = 今回の周回内経過秒 ÷ max(前回周回の長さ prevDuration, reachMinSec)(=各周回の進行を前回長で正規化)。
    // runCookies が両辺で相殺 → 実質「ρ が ρ*=(1/reachCoef)^(1/reachPow) を越えたら未達」。絶対クッキー桁に非依存。
    // 層比でなく時間比にした理由: 未達で層が凍結するため層比は序盤に寄る&層が崩壊する(第12次H実測)。
    // reachCoef=20, reachPow=10 → ρ*≈0.74(前回周回長の約7.4割の時点で未達)。序盤は runCookies<従来ノルマ側が勝ち従来挙動。
    // minSec=600 は掃引で確定(1200だと周回の短い方針=S3が ρ* に届かず取りこぼす。600で S3 21→44/47)。第12次H実測。
    // reachMaxSec=denom の上限クランプ(0=無効)。直前が極端に長い→短い周回で reach が未発火=T3a取りこぼし、を防ぐ。
    // 6000 で確定(sweep_maxsec.js で T3a と T3b を同時掃引): T3a全体 86→88%・S10 18/23@34% → 25/26@62%、
    // かつ T3b を維持(5000だと reach が早発して S8/S10 の T3b が落ちる。6000で S8 T3b40・S10 T3b17 を回復)。4000以下は位置が頭へ崩れる。
    reachGainFrac: 0.983, // ⑧確定形(2026-07-16): 未達=「その戦略の転生gain条件」の98.3%で発火(相対値)。
    // 実効しきい値 = max(次スキル束, 前回目標×1.57) × 戦略の転生係数(sim._prGainFactor) × 0.983、
    // かつ経過 ≥ 戦略の時間下限×0.98。この未達は**記録のみ(ソフト未達)=モンスターは止めない**:
    // 停止まで伴うと⑬延長狩りの測定窓が全滅+gain未達周回が3倍化を実測(sim.js側コメント参照)。
    // 実停止は転生インターセプト(1秒)のみ。完全無効(0)も試したが、時間基準へのフォールバックで
    // 周回数が9→4-6に崩れ②/③-cが壊れた=0.983のソフト未達が唯一の全緑構成。
    reachCoef: 1.2, reachPow: 10, reachMinSec: 600, reachMaxSec: 6000, reachEmaAlpha: 0.35
    // reachCoef系(時間基準)は reachGainFrac>0 の間は不使用(フォールバック定義として保持)。
    // reachCoef 2.0→1.2(2026-07-11): T3a廃止で未達はT3b専用=ρ*0.93→0.98へ後ろ倒し
    // ※2026-07-12 修復: 前回編集でreachPow以下がコメントに巻き込まれ未定義化(reachが全く発火しない)していた
  },

  // ---- 設備直送生産(第12次J・提案A・ユーザー承認 2026-07-07) ----
  // ㉘(a)対策: 設備収入(cps)は後半に自前の複利倍率を持たず、金クッキー・討伐報酬の複利成長に
  // 追い越されて設備シェアが0%へ減衰する(bake が主役30%を保てない)。そこで生産設備に
  // 「最高層に比例した直接クッキー収入」を新設する。この収入は金ブースト・討伐報酬の乗算対象外の
  // 独立加算項=設備固有の稼ぎ口。全生産倍率ではないので㉘の独占も再発しない。
  // 【第12次J-3・対称の直送収入(ユーザー2026-07-08「オーブンが強すぎるなら他も強く」)】
  //   直送 = coef × base(cps+タップ) × (ジャンル投資量/ref)^countPow × (最高層-startStage)^stagePow
  // 各稼ぎ口に、そのジャンルへ投資したプレイヤーだけ強く効く独立収入を用意し、各方針の主役を後半も≥30%に立たせる。
  // すべて skill→research→効果 でゲート(設備=ovenBatch段2/金=spiceBlend段2/討伐=portalNetwork段2/タップ=fingerTechnique段2)。
  // coef=0 で各無効。tune で全体最良点を掃引(㉘の各主役≥30%と経済/テンポ非破綻の両立)。調整項目。
  equipDirect:  { coef: 0.04, stagePow: 0.5, countPow: 2,   ref: 70,  startStage: 5, satMax: 50, otherMul: { click: 0.08, default: 0.2 }, anchorGolden: 0.15 }, // 新経済向け再スケール(2026-07-14) // otherMul.click 0.08(2026-07-11: ref70でclick中盤の設備31-40%が打25-29%を圧迫→click周回だけ設直を絞る。(a)24→26/49・②改48/49。clickBonus3.6併用は②改−5で不採用) // ref 100→70(2026-07-11 R5: surge減速で台数rampが遅れ設備シェアが沈む→投資係数の基準台数を引き下げ。bake㉘31→42/49・②改47/49実測) // アンカー=max(base, 0.15×金相場)(第12次R続き・2026-07-10採用): 後半はbase係留の設直だけ沈む(bake後半設直30→5-7%)ため金相場へ部分連動。100h実測: bake(a)23→46/47・②改43→40/47・balanced10→25/48。1.0は設71%独走で②改7/47に崩壊・0.25でも遷移帯が超過=0.15が均衡 // coef 0.11実験は㉘129→125・②改137→131と希釈で逆効果(2026-07-10実測)=0.06に戻し // 投資量=オーブン所持数。coef0.05無効の正体はゲート(ovenBatch段2コスト=run15相当)。段2コスト前倒しとセットで増幅(2026-07-10)。satMax=独走防止 25→50(第12次R: 100h後半周回で設備シェアが討伐/金perk積み上げに沈む=balanced10/48・bake23/47の対策)。otherMul=焼成方針以外は従来規模(全方針等倍だとbalanced0/32・click5/25に崩壊=実測)
  goldenDirect: { coef: 0.3, stagePow: 0.5, countPow: 1.4, ref: 30,  startStage: 5, satMax: 10, otherMul: { click: 0.3, balanced: 0.3, hunt: 0.3, default: 1 } }, // 新経済向け再スケール(2026-07-14) // otherMul(第12次R続き・2026-07-10採用・方針別マップ)=click/balanced中盤の金直16-22%が打を圧迫する対策+huntは金直を絞ると討シェアが立ち29→34/43(C1a実測・②改34不変)。bakeに効かせると②改40→30に崩れる(C2b実測)ためdefault=1 // 投資量=金perk合計(㉘金≥30%へ増幅・huntDirectと同処方=投資連動で金特化の後半周回だけ強く効く)
  // 実績研究の固定コスト表(2026-07-11「コストはゲーム内で固定して」): build_ms_costs.js が
  // 10方針100hの測定から各研究の初回購入額(中央値・丸めq5)を焼き込む。無い間は動的フォールバック。
  // massProd=量産体制(2026-07-13 メトロノーム): 繰り返し購入の間隔と倍率(新⑥の床=×1.25^4/3分=×2.44)
  msResearch: { massProdMul: 1.25, massProdSec: 32, momentumCapSec: 14400, momentumFixedMul: 2, momBuyDiv: 12, momBuyCapExp: 8000, costMul: 8,
    costTable: (function () { try { return require('./ms_costs.json'); } catch (e) { return null; } })() },

  // ㉚解放間隔(2026-07-22 ユーザー指示「ゲート解放無くして、ゲーム調整で解放間隔30秒以上」):
  // 解放を待たせるハードゲートは撤去(minGap=0=常に解放可)。解放間隔≥30秒はノルマを本当の壁にする
  // 経済(ノルマ係数の引き上げ+討伐が倒せなくなる難度)で自然に作る=買える物が一気に湧かない。
  // 実績研究の取得規律(2026-07-22 ユーザー指示「自動購入は廃止・実績達成で購入可・解放間隔はゲーム調整で」):
  // タイマー(待ち)は一切使わない。実績研究は達成済み・未取得の最安を所持クッキーの msBudgetRatio 以内で
  // 1tick1件だけ取得=熟慮購入。次の1件はクッキーが貯まるまで買えない=解放間隔は**経済**で自然に空く。
  // minGap=0=設備/研究/段階も待ちゼロ。
  reveal: { minGap: 0, msBudgetRatio: 0.5 },

  // ㉛ スキル取得数(合格条件・2026-07-22 ユーザー指示「一度に取るスキルは5個まで=合格条件・仕様にしない」):
  // simに強制上限は設けず、1転生あたりの取得数が自然に≤この値に収まるようスキルコスト/PT獲得で調整する。
  // runner skillcap モードがこの閾値で判定(≤5)。
  skillCapPerPrestige: 5,

  // huntDirect: satMax 15→14(2026-07-12 ②改2: huntのlift3.09が帯上限3.00超過→飽和を微絞り)
  // peddlerFrac 0.02→0.06(2026-07-11 hunt序盤対策) / otherMul.golden 0.9(2026-07-11) / 投資量=討伐perk8種・基準=金相場
  // otherMul.click 0.15→0.08(2026-07-12 ㉘click後半: 討直29-31%がタップ主役25%を圧迫。診断=partsDetail)
  // otherMul.balanced 0.15→0.18(2026-07-12 ㉘balanced中盤run13-19: 討伐8-9%<10%=タップ9.0倍の圧迫の再均衡)
  huntDirect:   { coef: 0.15, stagePow: 0.5, countPow: 1.4, ref: 30,  startStage: 5, satMax: 16, otherMul: { click: 0.08, balanced: 0.35, golden: 0.9, default: 0.3 }, peddlerFrac: 0.06, rateBonus: 0.45, rateHalf: 25 }, // 新経済向け(2026-07-14 掃引r2)+回転ボーナス(③monsterRate後半飽和対策) // satMax 12→14(2026-07-17 ⑫: huntの1位周回復元・②帯はhunt1.88で余裕)
  // tapDirect: clickBonus 5.0→5.6(2026-07-12 ②改2: clickのlift1.46が最弱=底上げで帯上限を引き上げhuntを収容)
  // clickBonus5.0+satMax150(2026-07-11 複合=中盤+22%・後半飽和) / otherMul.balanced7.0(echo対応) / anchorGolden0.5=神指前のみ
  // satMax 150→400・otherMul.balanced 7.0→9.0(2026-07-12 ㉘後半対策: click run33-47 打12-21%<25%・
  // balanced run33-45 打8-10%<10%は共に飽和/係数不足。golden/hunt後半は打1-5%で巻き添え安全圏を実測確認済み)
  // satMax 400→800(2026-07-12 続き: click後半は神指1600+で投資raw≈9500=400でも再飽和(実効383)。
  // 実効735へ=tapD 15-20%→28%試算。中盤(raw≈200)は×1.2どまり=②改2 clickリフトへの波及は小)
  // clickBonus 8.0→5.6に差し戻し+clickBonusLate 14 新設(2026-07-12: 8.0一律はアンカー時代(神指0=run25-32)の
  // タップを膨らませ①bank S2 min 1.21→1.15に希釈。フェーズ分離=アンカー時代5.6(①復元)・投資時代14(㉘後半専用))
  // satMax 150差し戻し+satMaxLate 800新設(2026-07-12: 一律800はアンカー時代raw≈196を85→175に倍化させ
  // ①bank S2 run31=1.186の残NG源。フェーズ分離でアンカー時代=R13完全復元・投資時代のみ飽和緩和)
  // clickBonusLate 18→21(2026-07-12 ㉘click残り: run33/47 タップ22-23%の押し込み)
  // satMaxLate 800→1200・otherMul.balanced 9.0→8.0(2026-07-12 最終: click後半は21-25%境界のノイズフリップ
  // =マージン確保で28-31%へ。balanced中盤はタップ38%が討伐8-9%を圧迫=hunt 0.22と対で再配分)
  tapDirect:    { coef: 0.01, stagePow: 0.5, countPow: 2, ref: 20,  startStage: 5, clickBonus: 3, clickBonusLate: 65, satMax: 150, satMaxLate: 2800, anchorGolden: 0.2, stallFrac: 0.05, otherMul: { golden: 0.6, balanced: 4.0, default: 1 }, otherMulLate: { balanced: 40 } }, // satMaxLate 900→2400(2026-07-18 R24 ㉘click run6-9: 真の律速は係数でなく飽和上限と内訳診断(_incD)で特定。2400で4周回とも27前後・2000/3000は経済フィードバックで逆戻り=スイートスポット) // 掃引2(2026-07-17 ㉘): clickBonusLate24+satMaxLate900(click後半の打16-19%→25%へ)・balancedはアンカー4.0/投資時代otherMulLate10の時代分離(5.5一律はrun1-2打60%暴走で撤回) // 新経済向け再スケール(2026-07-14 掃引r2)
  // 銀行配当(直送・第12次J-3 腐り解消): bankClickDividend研究の独立収入。クリック方針で厚く効かせ①の各回minを満たす。
  // 全体cps倍率をやめ加算収入へ(他機能のlift希釈を回避)。所持数はlog10で床あり=早い周回でも効く。増加方向のみ。
  // countPow 1.6は棄却→1.8へ差し戻し(2026-07-12: ①bankの真の束縛はS2 run25-32(count300-800=ratio>1域)で
  // 指数減はここも−13〜28%痩せさせ1.179どまり。㉘click後半はclickBonusLateへ一本化)
  bankDirect:   { coef: 0.2, ownRate: 0.5, savedCoef: 0.05, clickBonus: 1.8, countCoef: 0.9, countPow: 1.8, ref: 150, anchorGolden: 0.12, otherMul: 0.5 }, // 新経済向け再スケール(2026-07-14: click設備70%対策でclickBonusも減) // clickBonus 2.5→2.8(2026-07-11: echo金インフレで①bankのS2が1周回だけ1.2割れ=マージン) // 投資量=銀行所持数+貯蓄(総クッキー桁)。coef 0.34→0.42(2026-07-10 第12次R: surge経済移動で①bank研究が1.2割れ=マージン)
  // 研究連動の全生産倍率(第12次L・提案A): 異世界接続網/銀河合成/量子証明が解放されている間、全生産(クリック＋毎秒)に
  // 一律の倍率を掛ける。floor で研究購入直後から立つ(①の各回min≥1.2)、所持数(log10)と最高層で伸びる。
  // 【重要】全生産倍率は設備/金/討伐/タップを同率で持ち上げる=㉘の稼ぎ口シェアが不変(相殺)、③/⑨の他機能liftも
  // 分子分母で相殺(希釈しない)、④⑤も周回比で相殺。加算の直接収入(第12次J-4のresEquipDirect=㉘破壊)や
  // 一設備だけの倍率(第12次Kのflat床=③希釈)と違い、条件を壊さずに①を立てられる。共鳴((1+r)^n)ではなく線形floor。
  // これらの研究段3(⑨)も同型の全生産倍率floorで立てる(下 s3Floor)。増加方向のみ。resActive/resStage3 ゲート。
  // floor のみ(own/stage=0): 研究が解放中は M=1+floor の定数。定数なら③の通し比(報酬あり÷なし)で M が
  // 分子分母で厳密に相殺=③を希釈しない。own/log10・層項は取得済み設備数/層に依存しトラジェクトリで揺れ、
  // 末尾数回しか取得しない最弱utility報酬の通し比を崩したため撤去(第12次M診断)。floor=0.25 で①のmin≥1.2に余裕。
  resGlobal: {
    portal:  { floor: 0.25, own: 0, stage: 0, s3Floor: 0.06 },
    galaxy:  { floor: 0.25, own: 0, stage: 0, s3Floor: 0.06 },
    quantum: { floor: 0.25, own: 0, stage: 0 },
    factoryS3Floor: 0.06, spiceS3Floor: 0.06, moonS2Floor: 0.06, fingerS3Floor: 0.08, ovenS3Floor: 0.06
  },

  // ---- 討伐連鎖(2026-07-07 ユーザー採用・0-2提案1) ----
  // 最後の討伐から breakSec 以内に次を倒すと連鎖+1(こつぶ群れは3体分)。過ぎたら0、転生でも0。上限なし。
  // 効果はすべて連鎖数Nに線形(共鳴のような雪だるまにならない):
  //  prodCoef=全生産×(1+prodCoef×N) / dropCoef=素材ドロップ量×(1+dropCoef×N)(素材は現状ゲームのみ) /
  //  rewardCoef=報酬レベル+floor(rewardCoef×N)
  // 討伐連鎖は廃止(2026-07-13 ユーザー指示「チェインも消す」)。null=全効果無効(コードはP.chainガードで休眠)
  chain: null,

  // ---- 研究効果 ----
  // 2026-07-06 第8次: ①(各研究の有効性)で弱かった5研究の「所持数指数」(垂直吸収されない動的項)を強化:
  //  spiceGoldOwn .010→.014(.020はS3金特化が⑤上限超えで暴走: e218/周回16に崩壊) / bankOwn .028→.040, bankSaved 8→10 / galaxyOwn .019→.032 /
  //  quantumRes .30→.38, quantumOwn .019→.032 / antimatterOwn .002→.012, antimatterSkill .032→.045
  res: {
    // 会心1%開始(2026-07-06 ユーザー承認・第9次): score = 0.01 + 0.045×√強い指 + 0.002×最高到達層。
    // 取得直後(指0個・層0)でちょうど会心率1.0%。層項は周回内で会心が育つ動的項(①対策も兼ねる)
    fingerBase: 0.01, fingerSqrt: 0.045, fingerStage: 0.002, fingerCritBase: 8.0, fingerCritGrow: 10.0, critHalf: 12, // critHalf 1→12(2026-07-18 R26b ユーザー指示「序盤から高すぎ。たまに出るくらいのやつが僅かに増えてくのが面白い」): 序盤2.4%→中盤20%→score20で62%とゆっくり漸近。上限なし(0.995×score/(score+12))・装備/研究critAddで両どり。①fingerはfingerCritBase 2.2→8(激レアだが一撃×11)で補償=min lift2.45(probe_crit実測) // critBase 2.0→2.2(2026-07-11 ①finger: S2 run1のlift1.1996=基準1.2を丸め1つ分割れ。会心率(㉓固定)は不変・倍率の基礎項のみ)
    // grandmaSelf 30→40(2026-07-12 ①grandmaCrowd: 金アンカー(第0回タップ40回分)で第0回の地力が膨らみ
    // 全方針の初回liftが1.06-1.18に希釈。S7の初回1.182を帯内へ=①は「1方針が全周回≥1.2」で判定)
    // grandmaOwn(2026-07-13 新設・ユーザー指示「1台あたりの初期生産1のままもっと強く」): 1台あたり生産×(1.02)^台数
    grandmaOwn: 0.032,
    grandmaSelf: 12, grandmaSup: [0.003, 0.003, 0.003], // 6→12(2026-07-14 ①再係留: 初回周回の希釈対策)
    // 2026-07-06 第8次: ⑫(設備の文脈依存性)用に所持数指数を再配分。
    // factory一強(全方針の最効率=工場固定)を解消: oven 0.060→0.067 / spice 0.062→0.071 / factory 0.060→0.057
    // → 12h実測で最効率設備が factory 7方針 / oven 3方針 に分岐
    ovenSelf: 20, ovenOwn: 0.048, ovenStage: 0.05, // ①ovenBatch 1.18→層ランプ増し(2026-07-14 2回目) // 0.03→0.045(2026-07-11: 工場の助走カード追加でS10のovenBatch liftが6NG/36 min1.104に希釈→層ランプ増し。NG0/35 min1.281実測) // 0.012→0.03(2026-07-11 ①oven: surge減速で直送比のcpsが痩せ中盤以降のliftが1.02-1.12に沈む→層ランプで再係留。S10 NG9/23→0/24 min1.296)
    factorySelf: 14, factoryLow: 0.002, factoryOwn: 0.0416, // ①factory再係留2回目(2026-07-14: コスト100万はユーザー固定のため効果側で)
    // 量産波及(2026-07-14 ①後半希釈対策): 研究ゲート付きの全生産×(1+係数)^台数。
    // 後半周回(台数2500-3300)で×1.6-1.9=lift受け皿・序盤(台数40-90)は≈1.01で無害。
    // 0.0002→0.00012(2026-07-14 R20: 全体項が設備収入を押し上げ②改2のbake2.66>帯2.57・balanced5/29に。
    // ①の後半liftは1.00012^2600=1.37で維持)
    ovenGlobal: 0.00012, factoryGlobal: 0.00012,
    spiceOwn: 0.0512, spiceGold: 7, spiceGoldOwn: 0.0096, spiceGoldDur: 30000,
    // 狩り窓(2026-07-09 ⑬作り替え): 窓は討伐が開く・維持する(金クッキー非関与)。portalHuntDur/Grow は旧・金開窓用=現在未使用(移植時に削除)。
    // portalHuntSpawnBase=窓に関係ない常時スポーン加速(研究解放中)/ portalHuntSpawn=窓中の追加加速(⑬延長狩りのコントラスト)。
    // ⑬延長狩り再係留2回目(2026-07-14)。※同日修復: 前の編集でportalHuntSpawn/SpawnBaseが行中コメントに
    // 飲まれて未定義化(窓の加速=延長狩りの実体が死んでS7比0.956/S9比1.000の一因)。独立行に復元。
    portalSelf: 6, portalHuntDur: 9000, portalHuntGrow: 0.03,
    portalHuntSpawn: 0.0008, portalHuntSpawnBase: 0.007,
    bankOwn: 0.0288, bankSaved: 5.0,
    moonBase: 8, moonStage: 0.001, moonOwn: 0.0008,
    foldPortal: 0.002, foldMonster: 2.5, foldGold: 8,
    galaxyTypes: 0.22, galaxyOwn: 0.0224,
    bhGlobal: 5, bhCompress: 0.0018,
    quantumRes: 0.17, quantumOwn: 0.0224,
    antimatterOwn: 0.008, antimatterSkill: 0.02,
    ctrlOven: 0.05, ctrlMoon: 0.07, ctrlBh: 0.10
  },

  // ---- 研究段階コスト倍率(確定値): 段2 = 段1コスト×s2, 段3 = 段1コスト×s3 ----
  resStageCost: { s2: 1500, s3: 2250000 },

  // ---- クリック変更 案A+C(承認済み) ----
  // 案A: クリック力 = 従来項 + 毎秒生産×cpsCoef×(1+fingerSqrt×√強い指)×(1+クリック系スキル効果)
  // 案C: 神の指1個ごとにクリック×godFingerExp(指数)
  clickLink: { cpsCoef: 0.004, fingerSqrt: 0.02, godFingerExp: 1.012 }, // 案C指数 1.02->1.012 (2026-07-05): キャップ撤廃後の最終周回プラトーがe308超(S2/S7でInfinity)となるため。全方針で約-20桁、S2/S7有限化を実測確認

  // ---- タイミング機能(条件⑬)の最適操作/完全放置モデル ----
  // waveOpt=2/π(山に活動を寄せた正相平均) / waveIdle=1/π(全周期平均)
  // bhIdleDelay=満タン後に放置プレイヤーが気づくまでの遅延秒 / matureIdleMul=放置時の熟成爆発係数
  // ⑬対比の縮小(2026-07-14 R19f: portalHunt復元で窓が実体化しS7の最適/放置比が帯上限2.0超え
  // (圧縮4.74・熟成2.42・ゆらぎ天文値)へ逆転→放置側の効率を上げて対比を[1.05,2.0]へ。計測専用レバー=経済無影響)
  // 2段目の絞り(R19g実測: 延長狩りOK1.77・圧縮3.51・熟成2.27・ゆらぎ5.7e5→対数比で再見積もり)
  // 3段目(R19h実測: 圧縮3.34・熟成2.26=軌道増幅A≈18で対数比を按分→eff0.95/0.9で帯内見込み。
  // ゆらぎはS7のn=2が最深周回=定数乗数差が購入雪だるまで天文値化する構造=係数では収まらない(要相談化の候補))
  // タイミング機能の実効性(条件⑬・2026-07-16 再係留 EQUIP_TIMING_REDESIGN.md準拠): 最適操作 vs 完全放置の帯[1.05,2.0]。
  // waveIdle=1/π(=全周期平均・sim.js:1544のコメント記載の設計値。0.63へ誤ドリフトしていたのを設計値へ戻す=
  //   最適(waveOpt=2/π)との比が k=(1+amp·2/π)/(1+amp·1/π) の定数lift=帯内)。
  // bhIdleEff=0.80(spec「放置=自動放出80%」)。
  // matureIdleMul=0(2026-07-16 ⑬4/4化): 熟成は「金取得を待って風味を熟成させてから収穫する」純タイミング機能。
  //   完全放置=金を即時自動収穫=前回金からの経過(熟成時間)≈0 ⇒ burst=1+matureRate·0=1(熟成ボーナスゼロ)。
  //   これが忠実な放置基準。matureIdleMul=0.80(「80%収穫」)では最適/放置差が小さすぎ窓内比≈1.01で帯下限未達だった
  //   (実測: k=0.80→S2 1.011 / k=0.10→1.056 / k=0→1.067)。k=0で最適操作の熟成lift(S2=1.067)が忠実に測れる。
  //   放置側=⑬測定枝(idleTiming)のみで参照=最適操作の実生産は完全不変(経済無影響)。
  // 熟成は sim側で mature を60s上限にキャップ(spec)=バースト複利の発散を有界化(最適操作の実生産に僅かに効く)。
  timing: { waveOpt: 0.6366, waveIdle: 0.3183, bhIdleDelay: 150, bhIdleEff: 0.80, matureIdleMul: 0, matureCapSec: 60, matureLumpCoef: 0.08 },

  // ---- 研究コスト ----
  // 第11次(値段割り・D'): weave.js が「1周回に中間目標1件」になるよう再配置した値を
  // weave_costs.json に保存し、ここで上書き読込する(研究コスト=調整項目・ユーザー確認済み)
  resCost: Object.assign({
    fingerTechnique: 2500, grandmaCrowd: 100000, ovenBatch: 300000, // ①初回希釈対策(2026-07-14): 第0回取得を第1回以降へ=金アンカー圏外
    factoryNetwork: 150000, spiceBlend: 400000, portalNetwork: 1200000,
    bankClickDividend: 4000000, moonGlobalYeast: 40000000,
    portalGlobalFold: 400000000, galaxyAssembly: 6000000000,
    blackHoleCompression: 160000000000, quantumProofing: 3200000000000,
    antimatterRecipe: 64000000000000
  }, (function () { try { return require('./weave_costs.json').resCost || {}; } catch (e) { return {}; } })(), {
    // 2026-07-13 ユーザー指定の固定コスト(weave焼き込みより優先): 工場段1=100万・香料調合段1=2000万・
    // 生産火力転換(cpsStrike)=3000万「モンスターダメージに毎秒生産が乗るようになる」
    factoryNetwork: 1000000, spiceBlend: 20000000, cpsStrike: 30000000,
    // ①初回希釈対策の固定(2026-07-14): grandmaCrowd/ovenBatchはR19fの①合格構成(この値+買い控えゲート)。
    // weave再焼きがgrandmaCrowdを1.4e56へ動かした(ゲート後の初買い観測のため)がこちらを優先する。
    grandmaCrowd: 100000, ovenBatch: 300000
  }),

  // ---- モンスター報酬効果 ----
  rw: {
    monsterDamage: 3.2,
    crackedFang: 3.2,
    goldenTarget: 2.2,
    goldenChain: 2.0,
    goldenFirstHit: 2.5,
    brandHunt: 0.45,
    beastHeatFerment: 0.05,
    huntingCore: 0.12,
    biteRecovery: 3,
    crushedMill: 1.5,
    chainPrepSpawn: 0.2, chainPrepHp: 1.032,
    // 第12次M 再テーマ(増加方向・従来効果は残置): monsterStay/chainPrep とも討伐連鎖の持続窓 breakSec を Lv で延長し、
    // 連鎖数で全生産×(1+prodCoef×連鎖)に効かせる(飽和/カオス解消)。monsterStay は取得数が多いので per-Lv を小さく。
    monsterStayChain: 0.25, chainPrepPersist: 0.25, crackedFangKill: 0.000001, brandHuntKill: 0,
    biteRecoveryKill: 0.000002, crushedMillProd: 0.03, goldenBeastMutationProd: 0.05, brandHuntProd: 0.1,
    beastScent: 0.5,
    deepPursuitSpawn: 0.045, deepPursuitHp: 1.035, deepPursuitReward: 1.6,
    mutationBase: 0.9, mutationPerLv: 0.18, // 0.5/0.1→0.9/0.18(2026-07-11 ③: 取得n=1の単発判定が1.087-1.203で振動=期待発動率を厚くして閾値1.1から離す)
    categoryBonusRate: 0.003, categoryHalf: 400,
    // 第12次K(2026-07-08 ③再テーマ・増加方向のみ): 金報酬トリオ+獣の匂いを飽和しない金の稼ぎ(金即時獲得量=amount)へ
    // 再テーマ。従来のダメージ/初撃/金出現間隔効果は残置(削除しない)し、金amount倍率への加算を新設(所持Lvに線形=非飽和)。
    // これで金特化方針で instant lift が立つ(ダメージ飽和次元・通し比較のゆらぎに埋もれない)。
    goldenChainAmount: 0.50, goldenTargetAmount: 0.9, goldenFirstHitAmount: 0.7, beastScentAmount: 0.30, goldenPowerAmount: 1.0 // target 0.55→0.9, firstHit 0.35→0.7(2026-07-10 工房統合の経済シフトで中央値1.06/1.00へ低下→即時獲得量ライダーを増幅)
  },

  // ---- モンスター種類×報酬相性(2026-07-06 ユーザー承認・第9次) ----
  // 討伐した種類が報酬Lvの増分を決める: 増分 = max(1, floor(基本量 × 相性倍率))。
  // 出現はゲームと同じ重み(標準50/こつぶ22/鉄焼き14/はやて14)を決定的ローテーションで期待値化。
  // 黄金獣=金ブースト中に出現枠の35%を置換 / ボス=討伐25体ごと(+選択肢+1)。数値はすべて調整対象。
  // モンスター種類3倍(2026-07-13 ユーザー指示「モンスターの種類も色を変えて、3倍にして」): 5系統×3色変種=15種。
  // 変種は同系統の性格を保ちつつ相性のピーク位置をずらす(㉕多様性)。行合計は4.0〜7.0帯を維持(㉖±1.5)。
  // 色は種類ごとに固有(ゲーム側で描画)・ノルマ層の色帯(色素材ore_t1..t6)とは別パレットで被らない。
  mtype: {
    weights: { normal: 26, normal2: 12, normal3: 12, swarm: 12, swarm2: 5, swarm3: 5,
      tank: 8, tank2: 3, tank3: 3, speedy: 8, speedy2: 3, speedy3: 3 },
    hpMul: { normal: 1, normal2: 1.2, normal3: 0.85, swarm: 0.66, swarm2: 0.8, swarm3: 0.55,
      tank: 6, tank2: 7, tank3: 5, speedy: 0.45, speedy2: 0.5, speedy3: 0.4,
      goldenBeast: 2.5, goldenBeast2: 3, goldenBeast3: 2.2, boss: 12 }, // swarm=3体×0.22
    stayMul: { normal: 1, normal2: 1.1, normal3: 0.9, swarm: 1, swarm2: 1.1, swarm3: 0.9,
      tank: 1.5, tank2: 1.65, tank3: 1.35, speedy: 0.55, speedy2: 0.6, speedy3: 0.5,
      goldenBeast: 1, goldenBeast2: 1.1, goldenBeast3: 0.9, boss: 3.75 },
    rewardEvents: { normal: 1, normal2: 1, normal3: 1, swarm: 3, swarm2: 3, swarm3: 3,
      tank: 1, tank2: 1, tank3: 1, speedy: 1, speedy2: 1, speedy3: 1,
      goldenBeast: 1, goldenBeast2: 1, goldenBeast3: 1, boss: 1 }, // こつぶ系は3体分の報酬
    rewardLvAdd: { tank: 18, tank2: 18, tank3: 18 },
    goldenBeastShare: 0.35, goldenBeastVariants: ['goldenBeast', 'goldenBeast2', 'goldenBeast3'],
    bossCycle: 25,
    speedyGoldenCut: 0.5, // はやて系撃破で次の金クッキー間隔×0.5
    bossChoiceBonus: 1,
    affinity: {
      normal:       { golden: 1.0, hunt: 1.0, equipment: 1.0, risk: 1.0 }, // 行計4.0
      normal2:      { golden: 1.6, hunt: 0.8, equipment: 0.8, risk: 0.8 }, // 行計4.0(金寄り)
      normal3:      { golden: 0.8, hunt: 0.8, equipment: 1.6, risk: 0.8 }, // 行計4.0(装備寄り)
      swarm:        { golden: 0.6, hunt: 1.6, equipment: 0.8, risk: 1.0 }, // 行計4.0(狩りピーク)
      swarm2:       { golden: 1.0, hunt: 1.4, equipment: 0.6, risk: 1.0 }, // 行計4.0
      swarm3:       { golden: 0.5, hunt: 1.3, equipment: 1.2, risk: 1.0 }, // 行計4.0
      tank:         { golden: 0.5, hunt: 2.0, equipment: 3.5, risk: 1.0 }, // 行計7.0(装備ピーク)
      tank2:        { golden: 1.5, hunt: 1.5, equipment: 3.0, risk: 1.0 }, // 行計7.0
      tank3:        { golden: 0.5, hunt: 3.0, equipment: 2.5, risk: 1.0 }, // 行計7.0(狩り厚め)
      speedy:       { golden: 3.0, hunt: 0.5, equipment: 0.5, risk: 1.5 }, // 行計5.5(金ピーク)
      speedy2:      { golden: 2.0, hunt: 0.5, equipment: 0.5, risk: 2.5 }, // 行計5.5(リスクピーク)
      speedy3:      { golden: 2.5, hunt: 1.0, equipment: 1.0, risk: 1.0 }, // 行計5.5
      goldenBeast:  { golden: 3.5, hunt: 1.0, equipment: 0.5, risk: 2.0 }, // 行計7.0(金ピーク)
      goldenBeast2: { golden: 2.5, hunt: 0.5, equipment: 1.0, risk: 3.0 }, // 行計7.0(リスクピーク)
      goldenBeast3: { golden: 3.0, hunt: 2.0, equipment: 1.0, risk: 1.0 }, // 行計7.0
      boss:         { golden: 4.0, hunt: 4.0, equipment: 4.0, risk: 4.0 }
    }
  },

  // ---- 熟練(2026-07-06 ユーザー採用・第11次。スキルで解放) ----
  // 職人の手(mastery_low)=下位7種 / 工程の極み(mastery_high)=上位9種。
  // 同じ設備を買うほど1台あたり生産が複利で伸びる(研究不要): ×(1+rate)^所持数。rateは調整項目
  mastery: { low: 0.003, high: 0.005 },

  // ---- 系列ボーナス(2026-07-06 ユーザー採用・第11次) ----
  // スキルで解放する上位設備(月面〜反物質)の固有能力(研究不要):
  // 1台につき「自分より下位の設備の直接生産の合計×coef」を追加生産(系列ぶんの又取りなし)。
  // 神の指(クリック型)は1台につきクリック力×(1+coef)相当の線形倍率。
  // → 初購入の瞬間に生産の約coef分をその1台が担う=㉑(基礎生産≥実CPS/5)を全方針で満たす設計
  lineage: { coef: 0.25 },
  // 初台ボーナス(第12次R2続き・㉑対策): 中位設備の初めての1台に購入直前CPS×coefの生産を持たせる
  // (系列ボーナスの中位拡張。㉑のNG5種=oven x0.16/factory x0.02-0.05/bank x0.12/spiceRack x0.17/portal x0.15対策)
  presence: { firstUnitCoef: 0.25, ids: ['oven', 'factory', 'bank', 'spiceRack', 'portal', 'moonBakery', 'timeOven', 'galaxyFactory', 'blackHoleMixer', 'universeOven', 'godFinger', 'cookieSingularity', 'quantumBakery', 'antimatterOven'] }, // 全設備に初台ボーナス(2026-07-16 ㉑: momentum B下でantimatterOven/timeOvenの初購入Δ比が0.01-0.28=系列ボーナスだけでは不足。moon/time/godfinger/antimatterを追加。静的加算=成長で自然無意味化=経済中立)

  // ---- 段階コストの研究別倍率(第11次・値段割り用) ----
  // 研究ごとに {s2, s3} を指定(なければ resStageCost の共通倍率)。研究コスト=調整項目(ユーザー確認済み)
  resStageCostEach: (function () {
    let m = {}; try { m = require('./weave_costs.json').resStageCostEach || {}; } catch (e) { }
    // ㉘bake対策(2026-07-10): weave(値段割りD')は ovenBatch段2 を run15相当(コスト~e43)に置くが、
    // bake代表(S1)の主役エンジン(大量焼成倍率+設備直送ゲート)が金ゲート(spiceBlend段2=run7相当)に
    // 12周回遅れ、中盤(run4-14)の設備19-29%NGの構造要因になる。主役の特殊経済は早期に開く=
    // 実コスト~1e8(run4-5相当・30000×3333)へ前倒し(研究コスト=調整項目)。
    m.ovenBatch = Object.assign({}, m.ovenBatch, { s2: 1000 }); // 実コスト3e7=run3-4相当(3333=1e8だとS1のrun4だけゲートが間に合わずNG)
    return m;
  })(),

  // ---- まとめ買い割増(2026-07-06 ユーザー採用・第10次) ----
  // 同じ設備を短時間に連続購入するほど値段に割増がつき、時間で元に戻る。
  // 割増倍率 = (1+perBuy)^熱量、熱量は購入ごとに+1、halfSec 秒ごとに半減(式・係数とも調整項目)。
  // 目的: 周回終盤の駆け込み買い(谷)を引き伸ばしつつ、待てば必ず買える=16時間の壁を作らない。
  // perBuy 0.25→0.45(2026-07-10 第12次R: T1=短周回の谷対策。S3 17→26/47・S1 30→46/47・S8 31→33/45、
  // S10 28-31維持。halfSecを伸ばす案はS10=30秒間隔の放置型の周回が2時間上限を超えて崩れるため不採用=グリッド実測)
  // 提案12「金は金を呼ぶ」(2026-07-11 承認): 金取得の瞬間、確率pで追いの金が1枚即出現(連鎖なし)
  goldenEcho: { p: 0.35, amountMul: 1.0 },
  // 提案13「編成の心得」(2026-07-11 承認・バランス方針限定): 4稼ぎ口のそろい具合u=min(1,4×最小シェア)で全生産×(1+maxBonus×u)
  ensemble: { maxBonus: 0.15, updateSec: 30 },
  upSurge: { perBuy: 0, halfSec: 120 }, // まとめ買い割増は廃止(2026-07-13 ユーザー指示「割り増しを消す」。perBuy=0で休眠) // 0.5/75→0.9/120(2026-07-11 T1再ペーシング): 研究200本経済の末期成長は
  // 1桁/6秒の購入テンポ律速=転生コスト・PT梯子の桁レバーが無力(+3桁で周回時間が1秒も動かないと実測)。
  // まとめ買い割増こそが成長率レバー。掃引: 0.5/75(S3 15/48・S1 33/48)→0.8/75(28・47)→0.9/120(S3 46/48・S1 48/48)。
  // 第0回はS3 3982s・S1 2715s=2時間帯内。

  // ---- アップグレードコスト式 ----  cost = coef * base^basePow * growth^(owned*ownPow)
  // 2026-07-06 第8次: 新帯域(周回25〜90分)へ向けownPow 0.25→0.27(再登坂・開拓の全体減速)、
  // 膝4300/1.0→900/0.55(深部の周回短縮を抑制。㉒単調増加と⑦後半帯域用)
  upCost: { coef: 1100, basePow: 0.60, ownPow: 0.27, knee: 2600, ownPow2: 0.72, firstUnitSec: 120, firstBuySecRes: 0, firstBuySecStage: 0, revealCount: 25 },

  // ---- 個別強化(報酬) ----
  upPerk: { base: 0.22, slope: 0.010, floor: 0.055 },

  // ---- 焼き加減システムは廃止(2026-07-10 ユーザー指示・合格条件からも削除。旧係数 bake:{...} は git 履歴参照) ----

  // ---- 段階式研究(第5次実装) ----
  // 2026-07-05 キャップ全撤廃(WORKSHOP_SPEC 15): min(変数,N)/capv 型の頭打ちを全削除。
  // 撤廃に伴う係数変更(ゲームへ反映すること):
  //  - critCpsCoef: 0.1×min(最高層,400)/400 → 0.00025×最高層(上限点で同値の傾きに変換)
  //  - comboCap(40)/critStageCap/supStageCap/factoryStageCap/spiceStageCap/matureCap(240)/
  //    huntStageCap/bankCapStageCap/foldKillCap/foldStageCap/galaxyStageCap/bhBoostStageCap/
  //    waveAmpCap(3)/antiStageCap/antiPrestigeCap(40)/res.ownCap: 削除(線形のまま無限)
  //  - 月面発酵 段2: ×(1+min(1,余裕率/10)) → ×(1+log10(1+余裕率)/10)(暴走防止の逓減式に置換)
  //  - 複利利息: min(利息, 毎秒生産×2) → 利息/(1+利息/(毎秒生産×2)) (漸近逓減式に置換)
  //  - 重力圧縮 段3: 圧縮×(1-min(0.35,0.001×最高層)) → 圧縮×e^(-0.001×最高層)(負値防止の逓減式)
  res2: {
    comboRate: 0.03, comboWindow: 30,
    critCpsCoef: 0.003,
    supExtra: 0.008, supStageCoef: 0.001,
    ovenBakeMulBake: 1.7, ovenBakeMulOther: 1.2,
    ovenS3Flat: 0.06, ovenStageCoef: 0.008,
    factoryEqKind: 0.018, factoryStageCoef: 0.0012, // factoryEqKind=工場網段2の唯一の増幅変数(2026-07-17 一本化・ユーザー指示「1研究1増幅変数」): 上位設備の種類数×設備直送。旧factoryHiKind(工場cps側=総収入0.05%未満で測定不能)は削除
    matureRate: 0.009, aromaDur: 12, spiceStageCoef: 0.0015, // matureRate 0.006→0.009(2026-07-17 ⑬熟成: ⑫経済(killVal×6/satMax16)でS4の担ぎ手が消え全戦略1.01-1.04に希釈→増加方向で押し上げ)
    huntExtendSec: 40, huntStageCoef: 0.0008,
    bankIntRate: 0.005, bankIntCapCps: 8.0, bankIntEmaFrac: 0.05, bankCapStageCoef: 0.08, // bankIntEmaFrac(2026-07-11): ソフトキャップ=max(cps, 直近稼ぎ率EMA×0.05)×8=直送主流の周回でも利息が総収入の最大〜40%で見える(⑨bank1.000対策)
    moonMarginDiv: 10, moonResCount: 0.05,
    foldKillCoef: 0.002, foldStageCoef: 0.001,
    galaxyBonusCoef: 0.05, galaxySat: 120, galaxyStageCoef: 0.0008,
    bhChargeFull: 1200, bhBoostCoef: 2.4, bhBoostDur: 240, bhBoostStageCoef: 0.002, // ⑬圧縮チャージ再係留2回目(2026-07-14)
    bhCompStageCoef: 0.001,
    waveAmpBase: 0.45, waveAmpPerRes: 0.05, wavePeriod: 90, waveStageCoef: 0.001,
    antiStageCoef: 0.0008, antiPrestigeCoef: 0.03
  },

  // 新規設備ボーナス(bestEfficiency): 未所持の設備は効率×この倍率で評価=「新しい設備をまず1台試す」
  // 自然なプレイの模型。T2第0回の解放密度と㉑(初購入Δ=低CPS時点で買う)を同時に立てる。調整項目。
  // 8→6(2026-07-10 第12次R: surge0.45とセット。8だと新設備への貯金停滞が長くS5/S7/S8の第0回が帯超え、
  // 4-5だとS9/S10が帯割れ=グリッド実測。6でS7 0.94・S9 0.58・S10 0.56)
  noveltyBoost: 6,

  // ---- 周回テンポ ----
  tempo: { ramp: 0.105, rampDiv: 420 },

  // ---- 報酬選択 ----
  reward: { lvPerCount: 26, choiceBase: 3 },

  // ---- 工房・素材・ステージ・注文ボード(第12次P・本シム統合。WORKSHOP_SPEC v1〜v4) ----
  // 素材はクッキー経済と交差しない(買えない/変換できない=④⑤へ直接干渉しない)。
  // 効果はすべて相対型・進行スケール型(固定倍率は腐る)。数値は調整項目。
  // ---- 新装備システム(2026-07-13 ユーザー確定仕様) ----
  // 9部位(武器/盾/防具上/防具下/手/帽子/靴/アクセ×2枠)の付け替え式。工房の装備作成は最初から解放。
  // 効果=全生産×(allMulPerTier^ティア)の固定倍率(表示は固定値・㉘のシェアを歪めない全生産項)。
  // 素材=色素材 ore_t1..t6(モンスターの色=ノルマ層の帯で変わる)+既存ステージ専属素材。
  // レシピ=前ティア同カテゴリ装備1個+色素材oreNeed個+ステージ素材stageMatNeed個(1〜5種×各1〜n個の枠内)。
  // ---- 固定クエスト(2026-07-13 ユーザー確定仕様) ----
  // 注文ボードに固定クエストを常設表示。達成すると次のステージが解放され、次のクエストが表示される。
  // 制限時間なし・内容固定・進捗は周回を跨いで累積。「そのステージを3周回ぐらい」の重さに調整する。
  // クエストN=「フロンティアステージ(=最新解放ステージ)Nで累計討伐 killsNeed[N-1] 体」
  quest2: { killsNeed: [100, 130, 170, 220, 280] }, // ステージ1→2 … 5→6(調整項目・3周回相当を実測で合わせる)
  equip2: {
    tiers: 6,             // ステージ1〜6に対応(ステージが変わると作れる装備が変わる)
    allMulPerTier: 2.0,   // 装備1個の全生産倍率=この値^ティア(付け替えで前ティア比×2)
    layerBand: 5,         // ノルマ層5層ごとに色が変わる(色素材tier = 1+floor(層/band)、上限tiers)
    oreDropPerKill: 5,    // 討伐1体あたりの色素材期待ドロップ
    oreNeed: 3,           // レシピの色素材必要数
    stageMatNeed: 3,      // レシピのステージ素材必要数
    dropAllMul: 1,        // 素材ドロップ全体倍率(2026-07-15「もっと少なく」で×2撤回=1)
    dishReserve: 40,      // 料理リザーブ(2026-07-14): 装備作成が料理素材を食い潰してバフを失わないための残量確保
    craftPerRunCap: Number(process.env.CRAFT_CAP) || 5,    // 装備作成は1周回に0〜5個まで(2026-07-15 ユーザー指示・検証用にCRAFT_CAP上書き可)
    stageSigFrac: 0.35    // ステージ署名色(R17b 2026-07-17 ユーザー指示): 討伐ドロップの35%が今のステージの署名色(S1=白銀〜S6=紅)。量は色レア度準拠
  },
  ws: {
    // ステージ(v3 §13: 周回選択制・S6深層は層が無限)。ボス化=そのステージ累計討伐 bossBase+bossPer×(no-1)−コンパスLv
    stages: [
      { no: 1, hpMul: 1,  dropMul: 1, c: ['butter', 'flour'],     r: [] },
      { no: 2, hpMul: 3,  dropMul: 2, c: ['cacao', 'lavaSugar'],  r: ['ironShard'], goldenGain: 1.10 },
      { no: 3, hpMul: 8,  dropMul: 2, c: ['mint', 'frostSugar'],  r: ['silentCore'], stayMul: 0.85 },
      { no: 4, hpMul: 20, dropMul: 2, c: ['spice'],               r: ['goldDust'], goldenIntMul: 0.9, rewardLvAdd: 8, gbShareAdd: 0.15 },
      { no: 5, hpMul: 60, dropMul: 3, c: ['stardust'],            r: ['cometShard'], bossCycleAdd: -10 },
      { no: 6, hpMul: 60, hpGrow: 4, dropMul: 3, dropPerLayer: 1, c: ['stardust'], r: ['voidSugar'] }
    ],
    bossBase: 25, bossPer: 10,
    // 条件ドロップ(v4 §18): 通常撃破=基本素材/クリックとどめ=共通+1/金ブースト中=黄金粉/
    // オーバーキル(残HPの5倍)=レア枠/連続3体(狩り窓)=ボス核+1/余裕率2倍=共通+1/深層=虚空糖
    // 希少化(2026-07-15): 素の落ちやすさ=dropBase(5%) × 強さ(√HP) × レア度。base/lvDivは投資上乗せ用に残す。
    drops: { base: 1, lvDiv: 6, overkillMul: 5, chainKills: 3, marginThresh: 2, clickFinishDiv: 7, universalRate: 0.8, dropBase: Number(process.env.DROP_BASE) || 0.20, rarity: { c: 1.0, r: Number(process.env.DROP_RARE) || 0.35, b: 1.0 } },
    // 料理(600秒バフ・同時3品・転生で解除。レシピ=対応素材の初入手で開示)
    cookDur: 600, cookMax: 3, costMul: 4, // costMul: 素材が豊富すぎると料理が常時100%稼働になり、蒸留フラスコ(持続延長)と注文の素材セット報酬が無価値化(⑮の2/㉙で1.00=実測)。コスト増で稼働率<100%の周回を作る
    recipes: [
      { id: 'butterCookie',    cost: { butter: 5, flour: 3 } },        // 全生産×(1+0.02×最高層)
      { id: 'chocoFondant',    cost: { cacao: 4, butter: 3 } },        // クリック生産連動係数×2
      { id: 'mintIce',         cost: { mint: 6, frostSugar: 3 } },     // 金出現間隔×0.75
      { id: 'hunterStew',      cost: { ironShard: 2, spice: 4 } },     // モンスター間隔×0.75・ダメージ×1.5
      { id: 'frostCake',       cost: { frostSugar: 5, silentCore: 1 } }, // ノルマゲージ増加×0.85
      { id: 'stardustParfait', cost: { stardust: 8, cometShard: 1 } }, // 効果中購入設備=その周回中生産×1.25
      { id: 'voidTart',        cost: { voidSugar: 10, cometShard: 2 } } // ドロップ×2・モンスター間隔×0.7
    ],
    fx: { butterLayerCoef: 0.02, fondantClickMul: 2, mintIceGoldenInt: 0.75, stewMonsterInt: 0.75, stewDmg: 1.5,
      frostGauge: 0.45, parfaitProdMul: 1.25, voidDrop: 2, voidMonsterInt: 0.7 },
    // 作成(装備・永続Lv・コスト=基本×2.2^Lv・Lv上限10=限界突破は本シム省略)
    eqGrowth: 2.2, eqLvCap: 10,
    equipment: [
      { id: 'goldenWhisk',      cost: { butter: 10, flour: 8 } },      // クリック連動係数×(1+0.15Lv)
      { id: 'ovenMitt',         cost: { cacao: 12, ironShard: 2 } },   // こんがり+0.05Lv
      { id: 'pressExtractor',   cost: { spice: 14, goldDust: 2 } },    // 金ブースト×(1+0.04Lv)
      { id: 'monsterAlmanac',   cost: { ironShard: 4, silentCore: 2 } }, // ドロップ+floor(Lv/2)・ダメージ×(1+0.06Lv)
      { id: 'stillFlask',       cost: { mint: 10, lavaSugar: 6 } },    // 料理効果時間×(1+0.10Lv)
      { id: 'dimensionCompass', cost: { bossCore: 1, stardust: 12 } }, // ボス周期−Lv・選択ステージのドロップ×(1+0.05Lv)
      { id: 'masterTray',       cost: { flour: 10, cacao: 8 } }        // 名匠の天板: 全生産×(1+0.06Lv)(2026-07-10ユーザー指示で追加)
    ],
    // almanacDmgPerLv 0.06→0.08(2026-07-10: masterTray追加の経済移動で⑮の2が1.049に割れたためマージン)
    eqFx: { whiskPerLv: 0.15, mittPerLv: 0.12, pressPerLv: 0.04, almanacDmgPerLv: 0.15, almanacDropPerLv: 0.5, almanacHuntPerLv: 0.05, almanacHuntMax: 0.5, flaskPerLv: 0.10, compassDropPerLv: 0.05, trayPerLv: 0.06 }, // mittPerLv=断熱オーブン手袋: オーブン生産×(1+0.12×Lv)(焼き加減廃止で再係留・mittCpsPerLvは統合削除) / almanacDrop/Hunt=図鑑の再係留(2026-07-11: 研究インフレでダメージ飽和=一撃のため図鑑の限界価値ゼロ(⑮の2比1.000実測)→素材+0.5/Lv(旧floor(Lv/2)はLv1で0)+討伐直送×(1+0.12Lv)を追加)
    // 注文ボード(§19: 同時1件・間隔1800×0.85^転生回数・制限240+4√経過秒・必要量/報酬は現在値に相対)
    orders: { intervalBase: 1800, intervalDecay: 0.85, limitBase: 240, limitSqrt: 4,
      needProd: 0.25, needClick: 0.5, needHunt: 0.6, rewardCookieMul: 0.5, rewardCookieSec: 300, rewardBoostMul: 2, rewardBoostSec: 120,
      rewardMatSet: 80, rewardFill: 1.25, rewardItems: 4 }
      // rewardCookieMul/Sec(2026-07-11 確定形): 達成後300秒間、獲得+50%をクッキーで上乗せ受け取り。
      // 一括グラントの変遷(全て実測NG): cps×制限×50=1.009 → 周回平均×0.6=1.021 → EMA×0.3=1.15 →
      // 所持×45%=1.028 → 瞬間ペース×300秒=1.11-1.24振動 → ×450秒=1.153。結論: 末期は購入テンポ律速で
      // 一括金は軌道を進められない。フロー比例(ブースト報酬と同型)だけが時間不変で効く。
      // rewardFill 1.0→1.25・rewardItems 3→4(㉙materials 1.142→1.2乗せのマージン)
  }
};
