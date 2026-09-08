---
name: context-shunt
description: Summarize explicitly selected, large tracked source files through a project-local Context Shunt Worker. Use for broad source understanding only after the project has configured Context Shunt; do not use for secrets, untracked files, small files, or ranged reads.
metadata:
  short-description: Summarize large source reads with Context Shunt
---

# Context Shunt

Context Shunt keeps a large full-file read out of the primary agent context. It
accepts only explicitly selected, tracked text files and returns a concise,
structured answer from the project's protected Worker.

Use it when a configured project needs broad understanding of one or more large
source files. Keep ordinary small-file reads, `rg` searches, and ranged reads
local: they are usually faster and preserve useful detail.

## Before use

- Confirm that `.agents/context-shunt/config.json` has a real HTTPS endpoint and
  a positive `lineThreshold` chosen from the project's baseline measurement.
- State a focused question and list only the files needed to answer it.
- Prefer one large file per request. Combine files only when a focused question
  requires their relationship and the total scope remains small.
- Use local search and ranged reads for files larger than 96 KiB. The CLI
  rejects those files, and the full-file guard leaves them readable.
- Do not submit untracked, ignored, generated, secret, credential, or binary
  files. The CLI rejects them, but selecting them is still unnecessary risk.
- If Cloudflare Access login is required, explain that browser OAuth will open
  and obtain the user's approval before running `login`.

## Read a large source set

Run the version pinned in the Git root that owns the selected files. Set the
command workdir to that root. When Codex starts from a primary worktree and
reads a linked worktree by absolute path, use the linked worktree as
`$PROJECT_ROOT` for both the CLI and its paths:

```bash
node "$PROJECT_ROOT/.agents/context-shunt/cli/context-shunt.mjs" \
  bulk-read --question "<focused question>" --paths <path> [<path> ...]
```

Use the JSON result as an orientation aid. Verify important claims with narrow,
ranged local reads before editing code or making a security-sensitive decision.
If the result lists an unknown, perform the smallest targeted follow-up read;
do not resend an entire repository.

If `complete` is `false`, narrow the question or reduce the request to one file
and retry once. If that retry is also incomplete, stop using Context Shunt for
the question and switch to `rg` plus the smallest useful ranged reads.

## Login and diagnosis

With user approval, run one of the following from the project root:

```bash
node "$PROJECT_ROOT/.agents/context-shunt/cli/context-shunt.mjs" login
node "$PROJECT_ROOT/.agents/context-shunt/cli/context-shunt.mjs" doctor
```

`login` and `doctor` may invoke `cloudflared access` and open the configured
identity-provider login page. They do not use a service token or a repository
secret.
