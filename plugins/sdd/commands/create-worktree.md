---
allowed-tools: Bash(bash:*), Bash(git worktree:*), Bash(git branch:*), Bash(git checkout:*), Bash(git rev-parse:*), Bash(git status:*), Bash(git log:*), Bash(git remote:*), Bash(ln:*), Bash(mkdir:*), Bash(gh issue:*), Bash(glab issue:*), Bash(bun:*), Bash(pnpm:*), Bash(yarn:*), Bash(npm:*), Read, Write, Edit, Grep, Glob
argument-hint: <prefix-or-spec> [task-or-name]
description: ワークツリーとブランチを作成し、秘匿ファイルのシンボリックリンクを設定する
---

# create-worktree

ワークツリーとブランチを作成するコマンド

## Project context preflight

実行前に plugin bundled `templates/framework/project-context.md` を読み、project-defined な worktree base、branch/VCS規則、承認、secret symlink、初期化、検証、workflow-state規則を適用する。

## 使用方法

```
/create-worktree <prefix-or-spec> [task-or-name]
```

## 引数

- **$1**: プレフィックスまたはスペック番号（必須）
  - **`B{nn}-S{nn}` 形式**（例: B02-S01）: スペックタスク用
  - **`sdd`**（リテラル文字列）: SDD（スペック生成）用
  - **`issue`**（リテラル文字列）: Issue 用（GitHub / GitLab 自動判定）
  - **テキスト**（例: fix, chore, docs, adhoc, report）: 任意のカテゴリ用
    - 英数字とハイフンのみ使用可能（スペース・特殊文字不可）
- **$2**: タスク番号または作業名（必須）
  - **スペック**（`B{nn}-S{nn}`）の場合: タスク/フェーズ番号（例: T1.1, 1.1, Ph1, ph1, phase1）
  - **`sdd`** の場合: スペック番号（例: B05-S03）。スペックディレクトリが存在しない場合は新規作成
  - **`issue`** の場合: Issue番号（例: 42, 123）
  - **テキスト**の場合: 作業内容を表す名前（例: `bug-123`, `cleanup`）
    - 日本語入力可（自動的に英語にスラッグ化）

## 実行例

```bash
# 汎用ワークツリー作成（任意のプレフィックス）
/create-worktree fix bug-123
/create-worktree chore cleanup
/create-worktree docs update-readme
/create-worktree adhoc looker-update
/create-worktree report shop-analysis

# 日本語作業名（自動スラッグ化）
/create-worktree fix アクション確定レポート修正
# → .worktrees/fix-action-confirm-report-fix
# → ブランチ: fix/action-confirm-report-fix

# SDD（スペック生成）ワークツリー作成
/create-worktree sdd B05-S03
/create-worktree sdd B06-S01

# イシューワークツリー作成（GitHub / GitLab どちらも対応）
/create-worktree issue 42
/create-worktree issue 123

# スペックタスクワークツリー作成
/create-worktree B02-S01 T1.1
/create-worktree B02-S01 1.1
/create-worktree B02-S02 T1.2
/create-worktree B02-S01 Ph1
```

## 実行内容

### パターン1: 汎用タスク（$1 がテキスト）

プレフィックス: $1
作業名: $2

1. **引数確認**:
   - $2（作業名）が指定されているか確認
   - 未指定の場合はエラー報告して処理中断

2. **プレフィックスのバリデーション**:
   - 英数字とハイフン（`-`）のみ許可
   - スペース・特殊文字（`~^:?*[\\`等）が含まれる場合はエラー
   - 先頭・末尾が `.` または `/` の場合はエラー

3. **作業名のスラッグ化**:
   - 日本語キーワードを英語に変換（下記マッピング参照）
   - 英数字以外をハイフン（`-`）に置換
   - 連続ハイフンを単一ハイフンに統一
   - 前後のハイフンを削除
   - 小文字に統一
   - 50文字でカット

4. **命名規則適用**:
   - ワークツリー: `{WORKTREE_BASE}/{prefix}-{slug}`
   - ブランチ: `{prefix}/{slug}`
   - 例: ワークツリー `.worktrees/fix-bug-123`、ブランチ `fix/bug-123`

### パターン2: SDD スペック生成（$1 が `sdd`）

スペック番号: $2（例: B05-S03）

1. **引数確認**:
   - $2 が `B{nn}-S{nn}` 形式であるか確認
   - 形式が異なる場合はエラー報告して処理中断

2. **事前確認と引数解析**:
   - $2 を `B{nn}-S{nn}` 形式としてパース
   - スペックディレクトリの存在確認: `Bash(command ls -d spec/specs/B{nn}-S{nn}-* 2>/dev/null | head -1)`
   - **存在する場合**: ディレクトリ名から `{slug}` を抽出（例: `B05-S03-whisper-mode` → `whisper-mode`）
   - **存在しない場合**: Blueprint の scopes から slug を取得する
     1. `spec/blueprints/` 配下から `B{nn}` に対応する Blueprint ディレクトリを検索
     2. Blueprint の `scopes/` 内から `S{nn}` に対応する scope ファイルを検索（例: `scopes/03-whisper-mode.md`）
     3. scope ファイル名から slug を抽出（例: `03-whisper-mode.md` → `whisper-mode`）
     4. Blueprint も scope も見つからない場合はエラー報告して処理中断

3. **命名規則適用**:
   - ワークツリー: `{WORKTREE_BASE}/sdd-B{nn}-S{nn}-{slug}`
   - ブランチ: `sdd/B{nn}-S{nn}-{slug}`
   - 例: ワークツリー `.worktrees/sdd-B05-S03-whisper-mode`、ブランチ `sdd/B05-S03-whisper-mode`

### パターン3: スペックタスク（$1 が `B{nn}-S{nn}` 形式）

スペック番号: $1（例: B02-S01）
タスク番号: $2

1. **引数確認**:
   - $2（タスク番号）が指定されているか確認
   - 未指定の場合はエラー報告して処理中断

2. **事前確認と引数解析**:
   - $1 を `B{nn}-S{nn}` 形式としてパース
   - タスク番号はT形式に正規化（1.1→T1.1）、フェーズ番号はPh形式で扱う（例: Ph1, ph1, phase1）
   - スペックディレクトリの存在確認: `Bash(command ls -d spec/specs/B{nn}-S{nn}-* 2>/dev/null | head -1)`
   - 見つからない場合は「スペック$1のディレクトリが見つかりません」とユーザーに報告して処理中断
   - ディレクトリ名から `{slug}` を抽出（例: `B02-S01-sidebar-layout` → `sidebar-layout`）

3. **命名規則適用**:
   - ワークツリー: `{WORKTREE_BASE}/specB{nn}-S{nn}-{id}`
   - ブランチ: `spec/B{nn}-S{nn}-{slug}/{id}`
   - 例: ワークツリー `.worktrees/specB02-S01-T1.1`、ブランチ `spec/B02-S01-sidebar-layout/T1.1`

### パターン4: イシュータスク（$1 が `issue`）

Issue番号: $2

1. **引数確認**:
   - $2（Issue番号）が数値であるか確認
   - 数値でない場合はエラー報告して処理中断

2. **VCS プロバイダー判定**:
   - `CLAUDE.md` / `AGENTS.md` に VCS 記述がある場合はそれを採用（例: `VCS: GitLab (host) — use glab`）
   - 記述がなければ `git remote get-url origin` を実行し、ホスト名から判定:
     - `github.com` を含む → GitHub（`gh` を使用）
     - その他（`gitlab.*` 等、self-hosted 含む）→ GitLab（`glab` を使用）

3. **Issue 情報取得**:
   - GitHub の場合: `gh issue view $2 --json number,title,state`
   - GitLab の場合: `glab issue view $2 --output json`（返却フィールド: `iid`, `title`, `state`）
   - Issue が存在しない場合はエラー報告して処理中断
   - Issue がクローズ済みの場合は警告表示（ユーザーに続行するか確認）
   - Issue タイトルをスラッグ化（汎用タスクの作業名スラッグ化ルールと同一処理）

4. **命名規則適用**:
   - ワークツリー: `{WORKTREE_BASE}/issue-{number}-{slug}`
   - ブランチ: `issue/{number}-{slug}`
   - 例: Issue #42 "Fix login error" → ワークツリー `.worktrees/issue-42-fix-login-error`、ブランチ `issue/42-fix-login-error`

## 日本語キーワードマッピング（作業名スラッグ化用）

汎用タスクの作業名（$2）に日本語が含まれる場合、以下のマッピングで英語に変換:

```
レポート → report
修正 → fix
更新 → update
追加 → add
削除 → delete
変更 → change
改善 → improve
ビュー → view
クエリ → query
データ → data
分析 → analysis
集計 → aggregate
確定 → confirm
アクション → action
ショップ → shop
モール → mall
```

**スラッグ化例**:

- `アクション確定レポート修正` → `action-confirm-report-fix`
- `shop_report_{mall}を修正` → `shop-report-mall-fix`
- `データ分析用クエリ追加` → `data-analysis-query-add`

### 共通処理（全パターン）

3.1. **ワークツリーベースディレクトリの決定**:

ワークツリーの配置先は `.worktrees/` をデフォルトとする。project context に `Worktree Base:` 記述（例: `Worktree Base: custom-worktrees/`）があれば上書きする。

```
PROJECT_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_BASE=".worktrees"  # デフォルト

# AGENTS.md / CLAUDE.md に `Worktree Base: <path>` の記述があれば WORKTREE_BASE を上書き
#   （末尾スラッシュは任意。読み込み側で除去して扱う）

# ベースディレクトリが存在しない場合は作成提案:
if [ ! -d "$PROJECT_ROOT/$WORKTREE_BASE" ]; then
  「$WORKTREE_BASE/ ディレクトリが見つかりません。作成してよろしいですか？(y/n)」
  - Yes → mkdir -p "$PROJECT_ROOT/$WORKTREE_BASE"
         → .gitignore に $WORKTREE_BASE が未登録なら追加
  - No → ユーザーに希望のディレクトリを確認
fi
```

以降のステップでは `WORKTREE_BASE` 変数を使用する（デフォルト `.worktrees`）。

3.5. **ベースブランチのクリーン状態チェック**:

- ルートディレクトリの `git status --porcelain` を実行
- 出力が空でない場合、ユーザーに警告を表示:

  ```
  ⚠️ 現在のブランチに未コミットの変更があります:
  {git status --short の出力}

  pre-push フック実行時にテスト対象に含まれて失敗する可能性があります。
  `git stash` で退避することを推奨します。

  → このまま続行しますか？(y/n)
  ```

- ユーザーが `n` の場合は処理中断

  3.6. **ベースブランチの未pushコミットチェック**:

- 現在のブランチ名を `git branch --show-current` で取得
- リモート追跡ブランチが存在するか確認: `git rev-parse --verify origin/{branch} 2>/dev/null`
- 追跡ブランチが存在する場合、`git log --oneline origin/{branch}..{branch}` を実行
- 出力がある場合（未push のコミットが存在する場合）、ユーザーに警告を表示:

  ```
  ⚠️ ローカルブランチに origin より先行する未push のコミットがあります:
  {git log --oneline の出力}

  ワークツリーブランチにこれらのコミットが含まれます。
  PR に意図しないコミットが混入し、レビュー対象の差分が広がる可能性があります。
  先に `git push` で同期することを推奨します。

  → このまま続行しますか？(y/n)
  ```

- ユーザーが `n` の場合は処理中断

4. **ワークツリー作成実行**:
   - **重要**: 必ず絶対パスで指定してワークツリーを作成
   - **禁止**: cdコマンドでのディレクトリ移動（アクセス制限によりエラーになる）

   ```bash
   # プロジェクトルート取得
   PROJECT_ROOT="$(git rev-parse --show-toplevel)"

   # ワークツリー作成（絶対パスで直接実行）
   # パターン別の例（{WORKTREE_BASE} は手順 3.1 で決定した値。通常は `.worktrees`）:
   # - 汎用: git worktree add "$PROJECT_ROOT/{WORKTREE_BASE}/{prefix}-{slug}" -b "{prefix}/{slug}"
   # - spec: git worktree add "$PROJECT_ROOT/{WORKTREE_BASE}/specB{nn}-S{nn}-{id}" -b "spec/B{nn}-S{nn}-{slug}/{id}"
   ```

5. **秘匿ファイルシンボリックリンク**:
   - プラグイン同梱の `${CLAUDE_PLUGIN_ROOT}/scripts/detect-secrets.sh` で秘匿ファイルを検出（ファイル名パターン + `git check-ignore` の AND 条件。cleanup-worktree と共通ロジック）
   - 各ファイルを同じ相対パスでプロジェクトルートのファイルへのシンボリックリンクを作成
   - 必要に応じてワークツリー内にディレクトリを作成
   - シンボリックリンク作成結果をユーザーに報告（成功数/失敗数）

   ```bash
   # 検出・シンボリックリンク作成の実行例（深度2階層まで走査）
   PROJECT_ROOT="$(git rev-parse --show-toplevel)"
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/detect-secrets.sh" "$PROJECT_ROOT" 2 | \
   while read -r file; do
     rel_path="${file#$PROJECT_ROOT/}"
     target_dir="$PROJECT_ROOT/{worktree-path}/$(dirname "$rel_path")"
     mkdir -p "$target_dir"
     ln -s "$file" "$target_dir/$(basename "$file")"
   done
   ```

6. **パッケージマネージャの自動検出と依存インストール**:
   - プロジェクトルートのロックファイルからパッケージマネージャを判定し、ワークツリー内で依存インストールを実行
   - ロックファイルが存在しない場合はスキップ

   ```bash
   WORKTREE_ABS="{absolute-worktree-path}"
   PROJECT_ROOT="$(git rev-parse --show-toplevel)"

   if [ -f "$PROJECT_ROOT/bun.lock" ] || [ -f "$PROJECT_ROOT/bun.lockb" ]; then
     bun install --cwd "$WORKTREE_ABS"
   elif [ -f "$PROJECT_ROOT/pnpm-lock.yaml" ]; then
     pnpm --dir "$WORKTREE_ABS" install
   elif [ -f "$PROJECT_ROOT/yarn.lock" ]; then
     yarn --cwd "$WORKTREE_ABS" install
   elif [ -f "$PROJECT_ROOT/package-lock.json" ]; then
     npm --prefix "$WORKTREE_ABS" install
   else
     echo "ロックファイルが見つかりません。依存インストールをスキップします"
   fi
   echo "✓ Dependencies installed"
   ```

7. **ステートファイル初期化**:
   ワークフロー管理用のステートファイルを `{WORKTREE_BASE}/{worktree-name}/.tmp/workflow-state.md` に作成する。
   `.tmp/` ディレクトリがなければ `mkdir -p {WORKTREE_BASE}/{worktree-name}/.tmp` で作成。

また、障害記録用の `retro.md` も同じ `.tmp/` ディレクトリに空ファイルとして初期化する:
`{WORKTREE_BASE}/{worktree-name}/.tmp/retro.md`

**スペックタスクの場合:**

```markdown
# Workflow State

## Context

- workflow: implementation
- spec: B{nn}-S{nn}-{slug}
- phase: {id}（例: Ph1, T1.1）
- worktree: {WORKTREE_BASE}/{worktree-name}
- branch: {branch-name}

## Current Step

- step: create-worktree
- substep: 完了
- next: /plan-task で実装計画を作成
```

**イシュータスクの場合:**

```markdown
# Workflow State

## Context

- workflow: implementation
- issue: {number}
- title: {issue-title}
- worktree: {WORKTREE_BASE}/{worktree-name}
- branch: {branch-name}

## Current Step

- step: create-worktree
- substep: 完了
- next: /plan-task で実装計画を作成
```

**汎用タスクの場合:**

```markdown
# Workflow State

## Context

- workflow: implementation
- type: {prefix}
- name: {slug}
- worktree: {WORKTREE_BASE}/{worktree-name}
- branch: {branch-name}

## Current Step

- step: create-worktree
- substep: 完了
- next: 作業開始
```

**SDD（スペック生成）の場合**（ブランチ名が `sdd/` で始まる場合）:

```markdown
# Workflow State

## Context

- workflow: spec-generation
- spec: B{nn}-S{nn}-{slug}
- worktree: {WORKTREE_BASE}/{worktree-name}
- branch: {branch-name}

## Current Step

- step: create-worktree
- substep: 完了
- next: ドキュメント生成を開始
```

8. **完了報告**:

- 作成したワークツリーのパス
- 作成したブランチ名
- シンボリックリンク作成したファイル数
- 作業ディレクトリの確認:
  ```
  ワークツリーを作成しました: {WORKTREE_BASE}/{name}

  作業ディレクトリをどうしますか？
  1. ワークツリーに移動する — 以降の操作はワークツリー内で行う
  2. 現在のディレクトリで作業を続ける — ワークツリーのパスを指定して操作する
  ```
  - 1 の場合: `cd {absolute-worktree-path}` を実行
  - 2 の場合: 移動せず、以降のファイル操作で `{WORKTREE_BASE}/{name}/...` のパスを使う旨を案内
- 次ステップ提案（ワークフロー種別で分岐）:
  - **実装ワークフロー**: `→ /sdd:plan-task {spec} {phase} で実装計画を作成しましょうか？(y/n)`
  - **SDDワークフロー**（ブランチ名が `sdd/` で始まる場合）: `→ ドキュメント生成に進みましょうか？(y/n)`

## エラーハンドリング

- **引数不足**: 必須引数（$1, $2）が指定されていない場合はエラー報告
- **プレフィックス不正**: $1が数値でもなく、英数字・ハイフン以外の文字を含む場合はエラー報告
- **スペックディレクトリ不在**: （スペックタスクの場合）指定された番号のスペックディレクトリが`spec/specs/`内に見つからない場合は作業を中断し、ユーザーに報告（勝手に作成しない）
- **ワークツリー既存**: 同名のワークツリーディレクトリが既に存在する場合:
  1. `.git` ファイルの存在を確認: `[ -f {WORKTREE_BASE}/{name}/.git ]`
  2. `.git` ファイルが存在する（健全） → 既存ワークツリーがある旨をエラー報告
  3. `.git` ファイルが存在しない（破損） → ワークツリーが破損している旨を報告し、`git worktree remove --force {path}` で削除してから再作成するかユーザーに確認。承諾された場合は `git worktree remove --force` を実行し、ステップ4から再開
- **ブランチ名重複**: 同名のブランチが既に存在する場合は別名を提案
- **シンボリックリンク作成エラー**: 個別ファイルのシンボリックリンク作成に失敗した場合は警告表示して処理続行、致命的エラーの場合のみ中断
- **パッケージマネージャ未インストール**: 警告表示してインストールをスキップ

## 重要な注意事項

⚠️ **ワークツリー作成処理中に避けるべきこと**（この制約は作成処理中のみ適用。作成後の開発作業では cd でワークツリーに移動してよい）:

- 相対パスでの git worktree add 実行（カレントディレクトリに意図しないディレクトリを作成してしまう）
- cdコマンドでのディレクトリ移動（zoxide等のシェルエイリアスに横取りされてエラーになる）
- ワークツリー内での `git rev-parse --show-toplevel` 使用（メインリポジトリではなくワークツリーのパスを返すためパスが二重になる）
- プロジェクトルート以外の場所でのワークツリー作成

✅ **必須事項**:

- ワークツリーは必ず `{project-root}/{WORKTREE_BASE}/` に絶対パスで作成（`git rev-parse --show-toplevel` でルート取得）
- `WORKTREE_BASE` はステップ 3.1 で決定されたディレクトリを使用する
- 作成処理中はcdコマンド不要で直接git worktree addを絶対パス指定で実行
- 作成完了後は `cd` でワークツリーに移動し、以降の開発作業はワークツリー内で行う
