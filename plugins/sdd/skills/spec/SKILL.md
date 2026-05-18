---
name: spec
description: 仕様駆動開発（SDD）フレームワークに基づいてBlueprint・ブループリント・Spec・スペック生成を支援。SDD、仕様駆動開発プロセス、Blueprint作成、ブループリント作成、Spec作成、スペック作成、外部依存・ユーザー手動作業・secret管理を含む事前調査、レビューサイクル管理など、仕様駆動開発の全プロセスをガイド。「ブループリント作って」「スペック作って」「スペック作成して」「スペック生成して」「requirements作って」等のリクエストに対応。
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent
---

# 仕様駆動開発（SDD）Skill

## 概要

このSkillは、仕様駆動開発（Spec-Driven Development, SDD）の全プロセスをClaude Code / Codex上で支援する。

フレームワーク（ワークフロー定義・テンプレート）はプラグインの `templates/` に同梱されている。
プロジェクト固有のステアリングは `spec/_custom/steering/` に配置し、テンプレートは `spec/_custom/` でオーバーライドできる。

## Runtime互換

- Claude Code: `/sdd:*` custom command と plugin skill として動作する。
- Codex: `.codex-plugin/plugin.json` から読み込まれる skill として動作し、Claude command 相当の操作は `skills/*/SKILL.md` のwrapperが `commands/*.md` を読む。
- 共有本体はこのプラグインディレクトリに置き、runtime差分はcommandまたはwrapper skillで吸収する。

## 前提条件

SDDフレームワークがプロジェクトにセットアップ済みであること。未セットアップの場合は `/sdd:init`（Claude Code）または `init` skill（Codex）を先に実行する。

```
必要な構造:
├── .claude/plugins/sdd/templates/    # プラグインデフォルト（ソースオブトゥルース）
│   ├── framework/
│   │   ├── workflow.md               # ワークフロー定義
│   │   └── prompt.md                 # Spec生成システムプロンプト
│   └── (テンプレート群)
├── plugins/sdd/templates/            # Codexローカルpluginとして使う場合の同梱テンプレート
└── spec/_custom/                     # プロジェクト固有設定
    ├── steering/                     # ステアリング（必須）
    │   ├── project.md                # プロダクト概要・ビジョン
    │   ├── structure.md              # プロジェクト構造
    │   └── tech.md                   # テックスタック
    └── templates/                    # テンプレートオーバーライド（オプション）
```

## テンプレート解決ルール

テンプレートやフレームワークドキュメントを参照する際は、以下の優先順位で解決する:

### フレームワークドキュメント（workflow.md, prompt.md）

1. `spec/_custom/{filename}` が存在する場合 → そちらを使用
2. 存在しない場合 → プラグイン同梱 `templates/framework/{filename}` を使用
   - Claude Code: `.claude/plugins/sdd/templates/framework/{filename}`
   - Codex/local checkout: `plugins/sdd/templates/framework/{filename}` または skill からの相対 `../../templates/framework/{filename}`

### テンプレート（spec-\*.md, blueprint-\*.md）

1. `spec/_custom/templates/{filename}` が存在する場合 → そちらを使用
2. 存在しない場合 → プラグイン同梱 `templates/{filename}` を使用

### ステアリング

`spec/_custom/steering/` を直接参照する（フォールバックなし）。

## 必須参照ドキュメント

SDDプロセスを開始する前に、以下を必ず参照すること。

### フレームワークドキュメント（必読）

1. **workflow.md** — 配置ルール、採番、承認フロー、生成手順（テンプレート解決ルールに従い取得）
2. **prompt.md** — Spec生成システムプロンプト（同上）

### ステアリングファイル（必読・プロジェクト固有）

- **spec/\_custom/steering/project.md** — プロジェクト概要・方針
- **spec/\_custom/steering/structure.md** — プロジェクト構造
- **spec/\_custom/steering/tech.md** — テックスタック
- 追加ファイルがあれば `spec/_custom/steering/` 内の全 `.md` を参照

### テンプレート

テンプレート解決ルールに従い取得:

- Blueprint: `blueprint-overview.md`, `blueprint-architecture.md`, `blueprint-scope-template.md`
- Spec: `spec-requirements-template.md`, `spec-design-template.md`, `spec-tasks-template.md`

### 動的参照

作業内容に応じてプロジェクトの `docs/` 配下から関連ドキュメントを検索・参照:

- Blueprint生成 → structure.md, tech.md 重視
- Requirements生成 → project.md 重視。加えて、下記「手動作業プレフライト」を必ず実施し、AIが実行できない作業を requirements.md に明記する
- Design生成 → tech.md, API仕様 重視。加えて、設計書の「コンポーネントとインターフェース」セクションで参照する既存コードについて、現行の型定義・シグネチャを読み込んで設計書の記述と整合させること。新規作成するものはこの限りではない
- Tasks生成 → 実装ガイド、Git workflow 重視

```bash
# 例: API設計時
Grep -pattern "API|エンドポイント|REST" docs/

# 例: セキュリティ考慮時
Glob "docs/**/*security*.md"
```

## 手動作業プレフライト

Spec生成時は、対象Scopeを実装するうえでユーザーの手動作業が必要かを必ず調査する。憶測で「既にセットアップ済み」「一般的に存在するはず」と扱ってはならない。

### 調査対象

以下をプロジェクトごとに確認し、該当しないものは「該当なし」と判断した根拠を残す:

- リポジトリ構成: env template、secret管理、CI/CD、IaC、deploy設定、package manager、mobile/native設定、DB migration、docs/runbook
- 外部サービス: サインアップ、組織/ワークスペース招待、課金/plan有効化、API key/token発行、OAuth app、webhook、DNS/domain/TLS、メール/SMS、決済、LLM provider、analytics、observability、feature flag、storage/queue/search
- クラウド/権限: IAM role、service account、Access policy、OIDC連携、環境別secret、runtime config、preview/production resource作成
- ローカル/配布: OS権限、証明書、Apple/Google developer設定、push通知証明書、TestFlight/Play Console、ローカルkeychain、手動QA端末
- データ/運用: 本番データexport/import、既存ユーザー影響確認、migration apply承認、backfill承認、監査ログ確認、manual purge、法務/セキュリティ承認

### 出力ルール

- requirements.md: 手動作業を要件または制約として明記し、owner role、必要権限、secret/config名、成功条件、blocked AC/test、未完了時の扱いを示す
- design.md: 手動作業に依存する設計境界、fail-closed/fallback、secret保存先、検証方法、AIが実行しない操作を明記する
- tasks.md: repo内実装と外部依存を分離する。必要なら `External Track 0` を作り、手動作業を implementation task の hard dependency にしない
- 手動作業が不要と判断した場合も、確認した根拠と「追加手動作業なし」を該当セクションに短く記録する
- secret値、token実値、credential、個人情報、dashboard screenshotのraw値はSpec、PR、logs、tests、`.tmp` に保存しない

## レビュー/フィードバックループ

Specドキュメントのレビューは runtime に応じて同じ review workflow で実行する。

```
# Claude Code
/sdd:spec-review requirements
/sdd:spec-review design
/sdd:spec-review tasks

# Codex
spec-review requirements
spec-review design
spec-review tasks
```

`spec-review` workflow はコンテキストチェーン構築、レビュー、トリアージまで自動実行する。
レビュー修正ループの詳細は `workflow.md` の「レビュー/フィードバックループ」セクションを参照。

> レビューログのフォーマットは `workflow.md` の「レビュー/フィードバックループ」セクションに定義。

## 実行規約

### 必須事項

1. **ワークツリー必須**: Spec生成は必ずワークツリー内で作業する。`/sdd:create-worktree sdd B{nn}-S{nn}`（Claude Code）または `create-worktree sdd B{nn}-S{nn}`（Codex）でワークツリーを作成してから開始する。すべてのファイル操作はワークツリーパス（`.worktrees/{worktree-name}/...`）で行うこと
2. **事前読込**: `spec/_custom/steering/` の必須ファイルと `workflow.md` を必ず参照（テンプレート解決ルールに従う）
3. **動的参照**: タスクに応じてプロジェクトの `docs/` から関連ドキュメントを検索・参照
4. **手動作業プレフライト**: Requirements生成前に、ユーザー手動作業・外部依存・secret管理・権限・live verificationの必要性を調査し、各Spec文書へ反映する
5. **順序遵守**: Requirements → Design → Tasks の順で生成
6. **承認チェック**: 前段階の承認なしに次段階に進まない
7. **タスク完了の表記**: タスク実行時、完了済みタスクには ✅ を付与する
8. **計画承認ゲート必須（ドラフト生成・修正の両方）**: Specドキュメントの生成・修正を行う前に必ず計画を作成し、ユーザー承認を得てから実行する。Claude Codeでは `EnterPlanMode` を使い、Codexでは通常応答で計画を提示して明示承認を待つ。詳細は下記「計画承認ゲート」セクションを参照
9. **都度コミット**: Spec文書の生成・修正・レビューログ記録など、ファイルに変更が生じたら都度コミットする（ワークツリー内で `git -C {worktree}` を使用）
10. **完了後の統合**: Tasks 承認後、PRを作成し、内容レビューではなく統合前チェックを実行してからマージ → ワークツリークリーンアップの流れで統合する。プロジェクトにPR/チェック/マージ用のコマンドがあればそれを使用し、なければ `/sdd:cleanup-worktree`（Claude Code）または `cleanup-worktree` skill（Codex）でクリーンアップする

### 計画承認ゲート

Specドキュメントへの書き込み（新規生成・修正いずれも）は、以下の3段階を必ず経由する:

```
Step 0: [ASK] で承認を得る（「{stage}の生成計画を作成しましょうか？(y/n)」）
Step 1: 計画を作成
        - Claude Code: EnterPlanMode を使う
        - Codex: 通常応答で計画を提示し、明示承認を待つ
        - ドラフト生成時: 何を書くか（構成・要点・参照元）の計画
        - レビュー修正時: どの指摘をどう修正するかの計画
Step 2: ユーザーが計画を承認
Step 3: 承認された計画に従って実行（ここで初めてファイルに書き込む）
```

**適用対象**: requirements.md / design.md / tasks.md の新規生成および修正
**適用外**: レビューログ（artifacts/REVIEW-\*.md）への追記、コミット操作

> **なぜこのゲートが必要か**: 計画承認を経ずにドキュメントを直接書き始めると、方向性のズレに気づくのが遅れる。計画段階でユーザーと合意することで、手戻りを最小化する。

### 禁止事項

- 承認前の次段階生成
- 上流未参照の下流生成
- 必須ドキュメントの読み飛ばし
- 手動作業プレフライトを省略した requirements.md / design.md / tasks.md 生成
- サインアップ、token発行、secret登録、dashboard設定、課金有効化、権限付与、live本番操作をAIが実施済みと推測すること
- 作業ブランチ/ワークツリー準備は tasks.md に含めない（運用ガイドで管理）
- **計画承認無しでのドキュメント書き込み禁止**: 計画提示 → ユーザー承認を経ずに requirements.md / design.md / tasks.md への書き込み（新規生成・修正）を行ってはならない

## トラブルシューティング

### ステアリングファイル不足

`spec/_custom/steering/` の必須ファイル（project.md, structure.md, tech.md）が存在しない場合:

1. エラーを報告し、期待される内容を提示
2. プロジェクト内で代替となるドキュメントがないか検索
3. 続行可否をユーザーに確認
4. `/sdd:init` の実行を提案

### 承認前進行エラー

前段階未承認で次段階の生成を試みた場合:

1. エラーメッセージを表示し、承認プロセスを説明
2. ユーザー承認を待機
