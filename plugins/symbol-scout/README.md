# Symbol Scout

Symbol Scout queries project-approved local language servers and returns bounded JSON locations.
It helps Codex and Claude Code locate a symbol or its references before reading source ranges.

## Safety boundary

- Server commands come from project config that is committed and unchanged from `HEAD`.
- Source files and language roots must stay inside the Git worktree.
- Child processes use argv execution with `shell: false`.
- Results exclude locations outside the project and enforce item and byte limits.
- Language-server stderr is bounded internally and is not emitted into agent context.
- Optional scratch data must stay in a Git-ignored project directory.

Language servers run as local processes; Symbol Scout does not send source to an external model.
Use only in trusted repositories because a language server may inspect project configuration.

## Development

```bash
npm test
node cli/symbol-scout.mjs --help
```

## Project installation

Copy the selected revision into `.agents/symbol-scout/`, copy the Skill into
`.agents/skills/symbol-scout/`, and record the immutable revision in the project asset inventory.
Claude Code should symlink `.claude/skills/symbol-scout` to the shared Skill.

Copy `adapters/symbol-scout.config.json` to `.agents/symbol-scout/config.json`, review the server
commands, and verify every configured scratch directory is ignored. Example:

```bash
node .agents/symbol-scout/cli/symbol-scout.mjs locate \
  path/to/file.ts symbolName
```
