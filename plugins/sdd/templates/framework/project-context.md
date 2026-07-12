# Project Context Resolution

SDD の汎用ワークフローを実行する前に、対象リポジトリの固有ルールを次の順で解決する。

1. リポジトリルートの `AGENTS.md` または `CLAUDE.md`
2. `spec/_custom/steering/` 配下の全 `.md`
3. 上記ファイルが作業別の入口として直接指定する `docs/` 内の文書

`docs/` を網羅読みせず、現在の command に関係する入口だけを読む。相対パスは対象リポジトリルートから解決する。

## 適用規則

- plugin の workflow と矛盾しない project rule は追加制約として適用する。
- 矛盾がある場合は黙って統合せず、差分を示してユーザー判断を待つ。
- project rule が worktree base、branch、VCS、承認、検証、script、review gate を具体化している場合は、その指定を汎用既定より優先する。
- project script を使う場合は、リポジトリ内の tracked な相対パスであることを確認する。リポジトリ外、`..` を含むパス、未追跡script、secret値を引数へ展開するscriptは実行しない。
- project context にsecret値、token、credential、個人情報が含まれる場合は値を転記・出力せず、設定名と必要条件だけを扱う。

## Review Context

独立reviewerへ委譲する場合、親agentがproject contextから今回の対象に必要なreview checklistを抽出し、レビュープロンプトへ本文として埋め込む。単にファイルパスだけを渡して、reviewerが読めると仮定してはならない。

埋め込む内容は現在のreview targetに限定し、無関係な文書、secret、raw log、個人情報を含めない。
