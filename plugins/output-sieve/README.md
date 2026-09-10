# Output Sieve

Output Sieve runs project-approved non-interactive checks while returning a bounded JSON summary to
Codex or Claude Code. Full output is written to a Git-ignored, owner-only log so an agent can inspect
a focused range only when a check fails.

## Safety boundary

- Commands come only from project config that is committed and unchanged from `HEAD`; CLI arguments
  cannot alter them.
- Child processes use argv execution with `shell: false`.
- The log directory must stay inside the Git root, be ignored, and contain no tracked files.
- Log files are created with mode `0600`.
- Summary highlights and diagnostic counts are bounded.
- The CLI does not install dependencies, mutate config, or delete logs.

Only configure checks that are not expected to emit secrets. Output Sieve reduces context exposure;
it is not a secret-redaction boundary.

## Development

```bash
npm test
node cli/output-sieve.mjs --help
```

## Project installation

Copy the selected revision into `.agents/output-sieve/`, copy the Skill into
`.agents/skills/output-sieve/`, and record the immutable revision in the project asset inventory.
Claude Code should symlink `.claude/skills/output-sieve` to the shared Skill.

Copy `adapters/output-sieve.config.json` to `.agents/output-sieve/config.json`, review every profile,
and verify the configured `logDirectory` is ignored. Run an approved profile with:

```bash
node .agents/output-sieve/cli/output-sieve.mjs run build
```
