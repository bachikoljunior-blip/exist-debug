'use strict';
// 実行/評価ハーネス
const G = require('./sim.js');
const { STRATEGIES } = require('./strategies.js');

function fmtN(n) {
  if (!Number.isFinite(n)) return String(n);
  if (n >= 1e15) return n.toExponential(2);
  if (n >= 1e4) return n.toExponential(2);
  return String(Math.round(n * 100) / 100);
}
function fmtT(s) {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h > 0 ? h + 'h' : '') + m + 'm' + sec + 's';
}
// 帯域式(2026-07-06 ユーザー承認・第10次): 初転生まで Y=120+8√x / 初転生後 Y=1440+3√x (係数8→3)
function firstPrestigeT(sim) {
  const r0 = sim.runs[0];
  return (r0 && !r0.partial) ? r0.endT : Infinity;
}
function makeY(sim) {
  const fp = firstPrestigeT(sim);
  return x => x >= fp ? 1440 + 3 * Math.sqrt(Math.max(0, x)) : 120 + 8 * Math.sqrt(Math.max(0, x));
}
// 旧単段式(参考・tune互換用)
function yCurve(x) { return 120 + 8 * Math.sqrt(x); }

// 全スキル解放時刻 (未達なら Infinity)。以降はペース/ノルマ維持条件を無視してよい
function fullUnlockTime(sim) {
  const totalNodes = G.SKILL_NODES.length;
  let n = 0;
  const ev = sim.unlockEvents.filter(e => e.kind === 'skill').sort((a, b) => a.t - b.t);
  for (const e of ev) {
    n += e.n || 1;
    if (n >= totalNodes) return e.t;
  }
  return Infinity;
}

// 条件⑥の「解放」(2026-07-05 ユーザー再定義): 設備・研究(段階含む)・スキルの
// すべての新規解放を個別にカウントする。同一秒に発生した解放のみ1件に統合する。
// (旧「同一周回内は1解放に統合」は廃止。スキルは転生時に同時取得されるため自然に1件になる)
function mergeEventsByRun(sim) {
  const ev = sim.unlockEvents.slice().sort((a, b) => a.t - b.t);
  const merged = [];
  for (const e of ev) {
    const last = merged[merged.length - 1];
    if (last && last.t === e.t) { last.id += ',' + e.id; last.kind += '+' + e.kind; continue; }
    merged.push({ t: e.t, kind: String(e.kind), id: String(e.id) });
  }
  return merged;
}

function summarize(sim) {
  const total = sim.runs.reduce((a, r) => a + r.runCookies, 0);
  const fullT = fullUnlockTime(sim);
  const yC = makeY(sim);
  const full = sim.runs.filter(r => !r.partial);
  // ④ 各回の総クッキーが前回の100倍以上 / ⑤ 転生PTが前回の1倍以上100倍以内(2026-07-06 確定)
  let doubleOk = 0, doubleAll = 0, gainOk = 0;
  for (let i = 1; i < full.length; i++) {
    doubleAll++;
    if (full[i].runCookies > full[i - 1].runCookies) doubleOk++; // ④ 1億倍→「前周回より多い」単調増加に緩和(2026-07-16 ユーザー変更)
    if (full[i].gain >= 1 * full[i - 1].gain && full[i].gain <= 100 * full[i - 1].gain) gainOk++;
  }
  // ==== テンポ条件 T1〜T3b(2026-07-06 ユーザー確定。旧⑥⑦⑧㉒を置換・3-2反映済み) ====
  const ev = mergeEventsByRun(sim);
  // T1(周回時間): 各周回(転生から転生まで)20分〜2時間。第0回も含む。
  // 全スキル解放後の放置周回は対象外【仮:旧⑥⑦の免除ルールを踏襲。要ユーザー確認】
  // のんびり放置型は周回時間の上限なし(2026-07-12 ユーザー決定「のんびり放置型は周回上限なくていいよ」)
  const noCap = !!(sim.strat && sim.strat.noT1Cap);
  let t1Ok = 0, t1All = 0;
  for (const r of full) {
    if (r.startT >= fullT) continue;
    t1All++;
    if (r.duration >= 1200 && (noCap || r.duration <= 7200)) t1Ok++;
  }
  // T3c(2026-07-13 ユーザー追加「モンスターが全て倒せなくなるのも周回の8割以上」):
  // 初逃走(滞在切れ)が周回の80%地点以降なら合格。逃走ゼロも合格。
  let t3cOk = 0, t3cAll = 0;
  for (const r of full) {
    t3cAll++;
    if (r.firstEscapeAt == null || r.firstEscapeAt >= 0.8 * r.duration) t3cOk++;
  }
  // 新条件「毎秒生産が3分おきに1.1倍以上」(2026-07-15 ユーザー緩和: 2倍→1.1倍): 周回内の180秒サンプル列で
  // 連続ペア(前サンプル>0)ごとに 次サンプル≥1.1×前サンプル を判定。ペア単位で集計。
  const DBL_RATIO = 1.1;
  let dblOk = 0, dblAll = 0;
  for (const r of full) {
    const cs = r.cpsSamples || [];
    for (let i = 1; i < cs.length; i++) {
      if (!(cs[i - 1] > 0)) continue;
      dblAll++;
      if (cs[i] >= DBL_RATIO * cs[i - 1]) dblOk++;
    }
  }
  // T2(解放テンポ・2026-07-11 ユーザー決定「解放条件は上限だけにして、下限はなくていい」=待たされる時間だけ判定):
  // 初転生後の各周回で新規解放1件以上(件数の上限3は撤廃=盛り沢山OK)。
  // 第0回は間隔y÷帯域Y(120+8√x)の中央値が ≤1 のみ(速い側0.5は撤廃)。
  let t2Ok = 0, t2All = 0, t2Run0 = null;
  // T2下限(解放間隔30秒)は廃止(2026-07-15 ユーザー指示「開放まで30待つクソ機能消した」)=判定しない
  let gapMin = Infinity, gapNg = 0;
  {
    const r0 = full[0];
    if (r0) {
      const e0 = ev.filter(e => e.t < r0.endT);
      const ratios = [];
      for (let i = 0; i + 1 < e0.length; i++) {
        const y = e0[i + 1].t - e0[i].t;
        const Y = 120 + 8 * Math.sqrt(e0[i + 1].t);
        ratios.push(y / Y);
      }
      if (ratios.length) {
        ratios.sort((a, b) => a - b);
        const med = ratios[Math.floor(ratios.length / 2)];
        t2Run0 = { med, ok: med <= 1 };
      }
    }
    for (let i = 1; i < full.length; i++) {
      const r = full[i];
      if (r.startT >= fullT) continue;
      const n = ev.filter(e => e.t >= r.startT && e.t < r.endT).length;
      t2All++;
      if (n >= 1) t2Ok++;
    }
  }
  // (参考)T3a(未達が先)=廃止(2026-07-11 ユーザー決定「未達、周回時間の±20%だから未達先じゃなくていい」。T3bで足りる)。表示だけ残す
  let failOk = 0;
  for (const r of full) if (r.quotaFailAt != null && r.quotaFailAt < r.duration) failOk++;
  // T3b(維持時間半分): ノルマを維持できていた時間 ≥ その周回の長さの半分
  // T3b(2026-07-11 ユーザー決定・改2): 早いプレイ方針のみ判定・維持時間が周回時間の±20%以内(実質≥80%)
  let t3bOk = 0;
  for (const r of full) if (r.quotaHold >= 0.8 * r.duration) t3bOk++;
  const durs = full.map(r => r.duration).sort((a, b) => a - b);
  const medianDur = durs.length ? durs[durs.length >> 1] : Infinity;
  // 参考指標(合否に使わない): 旧⑥解放間隔の帯域適合
  let paceOk = 0, paceAll = 0;
  const yC2 = yC;
  for (let i = 0; i + 1 < ev.length; i++) {
    if (ev[i].t >= fullT) continue;
    const y = ev[i + 1].t - ev[i].t;
    const Y = yC2(ev[i + 1].t);
    paceAll++;
    if (y >= 0.5 * Y && y <= Y) paceOk++;
  }
  // ⑭(2026-07-11 ユーザー決定): 下限のみ=獲得PT÷次のスキル最安コスト ≥1.0(上限3.0は撤廃。
  // 「転生ポイント一個以上にはしてね」=転生したら必ず次のスキルが1個は買える)
  let pwOk = 0, pwAll = 0;
  for (const r of full) {
    if (r.gainToNext == null) continue;
    pwAll++;
    if (r.gainToNext >= 1.0) pwOk++;
  }
  // 参考指標(合否に使わない): 旧㉒周回時間の単調増加
  let durOk = 0, durAll = 0;
  for (let i = 1; i < full.length; i++) { durAll++; if (full[i].duration > full[i - 1].duration) durOk++; }
  // 条件㉑(Δ生産方式・2026-07-06): 初購入によるΔ生産(系列ボーナス等の固有能力込み)≥購入直前CPS×1/5
  let prOk = 0, prAll = 0, prWorst = null;
  for (const c of (sim.presenceChecks || [])) {
    prAll++;
    const ratio = c.ref > 0 ? (c.delta * 5) / c.ref : Infinity;
    if (ratio >= 1) prOk++;
    if (!prWorst || ratio < prWorst.ratio) prWorst = { id: c.id, runIdx: c.runIdx, ratio };
  }
  return { total, runs: sim.runs.length, doubleOk, doubleAll, gainOk, t1Ok, t1All, dblOk, dblAll, t3cOk, t3cAll, t2Ok, t2All, t2Run0, gapMin, gapNg, t3bOk, medianDur, paceOk, paceAll, events: ev.length, fullT, failOk, failAll: full.length, pwOk, pwAll, durOk, durAll, prOk, prAll, prWorst };
}

function runBaseline(hours, only) {
  const out = [];
  for (const s of STRATEGIES) {
    if (only && s.id !== only) continue;
    const t0 = Date.now();
    const sim = G.simulate(s, { hours });
    const sum = summarize(sim);
    out.push({ s, sim, sum, ms: Date.now() - t0 });
  }
  return out;
}

function printBaseline(results) {
  // T3bの判定対象=早いプレイ方針(2026-07-11 ユーザー決定「ノルマ維持の条件は早いプレイ方針で達成できてればいい・85%以上」)。
  // 「早い」の線引き【仮】: 方針ごとの周回時間の中央値が、全方針の中央値以下のもの。遅い方針は(対象外)。
  const meds = results.map(r => r.sum.medianDur).filter(x => Number.isFinite(x)).sort((a, b) => a - b);
  const cutoff = meds.length ? meds[meds.length >> 1] : Infinity;
  console.log('ID  名称              周回数 総クッキー   ④前周回超  (参考:旧⑤) (参考)旧新⑥撤廃 T3c討伐維持 T1周回時間 T2解放≥1 T2第0回 (参考)T3a廃止 T3b維持±20%(早い方針) ⑭PT≥1 ㉑存在感 全解放 | 参考: 旧⑥ペース 旧㉒単調増');
  for (const r of results) {
    const fullT = r.sum.fullT === Infinity ? '未' : fmtT(r.sum.fullT);
    const t2r0 = r.sum.t2Run0 ? `${r.sum.t2Run0.ok ? 'OK' : 'NG'}(中央値${r.sum.t2Run0.med.toFixed(2)})` : '-';
    const fast = r.sum.medianDur <= cutoff;
    const t3bText = fast ? `${r.sum.t3bOk}/${r.sum.failAll}` : `(対象外:${r.sum.t3bOk}/${r.sum.failAll})`;
    console.log(
      `${r.s.id.padEnd(3)} ${r.s.name.padEnd(14)} ${String(r.sum.runs).padStart(4)}  ${fmtN(r.sum.total).padStart(10)}  ${r.sum.doubleOk}/${r.sum.doubleAll}   ${r.sum.gainOk}/${r.sum.doubleAll}   ${r.sum.dblOk}/${r.sum.dblAll}   ${r.sum.t3cOk}/${r.sum.t3cAll}   ${r.sum.t1Ok}/${r.sum.t1All}   ${r.sum.t2Ok}/${r.sum.t2All}  ${t2r0}  ${r.sum.failOk}/${r.sum.failAll}  ${t3bText}  ${r.sum.pwOk}/${r.sum.pwAll}  ${r.sum.prOk}/${r.sum.prAll}  ${fullT} | ${r.sum.paceOk}/${r.sum.paceAll} ${r.sum.durOk}/${r.sum.durAll}  (${r.ms}ms)` +
      (r.sum.prWorst && r.sum.prWorst.ratio < 1 ? `  ㉑最悪: ${r.sum.prWorst.id}@run${r.sum.prWorst.runIdx} x${r.sum.prWorst.ratio.toFixed(2)}` : '')
    );
  }
}

function printDetail(sim, maxRows) {
  const fullT = fullUnlockTime(sim);
  console.log('run  開始      周回時間   T1判定  ノルマ維持  T3b判定  T3a未達  最高層 討伐 金  総クッキー     PT  スキル数  前周比');
  const rows = sim.runs.slice(0, maxRows || 200);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const prev = i > 0 ? sim.runs[i - 1].runCookies : null;
    const ratio = prev ? (r.runCookies / prev).toFixed(2) : '-';
    const t1J = r.partial ? '-' : (r.startT >= fullT ? '免除' : (r.duration >= 1200 && r.duration <= 7200 ? 'OK' : (r.duration > 7200 ? '長い' : '短い')));
    const t3bJ = r.partial ? '-' : (r.quotaHold >= 0.5 * r.duration ? 'OK' : 'NG');
    const t3aJ = r.partial ? '-' : (r.quotaFailAt != null && r.quotaFailAt < r.duration ? 'OK' : 'NG');
    console.log(
      `${String(r.idx).padStart(3)}  ${fmtT(r.startT).padStart(8)}  ${fmtT(r.duration).padStart(8)}  ${t1J.padEnd(4)}  ${fmtT(r.quotaHold).padStart(8)}  ${t3bJ.padEnd(3)}  ${t3aJ.padEnd(3)}  ${String(r.maxStage).padStart(4)} ${String(r.kills).padStart(4)} ${String(r.golden).padStart(3)}  ${fmtN(r.runCookies).padStart(12)}  ${String(r.gain).padStart(5)}  ${String(r.skillsBought == null ? '-' : r.skillsBought).padStart(3)}   ${ratio}${r.partial ? ' (途中)' : ''}  ${(r.skillIds || []).join(',')}`
    );
  }
}

function printPacing(sim) {
  const ev = mergeEventsByRun(sim);
  const yC = makeY(sim);
  console.log('解放イベント (全解放を個別カウント・同一秒のみ統合 / t, 種別, 内容, 次までy, 目標Y=2段階帯域, 判定)');
  for (let i = 0; i < ev.length; i++) {
    const next = ev[i + 1];
    const y = next ? next.t - ev[i].t : null;
    const Y = next ? yC(next.t) : null;
    const ok = y === null ? '-' : (y >= 0.5 * Y && y <= Y ? 'OK' : (y > Y ? '遅い' : '早い'));
    console.log(`${fmtT(ev[i].t).padStart(9)}  ${ev[i].kind.padEnd(8)} ${String(ev[i].id).slice(0, 44).padEnd(44)} y=${y === null ? '-' : fmtT(y)} Y=${Y === null ? '-' : fmtT(Y)} ${ok}`);
  }
}

// ==== 条件①②③⑨⑩: 「その回だけ無効」トグル判定(2026-07-06 確定方式) ====
// 判定したい周回kの開始スナップショットから、その機能をその回だけ効果ゼロにして周回kを再実行し、
// 有効時の周回kと獲得効率(周回総クッキー÷周回時間)を比較する。他の回は無効化しない。
function replayRatio(strategy, base, runIdx, disOpts) {
  const orig = base.runs[runIdx];
  const snap = base.snapshots[runIdx];
  if (!snap || orig.partial) return null;
  // 打ち切り: 元周回の6倍または+2時間(遅い側の効率も打ち切り時点の効率で比較できる)
  const cap = Math.max(orig.duration * 6, orig.duration + 7200);
  const rep = G.replayRun(strategy, snap, disOpts, cap);
  const re = orig.runCookies / Math.max(1, orig.duration);
  const rd = rep.runCookies / Math.max(1, rep.duration);
  if (!(re > 0) || !(rd > 0) || !Number.isFinite(re) || !Number.isFinite(rd)) return null;
  return Math.log(re / rd);
}
// 機能がその周回で「使用された」判定(取得済みの回のみトグル対象)
function activeRunsOf(base, kind, id) {
  const out = [];
  const full = base.runs.filter(r => !r.partial);
  for (const r of full) {
    let a = false;
    if (kind === 'research') a = (r.researchBought || []).includes(id);
    else if (kind === 'stage') {
      const [rid, st] = id.split(':');
      a = ((st === '2' ? r.stages2 : r.stages3) || []).includes(rid);
    } else if (kind === 'reward') a = (r.perks && r.perks[id] > 0);
    else if (kind === 'upgrade') a = (r.upCounts && r.upCounts[id] > 0);
    if (a) out.push(r.idx);
  }
  return out;
}
function toggleRow(strategy, base, kind, id, need) {
  const optKey = { research: 'disableResearch', reward: 'disableReward', stage: 'disableStage', upgrade: 'disableUpgrade', affinity: 'disableAffinity' }[kind];
  const hours = base.opt.hours;
  const runIdxs = kind === 'affinity'
    ? base.runs.filter(r => !r.partial && r.kills > 0).map(r => r.idx)
    : activeRunsOf(base, kind, id);
  if (!runIdxs.length) return { kind, id, need, used: false, ratio: 1 };
  const logs = [];
  const usedIdxs = [];
  for (const k of runIdxs) {
    const lg = replayRatio(strategy, base, k, { hours, [optKey]: kind === 'affinity' ? true : id });
    if (lg !== null) { logs.push(lg); usedIdxs.push(k); }
  }
  if (!logs.length) return { kind, id, need, used: false, ratio: 1 };
  return { kind, id, need, used: true, ratio: Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length), runs: logs.length, logs, runIdxs: usedIdxs };
}

function runToggles(strategy, hours, kind, baseSim) {
  const base = baseSim || G.simulate(strategy, { hours, snapshots: true });
  const rows = [];
  // kind 例: 'all' | 'research' | 'reward' | 'stage' | 'upgrade'
  //         | 'research:spiceBlend,galaxyAssembly' | 'reward:monsterDamage'
  //         | 'stage:spiceBlend:2' (研究idのみ指定なら段2・段3両方) | 'upgrade:finger,grandma'
  let resFilter = null, rwFilter = null, stFilter = null, upFilter = null;
  let doRes = kind === 'research' || kind === 'all';
  let doRw = kind === 'reward' || kind === 'all';
  let doStage = kind === 'stage' || kind === 'all';
  let doUp = kind === 'upgrade' || kind === 'all';
  if (kind.startsWith('research:')) { doRes = true; resFilter = new Set(kind.slice(9).split(',')); }
  if (kind.startsWith('reward:')) { doRw = true; rwFilter = new Set(kind.slice(7).split(',')); }
  if (kind.startsWith('stage:')) { doStage = true; stFilter = new Set(kind.slice(6).split(',')); }
  if (kind.startsWith('upgrade:')) { doUp = true; upFilter = new Set(kind.slice(8).split(',')); }
  if (doRes) {
    for (const r of G.RESEARCH) {
      if (resFilter && !resFilter.has(r.id)) continue;
      rows.push(toggleRow(strategy, base, 'research', r.id, 1.2));
    }
  }
  if (doRw) {
    for (const rw of G.REWARD_POOL) {
      if (rwFilter && !rwFilter.has(rw.id)) continue;
      rows.push(toggleRow(strategy, base, 'reward', rw.id, 1.1));
    }
  }
  // 条件⑨: 研究「段階」(段2/段3の26種)を単体で効果ゼロ化(購入行動は同一)
  if (doStage) {
    for (const r of G.RESEARCH) {
      for (const st of [2, 3]) {
        const key = r.id + ':' + st;
        if (stFilter && !stFilter.has(key) && !stFilter.has(r.id)) continue;
        rows.push(toggleRow(strategy, base, 'stage', key, 1.05));
      }
    }
  }
  // 条件⑩: 設備1種の生産だけをゼロ(所持数は各計算式に残す・購入行動同一)
  if (doUp) {
    for (const u of G.UPGRADES) {
      if (upFilter && !upFilter.has(u.id)) continue;
      rows.push(toggleRow(strategy, base, 'upgrade', u.id, 1.2));
    }
  }
  return { base, rows };
}

// 中央値(倍率の対数空間で中間2つの平均=偶数個でも安定)
function medianRatio(logs) {
  const a = logs.slice().sort((x, y) => x - y);
  const n = a.length;
  const m = n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
  return Math.exp(m);
}
function printToggles(res) {
  // 2026-07-06 ユーザー採用(案1-A): ①③⑨⑩の下限判定は「取得済み周回の比の中央値 ≥ 閾値」。
  //  まぐれ勝ち・まぐれ負け(周回内タイミングの分岐が終盤の急成長で増幅されるもの)に左右されず、
  //  「ふつうの周回で効いているか」を見る。min/max/幾何平均は参考表示として残す。
  //  未使用(どの方針も取得しない)機能は比=1.0=不合格として扱う(スキップしない)
  console.log('種別      ID                        各回比[min..max] 中央値(幾何平均)   必要   中央値判定   ±1.5倍判定(全回)');
  const KINDS = [['research', '研究', 1.2], ['reward', '報酬', 1.1], ['stage', '段階', 1.05], ['upgrade', '設備', 1.2]];
  const out = { lowOk: 0, lowAll: 0, bandOk: 0, bandAll: 0 };
  for (const [kind, label, need] of KINDS) {
    const rows = res.rows.filter(r => r.kind === kind);
    if (!rows.length) continue;
    // 各回×各機能の比行列(logs は比較対象周回ごとのlog比。runKeys で行を揃える)
    for (const r of rows) {
      out.lowAll++;
      if (!r.used) { console.log(`${kind.padEnd(9)} ${r.id.padEnd(26)} (未使用: 比=1.0)  x${need}  NG  -`); continue; }
      const ratios = r.logs.map(v => Math.exp(v));
      const mn = Math.min(...ratios), mx = Math.max(...ratios);
      const gm = Math.exp(r.logs.reduce((a, b) => a + b, 0) / r.logs.length);
      const med = medianRatio(r.logs);
      const lowOk = med >= need;
      if (lowOk) out.lowOk++;
      r._ratios = ratios; r._low = lowOk; r._med = med;
      console.log(`${kind.padEnd(9)} ${r.id.padEnd(26)} [${mn.toFixed(2)}..${mx.toFixed(2)}] 中央値${med.toFixed(2)} (${gm.toFixed(2)}) x${r.logs.length}回  x${need}  ${lowOk ? 'OK' : 'NG(中央値<' + need + ')'}`);
    }
    // ②(研究のみ・2026-07-06 ユーザー採用): 一強禁止は「研究ごとの中央値」同士で±1.5倍
    if (kind === 'research') {
      const meds = rows.filter(r => r.used && r._med != null).map(r => ({ id: r.id, med: r._med }));
      if (meds.length >= 2) {
        const gmean = Math.exp(meds.reduce((a, b) => a + Math.log(b.med), 0) / meds.length);
        const ok2 = meds.filter(m => m.med >= gmean / 1.5 && m.med <= gmean * 1.5);
        const ng2 = meds.filter(m => !(m.med >= gmean / 1.5 && m.med <= gmean * 1.5));
        console.log(`②(中央値同士の±1.5倍・平均${gmean.toFixed(2)}): ${ok2.length}/${meds.length}${ng2.length ? ' NG: ' + ng2.map(m => m.id + '=' + m.med.toFixed(2)).join(',') : ' 全研究OK'}`);
      }
    }
    // ±1.5倍(各回・③⑨⑩は従来どおり): 同一周回内で有効な機能同士。runIdx単位で照合
    const used = rows.filter(r => r.used && r.runIdxs);
    const byRun = new Map();
    for (const r of used) {
      r.runIdxs.forEach((ri, j) => {
        if (!byRun.has(ri)) byRun.set(ri, []);
        byRun.get(ri).push(Math.exp(r.logs[j]));
      });
    }
    let bOk = 0, bAll = 0;
    for (const [ri, arr] of byRun) {
      if (arr.length < 2) continue;
      bAll++;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      if (arr.every(v => v >= mean / 1.5 && v <= mean * 1.5)) bOk++;
    }
    out.bandOk += bOk; out.bandAll += bAll;
    console.log(`${label}: 中央値OK ${rows.filter(r => r._low).length}/${rows.length} / ±1.5倍(各回) ${bOk}/${bAll}周回`);
  }
  return out;
}

// ================= 新判定 ⑧⑫⑬ =================
// 条件⑧(2026-07-06 新): 全ての転生がノルマ未達の後に起きる(旧PT効率減衰は廃止)
function printQuotaFailBefore(stratId, sim) {
  const full = sim.runs.filter(r => !r.partial);
  const miss = full.filter(r => !(r.quotaFailAt != null && r.quotaFailAt < r.duration));
  console.log(`${stratId}: ⑧ 未達→転生 ${full.length - miss.length}/${full.length}` +
    (miss.length ? ` NG周回: ${miss.map(r => r.idx).join(',')}` : ' 全周回OK'));
  return miss.length === 0;
}

// 条件⑫(新・文脈依存性): 各選択カテゴリで「最適な選択」が方針間で2種以上に分かれる
function printContext(sims) {
  console.log('⑫ 文脈依存性');
  // 設備: 「次に買う最も費用対効果の高い設備」のサンプル最頻値(方針ごと)
  const topEquip = {};
  for (const id of Object.keys(sims)) {
    const cs = sims[id].choiceSamples || [];
    const cnt = {};
    for (const c of cs) cnt[c] = (cnt[c] || 0) + 1;
    topEquip[id] = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  }
  const eqSet = new Set(Object.values(topEquip).map(v => v[0]));
  console.log(' 設備(最効率の最頻): ' + Object.keys(topEquip).map(k => k + '=' + (topEquip[k][0] || '-')).join(' '));
  // 報酬: ピック1位カテゴリ(獲得perksをカテゴリ集計)
  const CAT = {}; G.REWARD_POOL.forEach(r => CAT[r.id] = r.category);
  const topCat = {};
  for (const id of Object.keys(sims)) {
    const per = {}; const last = sims[id].runs.filter(r => !r.partial).slice(-3);
    for (const r of last) for (const [k, v] of Object.entries(r.perks || {})) { if (v > 0) per[CAT[k]] = (per[CAT[k]] || 0) + v; }
    topCat[id] = Object.entries(per).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '-';
  }
  const rwSet = new Set(Object.values(topCat));
  console.log(' 報酬(ピック1位カテゴリ): ' + Object.keys(topCat).map(k => k + '=' + topCat[k]).join(' '));
  // 研究(⑫仕様): 「有効無効差が最大の研究」= その回だけ無効トグルの幾何平均比が最大の研究
  // 計測コスト削減のため各方針12hで13研究をスナップショット方式判定
  const topRes = {};
  for (const id of Object.keys(sims)) {
    const s = STRATEGIES.find(x => x.id === id);
    const res = runToggles(s, 12, 'research');
    let best = '-', bestR = 0;
    for (const row of res.rows) if (row.used && row.ratio > bestR) { bestR = row.ratio; best = row.id; }
    topRes[id] = best;
  }
  const resSet = new Set(Object.values(topRes));
  console.log(' 研究(有効無効差が最大): ' + Object.keys(topRes).map(k => k + '=' + topRes[k]).join(' '));
  const ok2 = x => x.size >= 2;
  console.log(` → 設備${eqSet.size}種 / 報酬${rwSet.size}種 / 研究${resSet.size}種 (各2種以上で OK): ${ok2(eqSet) && ok2(rwSet) ? '設備報酬OK' : 'NG'}${ok2(resSet) ? '' : ' (研究は方針の買い順が同型)'}`);
  return { eq: eqSet.size, rw: rwSet.size, res: resSet.size };
}
// ⑫周回方針: 同一戦略で5方針を差し替えて総合効率比較(最良/最悪≤3、各方針がどこかで最良)
function printPolicyContext(hours) {
  const base = STRATEGIES.find(s => s.id === 'S1');
  const POL = ['balanced', 'click', 'golden', 'hunt', 'bake'];
  const res = {};
  for (const p of POL) {
    const st = Object.assign({}, base, { pickPolicy: () => p });
    const sim = G.simulate(st, { hours });
    const full = sim.runs.filter(r => !r.partial);
    res[p] = {
      total: sim.runs.reduce((a, r) => a + r.runCookies, 0),
      kills: full.reduce((a, r) => a + r.kills, 0),
      golden: full.reduce((a, r) => a + r.golden, 0),
      maxStage: Math.max(...full.map(r => r.maxStage)),
      runs: full.length
    };
  }
  const totals = POL.map(p => res[p].total);
  const ratio = Math.max(...totals) / Math.min(...totals);
  const bestOf = m => POL.reduce((b, p) => res[p][m] > res[b][m] ? p : b, POL[0]);
  const bests = { total: bestOf('total'), kills: bestOf('kills'), golden: bestOf('golden'), maxStage: bestOf('maxStage'), runs: bestOf('runs') };
  const covered = new Set(Object.values(bests));
  console.log(' 周回方針(S1で5方針差し替え):');
  for (const p of POL) console.log(`  ${p.padEnd(9)} total=${fmtN(res[p].total)} kills=${res[p].kills} golden=${res[p].golden} maxSt=${res[p].maxStage} runs=${res[p].runs}${Object.entries(bests).filter(([m, w]) => w === p).map(([m]) => ' ★' + m).join('')}`);
  console.log(` → 総合効率 最良/最悪=${ratio.toFixed(2)} (≤3で OK: ${ratio <= 3 ? 'OK' : 'NG'}) / 最良獲得方針 ${covered.size}/5種`);
  return { ratio, covered: covered.size };
}

// 条件⑬: タイミング機能の実効性。最適操作(既定)と完全放置(idleTiming)の獲得効率比が +5%〜+100%。
const TIMING_FEATURES = [
  { key: 'wave', label: '観測ゆらぎ(量子発酵 段2)', stage: 'quantumProofing:2' },
  { key: 'bhCharge', label: '圧縮チャージ(重力圧縮 段2)', stage: 'blackHoleCompression:2' },
  { key: 'mature', label: '熟成(香料調合 段2)', stage: 'spiceBlend:2' },
  { key: 'huntExtend', label: '延長狩り(異世界接続網 段2)', stage: 'portalNetwork:2' }
];
function runTimingChecks(strategy, hours, base) {
  // ⑬もスナップショット方式: 段2を取得した各回を「その回だけ完全放置」で再実行して効率比較
  if (!base || !base.snapshots) base = G.simulate(strategy, { hours, snapshots: true });
  const rows = [];
  for (const f of TIMING_FEATURES) {
    const [rid, st] = f.stage.split(':');
    const runIdxs = activeRunsOf(base, 'stage', f.stage);
    if (!runIdxs.length || !base.snapshots) { rows.push({ f, used: false, ratio: 1 }); continue; }
    const logs = [];
    for (const k of runIdxs) {
      const lg = replayRatio(strategy, base, k, { hours: base.opt.hours, idleTiming: f.key });
      if (lg !== null) logs.push(lg);
    }
    if (!logs.length) { rows.push({ f, used: false, ratio: 1 }); continue; }
    rows.push({ f, used: true, ratio: Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length), runs: logs.length, atT: base.firstStageBuy[f.stage] });
  }
  return rows;
}
function printTiming(stratId, rows) {
  console.log(`${stratId}: ⑬ タイミング機能 (最適操作/完全放置の獲得効率比, 要求 +5%〜+100% = [1.05, 2.00])`);
  let allOk = true;
  for (const r of rows) {
    let verdict;
    if (!r.used) { verdict = '(未使用: 対応する段2が未購入)'; allOk = false; }
    else verdict = (r.ratio >= 1.05 && r.ratio <= 2.0) ? `${r.ratio.toFixed(3)} OK` : `${r.ratio.toFixed(3)} NG`;
    if (r.used && !(r.ratio >= 1.05 && r.ratio <= 2.0)) allOk = false;
    console.log(` ${r.f.label.padEnd(22)} ${verdict} ${r.atT != null ? '(初購入t=' + Math.round(r.atT / 3600) + 'h, 対象' + r.runs + '周回)' : ''}`);
  }
  console.log(` → ${stratId} ⑬: ${allOk ? 'OK' : 'NG'}`);
  return allOk;
}

// ⑬(提案5・2026-07-07承認=全体比較): タイミング機能の実効性を「通し比較」で測る。
// 最適操作の通し(既定)と完全放置の通し(idleTiming)をそれぞれ走らせ、全周回の獲得効率
// (runCookies/duration)の幾何平均の比を取る。機能ごとに「その機能だけ放置した通し」を1本走らせ、
// 全機能同時放置('all')の合算も出す。瞬間比較(旧・期待値方式)が構造的に1.000に張り付く問題の解。
function geomeanEff(sim) {
  const full = sim.runs.filter(r => !r.partial && r.runCookies > 0 && r.duration > 0 && Number.isFinite(r.runCookies));
  if (!full.length) return null;
  const s = full.reduce((a, r) => a + Math.log(r.runCookies / r.duration), 0);
  return Math.exp(s / full.length);
}
// ③ utility軸(2026-07-08 ユーザー承認の「utility報酬を別軸で測る」変更): 直接クッキーを生まない報酬
// (滞在窓/次イベントの状態書き換え/報酬の量・価値=進行に効く型)は瞬間の稼ぎ力比が構造的に1.00に張り付く
// (⑬タイミングと同じ理由=効果が「行動の瞬間に一度だけ状態へ書き込まれる」ため、同状態の瞬間評価で差が出ない)。
// これらは ⑬ と同じ通し比較で測る: その報酬を取得し始めた周回以降の全周回効率(runCookies/duration)の
// 幾何平均を、最適(=取得あり)と disableReward(=効果無効)で比べる。取得周回に絞るのは③の「取得した周回」の趣旨に合わせ希釈を避けるため。
// goldenChain/beastScent は所持数が多く(S3で10〜18)、通し比較(utility軸)で測る。金収入は周回で複利的に
// 効くため控えめ係数でも通し比≥1.1。※2026-07-09 ユーザー通知: ゲーム側で総クッキー計算方式を変更済み=総クッキーが
// float の Infinity(~1.8e308)を超えても処理落ちしない。よって「最終放置周回の Infinity 化を避けるため係数を抑える」
// 制約は撤廃(有限性条件も撤廃済み)。sim は float 依存のため最終放置周回のみ Infinity に達しうるが、④⑤は転生周回だけ
// を比較し、その転生周回は全方針有限(e155〜e233 ≪ e308)なので無関係。下の isFinite ガードはこの最終放置周回を
// 幾何平均計算から除くだけの float アーティファクト対策で、合否条件ではない。
// goldenTarget/goldenFirstHit は所持数が少なく instant 中央値≥1.1 を満たす(有限)ので direct 側に残す。
const UTILITY_REWARDS = ['monsterDamage', 'monsterStay', 'crackedFang', 'brandHunt', 'deepPursuit', 'chainPrep', 'huntFocus', 'biteRecovery', 'crushedMill', 'goldenBeastMutation', 'goldenChain', 'beastScent'];
function firstAcqIdx(sim, rid) {
  let best = null;
  for (const r of sim.runs) { if (!r.partial && r.perks && r.perks[rid] > 0) { if (best === null || r.idx < best) best = r.idx; } }
  return best;
}
function geomeanEffFrom(sim, minIdx) {
  const full = sim.runs.filter(r => !r.partial && r.idx >= minIdx && r.runCookies > 0 && r.duration > 0 && Number.isFinite(r.runCookies));
  if (!full.length) return null;
  return Math.exp(full.reduce((a, r) => a + Math.log(r.runCookies / r.duration), 0) / full.length);
}
// median(中央値)
function medianOf(arr) { const a = arr.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; }
// 取得済み周回の等間隔サンプル(最大 k 個)。全周回を replay するとコスト過大なので間引く(中央値は安定)。
function sampleRuns(runs, k) {
  if (runs.length <= k) return runs;
  const out = []; const step = (runs.length - 1) / (k - 1);
  for (let i = 0; i < k; i++) out.push(runs[Math.round(i * step)]);
  return out;
}
// ③utility軸(2026-07-09 ユーザー承認=「短い枝分かれ比べ」): 各周回の開始スナップショット(同一状態)から、
// 報酬アリ(=opt周回そのもの)と報酬ナシ(disableReward)を**その1周回ぶんだけ**枝分かれさせ、
// 同一時間(optの周回長)で稼いだ総クッキーの比を取る。枝分かれが1周回で閉じる=転生回数の増減が混入せず
// 軌道に鈍い(per-run 100h幾何平均の脆さ=旧B案/instant/per-tickの行き止まりを解消)。取得した周回の中央値≥1.1で合格。
// ON側は opt 周回の runCookies をそのまま使う(replay不要=コスト半減)。比は上限クランプで Infinity/NaN を避ける。
const BRANCH_CAP = 1e9; // 比の上限(≥1.1判定には十分。idle成長で1周回内でも数十桁差が出るためのガード)
function judgeUtilityRewards(hours, sims, ids) {
  let ok = 0;
  console.log('③ 報酬utility軸(短い枝分かれ比べ・同一状態から1周回ぶん・総クッキー比の中央値 ≥1.1)');
  // 各方針の snapshot 付き opt を1回だけ作って使い回す
  const optSnap = {};
  for (const s of STRATEGIES) optSnap[s.id] = G.simulate(s, { hours, snapshots: true });
  for (const rid of ids) {
    let best = 0, bestPol = null, bestN = 0, anyUsed = false;
    const users = STRATEGIES.map(s => {
      const sim = optSnap[s.id];
      const acq = sim.runs.filter(r => !r.partial && r.perks && r.perks[rid] > 0 && r.runCookies > 0 && r.duration > 0 && sim.snapshots[r.idx]);
      return { s, sim, acq };
    }).filter(x => x.acq.length > 0);
    // 取得周回が多い方針から測り、中央値≥1.1が出たら早期終了
    users.sort((a, b) => b.acq.length - a.acq.length);
    for (const { s, sim, acq } of users) {
      anyUsed = true;
      const ratios = [];
      for (const optRun of sampleRuns(acq, 12)) {
        const snap = sim.snapshots[optRun.idx];
        const off = G.replayRun(s, snap, { hours, disableReward: rid }, optRun.duration);
        if (off && off.runCookies > 0 && Number.isFinite(off.runCookies) && Number.isFinite(optRun.runCookies)) {
          ratios.push(Math.min(BRANCH_CAP, optRun.runCookies / off.runCookies));
        }
      }
      const m = ratios.length ? medianOf(ratios) : null;
      if (m != null && m > best) { best = m; bestPol = s.id; bestN = ratios.length; }
      if (best >= 1.1) break;
    }
    const pass = best >= 1.1;
    if (pass) ok++;
    console.log(`  ${pass ? 'OK' : 'NG'} rw:${rid.padEnd(20)} ${anyUsed ? `${bestPol} 中央値比=${best.toFixed(3)} (n=${bestN})` : 'どの方針も未取得'}`);
  }
  console.log(`③ utility軸 ${ok}/${ids.length}`);
  return ok;
}
// ⑨ の段階のうち、⑬タイミング機能そのもの(観測ゆらぎ=量子証明段2/3・圧縮チャージ=重力圧縮段2/3)は
// ⑬(最適操作 vs 完全放置の通し比較[1.05,2.0])で判定済み。⑨(瞬間比較lift≥1.05)は同じ機能を構造的に
// 測れない(タイミング効果は行動の瞬間に一度だけ状態へ書き込むため1.00張り付き)ので⑨の判定対象から除外する
// (2026-07-08 ユーザー承認・提案1)。※spiceBlend段2/portalNetwork段2 は非タイミングの生産効果もあり⑨で通るので残す。
const STAGE_TIMING_EXCLUDE = new Set([
  'stage:quantumProofing:2', 'stage:quantumProofing:3',
  'stage:blackHoleCompression:2', 'stage:blackHoleCompression:3'
]);
// ⑨ の段階のうち、効果が earningPower(⑨の瞬間比較proxy)の外で稼ぐもの(銀行の複利利息・会心の余熱)は
// 瞬間比較では構造的に1.00。これらは「瞬間判断以外」で測る(2026-07-08 ユーザー承認・提案2)=⑬/③utility軸と同じ
// 通し比較: その段を取得し始めた周回以降の全周回効率(runCookies/duration)の幾何平均を、最適と disableStage で比べ ≥1.05。
const STAGE_WHOLE = ['stage:bankClickDividend:2', 'stage:bankClickDividend:3', 'stage:fingerTechnique:3'];
function stageFirstAcqIdx(sim, stageKey) {
  const p = stageKey.split(':'); const rid = p[1], lv = p[2];
  const arr = lv === '2' ? 'stages2' : 'stages3';
  let best = null;
  for (const r of sim.runs) { if (!r.partial && (r[arr] || []).includes(rid)) { if (best === null || r.idx < best) best = r.idx; } }
  return best;
}
// ⑨whole軸(利息/余熱)を③と同じ「短い枝分かれ比べ」へ統一(2026-07-09 ユーザー承認A)。旧 per-run 幾何平均は③と同型で
// 軌道に脆弱=偽合格を出していた(枝分かれ比では3段とも真値1.00〜1.03)。各段が解放済みの周回の開始スナップから
// disableStage で1周回ぶん枝分かれし、総クッキー比の中央値≥1.05。robust化に伴い3段の効果は別途「総クッキーに繋ぐ」復活調整を実施。
function stageHeld(r, key) { const p = key.split(':'); const arr = p[2] === '2' ? 'stages2' : 'stages3'; return (r[arr] || []).includes(p[1]); }
function judgeStageWhole(hours, sims, keys) {
  let ok = 0;
  console.log('⑨ 段階whole軸(短い枝分かれ比べ・同一状態から1周回ぶん・総クッキー比の中央値 ≥1.05・利息/余熱)');
  const optSnap = {};
  for (const s of STRATEGIES) optSnap[s.id] = G.simulate(s, { hours, snapshots: true });
  for (const key of keys) {
    const p = key.split(':'); const disableVal = p[1] + ':' + p[2];
    let best = 0, bestPol = null, bestN = 0, anyUsed = false;
    const users = STRATEGIES.map(s => {
      const sim = optSnap[s.id];
      const acq = sim.runs.filter(r => !r.partial && stageHeld(r, key) && r.runCookies > 0 && r.duration > 0 && sim.snapshots[r.idx]);
      return { s, sim, acq };
    }).filter(x => x.acq.length > 0).sort((a, b) => b.acq.length - a.acq.length);
    for (const { s, sim, acq } of users) {
      anyUsed = true;
      const ratios = [];
      for (const optRun of sampleRuns(acq, 12)) {
        const off = G.replayRun(s, sim.snapshots[optRun.idx], { hours, disableStage: disableVal }, optRun.duration);
        if (off && off.runCookies > 0 && Number.isFinite(off.runCookies) && Number.isFinite(optRun.runCookies)) ratios.push(Math.min(BRANCH_CAP, optRun.runCookies / off.runCookies));
      }
      const m = ratios.length ? medianOf(ratios) : null;
      if (m != null && m > best) { best = m; bestPol = s.id; bestN = ratios.length; }
      if (best >= 1.05) break;
    }
    const pass = best >= 1.05;
    if (pass) ok++;
    console.log(`  ${pass ? 'OK' : 'NG'} ${key.padEnd(28)} ${anyUsed ? `${bestPol} 中央値比=${best.toFixed(3)} (n=${bestN})` : 'どの方針も未取得'}`);
  }
  console.log(`⑨ whole軸 ${ok}/${keys.length}`);
  return ok;
}
// ⑬ タイミング機能=「短い枝分かれ比べ」(2026-07-09 実装。承認B「取得後窓」を実測した結果、晩期取得機能=
// 圧縮チャージで opt/idle 軌道乖離が窓内で複利発散(比2.5e16)し帯[1.05,2.0]で測れないと確認。ユーザーの包括承認
// 「総クッキーへの影響が測れてない場合は測れる条件に変えてよい」に基づき、③/⑨と同じ枝分かれ方式へ統一):
// その機能(段2)を取得済みの各周回の開始スナップから「その機能だけ完全放置(idleTiming)」で同一時間だけ枝分かれ再実行し、
// 総クッキー比(最適/放置)の中央値が [1.05, 2.0]。1周回で閉じる=軌道乖離が複利発散しない・希釈もない。
function timingHeld(r, rid) { return (r.stages2 || []).includes(rid); }
function judgeWholeTiming(hours, sims) {
  let ok = 0;
  console.log(`⑬ タイミング機能(短い枝分かれ比べ・最適操作/その機能だけ完全放置の1周回総クッキー比の中央値, 要求[1.05,2.00])`);
  const optSnap = {};
  for (const s of STRATEGIES) optSnap[s.id] = G.simulate(s, { hours, snapshots: true });
  for (const f of TIMING_FEATURES) {
    const rid = f.stage.split(':')[0];
    const rows = [];
    let feature = false;
    for (const s of STRATEGIES) {
      const sim = optSnap[s.id];
      const acq = sim.runs.filter(r => !r.partial && timingHeld(r, rid) && r.runCookies > 0 && r.duration > 0 && sim.snapshots[r.idx]);
      if (!acq.length) continue;
      const ratios = [];
      for (const optRun of sampleRuns(acq, 12)) {
        const idle = G.replayRun(s, sim.snapshots[optRun.idx], { hours, idleTiming: f.key }, optRun.duration);
        if (idle && idle.runCookies > 0 && Number.isFinite(idle.runCookies) && Number.isFinite(optRun.runCookies)) {
          ratios.push(Math.min(BRANCH_CAP, optRun.runCookies / idle.runCookies));
        }
      }
      const m = ratios.length ? medianOf(ratios) : null;
      if (m == null) continue;
      const inBand = m >= 1.05 && m <= 2.0;
      if (inBand) feature = true;
      rows.push(`${s.id}=${m.toFixed(3)}${inBand ? '✓' : ''}(n=${ratios.length})`);
    }
    if (feature) ok++;
    console.log(`  ${feature ? 'OK' : 'NG'} ${f.label.padEnd(26)} ${rows.join(' ') || '(どの方針も未使用)'}`);
  }
  console.log(`⑬ タイミング ${ok}/${TIMING_FEATURES.length}`);
  return ok;
}

// ⑬v3(2026-07-16): 窓限定の枝分かれ比。単一周回全体だと離散×再投資の効果(mature/portal)が方針依存で二極発散
// (1.0↔1e9)する測定限界。同一スナップから最適/放置を「同じ短窓W秒だけ」枝分かれ→窓内クッキー比。転生を跨がず
// 複利発散が有界=機能の周回内の限界寄与を安定して測る(段2は晩期取得だが機能自体は周回頭から効くのでW=600sで測れる)。
function judgeWindowTiming(hours, W) {
  const win = W || 600;
  let ok = 0;
  console.log(`⑬ タイミング機能v3(窓${win}s・同一スナップから最適/放置を同窓枝分かれした窓内クッキー比の中央値, 要求[1.05,2.00])`);
  const optSnap = {};
  for (const s of STRATEGIES) optSnap[s.id] = G.simulate(s, { hours, snapshots: true });
  for (const f of TIMING_FEATURES) {
    const rid = f.stage.split(':')[0];
    const rows = [];
    let feature = false;
    for (const s of STRATEGIES) {
      const sim = optSnap[s.id];
      const acq = sim.runs.filter(r => !r.partial && timingHeld(r, rid) && sim.snapshots[r.idx]);
      if (!acq.length) continue;
      const ratios = [];
      for (const run of sampleRuns(acq, 6)) {
        const on = G.replayRun(s, sim.snapshots[run.idx], { hours }, win);            // 機能ON(最適)
        const off = G.replayRun(s, sim.snapshots[run.idx], { hours, idleTiming: f.key }, win); // 機能だけ放置
        if (on && off && on.runCookies > 0 && off.runCookies > 0 && Number.isFinite(on.runCookies) && Number.isFinite(off.runCookies)) {
          ratios.push(Math.min(BRANCH_CAP, on.runCookies / off.runCookies));
        }
      }
      const m = ratios.length ? medianOf(ratios) : null;
      if (m == null) continue;
      const inBand = m >= 1.05 && m <= 2.0;
      if (inBand) feature = true;
      rows.push(`${s.id}=${m.toFixed(3)}${inBand ? '✓' : ''}(n=${ratios.length})`);
    }
    if (feature) ok++;
    console.log(`  ${feature ? 'OK' : 'NG'} ${f.label.padEnd(26)} ${rows.join(' ') || '(未使用)'}`);
  }
  console.log(`⑬v3 タイミング ${ok}/${TIMING_FEATURES.length}`);
  return ok;
}

// ⑬v4(2026-07-16): 取得直後スナップから短窓の枝分かれ。段2は周回中盤で取得=周回頭snapだと未活性で1.000、
// 周回全体だと離散×再投資が複利発散。「機能取得の瞬間のsnap」から最適/放置を同じ窓W秒だけ枝分かれ→機能が活性で
// かつ有界=安定測定を狙う(sim側 opt.timingSnaps で取得直後snapを保存)。
function judgeAcqWindowTiming(hours, W) {
  const win = W || 900;
  let ok = 0;
  console.log(`⑬ タイミング機能v4(取得直後snap→同窓${win}s枝分かれの窓内クッキー比の中央値, 要求[1.05,2.00])`);
  // 2026-07-25 診断ラウンドの結論(freezeBuys+窓内増分比を試作→3バッテリー対照で棄却し本形へ復帰):
  // ・freezeBuys(窓内購入/転生凍結)は転生の自然打ち切りを失わせ、末期snap(観測ゆらぎ=e+263購入直後等)の
  //   runCookiesがe+308を越えInfinity→行が全て弾かれ「(未取得)」誤表示=合格していたwave S3=1.310✓を壊した
  //   (実測)。総額比+転生打ち切り(本形)は転生が発散の有界化装置として働く=触らない。
  // 既知の構造限界(帯NGの帰属・実測診断 2026-07-25):
  // ・圧縮チャージ=比が数万に発散: 後期レジームには討伐報酬EMA・銀行利息cap(EMA連動)等の乗法feedbackが
  //   あり枝の倍率差が窓内で指数増幅される(購入凍結・窓300s・尾部snapのいずれでも発散=3対照実測)。
  //   有界に測るには「成長率差」等の別統計=判定仕様の変更(要ユーザー判断・提案として記録)。
  // ・延長狩り=全方針exactly 1.000: simの実収入経路に討伐パルスが無い(討伐価値項kpsSat×KVSは㉘シェア
  //   分解の計測専用・実払いはcps+タップ+直送5系のみ)=窓(湧きテンポ)はクッキーへ経路化されておらず
  //   窓比では原理的に測れない。実ゲームは討伐がクッキーを落とすため機構は生きている(E2E/HANDOFF R31)。
  //   sim側で測るには討伐パルス収入の追加=経済モデル変更(要ユーザー判断・提案として記録)。
  for (const f of TIMING_FEATURES) {
    const rid = f.stage.split(':')[0];
    const rows = [];
    let feature = false;
    let snapSeen = false, skipped = 0;
    for (const s of STRATEGIES) {
      const sim = G.simulate(s, { hours, timingSnaps: true });
      const snap = sim.timingSnaps && sim.timingSnaps[rid];
      if (!snap) continue;
      snapSeen = true;
      const cap = (snap.run.startT != null ? (snap.t - snap.run.startT) : 0) + win; // 取得地点から win 秒
      const on = G.replayRun(s, snap, { hours }, cap);
      const off = G.replayRun(s, snap, { hours, idleTiming: f.key }, cap);
      if (on && off && on.runCookies > 0 && off.runCookies > 0 && Number.isFinite(on.runCookies) && Number.isFinite(off.runCookies)) {
        const ratio = Math.min(BRANCH_CAP, on.runCookies / off.runCookies);
        const inBand = ratio >= 1.05 && ratio <= 2.0;
        if (inBand) feature = true;
        rows.push(`${s.id}=${ratio.toFixed(3)}${inBand ? '✓' : ''}`);
      } else {
        skipped++; // snapはあるが比較不能(Infinity等)=「未取得」と混同しない
      }
    }
    if (feature) ok++;
    const empty = snapSeen ? `(snapあり・比較不能${skipped}件=overflow等)` : '(未取得)';
    console.log(`  ${feature ? 'OK' : 'NG'} ${f.label.padEnd(26)} ${rows.join(' ') || empty}`);
  }
  console.log(`⑬v4 タイミング ${ok}/${TIMING_FEATURES.length}`);
  return ok;
}

// ⑬v2(2026-07-16 ユーザー指示「周回を跨いで効く要素は取得後全周回で比べればいい」):
// 段2機能は取得後、以降の全周回で永続的に効く=1周回だけの枝分かれ(judgeWholeTiming)だと晩期取得機能が
// n=1で過少評価・巨大化する。ここでは「取得後の全周回の獲得効率(runCookies/duration)の幾何平均」を、
// 最適操作の通し と その機能だけ完全放置(idleTiming)の通し で比べる=取得後全周回の平均的な実効lift。
function judgeWholeTimingV2(hours) {
  let ok = 0;
  console.log(`⑬ タイミング機能v2(通し比較・取得後全周回の獲得効率geomean比, 要求[1.05,2.00])`);
  const optSim = {};
  for (const s of STRATEGIES) optSim[s.id] = G.simulate(s, { hours });
  for (const f of TIMING_FEATURES) {
    const rid = f.stage.split(':')[0];
    const rows = [];
    let feature = false;
    for (const s of STRATEGIES) {
      const opt = optSim[s.id];
      let acqIdx = null;
      for (const r of opt.runs) { if (!r.partial && timingHeld(r, rid)) { acqIdx = r.idx; break; } }
      if (acqIdx == null) continue;
      const idle = G.simulate(s, { hours, idleTiming: f.key });
      const eOpt = geomeanEffFrom(opt, acqIdx);
      const eIdle = geomeanEffFrom(idle, acqIdx);
      if (eOpt == null || eIdle == null || !(eIdle > 0) || !Number.isFinite(eOpt) || !Number.isFinite(eIdle)) continue;
      const ratio = Math.min(BRANCH_CAP, eOpt / eIdle);
      const inBand = ratio >= 1.05 && ratio <= 2.0;
      if (inBand) feature = true;
      rows.push(`${s.id}=${ratio.toFixed(3)}${inBand ? '✓' : ''}`);
    }
    if (feature) ok++;
    console.log(`  ${feature ? 'OK' : 'NG'} ${f.label.padEnd(26)} ${rows.join(' ') || '(未使用)'}`);
  }
  console.log(`⑬v2 タイミング ${ok}/${TIMING_FEATURES.length}`);
  return ok;
}

// CLI
const mode = process.argv[2] || 'baseline';
const arg = process.argv[3];
const hours = Number(process.argv[4] || 100);

if (mode === 'baseline') {
  printBaseline(runBaseline(hours, arg));
} else if (mode === 'detail') {
  const s = STRATEGIES.find(x => x.id === arg) || STRATEGIES[0];
  const sim = G.simulate(s, { hours });
  console.log(`戦略: ${s.id} ${s.name}`);
  printDetail(sim);
  const sum = summarize(sim);
  console.log(`合計: ${fmtN(sum.total)} / 1億倍達成 ${sum.doubleOk}/${sum.doubleAll} / PT2-100倍 ${sum.gainOk}/${sum.doubleAll} / ペース ${sum.paceOk}/${sum.paceAll}`);
} else if (mode === 'pacing') {
  const s = STRATEGIES.find(x => x.id === arg) || STRATEGIES[0];
  const sim = G.simulate(s, { hours });
  printPacing(sim);
} else if (mode === 'toggles') {
  const s = STRATEGIES.find(x => x.id === arg) || STRATEGIES[0];
  const kind = process.argv[5] || 'all';
  const res = runToggles(s, hours, kind);
  console.log(`戦略: ${s.id} ${s.name}`);
  printToggles(res);
} else if (mode === 'diag') {
  const s = STRATEGIES.find(x => x.id === arg) || STRATEGIES[0];
  const sim = G.simulate(s, { hours });
  const keys = ['finger','grandma','oven','factory','bank','spiceRack','portal','moonBakery','galaxyFactory','blackHoleMixer','quantumBakery','antimatterOven'];
  console.log('run  dur(s)  kills  maxSt  ' + keys.map(k => k.slice(0, 6).padStart(7)).join(''));
  for (const r of sim.runs.filter(x => !x.partial)) {
    const u = r.upCounts || {};
    console.log(String(r.idx).padStart(3) + '  ' + String(Math.round(r.duration)).padStart(6) + '  ' + String(r.kills).padStart(5) + '  ' + String(r.maxStage).padStart(5) + '  ' + keys.map(k => String(u[k] || 0).padStart(7)).join(''));
  }
} else if (mode === 'profile') {
  const s = STRATEGIES.find(x => x.id === arg) || STRATEGIES[0];
  const runIdx = Number(process.argv[5] || 50);
  const sim = G.simulate(s, { hours, debugRunIdx: runIdx });
  const tr = sim.debugTrace || [];
  console.log(`run ${runIdx} trace: ${tr.length} ticks`);
  let lastDec = -1;
  for (const p of tr) {
    const dec = Math.floor(Math.log10(Math.max(1, p.c)));
    if (dec > lastDec) {
      console.log(`el=${String(Math.round(p.el)).padStart(5)}s  runCookies=1e${dec}  boosts=${p.boosts} kills=${p.kills} gold=${p.gold}`);
      lastDec = dec;
    }
  }
} else if (mode === 'checks8') {
  // ⑧ 単体: node runner.js checks8 [S1|""] [hours]
  for (const s of STRATEGIES) {
    if (arg && s.id !== arg) continue;
    printQuotaFailBefore(s.id, G.simulate(s, { hours }));
  }
} else if (mode === 'context') {
  // ⑫ 単体: node runner.js context "" [hours]
  const sims = {};
  for (const s of STRATEGIES) sims[s.id] = G.simulate(s, { hours, trackChoices: true });
  printContext(sims);
  printPolicyContext(hours);
} else if (mode === 'timing') {
  // ⑬ 単体(旧・瞬間比較。参考): node runner.js timing S1 [hours]
  const s = STRATEGIES.find(x => x.id === arg) || STRATEGIES[0];
  printTiming(s.id, runTimingChecks(s, hours));
} else if (mode === 'timing2') {
  // ⑬ 単体(提案5・全体比較): node runner.js timing2 "" [hours]
  judgeWholeTiming(hours);
} else if (mode === 'timingw') {
  // ⑬ 単体(取得後全周回の通し比較v2): node runner.js timingw "" [hours]
  judgeWholeTimingV2(hours);
} else if (mode === 'timingwin') {
  // ⑬ 単体(窓限定枝分かれv3): node runner.js timingwin "" [hours] [windowSec]
  judgeWindowTiming(hours, Number(process.argv[5]) || 600);
} else if (mode === 'timingacq') {
  // ⑬ 単体(取得直後snap→短窓v4): node runner.js timingacq "" [hours] [windowSec]
  judgeAcqWindowTiming(hours, Number(process.argv[5]) || 900);
} else if (mode === 'checks') {
  // まとめ実行: node runner.js checks S1 [hours] → ⑧(全方針) / ⑫ / ⑬(指定方針)
  const sims = {};
  for (const s of STRATEGIES) {
    const t0 = Date.now();
    sims[s.id] = G.simulate(s, { hours, trackChoices: true });
    console.log(`sim ${s.id} ${s.name} done (${Date.now() - t0}ms)`);
  }
  console.log('');
  for (const s of STRATEGIES) printQuotaFailBefore(s.id, sims[s.id]);
  console.log('');
  printContext(sims);
  printPolicyContext(hours);
  console.log('');
  const s = STRATEGIES.find(x => x.id === arg) || STRATEGIES[0];
  printTiming(s.id, runTimingChecks(s, hours, sims[s.id]));
  console.log('');
  console.log('①②③⑨⑩は toggles で: node runner.js toggles S1 30 all');
} else if (mode === 'check19') {
  // ⑲改(2026-07-06 ユーザー承認・第9次): どのスキルも、辺のうち少なくとも1本は
  // 「コスト比10倍以内の相手」と結ばれていること(関連効果を結ぶ遠距離辺は距離自由)。
  // +丸め規則(有効数字3桁=5の倍数)の検証。
  const cap = G.P.skillCost.edgeCap || 10;
  const cost = id => G.skillCostOf(G.SKILL_BY_ID[id]);
  const adj = {};
  for (const n of G.SKILL_NODES) { adj[n.id] = adj[n.id] || []; for (const q of n.prereqs) { adj[n.id].push(q); (adj[q] = adj[q] || []).push(n.id); } }
  let bad = 0;
  for (const n of G.SKILL_NODES) {
    if (n.id !== 'core' || adj[n.id].length) {
      const near = adj[n.id].filter(o => { const r = cost(n.id) / cost(o); return r <= cap * 1.0001 && r >= 1 / (cap * 1.0001); });
      if (!near.length) { bad++; console.log(`NG ⑲改 ${n.id}(${fmtN(cost(n.id))}): 10倍以内の辺なし。隣接=${adj[n.id].map(o => o + '(' + fmtN(cost(o)) + ')').join(',')}`); }
    }
    const c = G.skillCostOf(n);
    if (c !== G.q5cost(c)) { bad++; console.log(`NG 丸め違反 ${n.id}=${c}`); }
  }
  console.log(`⑲改: 各ノード最低1本は比≤${cap}倍の辺+丸め規則 → ${bad === 0 ? '全ノード OK' : bad + '件NG'} (ライダー: ${[...G.skillRiders()].join(',') || 'なし'})`);
} else if (mode === 'check27') {
  // ㉗(第9次【仮】): 関連接続率 — 全ツリー辺のうち「同系統 / 相乗り橋 / 解放対象カテゴリ一致 /
  // 入口の鎖 / 便利系の葉 / 設備解放の鎖 / 終端集約」で説明できる辺が95%以上。辺ごとに分類を出力。
  const CAT = {}; G.REWARD_POOL.forEach(r => CAT[r.id] = r.category);
  const laneOf = id => {
    if (id === 'core') return 'core';
    if (id.startsWith('click_')) return 'click';
    if (id.startsWith('golden_')) return 'golden';
    if (id.startsWith('monster_') || id === 'hunt_analysis') return 'monster';
    if (id.startsWith('auto_') || id === 'bake_temperature') return 'auto';
    if (id.startsWith('economy_') || id === 'order_board' || id.startsWith('research_')) return 'economy';
    if (id.startsWith('upgrade_')) return 'unlock';
    if (id.startsWith('unlock_reward_')) { const c = CAT[id.slice(14)]; return c === 'golden' ? 'golden' : c === 'equipment' ? 'reward' : 'monster'; } // hunt/risk=狩り系
    if (id.startsWith('reward_')) return 'reward';
    if (id.startsWith('start_') || id === 'offline_1') return 'util';
    return 'master';
  };
  // 第12次R4(ユーザー指示 2026-07-11): 分岐炉心(core=周回方針の解放)から各方針の入口スキルへ直接分岐
  // (会心タップ=click_1 / 金色=golden_1 / 狩猟=monster_1 / 焼成=auto_1)。旧・物語順の一本鎖は廃止。
  const ENTRANCE = new Set(['core>click_1', 'core>golden_1', 'core>monster_1', 'core>auto_1', 'auto_1>economy_1',
    // 第2輪は物語順の鎖(金→狩り→自動)
    'golden_2>monster_2', 'monster_2>auto_2']);
  const BRIDGES = { // 相乗り橋(両系統の効果や仕組み上の依存を持つ辺)
    'golden_2>click_3': 'click_3は金獲得効果を併せ持つ',
    'monster_2>auto_3': 'auto_3は討伐ダメージ効果を併せ持つ',
    'click_4>monster_4': '討伐ダメージはタップ力から計算される',
    'auto_4>click_4': 'クリック力は毎秒生産から計算される(指先連動)',
    'auto_4>upgrade_galaxy': '銀河工場=自動化の合流',
    'research_remodel>upgrade_time': '設備解放は経済・研究系の鎖(R4)',
    'unlock_reward_crackedFang>unlock_reward_goldenChain': '黄金連鎖は金→討伐ダメージの相乗り札',
    'unlock_reward_huntingCore>unlock_reward_crushedMill': '素材加工×狩りの合流'
  };
  let total = 0, okE = 0;
  for (const n of G.SKILL_NODES) {
    for (const q of n.prereqs) {
      total++;
      const key = q + '>' + n.id;
      const lp = laneOf(q), lc = laneOf(n.id);
      let label = null;
      if (ENTRANCE.has(key)) label = '入口の鎖';
      else if (G.isUtilitySkill(n.id)) label = '便利系の葉(R5)';
      else if (BRIDGES[key]) label = '相乗り橋: ' + BRIDGES[key];
      else if (lp === lc) label = '同系統(' + lc + ')';
      else if (lc === 'unlock' && (lp === 'economy' || lp === 'unlock')) label = '設備解放の鎖(経済系)';
      else if (lc === 'golden' && lp === 'golden') label = '同系統(金)';
      else if (lc === 'monster' && lp === 'monster') label = '同系統(狩り)';
      else if (lc === 'reward' && lp === 'unlock') label = 'カテゴリ一致(設備強化←設備解放枝)';
      else if (lc === 'monster' && lp === 'reward') label = 'カテゴリ一致(狩り報酬←強化系)';
      else if ((lc === 'golden' || lc === 'monster' || lc === 'reward') && lp === lc) label = 'カテゴリ一致';
      else if (lc === 'master') label = '終端(全系統の集約)';
      if (label) okE++;
      console.log(`${label ? 'OK' : 'NG'}  ${key.padEnd(52)} ${label || '未分類(' + lp + '→' + lc + ')'}`);
    }
  }
  console.log(`㉗: 関連で説明できる辺 ${okE}/${total} = ${(okE / total * 100).toFixed(1)}% (必要95%)`);
} else if (mode === 'crit23') {
  // ㉓(第9次【仮】): 会心1%開始。㉓-1 式の開始値=1%(内部値) / ㉓-2 転生時点で5%以上の周回が80%以上 /
  // ㉓-3 100時間中に50%超の局面が少なくとも1方針にあり、100%には到達しない
  console.log(`㉓-1 式の開始値: score開始 ${G.P.res.fingerBase} → 会心率 ${((1 - Math.exp(-G.P.res.fingerBase)) * 100).toFixed(3)}% ${Math.abs(1 - Math.exp(-G.P.res.fingerBase) - 0.01) < 0.0005 ? 'OK(=1.0%)' : 'NG'}`);
  let over50 = 0, reach100 = 0;
  for (const s of STRATEGIES) {
    if (arg && s.id !== arg) continue;
    const sim = G.simulate(s, { hours });
    const runs = sim.runs.filter(r => !r.partial && r.critAtBuy != null);
    const ge5 = runs.filter(r => (r.critEnd || 0) >= 0.05).length;
    const mx = Math.max(0, ...sim.runs.map(r => r.critMax || 0));
    if (mx >= 0.5) over50++;
    if (mx >= 0.9999) reach100++;
    const buyMin = runs.length ? Math.min(...runs.map(r => r.critAtBuy)) : null;
    const buyMax = runs.length ? Math.max(...runs.map(r => r.critAtBuy)) : null;
    console.log(`${s.id}: 研究取得周回=${runs.length} 取得直後率=[${buyMin === null ? '-' : (buyMin * 100).toFixed(1)}%..${buyMax === null ? '-' : (buyMax * 100).toFixed(1)}%] ㉓-2 転生時5%以上=${ge5}/${runs.length}(${runs.length ? Math.round(ge5 / runs.length * 100) : 0}%) 周回内最大=${(mx * 100).toFixed(1)}%`);
  }
  console.log(`㉓-3: 50%超の方針=${over50}(≥1で OK) / 100%到達=${reach100}(0で OK)`);
} else if (mode === 'ws') {
  // ⑮の2(工房の制作項目の有効性)+㉙(注文ボードの有効性)。第12次P・本シム統合後の判定。
  // 測り方=③⑨⑬と同じ「短い枝分かれ比べ」: その項目を使った周回の開始スナップから
  // 項目だけ無効(disableWs)で1周回ぶん枝分かれ、総クッキー比の中央値。
  // ⑮の2: 料理7種+装備6種・中央値≥1.05(どの方針も一度も作らない項目=不合格)。
  // ㉙: 注文報酬3種(クッキー/素材セット/短時間全生産)・稼ぎ比≥1.2。
  const H = hours;
  const optSnap = {};
  for (const s of STRATEGIES) optSnap[s.id] = G.simulate(s, { hours: H, snapshots: true });
  const judge = (key, label, usedIn, thr) => {
    let best = 0, bestPol = null, bestN = 0, anyUsed = false;
    const users = STRATEGIES.map(s => {
      const sim = optSnap[s.id];
      const acq = sim.runs.filter(r => !r.partial && usedIn(r) && r.runCookies > 0 && r.duration > 0 && sim.snapshots[r.idx]);
      return { s, sim, acq };
    }).filter(x => x.acq.length > 0);
    users.sort((a, b) => b.acq.length - a.acq.length);
    for (const { s, sim, acq } of users) {
      anyUsed = true;
      const ratios = [];
      for (const optRun of sampleRuns(acq, 10)) {
        const snap = sim.snapshots[optRun.idx];
        const off = G.replayRun(s, snap, { hours: H, disableWs: key }, optRun.duration);
        if (off && off.runCookies > 0 && Number.isFinite(off.runCookies) && Number.isFinite(optRun.runCookies)) {
          ratios.push(Math.min(1e9, optRun.runCookies / off.runCookies));
        }
      }
      const m = ratios.length ? medianOf(ratios) : null;
      if (m != null && m > best) { best = m; bestPol = s.id; bestN = ratios.length; }
      if (best >= thr) break;
    }
    const pass = best >= thr;
    console.log(`  ${pass ? 'OK' : 'NG'} ${label.padEnd(24)} ${anyUsed ? `${bestPol} 中央値比=${best.toFixed(3)} (n=${bestN})` : 'どの方針も未使用'}`);
    return pass ? 1 : 0;
  };
  console.log('⑮の2 工房の制作項目(枝分かれ比べ・中央値≥1.05)');
  let ok15 = 0;
  // 旧装備(Lv式7種)は廃止(2026-07-13)=⑮の2は料理7種のみ
  for (const rc of G.P.ws.recipes) ok15 += judge('dish:' + rc.id, '料理:' + rc.id, r => (r.wsDishes || []).includes(rc.id), 1.05);
  console.log(`⑮の2 合計 ${ok15}/${G.P.ws.recipes.length}(料理のみ・旧装備は廃止)`);
  console.log('㉙ 注文ボードの報酬(枝分かれ比べ・稼ぎ比≥1.2)');
  let ok29 = 0;
  for (const rk of ['cookie', 'materials', 'boost']) ok29 += judge('order:' + rk, '注文報酬:' + rk, r => ((r.wsOrders || {})[rk] || 0) > 0, 1.2);
  console.log(`㉙ 合計 ${ok29}/3`);
  // ==== 新装備システムの3条件(2026-07-13 ユーザー新設) ====
  // (a) 装備lift: 各装備につき「作って装備した周回」の総クッキーが「付け替えなかった場合」(noNewEquip枝分かれ)の1.5倍以上。
  //     取った周回の全て(サンプル上限10)で判定=③と同格の全周回基準。
  // (b) カバレッジ: 全装備がどの方針かで少なくとも1回は装備される。
  // (c) 作成テンポ: 毎周回、全8カテゴリの装備が1個以上作成される。
  {
    const items = G.EQUIP2_ITEMS ? G.EQUIP2_ITEMS() : (G.equip2Items ? G.equip2Items() : []);
    const equippedEver = new Set();
    let liftOk = 0, liftAll = 0;
    const liftRows = [];
    for (const it of items) {
      // 装備は周回を跨いで永続する(ワークショップ状態は転生で消えない)=取得後の全周回で比べる
      // (2026-07-16 ユーザー指示)。旧・worst(=最悪1周回のmin比)は1回の外れ周回で全体NGにする過剰に厳しい
      // 基準だった。装備した全周回の比を集めて中央値で判定=永続効果の典型的なliftを測る。
      const ratios = []; let usedPol = null;
      for (const st of STRATEGIES) {
        const sim = optSnap[st.id];
        const acq = sim.runs.filter(r => !r.partial && (r.eq2NewEquipped || []).includes(it.id) && r.runCookies > 0 && sim.snapshots[r.idx]);
        for (const r of acq) equippedEver.add(it.id);
        for (const optRun of sampleRuns(acq, 4)) {
          const snap = sim.snapshots[optRun.idx];
          const off = G.replayRun(st, snap, { hours: H, noNewEquip: true }, optRun.duration);
          if (off && off.runCookies > 0 && Number.isFinite(off.runCookies) && Number.isFinite(optRun.runCookies)) {
            ratios.push(optRun.runCookies / off.runCookies);
            usedPol = st.id;
          }
        }
      }
      if (ratios.length > 0) {
        liftAll++;
        const med = medianOf(ratios);
        const pass = med >= 1.5;
        if (pass) liftOk++;
        liftRows.push(`  ${pass ? 'OK' : 'NG'} 装備lift:${it.id.padEnd(20)} 中央値比=${med.toFixed(3)} (n=${ratios.length}, ${usedPol})`);
      }
    }
    console.log('新装備(a) 装備lift(取得後全周回の中央値比≥1.5・装備は周回跨ぎで永続)');
    liftRows.forEach(x => console.log(x));
    console.log(`新装備(a) 合計 ${liftOk}/${liftAll}(装備された装備のみ判定対象)`);
    // (b) カバレッジ
    const notEquipped = items.filter(it => !equippedEver.has(it.id)).map(it => it.id);
    console.log(`新装備(b) カバレッジ: ${items.length - notEquipped.length}/${items.length} 装備済み${notEquipped.length ? ' 未装備: ' + notEquipped.join(',') : ''}`);
    // (c) 毎周回全カテゴリ作成 = 廃止(2026-07-15 ユーザー指示「装備毎週回全種条件は廃止」)。
    // カバレッジ(b)は計測窓(1000h)内で達成できていればよい(同ユーザー指示「その時間内で達成できてればいい」)。
  }
} else if (mode === 'unlockgap') {
  // ㉚ 解放間隔(2026-07-19 ユーザー新設条件): 新要素の解放イベント同士の間隔が30秒以上のものが9割以上。
  // 解放ラッシュ(通知の機関銃)を禁止し、1つずつ味わえるペーシングを合格条件化。
  console.log('㉚ 解放間隔: 連続する解放イベントの間隔≥30秒が90%以上(全解放イベント・100h)');
  let okAll = 0, cnt = 0;
  for (const s of STRATEGIES) {
    const sim = G.simulate(s, { hours });
    const ev = (sim.unlockEvents || []).slice().sort((a, b) => a.t - b.t);
    const gaps = [];
    for (let i = 1; i < ev.length; i++) gaps.push(ev[i].t - ev[i - 1].t);
    const ok = gaps.filter(g => g >= 30).length;
    const ratio = gaps.length ? ok / gaps.length : 1;
    const pass = ratio >= 0.9;
    if (pass) okAll++;
    cnt++;
    console.log(`  ${pass ? 'OK' : 'NG'} ${s.id} 解放${ev.length}件 間隔${gaps.length}本 ≥30s: ${ok}/${gaps.length} (${(ratio * 100).toFixed(1)}%)`);
  }
  console.log(`㉚ 合計 ${okAll}/${cnt}方針`);
} else if (mode === 'eqswap') {
  // 装備(b)新定義(R19 2026-07-18 ユーザー指示「プレイ方針ごとに得意装備割り振って、周回ごとのシミュレーションを
  // 何回かやり直して同じティアの別装備でやり直して、全部50%以上行けばいい。素材は取得後全周回で中央値50%以上」):
  // 各装備を最高選好スコアの方針へ割り振り(=得意装備)、担当方針の周回スナップショットから
  // 「そのスロットの装着品が同ティア」の周回を選び、担当装備へ差し替えた凍結A/Bリプレイで比較。
  // 差し替え周回/元周回 ≥ 0.5 で合格(通常装備=対象周回のうち最大3本すべて / 素材系=全対象周回の中央値)。
  const H = hours;
  const items = G.equip2Items();
  const byId = {}; for (const it of items) byId[it.id] = it;
  const assign = {};
  for (const it of items) {
    let best = -Infinity, bs = null;
    for (const s of STRATEGIES) { const sc = G.eq2ScoreOf(s, it); if (sc > best) { best = sc; bs = s; } }
    assign[it.id] = bs;
  }
  const MATCH = new Set(['dropMul', 'dropRateAdd', 'dropLuck', 'oreAdd']);
  const FX = G.EQUIP2_FX_TABLE();
  const isMat = it => { const def = FX[it.cat][it.variant - 1]; const u = def.up || []; if (!u.length) return false; for (let i = 0; i < u.length; i += 2) if (!MATCH.has(u[i])) return false; return true; };
  const sims = {};
  for (const s of STRATEGIES) sims[s.id] = G.simulate(s, { hours: H, snapshots: true });
  const baseCache = {};
  const frozenBase = (s, sim, r) => {
    const key = s.id + ':' + r.idx;
    if (!(key in baseCache)) {
      const off = G.replayRun(s, sim.snapshots[r.idx], { hours: H, noNewEquip: true }, r.duration);
      baseCache[key] = (off && off.runCookies > 0 && Number.isFinite(off.runCookies)) ? off.runCookies : null;
    }
    return baseCache[key];
  };
  // 基準色銘: 各(カテゴリ,ティア)につき担当方針が最も好む色銘(=「前に着けていたはずの得意装備」の代役)。
  // 同ティアの現物を着ている周回が無い(ティア飛ばし等)場合は、基準色銘を強制装着した凍結周回を
  // ベースラインにし、対象色銘の強制装着と純A/B比較する=全486が判定可能。
  const refCache = {};
  const refOf = (s, cat, tier) => {
    const key = s.id + ':' + cat + ':' + tier;
    if (!(key in refCache)) {
      let best = -Infinity, bid = null;
      for (const x of items) if (x.cat === cat && x.tier === tier) { const sc = G.eq2ScoreOf(s, x); if (sc > best) { best = sc; bid = x.id; } }
      refCache[key] = bid;
    }
    return refCache[key];
  };
  const forcedBaseCache = {};
  const forcedBase = (s, sim, r, cat, refId) => {
    const key = s.id + ':' + r.idx + ':' + cat + ':' + refId;
    if (!(key in forcedBaseCache)) {
      const off = G.replayRun(s, sim.snapshots[r.idx], { hours: H, noNewEquip: true, forceEquip: { [cat]: refId } }, r.duration);
      forcedBaseCache[key] = (off && off.runCookies > 0 && Number.isFinite(off.runCookies)) ? off.runCookies : null;
    }
    return forcedBaseCache[key];
  };
  let ok = 0, ng = 0, na = 0; const ngRows = [];
  for (const it of items) {
    const s = assign[it.id]; const sim = sims[s.id];
    const fulls = sim.runs.filter(r => !r.partial && r.duration > 0 && sim.snapshots[r.idx]);
    const tierOfRun = r => { const cid = sim.snapshots[r.idx].ws && sim.snapshots[r.idx].ws.eq2Equipped && sim.snapshots[r.idx].ws.eq2Equipped[it.cat]; const c = cid && byId[cid]; return c ? c.tier : 0; };
    let elig = fulls.filter(r => tierOfRun(r) === it.tier);
    let forced = false;
    if (!elig.length) {
      // 最も近いティアを着ている周回で両側強制A/B(基準=担当方針の同ティア最推し色銘)
      forced = true;
      const sorted = fulls.slice().sort((a, b) => Math.abs(tierOfRun(a) - it.tier) - Math.abs(tierOfRun(b) - it.tier));
      elig = sorted;
    }
    if (!elig.length) { na++; ngRows.push(`  判定不能(適格周回なし) ${it.id} ${s.id}`); continue; }
    // 判定不能ゼロ化v2(2026-07-18 R29): 固定スライスだと先頭サンプルの再生が全て無効(引退尾部Infinity等)の
    // 場合に判定不能へ落ちる=有効ratioが目標数に達するまで適格周回を走査する。
    const want = isMat(it) ? 8 : 3;
    const refId = refOf(s, it.cat, it.tier);
    const ratios = [];
    for (const r of elig) {
      if (ratios.length >= want) break;
      const base = forced ? forcedBase(s, sim, r, it.cat, refId) : frozenBase(s, sim, r);
      if (!base) continue;
      const on = G.replayRun(s, sim.snapshots[r.idx], { hours: H, noNewEquip: true, forceEquip: { [it.cat]: it.id } }, r.duration);
      if (on && on.runCookies > 0 && Number.isFinite(on.runCookies)) ratios.push(on.runCookies / base);
    }
    // 第二フォールバック(2026-07-18 R29c): 同ティア現物周回が全て無効(引退尾部Infinity等)なら
    // 最寄りティア周回への両側強制A/Bで測り直す(初回フォールバックと同処方)。
    if (!ratios.length && !forced) {
      const sorted = fulls.slice().sort((a, b) => Math.abs(tierOfRun(a) - it.tier) - Math.abs(tierOfRun(b) - it.tier));
      for (const r of sorted) {
        if (ratios.length >= want) break;
        const base = forcedBase(s, sim, r, it.cat, refId);
        if (!base) continue;
        const on = G.replayRun(s, sim.snapshots[r.idx], { hours: H, noNewEquip: true, forceEquip: { [it.cat]: it.id } }, r.duration);
        if (on && on.runCookies > 0 && Number.isFinite(on.runCookies)) ratios.push(on.runCookies / base);
      }
    }
    if (!ratios.length) { na++; ngRows.push(`  判定不能(有効ratioなし) ${it.id} ${s.id} elig=${elig.length}`); continue; }
    const pass = isMat(it) ? (medianOf(ratios) >= 0.5) : ratios.every(x => x >= 0.5);
    if (pass) ok++;
    else { ng++; ngRows.push(`  NG ${it.id.padEnd(20)} ${s.id.padEnd(4)}${forced ? ' 強制A/B' : ''} ratios=[${ratios.map(x => x.toFixed(2)).join(',')}]${isMat(it) ? ' 素材系=中央値' : ''}`); }
  }
  console.log(`装備(b)新定義: 同ティア差し替え≥50%(担当方針・凍結A/B・現物なしは基準色銘との両側強制) 合格 ${ok} / NG ${ng} / 判定不能 ${na} (全${items.length})`);
  ngRows.slice(0, 80).forEach(x => console.log(x));
} else if (mode === 'affinity') {
  // ㉔㉕㉖(第9次【仮】): モンスター種類×報酬相性
  // ㉔ 有効性: 「その回だけ相性を全部×1.0」との獲得効率比(幾何平均≥1.1)+各回minも表示
  // ㉕ 文脈依存性: カテゴリ別の最効率種類が2種以上 / 方針の討伐配分(報酬寄与の1位種類)が2種以上
  // ㉖ 一強禁止: 各周回で種類ごとの「討伐1体あたり報酬量」が平均±1.5倍以内(ボスは周期出現のため対象外)
  const aff = G.P.mtype.affinity;
  const cats = ['golden', 'hunt', 'equipment', 'risk'];
  const bestByCat = {};
  for (const c of cats) {
    let best = null, bv = -1;
    for (const t of Object.keys(aff)) { if (t === 'boss') continue; if (aff[t][c] > bv) { bv = aff[t][c]; best = t; } }
    bestByCat[c] = best;
  }
  console.log('㉕(機械判定) カテゴリ別最効率種類: ' + cats.map(c => c + '=' + bestByCat[c]).join(' ') + ` → ${new Set(Object.values(bestByCat)).size}種 (≥2で OK)`);
  // ㉖案②-b(2026-07-09 ユーザー承認): 種類ごとの「全カテゴリ合計の旨味」が±1.5倍以内(得意ピークの位置は自由=㉕多様性を保つ)。
  // 相性表の設計で判定(静的・⑯⑳と同じ扱い)。ボスは周期出現のため対象外。
  {
    const sums = {};
    for (const t of Object.keys(aff)) { if (t === 'boss') continue; sums[t] = cats.reduce((a, c) => a + (aff[t][c] || 0), 0); }
    const sv = Object.values(sums), sm = sv.reduce((a, b) => a + b, 0) / sv.length;
    const ok26b = sv.every(v => v >= sm / 1.5 && v <= sm * 1.5);
    console.log(`㉖(案②-b 種類別の全カテゴリ合計旨味 ±1.5倍以内): ${Object.entries(sums).map(([k, v]) => k + '=' + v.toFixed(1)).join(' ')} → ${ok26b ? 'OK' : 'NG'}`);
  }
  const domByStrat = {};
  let ok26 = 0, all26 = 0;
  for (const s of STRATEGIES) {
    if (arg && s.id !== arg) continue;
    const sim = G.simulate(s, { hours, snapshots: true });
    // ㉖
    for (const r of sim.runs.filter(x => !x.partial)) {
      const vals = [];
      for (const t of Object.keys(r.killsByType || {})) {
        if (t === 'boss') continue;
        if ((r.killsByType[t] || 0) > 0) vals.push((r.rewardByType[t] || 0) / r.killsByType[t]);
      }
      if (vals.length < 2) continue;
      all26++;
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      if (vals.every(v => v >= mean / 1.5 && v <= mean * 1.5)) ok26++;
    }
    // ㉕ 実測: 報酬寄与の1位種類(標準以外)
    const agg = {};
    for (const r of sim.runs) for (const [t, v] of Object.entries(r.rewardByType || {})) { if (t !== 'normal') agg[t] = (agg[t] || 0) + v; }
    domByStrat[s.id] = Object.entries(agg).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '-';
    // ㉔
    const row = toggleRow(s, sim, 'affinity', 'affinity', 1.1);
    if (row.used) {
      const ratios = row.logs.map(v => Math.exp(v));
      const med = medianRatio(row.logs);
      console.log(`${s.id}: ㉔ 相性有効/無効比 中央値=${med.toFixed(3)} (幾何平均=${row.ratio.toFixed(3)}) [min ${Math.min(...ratios).toFixed(2)} .. max ${Math.max(...ratios).toFixed(2)}] x${row.runs}周回 ${med >= 1.1 ? 'OK' : 'NG(<1.1)'} / 報酬寄与1位(標準以外)=${domByStrat[s.id]}`);
    } else {
      console.log(`${s.id}: ㉔ 未使用(討伐なし) NG`);
    }
  }
  console.log(`㉕(実測) 方針の報酬寄与1位種類: ${Object.entries(domByStrat).map(([k, v]) => k + '=' + v).join(' ')} → ${new Set(Object.values(domByStrat)).size}種 (≥2で OK)`);
  console.log(`㉖: 種類別の1体あたり報酬量 ±1.5倍以内 ${ok26}/${all26}周回`);
} else if (mode === 'expect') {
  // ①②③⑨⑬⑫ 各回の期待値方式(第12次): node runner.js expect "" [hours]
  // 各機能につき「少なくとも1方針が取得し、その方針の“取得した全周回”で稼ぎ力の持ち上げ≥閾値」を要求。
  const H = hours;
  const sims = {};
  for (const s of STRATEGIES) sims[s.id] = G.simulate(s, { hours: H, measure: true });
  // 機能→{ policyId → [各周回のlift] }
  function collect(prefix) {
    const map = {};
    for (const s of STRATEGIES) {
      const full = sims[s.id].runs.filter(r => !r.partial && r.measure);
      for (const r of full) {
        for (const [k, v] of Object.entries(r.measure.lift)) {
          if (!k.startsWith(prefix)) continue;
          (map[k] = map[k] || {}); (map[k][s.id] = map[k][s.id] || []).push(v);
        }
      }
    }
    return map;
  }
  // median(配列の中央値。偶数個は中間2つの平均)
  function medOf(arr) { const a = arr.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  // useMed=true のとき「その方針の全周回の中央値≥need」で判定(③のみ・2026-07-08 ユーザー承認。工房⑮の2と同じ=貯める/使わない回を許容)。
  // useMed=false は従来「全周回の最小値≥need(=全周回)」(①⑨は据え置き)。
  function judge(map, need, label, ids, useMed) {
    let ok = 0; const rows = [];
    const allKeys = ids || Object.keys(map);
    for (const k of allKeys) {
      const byPol = map[k] || {};
      let passPol = null, bestStat = 0, bestGm = 0;
      for (const [pol, arr] of Object.entries(byPol)) {
        const stat = useMed ? medOf(arr) : Math.min(...arr);
        const gm = Math.exp(arr.reduce((a, b) => a + Math.log(b), 0) / arr.length);
        if (stat >= need && (passPol === null || stat > bestStat)) { passPol = pol; bestStat = stat; bestGm = gm; }
        if (passPol === null && gm > bestGm) { bestGm = gm; }
      }
      const pass = passPol !== null;
      if (pass) ok++;
      const picked = Object.keys(byPol).length > 0;
      const stName = useMed ? '中央値' : 'min';
      rows.push(`  ${pass ? 'OK' : 'NG'} ${k.padEnd(28)} ${pass ? `${passPol} ${stName}=${bestStat.toFixed(2)}` : (picked ? `取得あり・${useMed ? '中央値' : '全周回'}≥${need}に未達(最大幾何平均${bestGm.toFixed(2)})` : 'どの方針も未取得')}`);
    }
    console.log(`${label} ${ok}/${allKeys.length}`);
    rows.forEach(r => console.log(r));
    return ok;
  }
  console.log(`=== 期待値方式(${H}h・各回の稼ぎ力の持ち上げ) ===`);
  {
    // cpsStrike(生産火力転換)は瞬間軸で1.00に張り付く(効果=討伐可能の維持という間接経路)ため、
    // ⑬と同じ包括承認(「総クッキーへの影響が測れてない場合は測れる条件に変えてよい」)に基づき
    // 枝分かれ軸(1周回・disableResearch)で判定する【仮=中央値≥1.2】(2026-07-14)
    const RES_WHOLE = new Set(['cpsStrike']);
    const instantIds = G.RESEARCH.filter(r => !RES_WHOLE.has(r.id)).map(r => 'res:' + r.id);
    const okInstant = judge(collect('res:'), 1.2, `① 研究instant(各回≥1.2・${instantIds.length}本)`, instantIds);
    let okWhole = 0;
    {
      const optSnap = {};
      for (const s2 of STRATEGIES) optSnap[s2.id] = G.simulate(s2, { hours: H, snapshots: true });
      for (const rid of RES_WHOLE) {
        let best = 0, bestPol = null, bestN = 0, anyUsed = false;
        for (const s2 of STRATEGIES) {
          const sim2 = optSnap[s2.id];
          const acq = sim2.runs.filter(r => !r.partial && (r.researchBought || []).includes(rid) && r.runCookies > 0 && sim2.snapshots[r.idx]);
          if (!acq.length) continue;
          anyUsed = true;
          const ratios = [];
          for (const optRun of sampleRuns(acq, 10)) {
            const off = G.replayRun(s2, sim2.snapshots[optRun.idx], { hours: H, disableResearch: rid }, optRun.duration);
            if (off && off.runCookies > 0 && Number.isFinite(off.runCookies) && Number.isFinite(optRun.runCookies)) ratios.push(Math.min(1e9, optRun.runCookies / off.runCookies));
          }
          const m = ratios.length ? medianOf(ratios) : null;
          if (m != null && m > best) { best = m; bestPol = s2.id; bestN = ratios.length; }
          if (best >= 1.2) break;
        }
        const pass = best >= 1.2;
        if (pass) okWhole++;
        console.log(`  ${pass ? 'OK' : 'NG'} res:${rid}(whole軸) ${anyUsed ? `${bestPol} 中央値比=${best.toFixed(3)} (n=${bestN})` : 'どの方針も未取得'}`);
      }
    }
    console.log(`① 研究 合計 ${okInstant + okWhole}/${G.RESEARCH.length} (instant ${okInstant}/${instantIds.length} + whole ${okWhole}/${RES_WHOLE.size})`);
  }
  {
    const UTIL = new Set(UTILITY_REWARDS);
    const directIds = G.REWARD_POOL.filter(r => !UTIL.has(r.id)).map(r => 'rw:' + r.id);
    const okDirect = judge(collect('rw:'), 1.1, '③-a 報酬instant(全周回≥1.1・2026-07-13ユーザー変更)', directIds, false);
    // ③カバレッジ強化(2026-07-13「どれかのプレイ方針は毎回とる」): 各報酬について、
    // 「初取得以降の全周回で毎回取る」方針が少なくとも1つ実在すること
    {
      const okCov = [];
      for (const key of directIds.concat(UTILITY_REWARDS.map(id => 'rw:' + id))) {
        const rid = key.replace(/^rw:/, '');
        let pass = null;
        for (const st of STRATEGIES) {
          const full = sims[st.id].runs.filter(r => !r.partial);
          let firstIdx = -1;
          for (let i = 0; i < full.length; i++) if ((full[i].perks || {})[rid] > 0) { firstIdx = i; break; }
          if (firstIdx < 0) continue;
          let every = true;
          for (let i = firstIdx; i < full.length; i++) if (!((full[i].perks || {})[rid] > 0)) { every = false; break; }
          if (every) { pass = st.id; break; }
        }
        okCov.push({ rid, pass });
      }
      const ng = okCov.filter(x => !x.pass);
      console.log(`③-c 毎回取る方針の実在 ${okCov.length - ng.length}/${okCov.length}${ng.length ? ' NG: ' + ng.map(x => x.rid).join(',') : ''}`);
    }
    const okUtil = judgeUtilityRewards(H, sims, UTILITY_REWARDS);
    console.log(`③ 報酬 合計 ${okDirect + okUtil}/${G.REWARD_POOL.length} (instant ${okDirect}/${directIds.length} + utility ${okUtil}/${UTILITY_REWARDS.length})`);
  }
  {
    const stageMap = collect('stage:');
    const wholeSet = new Set(STAGE_WHOLE);
    // instant判定: ⑬タイミング段は除外、利息/余熱(whole軸)も除外。残りを瞬間比較lift≥1.05。
    const instantIds = Object.keys(stageMap).filter(k => !STAGE_TIMING_EXCLUDE.has(k) && !wholeSet.has(k));
    const okInstant = judge(stageMap, 1.05, '⑨-a 段階instant(各回≥1.05・⑬タイミング段は除外)', instantIds);
    // whole軸: 利息/余熱を通し比較で判定(取得された段のみ対象)
    const wholeKeys = STAGE_WHOLE.filter(k => STRATEGIES.some(s => stageFirstAcqIdx(sims[s.id], k) !== null));
    const okWhole = judgeStageWhole(H, sims, wholeKeys);
    console.log(`⑨ 段階 合計 ${okInstant + okWhole}/${instantIds.length + wholeKeys.length} (instant ${okInstant}/${instantIds.length} + whole ${okWhole}/${wholeKeys.length}・⑬タイミング段${[...STAGE_TIMING_EXCLUDE].filter(k => stageMap[k]).length}件は⑬で判定のため除外)`);
  }
  // ⑬ タイミング(2026-07-16 正式測定を取得直後snap→短窓v4へ): 旧・単一周回の全体枝分かれ(judgeWholeTiming)は
  // 離散×再投資の機能(mature/portal)が方針依存で二極発散(1.0↔1e9)し測れなかった。機能取得の瞬間のsnapから
  // 最適/放置を同じ短窓だけ枝分かれ=機能が活性かつ有界=安定測定。sim側 opt.timingSnaps で取得直後snapを保存。
  judgeAcqWindowTiming(H, 900);
  // (参考)旧・全体枝分かれ: judgeWholeTiming(H, sims);
  // 参考: 討伐連鎖(第12次D採用)の期待値lift(合否条件ではない。③②⑫㉘の押し上げ係数の目安)
  {
    const byPol = (collect('chain'))['chain'] || {};
    const rows = Object.entries(byPol).map(([pol, arr]) => {
      const gm = Math.exp(arr.reduce((a, b) => a + Math.log(b), 0) / arr.length);
      return `${pol} 幾何平均${gm.toFixed(2)} [${Math.min(...arr).toFixed(2)}..${Math.max(...arr).toFixed(2)}]`;
    });
    console.log(`参考 討伐連鎖lift: ${rows.length ? rows.join(' / ') : '(討伐なし)'}`);
  }
  // (参考)旧②・研究lift分散: ②は2026-07-12に方針間判定(②改2)へ再定義済み=runner income が正式判定。
  // この方針ごとの研究lift分散は合否に使わない(研究間のliftは桁が違って当然=①が下限だけ守る)。
  {
    const rows = [];
    for (const s of STRATEGIES) {
      const full = sims[s.id].runs.filter(r => !r.partial && r.measure);
      const per = {};
      for (const rr of G.RESEARCH) {
        const vals = full.map(r => r.measure.lift['res:' + rr.id]).filter(v => v != null);
        if (vals.length) per[rr.id] = Math.exp(vals.reduce((a, b) => a + Math.log(b), 0) / vals.length);
      }
      const arr = Object.values(per);
      if (arr.length < 2) continue;
      const gm = Math.exp(arr.reduce((a, b) => a + Math.log(b), 0) / arr.length);
      rows.push(`${s.id} 研究lift[${Math.min(...arr).toFixed(2)}..${Math.max(...arr).toFixed(2)}] 平均${gm.toFixed(2)}`);
    }
    console.log(`参考 研究lift分散(旧②・合否対象外=②改2は income で判定): ${rows.join(' / ')}`);
  }
  // ⑫ 周回方針の文脈依存: 5方針それぞれが「1位になる周回」を持つ(全方針・全周回のargmax集合)
  {
    const seen = new Set();
    for (const s of STRATEGIES) for (const r of sims[s.id].runs) if (r.measure && r.measure.bestPol) seen.add(r.measure.bestPol);
    console.log(`⑫ 周回方針の1位が実在: ${[...seen].join(',')} (${seen.size}/5)`);
  }
} else if (mode === 'income') {
  // ㉘稼ぎ口比率(3-2): node runner.js income "" [hours]
  // 収入を4稼ぎ口(設備生産/金/討伐由来/タップ)に分解し、5つの周回方針の代表方針で判定:
  // (a) 主役の稼ぎ口シェア≥30%(バランス型は4つすべて≥10%) (b) どの稼ぎ口も90%を超えない。
  // 判定対象=その方針の主役強化の研究が1つ以上解放済みの周回(researchBoughtで判定)。
  const H = hours;
  // 周回方針→主役の稼ぎ口
  const ROLE_CHANNEL = { bake: 'equip', golden: 'golden', hunt: 'hunt', click: 'tap', balanced: null };
  // 主役強化の研究(ゲート判定用。割り当ての細部は【仮】)
  const ROLE_RESEARCH = {
    bake: ['ovenBatch', 'factoryNetwork', 'grandmaCrowd', 'moonGlobalYeast', 'galaxyAssembly', 'blackHoleCompression', 'quantumProofing', 'antimatterRecipe'],
    golden: ['spiceBlend'],
    hunt: ['portalNetwork', 'portalGlobalFold'],
    click: ['fingerTechnique', 'bankClickDividend'],
    balanced: null // いずれかの主役研究1つ以上
  };
  const ALL_ROLE_RES = [...new Set(Object.values(ROLE_RESEARCH).filter(Boolean).flat())];
  // 各周回方針の代表: その方針を常用する最初の戦略(S1=焼成, S2=会心タップ, S3=金色, S4=狩猟, S6=バランス)
  const reps = {};
  for (const s of STRATEGIES) {
    let pol = null;
    try { pol = s.pickPolicy({ prestigeRuns: 1, runs: [], t: 0, run: {} }); } catch (e) { /* 状態依存の方針はスキップ */ }
    if (pol && !reps[pol]) reps[pol] = s;
  }
  const CH_NAME = { equip: '設備生産', golden: '金クッキー', hunt: '討伐由来', tap: 'タップ' };
  console.log(`=== ㉘稼ぎ口比率(${H}h・周回シェア=各tickシェアの周回平均) ===`);
  let okAll = 0, allAll = 0;
  const polSpecLifts = {}; // ②改(方針間比較): 方針→得意分野liftの列
  for (const pol of ['balanced', 'click', 'golden', 'hunt', 'bake']) {
    const s = reps[pol];
    if (!s) { console.log(`${pol}: 代表方針なし NG`); continue; }
    const sim = G.simulate(s, { hours: H, measure: true });
    const full = sim.runs.filter(r => !r.partial && r.measure && r.measure.income);
    let ok = 0, all = 0, c2ok = 0, c2all = 0;
    const rows = [];
    for (const r of full) {
      const gateList = ROLE_RESEARCH[pol] || ALL_ROLE_RES;
      const gated = (r.researchBought || []).some(id => gateList.includes(id));
      const inc = r.measure.income;
      const shares = { equip: inc.equip, golden: inc.golden, hunt: inc.hunt, tap: inc.tap };
      const maxShare = Math.max(...Object.values(shares));
      // 主役シェア閾値 30%→25%(2026-07-11 ユーザー決定・相談1のA案)
      const aPass = pol === 'balanced'
        ? Object.values(shares).every(v => v >= 0.10)
        : shares[ROLE_CHANNEL[pol]] >= 0.25;
      // (b)独占禁止(どの稼ぎ口も≤90%)は2026-07-08 ユーザー決定で全方針撤廃。㉘は(a)主役シェア≥30%のみで判定。
      const bPass = true;
      const pass = aPass && bPass;
      if (gated) { all++; if (pass) ok++; }
      // ②(改・ジャンル単位の一強禁止・2026-07-08 ユーザー承認): 収入をジャンル(設備/金/討伐/タップ)に束ねた
      // lift(=1/(1-share))を出し、その方針の得意ジャンルの lift が全ジャンル lift 幾何平均の±1.5倍以内。
      // 得意ジャンルが突出しすぎない(=他ジャンルも腐らない)を担保。個々の研究の±1.5(構造的に不可能)を置換。
      // ②改の再定義(2026-07-12 ユーザー指示「突出しないって、他の周回方針に比べて。それぞれの周回方針で
      // 討伐もしつつ、その周回方針の強みが他と足並み揃えばいい」): 周回内の4分野均衡は要求しない。
      // 各方針の「得意分野のlift」を集め、方針間で±1.5倍以内かを最後に判定する(集計はループ後)。
      if (gated && ROLE_CHANNEL[pol]) {
        const spec = 1 / Math.max(1e-6, 1 - Math.min(0.999, shares[ROLE_CHANNEL[pol]]));
        (polSpecLifts[pol] = polSpecLifts[pol] || []).push(spec);
      }
      rows.push(`  run${String(r.idx).padStart(2)} ${gated ? '対象' : '対象外'} 設備${(shares.equip * 100).toFixed(0)}% 金${(shares.golden * 100).toFixed(0)}% 討伐${(shares.hunt * 100).toFixed(0)}% タップ${(shares.tap * 100).toFixed(0)}%${gated ? ` → (a)${aPass ? 'OK' : 'NG'}` : ''}`);
    }
    okAll += ok; allAll += all;
    const role = ROLE_CHANNEL[pol] ? `主役=${CH_NAME[ROLE_CHANNEL[pol]]}≥25%` : '4つすべて≥10%';
    console.log(`${pol}(${s.id} ${s.name}) ${role}: ${ok}/${all}周回 合格`);
    rows.forEach(x => console.log(x));
    // ㉘'(R34・提案レンズ=「選択と能動で形が変わる」向け・暫定閾値/ユーザー決定待ち):
    // 「山だけ」を見る=型の署名稼ぎ口が支配的(非balanced=署名≥30% / balanced=最大<55%で突出しすぎない)。
    // **谷(死んだ稼ぎ口)は許す**=型の個性。旧㉘(全稼ぎ口≥10%=均一強制)や「死なない床」は、ビジョンが望む谷を
    // 罰するので採らない(2026-07-21 ㉘'データで床は誤設計と判明。100%独走だけは軽く弾く=max<0.95)。
    { const ch2 = ROLE_CHANNEL[pol];
      let okB = 0, allB = 0;
      for (const r of full) {
        const gateList2 = ROLE_RESEARCH[pol] || ALL_ROLE_RES;
        if (!(r.researchBought || []).some(id => gateList2.includes(id))) continue;
        const i = r.measure.income; const arr = [i.equip, i.golden, i.hunt, i.tap];
        const maxS = Math.max(...arr);
        const domOk = ch2 ? (i[ch2] >= 0.30 && maxS < 0.95) : (maxS < 0.55);
        allB++; if (domOk) okB++;
      }
      console.log(`  → ㉘'(署名支配・谷は許す・暫定): ${okB}/${allB}周回`);
    }
  }
  console.log(`㉘合計: ${okAll}/${allAll}周回`);
  // ②改(方針間・2026-07-12 ユーザー再定義): 各方針の得意分野lift(中央値)が方針間の幾何平均の±1.5倍以内
  {
    const meds = {};
    for (const [pol, arr] of Object.entries(polSpecLifts)) {
      const a = arr.slice().sort((x, y) => x - y);
      meds[pol] = a.length ? a[a.length >> 1] : null;
    }
    const vals = Object.values(meds).filter(v => v != null);
    if (vals.length >= 2) {
      const gm = Math.exp(vals.reduce((a, b) => a + Math.log(b), 0) / vals.length);
      let ok2 = true;
      const parts = Object.entries(meds).map(([pol, v]) => {
        const pass = v >= gm / 1.5 && v <= gm * 1.5;
        if (!pass) ok2 = false;
        return `${pol}=${v.toFixed(2)}${pass ? '' : '(帯外)'}`;
      });
      console.log(`②(改2・方針間: 得意分野liftの中央値が幾何平均${gm.toFixed(2)}の±1.5倍以内) ${parts.join(' ')} → ${ok2 ? 'OK' : 'NG'}`);
    }
  }
} else if (mode === 'shape') {
  // 「選択と能動で一周の形が変わる」の現状測定(R34・2026-07-21):
  //   ① 署名支配度 = 各型の署名稼ぎ口シェアの中央値(高いほど、その型がその稼ぎ口で"形"を作れている)。
  //      均一化(㉘=全稼ぎ口≥10%)が効いていると、どの型も署名シェアが低く横並び=形が無い。
  //   ② 能動優位 = 能動プレイ(タップ/金取り有)の総クッキー log10 − 放置プレイ(tapRate0/goldenTake0)の log10。
  //      桁差が大きいほど「積極的に遊ぶ意味がある」型。bakeは放置主役なので小さくてよい(=それも一つの形)。
  const H = hours;
  const ROLE_CHANNEL = { bake: 'equip', golden: 'golden', hunt: 'hunt', click: 'tap', balanced: null };
  const CH_NAME = { equip: '設備', golden: '金', hunt: '討伐', tap: 'タップ' };
  const reps = {};
  for (const s of STRATEGIES) {
    let pol = null;
    try { pol = s.pickPolicy({ prestigeRuns: 1, runs: [], t: 0, run: {} }); } catch (e) { /* skip */ }
    if (pol && !reps[pol]) reps[pol] = s;
  }
  const median = arr => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; };
  console.log(`=== 形の測定(${H}h): 署名支配度 / 能動優位(能動→放置の桁差) ===`);
  for (const pol of ['balanced', 'click', 'golden', 'hunt', 'bake']) {
    const s = reps[pol];
    if (!s) { console.log(`${pol}: 代表方針なし`); continue; }
    const A = G.simulate(s, { hours: H, measure: true });
    // 放置基準=「カジュアル」(入力ゼロだと立ち上がりで全滅し限界効用が測れないため、最低限の入力は残す):
    // タップ率を1に落とし、金取りを1/4に。署名ループを積極的に回すプレイ(A)との桁差=積極プレイの限界効用。
    const idle = Object.assign({}, s, { tapRate: Math.min(1, s.tapRate || 0), goldenTake: 0.25 });
    const I = G.simulate(idle, { hours: H, measure: true });
    const full = A.runs.filter(r => !r.partial && r.measure && r.measure.income);
    const ch = ROLE_CHANNEL[pol];
    let domStr;
    if (ch) {
      domStr = `署名=${CH_NAME[ch]}${(median(full.map(r => r.measure.income[ch])) * 100).toFixed(0)}%`;
    } else {
      const minShare = full.map(r => Math.min(r.measure.income.equip, r.measure.income.golden, r.measure.income.hunt, r.measure.income.tap));
      domStr = `最小稼ぎ口=${(median(minShare) * 100).toFixed(0)}%(=均衡度)`;
    }
    const la = Math.log10(Math.max(1, A.totalCookies)), li = Math.log10(Math.max(1, I.totalCookies));
    console.log(`${pol.padEnd(9)}(${s.id}) ${domStr.padEnd(16)} 能動優位=+${(la - li).toFixed(1)}桁 (能動e${la.toFixed(0)}/放置e${li.toFixed(0)}) 周回${A.runs.length}`);
  }
  console.log('※署名支配度が低く横並び=均されて形が無い / 能動優位が小=積極プレイの意味が薄い(bake以外)');
} else if (mode === 'skillsum') {
  let sum = 0;
  for (const n of G.SKILL_NODES) sum += G.skillCostOf(n);
  console.log('スキル総コスト:', sum, ' ノード数:', G.SKILL_NODES.length);
}

module.exports = { runBaseline, runToggles, summarize, yCurve, runTimingChecks };
