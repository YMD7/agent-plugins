---
argument-hint: <worktree_path_or_branch>
description: ワークツリーとブランチを安全に削除する（サブモジュール対応・秘匿ファイル回収版）
allowed-tools: Bash(bash:*), Bash(git worktree:*), Bash(git branch:*), Bash(git remote:*), Bash(gh:*), Bash(glab:*), Read
---

# ワークツリー・ブランチクリーンアップ（サブモジュール対応）

指定されたワークツリーディレクトリまたはブランチ名を削除する。

**重要**: このコマンドはプラグイン同梱の `${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-worktree.sh` スクリプトを使用する。
サブモジュールを含むワークツリーも安全に削除でき、削除前に秘匿ファイルを自動回収する。

Codex wrapper skill から実行する場合は、まずプラグインrootを特定し、絶対パスで同じスクリプトを実行する。対象プロジェクトのcwdから相対 `../../scripts/cleanup-worktree.sh` を直接実行してはならない。
以下の例では、Codex wrapper が特定したプラグインrootを `$SDD_PLUGIN_ROOT` として表す。

## 対象

- ワークツリーまたはブランチ: $ARGUMENTS

**現在のワークツリー**: !`git worktree list`

## リポジトリ情報の自動検出

スクリプト実行前に、VCS プロバイダーを判定してリポジトリ情報を取得する。

- **VCS 判定**: `CLAUDE.md` / `AGENTS.md` に VCS 記述があれば採用。なければ `git remote get-url origin` のホスト名から判定（`github.com` → GitHub、その他 → GitLab）
- **リポジトリ情報の取得**:
  - GitHub: `gh repo view --json nameWithOwner -q .nameWithOwner`（結果は `$REPO` として保持）
  - GitLab: `glab repo view --output json`（`path_with_namespace` を `$REPO` として保持）

## 前提チェック: cwd をプロジェクトルートに戻す

**必須**: スクリプト実行前に、cwd がワークツリー内にないことを確認する。ワークツリー内で `cd` している状態でそのワークツリーを削除すると、Claude Code セッションの cwd が存在しなくなり、セッションがクラッシュする。

```bash
cd "$(git worktree list --porcelain | head -1 | sed 's/^worktree //')" && pwd
```

## 実行方法

### 推奨: スクリプトを使用（サブモジュール対応）

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-worktree.sh $ARGUMENTS
# Codex wrapper: bash "$SDD_PLUGIN_ROOT/scripts/cleanup-worktree.sh" $ARGUMENTS
```

**スクリプトの機能**:

- サブモジュールの自動検出と解除
- ワークツリーディレクトリの完全削除（シンボリックリンク含む）
- Git管理情報のクリーンアップ
- ローカル・リモートブランチの削除
- 秘匿ファイルの自動回収（削除前に実行）
- 安全性チェック（mainブランチ保護）

**オプション**:

- `--dry-run`: 実際には削除せず、実行予定の操作を表示
- `--help`: ヘルプを表示

### ドライラン実行（推奨）

削除前に影響範囲を確認:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-worktree.sh --dry-run $ARGUMENTS
# Codex wrapper: bash "$SDD_PLUGIN_ROOT/scripts/cleanup-worktree.sh" --dry-run $ARGUMENTS
```

## 処理内容

スクリプトは以下の手順を自動実行する:

1. **安全性チェック**:
   - mainブランチやメインリポジトリでないことを確認
   - 対象ワークツリーの検索（部分一致対応）

2. **秘匿ファイルの回収**:
   - ワークツリー内の秘匿ファイルを検索
     - `.env*`（`.example`を除く）
     - `*.key`, `*.pem`, `*.p8`, `*.p12`, `*.pfx`（証明書・秘密鍵）
     - `*credentials*.json`, `*service-key.json`, `*-sa-key.json`（認証情報）
     - `.secret*`（その他秘匿ファイル）
   - ルート側に存在しないファイル → 自動コピー
   - ルート側に存在するファイル → 差分チェック
     - 差分なし → スキップ
     - 差分あり → ユーザーに上書き確認（y/N）
   - コピー結果をサマリー表示
   - **注意**: ユーザー確認が必要な場合があるため、ワークツリー削除処理の前に実行

3. **サブモジュール処理**:
   - `.gitmodules` とサブモジュール状態を確認
   - サブモジュールがあれば `git submodule deinit -f` で解除

4. **ワークツリー削除**:
   - `git worktree remove --force` で一括削除（推奨方法）
   - 失敗時は `git worktree prune` で Git管理情報のみ削除
   - 物理ディレクトリが残る場合は手動削除を案内

5. **ブランチ削除**:
   - ローカルブランチ: `git branch -D <branch>`
   - リモートブランチ: 存在確認後、自動的に削除（確認なし）

6. **ベースブランチの同期**:
   - ベースブランチの検出: `origin/develop` が存在すれば `develop`、なければ `main` を使用
   - `git fetch origin <base_branch>` でリモートの最新情報を取得
   - ローカルとリモートに差分があれば `git pull` で取り込み
   - 既に最新の場合はスキップ

7. **最終確認**:
   - ワークツリー一覧とブランチ参照を表示

## エラーハンドリング

- **軽微なエラー**: 警告表示して継続（例: サブモジュール解除失敗）
- **致命的エラー**: エラー報告して中断（例: main削除試行、対象不明）

## トラブルシューティング

### スクリプト実行権限がない場合

プラグイン同梱のスクリプトは通常実行権限付きで配布されるが、万一必要なら:

```bash
chmod +x ${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-worktree.sh
```

### 手動削除が必要な場合

スクリプトが警告を出した場合、以下のコマンドで手動削除:

```bash
# ワークツリーディレクトリの削除
rm -rf /path/to/worktree

# Git管理情報のクリーンアップ
git worktree prune
```

## 作業サマリー報告

クリーンアップ完了後、そのイテレーションで行った作業内容をユーザーに報告する。

### 報告手順

1. **スクリプト実行前**に対象ワークツリーの `.tmp/workflow-state.md` を読み込み（`git worktree list` で絶対パスを解決）、PR セクションから PR 番号を取得する
2. PR / MR 番号がある場合、VCS プロバイダーに応じて情報を取得（`$REPO` はリポジトリ情報の自動検出で取得した値）:

```bash
# GitHub の場合
gh pr view {number} --repo $REPO --json title,number,additions,deletions,changedFiles,mergedAt,url

# GitLab の場合
glab mr view {number} --repo $REPO --output json
# → title, iid, merged_at, web_url 等のフィールドを使用
```

3. スクリプト実行・クリーンアップ完了後、以下のフォーマットで報告:

```
## 作業サマリー

| 項目 | 内容 |
|------|------|
| PR | #{number} {title} |
| 変更 | +{additions} -{deletions}（{changedFiles} files） |
| マージ | {mergedAt} |
| URL | {url} |
```

4. PR 番号がない場合（PR 未作成でクリーンアップする場合）はサマリー報告をスキップする

## クリーンアップ後のネクストアクション提案

### ベースブランチ同期済み明示

完了報告に必ず以下を含める（`<base_branch>` はスクリプトが検出したベースブランチ名）:

```
✅ <base_branch> は最新に同期済みです
```

### ステートファイル参照による次イテレーション提案

クリーンアップ前に対象ワークツリーの `.tmp/workflow-state.md` を読み込み（`git worktree list` で絶対パスを解決）、次の未完了フェーズ/タスクを特定する:

1. **ステートファイルがある場合**: Context セクションのスペック/イシュー情報から tasks.md を参照し、次の未完了タスク/フェーズを特定して `/create-worktree` コマンドを引数付きで提案

   ```
   → 次のフェーズ: `/create-worktree B02-S01 Ph3` で始めましょう
   ```

2. **ステートファイルがない場合**: 会話の文脈から推測

### ステートファイルの自動クリーンアップ

ワークツリー削除により `<worktree>/.tmp/` 配下のステートファイル・レトロファイル・レビュー結果等は自動クリーンアップされる。明示的な削除は不要。

### イシュータスク完了時の報告フォーマット

イシュータスクのクリーンアップ後は、オープンなイシュー一覧を取得し、既存ワークツリーとの紐付けも合わせて報告する:

1. VCS に応じてオープンイシューを取得（`$REPO` は自動検出値）:
   - GitHub: `gh issue list --repo $REPO --state open`
   - GitLab: `glab issue list --repo $REPO --opened`
2. `git worktree list` の結果と照合し、各イシューに対応するワークツリーがあるか確認
3. 以下のフォーマットで報告:

```
| # | タイトル | ラベル | ワークツリー |
|---|---|---|---|
| 540 | バグ修正 | bug | あり（作業中） |
| 541 | 新しいイシュー | enhancement | なし |
```

### 提案しないケース

- 文脈が不足していて次のアクションが不明確
- 推測の確度が低い場合

的外れな提案はノイズになるため、無理に提案しないこと。

## 関連ファイル

- **スクリプト本体**: `${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-worktree.sh`
- **ワークツリー作成**: `${CLAUDE_PLUGIN_ROOT}/commands/create-worktree.md`
