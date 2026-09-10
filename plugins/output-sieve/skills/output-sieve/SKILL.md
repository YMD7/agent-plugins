---
name: output-sieve
description: Run a project's approved build, lint, or test profile with bounded output when raw command logs would add avoidable context. Use for full or broad project checks when `.agents/output-sieve/config.json` exists. Do not use for interactive commands, narrow one-file diagnostics, or commands outside the configured profiles.
---

# Output Sieve

Use the project-pinned CLI instead of invoking an approved broad check directly:

```bash
node .agents/output-sieve/cli/output-sieve.mjs run <profile>
```

Choose only a profile declared in `.agents/output-sieve/config.json`. Do not add arguments or
replace the configured command. The config must be committed and unchanged from `HEAD`. Run from
the Git worktree that owns the files being validated.

The JSON response includes the child status, duration, output size, bounded highlights, and a
Git-ignored full log path. Treat the child exit code as the validation result.

- On success, report the structured result without reading the full log.
- On failure, use the bounded highlights first. Read only a focused range from the full log when
  those highlights are insufficient to identify the cause.
- Use the underlying command directly when raw output is the object of investigation or when no
  applicable profile exists.
- Do not use Output Sieve to run commands that may print secrets. Adding or changing profiles is a
  project configuration change and requires the normal review process.
