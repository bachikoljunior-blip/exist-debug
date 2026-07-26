#!/bin/bash
# 判断の丸投げ(ANTI_REGRESSION #2/#6)を機械で止める検問。markdownの受動メモでは防げなかったので仕組みにした。
#
# 使い方:
#   sim/tools/decision_guard.sh                      # リポジトリの生きた置き場を検査
#   sim/tools/decision_guard.sh --transcript PATH    # 直近のアシスタント発言も検査(Stopフック用)
#   sim/tools/decision_guard.sh --install-git-hook   # .git/hooks/pre-commit を設置(自己修復用)
#   echo '<hook json>' | sim/tools/decision_guard.sh --hook   # Stopフック(stdinのJSONからtranscriptを拾う)
#
# 終了コード: 0=合格 / 2=違反(フックはこれで手番へ差し戻す)
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 0
ROOT="$(pwd)"

# 「待つ/丸投げる」表現。ここに載っているものをリポジトリの生きた置き場に書いたら再発。
NG_REPO='要ユーザー判断|要ユーザー相談|ユーザー判断案件|判断を待つ|方針決定を待つ|勝手に選ばない|Go待ち|指示があれば'
# 同じ行に「もう決めた」証拠があれば合格(履歴の注記・禁止ルール本文・却下記録など)
OK_MARK='決定|決め|反省|預けすぎ|却下|採らない|実行中|実装済み|着手済み|再発|シグネチャ|禁止|注記|訂正|撤回|履歴|自分で回す|自分の担当'
# 生きた置き場(履歴ログ=HANDOFF等は当時の事実なので対象外)
# ANTI_REGRESSION.md は検問ルールそのもの(禁止語の定義が載る)ので対象外=自己言及で必ず落ちるのを回避
LIVE_FILES=(sim/BACKLOG.md sim/PERFECTION.md sim/FUN_audit_R35.md sim/SENSE_R35.md index.html)
LIVE_GLOBS=(sim/sim.js sim/runner.js sim/params.js sim/strategies.js)

viol=0
report() { echo "$1" >&2; viol=1; }

for f in "${LIVE_FILES[@]}" "${LIVE_GLOBS[@]}"; do
  [[ -f "$ROOT/$f" ]] || continue
  while IFS= read -r line; do
    n="${line%%:*}"; body="${line#*:}"
    # 禁止句そのものを取り除いた残りでマーカーを見る(「方針決定を待つ」の"決定"で自己免罪されるのを防ぐ)
    rest="$(sed -E "s/$NG_REPO//g" <<<"$body")"
    if ! grep -qE "$OK_MARK" <<<"$rest"; then
      report "  [$f:$n] 判断を置いたまま: $(cut -c1-90 <<<"$body")"
    fi
  done < <(grep -nE "$NG_REPO" "$ROOT/$f" 2>/dev/null)
done

# --- 直近のアシスタント発言(=ユーザーへの丸投げ・理解の演技)の検査 ---
TRANSCRIPT=""
MODE="${1:-}"
if [[ "$MODE" == "--transcript" ]]; then TRANSCRIPT="${2:-}"; fi
if [[ "$MODE" == "--hook" ]]; then
  payload="$(cat)"
  # 再帰防止: stop_hook_active のときは何もしない
  if command -v jq >/dev/null 2>&1; then
    [[ "$(jq -r '.stop_hook_active // false' <<<"$payload")" == "true" ]] && exit 0
    TRANSCRIPT="$(jq -r '.transcript_path // empty' <<<"$payload")"
  fi
fi

if [[ -n "$TRANSCRIPT" && -f "$TRANSCRIPT" ]] && command -v python3 >/dev/null 2>&1; then
  python3 - "$TRANSCRIPT" <<'PY' >&2
import json,re,sys
p=sys.argv[1]
last=""
try:
    for line in open(p, encoding='utf-8', errors='replace'):
        try: o=json.loads(line)
        except Exception: continue
        if o.get('type')!='assistant': continue
        msg=o.get('message') or {}
        parts=msg.get('content') or []
        txt="".join(c.get('text','') for c in parts if isinstance(c,dict) and c.get('type')=='text')
        if txt.strip(): last=txt
except Exception: sys.exit(0)
if not last: sys.exit(0)
# ユーザーへ判断を投げる/承認を待つ/理解を演じる 表現
BAD = {
  'escalation': r'どうしますか|どちらにしますか|どれにしますか|判断をお願い|指示をください|指示を下さい|承認をください|決めてください|方針をください|方向をください|お待ちします|待ちます(?!ん)|3択|三択|選んでください',
  'perform':    r'理解しました|理解できました|伝わりましたか|わかりました！|把握しました',
}
# 仕組み自体を説明する文(禁止句の列挙)は行為ではないので除外する。
# 近傍にこの語彙があればメタ言及と判定(2026-07-26: 検問が自分の説明文に噛んだのを修正)。
META = r'検問|丸投げ表現|禁止句|禁止語|検知|decision_guard|ANTI_REGRESSION|再発シグネチャ|演技|パターン|等の|列挙|フック'
hits=[]
for k,pat in BAD.items():
    for m in re.finditer(pat,last):
        a=max(0,m.start()-70); b=min(len(last),m.end()+70)
        if re.search(META,last[a:b]): continue
        s=max(0,m.start()-40); hits.append(f'{k}: …{last[s:m.end()+40].strip()}…')
if hits:
    print('  [直近の発言] 判断の丸投げ/理解の演技の疑い:')
    for h in hits[:5]: print('   ',h.replace(chr(10),' '))
    sys.exit(2)
PY
  [[ $? -eq 2 ]] && viol=1
fi

# --- git pre-commit の設置(コンテナ再構築後の自己修復) ---
if [[ "$MODE" == "--install-git-hook" ]]; then
  hook="$ROOT/.git/hooks/pre-commit"
  if [[ -d "$ROOT/.git/hooks" ]]; then
    cat > "$hook" <<'HOOK'
#!/bin/bash
# コミットさせない違反: ①判断の丸投げ(decision_guard.sh) ②測定配線の欠落(measure_wiring_check.js)
top="$(git rev-parse --show-toplevel)"
"$top/sim/tools/decision_guard.sh" || exit $?
# sim の測定/判定コードに触るコミットだけ、判定器が読むカウンタが記録に載っているかを静的検査
if git diff --cached --name-only | grep -qE '^sim/(sim|runner)\.js$'; then
  node "$top/sim/tools/measure_wiring_check.js" || exit 1
fi
exit 0
HOOK
    chmod +x "$hook"
    echo "installed: .git/hooks/pre-commit"
  fi
  exit 0
fi

if [[ $viol -ne 0 ]]; then
  echo "" >&2
  echo "判断の丸投げ検問(ANTI_REGRESSION #2/#6)に引っかかりました。上の箇所を「自分の決定+実行状況」に書き換えるか、" >&2
  echo "発言から丸投げ表現を外してから続けること。決められない理由が『経済に触るから』なら、それは例外ではない" >&2
  echo "(sim先行+平均保存+revert可+バッテリーの手順で自分で回せる)。例外は不可逆・明らかに任務外のみ。" >&2
  exit 2
fi
exit 0
