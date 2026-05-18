# spec/specs/B{nn}-S{nn}-{slug}/tasks.md

# Spec B{nn}-S{nn}: {スペック名} タスクリスト

> **テンプレート利用ガイド**:
> このテンプレートは汎用的な構造を提供します。プロジェクトの性質に応じて以下を調整してください：
>
> - **開発フロー**: TDD、BDD、ウォーターフォール、アドホックなど
> - **成果物**: コード、SQL、設定ファイル、ドキュメント、インフラ構成など
> - **検証方法**: 自動テスト、手動検証、データ品質チェック、コスト確認など
> - **フェーズ粒度**: 1フェーズ=1PR、1実行単位、1週間スプリントなど
>
> 不要なタスクは削除し、必要なタスクを追加してください。

## 共通ガード

以下はプロジェクトに応じて調整してください：

- 1フェーズ=1成果物単位とし、各タスクは独立して検証可能とする
- 規模ガード（例: ≤400行/≤10ファイル、≤1日作業、≤$100コストなど）を設定すること
- 前段タスクの成果物（設計書、環境、データなど）を参照してから実装を開始すること
- 追加の仕様・契約が必要な場合は design.md を更新してから実装すること
- ユーザー手動作業は repo内実装タスクと分離し、owner role、必要権限、secret/config名、成功条件、blocked scopeを明記すること
- サインアップ、課金変更、token発行、secret登録、dashboard設定、live DB migration、本番deploy、manual purge、developer account設定などをAIが未承認で実行しないこと
- 手動作業が未完了でも進められる mock / fixture / dry-run / contract test と、live verificationでblockedになる項目を分けること

---

## External Track 0: Manual Setup Preflight（必要な場合のみ）

このトラックはユーザーまたは管理者の手動作業を記録する外部依存トラックであり、repo実装PRそのものではない。該当する手動作業がない場合は、確認した根拠と「追加手動作業なし」を短く記載する。

- [ ] E0.1: **{外部サービス / アカウント / plan の利用可否を確認する}**
      _要件_: requirements.{AC}
      _依存_: なし
      _Owner_: {service admin / billing admin / maintainer}
      _必要権限_: {org admin / billing / service read}
      _secret / config_: {なし、または設定名のみ}
      _完了条件_:
  - {サービス、plan、quota、規約同意、組織権限が要件を満たすことを確認する}
  - {未確認または不足がある場合は blocked として記録する}
  - secret値、token実値、credential、dashboard screenshotのraw値を保存しない

- [ ] E0.2: **{API token / service account / OAuth app / webhook secret を発行・登録する}**
      _要件_: requirements.{AC}
      _依存_: E0.1
      _Owner_: {service admin + secret manager admin}
      _必要権限_: {token create / app config write / secret write}
      _secret / config_: `{ENV_NAME}`, `{secret template path}`
      _完了条件_:
  - {必要最小権限のtoken / app / webhookが作成され、プロジェクトのsecret管理機構へ登録されている}
  - {検証コマンドがsecret非露出で成功する、または閉じたreasonCodeでfail-closedする}
  - 未完了の場合、該当live verificationをblockedにし、mock / fixture検証だけを完了扱いにする

- [ ] E0.3: **{DNS / cloud resource / runtime config / Access policy を確認する}**
      _要件_: requirements.{AC}
      _依存_: E0.1
      _Owner_: {infra admin / platform admin}
      _必要権限_: {resource create / DNS write / policy write}
      _secret / config_: `{BASE_URL}`, `{ALLOWED_HOSTS}`, `{RUNTIME_SECRET_NAME}`
      _完了条件_:
  - {対象環境にresource / route / policy / runtime configが存在し、境界が確認できる}
  - {通常APIとadmin/debug/smoke経路の認可境界を確認する}
  - 未確認の場合、deploy / smoke / live query を blocked として記録する

- [ ] E0.4: **{live data operation / migration / release / device検証を実施またはblocked記録する}**
      _要件_: requirements.{AC}
      _依存_: E0.2, E0.3
      _Owner_: {maintainer / DBA / release admin / QA}
      _必要権限_: {target env write / release admin / test device access}
      _secret / config_: `{DATABASE_URL}` など設定名のみ
      _完了条件_:
  - {ユーザー承認済みの場合のみ live operation を実行する}
  - {未承認、権限不足、対象データ不足の場合は blocked 理由と失われる検出範囲を記録する}
  - rollback / purge / release 操作は明示承認なしで実行しない

---

## Phase 1: {フェーズ名}

- [ ] T1.1: **フェーズ設計確認**
      _要件_: design.{section}
      _依存_: なし
      _完了条件_:
  - `design.md` の該当セクションを引用し、実装方針を確認
  - 影響範囲（ファイル、テーブル、API、コストなど）を特定
  - 依存関係・前提条件を確認

- [ ] T1.2: **実装準備**
      _要件_: requirements.{ID}
      _依存_: T1.1
      _完了条件_:
  - 必要なリソース（テーブル、API、ライブラリなど）を確認
  - 実装前の検証（dry-run、見積もりなど）を実施
  - ユーザー承認が必要な場合は承認を得る

- [ ] T1.3: **実装**
      _要件_: requirements.{ID}
      _依存_: T1.2
      _完了条件_:
  - 実装を完了し、成果物（コード、SQL、設定など）が作成されている
  - 基本的な動作確認が完了している
  - 規模ガードを満たしている

- [ ] T1.4: **検証**
      _要件_: requirements.{ID}.AC{n}
      _依存_: T1.3
      _完了条件_:
  - 受け入れ基準を満たすことを確認（テスト、データ品質、パフォーマンスなど）
  - エラーケース・境界値の確認を完了
  - ドキュメント・ログ・モニタリングが適切に整備されている

- [ ] T1.5: **統合確認**
      _要件_: quality.integration
      _依存_: T1.4
      _完了条件_:
  - 前後フェーズとの整合性を確認
  - 既存機能への影響がないことを確認（リグレッションテスト）
  - ドキュメント・スキーマ・契約の同期を完了

---

## Phase 2: {フェーズ名}

- [ ] T2.1: **フェーズ設計確認**
      _要件_: design.{section}
      _依存_: T1.5
      _完了条件_:
  - `design.md` の該当セクションを引用
  - 実装方針・影響範囲を確認

- [ ] T2.2: **実装準備**
      _要件_: requirements.{ID}
      _依存_: T2.1
      _完了条件_:
  - 必要なリソース・環境を確認
  - 実装前検証を実施

- [ ] T2.3: **実装**
      _要件_: requirements.{ID}
      _依存_: T2.2
      _完了条件_:
  - 成果物を作成
  - 基本動作確認を完了

- [ ] T2.4: **検証**
      _要件_: requirements.{ID}.AC{n}
      _依存_: T2.3
      _完了条件_:
  - 受け入れ基準を満たすことを確認
  - エラーケース・境界値を確認

- [ ] T2.5: **統合確認**
      _要件_: quality.integration
      _依存_: T2.4
      _完了条件_:
  - 前後フェーズとの整合性を確認
  - ドキュメント同期を完了

---

<!-- 必要に応じてPhase3以降を追加 -->

<!-- バージョンバンプタスク:
  アプリ変更（app/ or packages/）を含むスペックの場合、最後の実装フェーズの末尾に追加する。
  API のみ / docs のみのスペックには不要。

  - [ ] T{n}.{m}: **アプリバージョン更新**
    _バンプ種別_: minor（新機能） / patch（バグ修正）
    _依存_: T{n}.{m-1}
    _完了条件_:
      - merge-pr スキルが自動実行（手動作業不要）
-->

## Phase N: 統合テスト・Go判定

- [ ] TN.1: **統合設計確認**
      _要件_: design.integration
      _依存_: T{N-1}.5
      _完了条件_:
  - 全フェーズの成果物が設計と整合していることを確認
  - 既知の課題・制約事項を文書化
  - 設計変更履歴を記録

- [ ] TN.2: **E2E検証**
      _要件_: requirements.非機能要件
      _依存_: TN.1
      _完了条件_:
  - E2Eシナリオテストが成功する
  - パフォーマンス・コスト・セキュリティ要件を満たす
  - 本番相当データでの動作確認が完了

- [ ] TN.3: **ドキュメント整備**
      _要件_: quality.documentation
      _依存_: TN.2
      _完了条件_:
  - 運用手順書・トラブルシューティングガイドが作成されている
  - README・設計書が最新である
  - すべてのドキュメントがバージョン管理下にある

- [ ] TN.4: **最終検証とステータス更新**
      _要件_: workflow.completion
      _依存_: TN.3
      _完了条件_:
  - 全要件の受け入れ基準を満たすことを確認
  - `requirements.md`, `design.md`, `tasks.md` のステータスを `final` に更新
  - 完了報告を作成
  - 次フェーズへの引き継ぎ事項を文書化

- [ ] TN.5: **バックログ棚卸し・イシュー化**
      _要件_: workflow.backlog-triage
      _依存_: TN.4
      _完了条件_:
  - 全フェーズの tasks.md 内 Backlogs セクションを洗い出し
  - 関連する項目をグルーピング（同一コンポーネント・同一ユースケースに属するものを目安に。迷う場合は1件1イシューでよい）
  - グループごとに GitHub Issue を `/create-issue` で作成
  - Backlogs セクションが空、または存在しない場合はスキップ

- [ ] TN.6: **アーカイブ処理**
      _要件_: workflow.archive
      _依存_: TN.5
      _完了条件_:
  - スペックディレクトリ `spec/specs/B{nn}-S{nn}-{slug}/` を `spec/_archive/specs/` に移動
  - 元になったブループリントディレクトリは、当該ブループリントの全スコープが完了済みの場合のみ `spec/_archive/blueprints/` に移動
  - 移動後のディレクトリ構造が正しく、全ファイルが含まれていることを確認
  - アーカイブ後、他のドキュメントからの参照リンクが有効であることを確認（grep等で `spec/specs/B{nn}-S{nn}-` や `blueprints/{nn}-` を検索し、リンク切れがないか確認）
  - `/sdd:cleanup-worktree` に従い、作業ブランチ・ワークツリーをクリーンアップ
  - アーカイブ完了をプロジェクト記録（該当する場合、`docs/project/overview.md` など）に反映

---

## 補足: プロジェクト固有の調整例

### ソフトウェア開発プロジェクト

- **フェーズ粒度**: 1フェーズ=1PR（≤400行/≤10ファイル）
- **検証方法**: 自動テスト（`npm test`, `pytest`, `go test` など）
- **TDD採用時**: 各フェーズに Red → Green → Refactor のサブタスクを追加
- **バージョンバンプ**: アプリ変更を含む最終実装フェーズにバージョンバンプタスクを追加（merge-pr が自動実行）

### データ分析・基盤プロジェクト

- **フェーズ粒度**: 1フェーズ=1実行単位（≤10分実行時間/≤$100コスト）
- **検証方法**: データ品質チェックSQL、パフォーマンス測定、コスト確認
- **成果物**: BigQuery SQL、Cloud Functions、スキーマ定義、ダッシュボード設定

### インフラ構成プロジェクト

- **フェーズ粒度**: 1フェーズ=1リソース種別（VPC、DB、Functions など）
- **検証方法**: Terraform plan/apply、セキュリティスキャン、コスト見積もり
- **成果物**: IaCコード、設定ファイル、ドキュメント

---

## docs/ 更新指示チェックリスト

実装完了後、以下のドキュメントを更新すること:

- [ ] プロジェクトルートの README.md に進捗を反映（必要に応じて）
- [ ] `docs/` 配下の関連ドキュメント（ツール仕様、アーキテクチャ図など）を更新
- [ ] `docs/project/overview.md` にフェーズ完了を記録（該当する場合）
- [ ] ADR の docs 反映: `docs/development/decisions/` 内の ADR で、`docs/` 配下に未反映の内容がないか確認
- [ ] 調査タスクの結論反映: 調査タスク（Go/No-Go 判定等）の結論が `docs/` と ADR の両方に反映されていることを確認

---

## 参考資料

- Requirements: `spec/specs/B{nn}-S{nn}-{slug}/requirements.md`
- Design: `spec/specs/B{nn}-S{nn}-{slug}/design.md`
- Workflow: `workflow.md`（テンプレート解決ルールに従う）
