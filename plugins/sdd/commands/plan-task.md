---
allowed-tools: Bash(git rev-parse:*), Bash(git remote:*), Bash(gh issue:*), Bash(glab issue:*), Read, Write, Edit, Grep, Glob, EnterPlanMode
argument-hint: <spec-or-issue> <phase-or-task>
description: 実装計画を作成する（PlanMode）。ステートファイルから文脈を復元。
---

# plan-task

実装計画をPlanModeで作成するスキル。ステートファイルから文脈を復元し、tasks.md + design.md を基に計画を立てる。

## Project context preflight

計画作成前に plugin bundled `templates/framework/project-context.md` を読み、project-defined な事前調査、規模、security、検証、承認のchecklistを計画へ追加する。

日本語トリガー: プラン、実装計画

## 使用方法

```
/plan-task <spec-or-issue> <phase-or-task>
```

## 引数

- **$1**: スペック番号（例: B02-S01）またはイシュー番号（例: issue-42）
- **$2**: フェーズ番号（例: Ph2）またはタスク番号（例: T1.1）

引数が省略された場合はステートファイルから復元を試みる。

## 実行フロー

### 1. ステートファイル読み込み

ステート解決ルールに従いステートファイルを特定する。

- 存在する場合: Context セクションからスペック/イシュー、フェーズ/タスク情報を取得
- 存在しない場合: 引数から情報を構築
- 引数もステートもない場合: エラー報告

### 2. 対象の特定

**スペックタスクの場合:**

- `spec/specs/B{nn}-S{nn}-{slug}/tasks.md` から該当フェーズ/タスクを特定
- `spec/specs/B{nn}-S{nn}-{slug}/design.md` を読み込み
- 前フェーズの完了状況（tasks.md のチェックマーク）を確認

**イシューの場合:**

- VCS プロバイダー判定:
  - `CLAUDE.md` / `AGENTS.md` に VCS 記述がある場合はそれを採用（例: `VCS: GitLab (host) — use glab`）
  - 記述がなければ `git remote get-url origin` を実行し、ホスト名から判定:
    - `github.com` を含む → GitHub（`gh` を使用）
    - その他（`gitlab.*` 等、self-hosted 含む）→ GitLab（`glab` を使用）
- VCS に応じて Issue 情報を取得:
  - GitHub: `gh issue view {number}`
  - GitLab: `glab issue view {number} --output json`
- Issue body のタスクチェックリストを確認

### 3. ステート更新

```markdown
## Current Step

- step: plan-task
- substep: 計画作成中
- next: ユーザー承認 → 実装開始
```

### 4. PlanMode起動

`EnterPlanMode` を実行し、以下を含む計画を作成する:

- **ステート情報**: ワークフロー種別、スペック/イシュー、フェーズ/タスク
- **ワークツリーパス**: 作業先ディレクトリ
- **対象タスクの完了条件**: tasks.md から抽出
- **設計方針**: design.md から関連部分を抽出
- **新規外部依存の確認**: 実装で新規ライブラリを使用する場合、以下を確認する
  - プロジェクトのパッケージマネージャーを検出する（`package-lock.json` → npm、`yarn.lock` → yarn、`pnpm-lock.yaml` → pnpm、`bun.lockb` → bun、`requirements.txt`/`pyproject.toml` → pip/poetry、`go.mod` → go modules 等）
  - 対象パッケージの依存定義ファイル（`package.json`、`pyproject.toml`、`go.mod` 等）に既存依存として含まれているか
  - 含まれていない場合、既存依存との peer dependency 競合や互換性の問題がないか
  - インストール時にメジャーバージョン指定が必要か（最新が既存依存と非互換の場合）
  - Context7 MCP で対象ライブラリの最新ドキュメントを参照し、互換性情報を確認する
- **前提条件の実態検証**: 計画に含める各変更について、その前提条件がプロジェクトの実態と合致しているか検証する
  - 対象機能・設定がプロジェクトで実際に使用されているか（git log、設定ファイル、コード検索で確認）
  - 「使っていない機能への対応」は計画から除外する
  - 検証結果を計画内に明記する（例: 「Draft PR は未使用のためスキップ条件追加は不要」）
- **実装ステップ**: 具体的な作業手順
- **テスト方針**: テストサイクルの計画（TDD、手動検証等、プロジェクトの方針に準拠）
- **最後のステップ**: `/pr` での PR作成を含める

### 5. 計画承認後

PlanMode承認後、ステートを更新:

```markdown
## Current Step

- step: implementation
- substep: 実装中
- next: 完了後 /pr を実行
```

## エラーハンドリング

- ステートファイルも引数もない場合: エラー報告、ワークツリー作成の実行を提案
- スペックディレクトリが見つからない場合: エラー報告
- tasks.md / design.md が見つからない場合: 見つかるドキュメントのみで計画作成、不足を報告
