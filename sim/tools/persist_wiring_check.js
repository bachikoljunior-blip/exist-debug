#!/usr/bin/env node
// 永続配線の検問(2026-07-26 実装)。目的: 「転生・やり直しで“書き忘れた項目だけ”が永久に消える」を二度と起こさない。
//
// 実際に起きた失敗(これを恒久的に止めるための機械):
//   転生 prestigeReset() は `state = freshState()` してから持ち越す項目を1つずつ書き戻す明示列挙で、
//   後から足された state(codex=図鑑の一生の記録 / prestigeUnlockedEver=解放ラッチ)が列挙から漏れ、
//   転生のたびに黙って消えていた(実測: 図鑑3件→0件・ラッチ true→false)。
//   「この周回を最初からやり直す」の復元元 buildRunStartFromCurrent() も同じ明示列挙で、
//   新装備(eq2)・クエスト進捗・初台ボーナス・実績研究・図鑑・開示履歴の8項目が抜けていた。
//   freeze_wiring / measure_wiring と同じ「明示列挙が現実から遅れる」腐り方なので、同じく構造で止める。
//
// 一覧の取り方(ここが検問自身の穴になりやすいので広く取る):
//   freshState() の return も ensureState() も完全な一覧ではない。state.revealedEver のように
//   描画関数の中で遅延生成される項目もあるため、**index.html 全体の `state.X = ...` 書き込み**を集める。
//   集めた各項目は「転生で持ち越す(prestigeReset に書いてある)」か「持ち越さない理由が下の表にある」
//   のどちらかでなければ exit 1。新しい state を足して持ち越し判断を書き忘れると落ちる。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function fnBody(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open, j + 1); }
  }
  return '';
}

// --- ① state に書き込まれる項目を全部集める ---
const keys = new Set();
for (const m of src.matchAll(/\bstate\.([A-Za-z_$][\w$]*)\s*(?:=[^=]|\+\+|--|\+=|-=)/g)) keys.add(m[1]);
if (keys.size < 100) { console.error(`persist_wiring: state の項目を ${keys.size} 個しか取れなかった(抽出器が壊れた?)`); process.exit(1); }
// 抽出器の自己検査: 定義場所がばらばらな代表キーが全部入っていること
for (const must of ['codex', 'skills', 'eq2Owned', 'revealedEver', 'materials', 'prestige', 'questKills']) {
  if (!keys.has(must)) { console.error(`persist_wiring: 抽出器の穴 — state.${must} を集められていない`); process.exit(1); }
}

// --- 持ち越さない理由の表(個別名 or パターン。上から最初に当たったものを使う) ---
// パターンは「その形の項目はこういう理由で周回単位」という宣言。新種がどれにも当たらなければ検問が落ちる。
const RESET_RULES = [
  // 周回の骨格(買い直すことが遊びの中身)
  ['cookies', '周回の所持クッキー。転生の対価そのもの'],
  ['runCookies', 'その周回の稼ぎ。周回ごとの指標'],
  ['upgrades', '設備。買い直しが周回の骨格'],
  ['upgradePerks', '設備の個別強化。到達不能な死に経路(2026-07-08 固定枠撤廃)'],
  ['research', '研究。買い直しが周回の骨格'],
  ['researchStages', '段階購入。研究本体と同じく買い直す'],
  ['everResearch', 'その周回に取った研究の記録。周回単位の指標'],
  ['everUpgrades', '同上(設備)'],
  ['everStage', '同上(層)'],
  ['perks', '報酬パーク。周回ごとに選び直すのが報酬選択の意味'],
  ['rewardCategoryCounts', '報酬系統の枚数。perks と同じ周回単位'],
  ['rewardRotN', '報酬カードのローテーション位置。perks と同格'],
  ['msResearch', '実績研究。トリガが「その周回だけ」なので購入状態も周回単位(2026-07-11)'],
  [/^ms[A-Z]/, '実績研究のトリガ用カウンタ。トリガが周回単位なのでカウンタも周回単位'],
  // 注文・料理(周回をまたぐ締切を持たせない)
  ['activeOrder', '注文。周回をまたぐ締切は持たせない'],
  ['nextOrderAt', '次の注文までの間隔。activeOrder と同格'],
  ['expiredOrders', '期限切れの回数。周回単位の指標'],
  ['completedOrders', '達成した注文の数。注文自体が周回単位なので数も周回単位'],
  [/^orderTemp/, '注文報酬の一時バフ。注文が周回単位なのでバフも周回単位'],
  ['orderCookieUntil', '追い焼き(獲得+50%の300秒)。時間バフは持ち越さない'],
  ['activeDishes', '料理バフ。時間バフは持ち越さない'],
  ['parfaitUnits', '料理パフェの素材ストック。料理バフと同格の周回内資源'],
  // ステージ・ノルマ(層は maxQuotaStageEver/stageUnlocked で持ち越す)
  ['stage', '現在ステージ。周回開始時に選び直す(解放 stageUnlocked は持ち越す)'],
  ['stageChangedAt', 'ステージ切替の演出時刻。進捗ではない'],
  [/^quota/, 'その周回のノルマ時計・達成状態。ノルマは周回ごとに立て直す'],
  [/^_quota/, '同上(内部の作業値)'],
  ['maxQuotaStage', 'その周回の最高到達層。通算は maxQuotaStageEver で持ち越す'],
  // 装備作成の周回枠
  ['eq2CraftTotalThisRun', '周回内の装備作成数。名前のとおり周回単位'],
  ['eq2MadeThisRun', '同上(部位ごと)'],
  ['eq2CraftCat', '工房で選んでいるカテゴリ。UIの選択状態'],
  ['wsSubTab', '工房のサブタブ。UIの選択状態'],
  // 「次の1体だけ」系の予約
  [/^next.*(Multiplier|Bonus|Bias)$/, '次に湧く相手だけにかかる予約。周回をまたがない'],
  ['goldenChainReady', '金チェインの成立フラグ。次の1回ぶんの状態'],
  ['goldenFirstHitReady', '同上(金粉の初撃)'],
  // 時間バフ・連鎖・ゲージ(転生をまたいで残ると「転生した瞬間だけ強い」歪みになる)
  [/Until$/, '時間バフ・クールダウンの終了時刻。時間バフは持ち越さない'],
  [/^bake/, '焼き上がり状態。時間バフと同格'],
  [/^bh/, '重力圧縮のゲージ・使用回数・倍率。周回2〜3回の枠なので周回単位'],
  [/^blackHole/, '同上(圧縮によるノルマ軽減・使用済み)'],
  [/^gold(Chain|JackBank)/, '金の連鎖・大当たり貯金。周回内のカウンタ'],
  [/^chain/, '討伐連鎖。周回内のカウンタ'],
  [/^spice/, '香料バースト。時間バフと同格'],
  ['portalChainKills', '延長狩りの連鎖数。時間バフと同格'],
  ['critCombo', '会心コンボ。数十秒で切れる周回内カウンタ'],
  ['superBank', '超会心の貯金。周回内カウンタ'],
  ['upSurge', '設備サージ。周回内カウンタ'],
  ['huntFocusLv', '狩猟集中のLv。報酬パークと同格の周回単位'],
  ['huntFocusRewardPenalty', '同上(失敗ペナルティ)'],
  ['earlyRunMonsters', '周回序盤の湧き回数。名前のとおり周回単位'],
  ['pbShownThisRun', '同上(自己ベスト表示の既出フラグ)'],
  ['lastKillType', '直前に倒した種類。次の報酬相性1回ぶんの状態'],
  // 瞬間値・演出・内部作業値
  ['cookieRemainder', 'クッキーの端数キャリー。計算の内部値'],
  ['lastSecondEarn', '直近1秒の稼ぎ。表示用の瞬間値'],
  ['earnEma', '直近稼ぎ率のEMA。周回の瞬間指標'],
  ['emaLastRunCookies', '同上(EMAの前回値)'],
  [/^last(Crit|Golden|ResBuy|UpBuy|Unlock)At$/, '直近の出来事の時刻。演出・表示の基準で、失うものが無い'],
  ['lastSave', '保存時刻。進捗ではない'],
  [/^monsterSpawnRemainMs$|^goldenSpawnRemainMs$/, '出現待ちの残り。周回内のタイマー'],
  ['runPolicy', '周回方針。周回開始時に選び直す'],
  ['runPolicyChosen', '同上(選択済みフラグ)'],
  ['runStart', '周回の開始時刻。転生で新しい周回が始まるので採り直す'],
  ['runStartRecord', 'やり直し用スナップショットの控え。state ではなく保存の仕組み側'],
  ['awaitingSkillChoice', 'スキル選択中フラグ。転生直後は true にするのが正しい'],
  ['skillChoiceStartCount', 'スキル選択開始時の取得数。周回開始時に採り直す'],
];

function resetReason(k) {
  for (const [t, why] of RESET_RULES) {
    if (typeof t === 'string' ? t === k : t.test(k)) return why;
  }
  return null;
}
// やり直しスナップショットで写さない追加分
const RUNSTART_EXTRA = {
  totalCookies: '生涯累計。スナップショットは周回開始の状態なので現在値をそのまま使う',
  totalClicks: '同上',
  totalPlaySec: '同上',
  monstersDefeated: '同上',
};

// --- ②③ 検査 ---
const reset = fnBody('prestigeReset');
const runStart = fnBody('buildRunStartFromCurrent');
let bad = 0;
function check(label, body, extra, present) {
  if (!body) { console.error(`persist_wiring: ${label} が見つからない(関数名が変わった?)`); process.exit(1); }
  const missing = [...keys].sort().filter(k => !present(body, k) && !resetReason(k) && !(extra && extra[k]));
  if (!missing.length) return;
  bad = 1;
  console.error(`persist_wiring NG: ${label} が扱っていない state が ${missing.length} 件あります。`);
  console.error(`  持ち越すなら ${label} に書き足し、持ち越さないなら sim/tools/persist_wiring_check.js の`);
  console.error('  RESET_RULES に「なぜ持ち越さないのか」を書いてください:');
  for (const k of missing) console.error('   - state.' + k);
}
check('転生の持ち越し(prestigeReset)', reset, null, (b, k) => new RegExp(`state\\.${k}\\s*=`).test(b));
check('やり直しの復元元(buildRunStartFromCurrent)', runStart, RUNSTART_EXTRA, (b, k) => new RegExp(`\\b${k}\\b`).test(b));
if (bad) process.exit(1);

const kept = [...keys].filter(k => !resetReason(k)).length;
console.log(`persist_wiring OK: state ${keys.size}項目のうち${kept}件が持ち越しとして配線済み・${keys.size - kept}件は理由付きでリセット`);
