---
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(codex:*), Agent
argument-hint: <対象種別> [--fresh]
description: スペックドキュメントレビュー（Codex統合・トリアージ自動実行）
---

# spec-review

スペックドキュメントを独立レビュアー経路でレビューし、トリアージまで自動実行するworkflow。

## 使用方法

```
/sdd:spec-review <対象種別>
/sdd:spec-review <対象種別> --fresh   # フレッシュレビュー（初回同等）

# Codexでは spec-review skill から同じworkflowを実行する
spec-review <対象種別>
```

## 引数

- **$1**: 対象種別（`blueprint` / `requirements` / `design` / `tasks`）
- **--fresh**: フレッシュレビューモード（省略時は通常レビュー）

## 事前参照

- `workflow.md`（テンプレート解決ルール: `spec/_custom/workflow.md` → plugin bundled `templates/framework/workflow.md`） — レビュー観点・ログフォーマット・レビュー修正ループ定義
- Codex実行時は `skills/spec-review/SKILL.md` wrapper を入口にし、このcommand本文を正本として読む

## 実行フロー

### 1. ステートファイル読み込み

ワークツリー内の `.tmp/workflow-state.md` を読み込み、現在のコンテキストを確認する。

- Context セクションからスペック情報、対象ファイルパスを取得
- ステートファイルがない場合: 引数とスペックディレクトリから情報を構築

### 2. コンテキストチェーン構築

レビュー対象に応じて上流ドキュメントを積み上げる:

| レビュー対象 | コンテキスト（上流から順）                                 | レビュー観点                                     |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------ |
| blueprint    | ステアリングファイル群                                     | スコープ分割の粒度、記載の充足度                 |
| requirements | overview.md → architecture.md → scope.md                   | スコープとの整合性、要件網羅性、ACの明確さ       |
| design       | 上記 + requirements.md + REVIEW-REQUIREMENTS.md の Defer:D | 要件との整合性、実装可能性、アーキテクチャ適合性 |
| tasks        | 上記 + design.md + REVIEW-DESIGN.md の Defer:T             | 設計との整合性、タスク粒度、規模ガード遵守       |

### 3. レビュースコープ制限

各ドキュメントのレビューは**そのレイヤーの責務のみ**を対象とする:

**requirements.md**:

- ✅ スコープ定義との機能網羅、ユーザーストーリーの妥当性、ACの計測可能性
- ✅ 手動作業プレフライトの反映。外部依存、ユーザー手動作業、secret/config、owner role、必要権限、成功条件、blocked AC/test、未完了時の扱いが要件粒度で明確か
- ❌ 実装方式 → `[Defer:D]`、テスト実装の詳細 → `[Defer:T]`

**design.md**:

- ✅ 要件との整合性、アーキテクチャ適合性、インターフェース設計
- ✅ 手動作業に依存する設計境界。secret保存先、認可、fail-closed/fallback、live verification、AIが未承認で実行しない操作が設計に落ちているか
- ❌ タスク粒度・実装手順 → `[Defer:T]`

**tasks.md**:

- ✅ 設計との整合性、タスク粒度・依存関係、規模ガード遵守
- ✅ repo内実装と外部依存トラックの分離。手動作業が implementation task に混ざっていないか、mock/fixtureで進める範囲とlive verificationでblockedになる範囲が分かれているか

### 4. レビュー実行

実行環境に応じて独立レビュアー経路を切り替える。

#### 4.1 Claude Code実行時

**実行方法**: プロジェクトで利用可能なCodex CLI helper、または直接 `codex exec` を使用し、外部Codex CLIにレビューを委譲する。Claude Code の `Agent` ツールでレビュー用サブエージェントを起動しない。

**独立性の目的**: 親エージェントから独立したCodexレビューを使い、実装者の見落としとruntime固有の偏りを減らす。artifactには `<!-- Reviewed by: Codex CLI -->` を該当 `Review NN` block 内に記録し、最新レビューでは `Status: latest` のblockに置く。

**モデル指定禁止**: `-m` フラグは渡さない。`~/.codex/config.toml` のデフォルトモデルに委ねる。

**プロンプトの渡し方**: レビュープロンプトは `#` 見出しを含む複数行のため、`Write` ツールで一時ファイル（`.tmp/codex-prompt.md`）に書き出し、stdin経由で `codex exec` に渡す。

```bash
codex --ask-for-approval never exec --sandbox read-only -o .tmp/codex-review-result.md - < .tmp/codex-prompt.md
```

#### 4.2 Codex実行時

**実行方法**: 外部 `codex exec` をネスト起動しない。Codex runtime が提供するnative sub-agent/delegation機能を標準経路として起動し、観点別にレビューする。これはプラグインmanifestでpackagingする専用agentではなく、Codex親セッション側で利用できる実行機能を使う。

**親エージェント単独レビューの扱い**: 親エージェント単独レビューは通常経路ではない。sub-agent起動機能が存在しない、runtime policy、tool failure、その他の技術的制約で実行できない場合に限り、理由を明示してユーザー承認を得てから parent-agent emergency fallback として実施できる。その場合 `Codex sub-agents` marker は使わない。

**emergency fallback確認文**:

```
標準の独立レビュー経路（Codex sub-agent review）が {理由} により実行できません。
独立レビュワー分離がない parent-agent emergency fallback として `spec-review {対象種別}` を実行しましょうか？(y/n)
```

**並列レビュー観点**:

| 対象         | Reviewer A                 | Reviewer B                       | Reviewer C                         |
| ------------ | -------------------------- | -------------------------------- | ---------------------------------- |
| blueprint    | SDD / Blueprint整合性      | Security / secret / logging      | Scope split / issue handoff        |
| requirements | Scope / AC completeness    | Security / privacy / data policy | Agent ready / verification         |
| design       | Architecture feasibility   | Security / auth / logging        | API / data / runtime fit           |
| tasks        | Task decomposition         | Validation / CI / test coverage  | Dependency / external verification |

**統合方法**:

1. 各sub-agentには同じコンテキストチェーン、レビュー対象、分類ルール、出力フォーマットを渡す。
2. 各sub-agentのraw resultを `.tmp/spec-review-{target}-r{round}-{view}.md` に保存する。
3. 親エージェントが結果を重複排除し、重大度を揃える。
4. artifactには `<!-- Reviewed by: Codex sub-agents -->` を該当 `Review NN` block 内に記録し、最新レビューでは `Status: latest` のblockに置く。
5. artifactまたはtriageに reviewer count、agent IDs（取得できる場合）、観点名、raw result file path を記録する。

#### 初回 / フレッシュレビュープロンプト

```
あなたはSpec文書のレビュアーです。以下のルールに厳密に従い、指摘事項を出力してください。

## コンテキスト（上流ドキュメント）
{コンテキストチェーンに基づき配置}

## レビュー対象
{レビュー対象ファイルの内容}

## レビュースコープ（厳守）
{ドキュメント種別スコープ制限}

## レビュー観点
{コンテキストチェーンテーブルに対応するレビュー観点}

## 手動作業・外部依存レビュー観点
- サインアップ、課金/plan、API token、OAuth app、webhook、DNS/TLS、cloud resource、IAM/service account、CI/CD secret、runtime secret、developer account、証明書、push通知、DB migration、backfill、manual purge、production operation、法務/セキュリティ承認など、AIが物理的に実行できない作業の洗い出し漏れがないか確認する。
- 必要な手動作業には owner role、必要権限、secret/config/template名、成功条件、blocked AC/test/task、未完了時の扱い、fallback/fail-closed があるか確認する。
- 手動作業が不要とされている場合は、確認した情報源と根拠が十分か確認する。
- secret値、token実値、credential、個人情報、dashboard screenshotのraw値が記録されていないか確認する。

## 指摘の分類
- [Must-Fix]: このドキュメントで直さないと次工程がブロックされる
- [Defer:D]: 設計フェーズで対処すべき
- [Defer:T]: タスクフェーズで対処すべき
- [New-Finding]: 再レビュー時のみ。前回から変更されていない箇所への新規発見
- [Low]: あれば良い程度

## 出力フォーマット
指摘がない、または [Defer] と [Low] と [New-Finding] のみの場合:
「収束しました。承認フローへ進んでください。」と出力して終了。
それ以外: 指摘を重大度順で出力。
```

#### 再レビュープロンプト（`--fresh` なし）

初回プロンプトに以下を追加:

```
## 前回レビューの指摘と修正内容
{REVIEW-*.md の前回指摘 + 修正内容}

## 再レビュー時の追加ルール（厳守）
1. 前回の Must-Fix 指摘が解決されているか確認
2. 修正によるデグレがないか確認
3. 前回から変更されていない箇所への新規指摘は [New-Finding] タグを付与
```

#### レビュー実行失敗時のフォールバック

外部Codex CLIまたはCodex-native sub-agent reviewが失敗した場合:

1. エラー内容をユーザーに報告
2. 標準の独立レビュー経路を再実行できない理由を明示
3. parent-agent emergency fallbackで進める許可をユーザーに確認
4. 許可された場合のみ、同じレビュープロンプトを使用して親エージェントが直接レビューを実施
5. レビュー結果は通常レビューと同じフォーマットで出力
6. レビュー結果の該当 `Review NN` block 内に `<!-- Reviewed by: Parent agent emergency fallback; user-approved -->` コメントを付与し、独立レビュワー分離がないことを記録

### 5. レビュー結果出力

レビュー結果を `artifacts/REVIEW-{TARGET}.md` に出力し、コミットする。最新 `Review NN` block には実行経路に応じた reviewer marker を必ず入れる:

- `<!-- Reviewed by: Codex CLI -->`
- `<!-- Reviewed by: Codex sub-agents -->`
- `<!-- Reviewed by: Parent agent emergency fallback; user-approved -->`

### 6. トリアージ

レビュー結果を自動トリアージ:

- `workflow.md`（テンプレート解決ルール参照）のレビュー修正ループ手順に従う
- 結果を `.tmp/triage-spec-{spec}-{target}-r{round}.md` に書き出し
- parent-agent emergency fallback を使った場合は、artifactとtriageにユーザー承認済みfallbackであることを明記する

### 7. スコープ外追記

トリアージで Defer:スコープ外 が検出された場合:

- `workflow.md`（テンプレート解決ルール参照）のレビュー修正ループ手順に従い tasks.md に追記

### 8. ステート更新

```markdown
## Current Step

- step: review-fix-loop
- substep: 6.1 トリアージ完了
- next: Fix修正 or 収束

## Review Cycle

- round: {N} / 2
- type: normal / fresh
- artifact: {REVIEW-\*.md パス}
```

### 9. サマリー報告

トリアージ結果をユーザーに報告:

```
📍 {スペック} > {対象種別} レビュー > サイクル {N}

レビュー結果:
- Must-Fix: X件
- Defer: Y件
- Low: Z件

トリアージ結果:
- Fix: A件
- Dismiss: B件
- Defer:スコープ外: C件

{Fix > 0 の場合}
→ 修正計画を作成して修正に進みましょうか？(y/n)

{Fix = 0 の場合}
→ 収束しました。承認フローへ進みましょうか？(y/n)
```

マージ提案はしない（ワークフローの進行状況に依存するため）。
