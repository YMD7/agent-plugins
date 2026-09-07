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
  await mkdir(path.join(root, ".agents", "context-shunt"), { recursive: true });
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, ".agents", "context-shunt", "config.json"),
    JSON.stringify({ endpoint: "https://context-shunt.example.test", lineThreshold: 2 }),
  );
  await writeFile(path.join(root, "src", "large.js"), "one\ntwo\nthree\n");
  await writeFile(path.join(root, "src", "small.js"), "one\ntwo\n");
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
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
