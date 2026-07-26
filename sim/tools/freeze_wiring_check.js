#!/usr/bin/env node
// 時間凍結の配線検問(2026-07-26 実装)。目的: 「凍結リストに書き忘れた期限だけが溶ける」を二度と起こさない。
//
// 実際に起きた失敗(これを恒久的に止めるための機械):
//   updateGameClockFreeze() は停止中(報酬選択・図鑑/設定・画面ロック)に期限を前へずらして
//   凍結するが、その対象はフィールドの明示列挙。後から足された期限
//   (state.orderCookieUntil=追い焼き / state.critFeverUntil=会心フィーバー /
//    state.goldRushUntil=ゴールドラッシュ / activeOrder.expiresAt=注文の制限時間)が
//   列挙から漏れ、「手を出せない間にそれだけが期限切れになる」状態が残っていた。
//   measure_wiring_check.js と同じ「明示列挙が現実から遅れる」腐り方なので、同じく構造で止める:
//     ①index.html の state.*Until / *ExpiresAt 系の期限フィールドを全部集め、
//     ②updateGameClockFreeze() の凍結ブロックに載っているか検査し、
//     ③載っていないものは下の ALLOW に「なぜ凍結しないのか」を書いた上でのみ許す。
//   新しい期限を足して凍結を忘れると exit 1。静的検査なので pre-commit で使える。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 凍結しない期限とその理由(意図的な除外はここに明記する。理由なしの除外は許さない)
const ALLOW = {
  'state.quotaPauseStartedAt': 'ノルマ休止そのものの開始時刻。凍結の記帳側なのでずらすと二重計上になる',
  'state.lastResBuyAt': '直近の購入時刻。表示の「さっき買った」判定だけで、期限切れで失うものが無い',
  'state.lastUpBuyAt': '同上(設備の購入時刻)',
  'state.lastUnlockAt': '同上(解放演出の時刻)',
  'state.lastRevealAt': '開示ドリップの基準。停止中は開示自体が進まないので溶けるものが無い',
  'state.msRepeatAt': '実績研究の繰り返しクールダウン。現状 repeatSec を持つ研究が無く到達不能',
  'state.stageChangedAt': 'ステージ切替の演出時刻。期限切れで失うものが無い',
};

// --- ① 期限フィールドを集める ---
const fields = new Set();
for (const m of src.matchAll(/\bstate\.([A-Za-z0-9_]*(?:Until|ExpiresAt))\b/g)) fields.add('state.' + m[1]);
for (const m of src.matchAll(/\bstate\.[A-Za-z0-9_]*\.(expiresAt)\b/g)) fields.add('state.activeOrder.expiresAt');
for (const m of src.matchAll(/\bstate\.([A-Za-z0-9_]*At)\b/g)) fields.add('state.' + m[1]);
if (fields.size === 0) { console.error('freeze_wiring: 期限フィールドを1つも抽出できなかった(命名が変わった?)'); process.exit(1); }

// --- ② 凍結ブロックを切り出す ---
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
const freezeBody = fnBody('updateGameClockFreeze');
if (!freezeBody) { console.error('freeze_wiring: updateGameClockFreeze が見つからない(関数名が変わった?)'); process.exit(1); }

// --- ③ 検査 ---
const missing = [];
for (const f of [...fields].sort()) {
  const short = f.replace(/^state\./, '');
  const inFreeze = freezeBody.includes(f) || freezeBody.includes('.' + short);
  if (inFreeze) continue;
  if (ALLOW[f]) continue;
  missing.push(f);
}
if (missing.length) {
  console.error('freeze_wiring NG: 停止中に凍結されない期限が ' + missing.length + ' 件あります。');
  console.error('  updateGameClockFreeze() の shiftUntil 列挙に足すか、凍結しない理由を');
  console.error('  sim/tools/freeze_wiring_check.js の ALLOW に書いてください:');
  for (const f of missing) console.error('   - ' + f);
  process.exit(1);
}
const frozen = [...fields].filter(f => !ALLOW[f]).length;
console.log(`freeze_wiring OK: 期限${fields.size}件のうち${frozen}件が凍結対象として配線済み・${Object.keys(ALLOW).length}件は理由付きで除外`);
