# 仕様生成ワークフロー

このドキュメントは仕様生成の進め方を定義します。プロジェクト固有の前提・規約は `spec/_custom/steering/` を参照してください。

## 配置と参照

- 上流仕様（Blueprint / ブループリント）
  - ルート: `spec/blueprints/`
  - 単位: `{nn}-{slug}/`
    - `overview.md`（プロジェクト全体像）
    - `architecture.md`（技術アーキテクチャ）
    - `scopes/` フォルダに開発スコープ分割（`{nn}-{slug}.md`）
  - **連番ルール**: `spec/_archive/blueprints/` を含めた全Blueprintの最大番号 + 1 を使用
    - 例: `_archive` に `01-zendesk-rag` があり、`blueprints` に `02-cs-agent` がある場合、次は `03-xxx` から開始
- 下流成果物（Specification / 仕様）
  - ルート: `spec/specs/B{nn}-S{nn}-{slug}/`
  - コアファイル: `requirements.md` → `design.md` → `tasks.md`
  - 検証用SQL: `verification.sql`（必要に応じて）
  - 作業ログ: `logs/` サブディレクトリ（実装時に使用）
  - **採番ルール**: `B{blueprint番号}-S{scope番号}` を使用。scope番号はBlueprintの `scopes/{nn}-*.md` の番号に対応
    - 例: Blueprint 02 の Scope S1 → `B02-S01-sidebar-layout`
- ステアリング（プロジェクト固有の規約）
  - ルート: `spec/_custom/steering/`
  - 必須ファイル:
    - `project.md`: プロジェクト/プロダクトの目的・基本情報
    - `structure.md`: 設計・技術の構成や構造
    - `tech.md`: テックスタック・技術選定の説明
  - 任意ファイル:
    - `workflow.md`: プロジェクト固有のワークフロー・ルール
- テンプレート
  - テンプレート解決ルールに従い、`spec/_custom/templates/` → plugin bundled `templates/` の順で参照
  - Blueprint用: `blueprint-overview.md`, `blueprint-architecture.md`
  - Scope用: `blueprint-scope-template.md`
  - Spec用: `spec-requirements-template.md`, `spec-design-template.md`, `spec-tasks-template.md`

## ドキュメントの読み手と記述粒度

各ドキュメントが想定する読み手と記述粒度を以下に定義します。ドキュメント生成時はこの定義を参照し、対象読み手にとって理解しやすい粒度・抽象度で記述してください。

| 層 | Primary audience | Secondary audience | 記述粒度 |
|---|---|---|---|
| `blueprint/overview.md` | ビジネス | エンジニア | ブループリントの位置づけ・対応 scope 一覧・docs 参照 |
| `blueprint/architecture.md` | エンジニア | ビジネス | 技術アーキテクチャの俯瞰 |
| `blueprint/scopes/*.md` | ビジネス | エンジニア | In/Out、I/F 概要、AC、テスト観点（WHAT 粒度） |
| `spec/requirements.md` | エンジニア | ビジネス | ユーザーストーリー、詳細 AC、NFR、リスク（HOW の手前） |
| `spec/design.md` | エンジニア | — | 技術設計・実装判断 |
| `spec/tasks.md` | エンジニア | — | 実装タスク分解 |

### 記述粒度に関する補足

- **技術用語の使用**: ビジネスを Primary audience とするドキュメント（blueprint 系）でも、技術用語・英語フィールド名の使用は妨げません。テック企業のビジネスサイドは技術リテラシーを持つ前提で書きます
- **境界の軸**: blueprint と spec の境界は「用語の平易さ」ではなく **HOW の解像度** です。blueprint は WHAT と HOW の概観まで、spec は HOW の詳細まで踏み込みます
- **省略しすぎない**: Primary が誰であっても、Secondary audience が概観を理解できる程度の情報量は保ちます。極端な簡略化は避けてください

## ステアリングファイルの設置

ステアリングファイルは、Spec 生成時に AI が参照するプロジェクト固有の情報を定義します。
これらのファイルを `spec/_custom/steering/` に配置することで、AI はプロジェクトの文脈を理解し、適切な仕様を生成できます。

### 基盤ステアリングファイル（必須）

プロジェクトの基盤となる3つのファイルを必ず作成してください。これらは Blueprint や Spec 生成時に常に参照され、AI のプロジェクト理解のベースラインを形成します。

#### project.md — プロジェクト概要

プロジェクト/プロダクトの目的、ターゲットユーザー、主要機能、ビジネス目標を定義します。

**記載内容:**

- プロジェクト名・目的・ゴール
- 想定ユーザー・組織体制
- プロジェクトの性質（開発 or 運用 or 分析など）
- AI支援の方針・制約条件

**効果:** AI が技術的決定の「理由」を理解し、プロダクトゴールに沿った提案を行えるようになります。

#### tech.md — テックスタック

採用しているフレームワーク、ライブラリ、開発ツール、技術的制約を文書化します。

**記載内容:**

- 技術スタック一覧（レイヤー別）
- 技術選定理由・制約事項
- 開発・運用ツール
- 今後の技術導入計画

**効果:** AI が実装を提案する際、確立された技術スタックを優先し、代替案よりもプロジェクトに適した解決策を提示します。

#### structure.md — プロジェクト構造

ファイル構成、命名規則、インポートパターン、アーキテクチャ上の決定事項を説明します。

**記載内容:**

- ディレクトリ構造・ファイル配置ルール
- データアーキテクチャ（レイヤー構造など）
- 設計原則・命名規則
- ドキュメント管理・開発フロー

**効果:** 生成されるコードや仕様が既存のコードベースにシームレスに統合され、一貫性が保たれます。

---

### 追加ステアリングファイル（任意）

プロジェクト固有のルールや専門知識を追加ファイルとして作成できます。

#### workflow.md — 開発ワークフロー

プロジェクト固有の開発フロー、レビュールール、デプロイ手順、承認プロセスなど。

#### その他の例

- `api-conventions.md`: API設計規約
- `testing-strategy.md`: テスト戦略・方針
- `security-guidelines.md`: セキュリティガイドライン
- `performance-requirements.md`: パフォーマンス要件

---

### ステアリングファイルの活用

**Blueprint 生成時:**

- AI はステアリングファイルを読み込み、プロジェクトの前提条件を理解した上で、overview.md、architecture.md、scopes を生成します。

**Spec 生成時:**

- Requirements、Design、Tasks の各フェーズで、ステアリングファイルの内容を反映し、プロジェクトの技術スタックや構造に沿った仕様を生成します。

**推奨:** ステアリングファイルはプロジェクトの進化に合わせて継続的に更新してください。技術スタックの変更、新しい設計原則の追加などがあれば、速やかに反映することで AI の提案精度が向上します。

---

## 承認フロー

Specification（仕様）生成では段階的な承認フローを採用します：

1. **Requirements 生成**: AIがrequirements.mdを生成
2. **ユーザーレビュー**: 内容確認・修正依頼・承認
3. **Design 生成**: Requirements承認後にdesign.mdを生成
4. **ユーザーレビュー**: 内容確認・修正依頼・承認
5. **Tasks 生成**: Design承認後にtasks.mdを生成
6. **ユーザーレビュー**: 内容確認・承認

**重要**: AIは前段階のユーザー承認なしに次段階の生成を開始してはならない。

## レビュー/フィードバックループ

仕様生成では、自動レビュー（AIエージェント）と人間レビューを組み合わせた反復的なフィードバックループを採用します。

### レビューフロー

1. **AI生成**: requirements.md / design.md / tasks.md を生成
2. **自動レビュー（Review 01）**: AIレビューエージェント（Codex等）による指摘抽出
3. **修正反映（Revision 01）**: AIが Review 01 の指摘に基づき修正を実施
4. **再レビュー（Review 02）**: 修正内容を再度レビュー（必要に応じて Revision 02, Review 03...と継続）
5. **人間承認**: ユーザーが最終確認し、次段階に進む

### レビュー/フィードバックログの運用

レビューと修正の往復は、対象Specディレクトリ内の `artifacts/` に記録する。

**ファイル命名:**

- requirements.md → `artifacts/REVIEW-REQUIREMENTS.md`
- design.md → `artifacts/REVIEW-DESIGN.md`
- tasks.md → `artifacts/REVIEW-TASKS.md`

**ルール:**

- requirements.md / design.md / tasks.md は、それぞれ対応するレビュー用ファイルに時系列で追記する
- 同一ドキュメントのレビューは連番で付与する（Review 01, 02, 03...）
- 最新レビューには「Status: latest」を付ける
- 全Review blockには実行経路を示す reviewer marker を `Review NN` block 内に付ける。特に `Status: latest` のReview blockでは必須:
  - `<!-- Reviewed by: Codex CLI -->`
  - `<!-- Reviewed by: Codex sub-agents -->`
  - `<!-- Reviewed by: Parent agent emergency fallback; user-approved -->`
- **修正内容の記録**: 各レビューに対する修正は、そのレビューのセクション内に「Revision 01, 02...」として追記する
- **Review と Revision の対応**: Review 01 → Revision 01, Review 02 → Revision 02 のように、必ず連番を対応させる（Review 02 に対して Revision 01 とするのは誤り）

**記録構造:**

```
## YYYY-MM-DD {対象} Review 01
Status: superseded（次のReviewがある場合）/ latest（最新の場合）
<!-- Reviewed by: Codex CLI / Codex sub-agents / Parent agent emergency fallback; user-approved -->

### 対象
- ファイルパス

### 指摘（重大度順）
1. [High] ...
2. [Medium] ...

### 確認事項
- ...

### Revision 01
実施日: YYYY-MM-DD

#### 修正内容
1. [High] ... ✅
   - 修正箇所: ...
   - 修正内容: ...

2. [Medium] ... ✅
   - 修正箇所: ...
   - 修正内容: ...

#### 確認事項への回答
- ...

#### 残課題
- ...

## YYYY-MM-DD {対象} Review 02
Status: latest
<!-- Reviewed by: Codex CLI / Codex sub-agents / Parent agent emergency fallback; user-approved -->

### 対象
- ファイルパス

### 指摘（重大度順）
1. [Medium] ...

### Revision 02
実施日: YYYY-MM-DD

#### 修正内容
1. [Medium] ... ✅
   - 修正箇所: ...
   - 修正内容: ...

#### 残課題
- ...
```

**重要**: Review 番号と Revision 番号は必ず対応させること（Review 01 → Revision 01, Review 02 → Revision 02）

**記録内容:**

- レビュー対象ファイル
- 指摘事項（重大度・該当箇所・問題・影響・提案）
- 修正内容（各指摘への対応内容・修正箇所・修正後の状態）
- 確認事項への回答

## Blueprint生成フロー

### 1. ナラティブの共有

ユーザーが「やりたいこと」「実現したい価値」を自然言語でAIに語る。

- AIは深堀り質問・壁打ち・アイデア出しで支援
- 技術スタック・制約条件・既存資産も確認

### 2. Blueprint生成

ユーザー: 「じゃあそれをブループリントにして」

AIが以下を生成:

- `overview.md`: プロジェクト全体像・ドメイン原則・受け入れ基準
- `architecture.md`: 技術アーキテクチャ・コンポーネント・実装順序
- `scopes/{nn}-{slug}.md`: 適切な開発スコープに分割された仕様

生成時はテンプレート解決ルール（`spec/_custom/templates/` → plugin bundled `templates/`）に従い、テンプレートを参考にすること。

### 3. レビュー・修正

- ユーザーがBlueprintをレビュー
- 必要に応じてフィードバック・修正依頼
- スコープの粒度調整（統合・分割・並び替え）

### 4. ADR チェック

- 技術判断が含まれる場合は ADR を作成する（対象となる判断の例は実行規約を参照）
- ADR はADRディレクトリ（プロジェクトの慣例に従う）に配置
- **注意**: ADR の運用はプロジェクトによって任意。ADR を採用していないプロジェクトではこのステップをスキップしてよい

---

## Spec生成手順

### 0. ワークツリー作成

Spec生成はワークツリー内で作業する。ワークツリーの作成には runtime に応じて `/sdd:create-worktree`（Claude Code）または `create-worktree` skill（Codex）を使用する。

```
/sdd:create-worktree sdd B{nn}-S{nn}
# Codex: create-worktree sdd B{nn}-S{nn}
```

- ワークツリー: `.worktrees/sdd-B{nn}-S{nn}-{slug}`
- ブランチ: `sdd/B{nn}-S{nn}-{slug}`
- ステートファイル: `.worktrees/{worktree-name}/.tmp/workflow-state.md`（`workflow: spec-generation`）

**重要**: 以降のすべてのファイル操作（Spec ドキュメントの生成・修正・レビューログ記録）はワークツリー内のパスで行うこと。

### 1. Scope選択

Blueprint内の特定Scopeを選択（例: `scopes/01-user-auth.md`）

### 2. 手動作業プレフライト

Requirements生成前に、対象Scopeの実装でユーザーの手動作業が必要かを調査する。調査結果は Requirements → Design → Tasks の各段階へ引き継ぐ。

- **入力**: 対象Scope + `overview.md` + `architecture.md` + ステアリング + 関連docs/runbook + repo設定
- **出力**: requirements.md / design.md / tasks.md に反映する手動作業・外部依存の整理
- **手順**:
  1. env template、secret管理、CI/CD、IaC、deploy設定、package manager、mobile/native設定、DB migration、docs/runbook、既存scriptを確認する
  2. サインアップ、課金/plan、API token、OAuth app、webhook、DNS/TLS、cloud resource、IAM/service account、environment secret、developer account、証明書、push通知、手動QA、production operationの要否を洗い出す
  3. secret/config名、owner role、必要権限、成功条件、blocked AC/test/task、未完了時の扱い、fallback/fail-closedを整理する
  4. AIが未承認で実行しない操作を明確にする。例: live DB migration、本番deploy、課金変更、token発行、secret値の閲覧/登録、manual purge、dashboard設定、ユーザー影響のあるbackfill
  5. 手動作業が不要な場合も、確認した根拠と「追加手動作業なし」をSpecに残す
- **禁止**: 憶測で「既にセットアップ済み」「通常あるはず」と扱うこと。secret値、token実値、credential、個人情報、dashboard screenshotのraw値をSpecや`.tmp`へ保存すること。

### 3. Requirements 生成

- **入力**: 対象Scope + `overview.md` + `architecture.md` + ステアリング + 手動作業プレフライト結果
- **出力**: `spec/specs/B{nn}-S{nn}-{slug}/requirements.md`
- **手順**:
  1. 「{stage}の生成計画を作成しましょうか？(y/n)」でユーザー承認を得る
  2. 計画承認ゲートで生成計画を作成（Claude Code: `EnterPlanMode` / Codex: 通常応答で計画提示。構成・要点・参照元・手動作業プレフライト結果を提示）
  3. ユーザーが計画を承認
  4. 承認された計画に従って requirements.md を生成
  5. `spec-review` workflow（Claude Code: `/sdd:spec-review requirements` / Codex: `spec-review requirements`）で自動レビューを実行
  6. レビュー修正ループ（指摘がなくなるまで繰り返す。詳細は「レビュー/フィードバックループ」セクション参照）
  7. ユーザーにレビューを依頼し、承認を待つ
- **承認後**: requirements.md の Status を `final` に更新し、コミットする
- **承認条件**: Requirements承認まで次段階に進まない

### 4. Design 生成（Requirements承認後のみ）

- **前提条件**: requirements.mdがユーザー承認済み
- **入力**: `requirements.md` + ステアリング
- **出力**: `spec/specs/B{nn}-S{nn}-{slug}/design.md`
- **手順**:
  1. 「{stage}の生成計画を作成しましょうか？(y/n)」でユーザー承認を得る
  2. 計画承認ゲートで生成計画を作成（Claude Code: `EnterPlanMode` / Codex: 通常応答で計画提示。構成・要点・参照元を提示）
  3. ユーザーが計画を承認
  4. 承認された計画に従って design.md を生成
  5. `spec-review` workflow（Claude Code: `/sdd:spec-review design` / Codex: `spec-review design`）で自動レビューを実行
  6. レビュー修正ループ（指摘がなくなるまで繰り返す。詳細は「レビュー/フィードバックループ」セクション参照）
  7. ユーザーにレビューを依頼し、承認を待つ
- **承認後**: design.md の Status を `final` に更新し、コミットする
- **承認条件**: Design承認まで次段階に進まない

### ADR チェック（Tasks 生成前）

- 技術判断があれば ADR を作成する（対象となる判断の例は実行規約を参照）
- ADR はADRディレクトリ（プロジェクトの慣例に従う）に配置
- **注意**: ADR の運用はプロジェクトによって任意。ADR を採用していないプロジェクトではこのステップをスキップしてよい

### 5. Tasks 生成（Design承認後のみ）

- **前提条件**: design.mdがユーザー承認済み
- **入力**: `design.md` + ステアリング
- **出力**: `spec/specs/B{nn}-S{nn}-{slug}/tasks.md`
- **手順**:
  1. 「{stage}の生成計画を作成しましょうか？(y/n)」でユーザー承認を得る
  2. 計画承認ゲートで生成計画を作成（Claude Code: `EnterPlanMode` / Codex: 通常応答で計画提示。構成・要点・参照元を提示）
  3. ユーザーが計画を承認
  4. 承認された計画に従って tasks.md を生成
  5. `spec-review` workflow（Claude Code: `/sdd:spec-review tasks` / Codex: `spec-review tasks`）で自動レビューを実行
  6. レビュー修正ループ（指摘がなくなるまで繰り返す。詳細は「レビュー/フィードバックループ」セクション参照）
  7. ユーザーにレビューを依頼し、承認を待つ
- **承認後**: tasks.md の Status を `final` に更新し、コミットする

### 6. PR・マージ・クリーンアップ

Tasks 承認後、ワークツリー内のスペックドキュメントをベースブランチにマージする。

1. PRを作成する（プロジェクトのPRワークフローに従う）
2. 統合前チェックを実行する（内容レビューは各Specドキュメントのレビュー修正ループで完了済みとする）
   - PR差分が承認済みのSpec関連ファイルに限定されていることを確認
   - `requirements.md`, `design.md`, `tasks.md` の Status が `final` であることを確認
   - 対応するレビューログが `artifacts/REVIEW-*.md` に記録されていることを確認
   - 最新 `Review NN` block が `Status: latest` で、有効な `Reviewed by` marker を持つことを確認
   - `Parent agent emergency fallback` marker の場合は、ユーザー承認理由が artifact または triage に記録されていることを確認
   - `Codex sub-agents` marker の場合は、reviewer count、観点名、raw result file path が artifact または triage に記録されていることを確認
   - CI / secret scan 等の必須チェックが通ることを確認
   - マージ先ブランチとの衝突がないことを確認
3. 統合前チェックで問題がある場合のみ、必要な修正ループを実行する
4. PRをマージする（プロジェクトのマージワークフローに従う）
5. runtimeに応じて `/sdd:cleanup-worktree`（Claude Code）または `cleanup-worktree` skill（Codex）でワークツリーを削除

### ステップ間の接続

| 完了ステップ               | 次の提案                                                                 |
| -------------------------- | ------------------------------------------------------------------------ |
| 0 (create-worktree)        | → Scope を選択してドキュメント生成に進みましょうか？(y/n)                |
| 2 (手動作業プレフライト)   | → Requirements の生成計画を作成しましょうか？(y/n)                       |
| 5 (tasks.md 承認)          | → PRを作成しましょうか？(y/n)                                            |
| PR マージ後                | → `/sdd:cleanup-worktree {worktree}` でクリーンアップしましょうか？(y/n) |

## 実行規約

- **事前読込**: `prompt.md`（テンプレート解決ルールに従う）と `spec/_custom/steering/*` を必ず参照する。
- **ADR 参照（任意）**: プロジェクトがADRを採用している場合、ADRディレクトリ配下のADRを参照する。過去の技術判断（Go/No-Go 判定等）を把握した上で仕様を生成すること。
- **ADR 作成**: Blueprint 生成・Spec 生成の過程で技術判断（アーキテクチャ方式選定、技術スタック決定、ライブラリ選定、Go/No-Go 判定等）を行った場合は、ADR を作成する。
- **開発ドキュメント参照**: 作業開始時にプロジェクトの開発ドキュメントを一覧し、関係がありそうな内容を必ず参照する。
  - **適用範囲**: Blueprint生成、Spec生成、レビュー/修正、タスク実行など、SDDに関わるすべてのプロセスで実施する。
- **手動作業プレフライト**: Spec生成時は、repo実装とユーザー手動作業の境界を必ず確認し、requirements.md / design.md / tasks.md に反映する。
- **順序遵守**: Requirements → Design → Tasks の順で生成する。各段階では前段のドキュメントを参照すること。
- **承認チェック**: 次段階の生成前に、前段階のドキュメントがユーザー承認済みであることを確認する。
- **参照優先**: Blueprintは `spec/blueprints/` を正とし、旧配置は読み取りフォールバックのみ（存在する場合）。
- **変更は最小単位**: 修正依頼時は該当ファイルのみ再生成し、変更点と理由を先に要約する。

## トラブルシューティング

### よくあるエラーと対処法

- **ステアリングファイル不足**: 必須ファイル（project.md、structure.md、tech.md）が存在しない場合はエラー報告し、続行可否を確認
- **承認前進行**: 前段階未承認での次段階生成は禁止、ユーザー承認を待つ
- **参照循環**: 相互参照による無限ループの防止、明確な依存関係を維持

### 生成失敗時の対応

- **Requirements生成失敗**: ステアリングファイル確認、Blueprint内容の再検討
- **Design生成失敗**: Requirements承認状況確認、技術制約の見直し
- **Tasks生成失敗**: Design承認状況確認、実装可能性の再評価
- **手動作業が未確認**: Requirements生成を停止し、確認済み情報源、未確認項目、ユーザーに判断が必要な点を提示する

---

## 禁止事項

- **承認前の進行**: 前段階のドキュメントがユーザー未承認の場合、次段階の生成を開始してはならない。
- **上流未参照**: Requirements未参照のDesign、Design未参照のTasks。
- **固有情報の分散**: ステアリング以外へのプロジェクト固有情報の記述。
- **手動作業の推測**: 外部サービス、secret、権限、課金、live環境操作が必要か未確認のまま、存在済み・完了済みとして扱ってはならない。
