---
allowed-tools: Bash(bash:*), Bash(git rev-parse:*), Bash(git status:*), Bash(git remote:*), Bash(gh issue:*), Bash(glab issue:*), Read, Edit, Grep, Glob
argument-hint: <prefix-or-spec> [task-or-name]
description: 決定論的executorでワークツリーとブランチを安全に作成する
---

# create-worktree

SDD plugin同梱の決定論的executorを使用してワークツリーを作成する。
モデルが`git worktree add`やsecret link作成を再実装してはならない。

## Project context preflight

実行前にplugin同梱の`templates/framework/project-context.md`を読み、次の
project-defined規則だけをexecutorの明示的な引数へ変換する。

- worktree base
- base branch / base ref
- dirty tree / unpushed commitの承認
- secret link規則
- dependency初期化またはproject固有initializer
- workflow-state / retro規則

executorはHerdr、番頭、Codex、Claude Codeを参照しない。

## Plugin rootの解決

executorは`plugins/sdd/scripts/create-worktree.sh`にある。

- Claude Code: `${CLAUDE_PLUGIN_ROOT}`をplugin rootとして使用する
- Codex: 読み込んだ`skills/create-worktree/SKILL.md`の配置先から
  `../..`を絶対パスへ解決する

以下では解決済みの絶対パスを`$SDD_PLUGIN_ROOT`と表記する。固定された
cache pathを推測してはならない。executor自身はplugin root環境変数に
依存せず、兄弟scriptを自身の配置先から解決する。

## 使用方法

```text
/create-worktree <prefix-or-spec> <task-or-name>
```

入力形式:

- 汎用: `fix bug-123`、`docs update-readme`
- spec生成: `sdd B05-S03`
- spec task: `B02-S01 T1.1`、`B02-S01 Ph1`
- Issue: `issue 42`

## モデルが判断してよい範囲

次の場合だけモデルが入力を補う。

- 既知mappingでslug化できない日本語名: 英語の`--slug`を生成する
- Issue入力: VCSからtitle/stateを取得し`--issue-title`を渡す
- Issueがclosedの場合: 状態を提示し、続行確認後だけpreflightへ進む
- executorが終了コード10を返した場合: 対応する確認をユーザーへ行う

パス、branch名、task ID、spec slug、重複、dirty/ahead判定はexecutorの
出力を使用し、モデル側で再計算しない。

## 実行フロー

### 1. 明示的な引数を組み立てる

必ず次を指定する。

- `--project-root`: `git rev-parse --show-toplevel`で確認した絶対パス
- `--worktree-base`: project contextの値。未指定時は`.worktrees`
- `--base-ref`: project contextの値。未指定時は`HEAD`
- dependency方針:
  - 標準自動初期化: `--install-dependencies`
  - project固有initializerを後から実行: `--skip-dependencies`
- project contextがretro初期化を禁止する場合: `--no-retro`

`--allow-dirty`、`--allow-ahead`、`--create-base`、
`--allow-unignored-base`は事前確認なしで指定してはならない。

### 2. preflight

```bash
bash "$SDD_PLUGIN_ROOT/scripts/create-worktree.sh" \
  preflight "$PREFIX_OR_SPEC" "$TASK_OR_NAME" \
  --project-root "$PROJECT_ROOT" \
  --worktree-base "$WORKTREE_BASE" \
  --base-ref "$BASE_REF" \
  "$DEPENDENCY_OPTION"
```

結果は安定した`key=value`形式で返る。

- 終了0 / `status=ready`: applyへ進む
- 終了10 / `status=needs_confirmation`: 警告に応じて確認する
- 終了2: 呼び出し引数を修正する
- 終了3: 検証エラーを報告して中断する

警告と対応:

- `dirty_tree`: 続行確認後だけ`--allow-dirty`
- `unpushed_commits`: 続行確認後だけ`--allow-ahead`
- `worktree_base_missing`: 作成確認後だけ`--create-base`
- `worktree_base_unignored`: `.gitignore`追加を優先する。追加しないことを
  確認した場合だけ`--allow-unignored-base`
- `dependency_action_required`: dependency方針を明示する

preflightはファイル、branch、worktreeを変更しない。

### 3. apply

preflightと同じ引数を使用し、actionだけを`apply`へ変更する。
applyは内部でpreflightを再実行し、状態が変化していれば作成しない。

```bash
bash "$SDD_PLUGIN_ROOT/scripts/create-worktree.sh" \
  apply "$PREFIX_OR_SPEC" "$TASK_OR_NAME" \
  --project-root "$PROJECT_ROOT" \
  --worktree-base "$WORKTREE_BASE" \
  --base-ref "$BASE_REF" \
  "$DEPENDENCY_OPTION"
```

executorが担当する処理:

- 絶対パスとbranch名の決定
- `git worktree add`
- ignored secretの検出とsymlink作成
- `.tmp/workflow-state.md`と必要な場合の`retro.md`初期化
- 明示された場合だけdependency初期化

終了4 / `status=created_partial`の場合、worktree作成後の初期化に失敗して
いる。自動削除せず、作成済みpathとerror codeを報告する。

### 4. project固有initializer

project contextがtracked initializerを指定している場合、executorには
`--skip-dependencies`を渡し、apply成功後にそのinitializerを実行する。
汎用package installで上書きしてはならない。

### 5. 完了報告

executorが返した次の値をそのまま報告する。

- `worktree_path`
- `branch`
- `base_ref`
- `secret_links`
- `dependency_status`

実装ワークフローの場合は、次の作業として`/sdd:plan-task`を提示する。
