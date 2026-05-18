---
name: auto-mode-setup
description: Claude Code の Auto mode をプロジェクトに導入するセットアップ。`bypassPermissions` からの移行、新規プロジェクトへの Auto mode 適用、プロジェクト単位のガードレール整備（deny ルール、autoMode.environment、Sandbox）を行う。「Auto mode セットアップ」「Auto mode 移行」「Claude Code のガードレール整備」等のリクエストに対応。既に設定済みなら確認のみ。
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

# Auto Mode Setup — Claude Code Auto mode 導入スキル

## 概要

Claude Code を Auto mode で運用するための **プロジェクト単位のセットアップ** を行う。
ユーザーグローバル設定（`~/.claude/settings.json`）は別途一度だけ行えば良く、本スキルはプロジェクトごとに必要な作業に焦点を当てる。

Auto mode は 3 層防御の組み合わせ:

| 層 | 役割 | 設定場所 |
|---|---|---|
| Permissions (`deny`/`allow`/`ask`) | 静的ルールによる Tool 実行可否 | `settings.json` `permissions` |
| Sandbox (macOS Seatbelt / Linux bubblewrap) | Bash の OS レベル隔離 | `settings.json` `sandbox` または `/sandbox` |
| Auto mode classifier | バックグラウンド AI による安全検査 | `autoMode.environment` などで trusted infra を宣言 |

## 公式の立ち位置と本スキルの分担

- **公式は「LLM にセットアップを丸投げ」を推奨してへん**。`autoMode.environment` の宣言は人間の意思決定が必要（信頼境界の宣言）
- 本スキルは **「ドラフト作成 + AI による critique」** という公式想定フローを支援する
- 人間が判断すべき箇所は `<TODO: ...>` プレースホルダで明示し、ユーザーに記入を促す

## 前提条件

- Claude Code v2.1.83 以上
- ユーザーのプランが Max / Team / Enterprise / API のいずれか（Pro は Auto mode 不可）
- モデルが Sonnet 4.6 / Opus 4.6 / Opus 4.7（Max プランは Opus 4.7 のみ）
- Anthropic API 経由（Bedrock / Vertex / Foundry は不可）
- プロジェクトが Git リポジトリ
- プロジェクトのルートディレクトリで実行

## 実行フロー

### Phase 0: 事前確認

#### 0.1 ユーザーグローバル設定の状態確認

`~/.claude/settings.json` を読み、以下を確認する:

- `permissions.defaultMode` が `"auto"` になっているか
- `permissions.disableAutoMode` キーがあれば削除が必要であることを警告（このキーがあると Auto mode にスイッチできない）
- `autoMode.environment` ブロックが存在するか

未設定の場合はユーザーに以下を確認:

> グローバル設定（`~/.claude/settings.json`）が Auto mode 用に整っていません。
> このプロジェクトの設定だけ進めてグローバルは後で対応しますか、それともグローバル設定も同時に行いますか？

#### 0.2 既存のプロジェクト設定の確認

以下のファイルの有無と内容を確認:

- `.claude/settings.json`（git 管理、チーム共有）
- `.claude/settings.local.json`（gitignore 推奨、個人 trust 宣言）
- `.gitignore`（`.claude/settings.local.json` が ignore 済みか）

既に整っている場合は、不足部分のみ追加する差分提案にとどめる。

#### 0.3 プロジェクト性質の調査

`autoMode.environment` を書くために必要な情報を Read / Grep で収集する:

- パッケージマネージャ（`package.json` / `pyproject.toml` / `Cargo.toml` 等）
- クラウドプロバイダ（`wrangler.toml` / `serverless.yml` / `terraform/` 等）
- secret ファイルの命名規則（`.env`, `.dev.vars`, `secrets/`, `credentials.json` 等）
- CI 設定（`.gitlab-ci.yml` / `.github/workflows/`）
- リポのホスト（GitLab / GitHub / Bitbucket）

これは推測の元になる情報。**最終的な trust 宣言の判断は必ずユーザーに仰ぐ**。

### Phase 1: プロジェクト共有 deny ルール（`.claude/settings.json`）

`templates/project-settings.json` をベースに、プロジェクト固有の secret ファイル名を追加してドラフトを作る。

**汎用 deny の最小セット**:

- `Bash(git push --force *)`, `Bash(git push --force-with-lease *)`, `Bash(git push -f *)`
- `Read(./.env)`, `Read(./.env.*)`

**プロジェクト固有で追加検討**:

- Wrangler プロジェクト → `Read(./.dev.vars)`, `Read(./.dev.vars.*)`
- Terraform プロジェクト → `Read(./terraform.tfvars)`, `Read(./*/terraform.tfvars)`
- Python プロジェクトで secrets を別ファイル化している → 該当パス
- GCP プロジェクト → `Read(./*-credentials.json)`, `Read(./service-account*.json)`

既存の `.claude/settings.json` に `hooks` などが既に書かれている場合は **削除せずマージ** する。

### Phase 2: プロジェクト固有 trusted infrastructure（`.claude/settings.local.json`）

`templates/project-settings.local.json` をベースに、Phase 0.3 で収集した情報からドラフトを作る。

**書き方の原則**（`claude auto-mode critique` で叩かれやすい箇所）:

1. **「overrides default」を明示** — `environment` に「Trusted internal domains: ...」と書くだけでは、組み込みの「None configured」と矛盾する。明示的に override する旨を書く
2. **ワイルドカードホスト名を避ける** — `*.workers.dev` のような共有マルチテナント領域を trusted と宣言しない。具体ホスト名を書く
3. **routine ops と destructive ops を分ける** — 「Wrangler 全部 OK」ではなく、「`wrangler dev/deploy/tail` は routine、`wrangler delete/secret put/Access policy 変更` は要 explicit intent」のように粒度を分ける
4. **理由を添える** — 「low-traffic 個人運用なので deploy も routine 扱い」のように、判断の根拠を 1 行入れる
5. **不明な値はプレースホルダ** — Worker subdomain、Access app hostname 等、ユーザーしか知らない値は `<TODO: ...>` で残す

### Phase 3: `.gitignore` 更新

`.claude/settings.local.json` が ignore 済みか確認。なければ追加:

```
# Claude Code local (per-developer) settings

.claude/settings.local.json
```

### Phase 4: Sandbox の有効化

`/sandbox` スラッシュコマンドでユーザーがインタラクティブに有効化するのが基本（auto-allow mode を選択）。
設定ファイルで明示的に有効化する場合は `.claude/settings.local.json` に:

```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true
  }
}
```

プロジェクト固有の `allowWrite` パスがある場合（ビルド出力、キャッシュディレクトリ等、CWD 外への書き込みが必要なツール）は同ブロックに追加する。

### Phase 5: 検証

#### 5.1 JSON 妥当性

```bash
jq . .claude/settings.json > /dev/null
jq . .claude/settings.local.json > /dev/null
```

#### 5.2 有効ルールの確認

```bash
claude auto-mode config
```

`$defaults` がデフォルトと merge されて展開されること、`environment` に書いた行が反映されていることを確認。

#### 5.3 AI による critique

```bash
claude auto-mode critique
```

出力をユーザーと一緒に読み、指摘事項を反映する。critique が無条件で正しいわけではないが、特に以下は反映すべき:

- 「default と矛盾」「override が不明確」
- 「ワイルドカードホスト名が危険」
- 「routine と destructive が分けられていない」
- 「具体的なホスト名/リソース名が不足」

critique を反映した後、再度 `claude auto-mode config` で意図通りか確認。

### Phase 6: コミット

CLAUDE.md のガイドライン（`git add .` 禁止、ファイル個別指定、`--no-verify` 禁止）に従って:

```bash
git add .claude/settings.json .gitignore
git status   # 必ず確認
git commit -m "..."
```

`.claude/settings.local.json` は gitignore 済みなのでコミット対象外。

コミットメッセージのドラフト例:

```
Enable Claude Code auto mode with project guardrails

Add deny rules to hard-block force push and reads of <secret files>,
which the Auto mode classifier alone cannot guarantee. Gitignore
.claude/settings.local.json so each developer can declare their own
autoMode environment without committing personal trust assertions.
```

## テンプレートファイル

このスキルディレクトリ配下:

- `templates/project-settings.json` — Phase 1 のベース（汎用 deny ルール）
- `templates/project-settings.local.json` — Phase 2 のベース（autoMode.environment と sandbox の雛形）

両方ともプロジェクト固有の値（プロジェクト名、クラウド設定、secret ファイル名等）は `<TODO: ...>` プレースホルダで残してある。

## 既知の落とし穴

### `autoMode` は `.claude/settings.json`（共有）から読まれない

これは設計上の制約。リポが勝手に trust ルールを注入できないようにする目的で、共有設定からは `autoMode` ブロックは読み込まれない。必ず `~/.claude/settings.json` か `.claude/settings.local.json` か managed settings に書く。

### `$defaults` の付け忘れは「全置換」

`environment`、`allow`、`soft_deny`、`hard_deny` のいずれかで配列に `"$defaults"` を入れ忘れると、組み込みルールが **完全に置き換わる**。`hard_deny` で `$defaults` を忘れると、curl|bash や force push の組み込みブロックが消える。

### `disableAutoMode: "disable"` のレガシー設定

ユーザーが過去に Auto mode の opt-in を「もう聞かないで」で却下している場合、`~/.claude/settings.json` にこのキーが残っている可能性がある。Phase 0.1 で必ずチェック。

### Sandbox と git 操作

プロジェクト外のディレクトリ（`~/.claude/`、`~/Dev/dotfiles/` 等）への書き込みは Sandbox がブロックする。これは意図的挙動。意図的にプロジェクト外を編集する場合は Bash の `dangerouslyDisableSandbox: true` で実行する（その都度ユーザー承認）。

### `wrangler tail` をルーチン化するトレードオフ

`wrangler tail` は本番 Worker のトラフィックを transcript に流す。低トラフィックな個人/内部プロジェクトでは許容できるが、機微データを扱う本番では Auto mode の対象から外す（`autoMode.environment` で routine 扱いしない）べき。

## 完了後のメッセージ例

セットアップ完了時、以下のような確認をユーザーに提示する:

> Auto mode セットアップ完了です。
>
> - `.claude/settings.json`: deny ルール追加 ✅
> - `.claude/settings.local.json`: 信頼インフラ宣言（未確定の `<TODO>` は X 箇所）⚠️
> - `.gitignore`: 更新済み ✅
> - 検証: `claude auto-mode config` 正常 / `critique` の指摘は反映済み ✅
>
> 次のステップ:
> 1. `<TODO>` プレースホルダを埋めてください（特に: ...）
> 2. `/sandbox` で Sandbox を有効化（未実施なら）
> 3. 動作確認: 普段使うコマンドを 2〜3 回試して、想定外のプロンプトが出ないか確認
> 4. コミット可否を判断
