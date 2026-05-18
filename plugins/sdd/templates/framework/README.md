# Spec Driven Development (SDD) フレームワーク

仕様駆動開発のコアフレームワーク。

## ディレクトリ構成

```
spec/
├── _custom/                     # プロジェクト固有設定
│   ├── README.md                # カスタマイズガイド
│   ├── steering/                # ステアリング（シンボリックリンク推奨）
│   └── templates/               # テンプレートオーバーライド（オプション）
├── _archive/                    # 完了済みBlueprint/Specの保管場所
├── blueprints/                  # アクティブなBlueprint
└── specs/                       # アクティブなSpec
```

## 開発フロー

Blueprint (全体設計) → Scope (開発スコープ) → Requirements → Design → Tasks

各段階でユーザー承認を経てから次へ進む。

## テンプレート解決

SDD はプラグインにデフォルトテンプレートを同梱し、プロジェクト側でオーバーライドできる2層構造を採用している。

| 優先順位 | 場所 | 用途 |
|---|---|---|
| 1（優先） | `spec/_custom/` | プロジェクト固有のオーバーライド |
| 2（デフォルト） | plugin bundled `templates/`（Claude Code: `.claude/plugins/sdd/templates/` / Codex: `plugins/sdd/templates/` または skill 相対 `../../templates/`） | プラグイン同梱のデフォルト |

詳細は `spec/_custom/README.md` を参照。

## 新規プロジェクトへの導入

`/sdd:init`（Claude Code）または `init` skill（Codex）を実行すると、プロジェクトのコードベースと既存ドキュメントを調査し、SDD に必要な構造を自動構築する。

## 構成の役割分担

| 層 | 場所 | 役割 |
|---|---|---|
| フレームワーク | SDD プラグイン (`templates/`) | ワークフロー定義・テンプレート |
| プロジェクト設定 | `spec/_custom/` | ステアリング・テンプレートオーバーライド |
| 統合層 | SDD プラグイン (`skills/`, `commands/`) | Claude Code command と Codex wrapper skill の runtime 差分吸収 |
