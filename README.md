# claude-plugins

Claude Code / Codex 向けプラグインのモノレポ。

## Plugins

| Plugin | Description |
|--------|-------------|
| [sdd](./plugins/sdd/) | Spec-Driven Development framework for Claude Code / Codex |
| [terse-mode](./plugins/terse-mode/) | Output token reduction mode for Claude Code workflows |

## Usage

### Codexで使う（ローカルマーケットプレイス）

Codex向けmanifestは `plugins/sdd/.codex-plugin/plugin.json`、ローカルマーケットプレイスは `.agents/plugins/marketplace.json` に配置している。

```bash
codex plugin marketplace add /absolute/path/to/claude-plugins/.agents/plugins
codex plugin install sdd@ymd7-plugins
```

Codexでは `spec` / `init` / `spec-review` / `create-worktree` / `cleanup-worktree` / `fix-review` / `plan-task` skill を使う。

### Claude Codeで一時的に使う（セッション単位）

```bash
claude --plugin-dir ./plugins/sdd
```

### Claude Codeプロジェクトに導入する（永続）

1. 導入先プロジェクトの `.claude/plugins/` にプラグインを配置する（コピーまたはシンボリックリンク）

2. `.claude/plugins/.claude-plugin/marketplace.json` を作成する

```json
{
  "name": "<marketplace-name>",
  "description": "Project-local plugins",
  "owner": { "name": "<owner>" },
  "plugins": [
    {
      "name": "sdd",
      "description": "Spec-Driven Development framework for Claude Code",
      "source": "./sdd",
      "category": "development"
    }
  ]
}
```

3. ローカルマーケットプレイスを登録し、プラグインをインストールする

```bash
claude plugin marketplace add /absolute/path/to/.claude/plugins --scope project
claude plugin install sdd@<marketplace-name> --scope project
```

インストール後はセッションを跨いでも自動的に読み込まれる。

## Development

SDD create-worktree executorのテスト:

```bash
bash plugins/sdd/tests/test-create-worktree.sh
```
