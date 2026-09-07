import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { collectApprovedFiles, isSensitivePath } from "../cli/lib/repository.mjs";

const execFileAsync = promisify(execFile);

async function git(root, args) {
  await execFileAsync("git", ["-C", root, ...args]);
}

async function createRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "context-shunt-test-"));
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await git(root, ["config", "user.name", "Context Shunt Test"]);
  t.after(async () => rm(root, { recursive: true, force: true }));
  return root;
}

async function track(root, relativePath) {
  await git(root, ["add", "--", relativePath]);
}

test("accepts a tracked UTF-8 text file", async (t) => {
  const root = await createRepository(t);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "approved.js"), "export const value = 1;\n");
  await track(root, "src/approved.js");

  const files = await collectApprovedFiles(root, ["src/approved.js"]);
  assert.deepEqual(files, [{ path: "src/approved.js", content: "export const value = 1;\n" }]);
});

test("rejects paths that are untracked, ignored, sensitive, binary, or symlinked", async (t) => {
  const root = await createRepository(t);
  await writeFile(path.join(root, ".gitignore"), "ignored.txt\n");
  await writeFile(path.join(root, "tracked.txt"), "tracked\n");
  await writeFile(path.join(root, "untracked.txt"), "untracked\n");
  await writeFile(path.join(root, "ignored.txt"), "ignored\n");
  await writeFile(path.join(root, ".env"), "VALUE=secret\n");
  await writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2]));
  await writeFile(path.join(root, "target.txt"), "target\n");
  await symlink("target.txt", path.join(root, "linked.txt"));
  await track(root, ".gitignore");
  await track(root, "tracked.txt");
  await track(root, "binary.bin");
  await track(root, "target.txt");
  await git(root, ["add", "--force", "--", ".env"]);

  await assert.rejects(
    () => collectApprovedFiles(root, ["untracked.txt"]),
    /Git-tracked files only/,
  );
  await assert.rejects(
    () => collectApprovedFiles(root, ["ignored.txt"]),
    /Git-tracked files only/,
  );
  await assert.rejects(
    () => collectApprovedFiles(root, [".env"]),
    /secret or credential paths/,
  );
  await assert.rejects(
    () => collectApprovedFiles(root, ["binary.bin"]),
    /binary files/,
  );
  await assert.rejects(
    () => collectApprovedFiles(root, ["linked.txt"]),
    /not symlinks/,
  );
});

test("enforces the aggregate payload limit", async (t) => {
  const root = await createRepository(t);
  await writeFile(path.join(root, "one.txt"), "12345");
  await writeFile(path.join(root, "two.txt"), "67890");
  await track(root, "one.txt");
  await track(root, "two.txt");

  await assert.rejects(
    () => collectApprovedFiles(root, ["one.txt", "two.txt"], {
      maxFiles: 2,
      maxFileBytes: 10,
      maxTotalBytes: 9,
    }),
    /total payload limit/,
  );
});

test("rejects a path outside the Git root before reading it", async (t) => {
  const root = await createRepository(t);
  const outsideName = `${path.basename(root)}-outside.txt`;
  const outside = path.join(path.dirname(root), outsideName);
  await writeFile(outside, "outside\n");
  t.after(async () => rm(outside, { force: true }));

  await assert.rejects(
    () => collectApprovedFiles(root, [`../${outsideName}`]),
    /inside the Git root only/,
  );
});

test("recognizes configured secret-style paths", () => {
  assert.equal(isSensitivePath(".env.production"), true);
  assert.equal(isSensitivePath("keys/deploy.pem"), true);
  assert.equal(isSensitivePath("src/credentials.json"), true);
  assert.equal(isSensitivePath("src/regular.ts"), false);
});
