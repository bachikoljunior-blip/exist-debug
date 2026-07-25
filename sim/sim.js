'use strict';
// クッキーゲーム 100時間プレイシミュレータ（期待値ベース・1秒刻み）
// ゲーム本体(HTML)の式を移植し、params.js の値だけで挙動が変わる。
const P = require('./params.js');

// ================= 静的データ =================
const UPGRADES = [
  { id: 'finger', type: 'click', value: 1, base: 0.0506, growth: 1.32 },
  { id: 'grandma', type: 'cps', value: 1, base: 0.9, growth: 1.30 }, // base=0.9(2026-07-15 ユーザー「ゲーム内で買える初回価格を1000に」=1100×0.9^0.6→q5cost=1000。旧base1000は初回69000だった。1台目生産1のまま・強化は所持数スケール)
  { id: 'oven', type: 'cps', value: 8, base: 390, growth: 1.35 },
  { id: 'factory', type: 'cps', value: 45, base: 2600, growth: 1.37 },
  // 第12次R3: 初台ボーナス(presence)が第0回の中位チェーン(工場→銀行→香料棚→異世界炉)を加速し
  // S9/S10のT2第0回が中央値0.43/0.44に潰れたため、銀行/香料棚/異世界炉の初期コストを×3(丸めq5)。
  // ×1/×2/×3/×5の掃引で×3のみ10方針全部が帯[0.5,1]内(S9 0.59/S10 0.78/最大S3 0.96)。
  { id: 'bank', type: 'cps', value: 260, base: 54000, growth: 1.39 },
  { id: 'spiceRack', type: 'cps', value: 780, base: 180000, growth: 1.40 },
  { id: 'portal', type: 'cps', value: 1600, base: 780000, growth: 1.41 },
  { id: 'moonBakery', type: 'cps', value: 9800, base: 12500000, growth: 1.43 },
  { id: 'timeOven', type: 'cps', value: 65000, base: 180000000, growth: 1.45 },
  { id: 'galaxyFactory', type: 'cps', value: 450000, base: 2800000000, growth: 1.47 },
  { id: 'blackHoleMixer', type: 'cps', value: 3300000, base: 46000000000, growth: 1.49 },
  { id: 'universeOven', type: 'cps', value: 26000000, base: 820000000000, growth: 1.51 },
  { id: 'godFinger', type: 'click', value: 2600000, base: 1500000000000, growth: 1.51 },
  { id: 'cookieSingularity', type: 'cps', value: 230000000, base: 16000000000000, growth: 1.53 },
  { id: 'quantumBakery', type: 'cps', value: 2100000000, base: 320000000000000, growth: 1.55 },
  { id: 'antimatterOven', type: 'cps', value: 22000000000, base: 7000000000000000, growth: 1.57 }
];
const UPIDX = {}; UPGRADES.forEach((u, i) => UPIDX[u.id] = i);
// 丸め規則: 設備の基礎毎秒生産を量子化(クリック「強い指」とおばあちゃんは1固定=ユーザー指定)
// ※現行の全valueは既に規則適合(8,45,260,…)。将来の調整値も自動で量子化されるようここで適用する。
//   q5 は module 後方で function 宣言(hoisting)されているためここから呼べる。
UPGRADES.forEach(u => { if (u.id !== 'finger' && u.id !== 'grandma') u.value = Math.max(1, Math.floor(q5(u.value))); });

const UPGRADE_UNLOCK_SKILLS = {
  moonBakery: 'upgrade_moon', timeOven: 'upgrade_time', galaxyFactory: 'upgrade_galaxy',
  blackHoleMixer: 'upgrade_blackhole', universeOven: 'upgrade_universe', godFinger: 'upgrade_godfinger',
  cookieSingularity: 'upgrade_singularity', quantumBakery: 'upgrade_quantum', antimatterOven: 'upgrade_antimatter'
};

const RESEARCH = [
  // 2026-07-06: 研究段1のスキルゲートを全廃。対応設備をその回で購入済みなら購入可能
  { id: 'fingerTechnique' }, { id: 'grandmaCrowd' }, { id: 'ovenBatch' },
  { id: 'factoryNetwork' }, { id: 'spiceBlend' }, { id: 'portalNetwork' },
  { id: 'bankClickDividend' }, { id: 'moonGlobalYeast' }, { id: 'portalGlobalFold' },
  { id: 'galaxyAssembly' }, { id: 'blackHoleCompression' }, { id: 'quantumProofing' },
  { id: 'antimatterRecipe' },
  { id: 'cpsStrike' } // 生産火力転換(2026-07-13 ユーザー指示「研究3000万クッキー、モンスターダメージに毎秒生産が乗る」)
];
const RES_IDX = {}; RESEARCH.forEach((x, i) => { RES_IDX[x.id] = i; }); // ㉚初回開発の階段化(深さ)用
// ㉚段階カードの初回開発の周回オフセット(第12版): 段2/段3の生涯初開発は「全前提が初めて揃った周回(アーミング)から
// +k 周回後」に解禁する。金・台数・層・自己ベストは終盤の買い戻し連鎖(1tickで収入×100・ノルマ+5〜10層)で全て
// 一瞬で越えられる(実測でゲート4種が全滅)が、転生回数だけはブリッツ不能(T1=1周回≥20分)。k はカード毎に個別=
// 同じ瞬間に複数カードが揃っても別々の周回に散り、周回単位(≥20分)で間隔が保証される。無指定は 段2=0・段3=1。
// 全カード k≥1(2026-07-25 実測修正): k=0だと研究の初開発と同周回の連鎖でΔ1になる(段2のアーミング周回=研究初購入
// の周回のため)。また貯金プレミアム(凍結)との併用は、貯蓄型の膨れた財布基準の凍結が周回を跨いで k ゲートと同じ
// 収入回復点に再同期しΔ1を生むため、段階カードのプレミアムは廃止(firstBuySecStage=0)し k ゲートに一本化。
const STAGE_K = {
  'portalGlobalFold:2': 1, 'blackHoleCompression:2': 2, 'galaxyAssembly:3': 3,
  'quantumProofing:2': 1, 'antimatterRecipe:2': 2,
  'portalGlobalFold:3': 1, 'blackHoleCompression:3': 1, 'quantumProofing:3': 2, 'antimatterRecipe:3': 2,
  // 中盤系列のゲートスキルが同時期に揃う組の分割(実測: run12に grandmaCrowd:3/ovenBatch:3/factoryNetwork:2 が同周回衝突)
  'ovenBatch:3': 2, 'factoryNetwork:2': 2
};
// ㉚研究の初回開発の周回オフセット(第14版): 後半設備の初号機→その研究がΔ1連発する系列(実測: blackHoleMixer→
// blackHoleCompression等)は、研究の生涯初開発を「対応設備の初開発が揃った周回から+1周回後」に。再購入は無条件。
const RES_K = { moonGlobalYeast: 1, galaxyAssembly: 1, blackHoleCompression: 1, quantumProofing: 1 };

// ==== 段階式研究: 対応設備(その回で購入済みのみ表示/購入可)と段階解放スキル ====
const RES_EQUIP = {
  fingerTechnique: 'finger', grandmaCrowd: 'grandma', ovenBatch: 'oven',
  factoryNetwork: 'factory', spiceBlend: 'spiceRack', portalNetwork: 'portal',
  bankClickDividend: 'bank', moonGlobalYeast: 'moonBakery', portalGlobalFold: 'portal',
  galaxyAssembly: 'galaxyFactory', blackHoleCompression: 'blackHoleMixer',
  quantumProofing: 'quantumBakery', antimatterRecipe: 'antimatterOven',
  cpsStrike: 'portal' // 生産火力転換: 異世界炉(モンスター系)を購入済みの周回で買える
};
// ovenBatch段2の解放=auto_1(2026-07-10 ㉘bake対策): cheapestFirst系の方針はスキルを毎周回1個ずつ
// 段順に買うため、旧auto_3ゲートだと bake代表(S1)の主役エンジン(設備直送+大量焼成倍率)が run14まで
// 解禁されず、金ゲート(golden_1=run2→spiceBlend段2=run7)に12周回先行される=中盤の金50-59%支配・
// 設備19-29%NG(run4-14)の構造要因。主役の特殊経済は各系統の入口スキルで開く。
const RES_STAGE2 = {
  fingerTechnique: 'click_2', grandmaCrowd: 'auto_2', ovenBatch: 'auto_1',
  factoryNetwork: 'auto_4', spiceBlend: 'golden_1', portalNetwork: 'monster_3',
  bankClickDividend: 'economy_2', moonGlobalYeast: 'upgrade_time', portalGlobalFold: 'upgrade_singularity',
  // ㉚再配置(2026-07-25): blackHoleCompression:2 は upgrade_singularity → upgrade_godfinger へ(portalGlobalFold:2 と
  // 同一スキルだったのが終盤団子の主犯)。quantumProofing:2 は quantum(設備前提と同段)へ、antimatterRecipe:2 は
  // antimatter(同)へ=各カードのゲートスキルを別のはしご段(=別の転生)に散らす。
  galaxyAssembly: 'upgrade_universe', blackHoleCompression: 'upgrade_godfinger',
  quantumProofing: 'upgrade_quantum', antimatterRecipe: 'upgrade_antimatter'
};
const RES_STAGE3 = {
  fingerTechnique: 'click_4', grandmaCrowd: 'auto_4', ovenBatch: 'auto_4', // ovenBatch段3ゲート: 焼き加減廃止(2026-07-10 ユーザー指示)に伴い bake_temperature→auto_4 へ付け替え
  factoryNetwork: 'economy_2', spiceBlend: 'golden_3', portalNetwork: 'monster_4',
  bankClickDividend: 'economy_analysis', moonGlobalYeast: 'research_analysis', portalGlobalFold: 'master_final',
  // ㉚再配置(2026-07-25): galaxyAssembly:3 は upgrade_singularity → upgrade_quantum へ。旧配置は
  // portalGlobalFold:2(段2側)と同じ singularity 到着の瞬間に複数カードが一斉解禁される終盤団子の主犯だった。
  // 段階カードのゲートスキルは可能な限り別のはしご段(=別の転生)に散らす。
  galaxyAssembly: 'upgrade_quantum', blackHoleCompression: 'upgrade_antimatter',
  quantumProofing: 'master_final', antimatterRecipe: 'master_final'
};

const REWARD_POOL = [
  { id: 'goldenRate', category: 'golden' },
  { id: 'goldenPower', category: 'golden' },
  { id: 'goldenAmount', category: 'golden' },
  { id: 'monsterDamage', category: 'hunt' },
  { id: 'monsterRate', category: 'hunt' },
  { id: 'monsterStay', category: 'hunt' },
  { id: 'goldenChain', category: 'golden', unlockSkill: 'unlock_reward_goldenChain' },
  { id: 'crackedFang', category: 'hunt', unlockSkill: 'unlock_reward_crackedFang' },
  { id: 'chainPrep', category: 'risk', unlockSkill: 'unlock_reward_chainPrep' },
  { id: 'huntFocus', category: 'risk', unlockSkill: 'unlock_reward_huntFocus' },
  { id: 'goldenTarget', category: 'golden', unlockSkill: 'unlock_reward_goldenTarget' },
  { id: 'goldenFirstHit', category: 'golden', unlockSkill: 'unlock_reward_goldenFirstHit' },
  { id: 'beastScent', category: 'golden', unlockSkill: 'unlock_reward_beastScent' },
  { id: 'beastHeatFerment', category: 'hunt', unlockSkill: 'unlock_reward_beastHeatFerment' },
  { id: 'biteRecovery', category: 'hunt', unlockSkill: 'unlock_reward_biteRecovery' },
  { id: 'crushedMill', category: 'equipment', unlockSkill: 'unlock_reward_crushedMill' },
  { id: 'huntingCore', category: 'hunt', unlockSkill: 'unlock_reward_huntingCore' },
  { id: 'brandHunt', category: 'hunt', unlockSkill: 'unlock_reward_brandHunt' },
  { id: 'deepPursuit', category: 'risk', unlockSkill: 'unlock_reward_deepPursuit' },
  { id: 'goldenBeastMutation', category: 'risk', unlockSkill: 'unlock_reward_goldenBeastMutation' }
];

// スキルツリー（id, cost=元値, prereqs, effects[type,target,value]）
const SKILL_NODES = [
  // 2026-07-06: 研究解放専用ノード10個(research_bank/factory/spice/moon/portal/galaxy/
  // blackhole/portalGlobal/quantum/antimatter)を削除し、後続は削除ノードの親へ配線替え。
  // 研究段1はスキルゲートなし(対応設備の購入のみ)。段2/3の解放スキルは変更なし。
  // 2026-07-06 第8次(⑲=隣接比≤10倍): 「終端への近道」辺を縦長に組み替え(ユーザー承認済みの範囲)。
  //  全辺の取得順ラング差≤5(比 1.57^5=9.53≤10)になるよう、遠距離辺を削除し直近ノードへ配線替え。
  //  QoLノード(0.35倍価格)はメインノードの子を持たない(安い親→高い子の辺比超過を防ぐ)。
  //  配線替え一覧(旧→新)は HANDOFF 6章の反映メモ参照。ノードの増減はなし。
  { id: 'core', cost: 40, prereqs: [], effects: [['unlockSystem', 'runPolicy']] },
  { id: 'click_1', cost: 40, prereqs: ['core'], effects: [['click', null, 0.06]] },
  { id: 'click_2', cost: 41, prereqs: ['click_1'], effects: [['click', null, 0.10]] },
  { id: 'click_3', cost: 43, prereqs: ['click_2', 'golden_2'], effects: [['click', null, 0.14], ['goldenAmount', null, 0.06]] },
  { id: 'click_4', cost: 58, prereqs: ['click_3'], effects: [['click', null, 0.24], ['all', null, 0.02]] },
  { id: 'golden_1', cost: 41, prereqs: ['core'], effects: [['goldenRate', null, 0.04]] },
  // 方針入口の増幅スキル(第12次R4・ユーザー承認 2026-07-11「効果増幅のスキルは承認不要で追加してよい」):
  // 各周回方針の主役効果を素直に増幅する固定値ノード。fixed=生産系の幾何はしご(nodeM)にもfxスケールにも
  // 割り込まない生の値(既存46ラングの経済を一切動かさない)。値段はQoL枠(utilRatio×入口)=はしご非消費。
  { id: 'click_amp', cost: 15, prereqs: ['click_1'], fixed: true, effects: [['click', null, 0.75]] },
  { id: 'golden_amp', cost: 15, prereqs: ['golden_1'], fixed: true, effects: [['goldenAmount', null, 0.50]] },
  // おまけスキル(金は金を呼ぶ/編成の心得/土産の屋台/戦利品の行商)撤去(2026-07-22 ユーザー指示)。
  { id: 'monster_amp', cost: 15, prereqs: ['monster_1'], fixed: true, effects: [['monsterDamageSkill', null, 0.60]] },
  { id: 'auto_amp', cost: 15, prereqs: ['auto_1'], fixed: true, effects: [['cps', null, 0.75]] },
  { id: 'golden_2', cost: 43, prereqs: ['golden_1'], effects: [['goldenAmount', null, 0.15]] },
  { id: 'golden_3', cost: 47, prereqs: ['golden_2'], effects: [['goldenPower', null, 0.35]] },
  { id: 'golden_analysis', cost: 66, prereqs: ['golden_3'], effects: [['unlockSystem', 'goldenAnalysis']] },
  { id: 'golden_4', cost: 78, prereqs: ['golden_3'], effects: [['goldenRate', null, 0.08], ['goldenAmount', null, 0.25]] },
  { id: 'auto_1', cost: 40, prereqs: ['core'], effects: [['cps', null, 0.06]] },
  { id: 'auto_2', cost: 41, prereqs: ['auto_1', 'monster_2'], effects: [['cps', null, 0.10]] },
  { id: 'auto_3', cost: 43, prereqs: ['auto_2', 'monster_2'], effects: [['cps', null, 0.14], ['monsterDamageSkill', null, 0.06]] },
  { id: 'auto_4', cost: 58, prereqs: ['auto_3'], effects: [['cps', null, 0.24], ['all', null, 0.02]] },
  { id: 'monster_1', cost: 41, prereqs: ['core'], effects: [['monsterRate', null, 0.04]] },
  // 工房(WORKSHOP_SPEC v2 §7・第12次P本シム統合): 素材の嗅覚=素材ドロップ+料理解放/工房の拡張=作成(装備)解放。
  // QoLノード(utilRatio価格)=メインのはしご(rungCosts)を消費しない→既存スキルコストは1つも動かない。
  { id: 'workshop_1', cost: 15, prereqs: ['monster_1'], effects: [['unlockSystem', 'workshop1']] },
  { id: 'workshop_2', cost: 15, prereqs: ['workshop_1'], effects: [['unlockSystem', 'workshop2']] },
  // 装備作成ティア解放(2026-07-15 ユーザー指示「作成のティア2以降をそれぞれスキル解放で作成欄が出る」):
  // workshop_2=ティア1作成欄。ティア2-6の作成欄は各解放スキルで順に出る(QoL枠=はしご非消費)。
  { id: 'eqcraft_t2', cost: 15, prereqs: ['workshop_2'], effects: [['unlockSystem', 'eqcraftT2']] },
  { id: 'eqcraft_t3', cost: 15, prereqs: ['eqcraft_t2'], effects: [['unlockSystem', 'eqcraftT3']] },
  { id: 'eqcraft_t4', cost: 15, prereqs: ['eqcraft_t3'], effects: [['unlockSystem', 'eqcraftT4']] },
  { id: 'eqcraft_t5', cost: 15, prereqs: ['eqcraft_t4'], effects: [['unlockSystem', 'eqcraftT5']] },
  { id: 'eqcraft_t6', cost: 15, prereqs: ['eqcraft_t5'], effects: [['unlockSystem', 'eqcraftT6']] },
  { id: 'monster_2', cost: 43, prereqs: ['monster_1', 'golden_2'], effects: [['monsterDamageSkill', null, 0.16]] },
  { id: 'monster_3', cost: 47, prereqs: ['monster_2'], effects: [['monsterHpDown', null, 0.07]] },
  { id: 'hunt_analysis', cost: 69, prereqs: ['monster_3'], effects: [['unlockSystem', 'huntAnalysis']] },
  { id: 'monster_4', cost: 83, prereqs: ['click_4'], effects: [['monsterStay', null, 0.10]] },
  { id: 'economy_1', cost: 41, prereqs: ['auto_1'], effects: [['upgradeDiscount', null, 0.02], ['researchDiscount', null, 0.02]] },
  { id: 'research_1', cost: 41, prereqs: ['economy_2'], effects: [['researchDiscount', null, 0.04]] },
  { id: 'research_remodel', cost: 44, prereqs: ['research_1'], effects: [['researchDiscount', null, 0.03], ['unlockSystem', 'researchRemodel']] },
  { id: 'economy_2', cost: 47, prereqs: ['economy_1'], effects: [['upgradeDiscount', null, 0.05]] },
  // 熟練(2026-07-06 ユーザー採用・第11次): スキルで解放。同じ設備を買うほど1台あたり生産が複利で伸びる
  { id: 'mastery_low', cost: 52, prereqs: ['economy_2'], effects: [['unlockSystem', 'masteryLow']] },
  { id: 'mastery_high', cost: 210, prereqs: ['mastery_low', 'upgrade_galaxy'], effects: [['unlockSystem', 'masteryHigh']] },
  { id: 'economy_analysis', cost: 62, prereqs: ['economy_2'], effects: [['unlockSystem', 'economyAnalysis']] },
  { id: 'order_board', cost: 86, prereqs: ['economy_analysis'], effects: [['unlockSystem', 'orderBoard']] },
  { id: 'upgrade_moon', cost: 52, prereqs: ['economy_2'], effects: [['unlockUpgrade', 'moonBakery']] },
  { id: 'upgrade_time', cost: 62, prereqs: ['upgrade_moon', 'research_remodel'], effects: [['unlockUpgrade', 'timeOven']] },
  { id: 'upgrade_galaxy', cost: 98, prereqs: ['upgrade_time', 'auto_4'], effects: [['unlockUpgrade', 'galaxyFactory']] },
  { id: 'upgrade_blackhole', cost: 187, prereqs: ['upgrade_galaxy'], effects: [['unlockUpgrade', 'blackHoleMixer']] },
  { id: 'research_analysis', cost: 222, prereqs: ['research_remodel'], effects: [['unlockSystem', 'researchAnalysis']] },
  { id: 'reward_1', cost: 159, prereqs: ['monster_4'], effects: [['rewardChoices', null, 1]] },
  { id: 'reward_synergy', cost: 213, prereqs: ['reward_1'], effects: [['unlockSystem', 'rewardSynergy']] },
  { id: 'reward_choice_2', cost: 357, prereqs: ['reward_synergy'], effects: [['rewardChoices', null, 1]] },
  { id: 'reward_2', cost: 238, prereqs: ['upgrade_singularity'], effects: [['upgradePerkPower', null, 0.15]] },
  { id: 'unlock_reward_crackedFang', cost: 107, prereqs: ['monster_4'], effects: [['unlockReward', 'crackedFang']] },
  { id: 'unlock_reward_chainPrep', cost: 141, prereqs: ['unlock_reward_crackedFang'], effects: [['unlockReward', 'chainPrep']] },
  { id: 'unlock_reward_huntFocus', cost: 189, prereqs: ['unlock_reward_crackedFang'], effects: [['unlockReward', 'huntFocus']] },
  { id: 'unlock_reward_biteRecovery', cost: 304, prereqs: ['unlock_reward_huntFocus'], effects: [['unlockReward', 'biteRecovery']] },
  { id: 'unlock_reward_beastHeatFerment', cost: 275, prereqs: ['unlock_reward_biteRecovery'], effects: [['unlockReward', 'beastHeatFerment']] },
  { id: 'unlock_reward_huntingCore', cost: 412, prereqs: ['unlock_reward_beastHeatFerment'], effects: [['unlockReward', 'huntingCore']] },
  { id: 'unlock_reward_brandHunt', cost: 472, prereqs: ['unlock_reward_biteRecovery'], effects: [['unlockReward', 'brandHunt']] },
  { id: 'unlock_reward_deepPursuit', cost: 808, prereqs: ['unlock_reward_huntingCore'], effects: [['unlockReward', 'deepPursuit']] },
  { id: 'unlock_reward_goldenChain', cost: 102, prereqs: ['golden_4', 'unlock_reward_crackedFang'], effects: [['unlockReward', 'goldenChain']] },
  { id: 'unlock_reward_goldenTarget', cost: 122, prereqs: ['unlock_reward_goldenChain'], effects: [['unlockReward', 'goldenTarget']] },
  { id: 'unlock_reward_goldenFirstHit', cost: 165, prereqs: ['unlock_reward_goldenTarget'], effects: [['unlockReward', 'goldenFirstHit']] },
  { id: 'unlock_reward_beastScent', cost: 174, prereqs: ['unlock_reward_goldenTarget'], effects: [['unlockReward', 'beastScent']] },
  { id: 'unlock_reward_goldenBeastMutation', cost: 1096, prereqs: ['unlock_reward_deepPursuit'], effects: [['unlockReward', 'goldenBeastMutation']] },
  { id: 'unlock_reward_crushedMill', cost: 357, prereqs: ['reward_2', 'unlock_reward_huntingCore'], effects: [['unlockReward', 'crushedMill']] },
  { id: 'start_1', cost: 139, prereqs: ['golden_4'], effects: [['startCookies', null, 50000]] },
  { id: 'offline_1', cost: 139, prereqs: ['auto_4'], effects: [['offlineHours', null, 4]] },
  { id: 'start_2', cost: 359, prereqs: ['start_1', 'offline_1'], effects: [['startCookies', null, 950000], ['offlineHours', null, 4]] },
  { id: 'upgrade_universe', cost: 359, prereqs: ['upgrade_blackhole'], effects: [['unlockUpgrade', 'universeOven']] },
  { id: 'upgrade_godfinger', cost: 748, prereqs: ['upgrade_universe'], effects: [['unlockUpgrade', 'godFinger']] },
  { id: 'upgrade_singularity', cost: 748, prereqs: ['upgrade_universe'], effects: [['unlockUpgrade', 'cookieSingularity'], ['all', null, 0.08]] },
  { id: 'upgrade_quantum', cost: 1279, prereqs: ['upgrade_singularity'], effects: [['unlockUpgrade', 'quantumBakery']] },
  { id: 'upgrade_antimatter', cost: 2518, prereqs: ['upgrade_quantum'], effects: [['unlockUpgrade', 'antimatterOven']] },
  { id: 'master_final', cost: 2440, prereqs: ['upgrade_antimatter', 'unlock_reward_goldenBeastMutation'], effects: [['all', null, 0.35], ['click', null, 0.20], ['cps', null, 0.20], ['rewardBonus', null, 0.10]] }
];
const SKILL_BY_ID = {}; SKILL_NODES.forEach(s => SKILL_BY_ID[s.id] = s);

// 方針別「署名スキル」の相互排除は撤去(2026-07-22 ユーザー指示「仕様は消して。合格条件を追加」):
// 旧仕様は各方針に専用署名スキルを割り当て、他方針の取得順から相互排除して「その方針だけが取る」を強制していた。
// これを廃止し、方針差別化は runner `skilldiff` の合格条件(㉜)で判定する(=強制でなく自然成立を測る)。
// 空にすることで foreignSignatures は常に空集合を返す=どのスキルも排除されない(excludeForeignSignatures は無効化)。
const POLICY_SIGNATURE = {};
const ALL_SIGNATURES = new Set(Object.values(POLICY_SIGNATURE));
function foreignSignatures(stratId) {
  return new Set(); // 署名排除は撤去(㉜合格条件へ移行)
}

// QoL/解析系ノード: 生産に直接効かないノードは「直前ラングのおまけ価格」
const UTILITY_SKILLS = new Set([
  'golden_analysis', 'hunt_analysis', 'economy_analysis', 'research_analysis',
  'order_board', 'reward_synergy', 'reward_1', 'reward_choice_2',
  'start_1', 'offline_1', 'start_2', 'workshop_1', 'workshop_2',
  'eqcraft_t2', 'eqcraft_t3', 'eqcraft_t4', 'eqcraft_t5', 'eqcraft_t6',
  // 方針入口の増幅ノード(第12次R4): 価格ははしご非消費のおまけ価格。効果は固定値(fixed)
  'click_amp', 'golden_amp', 'monster_amp', 'auto_amp',
  // おまけスキル(click_stall/monster_peddler/golden_echo/ensemble)は撤去(2026-07-22 ユーザー指示)。
]);
function isUtilitySkill(id) { return UTILITY_SKILLS.has(id); }

// スキルの想定取得順(前提条件を満たす手設計順)。数値ノード・解放ノードを均等に散らす。
const SKILL_HAND_ORDER = [
  // 2026-07-06 第8次 ⑲対応v3: 取得順(=コストはしご順)。全ツリー辺のメインラング差≤5。
  // 設備解放: 月面=r12(7種設備の壁dec40を跨ぐ前)、時空=r17、以降約3ラングごとに第16種(r40)まで。
  'core', 'click_1', 'click_amp', 'golden_1', 'golden_amp', 'monster_1', 'monster_amp', 'workshop_1', 'workshop_2', 'eqcraft_t2', 'eqcraft_t3', 'eqcraft_t4', 'eqcraft_t5', 'eqcraft_t6', 'auto_1', 'auto_amp', 'economy_1',
  'click_2', 'golden_2', 'monster_2', 'auto_2', 'economy_2',
  'mastery_low',
  'click_3', 'upgrade_moon', 'auto_3', 'research_1', 'research_remodel', 'economy_analysis', 'order_board',
  'golden_3', 'golden_analysis', 'upgrade_time', 'research_analysis', 'monster_3', 'hunt_analysis',
  'auto_4', 'click_4', 'offline_1',
  'upgrade_galaxy', 'mastery_high', 'golden_4', 'start_1', 'monster_4', 'reward_1', 'reward_synergy', 'reward_choice_2', 'start_2',
  'upgrade_blackhole', 'unlock_reward_crackedFang', 'unlock_reward_goldenChain',
  'upgrade_universe', 'unlock_reward_chainPrep', 'unlock_reward_huntFocus',
  'upgrade_godfinger', 'unlock_reward_goldenTarget', 'upgrade_singularity',
  'unlock_reward_goldenFirstHit', 'unlock_reward_beastScent', 'reward_2',
  'upgrade_quantum', 'unlock_reward_biteRecovery', 'unlock_reward_brandHunt',
  'upgrade_antimatter', 'unlock_reward_beastHeatFerment', 'unlock_reward_huntingCore',
  'unlock_reward_deepPursuit', 'unlock_reward_crushedMill', 'unlock_reward_goldenBeastMutation',
  'master_final'
];

// スキルコスト(2026-07-06 第8次 ⑲対応):
// - メインノードは手設計順のはしご(rungCosts / C0×rho^k)
// - 全ツリー辺で cost(子) ≤ edgeCap(=10)×cost(親) にクランプ(⑲)。再配線済みのため通常は非発動。
// - 全コストは丸め規則(有効数字3桁=5の倍数切り捨て)を内部値にも適用
let SKILL_COST_MAP = null;
let SKILL_RANK = null;
let SKILL_RIDERS = null;
function trunc2sig(c) {
  if (!(c > 0)) return 1;
  if (c < 100) return Math.max(1, Math.floor(c));
  const d = Math.pow(10, Math.floor(Math.log10(c)) - 1);
  return Math.floor(c / d) * d;
}
// ==== 丸め規則(3-2 確定・2026-07-06): 有効数字3桁が5の倍数になるよう切り捨て ====
// 例: 123,456→120,000 / 94→90 / 768.72→765
// - 10以上: 刻み = 5×10^max(0, 桁数-3) で切り捨て(94→90 の例から最小刻みは5)+小数切り捨て
// - 10未満(スキル倍率効果値など): 有効数字3桁の刻み(5×10^(桁-3))で切り捨て(整数化はしない)
// - 対象: 設備/研究/スキルコスト・設備の基礎毎秒生産・スキル倍率効果値。工房素材コストは対象外。
function q5(v) {
  if (!(v > 0) || !Number.isFinite(v)) return v;
  const e = Math.floor(Math.log10(v));
  if (v >= 10) {
    const step = 5 * Math.pow(10, Math.max(0, e - 2));
    return Math.floor(v / step + 1e-9) * step;
  }
  const step = 5 * Math.pow(10, e - 2);
  return Math.floor(v / step + 1e-9) * step;
}
// コスト用(小数切り捨て・最低1)
function q5cost(v) { return Math.max(1, Math.floor(q5(v))); }
function buildSkillCosts() {
  if (SKILL_COST_MAP) return SKILL_COST_MAP;
  SKILL_COST_MAP = {};
  SKILL_RANK = {};
  SKILL_RIDERS = new Set();
  const have = {};
  if (SKILL_HAND_ORDER.length !== SKILL_NODES.length) throw new Error('order length mismatch');
  let rank = 0, rung = 0, prodIdx = 0;
  let lastRungCost = P.skillCost.C0;
  for (const id of SKILL_HAND_ORDER) {
    const n = SKILL_BY_ID[id];
    if (!n) throw new Error('unknown node ' + id);
    if (!n.prereqs.every(q => have[q])) throw new Error('infeasible order at ' + id);
    SKILL_RANK[id] = rank++;
    // ⑲改の辺間隔上書き(2026-07-11): 梯子リチューン(tune.js)後に辺比>10倍となった5ノードだけ
    // 個別値で上書き(はしご進行=lastRungCostは元のままなので他ノードに波及しない)。値はq5準拠・全て引き下げ方向。
    const OV = P.skillCost.overrides;
    if (isUtilitySkill(id)) {
      // QoLノードは「前提ノードのコスト」基準のおまけ価格(解放時点でほぼ即買い可能)
      const base = n.prereqs.length ? Math.max(...n.prereqs.map(q => SKILL_COST_MAP[q] || P.skillCost.C0)) : lastRungCost;
      SKILL_COST_MAP[id] = q5cost(base * (P.skillCost.utilRatio || 0.35));
    } else {
      // 相乗り段(2026-07-13 第13次): ④=1億倍(8.5桁/段)×48段=約400桁はfloat64上限(約308桁)超え。
      // rungShare本ごとに1段を共有し(share=1.45→48本≈34段=289桁)、総スパンを浮動小数の範囲に収める。
      const share = P.skillCost.rungShare || 1;
      const myRung = Math.floor(prodIdx / share);
      let tentative;
      if (P.skillCost.rungCosts && P.skillCost.rungCosts[myRung] != null) {
        tentative = P.skillCost.rungCosts[myRung];
      } else {
        tentative = P.skillCost.C0 * Math.pow(P.skillCost.rho || 4, myRung);
      }
      // 相乗り段の人数割り(2026-07-14 ④修復): 同段のスキルは段コストを人数で割る
      // =1回の転生PTで段の全スキルを買い切れる→毎転生がフル段(8.5桁)前進=④(1e8)が全ペアで立つ。
      // (人数割りしないと2本目のために同じ8.5桁を再耕作する周回が生まれ、④比×1.0のペアが交互に出る=R18実測)
      // 人数=この段に写像される生産スキルの本数(floor(i/share)==myRung の i の個数)
      const sharers = Math.floor((myRung + 1) * share) - Math.ceil(myRung * share) + (Number.isInteger(myRung * share) ? 1 : 0);
      tentative = tentative / Math.max(1, sharers);
      // ⑲改(2026-07-06 ユーザー承認・第9次): 「各ノードは少なくとも1本、コスト比10倍以内の辺で
      // 結ばれていればよい」へ変更。辺ごとのクランプは廃止(はしごコストがそのまま立つ・ライダーなし)。
      // 検証は runner.js の check19(⑲改判定)。関連効果どうしを結ぶ遠距離辺は距離自由。
      prodIdx++;
      lastRungCost = tentative;
      rung = myRung;
      SKILL_COST_MAP[id] = q5cost(tentative); // 丸め規則(有効数字3桁=5の倍数)を内部値にも適用
    }
    if (OV && OV[id] != null) SKILL_COST_MAP[id] = OV[id]; // ⑲改の個別上書き(q5準拠値)
    have[id] = true;
  }
  return SKILL_COST_MAP;
}
function skillRiders() { buildSkillCosts(); return SKILL_RIDERS; }
function skillRank(id) {
  buildSkillCosts();
  return SKILL_RANK[id];
}
function skillCostOf(node) {
  return buildSkillCosts()[node.id];
}

// ==== スキル効果値の再割り当て ====
// 生産系数値ノード(click/cps/all)には、取得順に「取るたび生産が約M倍」になる幾何級数値を割り当てる。
// その他の数値効果は fx タイプ倍率で従来値をスケール。
let SKILL_VALUES = null; // id -> {type -> value}
function buildSkillValues() {
  if (SKILL_VALUES) return SKILL_VALUES;
  SKILL_VALUES = {};
  const order = SKILL_NODES.slice().sort((a, b) => skillRank(a.id) - skillRank(b.id));
  let Sall = 0, Scps = 0, Sclick = 0;
  const Mall = P.nodeM ? P.nodeM.all : 2.5;
  const Mcps = P.nodeM ? P.nodeM.cps : 2.5;
  const Mclick = P.nodeM ? P.nodeM.click : 2.2;
  for (const n of order) {
    const vals = {};
    const types = n.effects.map(e => e[0]);
    const hasAll = types.includes('all');
    const hasCps = types.includes('cps');
    const hasClick = types.includes('click');
    // fixedノード(第12次R4・方針入口の増幅): 幾何はしご(nodeM)にもfx倍率にも割り込まず、生の値を量子化して使う。
    // Sall/Scps/Sclick(はしごの累積)にも加算しない=既存ノードの割り当て値が1つも動かない。
    if (n.fixed) {
      for (const e of n.effects) { if (typeof e[2] === 'number') vals[e[0]] = (vals[e[0]] || 0) + q5(e[2]); }
      SKILL_VALUES[n.id] = vals;
      continue;
    }
    for (const e of n.effects) {
      const t = e[0];
      if (typeof e[2] !== 'number') continue;
      if (t === 'all' && hasAll) {
        const v = q5((Mall - 1) * (1 + Scps + Sall)); // 丸め規則: スキル倍率効果値も量子化(内部値=表示値)
        vals.all = (vals.all || 0) + v;
        Sall += v;
      } else if (t === 'cps' && !hasAll) {
        const v = q5((Mcps - 1) * (1 + Scps + Sall));
        vals.cps = (vals.cps || 0) + v;
        Scps += v;
      } else if (t === 'click' && !hasAll) {
        const v = q5((Mclick - 1) * (1 + Sclick + Sall));
        vals.click = (vals.click || 0) + v;
        Sclick += v;
      } else if (t === 'cps' || t === 'click') {
        // allと同居する副次効果は元値のまま(allが主軸)
        const v = q5(e[2]);
        vals[t] = (vals[t] || 0) + v;
        if (t === 'cps') Scps += v; else Sclick += v;
      } else {
        const scale = P.fx[t] != null ? P.fx[t] : 1;
        vals[t] = (vals[t] || 0) + q5(e[2] * scale);
      }
    }
    SKILL_VALUES[n.id] = vals;
  }
  return SKILL_VALUES;
}
// ==== 2段階帯域(⑥⑦ 2026-07-06 ユーザー承認で更新): 初転生まで Y=120+8√x、初転生後 Y=1440+3√x ====
// (第10次: 初転生後の伸びの係数 8→3。24分スタートは維持)
function bandY(prestiged, x) { return prestiged ? 1440 + 3 * Math.sqrt(Math.max(0, x)) : 120 + 8 * Math.sqrt(Math.max(0, x)); }

function lg(level, rate) { return Math.pow(1 + Math.max(0, rate), Math.max(0, level)); }
// 2026-07-05 キャップ全撤廃: 所有数上限(ownCap)は撤廃(負値ガードのみ)
function capOwn(n) { return Math.max(0, n); }
function ir(level, rate) { return Math.pow(1 - Math.min(0.95, Math.max(0, rate)), Math.max(0, level)); }
// 報酬Lvの逓減: lvが大きいほど1Lvあたりの寄与が下がる(halfで半減)
// 第12次J-3(ユーザー2026-07-08): モンスター報酬の上限(飽和)を撤廃。旧 satLv は lv/(1+lv/half) で half に漸近する
// ソフト上限だった。撤廃=所持数に対して線形に伸び続ける(half は無視)。goldenRate/monsterRate は spawn 間隔が
// 1秒フロアで自己制限、goldenAmount/Power は線形、rewardCategoryBonus のみ (1+rate)^lv で指数のため要 Infinity 監視。
function satLv(lv, half) { return Math.max(0, lv); }
// ⑬タイミング: 完全放置モードの判定。idleTiming が対象キーそのもの、または全機能放置 'all' のとき真。
// 'all' は提案5(2026-07-07 承認)の全体比較用: 全タイミング機能を1本の放置ランで同時に無効化する。
function idleOn(sim, key) { const it = sim.opt.idleTiming; return it === key || it === 'all'; }

// ================= シミュレーション状態 =================
function newSim(strategy, opts) {
  return {
    strat: strategy,
    opt: Object.assign({ disableResearch: null, disableReward: null, disableStage: null, disableUpgrade: null, disableAffinity: false, idleTiming: null, trackGain: false, trackTickPower: false, hours: 100 }, opts || {}),
    t: 0,                       // 総経過秒
    // 永続
    prestige: 0, prestigeTotal: 0, prestigeRuns: 0, totalCookies: 0, lastPrestigeCps: 0,
    prevMaxStage: 0,            // 提案8: 前回周回の最高到達層(=再登坂の天井)。層の試練を新規開拓層基準へ相対化するのに使う。層数の表示・カウント(run.maxStage)は絶対累積のまま不変更。
    prevDuration: 0,            // 提案9(到達連動ノルマ): 前回周回の長さ(秒)。未達判定の進行比 ρ=経過秒/前回長 の分母。
    skills: {},
    everUpgrade: {}, everResearch: {}, everStage: {},
    unlockEvents: [],           // {t, kind, id}
    lastUnlockT: -Infinity,     // 解放ゲート(2026-07-14 ユーザー指示「開放間隔は30秒以上」)の直前解放時刻
    firstResearchBuy: {}, firstPerk: {}, firstStageBuy: {},
    runs: [],                   // 各周回の結果
    // 工房・素材・ステージ・注文(第12次P統合・転生持ち越し)
    ws: { mats: {}, eq: {}, seen: {}, everWs: {}, stageUnlocked: 1, deepLayer: 0,
      matRot: 0, orderNextT: null, order: null, orderKindRot: 0, orderRewardRot: 0,
      // 新装備システム(2026-07-13): owned=所持数(id→個数)・equipped=部位→装備id・seenEq=一度表示されたレシピ(消えない)
      eq2Owned: {}, eq2Equipped: {}, eq2Seen: {},
      // 固定クエスト(2026-07-13): フロンティアステージの累計討伐(周回を跨いで累積)
      questKills: {} },
    // 周回内
    run: null,
    rotIdx: 0, upRotIdx: 0, goldenAlt: 0,
    _fx: {}, _fxHas: {}, _stT: -1, _stV: 1, _bkT: -1, _bkV: null
  };
}

function newRun(sim) {
  const upgrades = {}; UPGRADES.forEach(u => upgrades[u.id] = 0);
  const research = {}; RESEARCH.forEach(r => research[r.id] = false);
  // 段階2/3: スキル取得後に研究購入欄へ追加され、クッキーで購入して有効化(転生でリセット)
  const research2 = {}; RESEARCH.forEach(r => research2[r.id] = false);
  const research3 = {}; RESEARCH.forEach(r => research3[r.id] = false);
  const perks = {}; REWARD_POOL.forEach(r => perks[r.id] = 0);
  const upgradePerks = {}; UPGRADES.forEach(u => upgradePerks[u.id] = 0);
  return {
    startT: sim.t,
    cookies: 0, runCookies: 0,
    upgrades, research, research2, research3, perks, upgradePerks,
    rewardCategoryCounts: { golden: 0, hunt: 0, equipment: 0, risk: 0 },
    quotaFailed: false, quotaHoldSeconds: 0, quotaMonsterKills: 0,
    quotaFailAt: null, gainSeries: null,
    lastGoldenT: sim.t, spiceBurstM: 1, spiceAromaUntil: 0, bhCharge: 0, bhUses: 0, bhBoostUntil: 0, bhBoostMult: 1, bhReadyAt: null,
    blackHoleCompressionUsed: false, blackHoleQuotaMultiplier: 1,
    maxStage: 1,
    boosts: [],                // {mult, until}
    afterheats: [],
    spiceBoostUntil: -1, portalHuntUntil: -1,
    goldenTimer: 0, monsterTimer: 0,
    goldenChainReady: false, goldenFirstHitReady: false,
    nextMonsterSpawnMultiplier: 1, nextMonsterHpMultiplier: 1, nextGoldenSpawnMultiplier: 1,
    nextRewardCountBonus: 0, huntFocusLv: 0, huntFocusRewardPenalty: 0,
    nextMonsterStayMultiplier: 1,
    monster: null,             // {typeId,level,hp,maxHp,stayLeft,goldenChainMultiplier,firstHit}
    policy: 'balanced',
    kills: 0, goldenTaken: 0,
    // モンスター種類(第9次): 決定的ローテーションの蓄積器と種類別集計
    mtAcc: {}, gbAcc: 0, killsSinceBoss: 0,
    surge: {},                 // まとめ買い割増: 設備idごとの熱量 {h, t}(購入+1、halfSecで半減)
    killsByType: {}, rewardByType: {},
    critAtBuy: undefined, critNow: 0, critMax: 0,
    chainN: 0, chainLastT: -1e15, chainMax: 0, // 討伐連鎖(第12次D): 周回内変数。転生で0
    wsStage: 0, buffs: {}, parfaitUps: {}, ordersDone: {} // 工房: 周回ステージ・料理バフ{id:untilT}・パフェ中購入設備数・注文達成{kind:n}
  };
}

// ==== モンスター種類の決定的抽選(期待値化・第9次) ====
// 重み比例の決定的ローテーション: 各種類の蓄積器に weight/総weight を足し、最大の種類を出す。
// 黄金獣: 金ブースト中は出現枠の goldenBeastShare 分を置換(確率を蓄積し1超えで発生)。
// ボス: 討伐 bossCycle 体ごとに次の出現がボス化(ゲームと同じ周期規則の期待値版)。
function pickMonsterType(sim) {
  const r = sim.run;
  const M = P.mtype;
  if (!M) return 'normal';
  if (r.killsSinceBoss >= (P.ws ? wsBossCycle(sim) : M.bossCycle)) return 'boss';
  if (goldenBoostActive(sim)) {
    r.gbAcc += M.goldenBeastShare + ((P.ws && wsStageDef(sim).gbShareAdd) || 0);
    if (r.gbAcc >= 1) {
      r.gbAcc -= 1;
      // 黄金獣も3色変種をローテーション(2026-07-13 種類3倍)
      const gv = M.goldenBeastVariants || ['goldenBeast'];
      r.gbRot = ((r.gbRot || 0) + 1) % gv.length;
      return gv[r.gbRot];
    }
  }
  const ids = Object.keys(M.weights);
  let totalW = 0; for (const id of ids) totalW += M.weights[id];
  let best = ids[0], bestV = -Infinity;
  for (const id of ids) {
    r.mtAcc[id] = (r.mtAcc[id] || 0) + M.weights[id] / totalW;
    if (r.mtAcc[id] > bestV) { bestV = r.mtAcc[id]; best = id; }
  }
  r.mtAcc[best] -= 1;
  return best;
}
// モンスターの色(強さ段)= ノルマ層で決まる確率分布(2026-07-15 ユーザー指示):
// 層が進むと「次の色(一段強い)」が低確率で出始め、層が進むほどその確率が上がり、さらに次の色が低確率で…と連鎖。
// 初期色の確率はゼロにはならない(floorW で薄く残り続ける)。色tier=1..maxC(=equip2.tiers)。
function monsterColorWeights(sim) {
  const MC = P.mcolor || {};
  const maxC = MC.maxTier || (P.equip2 && P.equip2.tiers) || 6;
  const band = MC.layerStep || (P.equip2 && P.equip2.layerBand) || 5; // 何層で色が1段進むか
  const floorW = MC.floorW != null ? MC.floorW : 0.15; // 既出の色が薄く残る下限
  const emergeW = MC.emergeW != null ? MC.emergeW : 0.30; // 次の色が出始める最大確率(1段ぶん手前で0→emergeW)
  const decay = MC.decay != null ? MC.decay : 0.6; // 深い既出色ほど薄くなる減衰
  const prog = (sim.run.maxStage || 0) / band; // 連続の色進行(層/band)
  const w = [];
  for (let c = 1; c <= maxC; c++) {
    const d = prog - (c - 1); // この色の出始め(c-1)からどれだけ進んだか
    if (d < -1) w.push(0);                                   // 2段以上先の色: まだ出ない
    else if (d < 0) w.push(emergeW * (1 + d));               // 次の色: 低確率で出始め、進むほど上がる
    else w.push(floorW + (1 - floorW) * Math.pow(decay, d)); // 既出の色: floor以上で残る(ゼロにならない)
  }
  return w;
}
// 決定的な色抽選(simは乱数を使わない=蓄積器方式)
function pickColorTier(sim) {
  const r = sim.run;
  // 重みは maxStage(ノルマ層)が変わった時だけ再計算(毎spawnの再計算を避ける=perf)
  if (r._colorWStage !== r.maxStage || !r._colorW) { r._colorW = monsterColorWeights(sim); r._colorWStage = r.maxStage; }
  const w = r._colorW;
  if (!r.colorAcc) r.colorAcc = [];
  let tot = 0; for (const x of w) tot += x;
  if (tot <= 0) return 1;
  let best = 1, bestV = -Infinity;
  for (let c = 1; c <= w.length; c++) {
    r.colorAcc[c] = (r.colorAcc[c] || 0) + w[c - 1] / tot;
    if (r.colorAcc[c] > bestV) { bestV = r.colorAcc[c]; best = c; }
  }
  r.colorAcc[best] -= 1;
  return best;
}
// 種類×報酬カテゴリの相性倍率(条件㉔の「その回だけ無効」= すべて×1.0)
function affinityOf(sim, typeId, category) {
  if (sim.opt.disableAffinity) return 1;
  const M = P.mtype;
  const row = M && M.affinity && M.affinity[typeId];
  return (row && row[category] != null) ? row[category] : 1;
}

// ================= 工房・素材・ステージ・注文ボード(第12次P・WORKSHOP_SPEC v1〜v4統合) =================
// 素材はクッキーと交差しない(期待値の小数個で保持)。効果は相対型のみ。
// 計測ゲート: wsOff(sim,'dish:xxx'/'eq:xxx'/'order:xxx') で単体無効化(⑮の2・㉙の枝分かれ判定用)。
function wsOff(sim, key) {
  return sim.opt.disableWs === key || sim._md === 'ws:' + key || !!(sim._mdSet && sim._mdSet.has('ws:' + key));
}
function wsUnlocked(sim) { return hasSkillEffect(sim, 'unlockSystem', 'workshop1'); }
function wsEqUnlocked(sim) { return hasSkillEffect(sim, 'unlockSystem', 'workshop2'); }
// 現在の周回ステージ定義(未選択=最初のtickで方針に応じて選択)
function wsStageDef(sim) {
  const no = (sim.run && sim.run.wsStage) || 1;
  return P.ws.stages[Math.min(no, 6) - 1];
}
function wsStageNo(sim) { return (sim.run && sim.run.wsStage) || 1; }
// ステージ選択(v3 §13: 転生時に選択・周回中固定)。素材が偏らないよう方針で好みを分ける:
// hunt/bake=最前線(レア・核)/golden=金の砂丘(S4)以深/click=こつぶの多い低ステージ周回/balanced=順繰り。
function wsPickStage(sim) {
  const un = sim.ws.stageUnlocked;
  const pol = sim.run.policy;
  if (un <= 1) return 1;
  if (pol === 'click') return Math.max(1, Math.min(un, 1 + (sim.prestigeRuns % Math.min(un, 3))));
  if (pol === 'golden') return Math.min(un, Math.max(4, un - 1) <= un ? Math.min(4, un) : un);
  if (pol === 'balanced') return 1 + (sim.prestigeRuns % un);
  // hunt/bake=最前線。ただし深層(S6)は層HPが高く周回序盤の討伐が枯れるため1周おき。
  // さらに4周に1回は素材遠征(S2=黒鉄の欠片など下位ステージ専属素材の補給。図鑑/手袋の育成が
  // ironShard 涸れで止まる=実測)。⑯(素材→最適ステージ4分散)の遊び方そのもの。
  if (un >= 6) {
    const m = sim.prestigeRuns % 4;
    return m === 0 ? 6 : m === 1 ? 5 : m === 2 ? Math.min(un, 2 + (sim.prestigeRuns % 8 >= 4 ? 1 : 0)) : 5;
  }
  return un;
}
function wsBuffActive(sim, id) {
  const r = sim.run;
  return !wsOff(sim, 'dish:' + id) && r.buffs && (r.buffs[id] || 0) > sim.t;
}
function wsEqLv(sim, id) {
  if (wsOff(sim, 'eq:' + id)) return 0;
  return (sim.ws.eq && sim.ws.eq[id]) || 0;
}
function wsAddMat(sim, id, n) {
  if (!(n > 0)) return;
  const ws = sim.ws;
  ws.mats[id] = (ws.mats[id] || 0) + n;
  if (!ws.seen[id]) ws.seen[id] = true;
}
// レシピの開示ステージ = 構成素材の入手先ステージの最大(黄金粉・ボス核・万能粉は全ステージ入手可=1)。
// 開示イベントは「その素材の入手先(ステージ)が拓けた瞬間」に出す=ステージ解放・スキル取得と同一秒に
// 統合される(T2対策 2026-07-10: 素材の初入手タイミングだと周回中盤に単独イベントとして散らばり、
// 貯蓄型S7などで解放が4-5件/周回に膨らむ=実測。開示が先・調理は素材が揃ってから、はゲームとして自然)。
function wsRecipeRevealStage(rc) {
  let s = 1;
  for (const k in rc.cost) {
    let m = 1;
    for (const st of P.ws.stages) { if ((st.c || []).includes(k) || (st.r || []).includes(k)) { m = st.no; break; } }
    if (k === 'goldDust' || k === 'bossCore' || k === 'universal') m = 1;
    s = Math.max(s, m);
  }
  return s;
}
function wsRevealRecipes(sim) {
  if (!wsUnlocked(sim)) return;
  const ws = sim.ws;
  for (const rc of P.ws.recipes) {
    if (ws.everWs['recipe:' + rc.id]) continue;
    if (!unlockGateOk(sim)) break;
    if (wsRecipeRevealStage(rc) <= ws.stageUnlocked) {
      ws.everWs['recipe:' + rc.id] = true;
      pushUnlock(sim, 'ws', 'recipe:' + rc.id);
    }
  }
}
function wsCanAfford(sim, cost, mul) {
  const m = (mul || 1) * (P.ws.costMul || 1);
  const uni = sim.ws.mats.universal || 0; // 万能粉: 任意素材の代替・2倍換算
  let uniNeed = 0;
  for (const k in cost) {
    const need = cost[k] * m;
    const have = sim.ws.mats[k] || 0;
    if (have < need) {
      if (k === 'bossCore' || k === 'voidSugar') return false; // 核・虚空糖は代替不可
      uniNeed += (need - have) * 2;
      if (uniNeed > uni) return false;
    }
  }
  return true;
}
function wsConsume(sim, cost, mul) {
  const m = (mul || 1) * (P.ws.costMul || 1);
  for (const k in cost) {
    const need = cost[k] * m;
    const have = sim.ws.mats[k] || 0;
    const used = Math.min(have, need);
    sim.ws.mats[k] = have - used;
    if (need > used) sim.ws.mats.universal = Math.max(0, (sim.ws.mats.universal || 0) - (need - used) * 2);
  }
}
// 方針ごとの料理・装備の好み(自然なプレイ: 主役を伸ばす品を優先)
const WS_DISH_PREF = {
  bake: ['butterCookie', 'stardustParfait', 'frostCake'],
  click: ['chocoFondant', 'butterCookie', 'frostCake'],
  golden: ['mintIce', 'butterCookie', 'frostCake'],
  hunt: ['hunterStew', 'voidTart', 'butterCookie'],
  balanced: ['butterCookie', 'mintIce', 'hunterStew']
};
const WS_EQ_PREF = {
  // 名匠の天板(全生産)はどの方針にも魅力があるが、主役装備(自分の稼ぎ口を伸ばすもの)の次に育てる
  bake: ['ovenMitt', 'masterTray', 'stillFlask', 'dimensionCompass', 'monsterAlmanac', 'goldenWhisk', 'pressExtractor'],
  click: ['goldenWhisk', 'stillFlask', 'masterTray', 'monsterAlmanac', 'ovenMitt', 'pressExtractor', 'dimensionCompass'],
  golden: ['pressExtractor', 'goldenWhisk', 'masterTray', 'stillFlask', 'dimensionCompass', 'ovenMitt', 'monsterAlmanac'],
  hunt: ['monsterAlmanac', 'dimensionCompass', 'masterTray', 'ovenMitt', 'stillFlask', 'pressExtractor', 'goldenWhisk'],
  balanced: ['stillFlask', 'masterTray', 'monsterAlmanac', 'goldenWhisk', 'ovenMitt', 'pressExtractor', 'dimensionCompass']
};
// ==== 新装備システム(2026-07-13 ユーザー確定仕様) ====
// 9部位(武器/盾/防具上/防具下/手/帽子/靴/アクセ×2枠)の付け替え式。工房スキル不要=最初から解放。
// 効果=全生産×(allMulPerTier^ティア)の固定倍率。素材=色素材ore_t*(モンスターの色=ノルマ層帯)+ステージ素材。
// レシピ=前ティア同カテゴリ装備1個+素材(1〜5種の枠内)。一度表示(素材が揃った)されたレシピは消えない。
const EQUIP2_SLOTS = ['weapon', 'shield', 'armorTop', 'armorBottom', 'hands', 'hat', 'shoes', 'accA', 'accB'];
const EQUIP2_CATS = ['weapon', 'shield', 'armorTop', 'armorBottom', 'hands', 'hat', 'shoes', 'accA', 'accB']; // アクセは2カテゴリ(甲/乙)=9カテゴリ×各54種(2026-07-14)
// カテゴリの素材パレット(2026-07-14 特色レシピ): 武器=戦闘系素材・アクセ甲=金系…とカテゴリで顔が違う
// 並びは入手時期順(先頭=序盤素材)。ティアtで使えるのは先頭からmax(1,t-1)種まで=低ティアは序盤素材のみ
const EQUIP2_MAT_PALETTE = {
  weapon: ['flour', 'lavaSugar', 'ironShard', 'silentCore'],
  shield: ['butter', 'ironShard', 'frostSugar', 'silentCore'],
  armorTop: ['butter', 'flour', 'cacao', 'stardust'],
  armorBottom: ['flour', 'lavaSugar', 'spice', 'cometShard'],
  hands: ['butter', 'ironShard', 'mint', 'goldDust'],
  hat: ['flour', 'mint', 'frostSugar', 'stardust'],
  shoes: ['butter', 'lavaSugar', 'silentCore', 'cometShard'],
  accA: ['flour', 'goldDust', 'spice', 'stardust'],
  accB: ['butter', 'mint', 'silentCore', 'goldDust']
};
let EQUIP2_ITEMS = null, EQUIP2_BY_ID = null;
function equip2Items() {
  if (EQUIP2_ITEMS) return EQUIP2_ITEMS;
  const E = P.equip2; EQUIP2_ITEMS = [];
  if (!E) return EQUIP2_ITEMS;
  // 9カテゴリ×各54種(2026-07-14 ユーザー確認「装備は9カテゴリそれぞれで54種?」→各カテゴリ54種に拡張):
  // 各カテゴリ = 6ティア(ステージ連動)× 9バリエーション(色銘: 銅/銀/金/翠/蒼/紅/紫/白/黒)。
  // 効果の本体はティア(全生産×allMulPerTier^t)・バリエーションは色素材の配合違い(横持ち)。
  // 合成連鎖は同バリエーションの前ティアを消費。バリエーション1(v1)は下位色素材のみ=入口。
  const VARIANTS = E.variants || 9;
  // ステージ配置のばらけ(2026-07-14 ユーザー指示「もっとカテゴリとレベルをばらけさせて。
  // 後半が強いのは傾向でいいが完全にはしない。他のステージと同じやつが作れてもいい」):
  // 主ステージ = clamp(ティア + 散らしオフセット(-2..+2), 1..6)=傾向は保ちつつ混ざる。
  // v%3==0 のアイテムは隣のステージでも作れる(2ステージ重複)。
  const OFFSETS = [-2, -1, -1, 0, 0, 0, 1, 1, 2]; // v1..v9(中心=同ティア・傾向維持)
  const clampSt = x => Math.max(1, Math.min(E.tiers, x));
  // 強さ順コスト(R18 2026-07-17 ユーザー指示「装備全着用も調整でどうにかして」): 同カテゴリ内の色銘を
  // 中立強度(単位重み×効果値・C型は状況頻度割引)で順位づけし、素材コストを弱⇒安/強⇒高に並べる。
  // 従来はコストが強さと無相関=プレイヤーは最強の作れる色銘を最初に作って着るため、弱い色銘に出番がなかった。
  // 強い色銘ほど素材が重いと、各ティア時代の序盤は弱い色銘しか作れず自然に着て、素材が貯まったら強い色銘へ
  // 着替える(同ティア非減の規則どおり)=「改善の瞬間」が増えて自然プレイの着用種類が伸びる。
  const strengthOf = (cat, v) => {
    const def = EQUIP2_FX[cat] && EQUIP2_FX[cat][v - 1];
    if (!def) return 0;
    let s = 0; const u = def.up || [];
    for (let i = 0; i < u.length; i += 2) s += (EQ2_UNIT[u[i]] || 0.3) * u[i + 1];
    if (def.m === 'C') s *= (EQ2_CONDFREQ[def.cond] || 0.2);
    return s;
  };
  const costRank = {}; // cat -> v -> 0..8(弱い順)
  for (const cat of EQUIP2_CATS) {
    const order = Array.from({ length: VARIANTS }, (_, i) => i + 1).sort((a, b) => strengthOf(cat, a) - strengthOf(cat, b));
    costRank[cat] = {}; order.forEach((v, i) => { costRank[cat][v] = i; });
  }
  for (let t = 1; t <= E.tiers; t++) {
    for (const cat of EQUIP2_CATS) {
      const ci = EQUIP2_CATS.indexOf(cat);
      for (let v = 1; v <= VARIANTS; v++) {
        const id = `${cat}_t${t}_v${v}`;
        const st1 = clampSt(t + OFFSETS[(v - 1 + ci) % 9]); // カテゴリで散らし位相をずらす
        const stages = [st1];
        if (v % 3 === 0) stages.push(clampSt(st1 + (v % 2 === 0 ? 1 : -1))); // 重複ステージ
        const stDef = P.ws.stages[Math.min(st1, P.ws.stages.length) - 1];
        const smatA = (stDef.c && stDef.c[0]) || 'butter';
        const smatB = (stDef.c && stDef.c[1]) || smatA;
        // 特色レシピ(2026-07-14 ユーザー指示「必要素材もそれぞれ特色のあるように。おんなじようなのばっかにしない」):
        // v1=色素材のみ(色と個数は品で変化・全ステージ作成保証の土台)。v2+はカテゴリの素材パレット+
        // ステージ素材+色素材を、種類数1〜5・個数1〜6のパターンで組む。レア(ボス核/虚空糖)は高ティアの隠し味。
        const PAL = EQUIP2_MAT_PALETTE[cat];
        const oreTier = Math.max(1, Math.min(E.tiers, t + ((v % 3) - 1))); // 色素材の色も品で変える
        // 個数は上限なし(2026-07-14 ユーザー指示「一つの必要素材は個数の上限なくて良い」): ティアで伸びる
        const bulk = Math.max(1, Math.round(Math.pow(1.8, t - 1))); // t1=1 … t6=19(大口要求の基準)
        const cost = { ['ore_t' + oreTier]: (2 + ((t + v) % 4)) * (v % 4 === 2 ? bulk : 1) }; // 個数2〜5
        if (v >= 2) {
          const span = Math.max(1, Math.min(PAL.length, t - 1)); // ティアで素材解禁(t1-2=序盤素材のみ)
          const m1 = PAL[(v + t) % span];
          cost[m1] = (cost[m1] || 0) + (1 + ((v * t) % 5)) * (v % 4 === 3 ? bulk : 1); // 大口素材は品による(上限なし) // 個数1〜5
          if (v >= 4 && t >= 3) { const m2 = PAL[(v + t + 2) % span]; if (m2 !== m1) cost[m2] = (cost[m2] || 0) + 1 + ((v + t) % 3); }
          if (v >= 7 && t >= 3) { const m3 = v % 2 === 0 ? smatA : smatB; cost[m3] = (cost[m3] || 0) + 2; }
          if (v === 9 && t >= 5) cost[t === 6 ? 'voidSugar' : 'bossCore'] = 1 + (t === 6 ? 1 : 0); // 最高級の隠し味
        }
        // レシピは固定(2026-07-14 ユーザー明確化「必要装備素材はゲーム内固定。固定の中身が裁量」):
        // 色銘2,3,5,8=前ティア装備を要求する合成レシピ / 色銘1,4,6,7,9=素材のみのレシピ(固定・実行時の代替なし)
        const hasPrevRecipe = t > 1 && [2, 3, 5, 8].includes(v);
        // 強さ順コスト係数: 弱(rank0)=×0.35 … 強(rank8)=×3.0
        const cm = 0.35 + 0.33 * costRank[cat][v]; // 幅を拡大(×0.35〜×3.0): ×0.5〜2.1では作成の時間差が1周回未満で着用が増えなかった
        for (const k in cost) cost[k] = Math.max(1, Math.round(cost[k] * cm));
        EQUIP2_ITEMS.push({ id, cat, tier: t, variant: v, stages, stageNo: st1, prev: hasPrevRecipe ? `${cat}_t${t - 1}_v${v}` : null, cost });
      }
    }
  }
  // 合成連鎖は「前ティアがどこかの共通ステージで作れる」場合のみ要求。そうでなければ素材のみレシピ
  // (ユーザー許可「装備がなかったり素材がなかったりしてもいい」)
  const byId = {};
  for (const it of EQUIP2_ITEMS) byId[it.id] = it;
  for (const it of EQUIP2_ITEMS) {
    if (!it.prev) continue;
    const pv = byId[it.prev];
    if (!pv) { it.prev = null; continue; }
    // 前ティアが自分と同じステージ帯(±1)で作れないなら連鎖なし=素材のみ
    const near = it.stages.some(a => pv.stages.some(b => Math.abs(a - b) <= 1));
    if (!near) it.prev = null;
  }
  // 保証: 各(ステージ,カテゴリ)に作成可能アイテム≥2(毎周回全カテゴリ作成の成立条件)
  for (let st = 1; st <= E.tiers; st++) {
    for (const cat of EQUIP2_CATS) {
      // 色素材のみ(v1)の品を各(ステージ,カテゴリ)に必ず置く(≥2判定より先=序盤でも毎周回全カテゴリが立つ)
      if (!EQUIP2_ITEMS.some(it => it.cat === cat && it.variant === 1 && it.stages.includes(st))) {
        const v1s = EQUIP2_ITEMS.filter(it => it.cat === cat && it.variant === 1)
          .sort((a, b) => Math.abs(a.tier - st) - Math.abs(b.tier - st));
        if (v1s[0]) v1s[0].stages.push(st);
      }
      const have = EQUIP2_ITEMS.filter(it => it.cat === cat && it.stages.includes(st));
      if (have.length >= 2) continue;
      const cands = EQUIP2_ITEMS.filter(it => it.cat === cat && !it.stages.includes(st))
        .sort((a, b) => ((a.variant === 1 ? 0 : 1) - (b.variant === 1 ? 0 : 1)) || (Math.abs(a.tier - st) - Math.abs(b.tier - st)));
      for (let k = 0; k < cands.length && have.length + k < 2; k++) cands[k].stages.push(st);
    }
  }
  return EQUIP2_ITEMS;
}
function equip2ById(id) {
  if (!EQUIP2_BY_ID) { EQUIP2_BY_ID = {}; for (const it of equip2Items()) EQUIP2_BY_ID[it.id] = it; }
  return EQUIP2_BY_ID[id];
}
// ==== 装備効果レジストリ(2026-07-14 ユーザー指示「効果は全部変えて・複数効果も・同じ効果は二つ作らない」) ====
// カテゴリ=効果の角度・色銘(v1-9)=角度内の効果種・ティア=数値スケール(×2^(t-1))。
// v7-8=2効果・v9=3効果の複合。486種すべて(種類,数値)の組が一意。
// 効果タイプ: clickMul/cpsMul/allMul(生産倍率) dmgMul/killValMul/spawnMul/stayMul(討伐)
//   goldenAmtMul/goldenRateMul/goldenBoostMul(金) quotaSlow(ノルマ減速) upDisc/resDisc(割引・上限0.5)
//   dropMul(素材) oreAdd(色素材+n/体) rewardLvAdd(報酬Lv+) critAdd(会心率+・上限0.3)
// 装備効果=固定値のA/B/Cモデル(2026-07-15 ユーザー承認): 数(設備数等)には連動しない。
// m=モデル A(素直な固定上昇)/B(トレードオフ=up固定↑・down固定↓)/C(状況起動=condのon/off時だけup)。
// up=ティア連動効果[stat,base,...](×1.5^(t-1))。down=B型の固定ペナルティ[stat,factor,...](ティア非連動)。cond=C型の状況。
const EQUIP2_FX = {
  weapon: [
    { m: 'A', up: ['dmgMul', 0.9] }, { m: 'A', up: ['critAdd', 0.04] }, { m: 'A', up: ['killValMul', 0.7] },
    { m: 'B', up: ['dmgMul', 1.6], down: ['goldenAmtMul', 0.85] }, { m: 'B', up: ['critAdd', 0.09], down: ['killValMul', 0.9] }, { m: 'B', up: ['killValMul', 1.4], down: ['dmgMul', 0.9] },
    { m: 'C', cond: 'boss', up: ['dmgMul', 3] }, { m: 'C', cond: 'monster', up: ['critAdd', 0.22] }, { m: 'C', cond: 'goldenBoost', up: ['dmgMul', 2, 'killValMul', 1] }
  ],
  shield: [
    { m: 'A', up: ['holdBonus', 0.5] }, { m: 'A', up: ['stayMul', 0.30] }, { m: 'A', up: ['critAdd', 0.03] },
    { m: 'B', up: ['holdBonus', 0.9], down: ['clickMul', 0.9] }, { m: 'B', up: ['cpsMul', 0.6], down: ['dmgMul', 0.9] }, { m: 'B', up: ['stayMul', 0.5], down: ['goldenAmtMul', 0.9] },
    { m: 'C', cond: 'quotaHold', up: ['holdBonus', 1.0] }, { m: 'C', cond: 'deep', up: ['cpsMul', 0.5] }, { m: 'C', cond: 'quotaHold', up: ['holdBonus', 0.4, 'critAdd', 0.05] }
  ],
  armorTop: [
    { m: 'A', up: ['cpsMul', 1.0] }, { m: 'A', up: ['allMul', 0.5] }, { m: 'A', up: ['dropMul', 0.4] },
    { m: 'B', up: ['cpsMul', 1.6], down: ['dmgMul', 0.9] }, { m: 'B', up: ['allMul', 0.8], down: ['clickMul', 0.9] }, { m: 'B', up: ['cpsMul', 1.3], down: ['goldenAmtMul', 0.9] },
    { m: 'C', cond: 'quotaHold', up: ['cpsMul', 1.0] }, { m: 'C', cond: 'deep', up: ['allMul', 0.6] }, { m: 'C', cond: 'buyUp', up: ['cpsMul', 1.5] }
  ],
  armorBottom: [
    { m: 'A', up: ['upDisc', 0.08] }, { m: 'A', up: ['resDisc', 0.08] }, { m: 'A', up: ['cpsMul', 0.6] },
    { m: 'B', up: ['upDisc', 0.15], down: ['dmgMul', 0.9] }, { m: 'B', up: ['resDisc', 0.15], down: ['clickMul', 0.92] }, { m: 'B', up: ['cpsMul', 0.9, 'upDisc', 0.06], down: ['dmgMul', 0.9] },
    { m: 'C', cond: 'quotaHold', up: ['upDisc', 0.20] }, { m: 'C', cond: 'deep', up: ['resDisc', 0.20] }, { m: 'C', cond: 'runStart', up: ['allMul', 0.5] }
  ],
  hands: [
    { m: 'A', up: ['clickMul', 1.0] }, { m: 'A', up: ['critValMul', 0.6] }, { m: 'A', up: ['clickMul', 0.7, 'critAdd', 0.05] },
    { m: 'B', up: ['clickMul', 1.6], down: ['goldenAmtMul', 0.9] }, { m: 'B', up: ['critAdd', 0.07], down: ['killValMul', 0.9] }, { m: 'B', up: ['clickMul', 1.3], down: ['goldenAmtMul', 0.9] },
    { m: 'C', cond: 'monster', up: ['clickMul', 2.5] }, { m: 'C', cond: 'goldenBoost', up: ['critAdd', 0.20] }, { m: 'C', cond: 'monster', up: ['clickMul', 2, 'dmgMul', 0.5] }
  ],
  hat: [
    { m: 'A', up: ['resDisc', 0.10] }, { m: 'A', up: ['allMul', 0.45] }, { m: 'A', up: ['cpsMul', 0.8] },
    { m: 'B', up: ['allMul', 0.8], down: ['dmgMul', 0.9] }, { m: 'B', up: ['resDisc', 0.16], down: ['goldenAmtMul', 0.9] }, { m: 'B', up: ['allMul', 0.6, 'resDisc', 0.06], down: ['clickMul', 0.9] },
    { m: 'C', cond: 'buyRes', up: ['allMul', 1.0] }, { m: 'C', cond: 'deep', up: ['allMul', 0.6] }, { m: 'C', cond: 'quotaHold', up: ['holdBonus', 0.5, 'resDisc', 0.08] }
  ],
  shoes: [
    // ドロップ系ボーナスのバリエーション(2026-07-15): dropMul=倍率 / dropRateAdd=素の落ちやすさ+ / dropLuck=固定確率で+1個 / oreAdd=色素材+ / spawnMul=出現+
    { m: 'A', up: ['dropMul', 0.5] }, { m: 'A', up: ['dropRateAdd', 0.04] }, { m: 'A', up: ['dropLuck', 0.06] },
    { m: 'B', up: ['dropMul', 1.0], down: ['killValMul', 0.9] }, { m: 'B', up: ['dropRateAdd', 0.08], down: ['killValMul', 0.9] }, { m: 'B', up: ['oreAdd', 3], down: ['goldenAmtMul', 0.9] },
    { m: 'C', cond: 'boss', up: ['dropMul', 3] }, { m: 'C', cond: 'monster', up: ['dropLuck', 0.15] }, { m: 'C', cond: 'goldenBoost', up: ['dropRateAdd', 0.12, 'spawnMul', 0.06] }
  ],
  accA: [
    { m: 'A', up: ['goldenAmtMul', 1.0] }, { m: 'A', up: ['goldenRateMul', 0.15] }, { m: 'A', up: ['goldenBoostMul', 0.4] },
    { m: 'B', up: ['goldenAmtMul', 1.6], down: ['dmgMul', 0.9] }, { m: 'B', up: ['goldenRateMul', 0.22], down: ['killValMul', 0.9] }, { m: 'B', up: ['goldenBoostMul', 0.6], down: ['clickMul', 0.9] },
    { m: 'C', cond: 'goldenBoost', up: ['allMul', 1.5] }, { m: 'C', cond: 'deep', up: ['goldenAmtMul', 0.6] }, { m: 'C', cond: 'goldenBoost', up: ['goldenAmtMul', 2, 'goldenBoostMul', 0.3] }
  ],
  accB: [
    { m: 'A', up: ['rewardLvAdd', 2] }, { m: 'A', up: ['killValMul', 0.6] }, { m: 'A', up: ['rewardLvAdd', 1, 'killValMul', 0.4] },
    { m: 'B', up: ['rewardLvAdd', 4], down: ['goldenAmtMul', 0.9] }, { m: 'B', up: ['killValMul', 1.5], down: ['dmgMul', 0.9] }, { m: 'B', up: ['rewardLvAdd', 3], down: ['clickMul', 0.9] },
    { m: 'C', cond: 'boss', up: ['rewardLvAdd', 6] }, { m: 'C', cond: 'monster', up: ['killValMul', 2.5] }, { m: 'C', cond: 'goldenBoost', up: ['rewardLvAdd', 3, 'killValMul', 1] }
  ]
};
const EQUIP2_FLATCAP = { critAdd: 0.3, upDisc: 0.5, resDisc: 0.5 };
// 装備の方針適合スコア(2026-07-15): A/B/C固定モデルでは「方針が価値を置くステータスに合う装備」を選ばないと
// B(トレードオフ)の下げが効いてlift(a)が壊れる(R22実測min0.31)。方針の得意ステータスへの寄与でスコア化し、
// 下げは「その方針が使わないステータスなら軽い」=Bの下げが遊びに合わない所へ落ちる。C型は状況頻度で割引。
const EQ2_UNIT = { cpsMul: 1, allMul: 1.2, clickMul: 0.9, dmgMul: 0.7, killValMul: 0.7, holdBonus: 0.8, goldenAmtMul: 0.9, goldenRateMul: 2.5, goldenBoostMul: 1.5, dropMul: 0.3, oreAdd: 0.1, rewardLvAdd: 0.2, critAdd: 6, critValMul: 0.8, upDisc: 3, resDisc: 3, spawnMul: 2, stayMul: 1, dropRateAdd: 0.05, dropLuck: 0.1 };
const EQ2_FAV = {
  // ※balancedのfavセット追加は撤回(2026-07-17): 選好の激変で装備一式が入れ替わり㉘balancedが5/9→1/9に
  // 崩れた。代わりにfav無し方針のB代償を一様×4(下のequip2Score)=毒装備(killVal×0.9等)だけ弾き構成は温存。
  bake: new Set(['cpsMul', 'allMul', 'holdBonus', 'upDisc', 'resDisc']),
  click: new Set(['clickMul', 'critAdd', 'critValMul', 'allMul']),
  golden: new Set(['goldenAmtMul', 'goldenRateMul', 'goldenBoostMul', 'allMul']),
  hunt: new Set(['dmgMul', 'killValMul', 'rewardLvAdd', 'stayMul', 'spawnMul', 'allMul', 'oreAdd', 'goldenAmtMul'])
};
const EQ2_CONDFREQ = { goldenBoost: 0.15, monster: 0.4, boss: 0.06, quotaHold: 0.8, deep: 0.3, buyUp: 0.12, buyRes: 0.10, runStart: 0.12 };
const EQ2_DOWN_W = { dmgMul: 3, goldenAmtMul: 4 }; // B代償の複利重み(2026-07-18 R27): 層進行ステータスの下げは線形評価だと過小(実被害は複利)
// 装備の好み(R17 2026-07-17 ユーザー指示「プレイ方針を(シミュ条件を考慮せず)追加」):
// 戦略ごとの装備選好。fav=価値を置くステータス集合 / bAversion=B型の得意ステータス代償への嫌悪(既定6・
// リスク愛好家は低い/堅実家は高い) / cFreqMul=C型状況頻度への楽観(既定1・状況を使いこなす人は高い)。
// eq2Taste未定義の戦略(S1-S9)は従来どおり方針の既定選好(EQ2_FAV)=既存経済は完全不変。
function eq2TasteOf(sim) { return (sim.strat && sim.strat.eq2Taste) || null; }
function equip2Rel(sim, pol, stat) {
  const t = eq2TasteOf(sim);
  if (t && t.fav) {
    if (stat === 'cpsMul' || stat === 'allMul') return t.fav.has(stat) ? 1 : 0.8; // 生産は土台=誰でも0.8
    return t.fav.has(stat) ? 1 : 0.2;
  }
  if (stat === 'cpsMul' || stat === 'allMul') return 0.8;
  const f = EQ2_FAV[pol]; if (!f) return 0.7; return f.has(stat) ? 1 : 0.2;
} // cps/allは土台=全方針で重視
function equip2Score(sim, it) {
  // equip2Scoreは(戦略, 方針, 装備種)だけで決まりtick非依存(EQ2_CONDFREQは定数の頻度)=周回内不変。
  // 毎tickの装備作成ソートで大量に呼ばれるため装備オブジェクト上にメモ化(戦略/方針が変わった時だけ再計算)。
  // (perf 2026-07-16: 旧・毎tick再計算がホットパス最上位だった)
  const pol0 = sim.run.policy || 'balanced';
  const key = (sim.strat ? sim.strat.id : '') + ':' + pol0;
  if (it._scKey === key) return it._sc;
  const def = EQUIP2_FX[it.cat] && EQUIP2_FX[it.cat][(it.variant || 1) - 1];
  if (!def) { it._scKey = key; it._sc = 0; return 0; }
  const pol = pol0;
  const taste = eq2TasteOf(sim);
  const scale = Math.pow(1.5, it.tier - 1);
  let s = 0;
  const u = def.up || [];
  for (let i = 0; i < u.length; i += 2) s += (EQ2_UNIT[u[i]] || 0.3) * u[i + 1] * scale * equip2Rel(sim, pol, u[i]);
  // B型の下げ: プレイヤーが価値を置くステータスへの下げは重く罰する(=得意分野を削るB装備を選ばない=lift(a)を守る)。
  // 嫌悪係数はbAversion(既定6)・使わないステータスへの下げ×0.3(ほぼ無害)。
  // EQ2_DOWN_W(2026-07-18 R27): 層進行に効くステータス(dmgMul)の代償は線形でなく複利で痛い
  // (攻撃減→層遅れ→全収入沈下。S11のarmorTop_t2_v6束=実測0.408の正体)=代償側だけ追加重み。
  if (def.m === 'B' && def.down) for (let i = 0; i < def.down.length; i += 2) {
    const st = def.down[i];
    const favSet = (taste && taste.fav) || EQ2_FAV[pol];
    const fav = favSet && favSet.has(st);
    s -= (EQ2_UNIT[st] || 0.3) * (EQ2_DOWN_W[st] || 1) * (1 - def.down[i + 1]) * (fav ? ((taste && taste.bAversion != null) ? taste.bAversion : 6) : (favSet ? 0.3 : 4)); // fav無し方針(balanced)は一様×4(2026-07-17: 何でも使う=何の代償も痛い。kvM経済でkillVal×0.9の初装着束比0.348の毒を弾く)
  }
  if (def.m === 'C') s *= Math.min(1, (EQ2_CONDFREQ[def.cond] || 0.2) * ((taste && taste.cFreqMul) || 1));
  it._scKey = key; it._sc = s;
  return s;
}
// C型の状況(on/off・数連動ではない)。sim/ゲーム共通で読める信号のみ。
function equip2CondOn(sim, cond) {
  const r = sim.run;
  switch (cond) {
    case 'goldenBoost': return goldenBoostActive(sim);
    case 'monster': return !!r.monster;
    case 'boss': return !!(r.monster && r.monster.typeId === 'boss');
    case 'quotaHold': return !r.quotaFailed;
    case 'deep': return (r.maxStage || 0) >= 5;
    case 'buyUp': return sim.t - (r._lastUpBuyT || -1e9) < 10;
    case 'buyRes': return sim.t - (r._lastResBuyT || -1e9) < 10;
    case 'runStart': return (sim.t - r.startT) < 60;
    default: return true;
  }
}
// 集約: 装備中9部位の効果を1つの束に。C型は状況依存のためtick+装備署名でキャッシュ。ティア=×1.5^(t-1)。
function equip2Fx(sim) {
  const ws = sim.ws;
  const eqSig = EQUIP2_SLOTS.map(s => ws.eq2Equipped[s] || '').join(',');
  if (ws._eq2FxT === sim.t && ws._eq2FxSig === eqSig && ws._eq2FxCache) return ws._eq2FxCache;
  const fx = { clickMul: 1, cpsMul: 1, allMul: 1, dmgMul: 1, killValMul: 1, spawnMul: 1, stayMul: 1,
    goldenAmtMul: 1, goldenRateMul: 1, goldenBoostMul: 1, holdBonus: 1, quotaSlow: 0, upDisc: 0, resDisc: 0,
    dropMul: 1, oreAdd: 0, rewardLvAdd: 0, critAdd: 0, critValMul: 1, dropRateAdd: 0, dropLuck: 0 };
  const put = (type, v) => {
    if (type === 'oreAdd' || type === 'rewardLvAdd' || type === 'dropRateAdd' || type === 'dropLuck') fx[type] += v; // 加算系(ドロップ率+/固定確率+数)
    else if (EQUIP2_FLATCAP[type] != null) fx[type] = Math.min(EQUIP2_FLATCAP[type], fx[type] + Math.min(0.5, v));
    else fx[type] *= 1 + v;
  };
  for (const slot of EQUIP2_SLOTS) {
    const it = ws.eq2Equipped[slot] ? equip2ById(ws.eq2Equipped[slot]) : null;
    if (!it) continue;
    const def = EQUIP2_FX[it.cat][(it.variant || 1) - 1];
    if (!def) continue;
    if (def.m === 'C' && !equip2CondOn(sim, def.cond)) continue; // 状況外は無効
    const scale = Math.pow(1.5, it.tier - 1);
    const up = def.up || [];
    for (let i = 0; i < up.length; i += 2) put(up[i], up[i + 1] * scale);
    if (def.down) for (let i = 0; i < def.down.length; i += 2) fx[def.down[i]] *= def.down[i + 1]; // B: 固定ペナルティ(ティア非連動)
  }
  ws._eq2FxT = sim.t; ws._eq2FxSig = eqSig; ws._eq2FxCache = fx;
  return fx;
}
// 旧・一律全生産倍率の互換(生産チェーン用): クリック/毎秒はcomputeProd側で個別適用
function equip2Mult(sim) {
  const fx = equip2Fx(sim);
  return fx.allMul;
}
// 素材ドロップの希少化(2026-07-15): 素の落ちやすさ=5% × 強さ(√HP倍率) × レア度。図鑑/研究の投資ぶんは上乗せ。
function monsterDropStrength(typeId) {
  const hp = (P.mtype && P.mtype.hpMul && P.mtype.hpMul[typeId]) || 1;
  return Math.min(4, Math.max(0.4, Math.sqrt(hp)));
}
function matTierDrop(id) {
  const R = P.ws.drops.rarity || { c: 1, r: 1, b: 1 };
  if (id === 'bossCore' || id === 'deepCore' || (typeof id === 'string' && id.startsWith('bossCore'))) return R.b;
  if (typeof id === 'string' && id.startsWith('ore_t')) return (+id.slice(5) >= 5) ? R.r : R.c;
  const rareIds = { ironShard: 1, silentCore: 1, goldDust: 1, cometShard: 1, voidSugar: 1 };
  return rareIds[id] ? R.r : R.c;
}
// 色素材ドロップ: モンスターの色(colorTier)=そのモンスターの色の素材を落とす(2026-07-15 色スポーン連動)
function equip2DropOre(sim, units, strength, colorTier) {
  const E = P.equip2; if (!E) return;
  const t = colorTier ? Math.max(1, Math.min(E.tiers, colorTier))
    : Math.max(1, Math.min(E.tiers, 1 + Math.floor((sim.run.maxStage || 0) / E.layerBand)));
  const ws = sim.ws;
  const oreId = 'ore_t' + t;
  // 希少化: 素の5% × 強さ × レア度 + 装備の色素材ボーナス(oreAdd=投資ぶん)
  const exp = (P.ws.drops.dropBase * (strength || 1) * matTierDrop(oreId) + equip2Fx(sim).oreAdd) * (units || 1);
  // ステージ署名色(R17b 2026-07-17 ユーザー指示「ノルマ層の色違いにもステージごとの特色を」):
  // 討伐ドロップの一部(stageSigFrac)は今いるステージの署名色(S1=白銀t1〜S6=紅t6)になる。
  // 色の入手が「層を進める(帯色=進行軸)」と「そのステージへ行く(署名色=場所軸)」の二軸になり、
  // ステージ選択に素材の意味が出る。署名色ぶんの量はその色のレア度準拠=高色は署名でも希少。
  const sigFrac = E.stageSigFrac || 0;
  const sigT = Math.max(1, Math.min(E.tiers, sim.run.wsStage || 1));
  if (sigFrac > 0 && sigT !== t) {
    ws.mats[oreId] = (ws.mats[oreId] || 0) + exp * (1 - sigFrac);
    const sigId = 'ore_t' + sigT;
    const sigExp = (P.ws.drops.dropBase * (strength || 1) * matTierDrop(sigId) + equip2Fx(sim).oreAdd) * (units || 1);
    ws.mats[sigId] = (ws.mats[sigId] || 0) + sigExp * sigFrac;
  } else {
    ws.mats[oreId] = (ws.mats[oreId] || 0) + exp; // 新装備: 色素材追加系
  }
}
// 装備専用の素材判定/消費: 料理用costMul(×4)や万能粉代替は適用しない生コスト
// 色素材は上位が下位を代替できる(層が深いと低位色が落ちないため。ore_tNの必要にはore_tN..t6を低い方から充当)
function equip2OreHave(sim, tier) {
  const E = P.equip2; let n = 0;
  for (let t = tier; t <= E.tiers; t++) n += sim.ws.mats['ore_t' + t] || 0;
  return n;
}
function equip2Afford(sim, cost) {
  // 料理リザーブ(2026-07-14): 装備作成は料理素材の在庫を食い潰さない(残量リザーブを残せる時だけ作る)。
  // 装備レシピと料理が同じ素材(バター等)を取り合い、作った周回が料理バフを失って凍結枝に負ける(lift0.92)対策
  const reserve = (P.equip2 && P.equip2.dishReserve != null) ? P.equip2.dishReserve : 40;
  for (const k in cost) {
    const m = /^ore_t(\d+)$/.exec(k);
    const have = m ? equip2OreHave(sim, Number(m[1])) : Math.max(0, (sim.ws.mats[k] || 0) - reserve);
    if (have < cost[k]) return false;
  }
  return true;
}
function equip2Consume(sim, cost) {
  const E = P.equip2;
  for (const k in cost) {
    const m = /^ore_t(\d+)$/.exec(k);
    if (!m) { sim.ws.mats[k] = Math.max(0, (sim.ws.mats[k] || 0) - cost[k]); continue; }
    let need = cost[k];
    for (let t = Number(m[1]); t <= E.tiers && need > 0; t++) {
      const key = 'ore_t' + t, have = sim.ws.mats[key] || 0, used = Math.min(have, need);
      sim.ws.mats[key] = have - used; need -= used;
    }
  }
}
// 作成+装備(毎tick・軽量): 現在ステージのティアの全カテゴリを素材が揃い次第、周回1個(アクセ2個)まで作る
// 付け替え可否(2026-07-16 ユーザー決定「同ティアは下がらなければいい。ティアが上がる時は50%で」):
// - 同ティア: 新スコア >= 現スコア(下がらない横滑りはOK)
// - ティアアップ: 新スコア >= 現スコア×0.5(半分あれば上位ティアに乗り換えてよい)
// - ティアダウン: 従来どおり厳密改善時のみ(指示外=保守)
// 旧・厳密改善(<)のみは「各枠が最終ティア最良種で永久停止=装備(b)がどの地平でも不可能」の根本原因だった。
function equip2SwapOk(sim, cur, it) {
  if (!it) return false;
  if (!cur) return true;
  const sc = equip2Score(sim, cur), si = equip2Score(sim, it);
  if (it.tier > cur.tier) return si >= sc * 0.5;
  if (it.tier === cur.tier) return si >= sc;
  return si > sc;
}
// 生産コア判定(2026-07-16 装備(a)ガード): 常時稼働の生産直結ステータスを持つ装備か。
// C型は状況起動=周回の大半で素通しのためコアとは見なさない。寄り道(非厳密改善の付け替え)で
// 生産コアのスロットを非コア(割引/ドロップ系/C型)へ明け渡すと、その周回の装備束が2桁落ちる実測
// (S5のupDisc喪失→購入減→momentum崩壊で0.003等)。
const EQUIP2_PROD_STATS = { clickMul: 1, cpsMul: 1, allMul: 1, dmgMul: 1, killValMul: 1, goldenAmtMul: 1, goldenRateMul: 1, goldenBoostMul: 1, holdBonus: 1 };
function equip2ProdCore(it) {
  const def = EQUIP2_FX[it.cat] && EQUIP2_FX[it.cat][(it.variant || 1) - 1];
  if (!def || def.m === 'C') return false;
  const up = def.up || [];
  for (let i = 0; i < up.length; i += 2) if (EQUIP2_PROD_STATS[up[i]]) return true;
  return false;
}
function equip2Tick(sim) {
  const E = P.equip2; if (!E) return;
  if (sim.opt.noNewEquip) return; // 装備lift判定の枝分かれ: 新規作成・付け替えを封止
  const ws = sim.ws, r = sim.run;
  // 周回開始の一式付け替え(2026-07-14): 前周回までに作った上位装備をまとめて装備
  // 寄り道は1周回に1枠まで(2026-07-16): 新規則(同ティア非減/ティアアップ50%)の「厳密改善でない」付け替えは
  // 1周回に1スロットだけ(スコア比が最も高い候補)。残りスロットは厳密改善のみ=装備束の力(装備(a)≥1.5)を保つ。
  // 制限なしだと C型(状況起動=スコアは頻度割引済みでも周回の大半が素通し)や割引系(生産に直接効かない)への
  // 複数同時サイドグレードで束が崩れ、装備(a)中央値が0.02-1.06に落ちるのを実測。
  if (!r._eq2Dressed) {
    r._eq2Dressed = true;
    const pend = ws.eq2Pending || {};
    const wear = (slot, it) => {
      ws.eq2Equipped[slot] = it.id;
      (r.eq2NewEquipped || (r.eq2NewEquipped = [])).push(it.id);
      (sim.eq2EverEquipped || (sim.eq2EverEquipped = {}))[it.id] = true; // 収集優先の既着判定用
    };
    let side = null; // {slot,it,ratio} 最良のサイドグレード候補
    let improved = 0; // この付け替えで厳密改善した枠数
    for (const slot of Object.keys(pend)) {
      const it = equip2ById(pend[slot]);
      const cur = ws.eq2Equipped[slot] ? equip2ById(ws.eq2Equipped[slot]) : null;
      if (!it) { delete pend[slot]; continue; }
      const sc = cur ? equip2Score(sim, cur) : 0, si = equip2Score(sim, it);
      // 生産コアのスロットを非コア(割引/ドロップ/C型)に明け渡さない(スコア上の「改善」でも禁止)。
      // スコアモデルは割引系(unit=3)を生産より高く評価しうるが、実生産では帽子=全生産等の喪失で
      // 周回の装備束が2-3桁落ちる(S3 hat resDisc化で0.002等を実測)=装備(a)の要。
      const coreYield = cur && equip2ProdCore(cur) && !equip2ProdCore(it);
      // ※初装着の方針適合ゲート(θ=0.35)は実験の結果撤回(2026-07-17): 正の弱い装備(hands/accA=序盤の
      // 生きたチャネル)まで弾いて束を崩す逆効果を実測。ただし**負スコア**(=そのプレイヤーの評価で
      // 「着ると損」なB型・代償が自分の大黒柱を削る装備)だけは空スロットでも着ない(2026-07-17 R18:
      // コスト安の弱B初装着が束比0.348(65%損)を作った実測対策。損と分かって着る人はいない=自然な判断)。
      if ((!cur && si >= 0) || (cur && si > sc && !coreYield)) { wear(slot, it); improved++; } // 初装着(非負のみ)/厳密改善
      else if (cur && si >= 0 && !coreYield && equip2SwapOk(sim, cur, it)) { // 寄り道も「スロット使用中+非負」のみ(負の初装着が寄り道経路へ漏れる穴を封鎖)
        const ratio = sc > 0 ? si / sc : 1;
        if (!side || ratio > side.ratio) side = { slot, it, ratio };
      }
      delete pend[slot];
    }
    // 寄り道は最も無害な1枠だけ・かつ同じ周回に厳密改善が1つ以上あるときだけ
    // (寄り道単独の周回は装備束がその寄り道だけになり(a)中央値1.0-1.2に落ちる実測)
    if (side && improved > 0) wear(side.slot, side.it);
  }
  // 早期打ち切り(perf 2026-07-16): 周回の作成上限に達したら以降このtickでは何も作れない=
  // 高コストな全装備ソート/スコア計算をまるごと省く(1周回のtickの大半は上限到達後)。
  const runCraftCapEarly = (E.craftPerRunCap != null) ? E.craftPerRunCap : 5;
  if ((r.eq2CraftTotal || 0) >= runCraftCapEarly) return;
  const curStage = Math.max(1, Math.min(E.tiers, r.wsStage || 1));
  // 作れるのは「現ステージのラインナップ」(ばらけ配置・2026-07-14)。高ティア優先で1カテゴリ1個/周回。
  // カテゴリ優先を周回ごとにローテーション(2026-07-13: 固定順だと末尾カテゴリ(hat/shoes/acc)が
  // いつも素材切れ後=周回終盤の初作成になり装備lift(a)と作成テンポ(c)を落とす)
  const rot = (sim.prestigeRuns || 0) % EQUIP2_CATS.length;
  const catOrder = {};
  EQUIP2_CATS.forEach((c, i) => { catOrder[c] = (i - rot + EQUIP2_CATS.length) % EQUIP2_CATS.length; });
  // 方針レーン制(2026-07-14 v2): 各方針は(カテゴリ,ティア)ごとに担当色銘 v=(方針idx+ティア+カテゴリidx)%9+1 を
  // 優先して作り、装備はティアアップ時のみ(横滑り付け替え廃止=lift(a)を壊さない)。
  // 9方針×54種のレーンで486種のカバレッジがちょうど一巡する。
  // 作成順(2026-07-15 A/B/C固定モデル): カテゴリをローテ順に回し、各カテゴリ内は方針適合スコアが高い変種から作る。
  // =各方針は自分の遊びに合う装備を作って着ける(B下げは使わないステータスへ・C状況は頻度で割引)。
  // 方針×ステージ×ティアで最良変種が違う=作る変種が方針間で散る。(b)カバレッジは1000h窓で巡回。
  // 作成上限(0〜5個/周回)下では、限られた作成枠を「今いちばん伸びるスロット」に回す=装備lift(a)を守る。
  // 各カテゴリの現装備スコアを基準に、伸び幅(スコア差)が大きい順に作る。同点はローテ順→高ティア。
  const curSlot = {};
  const curSlotScore = {};
  for (const cat of EQUIP2_CATS) { const eq = ws.eq2Equipped[cat] ? equip2ById(ws.eq2Equipped[cat]) : null; curSlot[cat] = eq; curSlotScore[cat] = eq ? equip2Score(sim, eq) : 0; }
  const upGain = it => equip2Score(sim, it) - (curSlotScore[it.cat] || 0);
  // 収集優先(2026-07-16 ユーザー決定の付け替え規則を作成順に反映): 「まだ着けたことがなく、新規則で
  // 付け替え可能(同ティア=非減/ティアアップ=50%)」な担当色銘 v=(方針idx+ティア+カテゴリidx)%9+1 を最優先で作る
  // =プレイヤーは規則の範囲で新しい装備を試す。規則を満たさない/既着なら従来どおり伸び幅順。
  const stratIdx = Math.max(0, (parseInt(String(sim.strat.id).replace(/\D/g, ''), 10) || 1) - 1);
  const everEq = sim.eq2EverEquipped || (sim.eq2EverEquipped = {});
  const laneOf = it => ((stratIdx + it.tier + EQUIP2_CATS.indexOf(it.cat)) % 9) + 1;
  const noCoreYield = it => !(curSlot[it.cat] && equip2ProdCore(curSlot[it.cat]) && !equip2ProdCore(it)); // 生産コアの明け渡しになる作成は優先しない
  const laneFirst = it => (it.variant === laneOf(it) && !everEq[it.id] && equip2SwapOk(sim, curSlot[it.cat], it) && noCoreYield(it)) ? 1 : 0;
  const items = equip2Items().slice().sort((a, b) =>
    (laneFirst(b) - laneFirst(a)) || (upGain(b) - upGain(a)) || (catOrder[a.cat] - catOrder[b.cat]) || (equip2Score(sim, b) - equip2Score(sim, a)) || (b.tier - a.tier));
  // 1周回の作成上限(2026-07-15 ユーザー指示「装備は1周回に0〜5個まで作成」)
  const runCraftCap = (P.equip2 && P.equip2.craftPerRunCap) || 5;
  for (const it of items) {
    if ((r.eq2CraftTotal || 0) >= runCraftCap) break; // 周回の作成数が上限に達したら以降は作らない
    if (!it.stages.includes(curStage)) continue;
    // 作成ティア解放(2026-07-15): ティア2以降はそれぞれ解放スキルが要る(作成欄が出る)
    if (it.tier >= 2 && !hasSkillEffect(sim, 'unlockSystem', 'eqcraftT' + it.tier)) continue;
    const cap = 1; // 9カテゴリ各1個/周回(アクセは甲/乙で別カテゴリ)
    if (((r.eq2Made && r.eq2Made[it.cat]) || 0) >= cap) continue;
    // レシピ固定(2026-07-14): 装備入りレシピは前ティア所持が必須・素材のみレシピは素材だけ(実行時の代替なし)
    const havePrev = it.prev ? ((ws.eq2Owned[it.prev] || 0) >= 1) : true;
    const cost = it.cost;
    const afford = havePrev && equip2Afford(sim, cost);
    // レシピ表示(発見式): 一度素材が揃えば以後表示は消えない
    if (!ws.eq2Seen[it.id]) { if (afford) ws.eq2Seen[it.id] = true; else continue; }
    if (!afford) continue;
    // 合成: 素材(+あれば前ティア装備1個)を消費
    equip2Consume(sim, cost);
    let upgradedSlot = null;
    if (havePrev) {
      ws.eq2Owned[it.prev] = Math.max(0, (ws.eq2Owned[it.prev] || 0) - 1);
      for (const s of EQUIP2_SLOTS) if (ws.eq2Equipped[s] === it.prev && (ws.eq2Owned[it.prev] || 0) === 0) { upgradedSlot = s; break; }
    }
    ws.eq2Owned[it.id] = (ws.eq2Owned[it.id] || 0) + 1;
    (r.eq2Made || (r.eq2Made = {}))[it.cat] = ((r.eq2Made || {})[it.cat] || 0) + 1;
    r.eq2CraftTotal = (r.eq2CraftTotal || 0) + 1; // 周回の作成総数(0〜5上限)
    // 装備は保留箱へ(2026-07-14 一式付け替え方式): 作成即装備をやめ、周回開始時にまとめて付け替える
    // =付け替え束が周回頭に揃い、装備lift(a)の測定窓(その周回まるごと)を最大に使う
    {
      const slot = upgradedSlot || it.cat;
      const pend = ws.eq2Pending || (ws.eq2Pending = {});
      const curId = pend[slot] || ws.eq2Equipped[slot];
      const cur = curId ? equip2ById(curId) : null;
      if (equip2SwapOk(sim, cur, it)) pend[slot] = it.id; // 新規則(同ティア非減/ティアアップ50%)
      if (upgradedSlot) { // 合成で装備中の物が消えた枠は即時充当(空白を作らない)
        ws.eq2Equipped[upgradedSlot] = it.id;
        (r.eq2NewEquipped || (r.eq2NewEquipped = [])).push(it.id);
        (sim.eq2EverEquipped || (sim.eq2EverEquipped = {}))[it.id] = true;
        delete pend[upgradedSlot];
      }
    }
  }
}

const WS_RECIPE_BY_ID = {}; // params から引く(遅延)
function wsRecipeOf(id) {
  if (!WS_RECIPE_BY_ID[id]) for (const rc of P.ws.recipes) WS_RECIPE_BY_ID[rc.id] = rc;
  return WS_RECIPE_BY_ID[id];
}
function wsEqDefOf(id) { for (const e of P.ws.equipment) if (e.id === id) return e; return null; }
// レシピ開示済み=コスト素材を全て一度は入手済み
function wsRecipeSeen(sim, rc) { for (const k in rc.cost) if (!sim.ws.seen[k]) return false; return true; }
// 工房の自動プレイ(毎tick・軽量): 料理を維持し、装備を育てる
function wsAutoPlay(sim) {
  if (!wsUnlocked(sim)) return;
  const r = sim.run, ws = sim.ws, t = sim.t;
  // 料理: 好み順に、切れていて作れるものを作る(同時 cookMax 品)
  // 料理は「手が空いた時に作る」(注意チェック=180秒ごと)。毎tick即再調理だと稼働率が常時100%になり、
  // 蒸留フラスコ(効果時間延長)が構造的に無価値(⑮の2で1.000=実測)。切れ目の期待値を作る。
  const cookCheck = (sim.t % 180 === 0) || (sim.t - r.startT <= 1);
  const pref = WS_DISH_PREF[r.policy] || WS_DISH_PREF.balanced;
  let active = 0;
  for (const id in r.buffs) if (r.buffs[id] > t) active++;
  for (const id of pref) {
    if (!cookCheck) break;
    if (active >= P.ws.cookMax) break;
    if ((r.buffs[id] || 0) > t) continue;
    const rc = wsRecipeOf(id);
    if (!rc || !wsRecipeSeen(sim, rc) || !wsCanAfford(sim, rc.cost)) continue;
    wsConsume(sim, rc.cost);
    const dur = P.ws.cookDur * (1 + P.ws.eqFx.flaskPerLv * wsEqLv(sim, 'stillFlask'));
    r.buffs[id] = t + dur;
    active++;
    if (!ws.everWs['dish:' + id]) ws.everWs['dish:' + id] = true; // 解放イベントはレシピ開示時に計上済み(初調理は重複させない)
  }
  // 旧装備(Lv式7種)は廃止(2026-07-13 ユーザー指示「既存の装備は廃止」)。作成停止=Lv恒久0で全フック無効
  if (false) {
    const epref = WS_EQ_PREF[r.policy] || WS_EQ_PREF.balanced;
    for (const id of epref) {
      const def = wsEqDefOf(id);
      const lv = (ws.eq[id] || 0);
      const mul = Math.pow(P.ws.eqGrowth, lv);
      // 限界突破(仕様§10): Lv10以降はボス核(5+3×超過)+虚空糖(10×超過)の追加コストで無限に強化可
      // =素材(核・虚空糖)の恒久シンク。深層供給と釣り合う(注文の素材セット報酬の価値化も兼ねる)。
      let extra = null;
      if (lv >= P.ws.eqLvCap) {
        const over = lv - P.ws.eqLvCap;
        extra = { bossCore: 5 + 3 * over, voidSugar: 10 * (over + 1) };
        if ((ws.mats.bossCore || 0) < extra.bossCore || (ws.mats.voidSugar || 0) < extra.voidSugar) continue;
      }
      if (!wsCanAfford(sim, def.cost, mul)) continue;
      wsConsume(sim, def.cost, mul);
      if (extra) { ws.mats.bossCore -= extra.bossCore; ws.mats.voidSugar -= extra.voidSugar; }
      ws.eq[id] = lv + 1;
      if (!ws.everWs['eq:' + id]) ws.everWs['eq:' + id] = true; // 作成は進行であって「解放」ではない(解放イベントはworkshop_2スキルとレシピ開示が担う=T2の1-3件帯を守る)
      break; // 1tick1回
    }
  }
}
// 討伐ドロップ(v4 §18 条件ドロップ制・期待値)
function wsDropMaterials(sim, mon, overkill) {
  if (!wsUnlocked(sim)) return;
  const r = sim.run, ws = sim.ws, D = P.ws.drops;
  const st = wsStageDef(sim);
  const units = (P.mtype && P.mtype.rewardEvents && P.mtype.rewardEvents[mon.typeId]) || 1;
  const lv = Math.max(1, mon.level || 1);
  let dropMul = st.dropMul + (st.dropPerLayer ? st.dropPerLayer * sim.ws.deepLayer : 0);
  dropMul *= 1 + (P.chain ? P.chain.dropCoef * chainCount(sim) : 0);
  dropMul *= (1 + P.ws.eqFx.compassDropPerLv * wsEqLv(sim, 'dimensionCompass')) * equip2Fx(sim).dropMul; // 新装備: 素材ドロップ系
  if (wsBuffActive(sim, 'voidTart')) dropMul *= P.ws.fx.voidDrop;
  // 図鑑の素材ボーナス: 旧floor(Lv/2)はLv1で0=効果ゼロ。連続値へ(2026-07-11 ⑮の2比1.000の修復)
  const strength = monsterDropStrength(mon.typeId);
  // 投資ぶんの追加ドロップ(レベル・図鑑・実績研究)=「最初は5%・育てると増える」の上乗せ
  const invAdd = Math.floor(Math.sqrt(lv) / D.lvDiv) + (P.ws.eqFx.almanacDropPerLv || 0) * wsEqLv(sim, 'monsterAlmanac') + ((r.ms && r.ms.dropAdd) || 0);
  // 共通素材(ステージ基本): 決定的ローテーション
  const cList = st.c;
  const cPick = cList[ws.matRot % cList.length]; ws.matRot++;
  // 希少化(2026-07-15): 素の5% × 強さ × 素材レア度 + 投資ぶん。× 既存倍率 × dropAllMul。
  const dam = ((P.equip2 && P.equip2.dropAllMul) || 1);
  const eqf = equip2Fx(sim);
  // ドロップ系ボーナスのバリエーション(2026-07-15): dropRateAdd=素の落ちやすさに+(全素材の確率up)/ dropLuck=固定確率で+1個
  const baseRate = D.dropBase + (eqf.dropRateAdd || 0);
  const commonN = (baseRate * strength * matTierDrop(cPick) + invAdd * matTierDrop(cPick)) * dropMul * dam * units
    + (eqf.dropLuck || 0) * units; // 固定確率で+1個(期待値)
  wsAddMat(sim, cPick, commonN);
  // 条件枠(狙って倒した時の確定寄り): max(5%×強さ, レア基準) × レア度 × 倍率
  const condExp = id => Math.max(D.dropBase * strength, D.rarity.r) * matTierDrop(id) * dropMul * dam * units;
  // ノルマ余裕率2倍以上で撃破: 共通+条件枠
  const quota = Math.max(1, quotaAtElapsed(sim, sim.t - r.startT));
  if (r.runCookies >= D.marginThresh * quota) wsAddMat(sim, cPick, condExp(cPick));
  // 金ブースト中に撃破=黄金粉(唯一の経路)
  if (goldenBoostActive(sim)) wsAddMat(sim, 'goldDust', condExp('goldDust'));
  // オーバーキル=レア枠
  if (overkill && st.r.length) wsAddMat(sim, st.r[0], condExp(st.r[0]));
  // 狩り窓中の3体連続=ボス核+1
  if (sim.t < r.portalHuntUntil && P.chain && r.chainN > 0 && r.chainN % D.chainKills === 0) wsAddMat(sim, 'bossCore', 1);
  // 深層: 虚空糖(レア枠と別口の少量)
  if (wsStageNo(sim) >= 6) wsAddMat(sim, 'voidSugar', condExp('voidSugar'));
  // バランス型: 万能粉(0.8の確率で条件枠ドロップ=期待値)
  if (r.policy === 'balanced') wsAddMat(sim, 'universal', D.universalRate * condExp('universal'));
  // ボス: 核(初回3・以後1)。深層は層進行のみ(ステージ解放は下の固定クエストへ移管・2026-07-13)
  if (mon.typeId === 'boss') {
    const first = !ws.everWs['boss:' + wsStageNo(sim) + (wsStageNo(sim) >= 6 ? ':' + ws.deepLayer : '')];
    wsAddMat(sim, 'bossCore', first ? 3 : 1);
    if (first) ws.everWs['boss:' + wsStageNo(sim) + (wsStageNo(sim) >= 6 ? ':' + ws.deepLayer : '')] = true;
    if (wsStageNo(sim) >= 6) ws.deepLayer++;
  }
  // 固定クエスト(2026-07-13 ユーザー確定仕様): フロンティアステージでの累計討伐で次ステージ解放。
  // 制限時間なし・周回を跨いで累積・達成で解放イベント+次クエスト(注文ボードに常設表示=ゲーム側UI)
  if (P.quest2 && wsStageNo(sim) === ws.stageUnlocked && ws.stageUnlocked < 6) {
    const stNo = ws.stageUnlocked;
    ws.questKills[stNo] = (ws.questKills[stNo] || 0) + units;
    const need = P.quest2.killsNeed[stNo - 1] || Infinity;
    if (ws.questKills[stNo] >= need && unlockGateOk(sim)) {
      ws.stageUnlocked++;
      pushUnlock(sim, 'ws', 'stage:' + ws.stageUnlocked);
      wsRevealRecipes(sim); // 新ステージの素材で作れるレシピを同秒で開示
    }
  }
}
// ボス化に必要な討伐数(ステージ依存+コンパス)。深層(S6)=65+10×層(仕様§9)=層が深いほど
// 次のボスが遠い(自己制動)。固定周期だと24hで層74まで暴走しHP=60×4^74で序盤討伐が全滅する(実測)。
function wsBossCycle(sim) {
  const no = wsStageNo(sim);
  if (no >= 6) return Math.max(5, 65 + 10 * (sim.ws.deepLayer + 1) - wsEqLv(sim, 'dimensionCompass'));
  const st = wsStageDef(sim);
  return Math.max(5, P.ws.bossBase + P.ws.bossPer * (no - 1) + (st.bossCycleAdd || 0) - wsEqLv(sim, 'dimensionCompass'));
}
// 注文ボード(§19): 同時1件・間隔は転生回数で短縮・必要量/報酬は現在値に相対。
// order_board スキル(既存ツリー)で解放。完了は期待値: 必要量/現在レートが制限時間内なら達成。
function wsOrderTick(sim, prod) {
  if (!hasSkillEffect(sim, 'unlockSystem', 'orderBoard')) return;
  const O = P.ws.orders, ws = sim.ws, t = sim.t;
  if (ws.orderNextT == null) ws.orderNextT = t + O.intervalBase * Math.pow(O.intervalDecay, sim.prestigeRuns);
  if (!ws.order && t >= ws.orderNextT) {
    const kinds = ['prod', 'click', 'hunt'];
    const kind = kinds[ws.orderKindRot % 3]; ws.orderKindRot++;
    const limit = O.limitBase + O.limitSqrt * Math.sqrt(t);
    ws.order = { kind, startT: t, limit };
  }
  if (ws.order) {
    const o = ws.order;
    // 現在レートで必要量を消化できる時刻(期待値)。レートが要求係数を上回る分だけ早く終わる。
    const doneFrac = (t - o.startT) / o.limit;
    const rateOk = o.kind === 'prod' ? 1 / O.needProd : o.kind === 'click' ? 1 / O.needClick : 1 / O.needHunt;
    // 要求=現在値×制限×係数 → 通常プレイの消化速度は係数の逆数倍=必ず達成可能・放置では届かない想定
    if (doneFrac * rateOk >= 1) {
      // 達成: 報酬(種別ローテ)。㉙=各報酬の稼ぎ比≥1.2 の判定対象
      const rkinds = ['cookie', 'materials', 'boost'];
      const rk = rkinds[ws.orderRewardRot % 3]; ws.orderRewardRot++;
      if (rk === 'cookie') {
        // 報酬=時間窓の上乗せ(2026-07-11 確定形)。窓の設定自体は無条件、支払いはtick側で
        // wsOff('order:cookie')ゲート(枝分かれ計測で以後の支払いだけ消える=同式性)。
        sim.run.orderCookieUntil = t + (O.rewardCookieSec || 300);
      }
      else if (rk === 'materials' && !wsOff(sim, 'order:materials')) {
        // 素材セット=御用聞き型: 次に作りたい装備(方針の好み順で最初に作れない物)の不足分を補充する。
        // 「今いるステージの共通素材を定数配る」型は、それが最も余っている素材のため限界価値ゼロ
        // (核1553個・虚空糖460万在庫でも比1.000=実測)。不足素材を配ってはじめて進行が動く。
        const epref = WS_EQ_PREF[sim.run.policy] || WS_EQ_PREF.balanced;
        let granted = 0;
        for (const id of epref) {
          if (granted >= (O.rewardItems || 1)) break;
          const def = wsEqDefOf(id);
          const lv = ws.eq[id] || 0;
          const mul = Math.pow(P.ws.eqGrowth, lv) * (P.ws.costMul || 1);
          const fill = O.rewardFill != null ? O.rewardFill : 0.8;
          let missingAny = false;
          for (const k in def.cost) {
            const need = def.cost[k] * mul;
            const have = ws.mats[k] || 0;
            if (have < need) { wsAddMat(sim, k, (need - have) * fill); missingAny = true; }
          }
          if (lv >= P.ws.eqLvCap) { // 限界突破ぶんの核・虚空糖の不足も補充対象
            const over = lv - P.ws.eqLvCap;
            const needC = 5 + 3 * over, needV = 10 * (over + 1);
            if ((ws.mats.bossCore || 0) < needC) { wsAddMat(sim, 'bossCore', (needC - (ws.mats.bossCore || 0)) * 0.8); missingAny = true; }
            if ((ws.mats.voidSugar || 0) < needV) { wsAddMat(sim, 'voidSugar', (needV - (ws.mats.voidSugar || 0)) * 0.8); missingAny = true; }
          }
          if (missingAny) granted++;
        }
        if (!granted) { const st = wsStageDef(sim); wsAddMat(sim, st.c[ws.matRot % st.c.length], O.rewardMatSet); ws.matRot++; }
      } else if (rk === 'boost' && !wsOff(sim, 'order:boost')) {
        sim.run.boosts.push({ mult: O.rewardBoostMul, until: t + O.rewardBoostSec });
      }
      sim.run.ordersDone[rk] = (sim.run.ordersDone[rk] || 0) + 1;
      if (!ws.everWs['order:' + rk]) ws.everWs['order:' + rk] = true; // 注文報酬種も「解放」ではない(ボード自体の解放=order_boardスキル)
      ws.order = null;
      ws.orderNextT = t + O.intervalBase * Math.pow(O.intervalDecay, sim.prestigeRuns);
    } else if (t - o.startT > o.limit) {
      ws.order = null; // 時間切れ
      ws.orderNextT = t + O.intervalBase * Math.pow(O.intervalDecay, sim.prestigeRuns);
    }
  }
}

// ================= 効果計算(ゲーム式の移植) =================
function hasSkill(sim, id) { return !!sim.skills[id]; }
function skillEffect(sim, type, target) {
  const key = type + '|' + (target || '');
  if (sim._fx[key] !== undefined) return sim._fx[key];
  const values = buildSkillValues();
  let total = 0;
  for (const s of SKILL_NODES) {
    if (!sim.skills[s.id]) continue;
    if (target) {
      for (const e of s.effects) {
        if (e[0] !== type || e[1] !== target) continue;
        total += (typeof e[2] === 'number' ? e[2] : 0);
      }
    } else {
      const v = values[s.id][type];
      if (v) total += v;
    }
  }
  sim._fx[key] = total;
  return total;
}
function hasSkillEffect(sim, type, target) {
  const key = type + '|' + (target || '');
  if (sim._fxHas[key] !== undefined) return sim._fxHas[key];
  const v = SKILL_NODES.some(s => sim.skills[s.id] && s.effects.some(e => e[0] === type && (!target || e[1] === target)));
  sim._fxHas[key] = v;
  return v;
}
function upgradeUnlocked(sim, u) {
  // ㉚(2026-07-24 再設計): 設備の「スキル解放ゲート」を撤去。スキルで解放していたため「解放スキル取得→直後にその設備を
  // 購入」が連続解放(㉚基底の最大の団子源)になっていた。設備は visibleUpgrades の階層ゲート(前段を所持したら次段が
  // 店に並ぶ)+コスト進行で自然に解放される(=finger/grandma…と同じくコスト律速で≥30秒間隔)。解放スキル(upgrade_*)は
  // 成長効果(skillBranchFx の cps×1.3 ほか)として残るのでスキルツリー・全解放・㉜の構造は不変。設備解放とスキル取得の
  // タイミングが切り離され、隣接団子が消える。
  if (P.upCost && P.upCost.decoupleUnlockSkills) return true;
  const need = UPGRADE_UNLOCK_SKILLS[u.id];
  return !need || hasSkill(sim, need);
}
function researchUnlocked(sim, r) {
  // 2026-07-06: スキルゲート撤廃。その回で対応設備を購入済みなら購入可能
  // (㉚の研究初開発ゲートは第9版アーミングで全初回開発に一律課税→全解放2〜4倍遅延の実測により撤回。
  //  研究初開発のペーシングは貯金プレミアム(tryBuyResearch内・深さで階段化)のみ)
  const eq = RES_EQUIP[r.id];
  if (eq && !(sim.run.upgrades[eq] > 0)) return false;
  return true;
}
function rewardUnlockedFn(sim, r) {
  // 無効化(disableReward)でも選択肢には残る: 効果だけがゼロになる
  return !r.unlockSkill || hasSkill(sim, r.unlockSkill);
}
function resActive(sim, id) {
  if (sim._md === 'res:' + id) return false; // 期待値測定の一時無効(①)
  if (sim._mdSet && sim._mdSet.has('res:' + id)) return false; // ㉘稼ぎ口分解の一括無効
  return sim.run.research[id] && sim.opt.disableResearch !== id;
}
function policyIs(sim, id) {
  return hasSkillEffect(sim, 'unlockSystem', 'runPolicy') && sim.run.policy === id;
}
function rewardCategoryBonus(sim, cat) {
  if (!hasSkillEffect(sim, 'unlockSystem', 'rewardSynergy')) return 0;
  return lg(satLv(sim.run.rewardCategoryCounts[cat] || 0, P.rw.categoryHalf), P.rw.categoryBonusRate) - 1;
}
function elapsed(sim) { return sim.t - sim.run.startT; }

function quotaControlMultiplier(sim) {
  let raw = 0;
  if (resActive(sim, 'ovenBatch')) raw += P.res.ctrlOven;
  if (resActive(sim, 'moonGlobalYeast')) raw += P.res.ctrlMoon;
  if (resActive(sim, 'blackHoleCompression')) raw += P.res.ctrlBh;
  return 1 + Math.log1p(Math.max(0, raw) * P.quota.ctrlMul) / P.quota.ctrlDiv;
}
function quotaAtElapsed(sim, s) {
  const q = P.quota;
  if (s < q.graceSec) return 0;
  const x = s - q.graceSec;
  const base = q.baseCoef * Math.pow(x, q.basePow) + q.base2Coef * Math.pow(x, q.base2Pow);
  const wall = 1
    + q.w1 * Math.pow(Math.max(0, (s - q.w1T) / q.w1D), q.w1P)
    + q.w2 * Math.pow(Math.max(0, (s - q.w2T) / q.w2D), q.w2P)
    + q.w3 * Math.pow(Math.max(0, (s - q.w3T) / q.w3D), q.w3P);
  // 層の試練(第12次D・提案4採用 / 第12次H・提案8で新規開拓層基準へ相対化): 層が深いほどノルマが重い。
  // 提案8: 「絶対の最高層」ではなく「前回周回の天井(prevMaxStage)+trialStartLayer を超えて新しく潜った分」に
  // だけ効かせる。再登坂(前回天井までの登り直し)は試練ゼロ=タダで、新フロンティア開拓(周回後半)で初めて
  // 試練が立ち上がる → 未達位置が後半へ移り、速い方針も後半に新層を開けば未達する。層数の表示(run.maxStage)は
  // 絶対累積のまま(前回基準で1から数え直さない・ユーザー指示)。相対化するのはこの指数計算だけ。
  const trialFloor = (sim.prevMaxStage || 0) + (q.trialStartLayer || 0);
  const trial = q.trialCoef
    ? Math.pow(1 + q.trialCoef, Math.max(0, sim.run.maxStage - trialFloor))
    : 1;
  const frost = (wsBuffActive(sim, 'frostCake') ? P.ws.fx.frostGauge : 1) * (1 - equip2Fx(sim).quotaSlow); // 新装備: ノルマ減速系(盾)+霜降りケーキ
  return Math.max(1, Math.floor((base * wall * trial * frost) / quotaControlMultiplier(sim)));
}
function monsterQuotaRequired(sim) {
  const r = sim.run;
  if (r.quotaFailed) return null;
  const baseQuota = quotaAtElapsed(sim, elapsed(sim));
  if (!baseQuota || baseQuota <= 0) return baseQuota;
  if (!r.blackHoleCompressionUsed && resActive(sim, 'blackHoleCompression')) {
    const bh = r.upgrades.blackHoleMixer || 0;
    let compression = bh > 0 ? ir(bh, P.res.bhCompress) : 1;
    // キャップ撤廃: 1-min(0.35, 0.001×最高層) → e^(-0.001×最高層) (負値防止の逓減式・上限なし)
    if (resStage3(sim, 'blackHoleCompression')) compression *= Math.exp(-P.res2.bhCompStageCoef * r.maxStage);
    const ratio = r.runCookies / baseQuota;
    if (compression < 1 && ratio < 1.03 && ratio >= compression) {
      r.blackHoleCompressionUsed = true;
      r.blackHoleQuotaMultiplier = compression;
    }
  }
  return Math.max(1, Math.floor(baseQuota * (r.blackHoleQuotaMultiplier || 1)));
}
// ==== ノルマ層ゲージ(2026-07-06 ユーザー確定仕様・第9次) ====
// ゲージは「現時点のその回の総クッキー数が、何秒先のノルマまで達成できるか」の先行秒数 L で貯まる。
// L = (ノルマ曲線が今の総クッキーに達する将来時刻 s*) − 現在の経過秒。
// 層進行の式は秒数のみを変数とする: 層kの必要ゲージ秒 = gaugeSec × gaugeGrow^(k-1)(調整項目)。
function quotaLeadSeconds(sim) {
  const r = sim.run;
  const el = elapsed(sim);
  const total = r.runCookies;
  if (!(total > 0)) return 0;
  // s* をギャロップ+二分探索(quotaAtElapsed は s について単調非減少、runCookies も単調増加なので
  // 前回の s* から前進のみで探索できる。研究購入等でノルマ係数が下がった場合も s* は増える方向)
  let lo = Math.max(el, r._leadS || 0);
  if (quotaAtElapsed(sim, lo) > total) lo = el;
  if (quotaAtElapsed(sim, lo) > total) return 0;
  let hi = Math.max(lo * 2, lo + 64), guard = 0;
  while (hi < 1e62 && quotaAtElapsed(sim, hi) <= total && guard++ < 250) { lo = hi; hi *= 2; }
  while (hi - lo > Math.max(1, lo * 1e-6)) {
    const mid = lo + (hi - lo) / 2;
    if (quotaAtElapsed(sim, mid) <= total) lo = mid; else hi = mid;
  }
  r._leadS = lo;
  return Math.max(0, lo - el);
}
// 先行秒数 L → 層進行(小数)。満たした層数+現在層の端数。
// 層は「秒数のみの関数」。ただし総クッキーが浮動小数上限(~1e308)に近づく放置周回では
// 先行秒数が天文学的(~1e300)になり層が青天井に伸びるため、層の上限 gaugeMaxLayer で頭打ちにする
// (=先行秒数の実効上限。通常の転生周回は最大でも約190層で、上限には決して届かない=遊びに影響なし)。
function quotaLayerProgress(leadSec) {
  const g = Math.max(1, P.quota.gaugeSec), r = P.quota.gaugeGrow;
  const cap = P.quota.gaugeMaxLayer || Infinity;
  if (!(leadSec > 0)) return 0;
  let pr;
  if (r <= 1.0001) pr = leadSec / g;
  else {
    const k = Math.max(0, Math.floor(Math.log(leadSec * (r - 1) / g + 1) / Math.log(r)));
    const used = g * (Math.pow(r, k) - 1) / (r - 1);
    pr = k + Math.max(0, leadSec - used) / (g * Math.pow(r, k));
  }
  return Math.min(cap, pr);
}
function currentStage(sim) {
  if (sim._stT === sim.t) return sim._stV;
  const v = currentStageRaw(sim);
  sim._stT = sim.t; sim._stV = v;
  return v;
}
function currentStageRaw(sim) {
  const quota = monsterQuotaRequired(sim);
  if (quota === null || quota <= 0) return Math.max(1, sim.run._stFrozen || 1);
  const pr = quotaLayerProgress(quotaLeadSeconds(sim));
  if (pr <= 0) return 1;
  const whole = Math.floor(pr);
  const frac = pr - whole;
  const v = (frac <= 0.0001 && whole > 0) ? whole : whole + 1;
  sim.run._stFrozen = v; // 未達後(quota=null)は最後の層で凍結(層1へ落とさない)
  return v;
}

function runTempoRamp(sim) {
  const s = elapsed(sim);
  return 1 - P.tempo.ramp * (1 - Math.exp(-s / P.tempo.rampDiv));
}

// --- 焼き加減システムは廃止(2026-07-10 ユーザー指示。合格条件からも削除) ---
// 旧実装(bakeEV: ふんわり/こんがり/焦げの期待値乗数 cps/golden/dmg/stay/hp)は git 履歴参照。
// 断熱オーブン手袋(ovenMitt)の効果は「オーブン生産×(1+mittPerLv×Lv)」へ再係留(computeProd の oven ブロック)。
// 移植時: index.html から焼き加減UI・スキルノード「焼き加減調整」・RESEARCH_STAGE_MULT等の関連を削除すること。

function purgeBoosts(sim) {
  const r = sim.run;
  r.boosts = r.boosts.filter(b => b.until > sim.t);
  r.afterheats = r.afterheats.filter(b => b.until > sim.t);
}
function goldenBoostMultiplier(sim) {
  let m = 1; for (const b of sim.run.boosts) m *= b.mult;
  if (m > 1) m *= equip2Fx(sim).goldenBoostMul; // 新装備: 金ブースト系(アクセ甲)
  return m;
}
function goldenBoostActive(sim) { return sim.run.boosts.length > 0; }
function afterheatMultiplier(sim) {
  let m = 1; for (const b of sim.run.afterheats) m *= b.mult; return m;
}

// --- 生産計算 ---
function computeProd(sim) {
  const r = sim.run;
  const R = P.res;
  const stage = currentStage(sim);

  const allSkill = skillEffect(sim, 'all');
  const msC = (r.ms && r.ms.click) || 1; // マイルストーン研究(第12次R5): タップ系
  const msA = (r.ms && r.ms.all) || 1;   // 同: 全生産系
  const clickSkillMul = (1 + skillEffect(sim, 'click') + allSkill + (policyIs(sim, 'click') ? 0.12 : 0)) * msC * msA;
  const cpsSkillMul = (1 + skillEffect(sim, 'cps') + allSkill + (policyIs(sim, 'bake') ? 0.12 : 0)) * msA * ((r.ms && r.ms.cps) || 1);
  const prestigeMul = 1 + allSkill;

  // 研究: グローバル
  let globalRes = 1;
  if (resActive(sim, 'moonGlobalYeast')) {
    const moon = r.upgrades.moonBakery || 0;
    const mStage = r.maxStage; // 最高到達ノルマ層
    const layer = mStage < 3 ? 1 : lg(Math.max(0, mStage - 2), R.moonStage) * lg(capOwn(moon), R.moonOwn);
    let moonM = R.moonBase * layer;
    if (resStage2(sim, 'moonGlobalYeast')) {
      // 段階2: ノルマ余裕率(今回クッキー/必要ノルマ)で発酵が進む
      // キャップ撤廃: min(1,余裕率/10) → log10(1+余裕率)/10 (上限なし・暴走防止の逓減式)
      const q = monsterQuotaRequired(sim);
      const margin = (q && q > 0) ? r.runCookies / q : 1;
      moonM *= 1 + Math.log10(1 + Math.max(0, margin)) / P.res2.moonMarginDiv;
    }
    if (resStage3(sim, 'moonGlobalYeast')) {
      const rc0 = RESEARCH.filter(x => r.research[x.id]).length;
      moonM *= 1 + P.res2.moonResCount * rc0;
    }
    globalRes *= moonM;
  }
  if (resActive(sim, 'portalGlobalFold')) {
    const portal = r.upgrades.portal || 0;
    const mcount = r.monster ? 1 : 0;
    const goldM = goldenBoostActive(sim) ? R.foldGold : 1;
    let foldM = lg(capOwn(portal), R.foldPortal) * lg(mcount, R.foldMonster) * goldM;
    if (resStage2(sim, 'portalGlobalFold')) foldM *= 1 + P.res2.foldKillCoef * Math.max(0, r.quotaMonsterKills);
    if (resStage3(sim, 'portalGlobalFold')) foldM *= 1 + P.res2.foldStageCoef * r.maxStage;
    globalRes *= foldM;
  }
  // 一括焼成の量産波及(2026-07-14 ①後半希釈対策): オーブン台数で全生産が僅かに伸びる。
  // 後半周回はオーブン自身の生産シェアが消えてliftが1.0へ潰れる(diag_trio実測: run11以降1.05未満)ため、
  // 台数連動の全体項を受け皿にする。序盤は台数が少なく≈1.0で無害(序盤の受け持ちは既存のovenSelf)。
  if (resActive(sim, 'ovenBatch')) globalRes *= lg(capOwn(r.upgrades.oven || 0), R.ovenGlobal || 0);
  // 工場ネットワークの物流波及(同上・後半希釈対策): 工場台数で全生産が僅かに伸びる。
  if (resActive(sim, 'factoryNetwork')) globalRes *= lg(capOwn(r.upgrades.factory || 0), R.factoryGlobal || 0);
  // 香料調合 段階2: 熟成の香り(金取得から12秒間、全生産バースト)。mature上限60s(⑬再設計spec)。
  if (resActive(sim, 'spiceBlend') && resStage2(sim, 'spiceBlend') && sim.t < (r.spiceAromaUntil || 0)) {
    globalRes *= r.spiceBurstM || 1;
  }
  if (resActive(sim, 'blackHoleCompression')) {
    globalRes *= R.bhGlobal;
    // 段階2の圧縮チャージは earn() 側で総収入に適用(2026-07-18 R27: 旧・基礎生産のみだと後半の
    // 直送経済(アンカー=金相場)にブーストが流れず⑬の枝分かれ比が1.000に潰れる=実測)
  }
  if (resActive(sim, 'antimatterRecipe')) {
    const anti = r.upgrades.antimatterOven || 0;
    const skillCount = Object.keys(sim.skills).filter(k => sim.skills[k]).length;
    let antiM = lg(capOwn(anti), R.antimatterOwn) * lg(skillCount, R.antimatterSkill);
    if (resStage2(sim, 'antimatterRecipe')) antiM *= 1 + P.res2.antiStageCoef * r.maxStage;
    if (resStage3(sim, 'antimatterRecipe')) antiM *= 1 + P.res2.antiPrestigeCoef * sim.prestigeRuns;
    globalRes *= antiM;
  }

  // 銀河分業 段階2: 編成ボーナス(全生産)。バランス係数=所持数の幾何平均/算術平均
  if (resActive(sim, 'galaxyAssembly') && resStage2(sim, 'galaxyAssembly')) {
    const counts = [];
    for (const u of UPGRADES) { const c = r.upgrades[u.id]; if (c > 0) counts.push(c); }
    if (counts.length > 1) {
      let logSum = 0, sum = 0;
      for (const c of counts) { logSum += Math.log(c); sum += c; }
      const balance = Math.exp(logSum / counts.length) / (sum / counts.length);
      const gal = r.upgrades.galaxyFactory || 0;
      let bonus = P.res2.galaxyBonusCoef * counts.length * balance * (1 - Math.exp(-gal / P.res2.galaxySat));
      if (resStage3(sim, 'galaxyAssembly')) bonus *= 1 + P.res2.galaxyStageCoef * r.maxStage;
      globalRes *= 1 + bonus;
    }
  }

  // 研究連動の全生産倍率(第12次L・提案A): 対応研究/段3が解放されている間、全生産に一律倍率(線形floor+所持log10+層)。
  // 全生産倍率=㉘シェア相殺・③⑨他機能lift相殺・④⑤周回比相殺=条件中立で①/⑨の設備系腐りを立てる。resActive/resStage3ゲート(①⑨トグル対応)。
  const RG = P.resGlobal;
  if (RG) {
    const seg = (id, own, cfg) => resActive(sim, id) ? (1 + (cfg.floor || 0) + (cfg.own || 0) * Math.log10(1 + own) + (cfg.stage || 0) * r.maxStage) : 1;
    globalRes *= seg('portalNetwork', r.upgrades.portal || 0, RG.portal)
      * seg('galaxyAssembly', r.upgrades.galaxyFactory || 0, RG.galaxy)
      * seg('quantumProofing', r.upgrades.quantumBakery || 0, RG.quantum);
    // 段3(⑨)の全生産倍率floor: 対応段3が解放されている間だけ立つ(⑨の各回lift≥1.05)
    if (resStage3(sim, 'portalNetwork')) globalRes *= 1 + (RG.portal.s3Floor || 0);
    if (resStage3(sim, 'galaxyAssembly')) globalRes *= 1 + (RG.galaxy.s3Floor || 0);
    if (resStage3(sim, 'factoryNetwork')) globalRes *= 1 + (RG.factoryS3Floor || 0);
    // 工場網 段2の全生産floorは撤回(2026-07-16): ⑨-a factoryNetwork:2 は帯入りしたが、均一な基礎生産の底上げが
    // 金系報酬の相対lift(③-a goldenFirstHit)を薄めて7/8→6/8に劣化=差引ゼロのため不採用。⑨は18/19据置。
    // オーブン大量焼成 段3(⑨): オーブン寄与が薄い外れ周回で min<1.05 に落ちるため全生産floorで下支え(月面段2と同処方)
    if (resStage3(sim, 'ovenBatch')) globalRes *= 1 + (RG.ovenS3Floor || 0);
    if (resStage3(sim, 'spiceBlend')) globalRes *= 1 + (RG.spiceS3Floor || 0);
    // 指先の型 段3(⑨whole=会心の余熱): 会心/クリック依存で取得方針(S6等)に効果が出ないため、
    // 取得中だけの全生産floorで総クッキーに繋ぐ(2026-07-09 ユーザー承認A・枝分かれmeasureで判定)。既存の余熱effectは残置。
    if (resStage3(sim, 'fingerTechnique')) globalRes *= 1 + (RG.fingerS3Floor || 0);
    // 月面発酵 段2(⑨): 効果は強い(幾何平均3.82)が余裕率の低い1周回で min<1.05 に落ちるため、全生産倍率 floor で下支え。
    if (resStage2(sim, 'moonGlobalYeast')) globalRes *= 1 + (RG.moonS2Floor || 0);
    // 観測ゆらぎ(量子証明 段2・⑬タイミング): 全生産の90秒周期の波。最適操作=山に活動を寄せる(waveOpt=2/π)、
    // 完全放置=全周期平均(waveIdle=1/π)。sim では定数乗数なので ⑬比=(1+amp·waveOpt)/(1+amp·waveIdle)=定数k
    // (安定・トラジェクトリ非依存)。晩期取得(≈idx44)なので③測定への摂動は末尾数周回のみ。増加方向。
    if (resStage2(sim, 'quantumProofing')) {
      let amp = P.res2.waveAmpBase;
      if (resStage3(sim, 'quantumProofing')) amp *= 1 + P.res2.waveStageCoef * r.maxStage;
      const wf = idleOn(sim, 'wave') ? P.timing.waveIdle : P.timing.waveOpt;
      globalRes *= 1 + amp * wf;
    }
  }
  // ③死に報酬対策(第12次P・枝分かれmeasure下で安全): 巨砕ミル(装備)/金獣変異(金)に「取得中だけ立つ全生産floor」を
  // 持たせ、効果を総クッキーに繋ぐ(取得が稀=n小でも枝分かれ比が確実に≥1.1へ)。他報酬のON/OFF比では定数として相殺=非干渉。
  if (!rwOff(sim, 'crushedMill') && (r.perks.crushedMill || 0) > 0) globalRes *= 1 + (r.perks.crushedMill || 0) * (P.rw.crushedMillProd || 0);
  if (!rwOff(sim, 'goldenBeastMutation') && (r.perks.goldenBeastMutation || 0) > 0) globalRes *= 1 + (r.perks.goldenBeastMutation || 0) * (P.rw.goldenBeastMutationProd || 0);
  if (!rwOff(sim, 'brandHunt') && (r.perks.brandHunt || 0) > 0) globalRes *= 1 + (r.perks.brandHunt || 0) * (P.rw.brandHuntProd || 0);


  // ③死に報酬対策(第12次P・枝分かれmeasure下では安全): 討伐ダメージ系報酬(割れた牙/焼き印狩り)を「討伐数×全生産倍率」へ繋ぐ。
  // ダメージ二値しきい値(killable)に吸収されず、討伐が速い方針でも討伐数に比例して総クッキーに効く経路。
  const cfKill = rwOff(sim, 'crackedFang') ? 0 : (r.perks.crackedFang || 0) * (P.rw.crackedFangKill || 0);
  const bhKill = rwOff(sim, 'brandHunt') ? 0 : (r.perks.brandHunt || 0) * (P.rw.brandHuntKill || 0);
  const brKill = rwOff(sim, 'biteRecovery') ? 0 : (r.perks.biteRecovery || 0) * (P.rw.biteRecoveryKill || 0);
  const killMulAll = 1 + (r.quotaMonsterKills || 0) * (r.perks.beastHeatFerment * effRw(sim, 'beastHeatFerment') + cfKill + bhKill + brKill);
  const killMulCps = 1 + (r.quotaMonsterKills || 0) * (r.perks.huntingCore * effRw(sim, 'huntingCore'));

  // 個別強化倍率・研究倍率・支援倍率
  const grandma = r.upgrades.grandma || 0;
  const upPerkPower = 1 + skillEffect(sim, 'upgradePerkPower')
    + (r.perks.crushedMill * effRw(sim, 'crushedMill'))
    + rewardCategoryBonus(sim, 'equipment');

  let clickRaw = 1;
  let cpsRaw = 0;
  const directContrib = [];
  for (let i = 0; i < UPGRADES.length; i++) {
    const u = UPGRADES[i];
    const owned = r.upgrades[u.id];
    if (!owned) continue;
    // 設備トグル(条件⑩): この設備の生産だけをゼロ化(所持数は他の計算式に残す・購入行動同一)
    if (sim.opt.disableUpgrade === u.id) continue;
    const boostRate = Math.max(P.upPerk.floor, P.upPerk.base - i * P.upPerk.slope) * upPerkPower;
    const personal = 1 + (r.upgradePerks[u.id] || 0) * boostRate;
    let resM = 1;
    // おばあちゃん(2026-07-15 ユーザー訂正「設備は生産固定で増やすだけ・研究買わずに最初から倍率かかるのやめて」):
    // 台数スケール(旧grandmaOwn ×1.02^台数)を撤去=台数×固定1/秒。増幅は grandmaCrowd 研究/報酬/熟練からのみ。
    if (u.id === 'grandma' && resActive(sim, 'grandmaCrowd')) resM *= R.grandmaSelf;
    // 断熱オーブン手袋(焼き加減廃止に伴う再係留・2026-07-10): オーブン生産×(1+mittPerLv×Lv)。
    // ⑮の2のovenMitt判定経路(旧・こんがり倍率/焼き上がり底上げ)をオーブン直結へ置換=研究非依存で確実に効く。
    if (u.id === 'oven') resM *= 1 + (P.ws.eqFx.mittPerLv || 0) * wsEqLv(sim, 'ovenMitt');
    if (u.id === 'oven' && resActive(sim, 'ovenBatch')) {
      resM *= R.ovenSelf * lg(capOwn(owned), R.ovenOwn) * lg(Math.max(0, r.maxStage - 1), R.ovenStage) * (policyIs(sim, 'bake') ? 1.10 : 1);
      // 段階2: 方針連動(焼成方針×1.5、それ以外×1.2。旧・焼き加減連動=システム廃止で再テーマ、値は不変)
      if (resStage2(sim, 'ovenBatch')) resM *= policyIs(sim, 'bake') ? P.res2.ovenBakeMulBake : P.res2.ovenBakeMulOther;
      // 段階3: 最高到達ノルマ層でオーブンの研究倍率が伸びる(旧・個別強化Lv依存は設備強化報酬撤廃で無効化→層依存へ再設計・増加方向)。
      // 一定の底上げ(flat)+層ランプ。flatは早い周回(層が浅い)でも⑨の各回minを満たす床。両方とも増加方向。
      if (resStage3(sim, 'ovenBatch')) resM *= (1 + (P.res2.ovenS3Flat || 0)) * (1 + (P.res2.ovenStageCoef || 0) * r.maxStage);
    }
    if (u.id === 'factory' && resActive(sim, 'factoryNetwork')) {
      const low = (r.upgrades.finger || 0) + (r.upgrades.grandma || 0) + (r.upgrades.oven || 0);
      resM *= R.factorySelf * lg(capOwn(low), R.factoryLow) * lg(capOwn(owned), R.factoryOwn);
      // 段階2の増幅は設備直送側へ一本化(2026-07-17 ユーザー指示「一つの研究の増幅変数は1つ」+⑨:
      // 工場の建物cpsは直送時代の総収入0.05%未満=ここに乗せても測定不能を実測。equipDirectIncomeのfnMが本体)
      // 段階3: 最高到達ノルマ層
      if (resStage3(sim, 'factoryNetwork')) resM *= 1 + P.res2.factoryStageCoef * r.maxStage;
    }
    if (u.id === 'spiceRack' && resActive(sim, 'spiceBlend')) {
      let m = lg(capOwn(owned), R.spiceOwn) * (policyIs(sim, 'golden') ? 1.08 : 1);
      if (sim.t < r.spiceBoostUntil) {
        m *= R.spiceGold * lg(capOwn(owned), R.spiceGoldOwn);
      }
      resM *= m;
    }
    if (u.id === 'portal' && resActive(sim, 'portalNetwork')) resM *= R.portalSelf;
    if (u.id === 'galaxyFactory' && resActive(sim, 'galaxyAssembly')) {
      const types = UPGRADES.filter(x => (r.upgrades[x.id] || 0) > 0).length;
      resM *= lg(types, R.galaxyTypes) * lg(capOwn(owned), R.galaxyOwn);
    }
    if (u.id === 'quantumBakery' && resActive(sim, 'quantumProofing')) {
      const rc = RESEARCH.filter(x => r.research[x.id]).length;
      resM *= lg(rc, R.quantumRes) * lg(capOwn(owned), R.quantumOwn);
      // 観測ゆらぎ(段2・⑬)は量子ベーカリー1種だと晩期取得時に総生産のごく一部で全体比が1.000へ潰れるため、
      // 全生産の波(下 globalRes 側)へ移設(第12次N)。ここでは適用しない。
    }
    let supM = 1;
    if (resActive(sim, 'grandmaCrowd')) {
      if (u.id === 'finger') supM *= lg(capOwn(grandma), R.grandmaSup[0]);
      if (u.id === 'oven') supM *= lg(capOwn(grandma), R.grandmaSup[1]);
      if (u.id === 'factory') supM *= lg(capOwn(grandma), R.grandmaSup[2]);
      // 段階2: 支援先に銀行・香料棚を追加
      if (resStage2(sim, 'grandmaCrowd') && (u.id === 'bank' || u.id === 'spiceRack')) supM *= lg(capOwn(grandma), P.res2.supExtra);
      // 段階3: 最高到達ノルマ層で全支援が伸びる
      if (supM > 1 && resStage3(sim, 'grandmaCrowd')) supM *= 1 + P.res2.supStageCoef * r.maxStage;
    }
    // 熟練(スキル解放・研究不要): 下位7種=職人の手 / 上位9種=工程の極み。×(1+rate)^所持数
    let mastMul = 1;
    if (i <= UPIDX.portal) {
      if (hasSkillEffect(sim, 'unlockSystem', 'masteryLow')) mastMul = Math.pow(1 + P.mastery.low, owned);
    } else if (hasSkillEffect(sim, 'unlockSystem', 'masteryHigh')) {
      mastMul = Math.pow(1 + P.mastery.high, owned);
    }
    let msMul = (r.ms && r.ms.up && r.ms.up[u.id]) || 1; // マイルストーン研究(第12次R5)
    // 効果多様化: 自設備数連動(own)=その設備の台数で伸びる / 他設備数連動(sup)=別設備の台数で伸びる
    if (r.ms && r.ms.own && r.ms.own[u.id]) msMul *= Math.pow(1 + r.ms.own[u.id], owned);
    if (r.ms && r.ms.sup && r.ms.sup[u.id]) for (const [src, rate] of r.ms.sup[u.id]) msMul *= Math.pow(1 + rate, r.upgrades[src] || 0);
    let contrib = owned * u.value * personal * resM * supM * mastMul * msMul;
    // 星屑パフェ: バフ中購入分は×1.25(所持数比で期待値化)
    const pfN = (r.parfaitUps && !wsOff(sim, 'dish:stardustParfait')) ? (r.parfaitUps[u.id] || 0) : 0;
    if (pfN > 0 && owned > 0) contrib *= 1 + (P.ws.fx.parfaitProdMul - 1) * Math.min(1, pfN / owned);
    directContrib[i] = contrib; // 系列ボーナスの参照元(この設備の直接生産。系列ぶんは含まない)
    if (u.type === 'click') clickRaw += contrib; else cpsRaw += contrib;
  }
  // 系列ボーナス(2026-07-06 ユーザー採用・第11次): スキル解放の上位設備の固有能力(研究不要)。
  // 1台につき「自分より下位の設備の直接生産(毎秒)の合計×coef」を追加生産。直接生産のみを参照する
  // ため掛け算の連鎖(又取り)にはならない。神の指はクリック型なので、クリック力×(1+coef×台数)の線形倍率。
  let godFingerLineageMul = 1;
  if (P.lineage && P.lineage.coef > 0) {
    let lowerCps = 0;
    for (let i = 0; i < UPGRADES.length; i++) {
      const u = UPGRADES[i];
      const owned = r.upgrades[u.id];
      if (owned > 0 && UPGRADE_UNLOCK_SKILLS[u.id] && sim.opt.disableUpgrade !== u.id) {
        if (u.id === 'godFinger') godFingerLineageMul = 1 + P.lineage.coef * owned;
        else cpsRaw += owned * P.lineage.coef * lowerCps;
      }
      if (u.type === 'cps' && sim.opt.disableUpgrade !== u.id) lowerCps += directContrib[i] || 0;
    }
  }

  // 銀行クリック配当
  let bankM = 1;
  if (resActive(sim, 'bankClickDividend')) {
    const bank = r.upgrades.bank || 0;
    const saved = Math.log10(r.cookies + 10);
    bankM = lg(capOwn(bank), R.bankOwn) * (1 + Math.log1p(saved) * R.bankSaved) * (policyIs(sim, 'click') ? 1.08 : 1);
  }

  let click = clickRaw * bankM * clickSkillMul * prestigeMul * globalRes * killMulAll;
  cpsRaw += (r.ms && r.ms.cpsAdd) || 0; // 効果多様化: 加算(+N/秒の固定生産)
  let cps = cpsRaw * cpsSkillMul * prestigeMul * globalRes * killMulAll * killMulCps;

  // 指先連動(毎秒生産×係数がタップ力に乗る)は研究「指先の型」解放後のみ(2026-07-15 ユーザー訂正
  // 「タップの毎秒生産加算も最初から入ってる=治せ。研究でどこかに追加」)。研究前はタップ力=clickRaw項だけ。
  const CL = P.clickLink;
  if (resActive(sim, 'fingerTechnique')) {
    // 工房: 濃厚ショコラ=クリック生産連動係数×2 / 黄金の泡立て器=×(1+0.15Lv)
    const wsClickM = (wsBuffActive(sim, 'chocoFondant') ? P.ws.fx.fondantClickMul : 1)
      * (1 + P.ws.eqFx.whiskPerLv * wsEqLv(sim, 'goldenWhisk'));
    click += cps * CL.cpsCoef * wsClickM * (1 + CL.fingerSqrt * Math.sqrt(r.upgrades.finger || 0)) * clickSkillMul;
  }
  // クリック変更 案C(神の指=クリックの上位段): 1個ごとにクリック×godFingerExp(指数)
  click *= Math.pow(CL.godFingerExp, r.upgrades.godFinger || 0);
  // 系列ボーナス(神の指): クリック力×(1+coef×台数)
  click *= godFingerLineageMul;

  // 討伐連鎖(第12次D・提案1採用): 倒し続けている間だけ全生産×(1+prodCoef×連鎖数)。
  // 連鎖数は討伐数に線形でしか増えない(共鳴型の雪だるまにならない)。途切れ・転生で0。
  const chainM = 1 + (P.chain ? P.chain.prodCoef * chainCount(sim) : 0);
  const eqFx = equip2Fx(sim); // 新装備: 効果束(2026-07-14 全面刷新: 角度別・複合あり・486種一意)
  const holdM = (!r.quotaFailed && eqFx.holdBonus > 1) ? eqFx.holdBonus : 1; // 盾: ノルマ維持中の全生産
  click *= chainM * eqFx.allMul * eqFx.clickMul * holdM; cps *= chainM * eqFx.allMul * eqFx.cpsMul * holdM;
  // 提案13「編成の心得」(2026-07-11 承認・バランス方針限定): 4稼ぎ口のそろい具合(30秒ごとに更新の遅延値=再帰回避)
  // に応じて全生産ボーナス。u=min(1, 4×最小シェア)・倍率=1+maxBonus×u
  if (sim.skills.ensemble && policyIs(sim, 'balanced') && r._ensembleM > 1) {
    click *= r._ensembleM; cps *= r._ensembleM;
  }
  // 工房: バタークッキー生地=全生産×(1+0.02×最高層)(600秒バフ・相対型)
  if (wsBuffActive(sim, 'butterCookie')) {
    const bm = 1 + P.ws.fx.butterLayerCoef * Math.max(1, r.maxStage);
    click *= bm; cps *= bm;
  }
  // 工房装備: 名匠の天板=全生産×(1+trayPerLv×Lv)(永続・転生持ち越し。2026-07-10追加)
  {
    const tm = 1 + (P.ws.eqFx.trayPerLv || 0) * wsEqLv(sim, 'masterTray');
    if (tm !== 1) { click *= tm; cps *= tm; }
  }
  // 初台ボーナス(㉑対策・静的加算): 所持中だけ効く。購入時CPS基準の固定値なので成長とともに自然消滅。
  if (sim.presenceBonus) {
    for (const bid in sim.presenceBonus) {
      if ((r.upgrades[bid] || 0) > 0) cps += sim.presenceBonus[bid];
    }
  }

  // 会心(期待値)
  let critEV = 1;
  let critChanceOut = 0;
  if (resActive(sim, 'fingerTechnique')) {
    const f = r.upgrades.finger || 0;
    const policyC = policyIs(sim, 'click') ? 0.010 : 0;
    // 会心1%開始(第9次): 開始値0.01(=会心率1.0%)+設備√+最高到達層(周回内で育つ動的項)
    const score = R.fingerBase + Math.sqrt(f) * R.fingerSqrt + (R.fingerStage || 0) * r.maxStage + policyC;
    // scoreの飽和上限6.2=会心率99.8%止まり(2026-07-11 ㉓-3「100%には到達しない」: S2の指2.8万台で100.0%到達の対策)
    const chance = Math.min(0.995, 0.995 * (score / (score + (R.critHalf || 1))) + equip2Fx(sim).critAdd + ((r.ms && r.ms.critAdd) || 0)); // 素の会心率=双曲線(上限なしで99.5%へ漸近=ゆっくり伸び続ける)・装備/研究のcritAddで早期に天井付近へ(2026-07-18 R26改・両どり設計)(㉓-3の100%到達封鎖=min0.995は維持)
    critChanceOut = chance;
    let critMul = R.fingerCritBase + score * R.fingerCritGrow;
    // 段階2: 会心コンボ(期待値: 直近30秒の会心回数。キャップ撤廃済み)
    if (resStage2(sim, 'fingerTechnique')) {
      const combo = chance * sim.strat.tapRate * P.res2.comboWindow;
      critMul *= 1 + P.res2.comboRate * combo;
    }
    critMul *= equip2Fx(sim).critValMul; // 新装備: 会心の威力系(率は上限0.3だが威力は上限なし)
    critEV = 1 + chance * (critMul - 1);
  }

  const boostM = goldenBoostMultiplier(sim) * afterheatMultiplier(sim);
  return {
    baseClick: click, clickEV: click * critEV * boostM, cps: cps * boostM,
    baseCps: cps, boostM, stage, prestigeMul, critChance: critChanceOut
  };
}

// 報酬の無効化判定(恒久 disableReward + 期待値測定の一時 _md + ㉘一括無効 _mdSet の対応)
function rwOff(sim, id) { return sim.opt.disableReward === id || sim._md === 'rw:' + id || (sim._mdSet ? sim._mdSet.has('rw:' + id) : false); }
// 討伐連鎖(第12次D・提案1採用): 最後の討伐から breakSec 以内なら連鎖が生きている。
// 討伐系機能として一時無効(_md/_mdSet 'chain')に対応=期待値方式・㉘討伐由来分解の対象
function chainOff(sim) { return sim.opt.disableChain || sim._md === 'chain' || (sim._mdSet ? sim._mdSet.has('chain') : false); }
// chainPrep 再テーマ(第12次M・カオス解消): 連戦準備は討伐連鎖の持続窓(breakSec)を Lv で延長する。
// 連鎖が長続き→連鎖数↑→全生産×(1+prodCoef×連鎖)が伸びる=飽和しない通しに効く。従来の次モンスター spawn/hp 効果は残置。増加方向のみ。
function chainBreakSec(sim) {
  const base = (P.chain && P.chain.breakSec) || 0;
  const r = sim.run;
  const cp = rwOff(sim, 'chainPrep') ? 0 : (r.perks.chainPrep || 0);
  // monsterStay 再テーマ(第12次M・飽和解消): 滞在が長い=次の討伐までの間が空いても連鎖が切れにくい、として
  // 連鎖持続窓を滞在Lvでも延長する(連鎖数で全生産×(1+prodCoef×連鎖)に効く=飽和しない)。従来の滞在窓延長は残置。増加方向のみ。
  const ms = rwOff(sim, 'monsterStay') ? 0 : (r.perks.monsterStay || 0);
  return base * (1 + cp * (P.rw.chainPrepPersist || 0) + ms * (P.rw.monsterStayChain || 0));
}
function chainCount(sim) {
  if (!P.chain || chainOff(sim)) return 0;
  const r = sim.run;
  return (sim.t - r.chainLastT) <= chainBreakSec(sim) ? r.chainN : 0;
}
// 報酬効果値(無効化対応)
function effRw(sim, id) {
  if (rwOff(sim, id)) return 0;
  return P.rw[id] != null ? P.rw[id] : 0;
}

function monsterDamage(sim, prod) {
  const r = sim.run;
  const p = Math.max(1, prod.baseClick * prod.boostM);
  // 生産火力転換(2026-07-13 ユーザー指示): モンスターダメージに毎秒生産(CPS)がそのまま乗る
  const cpsAdd = resActive(sim, 'cpsStrike') ? Math.max(0, prod.cps || 0) : 0;
  const base = Math.max(1, Math.floor(1 + Math.sqrt(p) * P.monster.dmgSqrtCoef + cpsAdd));
  const goldTarget = goldenBoostActive(sim) ? (r.perks.goldenTarget || 0) * effRw(sim, 'goldenTarget') : 0;
  const chain = r.monster ? ((r.monster.goldenChainMultiplier || 1) - 1) : 0;
  const clickOwned = (r.upgrades.finger || 0) + (r.upgrades.godFinger || 0);
  const mult = (1
    + (rwOff(sim, 'monsterDamage') ? 0 : r.perks.monsterDamage * P.rw.monsterDamage)
    + skillEffect(sim, 'monsterDamageSkill')
    + (r.perks.crackedFang || 0) * effRw(sim, 'crackedFang')
    + goldTarget + chain
    + Math.sqrt(clickOwned) * (r.perks.brandHunt || 0) * effRw(sim, 'brandHunt')
    + rewardCategoryBonus(sim, 'hunt')
    + (policyIs(sim, 'hunt') ? 0.14 : 0)
  )
    * (wsBuffActive(sim, 'hunterStew') ? P.ws.fx.stewDmg : 1)
    * (1 + P.ws.eqFx.almanacDmgPerLv * wsEqLv(sim, 'monsterAlmanac'))
    * equip2Fx(sim).dmgMul // 新装備: 討伐ダメージ系
    * ((r.ms && r.ms.hunt) || 1); // マイルストーン研究(第12次R5)
  return Math.max(1, Math.ceil(base * mult));
}

function goldenSpawnFactor(sim) {
  const r = sim.run;
  const rateLv = satLv(rwOff(sim, 'goldenRate') ? 0 : (r.perks.goldenRate || 0), P.golden.rateLvHalf);
  return Math.exp(
    -Math.max(0, rateLv) * P.golden.ratePerLv
    - Math.max(0, skillEffect(sim, 'goldenRate')) * 1.8
    - rewardCategoryBonus(sim, 'golden') * 1.2
    - (policyIs(sim, 'golden') ? 0.12 : 0)
  ) * runTempoRamp(sim)
    * (wsBuffActive(sim, 'mintIce') ? P.ws.fx.mintIceGoldenInt : 1)
    * ((P.ws && wsStageDef(sim).goldenIntMul) || 1)
    / equip2Fx(sim).goldenRateMul; // 新装備: 金出現系(アクセ甲)
}
function monsterSpawnFactor(sim) {
  const r = sim.run;
  const rateLv = satLv(rwOff(sim, 'monsterRate') ? 0 : (r.perks.monsterRate || 0), P.monster.rateLvHalf);
  const deep = Math.exp(-(rwOff(sim, 'deepPursuit') ? 0 : (r.perks.deepPursuit || 0)) * P.rw.deepPursuitSpawn);
  let portalHunt = 1;
  if (resActive(sim, 'portalNetwork')) {
    // 常時項(窓非依存・2026-07-09): 旧「窓が金で常時ON」時代の討伐テンポの土台を戻す(㉘討伐/⑨段2/③金の波及を回復)。
    // 窓は追加ブースト(portalHuntSpawn)として残し、⑬延長狩りのタイミングの遊び(窓を討伐で維持)を保つ。増幅方向のみ。
    portalHunt = ir(r.upgrades.portal || 0, P.res.portalHuntSpawnBase || 0);
    if (sim.t < r.portalHuntUntil) {
      portalHunt *= ir(r.upgrades.portal || 0, P.res.portalHuntSpawn);
      if (resStage3(sim, 'portalNetwork')) portalHunt *= Math.exp(-P.res2.huntStageCoef * r.maxStage);
    }
  }
  return Math.exp(
    -Math.max(0, rateLv) * P.monster.ratePerLv
    - Math.max(0, skillEffect(sim, 'monsterRate')) * 1.8
    - rewardCategoryBonus(sim, 'hunt') * 1.0
    - (policyIs(sim, 'hunt') ? 0.10 : 0)
  ) * deep * portalHunt * runTempoRamp(sim) * ((r.ms && r.ms.spawn) || 1)
    / (1 + Math.max(0, equip2Fx(sim).spawnMul - 1)) // 新装備: 出現短縮系
    * (wsBuffActive(sim, 'hunterStew') ? P.ws.fx.stewMonsterInt : 1)
    * (wsBuffActive(sim, 'voidTart') ? P.ws.fx.voidMonsterInt : 1);
}
function monsterLevel(sim) {
  const s = elapsed(sim);
  const early = Math.floor(Math.max(0, s - 45) / P.monster.lvEarlyDiv);
  const late = Math.floor(Math.pow(Math.max(0, s - 720) / P.monster.lvLateDiv, P.monster.lvLatePow));
  return Math.max(1, 1 + early + late);
}
function monsterHpValue(sim, level) {
  const s = elapsed(sim);
  const M = P.monster;
  const timePressure = 1 + Math.pow(Math.max(0, s - 45) / M.hpPressureDiv, M.hpPressurePow);
  let hp = M.hpBase * Math.pow(M.hpGrowth, Math.max(0, level - 1)) * timePressure;
  hp *= Math.exp(-Math.max(0, skillEffect(sim, 'monsterHpDown')));
  hp *= ((sim.run.ms && sim.run.ms.hp) || 1); // 実績研究「弱点看破」(2026-07-11)
  hp *= Math.pow(P.rw.deepPursuitHp, rwOff(sim, 'deepPursuit') ? 0 : (sim.run.perks.deepPursuit || 0));
  // ステージHP補正(工房統合): S1=×1〜S5=×60・深層=60×4^層
  if (P.ws) {
    const st = wsStageDef(sim);
    hp *= st.hpMul * (st.hpGrow ? Math.pow(st.hpGrow, sim.ws.deepLayer) : 1);
  }
  return Math.floor(hp);
}
function monsterStayMs(sim) {
  const r = sim.run;
  const rewardLv = rwOff(sim, 'monsterStay') ? 0 : Math.max(0, r.perks.monsterStay || 0);
  const mult = Math.exp(rewardLv * P.monster.stayPerLv + Math.max(0, skillEffect(sim, 'monsterStay')) * 0.12
    + (policyIs(sim, 'hunt') ? 0.10 : 0) + rewardCategoryBonus(sim, 'hunt'))
    * (r.nextMonsterStayMultiplier || 1) * ((P.ws && wsStageDef(sim).stayMul) || 1) * ((r.ms && r.ms.stay) || 1) * equip2Fx(sim).stayMul; // 新装備: 滞在系
  r.nextMonsterStayMultiplier = 1;
  return Math.max(4000, P.monster.stayBase * mult);
}
function goldenAmountMultiplier(sim) {
  const r = sim.run;
  const lv = satLv(rwOff(sim, 'goldenAmount') ? 0 : r.perks.goldenAmount, P.golden.amountLvHalf);
  // 第12次K: 金報酬トリオ(連鎖/照準/初撃)+獣の匂いを金の即時獲得量へ再テーマ(所持Lvに線形=飽和しない)。増加方向のみ。
  const trio = (rwOff(sim, 'goldenChain') ? 0 : (r.perks.goldenChain || 0)) * (P.rw.goldenChainAmount || 0)
    + (rwOff(sim, 'goldenTarget') ? 0 : (r.perks.goldenTarget || 0)) * (P.rw.goldenTargetAmount || 0)
    + (rwOff(sim, 'goldenFirstHit') ? 0 : (r.perks.goldenFirstHit || 0)) * (P.rw.goldenFirstHitAmount || 0)
    + (rwOff(sim, 'beastScent') ? 0 : (r.perks.beastScent || 0)) * (P.rw.beastScentAmount || 0)
    // goldenPower も同パターンで即時獲得量へ相乗り(2026-07-09・③instantが1.05-1.09を彷徨う恒久対策。ブースト側効果は残置・増加方向のみ)
    + (rwOff(sim, 'goldenPower') ? 0 : (r.perks.goldenPower || 0)) * (P.rw.goldenPowerAmount || 0);
  return (1 + lv * P.golden.amountPerLv + skillEffect(sim, 'goldenAmount')
    + rewardCategoryBonus(sim, 'golden') + (policyIs(sim, 'golden') ? 0.10 : 0) + trio)
    * ((sim.run.ms && sim.run.ms.golden) || 1); // マイルストーン研究(第12次R5)
}
// 序盤ブースト(第12次R4): 金の即時獲得の序盤倍率。転生回数で減衰(支払いと計測の両方に掛ける=同式性)。
function goldenEarlyMul(sim) {
  const m = P.golden.earlyMul || 1;
  if (m <= 1) return 1;
  const half = P.golden.earlyHalfRuns || 1.5;
  return 1 + (m - 1) * Math.pow(0.5, (sim.prestigeRuns || 0) / half);
}
// タップ換算アンカーの実効値(2026-07-12): 「タップ数回ぶんの金は雑魚」対策は序盤の体感の問題なので、
// clickInstantCoef は基礎値(instantCoef)へ周回数で減衰(早期ブーストと同型・中盤以降の㉘バランスに触れない)。
// 第0回=フル(40タップ)・半減期 earlyHalfRuns×3(≈2周回)で基礎4タップへ。
function clickInstantCoefEff(sim) {
  const base = P.golden.instantCoef * equip2Fx(sim).goldenAmtMul, full = (P.golden.clickInstantCoef || P.golden.instantCoef) * equip2Fx(sim).goldenAmtMul; // 新装備: 金即時系
  const half = (P.golden.earlyHalfRuns || 0.7) * (P.golden.clickAnchorHalfMul || 3);
  return base + (full - base) * Math.pow(0.5, sim.prestigeRuns / half);
}
function goldenMultiplierVal(sim) {
  const r = sim.run;
  const lv = satLv(rwOff(sim, 'goldenPower') ? 0 : r.perks.goldenPower, P.golden.powerLvHalf);
  return (P.golden.multBase + lv * P.golden.powerPerLv + skillEffect(sim, 'goldenPower')
    + rewardCategoryBonus(sim, 'golden') + (policyIs(sim, 'golden') ? 0.18 : 0))
    * (1 + P.ws.eqFx.pressPerLv * wsEqLv(sim, 'pressExtractor')); // 香料圧搾機: 金ブースト倍率×(1+0.04Lv)
}
function goldenBoostDurationMs(sim) {
  const r = sim.run;
  const gp = rwOff(sim, 'goldenPower') ? 0 : r.perks.goldenPower;
  const ga = rwOff(sim, 'goldenAmount') ? 0 : r.perks.goldenAmount;
  const perkRaw = Math.max(0, gp) * 260 + Math.max(0, ga) * 65;
  const skillRaw = Math.max(0, skillEffect(sim, 'goldenPower') * 900 + skillEffect(sim, 'goldenRate') * 1800 + skillEffect(sim, 'goldenAmount') * 700);
  const runRaw = 900 * (1 - Math.exp(-elapsed(sim) / 420));
  const policyRaw = policyIs(sim, 'golden') ? 900 : 0;
  const categoryRaw = rewardCategoryBonus(sim, 'golden') * 2400;
  const rawExtra = perkRaw + skillRaw + runRaw + policyRaw + categoryRaw;
  // 逓減式: rawExtraが伸びても追加時間はboostExtraCapに漸近する
  return P.golden.boostBase + P.golden.boostExtraCap * rawExtra / (rawExtra + P.golden.boostExtraHalf);
}

// ==== 各回の期待値方式(第12次・2026-07-06 ユーザー採用): 同一周回内で「稼ぎ力」を測る ====
// やり直し比較(replay)を廃止し、各tickで「機能込みの瞬間稼ぎ力 ÷ 機能抜きの瞬間稼ぎ力」を測って
// 周回平均(対数平均)を取る。同じ状態を2通り評価するだけなので、分かれ道のズレが原理的に発生しない。
// ==== マイルストーン研究(第12次R5・2026-07-11 ユーザー指示「第0回から研究追加して盛り沢山に。
// その場で効く(=永続の単純倍率・後で腐ってもよい=①等の腐り判定対象外とユーザー明言)。
// 設備数とか実績とかで解放」) ====
// 解放トリガ: その周回の設備所持数 / 累計実績(討伐・金・タップ・最高層・転生回数) / スキル取得。
// コスト=解放時点の毎秒生産×msCostSec秒ぶん(常に手が届く=全プレイヤーが即買いする安さのため自動購入でモデル化)。
// 効果は正の単純倍率のみ(共鳴型は禁止のまま)。周回リセットで買い直し(実績系トリガは累計なので次周回もすぐ出る)。

// スキル取得の成長効果(2026-07-23): 旧「スキル取得由来の研究(msk_/msk2_)」は撤去したが、
// その成長倍率はスキル自体の効果として内包する(ユーザー意図=クラッタの研究アイテムを消すだけで
// 成長は残す)。所持スキルごとに毎周回、下の倍率を r.ms へ自動適用(旧msk_と同一・研究購入は不要)。
// 系統ごとに効果型を散らす(倍率/加算/自設備数連動/他設備数連動/会心確率)。
function skillBranchFx(id) {
  if (id === 'upgrade_godfinger') return { critAdd: 0.04 };                 // 会心確率
  if (id.startsWith('click_')) return { click: 1.3 };                       // 倍率
  if (id.startsWith('golden_')) return { golden: 1.25 };
  if (id.startsWith('monster_') || id === 'hunt_analysis' || id.startsWith('unlock_reward_')) return { hunt: 1.3 };
  if (id.startsWith('auto_')) return { own: { oven: 0.003 } };              // 自設備数連動(オーブン台数で伸びる)
  if (id.startsWith('upgrade_')) return { cps: 1.3 };
  if (id.startsWith('economy_') || id === 'order_board') return { sup: ['bank', 'grandma', 0.002] }; // 他設備数連動
  if (id.startsWith('research_')) return { all: 1.08 };
  if (id.startsWith('reward_')) return { hunt: 1.2 };
  if (id.startsWith('workshop_')) return { dropAdd: 1 };                    // 加算(素材)
  if (id.startsWith('start_') || id === 'offline_1' || id === 'endless_oven') return { cpsAdd: 50 }; // 加算(+固定生産)
  return { all: 1.1 };
}
// 1つのfxを r.ms へ乗算/加算(applyMs と同じ写像)。
function applySkillFxToMs(ms, fx) {
  if (fx.up) for (const k in fx.up) ms.up[k] = (ms.up[k] || 1) * fx.up[k];
  if (fx.click) ms.click *= fx.click;
  if (fx.cps) ms.cps = (ms.cps || 1) * fx.cps;
  if (fx.all) ms.all *= fx.all;
  if (fx.golden) ms.golden *= fx.golden;
  if (fx.hunt) ms.hunt *= fx.hunt;
  if (fx.dropAdd) ms.dropAdd += fx.dropAdd;
  if (fx.cpsAdd) ms.cpsAdd = (ms.cpsAdd || 0) + fx.cpsAdd;
  if (fx.own) for (const k in fx.own) ms.own[k] = (ms.own[k] || 0) + fx.own[k];
  if (fx.sup) { const [up, src, rate] = fx.sup; (ms.sup[up] = ms.sup[up] || []).push([src, rate]); }
  if (fx.critAdd) ms.critAdd = (ms.critAdd || 0) + fx.critAdd;
}
// 所持スキル全ての成長倍率を r.ms へ適用(周回開始時に1回)。旧msk_=1回、旧msk2_=click/cps/golden/huntは2回。
function applySkillGrowth(sim) {
  const ms = sim.run.ms;
  for (const id in sim.skills) {
    if (!sim.skills[id]) continue;
    const fx = skillBranchFx(id);
    applySkillFxToMs(ms, fx);
    const t = Object.keys(fx)[0];
    if (t === 'click' || t === 'cps' || t === 'golden' || t === 'hunt') applySkillFxToMs(ms, fx); // 奥義(旧msk2_)
  }
}
const MILESTONE_RESEARCH = (() => {
  // 第12次R5続き4(2026-07-11 ユーザー指示「第0回研究とスキル解放研究で100ずつぐらい、コストもばらけさせて」):
  // 実績系(設備数・周回内実績)≈94本+スキル解放研究≈112本の生成器。コストは「解放時点の毎秒生産×costSec秒ぶん」で
  // 20秒(即買い)〜1500秒(貯金目標)にばらける。効果はすべて永続の単純倍率(腐り判定対象外=ユーザー明言)。
  const list = [];
  const add = (id, trig, fx, costSec) => list.push({ id, trig, fx, costSec });
  // --- 実績系(第0回から) ---
  // 設備の熟練(再設計 2026-07-24): 旧・設備別×4段=64本は「設備を一気に買うバースト」で解放イベントが
  //   団子になり㉚(解放間隔≥30秒)の主因だった(実測: 64本除外で㉚67%→85%)。効果(個別設備の熟練倍率)の
  //   総和は変えず、**総設備数の階段**でまとめて効くNT段の累積研究に再編する。総設備数は通常設備の購入と
  //   同じく経済律速で滑らかに増えるため、各段の解放は自然に≥30秒間隔になる(=通常設備の解放がペーシングOKな理由と同じ)。
  const totalEquip = sim => { let s = 0; const up = sim.run.upgrades; for (const u2 of UPGRADES) s += up[u2.id] || 0; return s; };
  const eqFx = [];
  for (const u of UPGRADES) {
    for (let ti = 0; ti < 4; ti++) {
      let fx;
      if (u.type === 'click') fx = ti % 2 === 0 ? { click: 1.35 } : { critAdd: 0.02 };       // クリック設備: 倍率と会心確率を交互
      else if (ti === 0) fx = { own: { [u.id]: 0.004 } };                                     // I: 自設備数連動(台数で伸びる)
      else if (ti === 1) fx = { up: { [u.id]: 1.4 } };                                        // II: 倍率
      else if (ti === 2) fx = { sup: [u.id, 'grandma', 0.0015] };                             // III: 他設備数連動(おばあちゃん台数で支援)
      else fx = { up: { [u.id]: 1.5 } };                                                      // IV: 倍率
      eqFx.push({ ti, fx });
    }
  }
  eqFx.sort((a, b) => a.ti - b.ti); // 深い段(高倍率)ほど後の累積段=通算設備数が増えてから効く
  // 通算設備購入数(sim.lifeEquip)の階段。周回内の総設備数だと成熟周回で1400→6500を数秒で駆け抜けて団子化するため、
  // 周回跨ぎで滑らかに増える通算値に変更(=討伐/金/タップ実績と同じ発想)。閾値は最も設備の少ない方針(通算〜190k)でも全段到達。
  // ㉚(2026-07-24 第2版): 各階段の第k段は「通算しきい値 かつ 転生 k×prestigeSpread 回目以降」で解禁。周回0では各系列の
  // 低段しか出ない=初周回に全系列の低段が基底解放と混ざって密集する団子を防ぐ。段は転生を跨いで1つずつ分散する。
  // prestigeSpreadは全方針が到達する範囲(遅い方針でも全段解禁=全解放を壊さない)に収める。
  const psp = (P.msResearch && P.msResearch.prestigeSpread) || 0;
  const psGate = (i, cond) => (psp > 0 ? (sim => cond(sim) && (sim.prestigeRuns || 0) >= Math.floor(i * psp)) : cond);
  const eqThresholds = [400, 2000, 8000, 30000, 120000]; // 8段→5段に集約(2026-07-24 ㉚): 序盤の解放密度を下げる。効果総和は不変(束が増えるだけ)。しきい値は低め維持=効果は従来どおり早く効く(成長を遅らせない)
  // 設備熟練のコスト(2026-07-24): 「解放時点の毎秒生産×costSec」。効果は序盤から効かせたい(成長)ので しきい値は低め=
  // 各段が短い間隔で通算値を跨ぐ。㉚の解放間隔はコストの貯金時間(costSec秒)が律速する必要があり、これは収入連動でないと
  // 一定秒数にならない(固定額だと終盤は即買い=団子/序盤は買えず=全解放不能。実測でどちらも破綻)。通算しきい値ごとに
  // 発火スケールが方針間で90桁ばらつくため固定表には焼けない=収入連動(=「毎秒生産の◯秒ぶん」という相対的な固定目標)を採用。
  const eqCostSec = [120, 450, 1400, 4500, 16000];
  const NT = eqThresholds.length;
  const perTier = Math.ceil(eqFx.length / NT);
  for (let k = 0; k < NT; k++) {
    const batch = eqFx.slice(k * perTier, (k + 1) * perTier).map(e => e.fx);
    if (!batch.length) continue;
    list.push({ id: 'ms_eqmastery_t' + (k + 1), trig: psGate(k, sim => (sim.lifeEquip || 0) >= eqThresholds[k]), fxList: batch, costSec: eqCostSec[k] });
  }
  // 工場の早期強化 3段(2026-07-11 ユーザー指示「工場の段1研究が高いので、実績研究でその前にいくつか
  // 工場強化できるものを入れて」): 組立ライン網(段1)が買える前の3/6/8台で工場生産を先行強化。安価(即買い帯)
  const facEarly = [[3, 40, 1.35], [6, 80, 1.4], [8, 120, 1.45]];
  facEarly.forEach(([n, cs, m], i) => add('ms_factory_e' + (i + 1), sim => (sim.run.upgrades.factory || 0) >= n, { up: { factory: m } }, cs));
  // 討伐実績 8段(通算・2026-07-24 ㉚再編): 旧・周回内カウント(10〜1600)は毎周回 冒頭で即達成→解放が団子だった。
  //   通算討伐数(sim.lifeKills)の階段に変更=達成が周回を跨いで滑らかに分散(=eqmasteryと同じ発想)。閾値は最も
  //   討伐の少ない方針でも全段到達する範囲(通算40k〜)に収め、効果(総和)は不変=成長は維持。効果はダメージ/出現/滞在/HP/ドロップのローテ。
  const killTiers = [[400, 100, { hunt: 1.3 }], [1000, 200, { spawn: 0.85 }], [2500, 400, { stay: 1.2 }], [5000, 800, { hunt: 1.3 }],
    [9000, 1600, { hp: 0.75 }], [15000, 3000, { dropAdd: 1 }], [24000, 4500, { hunt: 1.3 }], [38000, 6000, { stay: 1.2 }]];
  killTiers.forEach(([n, cs, fx], i) => add('ms_kills_k' + (i + 1), psGate(i, sim => (sim.lifeKills || 0) >= n), fx, cs));
  // 金クッキー実績 6段(通算)
  const goldTiers = [[40, 100], [150, 300], [450, 750], [1200, 2000], [3000, 4000], [8000, 7500]];
  goldTiers.forEach(([n, cs], i) => add('ms_golden_g' + (i + 1), psGate(i, sim => (sim.lifeGoldens || 0) >= n), { golden: 1.3 }, cs));
  // タップ実績 4段(通算・2026-07-24 ㉚: 6→4に集約=序盤の解放密度を下げる。効果は倍率/会心を強めて総和維持)
  const tapTiers = [[1500, 120], [8000, 500], [30000, 1800], [110000, 6000]];
  tapTiers.forEach(([n, cs], i) => add('ms_taps_p' + (i + 1), psGate(i, sim => (sim.lifeTaps || 0) >= n), i % 2 === 0 ? { click: 1.62 } : { critAdd: 0.045 }, cs)); // 倍率と会心確率を交互

  // ノルマ層実績 4段(2026-07-24 ㉚: 6→4に集約)
  const stageTiers = [[8, 250], [30, 1200], [80, 3500], [150, 8000]];
  const stageAdd = [0, 90000, 0, 3e10]; // 奇数段のみ cpsAdd(層が深いほど大きい固定生産)
  stageTiers.forEach(([n, cs], i) => add('ms_stage_s' + (i + 1), psGate(i, sim => (sim.run.maxStage || 0) >= n), i % 2 === 0 ? { all: 1.24 } : { cpsAdd: stageAdd[i] }, cs)); // 倍率と加算を交互
  
  // 熟達実績 4段(通算・2026-07-24 ㉚再編): 旧・通算転生数(prestigeRuns)トリガは転生の瞬間=スキル束の直後に必ず
  //   解放が並び㉚の団子源だった。通算討伐数(lifeKills=戦闘中に滑らかに増える周回中盤の量)に付け替え、解放が
  //   転生境界(スキル)から切り離されて周回中盤に分散する。効果(全生産×1.2×4段)は不変=成長維持。閾値は最も
  //   討伐の少ない方針でも全段到達する範囲(通算〜40k)。
  const prTiers = [[4000, 300], [12000, 600], [25000, 1500], [40000, 3000]];
  prTiers.forEach(([n, cs], i) => add('ms_prestige_r' + (i + 1), sim => (sim.lifeKills || 0) >= n, { all: 1.2 }, cs));
  // スキル解放研究のコストは全て二倍以上違う(2026-07-16 ユーザー指示):
  // 固定コスト=スキルの深さ(はしごコスト順位)で6ティアに割った比3の階段。隣接ティアは常に≥2倍差。
  // 応用(msk_)=そのスキルのティア、奥義(msk2_)=1段上(=同一スキルでも応用<奥義を常に満たす)。
  // 旧仕様(cps×costSec)は転生直後の低毎秒生産で下限100に張り付き全msk同額=「二倍以上違う」に反したため、
  // 毎秒生産に依存しない固定額に変更(スキル解放研究は元々「安くて即買い」枠=固定でもゲーム性は不変)。
  // これによりゲームの焼き込み表(MS_COST_TABLE)・sim動的算出・build_ms_costs再生成のいずれも同じ階段を出す。
  const skResLadder = [100, 300, 900, 2700, 8100, 24300, 72900]; // 比3=隣接≥2倍。0..5=応用、+1段=奥義
  const skResTier = {};
  (function () {
    const sorted = SKILL_NODES.slice().sort((a, b) => skillCostOf(a) - skillCostOf(b));
    const NN = sorted.length;
    sorted.forEach((n, rank) => { skResTier[n.id] = Math.min(5, Math.floor(rank * 6 / NN)); });
  })();
  // スキル取得由来の実績研究(msk_/msk2_)は撤去(2026-07-22 ユーザー指示「スキルを取得したことによる実績研究は全て消して」)。
  return list;
})();
// 未購入で条件を満たしたものを自動購入(コスト=cps×msCostSec。安さゆえ全プレイヤー即買いのモデル)
function msCostOf(sim, m, prod) {
  // コストはゲーム内で固定(2026-07-11 / 2026-07-22 ユーザー再指示「研究のコストはゲーム内で固定に」):
  // 焼き込み表(ms_costs.json)を優先。表に無いidだけ動的式(表生成にも使う)。収入連動の床は使わない。
  const costSec = m.costSec != null ? m.costSec : ((P.msResearch && P.msResearch.costSec != null) ? P.msResearch.costSec : 30);
  const fixed = P.msResearch && P.msResearch.costTable && P.msResearch.costTable[m.id];
  const mul = (P.msResearch && P.msResearch.costMul) || 1; // ㉚チューニング用の一時ノブ(焼き込み前の探索)
  const base = fixed != null ? fixed : (m.cost != null ? m.cost : Math.max(100, (prod ? prod.cps : 0) * costSec)); // コストはゲーム内固定(表優先)
  return base * mul;
}
function applyMsFx(r, fx) {
  if (fx.up) for (const k in fx.up) r.ms.up[k] = (r.ms.up[k] || 1) * fx.up[k];
  if (fx.click) r.ms.click *= fx.click;
  if (fx.cps) r.ms.cps = (r.ms.cps || 1) * fx.cps;
  if (fx.all) r.ms.all *= fx.all;
  if (fx.golden) r.ms.golden *= fx.golden;
  if (fx.hunt) r.ms.hunt *= fx.hunt;
  if (fx.dropAdd) r.ms.dropAdd += fx.dropAdd;
  if (fx.spawn) r.ms.spawn = (r.ms.spawn || 1) * fx.spawn;
  if (fx.stay) r.ms.stay = (r.ms.stay || 1) * fx.stay;
  if (fx.hp) r.ms.hp = (r.ms.hp || 1) * fx.hp;
  if (fx.cpsAdd) r.ms.cpsAdd = (r.ms.cpsAdd || 0) + fx.cpsAdd;
  if (fx.own) for (const k in fx.own) r.ms.own[k] = (r.ms.own[k] || 0) + fx.own[k];
  if (fx.sup) { const [up, src, rate] = fx.sup; (r.ms.sup[up] = r.ms.sup[up] || []).push([src, rate]); }
  if (fx.critAdd) r.ms.critAdd = (r.ms.critAdd || 0) + fx.critAdd;
}
function applyMs(sim, m, cost) {
  const r = sim.run;
  r.cookies -= cost;
  if (m.repeatSec) { (r._msRepeatT || (r._msRepeatT = {}))[m.id] = sim.t; r.ms.bought[m.id] = (r.ms.bought[m.id] || 0) + 1; }
  else r.ms.bought[m.id] = true;
  if (!sim.msCostLog) sim.msCostLog = {};
  if (!sim.msCostLog[m.id]) sim.msCostLog[m.id] = cost; // 初回購入時の支払額(固定コスト表の生成用)
  // 設備熟練(ms_eqmastery_*)は総設備数の階段で旧64本ぶんの効果を「まとめて」適用=fxList
  if (m.fxList) for (const fx of m.fxList) applyMsFx(r, fx);
  else applyMsFx(r, m.fx);
  if (!sim.everMs) sim.everMs = {};
  if (!sim.everMs[m.id]) { sim.everMs[m.id] = true; pushUnlock(sim, 'research', m.id); } // 実績研究も解放イベント(㉚対象・≥30秒)
}
// 実績/スキル研究の取得(2026-07-22 ユーザー指示「自動購入は廃止。実績達成したら購入可(=手動の熟慮購入)」):
// 旧・毎tickの一括自動購入(トリガ成立の全カードを同時取得=㉚解放ラッシュの主犯かつ「無料で降ってくる」)を廃止。
// 実績研究は**実績を達成すると購入可になり、プレイヤーが手が届いたら買う熟慮購入**(ゲームの棚=1番下に並ぶ挙動と一致)。
// simの表現: 各tickに**1つだけ**、達成済み・未取得・予算規律(msBudgetRatio=所持の一部)内の最安を取得
//   =他の購入とクッキーを取り合う機会費用が発生する(無料の一括グラブでない)。1周回1tick1件=解放も自然に分散。
//   repeatSec(量産体制=生産メトロノーム)は「自動購入」でなく生産機構なので従来どおりクールダウンで維持。
//   ※周回ごとに r.ms リセット→再取得はゲームと同じ(達成トリガも購入状態も周回限り)。解放イベントは生涯初のみ発火。
function tryBuyMilestones(sim, prod) {
  const r = sim.run;
  if (!r.ms) r.ms = { up: {}, click: 1, cps: 1, all: 1, golden: 1, hunt: 1, dropAdd: 0, bought: {}, cpsAdd: 0, own: {}, sup: {}, critAdd: 0, momentum: false };
  // スキル取得の成長効果(旧msk_/msk2_の内包)を周回開始時に1回だけ r.ms へ適用(2026-07-23)。
  if (!r._skGrowthDone) { applySkillGrowth(sim); r._skGrowthDone = true; }
  // 量産体制(repeatSec)=生産機構: 従来どおり(既取得はクールダウン再購入・初回はイベント発火)。
  for (const m of MILESTONE_RESEARCH) {
    if (!m.repeatSec) continue;
    if (r.ms.bought[m.id] && (r._msRepeatT && r._msRepeatT[m.id] || -Infinity) + m.repeatSec > sim.t) continue;
    if (!m.trig(sim)) continue;
    const cost = msCostOf(sim, m, prod);
    if (r.cookies < cost) continue;
    applyMs(sim, m, cost);
  }
  // 実績研究(非repeat)=熟慮購入: 達成済み・未取得・予算規律内の最安を1tick1件だけ取得。
  const ratio = (P.reveal && P.reveal.msBudgetRatio != null) ? P.reveal.msBudgetRatio : 0.5;
  let best = null;
  for (const m of MILESTONE_RESEARCH) {
    if (m.repeatSec || r.ms.bought[m.id]) continue;
    if (!m.trig(sim)) continue;
    const cost = msCostOf(sim, m, prod);
    if (cost > r.cookies * ratio) continue;
    if (!best || cost < best.cost) best = { m, cost };
  }
  if (best) applyMs(sim, best.m, best.cost);
}

// 稼ぎ力 = 直接生産 + 金クッキー収入率 + 討伐報酬(投資)価値率 の合成。すべて現在状態から式で算出。
// 討伐1体の価値を「生産◯秒ぶん」で近似。㉘: balancedの序盤討伐シェア(4-9%)を≥10%へ底上げ(5→7)。③⑨⑬は枝分かれrobust化済みで非干渉。
// 第12次R3: params駆動化(P.monster.killValueSec・既定7)= ㉘hunt序盤(直送ゲート前の討25-28%)を経済側で立てる調整をtune_rで振るため。
const KILL_VALUE_SEC = (P.monster && P.monster.killValueSec != null) ? P.monster.killValueSec : 7;
// earningPower は副作用のある関数(monsterStayMs 等が next*Multiplier をリセット)を呼ぶため、
// 揮発フィールドを退避・復元して純粋化する(測定が実シミュの状態を壊さないように)
function earningPowerSafe(sim) {
  const r = sim.run;
  const a = r.nextMonsterStayMultiplier, b = r.nextMonsterSpawnMultiplier, c = r.nextGoldenSpawnMultiplier, d = r.nextMonsterHpMultiplier;
  const v = earningPower(sim);
  r.nextMonsterStayMultiplier = a; r.nextMonsterSpawnMultiplier = b; r.nextGoldenSpawnMultiplier = c; r.nextMonsterHpMultiplier = d;
  return v;
}
// 設備直送生産(第12次J・提案A): 生産設備が最高層に応じた直接収入を生む。金ブースト/討伐報酬の
// 乗算を受けない独立項(設備固有の稼ぎ口)。㉘の設備シェアを後半も保つ。baseCps は素の設備生産。
// ==== ジャンル直送収入(第12次J-3・ユーザー2026-07-08「オーブンが強すぎるなら他も強く」) ====
// 各稼ぎ口(設備/金/討伐/タップ)に、そのジャンルへ投資したプレイヤーだけ強く効く独立収入を対称に用意する。
//   直送 = coef × base(=cps+タップ=生産レート) × (ジャンル投資量/ref)^countPow × (最高層-startStage)^stagePow
// base比例で後半も金/討伐に dwarf されず主役を張れる大きさになり、投資量^countPow でそのジャンルの
// プレイヤーだけ大きく効く(他方針では小さい)。すべて skill→research→効果 の順でゲートし、
// ジャンルごとにスキル解放でプレイヤーへ情報開示する(移植時)。全生産倍率ではないので㉘の独占も再発しない。
function genreDirect(sim, base, invest, cfg) {
  if (!cfg || !cfg.coef) return 0;
  const s = Math.max(0, (sim.run.maxStage || 0) - (cfg.startStage || 0));
  if (s <= 0) return 0;
  // satMax(任意): 投資倍率の飽和上限。高投資周回(perk合計1000+)で直送が独走して②改(ジャンルlift±1.5帯)を
  // 壊すのを防ぐ。低〜中投資域は raw≪satMax でほぼ線形のまま(㉘の中盤合格を保つ)。
  let raw = Math.pow(Math.max(0, invest) / (cfg.ref || 1), cfg.countPow || 2);
  if (cfg.satMax > 0) raw = raw / (1 + raw / cfg.satMax);
  return cfg.coef * base * raw * Math.pow(s, cfg.stagePow || 0.5);
}
// 方針係数の解決(第12次R続き): otherMul はスカラー(従来)または方針別マップ
// (例 {click:0.15, balanced:0.15, default:0.3})。主役方針は常に1。マップ化の動機=
// hd0.15はclick/balancedに+1ずつ効くがbakeの②改を−15壊す(C1実測)=方針ごとに最適値が違う。
function otherMulOf(sim, cfg, mainPol) {
  if (policyIs(sim, mainPol)) return 1;
  const om = cfg.otherMul;
  if (om == null) return 1;
  if (typeof om === 'object') {
    const pol = sim.run.policy;
    if (pol != null && om[pol] != null) return om[pol];
    return om.default != null ? om.default : 1;
  }
  return om;
}
// 設備直送: 投資量=オーブン所持数。ゲート=オーブン大量焼成 段階2(スキル auto_3→段階2購入→効果)。
function equipDirectIncome(sim, base, prod) {
  if (!resStage2(sim, 'ovenBatch')) return 0;
  // 方針係数: ovenBatch段2の早期化(run5〜)+coef0.1 を全方針に等しく効かせると、balanced(4つ≥10%)が
  // 0/32・click(タップ≥30%)が5/25 に崩壊する(実測2026-07-10)。焼成方針だけフルに効き、他方針は
  // 従来規模(×0.2≒旧coef0.02)に留める(bankDirectのclickBonus・ovenBakeMulBake/Otherと同処方)。
  const polM = otherMulOf(sim, P.equipDirect, 'bake');
  // アンカー=max(base, anchorGolden×金相場)(第12次R続き): 後半周回は金項/討直(金相場=clickEV連動)が
  // 複利で伸び、base(cps+タップ素点)係留の設直だけが沈む(bake後半 設直30→5-7%・balanced後半 設5-8%の正体)。
  // huntDirect「戦利品は金相場で売れる」と同型の処方=量産品も金相場で売れる。中盤は base>金相場 なので不変。
  // anchorGolden は係数(0=OFF・1=金相場フル)。1.0 は bake後半 設71%独走で②改が43→7/47に崩壊(100h実測)=係数で絞る。
  let anchor = base;
  if (P.equipDirect.anchorGolden > 0 && prod) anchor = Math.max(base, P.equipDirect.anchorGolden * goldenRateValue(sim, prod));
  // 工場ネットワーク段2の乗せ替え(2026-07-17 ⑨: 式変更): 「上位設備の種類数」ボーナスは工場の建物cps
  // (直送時代の総収入の0.05%未満=何倍でも測定不能を実測)でなく、量産ラインの出口=設備直送に乗せる。
  // テーマ整合(量産品の販路が上位設備網で広がる)。係数は小さく(hi≈8-10で+12-15%)=㉘/②の設備圧迫を避ける。
  let fnM = 1;
  if ((P.res2.factoryEqKind || 0) > 0 && resStage2(sim, 'factoryNetwork')) {
    let hi = 0;
    const r2 = sim.run;
    for (let j = UPIDX.bank; j < UPGRADES.length; j++) if ((r2.upgrades[UPGRADES[j].id] || 0) > 0) hi++;
    fnM = 1 + P.res2.factoryEqKind * hi;
  }
  return genreDirect(sim, anchor, sim.run.upgrades.oven || 0, P.equipDirect) * polM * fnM;
}
// 金直送: 投資量=金perk合計。ゲート=香料調合 段階2(スキル golden_1→段階2購入→効果)。
function goldenDirectIncome(sim, base) {
  if (!resStage2(sim, 'spiceBlend')) return 0;
  const r = sim.run;
  // 方針係数(第12次R続き・hunt/equipのotherMulと同型): 非golden方針の中盤で金直16-18%が
  // click打<30%・balanced打<10%を圧迫する対策。otherMul=1(既定)で従来どおり。
  const polM = otherMulOf(sim, P.goldenDirect, 'golden');
  // 投資量=goldenカテゴリperk合計(全7種)。旧3種(amount/power/rate)だと、goldenTarget/FirstHit等の
  // ON/OFF比が金直送に乗らず、huntDirect増幅の希釈で③instantの中央値が1.1を割る(1.02〜1.10に低下)。
  // huntDirect(hunt全8種)と対称の処方=金特化(S3)の後半周回の金シェア(㉘)も同時に立つ。
  const inv = (r.perks.goldenAmount || 0) + (r.perks.goldenPower || 0) + (r.perks.goldenRate || 0)
    + (r.perks.goldenChain || 0) + (r.perks.goldenTarget || 0) + (r.perks.goldenFirstHit || 0) + (r.perks.beastScent || 0);
  return genreDirect(sim, base, inv, P.goldenDirect) * polM;
}
// 討伐直送: 投資量=討伐perk合計。ゲート=異世界接続網 段階2(スキル monster_3→段階2購入→効果)。
function huntDirectIncome(sim, base) {
  // 提案11「戦利品の行商」(2026-07-11 ユーザー承認): 段2より前でもスキルがあれば弱い係数で先行開始。
  let gateM = 1;
  if (!resStage2(sim, 'portalNetwork')) {
    if (!sim.skills.monster_peddler) return 0;
    gateM = P.huntDirect.peddlerFrac || 0.2;
  }
  const r = sim.run;
  // 投資量=huntカテゴリperk合計(全8種)。旧4種(damage/fang/ferment/core)だと、S4が優先リスト先頭の
  // monsterRate を大量に拾う中盤周回で投資量0=直送不発(㉘hunt run18-27 の25-29%NGの原因)。
  // 第12次R3: perk直接参照→rwOffゲート付きへ(計測の同式性)。旧実装は monsterRate 等を _md で無効化しても
  // 討直の投資量が減らず、深い周回(討伐収入の本体=討直)で該当perkのliftが過小評価されていた(③monsterRate
  // 36h窓の中央値1.1割れの一因)。通常プレイでは rwOff=false のため収入は不変。
  const pk = (id) => rwOff(sim, id) ? 0 : (r.perks[id] || 0);
  const inv = pk('monsterDamage') + pk('crackedFang') + pk('beastHeatFerment') + pk('huntingCore')
    + pk('monsterRate') + pk('monsterStay') + pk('biteRecovery') + pk('brandHunt');
  // 回転ボーナス(2026-07-14 ③monsterRate後半飽和対策): 出現率perkは行商の在庫回転を上げる=
  // 投資量の飽和(satMax)と独立の上限付き乗数。高投資周回(inv≫satMax)ではmonsterRateを外しても
  // 直送が動かずliftが1.0に張り付く(S9 run14-16実測1.01-1.04)ため、この乗数がliftの床になる。
  const mrLv = pk('monsterRate');
  const rateM = 1 + (P.huntDirect.rateBonus || 0) * mrLv / (mrLv + (P.huntDirect.rateHalf || 25));
  // 方針係数: 非hunt方針の後半周回(報酬解禁スキル後=hunt perk投資が勝手に貯まる)で討伐直送が主役を
  // 押し退ける(bake S1 run25-29 討39-46%・balanced S6 run24-28 討33-53%=実測2026-07-10)のを抑える。
  const polM = otherMulOf(sim, P.huntDirect, 'hunt');
  // モンスター図鑑: 弱点を知る=討伐の実入り増(2026-07-11 再係留: 研究インフレでダメージ飽和=図鑑の限界価値ゼロのため直送へ効かせる)
  // 上限cap(同日): 無上限だと高Lvで全方針の後半討伐が×3-5に膨れ㉘bake 40→16/48に崩壊(almanac=0で37/48復帰と実測)
  const almanacM = 1 + Math.min((P.ws.eqFx.almanacHuntPerLv || 0) * wsEqLv(sim, 'monsterAlmanac'), P.ws.eqFx.almanacHuntMax || 0.5);
  return genreDirect(sim, base, inv, P.huntDirect) * polM * gateM * almanacM * rateM;
}
// タップ直送: 投資量=クリック系(神の指+強い指/10)。ゲート=指先の型 段階2(スキル click_2→段階2購入→効果)。
function tapDirectIncome(sim, base, prod) {
  // 提案10「土産の屋台」(2026-07-11 ユーザー承認): 段2より前でもスキルがあれば弱い係数で先行開始。
  // 段2でフル(gateM=1)。屋台ぶんが消える演出はない(収入は増える方向にしか動かない)。
  let gateM = 1;
  if (!resStage2(sim, 'fingerTechnique')) {
    if (!sim.skills.click_stall) return 0;
    gateM = P.tapDirect.stallFrac || 0.2;
  }
  const r = sim.run;
  const inv = (r.upgrades.godFinger || 0) + (r.upgrades.finger || 0) * 0.1;
  // 方針係数(第12次R続き・bankDirectのclickBonusと同型): click方針の中盤は銀/金直/討直に打が
  // 圧迫され打<30%が続く(S2 run21-32)。主役方針だけ厚くする増加方向の係数。clickBonus=1(既定)で従来どおり。
  // 非click方針はotherMulマップも適用可(golden後半run45-46=打33-41%が金<30%を圧迫する対策等)
  // clickBonusLate/satMaxLate(2026-07-12): click方針の係数と飽和上限をフェーズで分離。
  // アンカー時代(神指0)=clickBonus/satMax(①bankのS2 run25-32はタップ直送50%台との相対で
  // 銀行liftが決まる=ここを上げると①が割れる)、投資時代(神指>0)=clickBonusLate/satMaxLate
  // (㉘後半のタップ主役25%はここだけの問題。satMax一律800はアンカー時代のraw≈196まで倍化させ①を希釈した)。
  const lateEra = (r.upgrades.godFinger || 0) > 0;
  // otherMulLate(2026-07-17 ㉘balanced run3-8対策): 非click方針の係数も時代分離。アンカー時代は従来
  // otherMul(balanced4.0=run1-2の打60%暴走を防ぐ)、投資時代はotherMulLate(神指が少ないbalancedの
  // 投資量不足を係数で補い、中盤の打4-8%<10%を底上げ)。増加方向の新設・未定義なら従来どおり。
  const polM = policyIs(sim, 'click')
    ? ((lateEra ? P.tapDirect.clickBonusLate : 0) || P.tapDirect.clickBonus || 1)
    : ((lateEra && P.tapDirect.otherMulLate)
        ? otherMulOf(sim, { otherMul: Object.assign({}, P.tapDirect.otherMul, P.tapDirect.otherMulLate) }, 'click')
        : otherMulOf(sim, P.tapDirect, 'click'));
  const cfgTap = (lateEra && P.tapDirect.satMaxLate)
    ? Object.assign({}, P.tapDirect, { satMax: P.tapDirect.satMaxLate })
    : P.tapDirect;
  // アンカー=max(base, anchorGolden×金相場)(equipDirectと同型)。ただし**神の指(上位クリック設備)登場前だけ**:
  // balanced中盤(run25-32=神指0・指のみ)の打4-9%<10%の底上げ用=「上位設備が出るまでの下位投資(指)の換金」。
  // 神指以降は投資複利(raw無飽和)が主役=常時アンカーだと後半打85-88%に爆発しbalanced後半が全滅(E2/E3実測)。
  // anchorGolden=0(既定)で従来どおり。
  let anchor = base;
  if ((P.tapDirect.anchorGolden || 0) > 0 && prod && (r.upgrades.godFinger || 0) === 0) {
    anchor = Math.max(base, P.tapDirect.anchorGolden * goldenRateValue(sim, prod));
  }
  return genreDirect(sim, anchor, inv, cfgTap) * polM * gateM;
}
// 銀行配当(直送・第12次J-3 腐り解消): 銀行の所持数と貯蓄(総クッキー桁)で毎秒生産へ加算する独立収入。
// ゲート=銀行クリック配当研究(resActive=①測定トグル対応)。クリック方針で厚く効く(既存の×1.08と整合)。
// 所持数は log10 で床のある増幅(早い周回でも効く=①の各回minを満たす)。増加方向の変数のみ、既存bankMは保持。
function bankDirectIncome(sim, base, prod) {
  const cfg = P.bankDirect;
  if (!cfg || !cfg.coef) return 0;
  if (!resActive(sim, 'bankClickDividend')) return 0;
  const r = sim.run;
  const bank = r.upgrades.bank || 0;
  if (bank <= 0) return 0;
  // アンカー=max(base, anchorGolden×金相場)(第12次R4): equipDirectと同じ病気=深い周回で金経済だけが
  // 複利で伸び、base係留の銀行配当のliftが尻すぼみ(S2 run35-39で1.06まで沈む=①bankの窓端NGの真因)。
  if ((cfg.anchorGolden || 0) > 0 && prod) base = Math.max(base, cfg.anchorGolden * goldenRateValue(sim, prod));
  const saved = Math.log10(r.cookies + 10);
  // 方針係数(第12次R4): click=clickBonus(①bankのS2マージン)/それ以外=otherMul。anchorGolden×countPow1.8の
  // 複合で非click方針(S3金特化等)の銀行収入が深い周回で膨張し、goldenの金シェアを食った(run37+ 設備40%=実測)対策。
  const polM = policyIs(sim, 'click') ? (cfg.clickBonus || 1) : (cfg.otherMul != null ? cfg.otherMul : 1);
  // 所持数の項: log10 の床(早い周回でも効く)+ 累乗項(他直送のinvest^2に置いていかれないよう後半で追随)。両方とも増加方向。
  const ownM = 1 + (cfg.ownRate || 0) * Math.log10(1 + bank)
             + (cfg.countCoef || 0) * Math.pow(bank / (cfg.ref || 1), cfg.countPow || 1);
  return cfg.coef * base * ownM
       * (1 + Math.log1p(saved) * (cfg.savedCoef || 0)) * polM;
}
// 金クッキーの期待収入率(/秒): 間隔は spawnFactor、1回の価値は即時+ブーストの平均。
// earningPower の金項の本体。討伐直送(huntDirect)のアンカーにも使う(下記)。
function goldenRateValue(sim, prod) {
  const mean = (P.golden.spawnMin + P.golden.spawnMax) / 2;
  const interval = Math.max(1, mean * goldenSpawnFactor(sim) / 1000);
  // 即時獲得の計測は実支払い(collectGolden: max(cps, clickEV)×instantCoef×gAM)と同式にする。
  // 旧: baseClick(会心・ブースト抜き)を参照していたため、会心が育つ後半周回で金の実収入を
  // critEV×boostM 倍(10-30倍)過小評価し、S3金特化の後半の金シェアが25%へ沈んで見えていた(㉘計測歪み)。
  const instant = Math.max(prod.cps * P.golden.instantCoef, prod.clickEV * clickInstantCoefEff(sim)) * goldenAmountMultiplier(sim)
    * goldenEarlyMul(sim)
    * ((P.ws && wsStageDef(sim).goldenGain) || 1);
  const boostVal = Math.max(0, goldenMultiplierVal(sim) - 1) * prod.cps * (goldenBoostDurationMs(sim) / 1000);
  return (instant + boostVal) / 2 / interval;
}
function earningPower(sim) {
  const r = sim.run;
  const prod = computeProd(sim);
  const tapRate = sim.strat.tapRate;
  const tapOrig = prod.clickEV * (r.monster ? 0 : tapRate);
  const base = prod.cps + tapOrig; // 直接生産(モンスター中はタップは討伐へ)
  // タップ直送は base に含める(タップ稼ぎ口へ。incomeParts の tap 抽出でも同額を足す)
  let power = base + tapDirectIncome(sim, base, prod) + equipDirectIncome(sim, base, prod) + bankDirectIncome(sim, base, prod); // 設備直送→equip / タップ直送→tap / 銀行配当→equip残差
  // 金クッキー収入率(期待値/秒)+金直送→golden
  if (!(sim._mdChan && sim._mdChan.golden)) {
    power += goldenRateValue(sim, prod) + goldenDirectIncome(sim, base);
  }
  // 討伐報酬(投資)価値率: 討伐/秒 × 生産KILL_VALUE_SEC秒ぶん。ダメージ・出現・滞在の報酬がここに効く。+討伐直送→hunt
  if (!(sim._mdChan && sim._mdChan.hunt)) {
    const mean = (P.monster.spawnMin + P.monster.spawnMax) / 2;
    const interval = Math.max(1, mean * monsterSpawnFactor(sim) / 1000);
    const level = monsterLevel(sim);
    const hp = Math.max(1, monsterHpValue(sim, level));
    const dmg = Math.max(1, monsterDamage(sim, prod));
    const ttk = hp / Math.max(1e-9, dmg * tapRate); // 撃破所要秒
    const stay = monsterStayMs(sim) / 1000;
    const killable = ttk <= stay ? 1 : 0;             // 滞在内に倒せるか(滞在報酬が効く)
    // 出現頻度報酬の討伐手数ボーナス(増加方向・飽和形): killsPerSec への ttk 非依存の純乗算。
    // 兄弟の討伐報酬(滞在/連戦/深追い)を disable して測る utility比では分子分母が同じ係数で割れて比が
    // 保たれ、かつ ttk に依存しないため低生産(高ttk)局面の instant 中央値も持ち上がる。上限付きで高Lv暴走を防ぐ。
    const mrLv = rwOff(sim, 'monsterRate') ? 0 : Math.max(0, sim.run.perks.monsterRate || 0);
    const rateTempo = 1 + (P.monster.rateKillBonus || 0) * mrLv / (mrLv + (P.monster.rateKillHalf || 1));
    const killsPerSec = killable / (interval + ttk) * rateTempo;
    // 討伐直送の価値ベース=金クッキーの期待収入率(戦利品は金相場で売れる)。
    // 金の即時獲得は baseClick(godFinger指数で複利成長)を参照して無限にスケールする一方、討伐テンポは
    // 出現間隔で頭打ち(ワンパン後 killsPerSec≈1/interval)のため、後半周回で討伐由来シェアが7-9%へ
    // 構造的に沈む(㉘hunt後半NGの根本)。討伐perkへ投資したプレイヤーの直送収入を金経済と同スケールに
    // 連動させる: 金が膨らむ局面だけ討伐も釣られて立ち、金が萎む局面(S4 run27-32=killTermだけで討46-54%)
    // では直送≈0で②改(ジャンルlift±1.5帯)を壊さない。討伐perk合計^1.4連動なので S3金特化(huntInv0)は無傷。
    // ※クリック火力(clickEV×タップ率)アンカーは3時代(中盤+5-13pt/高投資期+0/爆発期+20-40pt)を
    //   分離できず②改を壊すと実測済み。kill価値項(全方針一律)の増幅も S3 の金シェア崩壊で不可(実測)。
    const huntAnchor = goldenRateValue(sim, prod);
    // 討伐頻度の飽和(2026-07-10・分解定義の細部=仮置き裁量): 高テンポ時は1体あたり価値が逓減する
    // (戦利品の限界価値)。kill項が killsPerSec×KVS で線形だと最高テンポ期(0.7-1.0体/秒)に討伐が
    // 56-63%へ独走し②改(ジャンルlift±1.5帯=上限~52%)を壊す。2乗型: 1次型(x/(1+x/K))は中位帯
    // (0.3-0.6体/秒=討30-50%の合格周回)まで削って hunt 40→17/43 に崩壊(実測)。2乗型は
    // 中位帯≤10%減・最高帯~30%減で分離できる。低テンポ(balanced序盤0.02-0.05体/秒)は無傷。
    const kpsSat = P.monster.satKps > 0 ? killsPerSec / (1 + Math.pow(killsPerSec / P.monster.satKps, 2)) : killsPerSec;
    // 希少プレミアム(第12次R続き・分解定義の細部=KVS5→7/satKpsと同じ裁量枠): 討伐が稀な時期(序盤の
    // 出現間隔律速)は1体のperk/戦利品の相対価値が大きい=1体あたり価値を低テンポほど増幅する。
    // balanced序盤(kps0.00-0.05)の討伐3-9%<10%と hunt序盤の討28%<30%の底上げ用。高テンポ帯(0.3+)は
    // ほぼ等倍で②改の[30,52]帯・satKpsの分離を保つ。scarceBonus=0で無効。
    const scarceM = (P.monster.scarceBonus || 0) > 0
      ? 1 + P.monster.scarceBonus / (1 + killsPerSec / (P.monster.scarceHalf || 0.05)) : 1;
    // killValMul(2026-07-14 ㉘balanced中盤): 討伐1体の価値の方針係数(otherMulと同型のマップ)。
    // balanced中盤の討3-6%<10%を、討伐報酬項の本体側で方針スコープに立てる(直送は投資連動=中盤に効かないため)
    const kvPol = (P.monster.killValMul && (P.monster.killValMul[sim.run.policy] != null ? P.monster.killValMul[sim.run.policy] : P.monster.killValMul.default)) || 1;
    power += kpsSat * base * KILL_VALUE_SEC * scarceM * kvPol * equip2Fx(sim).killValMul + huntDirectIncome(sim, huntAnchor);
  }
  return power;
}
// 測定対象の機能一覧(_md キー)。取得済みのものだけ測る
function measureFeatureKeys(sim) {
  const keys = [];
  for (const rr of RESEARCH) if (sim.run.research[rr.id]) keys.push('res:' + rr.id);
  for (const rw of REWARD_POOL) if (sim.run.perks[rw.id] > 0) keys.push('rw:' + rw.id);
  for (const rr of RESEARCH) { if (sim.run.research2[rr.id]) keys.push('stage:' + rr.id + ':2'); if (sim.run.research3[rr.id]) keys.push('stage:' + rr.id + ':3'); }
  if (P.chain && sim.run.kills > 0) keys.push('chain'); // 討伐連鎖(参考計測。合否は③②⑫㉘経由)
  return keys;
}
const MEASURE_POLICIES = ['balanced', 'click', 'golden', 'hunt', 'bake'];

// ==== ㉘稼ぎ口比率(2026-07-06 採用・3-2反映済み): 収入の4分解(設備生産/金/討伐由来/タップ) ====
// 【第12次J・(ii) attribution 見直し(ユーザー承認 2026-07-07)】旧方式は hunt/golden の機能セットを丸ごとオフ
// して earningPower の base(=cps+tap)を崩壊させ、その崩壊分を討伐由来/金に計上していた。だが chain・獣熱発酵・
// 狩猟核・異世界増幅などは「討伐活動連動の全生産倍率」で全方針の base を共通に押し上げるため、これを丸ごと
// 討伐由来にするのが後半95%独占の原因だった。→ 新方式では全生産倍率を base に残して全稼ぎ口で共有し(=share比で
// 相殺)、各稼ぎ口は「その直接収入項」だけで測る(下 incomeParts 参照)。旧セット(HUNT_FEATURE_SET 等)は廃止。
function incomeParts(sim, pAll) {
  const r = sim.run;
  const clear = () => { sim._bkT = -1; sim._stT = -1; };
  // ㉘ attribution 見直し(第12次J・(ii)ユーザー承認 2026-07-07):
  // 従来は hunt機能を全オフ(_mdSet=HUNT_FEATURE_SET)して earningPower の base(=cps+tap)自体を崩壊させ、
  // その崩壊分を丸ごと「討伐由来」に計上していた。だが chain/獣熱発酵/狩猟核/異世界増幅などは
  // 「討伐活動に連動して全生産を持ち上げる倍率」で、bake等あらゆる方針の生産(base)を共通に押し上げる。
  // これを丸ごと討伐由来にするのが後半95%独占(bake=3/47)の正体だった(第12次J-2実測)。
  // 【新方式】全生産倍率は base に残して全稼ぎ口で共有(=share比で相殺)し、各稼ぎ口は「その直接収入項」だけで測る:
  //   討伐由来 = 討伐報酬項(killsPerSec×base×KILL_VALUE_SEC) / 金 = 金クッキー項 / タップ = タップ項 / 設備 = cps。
  // base はフル(_mdSet=null 固定)。除外するのは _mdChan で指定した「その稼ぎ口の直接項」のみ。
  sim._mdSet = null;
  sim._mdChan = { hunt: true }; clear();
  const pNoHuntTerm = earningPowerSafe(sim);            // base + 金項(討伐報酬項のみ除外)
  sim._mdChan = { hunt: true, golden: true }; clear();
  const pCore = earningPowerSafe(sim);                  // base のみ(討伐報酬項・金項を除外)
  const prodCore = computeProd(sim);
  const tapOrig = prodCore.clickEV * (r.monster ? 0 : sim.strat.tapRate);
  const baseCore = prodCore.cps + tapOrig;
  const tapRaw = tapOrig + tapDirectIncome(sim, baseCore, prodCore); // タップ稼ぎ口=タップ項+タップ直送
  sim._mdChan = null; clear();
  if (!(pAll > 0) || !Number.isFinite(pAll) || !(pCore >= 0) || !Number.isFinite(pCore)) return null;
  const tap = Math.max(0, Math.min(tapRaw, pCore));
  const parts = {
    hunt: Math.max(0, pAll - pNoHuntTerm),
    golden: Math.max(0, pNoHuntTerm - pCore),
    tap,
    equip: Math.max(0, pCore - tap)
  };
  // 診断用の項別詳細(opt.partsDetail=diag専用。判定には使わない): 4稼ぎ口の中身を
  // cps / タップ素点 / 各直送 / 金項 / kill項 に細分する(㉘後半の設備押し上げの的を特定する道具)
  if (sim.opt.partsDetail) {
    const eqD = equipDirectIncome(sim, baseCore, prodCore);
    const bkD = bankDirectIncome(sim, baseCore, prodCore);
    const tapD = tapDirectIncome(sim, baseCore, prodCore);
    const gD = goldenDirectIncome(sim, baseCore);
    const hD = huntDirectIncome(sim, goldenRateValue(sim, prodCore));
    parts.detail = {
      cps: prodCore.cps, tap0: tapOrig, tapD, eqD, bkD,
      gRate: Math.max(0, parts.golden - gD), gD,
      killT: Math.max(0, parts.hunt - hD), huntD: hD
    };
  }
  return parts;
}
// 1サンプル: 各機能の「稼ぎ力の持ち上げ幅」を対数で積算。周回内キャッシュは都度クリアして正しく再計算
function measureTick(sim) {
  const r = sim.run;
  if (!r._meas) r._meas = {};
  const clearCaches = () => { sim._bkT = -1; sim._stT = -1; };
  clearCaches();
  const pOn = earningPowerSafe(sim);
  if (!(pOn > 0) || !Number.isFinite(pOn)) return;
  for (const key of measureFeatureKeys(sim)) {
    sim._md = key;
    clearCaches();
    const pOff = earningPowerSafe(sim);
    sim._md = null;
    clearCaches();
    if (pOff > 0 && Number.isFinite(pOff)) {
      const m = r._meas[key] || (r._meas[key] = { s: 0, n: 0 });
      m.s += Math.log(pOn / pOff); m.n++;
    }
  }
  // ⑬タイミング: idleTiming を opt で一時切替(最適操作=既定 / 放置=idle)して稼ぎ力比
  for (const tf of TIMING_KEYS) {
    const [rid, st] = tf.stage.split(':');
    const active = st === '2' ? r.research2[rid] : r.research3[rid];
    if (!active) continue;
    const savedIdle = sim.opt.idleTiming;
    sim.opt.idleTiming = tf.key; clearCaches();
    const pIdle = earningPowerSafe(sim);
    sim.opt.idleTiming = savedIdle; clearCaches();
    if (pIdle > 0 && Number.isFinite(pIdle)) {
      const m = r._meas['timing:' + tf.key] || (r._meas['timing:' + tf.key] = { s: 0, n: 0 });
      m.s += Math.log(pOn / pIdle); m.n++;
    }
  }
  // ㉘稼ぎ口比率: 各tickの収入シェアを積算し周回平均を取る(絶対量で足すと垂直成長の終盤が
  // 支配するため、シェアの単純平均=周回を通した「時間平均の稼ぎ口構成」で見る【集計方法は仮】)
  {
    const parts = incomeParts(sim, pOn);
    if (parts) {
      const tot = parts.equip + parts.golden + parts.hunt + parts.tap;
      if (tot > 0 && Number.isFinite(tot)) {
        const inc = r._inc || (r._inc = { equip: 0, golden: 0, hunt: 0, tap: 0, n: 0 });
        inc.equip += parts.equip / tot; inc.golden += parts.golden / tot;
        inc.hunt += parts.hunt / tot; inc.tap += parts.tap / tot; inc.n++;
        // ②改の前半判定用(2026-07-11 ユーザー決定A案): 累積和を10標本ごとにスナップ→周回末にn/2へ最近傍
        if (inc.n % 10 === 0) (r._incSnaps || (r._incSnaps = [])).push({ e: inc.equip, g: inc.golden, h: inc.hunt, t: inc.tap, n: inc.n });
        if (parts.detail) {
          const d = parts.detail;
          const dt = d.cps + d.tap0 + d.tapD + d.eqD + d.bkD + d.gRate + d.gD + d.killT + d.huntD;
          if (dt > 0 && Number.isFinite(dt)) {
            const acc = r._incD || (r._incD = { cps: 0, tap0: 0, tapD: 0, eqD: 0, bkD: 0, gRate: 0, gD: 0, killT: 0, huntD: 0, n: 0 });
            for (const k of Object.keys(d)) acc[k] += d[k] / dt;
            acc.n++;
          }
          // 投資量の周回末値(診断用): tapDirect等のsatMax/clickBonusを解析的に決めるための実数
          r._invLast = { oven: r.upgrades.oven || 0, godFinger: r.upgrades.godFinger || 0, finger: r.upgrades.finger || 0, bank: r.upgrades.bank || 0 };
        }
      }
    }
  }
  // ⑫文脈依存性: 5方針それぞれの稼ぎ力(この周回の中身に対して)。argmax を後で集計
  // 未達後のtickはサンプリングしない(2026-07-16 測定修正): ⑧確定形で全周回の末尾(ソフト未達〜転生)は
  // モンスターが湧かない=そこを含めるとhunt方針の稼ぎ力だけが全周回で系統的に沈み、⑫の
  // 「どの周回でもhuntが1位にならない」が測定アーティファクトとして出る(S4/S9でもbake14/19を実測)。
  // 生きている区間(未達前)で5方針を公平比較する。
  if (!r.quotaFailed) {
    if (!r._polPow) r._polPow = {};
    const savedPol = r.policy;
    for (const pol of MEASURE_POLICIES) {
      r.policy = pol; clearCaches();
      const pp = earningPowerSafe(sim);
      if (pp > 0 && Number.isFinite(pp)) r._polPow[pol] = (r._polPow[pol] || 0) + Math.log(pp);
    }
    r.policy = savedPol; clearCaches();
  }
}
// 周回終了時に _meas / _polPow を平均して記録に落とす
function finalizeMeasure(run) {
  const lift = {};
  if (run._meas) for (const [k, m] of Object.entries(run._meas)) if (m.n > 0) lift[k] = Math.exp(m.s / m.n);
  let bestPol = null, bestV = -Infinity;
  if (run._polPow) for (const [pol, v] of Object.entries(run._polPow)) if (v > bestV) { bestV = v; bestPol = pol; }
  let income = null, incomeH1 = null;
  if (run._inc && run._inc.n > 0) {
    const i = run._inc;
    income = { equip: i.equip / i.n, golden: i.golden / i.n, hunt: i.hunt / i.n, tap: i.tap / i.n };
    // 前半平均(②改のA案・2026-07-11): n/2 に最も近いスナップの累積和から
    const half = i.n / 2, snaps = run._incSnaps || [];
    let best = null;
    for (const sn of snaps) if (!best || Math.abs(sn.n - half) < Math.abs(best.n - half)) best = sn;
    if (best && best.n > 0) incomeH1 = { equip: best.e / best.n, golden: best.g / best.n, hunt: best.h / best.n, tap: best.t / best.n };
    else incomeH1 = income; // 短い周回=スナップ無しは全周回平均で代用
  }
  let incomeDetail = null;
  if (run._incD && run._incD.n > 0) {
    const d = run._incD; incomeDetail = {};
    for (const k of Object.keys(d)) if (k !== 'n') incomeDetail[k] = d[k] / d.n;
  }
  return { lift, bestPol, polPow: run._polPow || null, income, incomeH1, incomeDetail, invLast: run._invLast || null };
}
// タイミング機能(⑬)の測定: idleTiming を _md ではなく opt で切替えるため別扱い
const TIMING_KEYS = [
  { key: 'wave', stage: 'quantumProofing:2' },
  { key: 'bhCharge', stage: 'blackHoleCompression:2' },
  { key: 'mature', stage: 'spiceBlend:2' },
  { key: 'huntExtend', stage: 'portalNetwork:2' }
];

// まとめ買い割増(2026-07-06 ユーザー採用): 現在の熱量(時間減衰込み)
function surgeHeat(sim, id) {
  const sg = sim.run.surge && sim.run.surge[id];
  if (!sg || !(sg.h > 0)) return 0;
  return sg.h * Math.pow(0.5, (sim.t - sg.t) / Math.max(1, P.upSurge.halfSec));
}
function upgradeCost(sim, u) {
  const owned = sim.run.upgrades[u.id];
  const disc = Math.exp(-Math.max(0, skillEffect(sim, 'upgradeDiscount'))) * (1 - equip2Fx(sim).upDisc); // 新装備: 設備割引系
  // 所有数指数: knee以降は急勾配(大量買い占め抑制)
  const knee = P.upCost.knee || Infinity;
  const e = owned <= knee ? owned * P.upCost.ownPow : knee * P.upCost.ownPow + (owned - knee) * (P.upCost.ownPow2 || P.upCost.ownPow);
  // まとめ買い割増: (1+perBuy)^熱量。時間経過で元に戻る(=壁ができない)
  const surge = Math.pow(1 + (P.upSurge ? P.upSurge.perBuy : 0), surgeHeat(sim, u.id));
  let cost = q5cost(P.upCost.coef * Math.pow(u.base, P.upCost.basePow) * Math.pow(u.growth, e) * surge * disc);
  // 新設備の初号機ペーシング(2026-07-24 第3版): 生涯初購入(=解放イベント)は貯金はしご(firstBuyPace)で直列に
  // ペーシングする。詳細は firstBuyPace のコメント参照。2号機以降・周回の再購入は通常コスト(重税にしない=成長不変)。
  if (owned === 0 && !sim.everUpgrade[u.id]) {
    const sec = (P.upCost && (UPGRADE_UNLOCK_SKILLS[u.id] ? P.upCost.firstUnitSec : P.upCost.firstUnitSecBase)) || 0;
    cost = firstBuyPace(sim, 'up:' + u.id, cost, sec);
  }
  return cost;
}
function researchCostOf(sim, id) {
  const disc = Math.exp(-Math.max(0, skillEffect(sim, 'researchDiscount'))) * (1 - equip2Fx(sim).resDisc); // 新装備: 研究割引系
  return q5cost(P.resCost[id] * disc);
}
// 研究の段階 (1=購入 / 2,3=対応スキル取得後に購入欄へカード追加→クッキーで購入して有効化)
// disableStage='研究id:2' 等で単体効果ゼロ化(購入行動は同一。条件⑨用)
function resStage2(sim, id) { return !!sim.run.research2[id] && sim.opt.disableStage !== id + ':2' && sim._md !== 'stage:' + id + ':2' && !(sim._mdSet && sim._mdSet.has('stage:' + id + ':2')); }
function resStage3(sim, id) { return !!sim.run.research3[id] && sim.opt.disableStage !== id + ':3' && sim._md !== 'stage:' + id + ':3' && !(sim._mdSet && sim._mdSet.has('stage:' + id + ':3')); }
// 段階カードの表示条件: 前段階を購入済み かつ 対応スキルを取得済み
// ㉚初回開発ゲート(2026-07-24 第5版): 研究段階(段2/段3)の**生涯初**の開発だけ「前段の初開発から自己ベスト
// (lifeBest)を stageGapLife 層 更新してから」解禁する。同じスキルで複数の段階が一斉開放(例: upgrade_singularity が
// portalGlobalFold:2・blackHoleCompression:2・galaxyAssembly:3 を同時開放)しても、各系列の前段の初開発 lifeBest が
// 違うため解禁がばらけ、lifeBest はフロンティアのノルマでしか進まない=実時間で分散する。**生涯初限定**が肝:
// 周回毎ゲート(再購入にも毎回課税)は狩猟型の成長を破壊した(26→53周回・全解放未達)。再購入は無条件(従来どおり)。
function researchStageUnlocked(sim, id, stage) {
  const r = sim.run;
  if (!r.research[id]) return false;
  const key = id + ':' + stage;
  // 初回開発ゲート(㉚第12版): 段2/段3の**生涯初**開発は「全前提(基礎研究+前段+スキル)が初めて揃った周回
  // (アーミング)から +k 周回後」に解禁(armRunGate/STAGE_K参照)。金・台数・層・自己ベスト基準のゲートは終盤の
  // 買い戻し連鎖(1tickで収入×100・ノルマ+5〜10層)で全て貫通された(実測4種全滅)。転生回数だけはブリッツ不能
  // (T1=1周回≥20分)なので、同じ瞬間に複数カードが揃っても k の差で別々の周回に散る=周回単位の間隔が保証される。
  // 段2/3は増幅でありエンジンではないので1〜3周回の遅延で成長は止まらない。再購入(開発済み)は無条件=無税。
  const k = (P.upCost && P.upCost.stageRunGate === false) ? 0 : (STAGE_K[key] != null ? STAGE_K[key] : 1);
  if (stage === 2) {
    if (!sim.skills[RES_STAGE2[id]]) return false;
    if (!sim.everStage[key] && !armRunGate(sim, 'st:' + key, k)) return false;
    return true;
  }
  if (!r.research2[id] || !sim.skills[RES_STAGE3[id]]) return false;
  if (!sim.everStage[key] && !armRunGate(sim, 'st:' + key, k)) return false;
  return true;
}
// 段階コスト: 段1コスト×倍率。研究ごとの個別倍率(resStageCostEach: 値段割りD'用)があれば優先、
// なければ共通倍率(resStageCost)。researchDiscountは段1と同様に効く
function researchStageCostOf(sim, id, stage) {
  const disc = Math.exp(-Math.max(0, skillEffect(sim, 'researchDiscount')));
  const each = P.resStageCostEach && P.resStageCostEach[id];
  const mult = stage === 2 ? ((each && each.s2) || P.resStageCost.s2) : ((each && each.s3) || P.resStageCost.s3);
  return q5cost(P.resCost[id] * mult * disc);
}
// capv(効果キャップ)は2026-07-05のキャップ全撤廃で削除済み

// 次に買える最安スキル(未取得・前提充足)。到達連動ノルマ(gain基準)とstrategiesの転生判断が同じ景色を見る
// 毎tick呼ばれるためスキル所持数でキャッシュ(所持が変わった時だけ再走査)
function cheapestNextSkillCostSim(sim) {
  const cnt = Object.keys(sim.skills).length;
  if (sim._nextCostCache && sim._nextCostCache.cnt === cnt) return sim._nextCostCache.v;
  let best = Infinity, bestAny = Infinity;
  for (const n of SKILL_NODES) {
    if (sim.skills[n.id]) continue;
    if (!n.prereqs.every(q => sim.skills[q])) continue;
    const c = skillCostOf(n);
    bestAny = Math.min(bestAny, c);
    if (!isUtilitySkill(n.id)) best = Math.min(best, c);
  }
  const v = best !== Infinity ? best : (bestAny !== Infinity ? bestAny : null);
  sim._nextCostCache = { cnt, v };
  return v;
}
function prestigeGainOf(runCookies) {
  const t = Math.max(0, Math.floor(runCookies));
  const pp = P.prestige;
  if (t < pp.pMin) return 0;
  return Math.max(1, Math.floor(pp.pA * (1 - Math.exp(-t / pp.pD1)) + pp.pB * Math.pow(t / pp.pD2, pp.pG)));
}
function prestigeUnlockedFn(sim) {
  // 初回転生のしきい値=firstCost(2026-07-09 ユーザー・ゲーム仕様変更=500万)。以降は prestigeTotal/Runs で解放済み。
  const firstCost = (P.prestige && P.prestige.firstCost != null) ? P.prestige.firstCost : 5e6;
  return sim.totalCookies >= firstCost || sim.prestigeTotal > 0 || sim.prestigeRuns > 0;
}

// 可視アップグレード(店に並ぶもの)
// ㉚(2026-07-24): 次段の解放は「現最高段を revealCount 台 所持」してから(旧=1台で即次段)。クッキー潤沢な方針が
// 段を数秒で駆け上がって設備解放が団子になるのを防ぐ=次段に進むには現段をある程度 育てる必要があり、その育成時間ぶん
// 解放が自然に空く(コストによる足止めではなく「所持数の進行ゲート」。貯めない方針も貯める方針も同じ台数で律速される)。
function visibleUpgrades(sim) {
  const rc = (P.upCost && P.upCost.revealCount) || 1;
  const r = sim.run;
  let hi = -1, hiReady = -1;
  UPGRADES.forEach((u, i) => {
    const c = r.upgrades[u.id] || 0;
    if (c > 0) hi = Math.max(hi, i);
    if (c >= rc) hiReady = Math.max(hiReady, i);
  });
  // 次段が並ぶのは現最高「所持段」が revealCount 台に達してから。未達なら現最高所持段まで(次段はまだ)。
  let limit = Math.min(UPGRADES.length - 1, Math.max(1, hiReady + 1, hi));
  // 進行ゲート(実証版=v7a・成長と両立が確認済みの形): 後半設備(スキル解放=moon以降)の次段は「現段をこの周回で
  // 初購入したノルマ層から eqRevealLayers 層 進んでから」並ぶ。
  // ※撤回済みの変種(いずれも実測で棄却): lifeBest基準の初開発ゲート(第5版)=設備が成長エンジンの方針が循環依存で
  //   停止 / スキル取得基点(第8版)=最新設備ラッシュ型の㉚が悪化 / アーミング汎用ゲート(第9版)=全初回開発への
  //   一律課税で全解放が2〜4倍遅延。設備の取得を縛って良いのは「周回内の層進行+貯金プレミアム」まで。
  if (hi >= 0 && limit > hi && UPGRADE_UNLOCK_SKILLS[UPGRADES[limit].id]) {
    const eqGap = (P.upCost && P.upCost.eqRevealLayers) || 0;
    const baseMax = r._eqFirstMax && r._eqFirstMax[UPGRADES[hi].id];
    if (eqGap > 0 && baseMax != null && (r.maxStage || 0) < baseMax + eqGap) limit = hi;
  }
  return UPGRADES.filter((u, i) => i <= limit && upgradeUnlocked(sim, u));
}

// ================= イベント処理 =================
// クッキー数の上限: 2026-07-06 ユーザー許可「上限は超えてもよい」。クランプはしない。
// ツリー完成後の超長時間放置では浮動小数の上限(~1.8e308)を超えて Infinity 表示になり得るが許容。
// 有限性の判定は「転生する周回」のみを対象とする(転生周回の最大は ~e155 で十分収まる)。
function earn(sim, amount) {
  if (!(amount > 0)) return 0;
  // 圧縮チャージ(重力圧縮 段2)発動中は総収入ブースト(2026-07-18 R27: 時空圧縮=全ての実入りが増える。
  // 基礎生産のみだと直送経済で測定不能=⑬圧縮チャージ1.000の正体だった)
  const r0 = sim.run;
  if (r0 && sim.t < (r0.bhBoostUntil || 0)) amount *= r0.bhBoostMult || 1;
  sim.run.cookies += amount;
  sim.run.runCookies += amount;
  sim.totalCookies += amount;
  return amount;
}

function collectGolden(sim, prod) {
  sim.run.msGoldens = (sim.run.msGoldens || 0) + 1; // マイルストーン研究(第12次R5): その周回の金取得数
  sim.lifeGoldens = (sim.lifeGoldens || 0) + 1;      // ㉚(2026-07-24): 通算金取得数(実績研究の解放を周回跨ぎで分散させるため)
  const r = sim.run;
  r.goldenTaken++;
  // 香料調合 段階2: 風味の熟成(前回の金からの経過秒・上限60s で、全生産の短時間バーストが決まる)
  if (resActive(sim, 'spiceBlend') && resStage2(sim, 'spiceBlend')) {
    const mature = Math.min((P.timing.matureCapSec || 60), Math.max(0, sim.t - (r.lastGoldenT || r.startT))); // 上限60s(⑬再設計spec)
    const matureEff = idleOn(sim, 'mature') ? P.timing.matureIdleMul : 1;
    let burst = 1 + P.res2.matureRate * mature * matureEff;
    if (resStage3(sim, 'spiceBlend')) burst *= 1 + P.res2.spiceStageCoef * r.maxStage;
    r.spiceBurstM = burst;
    r.spiceAromaUntil = sim.t + P.res2.aromaDur;
  }
  r.lastGoldenT = sim.t;
  if ((r.perks.goldenChain || 0) > 0 && sim.opt.disableReward !== 'goldenChain') r.goldenChainReady = true;
  if ((r.perks.goldenFirstHit || 0) > 0 && sim.opt.disableReward !== 'goldenFirstHit') r.goldenFirstHitReady = true;
  if (resActive(sim, 'spiceBlend')) r.spiceBoostUntil = sim.t + (P.res.spiceGoldDur + Math.log1p(r.upgrades.spiceRack || 0) * 1800) / 1000;
  // ⑬延長狩り作り替え(2026-07-09・承認事項2の式変更): 狩り窓は金クッキーでは開かない(旧・金で開く/再設定は、
  // はやて連鎖の金高頻度化で「常時ON(延長無意味)」か「短すぎて窓内討伐ゼロ(延長不発)」の両端にしか倒れず死んでいた)。
  // 窓は討伐そのものが開く・維持する(下・kill側)。ここでは何もしない。

  // 期待値: 交互に即時獲得/ブースト
  sim.goldenAlt ^= 1;
  if (sim.goldenAlt === 1) {
    earn(sim, Math.max(100, prod.cps * P.golden.instantCoef, prod.clickEV * clickInstantCoefEff(sim)) * goldenAmountMultiplier(sim)
      * goldenEarlyMul(sim)
      * ((P.ws && wsStageDef(sim).goldenGain) || 1));
  } else {
    const mult = goldenMultiplierVal(sim);
    const dur = goldenBoostDurationMs(sim) / 1000;
    r.boosts.push({ mult, until: sim.t + dur });
    const timeOven = r.upgrades.timeOven || 0;
    if (timeOven > 0) {
      r.afterheats.push({
        mult: 1 + Math.sqrt(timeOven) * 0.018,
        from: sim.t + dur,
        until: sim.t + dur + (3000 + Math.log1p(timeOven) * 1400) / 1000
      });
    }
  }
  // 提案12「金は金を呼ぶ」(2026-07-11 ユーザー承認): 確率pで追いの金が1枚即出現(連鎖なし=追い金は対象外)。
  // 期待値モデル: 追い金は即時獲得型としてp×amountMulぶんを加算・取得カウントもpぶん進む。
  if (sim.skills.golden_echo && P.goldenEcho && P.goldenEcho.p > 0) {
    const pE = P.goldenEcho.p;
    earn(sim, Math.max(100, prod.cps * P.golden.instantCoef, prod.clickEV * clickInstantCoefEff(sim))
      * goldenAmountMultiplier(sim) * goldenEarlyMul(sim) * ((P.ws && wsStageDef(sim).goldenGain) || 1)
      * pE * (P.goldenEcho.amountMul || 1));
    r.goldenTaken += pE; r.msGoldens = (r.msGoldens || 0) + pE; sim.lifeGoldens = (sim.lifeGoldens || 0) + pE;
  }
}

function buildRewardOffer(sim, level, typeId) {
  const r = sim.run;
  // 鉄焼きガード等: 種類による報酬レベル加算(ゲームの rewardLvAdd と同じ)
  const lvAdd = ((P.mtype && P.mtype.rewardLvAdd && P.mtype.rewardLvAdd[typeId]) || 0)
    + ((P.ws && wsStageDef(sim).rewardLvAdd) || 0);
  // 討伐連鎖(第12次D): 報酬レベル +floor(rewardCoef×連鎖数)
  const chainLv = (P.chain ? Math.floor(P.chain.rewardCoef * chainCount(sim)) : 0) + Math.floor(equip2Fx(sim).rewardLvAdd); // 新装備: 報酬Lv系(アクセ乙)
  const baseCount = 1 + Math.floor((level + lvAdd + chainLv) / P.reward.lvPerCount);
  const deepBonus = Math.pow(P.rw.deepPursuitReward, rwOff(sim, 'deepPursuit') ? 0 : (r.perks.deepPursuit || 0));
  const penalty = Math.max(0, r.huntFocusRewardPenalty || 0);
  const count = Math.max(1,
    Math.floor(baseCount * (1 + skillEffect(sim, 'rewardBonus')) * deepBonus)
    + Math.max(0, Math.floor(r.nextRewardCountBonus || 0)) - penalty);
  r.huntFocusRewardPenalty = 0;
  // ステージボス: 選択肢+1(種類仕様・第9次)
  const bossBonus = typeId === 'boss' ? ((P.mtype && P.mtype.bossChoiceBonus) || 0) : 0;
  const choiceLimit = P.reward.choiceBase + bossBonus + Math.max(0, Math.floor(skillEffect(sim, 'rewardChoices')));

  const unlockedPerks = REWARD_POOL.filter(x => rewardUnlockedFn(sim, x));
  // モンスター報酬に「固定で設備強化(upgrade)が1枠入る」仕様は撤廃(2026-07-08 ユーザー決定)。
  // 報酬は報酬プール(perk)のみから決定的ローテーションで選ぶ。
  const offer = [];
  const pool = unlockedPerks.map(x => ({ kind: 'perk', id: x.id, category: x.category, count }));
  for (let k = 0; k < pool.length && offer.length < choiceLimit; k++) {
    const c = pool[(sim.rotIdx + k) % pool.length];
    if (!offer.some(o => o.kind === c.kind && o.id === c.id)) offer.push(c);
  }
  sim.rotIdx = (sim.rotIdx + 3) % Math.max(1, pool.length);
  return offer;
}

function applyReward(sim, choice, typeId) {
  const r = sim.run;
  const cat = choice.kind === 'perk'
    ? (REWARD_POOL.find(x => x.id === choice.id) || {}).category || 'equipment'
    : 'equipment';
  // モンスター種類×報酬相性(第9次): 増分 = max(1, floor(基本量 × 相性倍率))
  const aff = affinityOf(sim, typeId || 'normal', cat);
  const count = Math.max(1, Math.floor(choice.count * aff));
  if (choice.kind === 'perk') {
    if (sim.firstPerk[choice.id] === undefined) sim.firstPerk[choice.id] = sim.t;
    r.perks[choice.id] += count;
    if (choice.id === 'huntFocus' && !rwOff(sim, 'huntFocus')) r.huntFocusLv = (r.huntFocusLv || 0) + count;
  } else {
    r.upgradePerks[choice.id] += count;
  }
  r.rewardCategoryCounts[cat] = (r.rewardCategoryCounts[cat] || 0) + count;
  r.rewardByType[typeId || 'normal'] = (r.rewardByType[typeId || 'normal'] || 0) + count;
}

function defeatMonster(sim, mon) {
  const r = sim.run;
  const typeId = mon.typeId || 'normal';
  const M = P.mtype;
  // ⑬延長狩りのsnap(measurement専用): 段2取得後の最初の討伐時に取る=モンスターが生きている窓から測る
  if (sim._portalSnapPending && sim.opt.timingSnaps && resStage2(sim, 'portalNetwork')) {
    (sim.timingSnaps || (sim.timingSnaps = {})).portalNetwork = takeSnapshot(sim);
    sim._portalSnapPending = false;
  }
  // こつぶ群れ=3体分(討伐数・報酬イベントとも)。ボスは討伐周期をリセット
  const units = (M && M.rewardEvents && M.rewardEvents[typeId]) || 1;
  r.kills += units;
  r.killsByType[typeId] = (r.killsByType[typeId] || 0) + units;
  if (typeId === 'boss') r.killsSinceBoss = 0; else r.killsSinceBoss += units;
  wsDropMaterials(sim, mon, !!mon.overkill); // 素材ドロップ(条件ドロップ制・workshop_1ゲート)
  equip2DropOre(sim, (P.mtype && P.mtype.rewardEvents && P.mtype.rewardEvents[mon.typeId]) || 1, monsterDropStrength(mon.typeId), mon.colorTier); // 新装備: 色素材=そのモンスターの色
  // はやての運び屋: 撃破すると次の金クッキーが早く来る
  if (typeId && typeId.startsWith('speedy') && M) r.nextGoldenSpawnMultiplier *= M.speedyGoldenCut; // speedy系3変種すべて
  // 異世界接続網 段階2: 延長狩り(⑬・2026-07-09 作り替え)= 討伐のリズムを保つと狩り窓が続く。
  // 討伐のたびに窓を「今+huntExtendSec」まで張り直す(討伐間隔<huntExtendSec なら窓が途切れない)。
  // 完全放置は張り直しに気づかない=窓なし。金クッキー非依存なので常時ON/不発の両端に倒れない。
  if (resActive(sim, 'portalNetwork') && resStage2(sim, 'portalNetwork') && !idleOn(sim, 'huntExtend')) {
    r.portalHuntUntil = Math.max(r.portalHuntUntil, sim.t + P.res2.huntExtendSec);
  }
  if (!r.quotaFailed) r.quotaMonsterKills += units;
  r.msKills = (r.msKills || 0) + units; // マイルストーン研究(第12次R5): その周回の討伐数
  sim.lifeKills = (sim.lifeKills || 0) + units; // ㉚(2026-07-24): 通算討伐数(解放を周回跨ぎで分散)
  // 討伐連鎖(第12次D): breakSec以内の連続討伐で+units(こつぶ群れ=3体分)、途切れたら振出し
  if (P.chain) {
    r.chainN = (sim.t - r.chainLastT) <= chainBreakSec(sim) ? r.chainN + units : units;
    r.chainLastT = sim.t;
    if (r.chainN > r.chainMax) r.chainMax = r.chainN;
  }
  const chainPrepLv = rwOff(sim, 'chainPrep') ? 0 : (r.perks.chainPrep || 0);
  if (chainPrepLv > 0) {
    r.nextMonsterSpawnMultiplier *= Math.exp(-chainPrepLv * P.rw.chainPrepSpawn);
    r.nextMonsterHpMultiplier *= Math.pow(P.rw.chainPrepHp, chainPrepLv);
  }
  const beastScentLv = rwOff(sim, 'beastScent') ? 0 : (r.perks.beastScent || 0);
  if (beastScentLv > 0) r.nextGoldenSpawnMultiplier *= Math.exp(-beastScentLv * P.rw.beastScent);

  const focusLv = r.huntFocusLv || 0;
  let bonus = 0;
  if (focusLv > 0) { bonus += 1; r.huntFocusLv = 0; }
  const mutationLv = rwOff(sim, 'goldenBeastMutation') ? 0 : (r.perks.goldenBeastMutation || 0);
  if (mutationLv > 0 && goldenBoostActive(sim)) {
    // 期待値: 確率を蓄積して1超えで+1
    const chance = 1 - Math.exp(-(P.rw.mutationBase + mutationLv * P.rw.mutationPerLv));
    r.nextRewardCountBonus += chance;
  }
  r.nextRewardCountBonus += bonus;

  // 種類ごとの報酬イベント(こつぶ群れは1体ずつ×3回。相性は1体あたりで適用)
  r.lastKillType = typeId; // 報酬選択画面に「種類と相性倍率」が表示される(方針はこれを見て選べる)
  for (let ev = 0; ev < units; ev++) {
    const offer = buildRewardOffer(sim, mon.level, typeId);
    if (ev === 0) r.nextRewardCountBonus = 0;
    const pick = sim.strat.pickReward(sim, offer);
    if (pick) applyReward(sim, pick, typeId);
  }
}

// ================= 転生処理 =================
function cheapestUnownedSkillCost(sim) {
  // 前提を満たす購入可能ノードの最安(生産系優先、なければQoL含む)。⑭の分母
  let best = Infinity, bestAny = Infinity;
  for (const n of SKILL_NODES) {
    if (sim.skills[n.id]) continue;
    if (!n.prereqs.every(q => sim.skills[q])) continue;
    const c = skillCostOf(n);
    bestAny = Math.min(bestAny, c);
    if (!isUtilitySkill(n.id)) best = Math.min(best, c);
  }
  if (best !== Infinity) return best;
  if (bestAny !== Infinity) return bestAny;
  return null;
}
// 転生に必要な所持クッキー(2026-07-08 ゲーム仕様: 10のべき乗・転生ごとに前回より大)。
// 必要量 = 10^(costExp0 + costStep×これまでの転生回数)。prestigeRuns は転生完了ごとに+1されるので、
// 次の転生の必要量は毎回きっちり costStep 桁ぶん大きくなる。
function prestigeCostOf(sim) {
  // 転生のクッキー必要量(2026-07-11 ユーザー仕様変更・確定形): 初回転生=500万(firstCost)。
  // 2回目以降=**固定テーブル**(完成版での測定=基準方針の100hシミュレーションで、第n回の
  // 「転生した時点の毎秒生産×500」を10のべき乗に切り捨てた値。build_prestige_table.js が
  // prestige_costs.json に焼き込み、全プレイヤー共通の決まった値になる)。
  // テーブルが無い/範囲を超えた場合は同じ式の動的計算にフォールバック(=テーブル生成にも使う)。
  const pc = P.prestige || {};
  const runs = sim.prestigeRuns || 0;
  const table = pc.costTable || [];
  // 対応: 第n回(prestigeRuns=n)の必要量 = 固定テーブル(10のべき乗)。初回(table[0])も調整対象
  // (2026-07-11 ユーザー「必要転生クッキーは10のべきじょうで初回も含めて調整していい」)。
  if (table[runs] != null) return table[runs];
  if (runs === 0) return pc.firstCost != null ? pc.firstCost : 5e6;
  const base = Math.max(1, (sim.lastPrestigeCps || 0) * (pc.costCpsMul != null ? pc.costCpsMul : 500));
  const cost = Math.pow(10, Math.floor(Math.log10(base)));
  return Math.max(pc.firstCost != null ? pc.firstCost : 5e6, cost);
}
function doPrestige(sim) {
  const r = sim.run;
  // 転生には「10のべき乗・前回より大」の所持クッキー消費が必要(prestigeCostOf)
  const cost = prestigeCostOf(sim);
  if (r.cookies < cost) return false;
  const gain = prestigeGainOf(r.runCookies);
  if (gain <= 0) return false;
  // 勝利の一周: 発火予約(_victoryLapArm=戦略の判断)を実施済み(_victoryLapDone)へ変換(2026-07-17)。
  // 判断と同時にDoneを立てると⑧インターセプトの1秒遅延中にガードが転生を永久拒否するため分離。
  if (sim._victoryLapArm) { sim._victoryLapArm = false; sim._victoryLapDone = true; }
  const nextCostAt = cheapestUnownedSkillCost(sim); // ⑭: 購入前の次スキル最安
  const onHandCookies = r.cookies; // 転生時の所持クッキー(コスト控除前・第0回コスト再算定用=diag_prestige0.js)
  sim.lastPrestigeCps = computeProd(sim).cps; // テーブル生成用: この時点の毎秒(×500の10べき切捨てが次回コスト)
  r.prestigeCps = sim.lastPrestigeCps; r.prestigeCostPaid = cost;
  r.cookies -= cost;
  sim.prestige += gain;
  sim.prestigeTotal += gain;
  sim.prestigeRuns++;

  // 周回記録
  sim.runs.push({
    idx: sim.runs.length,
    startT: r.startT, endT: sim.t,
    duration: sim.t - r.startT,
    runCookies: r.runCookies,
    prestigeCookies: onHandCookies,
    quotaHold: r.quotaHoldSeconds,
    maxStage: r.maxStage,
    kills: r.kills, golden: r.goldenTaken, chainMax: r.chainMax,
    cpsSamples: r._cpsSamples || [],
    eq2Made: Object.assign({}, r.eq2Made || {}), eq2CraftTotal: r.eq2CraftTotal || 0, momBuys: r.momBuys || 0, eq2NewEquipped: (r.eq2NewEquipped || []).slice(),
    firstEscapeAt: r.firstEscapeAt != null ? r.firstEscapeAt : null,
    gain,
    researchBought: Object.keys(r.research).filter(k => r.research[k]),
    stages2: Object.keys(r.research2).filter(k => r.research2[k]),
    stages3: Object.keys(r.research3).filter(k => r.research3[k]),
    quotaFailAt: r.quotaFailAt,
    gainSeries: (sim.opt.trackGain && r.quotaFailAt != null) ? r.gainSeries : undefined,
    perks: Object.assign({}, r.perks),
    upgradePerkTotal: Object.values(r.upgradePerks).reduce((a, b) => a + b, 0),
    upCounts: Object.assign({}, r.upgrades),
    nextSkillCost: nextCostAt, gainToNext: nextCostAt ? gain / nextCostAt : null,
    critAtBuy: r.critAtBuy, critEnd: r.critNow, critMax: r.critMax,
    prestigeCps: r.prestigeCps, prestigeCostPaid: r.prestigeCostPaid, // 転生コストテーブル生成用(2026-07-11)
    killsByType: Object.assign({}, r.killsByType), rewardByType: Object.assign({}, r.rewardByType),
    wsDishes: Object.keys(r.buffs || {}), wsEq: Object.assign({}, sim.ws.eq), wsOrders: Object.assign({}, r.ordersDone), wsStageNo: r.wsStage,
    measure: finalizeMeasure(r)
  });

  // スキル購入(戦略の優先順で、買えるだけ)。※1転生あたりの取得数は「合格条件」(runner skillcap)で判定する
  // 対象であり、simに強制上限は設けない(2026-07-22 ユーザー指示「5個までは合格条件・仕様にしない」)。
  // 自然に≤5に収まるようスキルコスト/PT獲得側で調整する。
  const bought = [];
  let progress = true;
  while (progress) {
    progress = false;
    const order = sim.strat.skillOrder(sim);
    for (const id of order) {
      const node = SKILL_BY_ID[id];
      if (!node || sim.skills[id]) continue;
      if (!node.prereqs.every(q => sim.skills[q])) continue;
      const cost = skillCostOf(node);
      if (sim.prestige >= cost) {
        sim.prestige -= cost;
        sim.skills[id] = true;
        (sim._skillL || (sim._skillL = {}))[id] = sim.lifeBest || 0; // ㉚: スキル取得時の自己ベスト層(初回開発ゲートの基点)
        bought.push(id);
        progress = true;
        break;
      }
    }
  }
  if (bought.length > 0) pushUnlock(sim, 'skill', bought.join('+'), bought.length);
  wsRevealRecipes(sim); // 工房スキル取得と同秒に、既に拓けているステージのレシピを開示(T2統合)
  sim.runs[sim.runs.length - 1].skillsBought = bought.length;
  sim.runs[sim.runs.length - 1].skillIds = bought;
  sim._fx = {}; sim._fxHas = {}; sim._stT = -1; sim._bkT = -1;

  // 提案8: 今周回の天井を持ち越す(次周回の層の試練の相対基準)。表示層数は絶対累積のまま。
  // 平滑化(第12次R2続き・T1 S10対策): trialFloorRuns=2なら直近2周回のmax。S10は軽い周回(深層)と
  // 重い周回(浅層150-250m=T1超過)の交互振動を作る=重い周回にも前々回の高い天井(試練フリー帯)を
  // 残して軽い周回の挙動へ収束させる。1(既定相当)=従来どおり前回のみ。
  const tfr = (P.quota.trialFloorRuns || 1);
  sim.prevMaxStage = tfr >= 2 ? Math.max(r.maxStage, sim._prevMaxStage1 || 0) : r.maxStage;
  sim._prevMaxStage1 = r.maxStage;
  // 提案9: 今周回の長さを持ち越す(次周回の到達連動ノルマの進行比の分母)。
  // EMA平滑化(第12次R3・T1 S10の交互振動対策): 生の前回長だと「軽い周回45m→未達が早発(33m)→
  // モンスター停止で重い周回175m→分母が上限クランプ→未達が遅発→また軽い周回」の周期2振動になる
  // (数列 d_{n+1}=D(d_n) の D'<-1 型)。減衰付き d ← (1-α)d + α×今回長 で不動点へ収束させる。α=1で従来どおり。
  {
    const durNow = sim.t - r.startT;
    const alpha = (P.quota.reachEmaAlpha != null ? P.quota.reachEmaAlpha : 1);
    sim.prevDuration = sim.prevDuration > 0 ? (1 - alpha) * sim.prevDuration + alpha * durNow : durNow;
  }

  // 新周回
  sim.run = newRun(sim);
  sim.run.policy = sim.strat.pickPolicy(sim);
  const sc = Math.floor(skillEffect(sim, 'startCookies'));
  if (sc > 0) earn(sim, sc);
  scheduleGolden(sim);
  scheduleMonster(sim);
  return true;
}

function scheduleGolden(sim) {
  const r = sim.run;
  const mean = (P.golden.spawnMin + P.golden.spawnMax) / 2;
  const raw = mean * goldenSpawnFactor(sim) * (r.nextGoldenSpawnMultiplier || 1);
  r.nextGoldenSpawnMultiplier = 1;
  r.goldenTimer = (1000 + raw) / 1000; // protectedWait floor 1000ms
}
function scheduleMonster(sim) {
  const r = sim.run;
  const level = monsterLevel(sim);
  const levelFactor = 1 - 0.10 * (1 - Math.exp(-level / 8));
  const mean = (P.monster.spawnMin + P.monster.spawnMax) / 2;
  const raw = mean * levelFactor * monsterSpawnFactor(sim) * (r.nextMonsterSpawnMultiplier || 1);
  r.nextMonsterSpawnMultiplier = 1;
  r.monsterTimer = (1000 + raw) / 1000;
}

// ================= メインループ =================
// 1秒ぶん進める。転生が起きたら true を返す(スナップショット/1周回分岐再実行の境界検出用)
function advanceTick(sim, strategy) {
  const dt = 1;
  {
    sim.t += dt;
    if (sim.hourly && sim.t % 60 === 0) sim.hourly.push(sim.totalCookies);
    // 直近稼ぎ率EMA(時定数90秒・2026-07-11): 注文報酬cookieの基準。周回内は指数成長のため
    // 平均稼ぎ率(獲得計/経過)では終盤レートの数百分の一になり報酬が誤差化する(㉙比1.021実測)。
    {
      const r0 = sim.run;
      const dEarn = r0.runCookies - (r0._emaLastCookies || 0);
      r0._emaLastCookies = r0.runCookies;
      const A = Math.exp(-1 / 90);
      r0.earnEma = (r0.earnEma || 0) * A + Math.max(0, dEarn) * (1 - A);
      // 提案13: 編成の心得のそろい具合を30秒ごとに更新(遅延値=同tickの生産へ再帰しない)
      if (sim.skills.ensemble && policyIs(sim, 'balanced') && sim.t % (P.ensemble && P.ensemble.updateSec || 30) === 0) {
        const pw = earningPowerSafe(sim);
        const parts = pw > 0 ? incomeParts(sim, pw) : null;
        if (parts) {
          const tot = parts.equip + parts.golden + parts.hunt + parts.tap;
          if (tot > 0 && Number.isFinite(tot)) {
            const mn = Math.min(parts.equip, parts.golden, parts.hunt, parts.tap) / tot;
            const u = Math.min(1, 4 * Math.max(0, mn));
            r0._ensembleM = 1 + (P.ensemble ? P.ensemble.maxBonus : 0.15) * u;
          }
        }
      }
      // 直近1秒の実獲得(=瞬間ペース)。末期の超成長(1桁/6秒)ではEMAが瞬間値の1/30以下に遅延するため、
      // 注文報酬cookieの基準はこちらを使う(2026-07-11 ㉙実測: EMA基準は比1.08-1.15止まり)
      r0.lastTickEarn = Math.max(0, dEarn);
    }
    // ⑬タイミング(B案・2026-07-09 ユーザー承認): 同一トラジェクトリの per-tick 稼ぎ力の幾何平均(=時間平均の稼ぎ率)を
    // 記録。opt-timing/idle-timing の2本でこれを比べると、per-run 効率(転生回数変動でカオス化)を使わず、
    // かつ全効果と比較した「操作の巧拙」を測れる。60秒ごとに1標本(コスト削減)。timing sim でのみ有効。
    if (sim.opt.trackTickPower && sim.t % 60 === 0) {
      const ep = earningPowerSafe(sim);
      if (ep > 0 && Number.isFinite(ep)) {
        const lg = Math.log(ep);
        sim._tpS = (sim._tpS || 0) + lg; sim._tpN = (sim._tpN || 0) + 1;
        // ⑬タイミングを「取得周回以降」窓で測るため per-tick 稼ぎ力を周回インデックス別にも積算(2026-07-09 ユーザー承認B)。
        const ri = sim.runs.length; // 現在進行中の周回のidx(push前=runs.length)
        if (!sim._tpByRun) sim._tpByRun = [];
        const b = sim._tpByRun[ri] || (sim._tpByRun[ri] = { s: 0, n: 0 });
        b.s += lg; b.n++;
      }
    }
    if (sim.debugTrace && sim.runs.length === sim.opt.debugRunIdx) {
      const rr = sim.run;
      { const _prod = computeProd(sim); const _q = quotaAtElapsed(sim, sim.t - rr.startT); const _dmg = monsterDamage(sim, _prod); const _lvl = monsterLevel(sim); const _hp = monsterHpValue(sim, _lvl); const _tapPS = _prod.clickEV * strategy.tapRate;
      sim.debugTrace.push({ t: sim.t, el: sim.t - rr.startT, c: rr.runCookies, cps: _prod.cps, tapPS: _tapPS, clickEV: _prod.clickEV, q: _q, qRatio: rr.runCookies>0? _q/rr.runCookies : 0, mdmg: _dmg, mhp: _hp, ttk: _dmg>0? _hp/(_dmg*strategy.tapRate):Infinity, stage: rr.maxStage, boosts: rr.boosts.length, bm: goldenBoostMultiplier(sim), mon: !!rr.monster, kills: rr.kills, gold: rr.goldenTaken }); }
    }
    const r = sim.run;
    purgeBoosts(sim);
    // afterheat 有効化(fromを過ぎたものだけ乗せる)
    r.afterheats = r.afterheats.filter(a => a.until > sim.t);
    if (!r.wsStage) r.wsStage = wsPickStage(sim); // 周回ステージ選択(転生時に選択・周回中固定)
    const prod = computeProd(sim);
    sim._lastProd = prod; // ㉑判定用: 直近の生産値
    wsAutoPlay(sim);       // 工房: 料理の維持・装備の作成(素材の嗅覚/工房の拡張スキルでゲート)
    equip2Tick(sim);       // 新装備(2026-07-13): 作成+付け替え。最初から解放=スキルゲートなし
    wsOrderTick(sim, prod); // 注文ボード(order_boardスキルでゲート)
    // ㉓(会心1%開始)用: 研究取得直後/転生時点/周回最大の会心率を記録
    if (prod.critChance > 0) {
      if (r.critAtBuy === undefined) r.critAtBuy = prod.critChance;
      r.critNow = prod.critChance;
      if (prod.critChance > r.critMax) r.critMax = prod.critChance;
    }
    // 各回の期待値測定(①②③⑨⑫⑬): 3秒ごとにサンプル。機能込み÷機能抜きの稼ぎ力を対数平均
    if (sim.opt.measure && sim.t % 3 === 0) measureTick(sim);
    let ahM = 1;
    for (const a of r.afterheats) if (sim.t >= a.from) ahM *= a.mult;

    const cpsNow = prod.cps * ahM;
    // 新条件「毎秒生産が3分おきに2倍以上」(2026-07-13 ユーザー追加): 周回内で180秒ごとにCPSをサンプル。
    // 一時ブースト(金ブースト/余熱)抜きの地力CPS(baseCps)で測る=バフ切れの下振れを「成長の停滞」に数えない
    {
      const k = Math.floor((sim.t - r.startT) / 180);
      if (k > (r._cpsK === undefined ? -1 : r._cpsK)) {
        r._cpsK = k;
        (r._cpsSamples || (r._cpsSamples = [])).push(prod.baseCps);
      }
    }
    const clickNow = prod.clickEV * ahM;

    // タップとモンスター
    const tapRate = strategy.tapRate;
    let tapsForCookies = tapRate;
    if (r.monster) {
      const dmg = monsterDamage(sim, prod);
      let firstBonus = 0;
      if (r.monster.goldenFirstHitReady && !r.monster.firstHitUsed) {
        firstBonus = dmg * ((r.perks.goldenFirstHit || 0) * effRw(sim, 'goldenFirstHit'));
        r.monster.firstHitUsed = true;
      }
      let hits = tapRate * dt;
      let dealt = hits * dmg * (1 + (r.huntFocusLv || 0)) + firstBonus;
      // 甘噛み回収
      const biteLv = rwOff(sim, 'biteRecovery') ? 0 : (r.perks.biteRecovery || 0);
      if (biteLv > 0) {
        const rawRec = dmg * clickNow * P.rw.biteRecovery * biteLv * hits;
        const softLine = Math.max(1, cpsNow * 30); // ③死に報酬対策(第12次P): 回収の天井を cps×2→×30 に引き上げ、総クッキーに効く量へ
        earn(sim, rawRec / (1 + rawRec / softLine) + Math.log1p(rawRec / softLine) * softLine * 0.4);
      }
      const hpBefore = r.monster.hp;
      r.monster.hp -= dealt;
      tapsForCookies = 0;
      if (r.monster.hp <= 0) {
        r.monster.overkill = dealt >= (P.ws && P.ws.drops ? P.ws.drops.overkillMul : 5) * Math.max(1, hpBefore);
        defeatMonster(sim, r.monster);
        r.monster = null;
        scheduleMonster(sim);
      } else {
        r.monster.stayLeft -= dt;
        if (r.monster.stayLeft <= 0) {
          // 逃した(T3c: 「全て倒せる」が崩れた最初の時刻を記録=2026-07-13 新条件)
          if (r.firstEscapeAt == null) r.firstEscapeAt = sim.t - r.startT;
          if ((r.huntFocusLv || 0) > 0) {
            r.nextMonsterHpMultiplier *= 0.75;
            r.huntFocusRewardPenalty = Math.max(r.huntFocusRewardPenalty || 0, 1);
            r.huntFocusLv = 0;
          }
          r.monster = null;
          scheduleMonster(sim);
        }
      }
    }

    // 収入(各ジャンル直送: そのジャンルへ投資したプレイヤーだけ効く独立収入を加算=㉘の各主役を後半も立たせる)
    // 討伐直送のみ金クッキーの期待収入率アンカー(earningPower の計測と同式=計測と実支払いの一致)
    const dirBase = prod.cps + prod.clickEV * (r.monster ? 0 : tapRate);
    const directAll = equipDirectIncome(sim, dirBase, prod) + goldenDirectIncome(sim, dirBase)
      + huntDirectIncome(sim, goldenRateValue(sim, prod)) + tapDirectIncome(sim, dirBase, prod) + bankDirectIncome(sim, dirBase, prod);
    earn(sim, cpsNow * dt + clickNow * tapsForCookies * dt + directAll * dt);
    // 注文報酬cookie(2026-07-11 確定形=時間窓の上乗せ): 達成後 rewardCookieSec 秒間、獲得+rewardCookieMul を
    // クッキーで受け取る。一括グラントは何秒ぶんでも通らない(末期は購入テンポ律速=軌道を先に進められず、
    // 450秒ぶんでも比1.15止まりと実測)。フロー比例ならブースト報酬と同じ時間不変性で効く。
    if (r.orderCookieUntil && sim.t < r.orderCookieUntil && !wsOff(sim, 'order:cookie')) {
      earn(sim, (cpsNow + clickNow * tapsForCookies + directAll) * (P.ws.orders.rewardCookieMul || 0.5) * dt);
    }
    r.msTaps = (r.msTaps || 0) + tapsForCookies * dt; // マイルストーン研究(第12次R5): その周回のタップ数
    sim.lifeTaps = (sim.lifeTaps || 0) + tapsForCookies * dt; // ㉚(2026-07-24): 通算タップ数(解放を周回跨ぎで分散)
    tryBuyMilestones(sim, prod); // 同: 解放条件を満たした即効研究を自動購入(常に手が届く安さのモデル)

    // 銀行クリック配当 段階2: 複利利息。キャップ撤廃: 硬い min(利息, 毎秒生産×2) を
    // 漸近逓減式 raw/(1+raw/soft) に置換(暴走防止。softは段3で最高層に応じ無限に伸びる)
    if (resActive(sim, 'bankClickDividend') && resStage2(sim, 'bankClickDividend')) {
      const bank = r.upgrades.bank || 0;
      if (bank > 0 && r.cookies > 0) {
        // ソフトキャップの基準をcps→max(cps, 直近稼ぎ率EMA×frac)へ(2026-07-11): cps係留では直送収入が
        // 主流の周回で利息が総収入の誤差になり、⑨bank段2/段3の持ち上げが1.000に潰れる(36h実測)ため。
        let soft = Math.max(cpsNow, (r.earnEma || 0) * (P.res2.bankIntEmaFrac || 0)) * P.res2.bankIntCapCps;
        if (resStage3(sim, 'bankClickDividend')) soft *= 1 + P.res2.bankCapStageCoef * r.maxStage;
        const raw = r.cookies * P.res2.bankIntRate * Math.log10(1 + bank);
        if (soft > 0 && raw > 0) earn(sim, raw / (1 + raw / soft) * dt);
      }
    }

    // 指先の型 段階3: 会心の余熱(会心のたびに毎秒生産×0.00025×最高層の追加獲得。キャップ撤廃)
    if (tapsForCookies > 0 && resActive(sim, 'fingerTechnique') && resStage3(sim, 'fingerTechnique') && prod.critChance > 0) {
      earn(sim, tapsForCookies * prod.critChance * cpsNow * P.res2.critCpsCoef * r.maxStage * dt);
    }

    // 重力圧縮 段階2: 圧縮チャージ(満タンで発動、期待値=即時発動)
    if (resActive(sim, 'blackHoleCompression') && resStage2(sim, 'blackHoleCompression')) {
      const bh = r.upgrades.blackHoleMixer || 0;
      r.bhCharge += Math.sqrt(bh) * dt;
      const maxUses = resStage3(sim, 'blackHoleCompression') ? 3 : 2;
      if (r.bhCharge >= P.res2.bhChargeFull && r.bhUses < maxUses && sim.t >= r.bhBoostUntil) {
        // ⑬測定用(2026-07-18 R27): snapは購入時でなく「初回発火の瞬間」。研究購入は転生直前
        // (クッキー最潤沢)に集中し、購入時snapの900s窓が周回終端で即切れ全方針1.000に死ぬのを実測
        // (portalNetworkの討伐時snapと同じ処方)。発火直前にsnap=両枝が発火判断から分岐できる。
        if (sim.opt.timingSnaps && !(sim.timingSnaps && sim.timingSnaps.blackHoleCompression)) {
          (sim.timingSnaps || (sim.timingSnaps = {})).blackHoleCompression = takeSnapshot(sim);
        }
        // タイミング(条件⑬・2026-07-09 作り替え=承認事項2の式変更): 最適操作=満タンで狙って放出(全力)/
        // 完全放置=自動で放出されるが効率が落ちる(bhIdleEff倍の増分)。旧・遅延方式(放置は気づくまでbhIdleDelay秒)は
        // 「発動が周回内に収まるか」の二値で枝分かれ比が〜1.0か>2に二極化し帯[1.05,2.0]に安定して入らないため、
        // ⑬で安定合格している熟成(matureIdleMul)と同じ「放置=効率減」型へ統一。
        let mult = 1 + P.res2.bhBoostCoef * Math.sqrt(bh) / 10;
        if (resStage3(sim, 'blackHoleCompression')) mult *= 1 + P.res2.bhBoostStageCoef * r.maxStage;
        if (idleOn(sim, 'bhCharge')) mult = 1 + (mult - 1) * (P.timing.bhIdleEff != null ? P.timing.bhIdleEff : 0.5);
        r.bhBoostMult = mult;
        r.bhBoostUntil = sim.t + P.res2.bhBoostDur;
        r.bhCharge = 0;
        r.bhUses++;
        r.bhReadyAt = null;
      }
    }

    // 金クッキー
    r.goldenTimer -= dt;
    if (r.goldenTimer <= 0) {
      if (strategy.goldenTake >= 1 || (sim.t % Math.ceil(1 / Math.max(0.01, strategy.goldenTake))) < 1) {
        collectGolden(sim, prod);
      }
      scheduleGolden(sim);
    }

    // 周回序盤の強制出現(30秒おき×5体)は廃止(2026-07-13 ユーザー指示「序盤の30秒おきモンスターは消して」)
    // モンスター出現
    if (!r.monster) {
      r.monsterTimer -= dt;
      if (r.monsterTimer <= 0) {
        const quota = monsterQuotaRequired(sim);
        const met = quota !== null && r.runCookies >= quota;
        if (met && !r.quotaFailed) {
          const level = monsterLevel(sim);
          const typeId = pickMonsterType(sim);
          const colorTier = pickColorTier(sim); // 色(強さ段)=ノルマ層の確率分布(2026-07-15)
          const colorHp = Math.pow((P.mcolor && P.mcolor.hpMul) || 1.08, colorTier - 1); // 上位色ほど一段強い
          const tHp = (P.mtype && P.mtype.hpMul && P.mtype.hpMul[typeId]) || 1;
          const tStay = (P.mtype && P.mtype.stayMul && P.mtype.stayMul[typeId]) || 1;
          // タップ床(旧・最低HP40=「4発以上叩かないと倒せない」制限)撤去(2026-07-22 ユーザー指示):
          // 討伐の難度は最低HPの下支えでなく本来のHPスケール(hpBase/hpGrowth/時間圧/ステージ)だけで作る。
          // 序盤の弱個体はワンタップ可・後半はHPが火力を追い越して「倒せなくなる」=ノルマ未達より先に壁が来る設計。
          const maxHp = Math.max(1, Math.floor(monsterHpValue(sim, level) * tHp * colorHp * (r.nextMonsterHpMultiplier || 1)));
          r.nextMonsterHpMultiplier = 1;
          r.monster = {
            typeId, colorTier, level, hp: maxHp, maxHp,
            stayLeft: monsterStayMs(sim) * tStay / 1000,
            goldenChainMultiplier: r.goldenChainReady ? 1 + (r.perks.goldenChain || 0) * effRw(sim, 'goldenChain') : 1,
            goldenFirstHitReady: r.goldenFirstHitReady,
            firstHitUsed: !r.goldenFirstHitReady
          };
          r.goldenChainReady = false;
          r.goldenFirstHitReady = false;
        }
        scheduleMonster(sim);
      }
    }

    // ノルマ判定(本来のノルマのみ。追跡ノルマは廃止=2026-07-06 ユーザー決定、T3a/T3bはノルマ係数で作る)
    if (!r.quotaFailed) {
      let quota = monsterQuotaRequired(sim);
      const el = elapsed(sim);
      // 到達連動ノルマ(提案9): 進行比 ρ=周回内経過秒/max(前回周回長,reachMinSec) が ρ* を越えたら未達。
      // 層ゲージ(quotaAtElapsed)には触れず、ここでの未達判定にだけ到達項を上乗せする(max)。
      // runCookies×reachCoef×ρ^reachPow と runCookies を比べる=クッキー桁に依存せず ρ で未達位置が決まる。
      // 進行を層比でなく時間比にする(未達で層が凍結するため層比は序盤に寄る=第12次H実測)。
      // 到達連動ノルマの発火基準を時間比→転生準備の進みへ(2026-07-11 第2再設計・式変更):
      // 旧・時間比(ρ=経過/前回長)は「前の周回より大幅に長い周回」で早発し、T3b維持が54-75%に割れる
      // (S4 run27: 前回3102s→今回4965s・未達2677s=54%と実測)。周回の経済的な終点=「獲得予定PTが
      // 次スキル費用に届く瞬間」に追従する gain 基準へ: gain ≥ 次スキル最安 × reachGainFrac で未達。
      // 末期は超成長のため gain 90%→100% は数十秒=維持率は周回長のブレに関係なく9割前後で安定する。
      // 従来の時間比はフォールバック(ツリー完成後 next=null の周回は基礎ノルマのみ=未達なしでOK)。
      // ⑧対応の再設計(2026-07-16): 未達の発火を「その戦略の実際の転生条件」に係留する。
      // 戦略は sim._prGainFactor(転生のgain係数1.0〜4.0)と sim._prMinSec(時間下限)を毎tick公開する。
      // 未達 = 経過 ≥ 下限×0.98 かつ gain ≥ max(次スキル束, 前回目標×1.57)×係数×reachGainFrac(0.983)。
      // → どの方針でも「転生の一歩手前」で必ず未達が起きる(⑧が構造的に成立)。全周回一様=④の梯子比を保つ・
      //   run0も前回長不要・勝利の一周(基礎ノルマが無い周回)にも効く(quota非依存で発火)。
      // 時間下限の項が無いと、下限待ちの序盤周回(gainは数百秒で到達済み)で未達が早発しモンスター停止が
      // 数百秒続いて経済が崩れる。0.98=下限1200sなら未達は~1176s(窓~24s)。
      if ((P.quota.reachGainFrac || 0) > 0) {
        const relFrac = (sim._prGainFactor || 1.2) * P.quota.reachGainFrac;
        const minSec = (sim._prMinSec || 1200) * 0.98;
        if (el >= minSec) {
          const next = cheapestNextSkillCostSim(sim);
          const tgt = Math.max(next != null ? next : 0, (sim._prTarget || 0) * 1.57);
          if (tgt > 0 && prestigeGainOf(r.runCookies) >= tgt * relFrac) {
            // ソフト未達(2026-07-16 確定形): 到達連動の未達は記録のみ=モンスターは止めない。
            // 停止まで伴うと (i)未達停止帯に高額研究の購入が重なり⑬延長狩りの測定窓が全滅
            // (ii)gain未達の周回は停止で成長が失速し周回が3倍化=周回数が9→6に崩れる、を実測。
            // 実停止は転生インターセプト(転生判断true→未達→次秒転生=停止1秒)だけが行う。
            r.quotaFailed = true;
            r.quotaFailAt = el;
          }
        }
      } else if (quota !== null && quota > 0 && P.quota.reachCoef && (sim.prevDuration || 0) > 0) {
        let denom = Math.max(sim.prevDuration || 0, P.quota.reachMinSec || 0);
        if (P.quota.reachMaxSec) denom = Math.min(denom, P.quota.reachMaxSec);
        if (denom > 0) {
          const rho = el / denom;
          const reach = r.runCookies * P.quota.reachCoef * Math.pow(rho, P.quota.reachPow);
          if (reach > quota) quota = reach;
        }
      }
      if (quota !== null && quota > 0 && r.runCookies < quota) {
        r.quotaFailed = true;
        r.quotaFailAt = el; // 未達に転じた経過秒(条件⑧用)
        if (r.monster) { r.monster = null; }
      } else {
        r.quotaHoldSeconds = Math.max(r.quotaHoldSeconds, el);
      }
    }
    const st = currentStage(sim);
    if (st > r.maxStage) r.maxStage = st;
    // ㉚生涯最高到達層(2026-07-24 第5版): 初回開発ゲートの進行通貨。自己ベスト更新は本物のフロンティア
    // (ノルマ律速)でしか進まない=クッキーのスパイクや周回中盤の再登坂(速い)では動かない唯一の量。
    if (r.maxStage > (sim.lifeBest || 0)) sim.lifeBest = r.maxStage;

    // 条件⑧用: 「いま転生した場合の獲得PT」の毎秒系列を記録
    if (sim.opt.trackGain) {
      if (!r.gainSeries) r.gainSeries = [];
      r.gainSeries.push(prestigeGainOf(r.runCookies));
    }

    // ⑫(文脈依存性)用: 「次に買う最も費用対効果の高い設備」を定期サンプリング
    if (sim.opt.trackChoices && sim.t % 300 === 0) {
      const b = bestEfficiency(sim, prod, null);
      if (b) { sim.choiceSamples = sim.choiceSamples || []; sim.choiceSamples.push(b.id); }
    }

    // 購入(戦略)
    strategy.buy(sim, prod);

    // 転生判断。解放ゲート(30秒)が閉じている間は転生も待つ(転生時のスキル取得=解放イベントが
    // 直前の解放と30秒未満で並ぶのを防ぐ。遅延は最大30秒=経済影響なし)
    if (prestigeUnlockedFn(sim) && unlockGateOk(sim) && strategy.shouldPrestige(sim)) {
      // ⑧の保証(2026-07-16・到達連動ノルマの極限形): 終盤の成長はイベント(金・報酬)で塊状に跳ぶため、
      // gain基準の未達(reachGainFrac)を1イベントで飛び越えて「未達と転生が同秒」になる周回が残る。
      // 転生準備が済んだ瞬間=到達連動ノルマの未達点なので、まだ未達でなければ先に未達を立て、
      // 転生は次の秒に行う(遅延1秒=経済影響なし。未達→転生の順序が全周回で構造的に成立)。
      if (!sim.run.quotaFailed) {
        sim.run.quotaFailed = true;
        sim.run.quotaFailAt = elapsed(sim);
        if (sim.run.monster) sim.run.monster = null;
        return false; // 転生は次tick(quotaFailedを見た戦略が同じ判断を返す)
      }
      // 同tick内でノルマ判定ブロックが未達を立てた直後(quotaFailAt==現在秒)も転生は次秒へ
      // (未達→転生の順序を秒解像度で保証)
      if (sim.run.quotaFailAt != null && sim.run.quotaFailAt >= elapsed(sim)) return false;
      return doPrestige(sim);
    }
  }
  return false;
}

// ==== 周回境界スナップショット(3-2 無効化テストの方式・2026-07-06) ====
// 「その回だけ無効」判定: 周回kの開始状態から、その機能をその回だけ効果ゼロにして
// 周回kを再実行し、有効時の周回kと獲得効率(周回総クッキー÷周回時間)を比較する。
// 他の回は無効化しない(前後の周回の軌道ずれが混入しない)。
function takeSnapshot(sim) {
  return structuredClone({
    t: sim.t, prestige: sim.prestige, prestigeTotal: sim.prestigeTotal,
    prestigeRuns: sim.prestigeRuns, totalCookies: sim.totalCookies,
    prevMaxStage: sim.prevMaxStage, prevDuration: sim.prevDuration,
    everMs: sim.everMs || {}, lastPrestigeCps: sim.lastPrestigeCps || 0,
    skills: sim.skills, rotIdx: sim.rotIdx, upRotIdx: sim.upRotIdx, goldenAlt: sim.goldenAlt,
    firstResearchBuy: sim.firstResearchBuy, firstPerk: sim.firstPerk, firstStageBuy: sim.firstStageBuy,
    ws: sim.ws,
    run: sim.run
  });
}
// スナップショットから1周回だけ再実行(転生した時点で終了)。opts に disableResearch 等を渡す。
// capSec: 再実行の打ち切り(周回開始からの秒数)。打ち切り時は partial の効率で比較する。
function replayRun(strategy, snap, opts, capSec) {
  const sim = newSim(strategy, opts);
  const s = structuredClone(snap);
  sim.t = s.t; sim.prestige = s.prestige; sim.prestigeTotal = s.prestigeTotal;
  sim.prestigeRuns = s.prestigeRuns; sim.totalCookies = s.totalCookies;
  sim.prevMaxStage = s.prevMaxStage || 0;
  sim.prevDuration = s.prevDuration || 0;
  sim.everMs = s.everMs || {}; sim.lastPrestigeCps = s.lastPrestigeCps || 0;
  sim.skills = s.skills; sim.rotIdx = s.rotIdx; sim.upRotIdx = s.upRotIdx; sim.goldenAlt = s.goldenAlt;
  sim.firstResearchBuy = s.firstResearchBuy; sim.firstPerk = s.firstPerk; sim.firstStageBuy = s.firstStageBuy;
  if (s.ws) sim.ws = s.ws;
  sim.run = s.run;
  const horizonAbs = sim.run.startT + (capSec != null ? capSec : sim.opt.hours * 3600);
  while (sim.t < horizonAbs) {
    if (advanceTick(sim, strategy)) break; // この周回の転生で終了
  }
  if (sim.runs.length > 0) return sim.runs[sim.runs.length - 1];
  const r = sim.run;
  return {
    startT: r.startT, endT: sim.t, duration: sim.t - r.startT,
    runCookies: r.runCookies, quotaHold: r.quotaHoldSeconds, maxStage: r.maxStage,
    kills: r.kills, golden: r.goldenTaken, quotaFailAt: r.quotaFailAt, partial: true
  };
}

function simulate(strategy, opts) {
  const sim = newSim(strategy, opts);
  sim.run = newRun(sim);
  sim.run.policy = strategy.pickPolicy(sim);
  scheduleGolden(sim);
  scheduleMonster(sim);
  // シミュレーション時間=「やること無くなるまで」(2026-07-22 ユーザー指示): runUntilDone 時は大きめの安全上限を置き、
  // 全スキル取得(=これ以上の転生目的なし)+勝利ラップ後の idle-cut で自然終了させる(全方針~17-47hで完了を実測)。
  // maxHours は保険(ツリー未完で走り続ける方針が万一あっても打ち切る)。通常は idle-cut が先に効く。
  const horizon = (sim.opt.runUntilDone ? (sim.opt.maxHours || 200) : sim.opt.hours) * 3600;
  sim.hourly = [];
  if (sim.opt.debugRunIdx != null) sim.debugTrace = [];
  if (sim.opt.snapshots) sim.snapshots = [takeSnapshot(sim)];
  while (sim.t < horizon) {
    const prestiged = advanceTick(sim, strategy);
    if (prestiged && sim.opt.snapshots) sim.snapshots.push(takeSnapshot(sim));
    // スキルは転生時のみ増える=転生した時だけ完成判定(毎tickのevalを避ける)
    // 完成=「買える全スキル(他方針の署名を除く)を取得済み」。署名相互排除で全ツリー完走は起きないため
    // 自分が取り得るノードだけで判定(idle尾部の打ち切り最適化を維持)。
    if (prestiged && !sim._allSkills) {
      const foreign = foreignSignatures(sim.strat.id);
      if (SKILL_NODES.every(n => sim.skills[n.id] || foreign.has(n.id))) sim._allSkills = true;
    }
    // 検証高速化(2026-07-15): 全スキル取得後(=これ以上の転生目的が無い放置の尾部)に限り、
    // 単一周回が閾値(既定300秒)を超えたら打ち切る。ツリー未完の間は一切打ち切らない=料理/装備の
    // 作成・カバレッジ・全条件の測定に影響しない(尾部の部分周回はfull判定から除外)。ゲームには無関係(simだけ)。
    // 勝利の一周(2026-07-16): ツリー完成直後の一周(最深スキルを持った完全な周回)は打ち切らない=
    // 戦略が _victoryLapDone を立てて引退した後にだけ尾部を打ち切る(③深部報酬の判定に完全周回が要る)。
    if (!sim.opt.noIdleCut && !process.env.NO_IDLE_CUT && sim._allSkills && sim._victoryLapDone
        && (sim.t - sim.run.startT > (sim.opt.idleCutSec || 300) || sim.run.runCookies > 1e250 || !Number.isFinite(sim.run.runCookies))) break;
    // ↑引退尾部の追加打ち切り(2026-07-17): 尾部は全ツリー+深部報酬の自己参照フロアで二重指数成長し
    // 1tickでe50+跳んでInfinityに達し得る(matureRate0.009でS4尾部273sを実測)。earn()の教義
    // (2026-07-06ユーザー許可「上限は超えてもよい・クランプしない・有限性判定は転生周回のみ」)どおり
    // 値はクランプせず、打ち切りだけ早める(検証高速化)。記録にInfinityが残るのは許容仕様。完全周回には無影響。
  }

  // 終了時の進行中周回も記録
  const r = sim.run;
  sim.runs.push({
    idx: sim.runs.length, startT: r.startT, endT: sim.t,
    duration: sim.t - r.startT, runCookies: r.runCookies,
    quotaHold: r.quotaHoldSeconds, maxStage: r.maxStage,
    kills: r.kills, golden: r.goldenTaken, cpsSamples: r._cpsSamples || [],
    eq2Made: Object.assign({}, r.eq2Made || {}), eq2CraftTotal: r.eq2CraftTotal || 0, momBuys: r.momBuys || 0, eq2NewEquipped: (r.eq2NewEquipped || []).slice(),
    firstEscapeAt: r.firstEscapeAt != null ? r.firstEscapeAt : null,
    gain: prestigeGainOf(r.runCookies), partial: true,
    researchBought: Object.keys(r.research).filter(k => r.research[k]),
    stages2: Object.keys(r.research2).filter(k => r.research2[k]),
    stages3: Object.keys(r.research3).filter(k => r.research3[k]),
    quotaFailAt: r.quotaFailAt,
    gainSeries: (sim.opt.trackGain && r.quotaFailAt != null) ? r.gainSeries : undefined,
    perks: Object.assign({}, r.perks),
    upgradePerkTotal: Object.values(r.upgradePerks).reduce((a, b) => a + b, 0),
    critAtBuy: r.critAtBuy, critEnd: r.critNow, critMax: r.critMax,
    killsByType: Object.assign({}, r.killsByType), rewardByType: Object.assign({}, r.rewardByType),
    wsDishes: Object.keys(r.buffs || {}), wsEq: Object.assign({}, sim.ws.eq), wsOrders: Object.assign({}, r.ordersDone), wsStageNo: r.wsStage,
    skillsBought: 0, skillIds: []
  });
  return sim;
}

// 購入ヘルパー(unlockイベント記録込み)
// ㉚解放間隔(2026-07-22 ユーザー指示「ゲート解放無くして、ゲーム調整で解放間隔30秒以上」):
// 解放を待たせるハードゲート(旧 P.reveal.minGap)は撤去。解放間隔≥30秒は、ノルマを本当の壁に
// する経済(ノルマ係数の引き上げ+討伐難度)で自然に生む=買える物が一気に湧かないため間隔が空く。
// unlockEvents の記録は継続(runner unlockgap で自然間隔を計測)。minGap=0 で常にゲート開放。
function unlockGateOk(sim) {
  const gap = (P.reveal && P.reveal.minGap != null) ? P.reveal.minGap : 0;
  if (!gap) return true;
  return sim.lastUnlockT == null || sim.t >= sim.lastUnlockT + gap;
}
// 生涯初取得の貯金はしご(㉚ 2026-07-24 第3版): ㉚の存在理由は「新要素が30秒に1個ずつ来るから、何が変わったか
// 分かってから次に進める」(ユーザー明言=30秒未満だと脳死タップゲー化)。よって解放イベントになる生涯初取得
// (設備初号機・研究・研究段階)は**直列の貯金はしご**でペーシングする:
//   1) 常に未払いターゲットは1本だけ。先客が未払いの間、次の新要素は凍結せず買えない(=順番待ち)。
//   2) 先客が支払われた時点で次を凍結: ターゲット = 今の所持クッキー + sec×直近の毎秒稼ぎ(earnEma)。
//      =「直前の新要素からさらに sec 秒ぶん稼がないと次は買えない」。タイマーではなく価格。凍結ゆえ必ず届く。
//   これで (a)大量に貯める方針(即払いで間隔ゼロ) (b)収入の指数加速(まとめ凍結だと後段ほど早く届き間隔圧縮)
//   の両方の抜け道が塞がる。earnEma はタップ/金/討伐込みの実収入(cpsだけだと序盤タップ収入で誤差)。
// 第3版の直列はしご(先客が払うまで次を凍結しない)は撤回(2026-07-24実測): 凍結の瞬間に金ブースト/討伐報酬で
// 収入がスパイクしていると、平常収入では何十分も届かない額に凍結され、はしご全体が詰まって全解放不能が11方針発生。
// 収入はバースト的なので「収入×秒」の直列連結は不安定。独立凍結(下)+進行量ゲート(researchUnlocked/researchStageUnlocked)
// の組に戻す=スパイクで飛ばせない進行量(層・台数)が実時間を保証する。
// ㉚初回開発のアーミングゲート(第9版・統一機構): 新要素の生涯初開発は「全ての前提が初めて揃った瞬間(アーミング)の
// 自己ベスト層(lifeBest)から +gap 層 自己ベストを更新した地点」で解禁する。基点を固定の事前イベント(スキル取得など)に
// 取ると、実際の律速が別要因(研究の値段・設備の出現)の時にゲートが空振りしてΔ1連発が残る(実測)。「揃った瞬間」を
// 基点にすれば律速要因が何であれ必ず+gap層の研削が入る。lifeBest はフロンティアのノルマでしか進まない=終盤の収入倍加
// でも飛ばせない。gap は要素ごとに階段化=同瞬間に複数が揃っても1つずつ出る。開発済みの再購入は無条件(無税)。
function armGate(sim, key, gap) {
  if (!gap) return true;
  const A = sim._armL || (sim._armL = {});
  if (A[key] == null) { A[key] = sim.lifeBest || 0; return false; } // いま揃った=アーミング(この層が基点)
  return (sim.lifeBest || 0) >= A[key] + gap;
}
// 周回オフセット版(第12版): アーミング周回から+k転生後に解禁。k=0は無ゲート。転生回数はブリッツ不能(本文STAGE_K参照)。
function armRunGate(sim, key, k) {
  if (!k) return true;
  const A = sim._armR || (sim._armR = {});
  if (A[key] == null) { A[key] = sim.prestigeRuns || 0; return false; }
  return (sim.prestigeRuns || 0) >= A[key] + k;
}
function firstBuyPace(sim, key, cost, sec) {
  if (!sec) return cost;
  const T = sim._premTarget || (sim._premTarget = {});
  if (T[key] == null) {
    const inc = (sim._lastProd && sim._lastProd.cps) || 0; // cps基準(earnEma基準はスパイク凍結で悪化=実測で棄却)
    if (!(inc > 0)) return cost;
    T[key] = q5cost((sim.run.cookies || 0) + sec * inc);
  }
  return Math.max(cost, T[key]);
}
function firstBuyPaid(sim, key) { if (sim._premTarget && sim._premTarget[key] != null) delete sim._premTarget[key]; } // 支払い完了=次の凍結を許可
function pushUnlock(sim, kind, id, n) {
  sim.lastUnlockT = sim.t;
  const ev = { t: sim.t, kind, id };
  if (n != null) ev.n = n;
  sim.unlockEvents.push(ev);
}
function tryBuyUpgrade(sim, u, budgetRatio) {
  if (!sim.everUpgrade[u.id] && !unlockGateOk(sim)) return false;
  const cost = upgradeCost(sim, u);
  // 生涯初のスキル解放設備は初号機割増(㉚ペーシング)がかかる。予算規律(cookies×budgetRatio)で弾くと
  // 割増ぶんを貯めきれない周回の短い方針が恒久的に買えず全解放不能になる(実測: S13が21→8周回)。
  // 割増対象の生涯初購入だけは予算規律を緩め、所持クッキーの範囲で貯まり次第買える(=足止めではなく貯金)ようにする。
  const isPremiumFirst = !sim.everUpgrade[u.id] && UPGRADE_UNLOCK_SKILLS[u.id] && P.upCost && P.upCost.firstUnitSec > 0;
  const br = isPremiumFirst ? Math.max(budgetRatio, 0.92) : budgetRatio;
  if (cost > sim.run.cookies * br) return false;
  if (cost > sim.run.cookies) return false;
  const wasZero = !(sim.run.upgrades[u.id] > 0);
  sim.run.cookies -= cost;
  sim.run.upgrades[u.id]++;
  if (wasZero) (sim.run._eqFirstMax || (sim.run._eqFirstMax = {}))[u.id] = sim.run.maxStage || 0; // ㉚: 次段の進行ゲート基点(この段を初購入したノルマ層)
  sim.lifeEquip = (sim.lifeEquip || 0) + 1; // ㉚(2026-07-24): 通算設備購入数(設備熟練の解放を周回跨ぎで分散)
  sim.run._lastUpBuyT = sim.t; // 装備C型「設備購入直後」用
  // 星屑パフェ: 効果中に購入した設備はその周回中、生産×1.25(成長ゲート型)
  if (sim.run.buffs && (sim.run.buffs.stardustParfait || 0) > sim.t) sim.run.parfaitUps[u.id] = (sim.run.parfaitUps[u.id] || 0) + 1;
  // まとめ買い割増: 熱量を減衰させてから+1
  {
    const r2 = sim.run;
    const sg = r2.surge[u.id] || (r2.surge[u.id] = { h: 0, t: sim.t });
    sg.h = sg.h * Math.pow(0.5, (sim.t - sg.t) / Math.max(1, P.upSurge.halfSec)) + 1;
    sg.t = sim.t;
  }
  if (!sim.everUpgrade[u.id]) {
    sim.everUpgrade[u.id] = true;
    firstBuyPaid(sim, 'up:' + u.id);
    (sim._devL || (sim._devL = {}))['up:' + u.id] = sim.lifeBest || 0; // ㉚: 初開発時の自己ベスト層(後続ゲートの基点)
    pushUnlock(sim, 'upgrade', u.id);
    // 条件㉑(新設備の存在感): 初めて買った瞬間の「その1台の実生産(系列・熟練など固有能力込み、
    // 研究・スキル倍率も自然に通る)」を、購入直前の実CPSと比較する。Δ生産方式(2026-07-06 解釈更新):
    // Δ = 購入後の生産 − 購入直前の生産。判定は Δ ≥ 購入直前CPS × 1/5(runner側)
    // 「購入直前」はこの1台だけを引いた実CPS(所持数を一時-1して再計算)。旧・tick頭の_lastProdを使う方式は
    // 同一tick内の先行購入(周回頭の再購入ラッシュ等)のΔが混入し、4種同時初購入でΔが全部ほぼ同値になる等
    // 測定が汚染されていた(第12次P実測: factory/bank/spiceRack/portalのΔが全て≈6.9e5)。
    if (sim._lastProd) {
      if (!sim.presenceChecks) sim.presenceChecks = [];
      sim.run.upgrades[u.id]--;
      const bp = computeProd(sim);
      sim.run.upgrades[u.id]++;
      const before = u.type === 'click' ? bp.baseClick : bp.baseCps;
      // 初台ボーナス(第12次R2続き・㉑対策): 中位設備(oven〜portal)の初めての1台に、購入直前CPS×coefの
      // 生産を持たせる(系列ボーナス「初購入の瞬間に生産の約coef分をその1台が担う」の中位への拡張。
      // 上位設備は系列ボーナスが既に担うため対象外)。静的加算=経済成長とともに自然に無意味化する。
      if (P.presence && (P.presence.ids || []).includes(u.id) && u.type !== 'click') {
        if (!sim.presenceBonus) sim.presenceBonus = {};
        sim.presenceBonus[u.id] = (P.presence.firstUnitCoef || 0) * Math.max(0, bp.baseCps);
      }
      const after = computeProd(sim);
      const av = u.type === 'click' ? after.baseClick : after.baseCps;
      sim.presenceChecks.push({ runIdx: sim.runs.length, t: sim.t, id: u.id, delta: Math.max(0, av - before), ref: before });
    }
  }
  return true;
}
function tryBuyResearch(sim, id, budgetRatio) {
  const r = sim.run;
  if (r.research[id]) return false;
  if (!sim.everResearch[id] && !unlockGateOk(sim)) return false;
  // 無効化(disableResearch)でも購入行動は同じ: 効果だけがゼロになる
  const def = RESEARCH.find(x => x.id === id);
  if (!def || !researchUnlocked(sim, def)) return false;
  if (!sim.everResearch[id] && !armRunGate(sim, 'res:' + id, RES_K[id] || 0)) return false; // ㉚: 初回開発の周回オフセット
  let cost = researchCostOf(sim, id);
  // 初回開発の貯金プレミアム(㉚): 生涯初のみ「凍結時の所持クッキー+sec×cps」を下限に(=解放から≥sec秒 貯める)。
  // sec は研究の深さ(RESEARCH内の並び順)で階段化——同じ瞬間に複数の研究が視界に入っても要求貯金秒数が違うため
  // 初開発が時間軸でばらける(同tick凍結の衝突対策)。深い研究ほど初回開発が大工事という固定の設計。再購入は無税。
  const resSec0 = (P.upCost && P.upCost.firstBuySecRes) || 0;
  const resSec = resSec0 > 0 ? resSec0 + ((P.upCost.firstBuyStep || 0) * RESEARCH.findIndex(x => x.id === id)) : 0;
  if (resSec > 0 && !sim.everResearch[id]) cost = firstBuyPace(sim, 'res:' + id, cost, resSec);
  const br = (resSec > 0 && !sim.everResearch[id]) ? Math.max(budgetRatio, 0.92) : budgetRatio;
  if (cost > r.cookies * br) return false;
  r.cookies -= cost;
  r.research[id] = true;
  r._lastResBuyT = sim.t; // 装備C型「研究購入直後」用
  if (sim.firstResearchBuy[id] === undefined) sim.firstResearchBuy[id] = sim.t;
  if (!sim.everResearch[id]) {
    sim.everResearch[id] = true;
    (sim._devL || (sim._devL = {}))['res:' + id] = sim.lifeBest || 0; // ㉚: 初開発時の自己ベスト層(段2ゲートの基点)
    firstBuyPaid(sim, 'res:' + id);
    pushUnlock(sim, 'research', id);
  }
  return true;
}
// 研究段階(段2/段3)の購入。研究購入枠の延長として同じ予算基準で買う
function tryBuyResearchStage(sim, id, stage, budgetRatio) {
  const r = sim.run;
  if (stage === 2 ? r.research2[id] : r.research3[id]) return false;
  if (!sim.everStage[id + ':' + stage] && !unlockGateOk(sim)) return false;
  // 無効化(disableStage)でも購入行動は同じ: 効果だけがゼロになる
  if (!researchStageUnlocked(sim, id, stage)) return false;
  let cost = researchStageCostOf(sim, id, stage);
  // 初回開発の貯金プレミアム(㉚): 研究と同様、生涯初のみ「凍結時の所持+sec×cps」下限。sec は系列の深さで階段化+
  // 段3は段2よりさらに重く(同じ瞬間に複数の段階が開放されても要求貯金秒数が違う=初開発が時間軸でばらける)。
  const stSec0 = (P.upCost && P.upCost.firstBuySecStage) || 0;
  const stSec = stSec0 > 0 ? stSec0 + ((P.upCost.firstBuyStep || 0) * RESEARCH.findIndex(x => x.id === id)) + (stage === 3 ? (P.upCost.firstBuyS3Extra || 0) : 0) : 0;
  if (stSec > 0 && !sim.everStage[id + ':' + stage]) cost = firstBuyPace(sim, 'stage:' + id + ':' + stage, cost, stSec);
  const br = (stSec > 0 && !sim.everStage[id + ':' + stage]) ? Math.max(budgetRatio, 0.92) : budgetRatio;
  if (cost > r.cookies * br) return false;
  r.cookies -= cost;
  if (stage === 2) {
    r.research2[id] = true;
    if (!sim.everStage[id + ':2']) (sim._devL || (sim._devL = {}))['s2:' + id] = sim.lifeBest || 0; // ㉚: 段3ゲートの基点(初開発時の自己ベスト層)
  } else r.research3[id] = true;
  // ⑬測定用(2026-07-16・opt-in): タイミング機能段2の取得直後のスナップを保存=機能が「活性」な地点から
  // 短窓で最適/放置を枝分かれできる(周回頭からだと段2未取得で1.000・周回全体だと複利発散)。measurement専用=経済不変。
  // 延長狩り(portalNetwork)だけは購入時でなく「取得後の最初の討伐時」にsnapする(下のdefeatMonster側):
  // 研究購入はクッキー最潤沢=ノルマ未達直後の尾(モンスターが湧かない)に集中し、購入時snapの900s窓が
  // 全方針1.000に死ぬのを実測。討伐時snap=機能が活性かつモンスターが生きている地点=測れる窓。
  if (stage === 2 && sim.opt.timingSnaps && (id === 'quantumProofing' || id === 'spiceBlend')) { // blackHoleCompressionは初回発火時snap(2026-07-18 R27・下の充填ブロック)
    (sim.timingSnaps || (sim.timingSnaps = {}))[id] = takeSnapshot(sim);
  }
  if (stage === 2 && sim.opt.timingSnaps && id === 'portalNetwork' && !(sim.timingSnaps && sim.timingSnaps.portalNetwork)) {
    sim._portalSnapPending = true;
  }
  const key = id + ':' + stage;
  if (sim.firstStageBuy[key] === undefined) sim.firstStageBuy[key] = sim.t;
  if (!sim.everStage[key]) {
    sim.everStage[key] = true;
    firstBuyPaid(sim, 'stage:' + key); // 貯金はしご: 支払い完了=次の新要素の凍結を許可
    // 研究段階も解放イベント(2026-07-24 ユーザー是正): ㉚の目的は「プレイヤーが30秒に1個ずつ新要素を味わう」こと。
    // 段2/段3もプレイヤーから見れば新カードが棚に湧く=解放体験そのもの。測定から除外するのはごまかし(除外しても
    // ゲーム内では機関銃のまま)なので、除外せず実際の間隔を貯金はしご(firstBuyPace)で空ける。
    pushUnlock(sim, 'stage', key);
  }
  return true;
}
// 1個あたりの研究・支援・個別強化込み倍率(ショップの「次 +N」相当)
function upgradeUnitMult(sim, u) {
  const r = sim.run;
  const R = P.res;
  const i = UPIDX[u.id];
  const owned = r.upgrades[u.id];
  const upPerkPower = 1 + skillEffect(sim, 'upgradePerkPower')
    + (r.perks.crushedMill * (rwOff(sim, 'crushedMill') ? 0 : P.rw.crushedMill))
    + rewardCategoryBonus(sim, 'equipment');
  const boostRate = Math.max(P.upPerk.floor, P.upPerk.base - i * P.upPerk.slope) * upPerkPower;
  const personal = 1 + (r.upgradePerks[u.id] || 0) * boostRate;
  let resM = 1;
  const stage = currentStage(sim);
  // おばあちゃんの所持数スケール(2026-07-13 ユーザー指示「1台あたりの初期生産は1のまま、もっと強く」):
  // 1台目=1/秒は不変。台数が増えるほど1台あたりが伸びる(研究非依存の地力)
  // おばあちゃん台数スケール撤去(2026-07-15 ユーザー訂正)=台数×固定。増幅は研究/報酬/熟練から
  if (u.id === 'grandma' && resActive(sim, 'grandmaCrowd')) resM *= R.grandmaSelf;
  if (u.id === 'oven' && resActive(sim, 'ovenBatch')) resM *= R.ovenSelf * lg(owned, R.ovenOwn) * lg(Math.max(0, stage - 1), R.ovenStage);
  if (u.id === 'factory' && resActive(sim, 'factoryNetwork')) {
    const low = (r.upgrades.finger || 0) + (r.upgrades.grandma || 0) + (r.upgrades.oven || 0);
    resM *= R.factorySelf * lg(low, R.factoryLow) * lg(owned, R.factoryOwn);
  }
  if (u.id === 'spiceRack' && resActive(sim, 'spiceBlend')) resM *= lg(owned, R.spiceOwn);
  if (u.id === 'portal' && resActive(sim, 'portalNetwork')) resM *= R.portalSelf;
  if (u.id === 'galaxyFactory' && resActive(sim, 'galaxyAssembly')) {
    const types = UPGRADES.filter(x => (r.upgrades[x.id] || 0) > 0).length;
    resM *= lg(types, R.galaxyTypes) * lg(owned, R.galaxyOwn);
  }
  if (u.id === 'quantumBakery' && resActive(sim, 'quantumProofing')) {
    const rc = RESEARCH.filter(x => r.research[x.id]).length;
    resM *= lg(rc, R.quantumRes) * lg(owned, R.quantumOwn);
  }
  let supM = 1;
  if (resActive(sim, 'grandmaCrowd')) {
    const g = r.upgrades.grandma || 0;
    if (u.id === 'finger') supM *= lg(g, R.grandmaSup[0]);
    if (u.id === 'oven') supM *= lg(g, R.grandmaSup[1]);
    if (u.id === 'factory') supM *= lg(g, R.grandmaSup[2]);
  }
  return personal * resM * supM;
}

// 効率最良アップグレード(次の1個の増分/コスト、ショップ表示と同じ情報)
function bestEfficiency(sim, prod, typeFilter, budgetRatio) {
  // budgetRatio指定時は「いま予算内で買えるものの中での効率最良」(S2のように別予算と並行で
  // 買い続ける方針用)。無指定は従来どおり全候補の最良1つ=予算外なら買わずに貯める。
  // 注意: 全方針を budgetRatio 付きに変えると「新設備のための貯金」が消えて第0回の解放が
  // 全体に遅れる(S1中央値0.82→1.23=実測)。標準の買い方は無指定のままにすること。
  let best = null, bestVal = 0;
  const budget = budgetRatio ? sim.run.cookies * budgetRatio : Infinity;
  for (const u of visibleUpgrades(sim)) {
    if (typeFilter && u.type !== typeFilter) continue;
    const cost = upgradeCost(sim, u);
    if (cost > budget) continue;
    let val = (u.value * upgradeUnitMult(sim, u)) / cost;
    // 新規設備ボーナス(2026-07-10・T2第0回/㉑対策): 自然なプレイヤーは新しく見えた設備を
    // まず1台試す。純効率だけだと、会心研究で指が・報酬の個別強化がgrandma(唯一のcps設備)に
    // 集中して新設備を45分〜買わない(第0回の解放イベントが4-5件に痩せる=実測)。
    // 未所持設備の効率を×noveltyで評価=見えたら早めに1台(2台目以降は素の効率)。
    if ((sim.run.upgrades[u.id] || 0) === 0 && P.noveltyBoost > 1) val *= P.noveltyBoost;
    if (val > bestVal) { bestVal = val; best = u; }
  }
  return best;
}

const PRESTIGE_GAIN_FLOOR = 1.55; // 転生PT単調床の比(cookies比≈1.55^43.5≈3e8=④の1e8+余裕)
// 周回上限時間の保険(2026-07-15): 生産段が尽きた後は1.57倍目標に到達できず=無理に転生させず地平まで
// 走らせて1本の部分周回にする(④=生産段が続く周回のみ判定。R24も同挙動で18/19)。生産段が続く間は
// 勢いで必ず7200s以内に到達=full周回のT1を保つ。極端な保険としてのみ大きな値を置く。
const PRESTIGE_MAX_SEC = 36000;
module.exports = {
  P, UPGRADES, RESEARCH, REWARD_POOL, SKILL_NODES, SKILL_BY_ID,
  PRESTIGE_GAIN_FLOOR, PRESTIGE_MAX_SEC,
  simulate, prestigeGainOf, prestigeCostOf, skillCostOf, upgradeCost, researchCostOf,
  tryBuyUpgrade, tryBuyResearch, bestEfficiency, visibleUpgrades, quotaAtElapsed,
  isUtilitySkill, buildSkillValues, skillRank, skillRiders, trunc2sig, q5, q5cost,
  POLICY_SIGNATURE, ALL_SIGNATURES, foreignSignatures,
  tryBuyResearchStage, researchStageCostOf, researchStageUnlocked,
  replayRun, takeSnapshot, bandY,
  equip2Items,
  // 得意装備の割り振り用(R19 2026-07-18): 戦略の装備選好スコア(equip2Scoreと同式)を擬似simで計算
  eq2ScoreOf: (strategy, item) => equip2Score({ strat: strategy, run: { policy: (strategy.pickPolicy ? strategy.pickPolicy(null) : 'balanced') } }, item),
  EQUIP2_FX_TABLE: () => EQUIP2_FX // 診断用(probe_chain.js: 装備(b)鎖の切断リンク検査)
};
