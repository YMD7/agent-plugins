---
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(codex:*), Agent
argument-hint: <対象種別> [--fresh]
description: スペックドキュメントレビュー（Codex統合・トリアージ自動実行）
---

# spec-review

スペックドキュメントをCodexでレビューし、トリアージまで自動実行するコマンド。

## 使用方法

```
/sdd:spec-review <対象種別>
/sdd:spec-review <対象種別> --fresh   # フレッシュレビュー（初回同等）
```

## 引数

- **$1**: 対象種別（`blueprint` / `requirements` / `design` / `tasks`）
- **--fresh**: フレッシュレビューモード（省略時は通常レビュー）

## 事前参照

- `workflow.md`（テンプレート解決ルール: `spec/_custom/workflow.md` → `.claude/plugins/sdd/templates/framework/workflow.md`） — レビュー観点・ログフォーマット・レビュー修正ループ定義

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

### 4. Codex レビュー実行

**実行方法**: `/codex` スキル（`Skill` ツール）を使用する。`Agent` ツールのサブエージェントとして実行しない。

**プロンプトの渡し方**: レビュープロンプトは `#` 見出しを含む複数行のため、`Write` ツールで一時ファイル（`.tmp/codex-prompt.md`）に書き出し、`cat ... | codex exec ... -` で stdin 経由で渡す（`/codex` スキルの「複数行プロンプトの渡し方」参照）。

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

#### Codex CLI 失敗時のフォールバック

Codex CLI がエラーで失敗した場合（モデル非対応、認証エラー等）:

1. エラー内容をユーザーに報告
2. 同じレビュープロンプトを使用して、親エージェント（Claude）が直接レビューを実施
3. レビュー結果は Codex 実行時と同じフォーマットで出力
4. レビュー結果の冒頭に `<!-- Reviewed by: Claude (Codex fallback) -->` コメントを付与し、レビュアーを記録

### 5. レビュー結果出力

レビュー結果を `artifacts/REVIEW-{TARGET}.md` に出力し、コミットする。

### 6. トリアージ（サブエージェント）

レビュー結果を自動トリアージ:

- `workflow.md`（テンプレート解決ルール参照）のレビュー修正ループ手順に従う
- 結果を `.tmp/triage-spec-{spec}-{target}-r{round}.md` に書き出し

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
