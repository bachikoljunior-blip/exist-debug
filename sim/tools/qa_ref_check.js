#!/usr/bin/env node
// QA判定器の参照検問(2026-07-26 実装)。目的: 「判定器が存在しない名前を読み、無言で空振りする」を止める。
//
// 実際に起きた失敗(1日で3件):
//   ・save_robust_qa: 存在しないid #cookieCount を読み hud が常に空。判定は素通り。
//   ・fmt_extreme_qa: 同じ #cookieCount と #cps。HUD検査が丸ごと空振り。
//   ・crit_felt_qa: 存在しない関数 critChance を typeof で見て「会心率?」、会心を0回と報告。
//   いずれも「赤/緑が出る」ので動いて見える。人の目では見つからないので機械で止める。
//
// 検査: sim/tools/*.js の中の
//   ①getElementById('X') / querySelector('#X') の X が index.html に id="X" として在るか
//   ②typeof NAME === 'function' の NAME が index.html に function NAME( として在るか
// 動的生成のidを見る行には行末に /* dyn */ を書けば除外できる。
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\bid="([A-Za-z_][\w-]*)"/g)].map(m => m[1]));
const fns = new Set([...html.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
for (const m of html.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) fns.add(m[1]);

const dir = path.join(ROOT, 'sim', 'tools');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'qa_ref_check.js');
let bad = 0, checked = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    if (/\/\* dyn \*\//.test(line)) return;
    for (const m of line.matchAll(/getElementById\(\s*['"]([A-Za-z_][\w-]*)['"]\s*\)/g)) {
      checked++;
      if (!ids.has(m[1])) { console.error(`${f}:${i + 1} 参照している id="${m[1]}" が index.html に無い(検査が空振りする)`); bad = 1; }
    }
    for (const m of line.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z_][\w-]*)/g)) {
      checked++;
      if (!ids.has(m[1])) { console.error(`${f}:${i + 1} 参照している #${m[1]} が index.html に無い(検査が空振りする)`); bad = 1; }
    }
    for (const m of line.matchAll(/typeof\s+([A-Za-z_$][\w$]*)\s*===?\s*['"]function['"]/g)) {
      const n = m[1];
      if (/^(window|document|require|process|D|fs|path|os)$/.test(n)) continue;
      checked++;
      if (!fns.has(n)) { console.error(`${f}:${i + 1} typeof ${n}==='function' だが index.html に ${n} が無い(常にfalse=判定が黙って死ぬ)`); bad = 1; }
    }
  });
}
if (!bad) console.log(`qa_ref OK: ${files.length}本のQAツール・${checked}件の参照すべてが index.html に実在`);
process.exit(bad);
