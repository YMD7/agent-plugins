# Context Shunt

Context Shunt は、明示された大きなソースファイルの全読込を Cloudflare Worker
へ委譲し、Codex / Claude Code には短い構造化要約だけを返す project-local の
開発支援ツールである。Spotify Portal の
[Shunt](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt) から
着想を得た独自実装であり、Portal を使用せず、同コードの fork でもない。

## PoC の範囲

- Marketplace には登録しない。グローバルな hook、MCP、常駐プロセスも作らない。
- CLI は Git 追跡済みの通常テキストだけを送信し、未追跡・ignore・secret 候補・
  binary・root 外への symlink を拒否する。
- 許可された本文は推論のため Cloudflare Workers AI へ送信される。Cloudflare 側で
  永続保存しない設計でも、外部推論へ送る判断はプロジェクト単位で明示的に行う。
- Worker は Access OAuth で保護し、Workers AI と AI Gateway を利用する。
  Gateway の request / response log は `collectLog: false`、cache は無効とする。
- Worker Logs / Traces の sampling は `0` で開始する。本文・要約をログや
  telemetry metadata に出力しない。
- Cloudflare への deploy、Access application / policy 作成、OAuth 初回 login は
  この repository の CLI が自動実行しない手動作業である。

`wrangler.jsonc` のモデルは PoC の比較候補であり、評価結果に基づいて変更する。
`AI_GATEWAY_ID` は既存の Gateway 名を明示する。`default` を指定して Gateway を
暗黙作成しない。

## 開発

Node.js 20 以降、Git、`cloudflared`、`curl` が必要である。ローカル unit test は
Cloudflare account を使わない。

```bash
npm test
npm run test:worker
node cli/context-shunt.mjs --help
```

Worker の deploy 前には、依存を導入したうえで Worker runtime test を実行し、
`wrangler.jsonc` を対象 version の schema で検証する。JavaScript 実装のため
`wrangler types` は不要である。
runtime test は Workers AI binding をモックするため、Cloudflare account へ接続せず、
AI usage を発生させない。
deploy はユーザー承認下の手動作業とし、この CLI は実行しない。

## プロジェクトへ導入する時

ここでの source を、導入する revision を記録したうえで対象プロジェクトの
`.agents/context-shunt/` に配置する。symlink で本 repository の作業 tree を参照
しない。Claude Code には同じ Skill を `.claude/skills/context-shunt` から
`.agents/skills/context-shunt` へ symlink する。

1. `adapters/context-shunt.config.json` を
   `.agents/context-shunt/config.json` へコピーし、Access 保護済みの HTTPS endpoint
   と、ベースライン計測後に決めた正の `lineThreshold` を設定する。endpoint は
   secret ではないが、placeholder のまま commit しない。
2. `skills/context-shunt/` を `.agents/skills/context-shunt/` に配置する。
3. Codex は `adapters/codex/hooks.json` の `PreToolUse` を project-local
   `.codex/hooks.json` に統合する。Claude Code は
   `adapters/claude/settings.json` の同じ hook を project-local
   `.claude/settings.json` に統合する。既存 hook を置換しない。
4. どちらの hook も project root の version-pinned CLI を `node` で実行する。
   初回は hook 定義をレビューして信頼済みにする。
5. `node .agents/context-shunt/cli/context-shunt.mjs doctor` を実行し、必要な時だけ
   ユーザー承認のもと `login` で Access OAuth を行う。

Codex hook は直接読取を要約へ置換できないため、Context Shuntが受け付け可能な
大きな範囲指定なし read だけを拒否して CLI を案内する。96 KiBを超えるファイルは
CLIが受け付けないため、hookは拒否せず、`rg`と範囲指定readで調べる。`offset`または
`limit`を伴う read、編集、`rg`などの絞込み検索は妨げない。`lineThreshold`が未設定の
場合、hookは何も拒否しない。

## CLI

プロジェクトの `.agents/context-shunt/config.json` を参照する。

```bash
node .agents/context-shunt/cli/context-shunt.mjs login
node .agents/context-shunt/cli/context-shunt.mjs doctor
node .agents/context-shunt/cli/context-shunt.mjs \
  bulk-read --question "この層の責務は何か" --paths src/a.ts src/b.ts
```

`bulk-read` は、回答、ファイル別の根拠、不明点、使用モデル、取得できた token 数、
遅延を JSON で返す。本文、Access credential、OAuth token は標準出力・エラー・
永続ログへ出力しない。`login` はブラウザ認証を開始するが、`cloudflared` が標準出力へ
表示する Access token は破棄する。token をチャットや issue へ貼り付けない。

## 評価

実際の大きな読取を必要とするタスクを少なくとも 5 件選び、直接読取と Context
Shunt を別セッションで比べる。Codex / Claude Code に渡る量、Workers AI の token
数と費用、遅延、要約の正確さ、追加読取の量を記録し、ベースライン後に合意した
成功基準で採否を判断する。
