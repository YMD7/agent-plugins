---
name: init
description: SDDフレームワークをプロジェクトに導入する初期セットアップ。プロジェクトのコードベースと既存ドキュメントを深く調査し、SDD に必要な構造とステアリングドキュメントを自動構築する。「SDD導入して」「SDDセットアップ」「sdd init」等のリクエストに対応。
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, Agent
---

# SDD Init — 初期セットアップスキル

## 概要

プロジェクトに SDD（Spec-Driven Development）フレームワークを導入するための初期セットアップを行う。
プロジェクトのコードベースと既存ドキュメントをサブエージェントで徹底調査し、SDD に必要な構造を構築する。

## Runtime互換

- Claude Code: plugin skill と `Agent` tool を使用する。
- Codex: runtimeがnative sub-agent/delegation機能を提供している場合はそれを使用する。これはプラグインmanifestでpackagingする専用agentではなく、Codex親セッション側の実行機能を使う。
- Codexでsub-agent機能が使えない場合は、同じ調査観点をメインエージェントが段階的に実施し、`.tmp/sdd-init/` に「sub-agent unavailable」と理由を記録する。独立レビューや並列調査を実施済みと扱ってはならない。
- どちらのruntimeでも、調査結果・質問・ドラフトの出力先は `.tmp/sdd-init/` に統一する。

## 前提条件

- Git リポジトリであること
- プロジェクトのルートディレクトリで実行すること

## 実行フロー

### Phase 0: 事前準備

init の作業を開始する前に、以下を実施する。

#### 0.1 `.gitignore` の確認

`.tmp` が `.gitignore` に含まれているか確認し、未登録であれば追加する:

```bash
# .gitignore に .tmp が含まれているか確認
grep -q '^\.tmp' .gitignore 2>/dev/null || echo '.tmp' >> .gitignore
```

#### 0.2 作業ブランチの確認

ユーザーに作業方法を確認する:

> SDD の初期セットアップで `spec/` ディレクトリやドキュメントを追加します。
> 作業方法を選んでください:
> 1. **現在のブランチに直接コミット** — 小規模チームや個人プロジェクト向け
> 2. **ブランチを切ってPRにする** — チームレビューが必要な場合

**ブランチを切る場合**:
1. ベースブランチを確認する（「どのブランチから切りますか？」）
2. runtimeに応じて `/sdd:create-worktree`（Claude Code）または `create-worktree` skill（Codex）でワークツリーを作成する（プレフィックス: `sdd-init`）
3. 以降のすべての作業はワークツリー内で実施する

**現在のブランチに直接コミットする場合**:
- そのまま Phase 1 に進む

#### 0.3 VCS プロバイダーの記録

SDD プラグインの他コマンド（`create-worktree`, `plan-task`, `consolidate-review` 等）は issue / PR / MR 操作で VCS プロバイダーの情報を参照する。init 実行時に一度だけ判定して `AGENTS.md` / `CLAUDE.md` に **1 行**記録しておく。

**判定・追記フロー:**

1. **既存記述の確認（冪等性）**:
   - `AGENTS.md` / `CLAUDE.md` を読み、VCS 記述（`## VCS` セクション等）が既にある場合は何もしない

2. **VCS プロバイダー判定**:
   - `git remote get-url origin` を実行し、ホスト名から判定:
     - `github.com` を含む → `GitHub`
     - `gitlab.*`（self-hosted 含む）→ `GitLab ({host})`
     - remote が無い／判定不能 → ユーザーに質問して確認:
       > VCS プロバイダーを自動判定できませんでした。どちらですか？
       > 1. GitHub
       > 2. GitLab（ホスト名を入力）
       > 3. スキップ（VCS 記述を追加しない）

3. **追記先ファイル選択**:
   - `AGENTS.md` が存在する → `AGENTS.md` に追記（優先）
   - `CLAUDE.md` のみ存在する → `CLAUDE.md` に追記
   - どちらも無い → ユーザーに確認（どちらを作成するか、スキップするか）

4. **追記内容の決定**:

   独立した h2 セクションとして追記する（他のセクションと構造を揃え、本文は 1 行）:

   ```markdown
   ## VCS

   GitHub — use `gh` for issue/PR operations
   ```

   または

   ```markdown
   ## VCS

   GitLab ({host}) — use `glab` for issue/MR operations
   ```

5. **ユーザー承認**:

   `AGENTS.md` / `CLAUDE.md` は開発者のメタ指示書であり、書き換えはセンシティブな操作。必ず事前に承認を得る。

   以下のフォーマットで確認する（`{target}` は追記先ファイル名、`{content}` は 4 で確定した追記内容）:

   ```
   SDD プラグインのコマンド（create-worktree / plan-task / consolidate-review 等）は、
   issue/PR/MR 操作時に GitHub（`gh`）と GitLab（`glab`）のどちらを使うか判定する必要があります。
   判定結果を {target} に記録しておくと、コマンド実行のたびに git remote から判定するコストを節約できます。

   以下の内容を {target} に追記してもよろしいですか？

   {content}

     y: 追記する（推奨。毎回の判定コストを節約）
     n: スキップ（SDD コマンドは毎回 git remote から動的判定する。動作には影響なし）
   ```

   - y → ステップ 6 で実行
   - n → Phase 0.3 を終了（SDD コマンドは動的判定で動作する）

6. **追記実行**（承認された場合のみ）:

   - 追記先ファイルに `## VCS` セクションを追加
   - 追記位置は既存セクション構造を尊重（冒頭の h1 直下、既存 h2 セクションの前が自然）

**重要原則**: 本文は最小限に抑える。背景説明・手順・URL 等の詳細は書かない。`AGENTS.md` / `CLAUDE.md` は常時自動ロードされてコンテキスト予算を消費するため。

### Phase 1: プロジェクト調査（並行実行）

2つのリサーチャーサブエージェントを**並行**で起動する。Codexでは `subagent_type` 指定ではなく、同じpromptをnative sub-agent/delegation機能へそのまま渡す。利用できない場合は、同じ順序でメインエージェントが実施する。

#### 1a. コードベース調査（sdd-init-code-researcher）

コードベースの構造・技術スタック・アーキテクチャパターンを徹底調査する。

```
Agent を起動:
  name: code-researcher
  subagent_type: sdd-init-code-researcher（プラグインのエージェント定義を使用）
  prompt: |
    プロジェクトのコードベースを徹底調査してください。
    以下の観点で分析し、結果を .tmp/sdd-init/findings-code.md に出力してください。
    判断に迷う点や確認が必要な点は .tmp/sdd-init/questions-code.md に記録してください。
    
    調査観点:
    - ディレクトリ構造（深さ3-4階層）
    - 技術スタック（言語、フレームワーク、ライブラリ）
    - アーキテクチャパターン（DDD, MVC, Clean Architecture 等）
    - 命名規約（ファイル名、変数名、関数名の実態）
    - テスト構成（フレームワーク、配置パターン）
    - CI/CD 構成
    - パッケージマネージャーの種類
    - ビルドツール・リンター・フォーマッター
```

#### 1b. ドキュメント調査（sdd-init-doc-researcher）

既存ドキュメントを精読し、SDD steering 要件とのギャップを分析する。

```
Agent を起動:
  name: doc-researcher
  subagent_type: sdd-init-doc-researcher（プラグインのエージェント定義を使用）
  prompt: |
    プロジェクトの既存ドキュメントを精読し、SDD のステアリング要件とのギャップを分析してください。
    結果を .tmp/sdd-init/findings-docs.md に出力してください。
    判断に迷う点や確認が必要な点は .tmp/sdd-init/questions-docs.md に記録してください。
    
    SDD ステアリング要件（必須3ファイル）:
    - project.md: プロダクト概要・ビジョン・ターゲットユーザー・ビジネス目標
    - structure.md: ディレクトリ構造・命名規約・アーキテクチャルール・設計原則
    - tech.md: 技術スタック一覧・技術選定理由・制約事項・開発ツール
    
    分析観点:
    - 既存ドキュメントの一覧と各ドキュメントの要約
    - 各 steering 要件に対するカバレッジ（%）
    - 既存ドキュメントで十分にカバーされている場合のシンボリンクマッピング案
    - 不足している情報の具体的なリスト
    - ドキュメント内の矛盾・不整合の検出
```

### Phase 2: ドキュメント構成・推敲（sdd-init-composer）

Phase 1 の両方の findings を読み込み、ステアリングドキュメントのドラフトを構成する。

```
Agent を起動:
  name: composer
  subagent_type: sdd-init-composer（プラグインのエージェント定義を使用）
  prompt: |
    .tmp/sdd-init/findings-code.md と .tmp/sdd-init/findings-docs.md を読み込み、
    SDD ステアリングドキュメントのドラフトを構成してください。
    
    方針:
    - 既存ドキュメントで十分にカバーされている steering 要件
      → シンボリンク推奨として .tmp/sdd-init/symlink-plan.md に記録
    - 既存ドキュメントでカバーしきれない steering 要件
      → ドラフトを .tmp/sdd-init/drafts/ に生成
    - 判断に迷う点は .tmp/sdd-init/questions-composer.md に記録
    
    出力:
    - .tmp/sdd-init/symlink-plan.md（シンボリンクマッピング）
    - .tmp/sdd-init/drafts/project.md（必要な場合のみ）
    - .tmp/sdd-init/drafts/structure.md（必要な場合のみ）
    - .tmp/sdd-init/drafts/tech.md（必要な場合のみ）
    - .tmp/sdd-init/questions-composer.md
```

### Phase 3: レビュー（sdd-init-reviewer）

ドラフトの正確性・網羅性・コード実態との整合性をレビューする。

```
Agent を起動:
  name: reviewer
  subagent_type: sdd-init-reviewer（プラグインのエージェント定義を使用）
  prompt: |
    以下のファイルを読み込み、SDD ステアリングドキュメントのドラフトをレビューしてください。
    
    入力:
    - .tmp/sdd-init/findings-code.md（コード調査結果）
    - .tmp/sdd-init/findings-docs.md（ドキュメント調査結果）
    - .tmp/sdd-init/symlink-plan.md（シンボリンクマッピング）
    - .tmp/sdd-init/drafts/（ドラフト群）
    
    レビュー観点:
    - ドラフト内容とコード実態の整合性
    - 用語・命名の正確性
    - 情報の網羅性（steering 要件に対して）
    - 矛盾・重複の検出
    - シンボリンク候補の妥当性
    
    出力:
    - .tmp/sdd-init/review.md（レビュー結果）
    - .tmp/sdd-init/questions-reviewer.md（確認事項）
```

### Phase 4: 横断チェック + ユーザー対話（メインエージェント）

メインエージェントが以下を実行する:

#### 4.1 情報の統合と横断チェック

1. **全 questions ファイルの統合**:
   - `.tmp/sdd-init/questions-code.md`
   - `.tmp/sdd-init/questions-docs.md`
   - `.tmp/sdd-init/questions-composer.md`
   - `.tmp/sdd-init/questions-reviewer.md`

2. **スコープ横断の矛盾検出**:
   - findings-code.md と findings-docs.md の間の不整合を特定
   - 例: ドキュメントでは「DDD」と記載しているがコードはそうなっていない
   - 例: 技術スタックの記載が古い

3. 統合した質問と矛盾点を、以下の2カテゴリに分類する:
   - **矛盾・不整合**: ドキュメント間またはドキュメントとコード間の矛盾（対応案を含む）
   - **確認事項**: プロジェクトの方針・ビジョン等、コードから読み取れない情報

#### 4.2 ユーザーの立場確認

Phase 4 の対話を始める前に、ユーザーに以下を確認する:

> このプロジェクトにおけるあなたの立場を教えてください:
> 1. **プロジェクトオーナー/メンバー** — プロジェクトの意思決定ができる。質問にその場で回答できる
> 2. **外部の導入担当者** — プロジェクトの詳細は別のオーナーに確認する必要がある

#### 4.3a プロジェクトオーナー/メンバーの場合

対話形式で進める:
1. 矛盾・不整合を一つずつ提示し、対応案とともに判断を仰ぐ
2. 確認事項を一つずつ質問して回答を得る
3. 回答をドラフトに即時反映する

#### 4.3b 外部の導入担当者の場合

段階的に進める:

**Step 1**: 矛盾・不整合と確認事項の一覧をユーザーに提示する

**Step 2**: 「この中でご自身で回答できるものはありますか？」と確認する
- 回答できるものがあれば、対話形式でその場で回答を得る
- 回答をドラフトに即時反映する

**Step 3**: 残った未回答の項目について「残りの項目をプロジェクトオーナー向けの質問票として出力しますか？」と確認する
- **Yes**: 矛盾レポートと質問票をファイル出力する（下記参照）
- **No**: 暫定対応のまま Phase 5 に進む

**質問票を出力する場合**:

1. **矛盾レポート**（`.tmp/sdd-init/contradiction-report.md`）を生成:
   ```markdown
   # SDD Init — 矛盾・不整合レポート
   
   ## 概要
   SDD 導入にあたりプロジェクトのコードとドキュメントを調査した結果、
   以下の矛盾・不整合が検出されました。各項目に対応案を記載しています。
   
   ## 矛盾一覧
   
   ### 1. {矛盾の概要}
   - **箇所**: {ファイルパスA} vs {ファイルパスB}
   - **内容**: {具体的な矛盾の内容}
   - **対応案**: {推奨する対応}
   - **今回の暫定対応**: {SDD ドキュメントにどう反映したか}
   ```

2. **質問票**（`.tmp/sdd-init/questionnaire.md`）を生成:
   回答者がこのファイルを直接編集して記入できるフォーマットにすること。
   ```markdown
   # SDD Init — プロジェクトオーナー向け質問票
   
   ## 回答方法
   各質問の「回答」欄に直接記入してください。
   選択式の場合は該当する選択肢の先頭を `[x]` に変更してください。
   記入が完了したら、このファイルを導入担当者に返送してください。
   
   ---
   
   ## Q1: {質問の概要}
   
   **背景**: {なぜこの質問が必要か。回答者が文脈を理解できる程度に具体的に書く}
   
   **現状**: {コードやドキュメントから読み取れた現状の事実}
   
   **回答**（選択式の場合）:
   - [ ] A. {選択肢Aの内容}
   - [ ] B. {選択肢Bの内容}
   - [ ] C. {選択肢Cの内容}
   
   **補足**（自由記述。選択肢に補足がある場合や、選択式でない場合はここに記入）:
   
   > （ここに記入）
   
   ---
   
   ## Q2: {質問の概要}
   
   **背景**: ...
   
   **現状**: ...
   
   **回答**（自由記述の場合）:
   
   > （ここに記入）
   
   ---
   ```
   
   **質問票フォーマットのルール**:
   - 各質問は `---` で区切り、視覚的に独立させる
   - 「背景」と「現状」を必ず含め、回答者がプロジェクトを思い出せるようにする
   - 選択式にできるものはチェックボックス形式（`- [ ]`）にする
   - 自由記述欄は引用ブロック（`>`）で記入場所を明示する
   - 質問数が多い場合はカテゴリ別にグループ化する

質問票出力後、ユーザーに以下を報告:
   - 矛盾レポートと質問票のファイルパスを提示
   - Step 2 で回答済みの項目は反映済みであることを明示
   - 暫定的な対応内容を説明（矛盾については推奨案で仮進行）
   - 「質問票の回答が得られたら、回答を反映してドラフトを更新できます」と案内

ユーザーの指示に応じて:
   - **今すぐ続行**: 暫定対応のまま Phase 5 に進む
   - **回答待ち**: 質問票への回答が得られてから再開する

#### 4.4 ドラフトの最終化

ユーザー回答（対話 or 質問票）を反映してドラフトを更新し、シンボリンクマッピングを確定する。

### Phase 5: ファイル配置

ユーザー承認後、以下を実行する:

1. **ディレクトリ構造の作成**:
   ```bash
   mkdir -p spec/_custom/steering
   mkdir -p spec/blueprints
   mkdir -p spec/specs
   mkdir -p spec/_archive/blueprints
   mkdir -p spec/_archive/specs
   ```

2. **カスタマイズガイドの配置**:
   - プラグインの `templates/framework/custom-readme.md` を `spec/_custom/README.md` としてコピー

3. **ステアリングファイルの配置**:
   - 既存ドキュメントへのシンボリンクを `spec/_custom/steering/` に作成
   - 新規生成したドキュメントはプロジェクトの `docs/` 配下に配置し、シンボリンクを作成

4. **spec/README.md の配置**:
   - プラグインの `templates/framework/README.md` を `spec/README.md` としてコピー

5. **一時ファイルのクリーンアップ**:
   ```bash
   rm -rf .tmp/sdd-init/
   ```

## 出力構造

init 完了後、プロジェクトに以下の構造が追加される:

```
{project-root}/
├── spec/
│   ├── README.md                    # SDDフレームワーク概要
│   ├── _custom/
│   │   ├── README.md                # カスタマイズガイド
│   │   └── steering/
│   │       ├── project.md  → ../../docs/xxx.md（シンボリンク）
│   │       ├── structure.md → ../../docs/xxx.md（シンボリンク）
│   │       └── tech.md     → ../../docs/xxx.md（シンボリンク）
│   ├── blueprints/
│   ├── specs/
│   └── _archive/
│       ├── blueprints/
│       └── specs/
└── docs/
    └── (新規生成されたドキュメントがあればここに配置)
```

## 注意事項

- サブエージェントはすべてファイル経由で情報を受け渡す（メインエージェントのコンテキストを節約）
- 各サブエージェントは `questions-*.md` に確認事項を必ず出力する義務がある
- メインエージェントは Phase 4 でスコープ横断の矛盾検出を行う（サブエージェントには見えない情報）
- ユーザーとの対話はメインエージェントのみが行う
