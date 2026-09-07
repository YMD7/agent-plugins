import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { createPreToolUseDecision } from "../cli/lib/hook-guard.mjs";

const execFileAsync = promisify(execFile);

async function createRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "context-shunt-hook-"));
  await execFileAsync("git", ["-C", root, "init", "--quiet"]);
  await execFileAsync("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  await execFileAsync("git", ["-C", root, "config", "user.name", "Context Shunt Test"]);
  await mkdir(path.join(root, ".agents", "context-shunt"), { recursive: true });
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, ".agents", "context-shunt", "config.json"),
    JSON.stringify({ endpoint: "https://context-shunt.example.test", lineThreshold: 2 }),
  );
  await writeFile(path.join(root, "src", "large.js"), "one\ntwo\nthree\n");
  await writeFile(path.join(root, "src", "small.js"), "one\ntwo\n");
  await writeFile(
    path.join(root, "src", "oversized.js"),
    `${"x".repeat(96 * 1024)}\ntwo\nthree\n`,
  );
  await writeFile(path.join(root, "src", "untracked.js"), "one\ntwo\nthree\n");
  await writeFile(path.join(root, ".gitignore"), "src/ignored.js\n");
  await writeFile(path.join(root, "src", "ignored.js"), "one\ntwo\nthree\n");
  await writeFile(path.join(root, ".env.large"), "one\ntwo\nthree\n");
  await writeFile(path.join(root, "src", "binary.js"), Buffer.from("one\ntwo\nthree\n\0"));
  await execFileAsync("git", [
    "-C",
    root,
    "add",
    "src/large.js",
    "src/small.js",
    "src/oversized.js",
    "src/binary.js",
    ".agents/context-shunt/config.json",
    ".gitignore",
  ]);
  await execFileAsync("git", ["-C", root, "commit", "--quiet", "-m", "Test fixture"]);
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

async function createWorktree(root) {
  const worktree = `${root} worktree`;
  await execFileAsync("git", [
    "-C",
    root,
    "worktree",
    "add",
    "--quiet",
    "-b",
    "test-worktree",
    worktree,
  ]);
  return worktree;
}

test("blocks only configured large full-file reads", async (t) => {
  const root = await createRepository(t);
  const blocked = await createPreToolUseDecision({
    tool_name: "Read",
    tool_input: { file_path: "src/large.js" },
  }, root);

  assert.equal(blocked.hookSpecificOutput.permissionDecision, "deny");
  assert.match(blocked.hookSpecificOutput.permissionDecisionReason, /3 lines; threshold 2/);

  const ranged = await createPreToolUseDecision({
    tool_name: "Read",
    tool_input: { file_path: "src/large.js", offset: 1, limit: 10 },
  }, root);
  assert.equal(ranged, null);

  const small = await createPreToolUseDecision({
    tool_name: "Read",
    tool_input: { file_path: "src/small.js" },
  }, root);
  assert.equal(small, null);

  const oversized = await createPreToolUseDecision({
    tool_name: "Read",
    tool_input: { file_path: "src/oversized.js" },
  }, root);
  assert.equal(oversized, null);

  for (const filePath of ["src/untracked.js", "src/ignored.js", ".env.large", "src/binary.js"]) {
    const unsupported = await createPreToolUseDecision({
      tool_name: "Read",
      tool_input: { file_path: filePath },
    }, root);
    assert.equal(unsupported, null);
  }
});

test("does not inspect non-read tool calls or paths outside the Git root", async (t) => {
  const root = await createRepository(t);
  const write = await createPreToolUseDecision({
    tool_name: "Write",
    tool_input: { file_path: "src/large.js" },
  }, root);
  const outside = await createPreToolUseDecision({
    tool_name: "mcp__filesystem__read_file",
    tool_input: { path: "../outside.txt" },
  }, root);

  assert.equal(write, null);
  assert.equal(outside, null);
});

test("uses the target worktree configuration for absolute file paths", async (t) => {
  const root = await createRepository(t);
  const worktree = await createWorktree(root);
  try {
    await writeFile(
      path.join(root, ".agents", "context-shunt", "config.json"),
      JSON.stringify({ endpoint: "https://context-shunt.example.test", lineThreshold: null }),
    );

    const blocked = await createPreToolUseDecision({
      tool_name: "Read",
      tool_input: { file_path: path.join(worktree, "src", "large.js") },
    }, root);

    assert.equal(blocked.hookSpecificOutput.permissionDecision, "deny");
    assert.match(blocked.hookSpecificOutput.permissionDecisionReason, /3 lines; threshold 2/);
  } finally {
    await execFileAsync("git", ["-C", root, "worktree", "remove", "--force", worktree]);
  }
});
