import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(pluginRoot, "cli", "output-sieve.mjs");

async function git(root, args) {
  await execFileAsync("git", ["-C", root, ...args]);
}

async function createRepository(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "output-sieve-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await git(root, ["config", "user.name", "Output Sieve Test"]);
  await mkdir(path.join(root, ".agents", "output-sieve"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), options.gitignore ?? ".tmp/\n");
  await git(root, ["add", "--", ".gitignore"]);
  return root;
}

async function writeConfig(root, config, { tracked = true } = {}) {
  const relativePath = ".agents/output-sieve/config.json";
  await writeFile(path.join(root, relativePath), `${JSON.stringify(config, null, 2)}\n`);
  if (tracked) {
    await git(root, ["add", "--", relativePath]);
    await git(root, ["commit", "--quiet", "--no-gpg-sign", "-m", "add test config"]);
  }
}

function baseConfig(command, overrides = {}) {
  return {
    logDirectory: ".tmp/output-sieve",
    maxHighlights: 8,
    profiles: {
      check: { command },
    },
    ...overrides,
  };
}

async function runCli(root, args = ["run", "check"]) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: root,
      maxBuffer: 1024 * 1024,
    });
    return { code: 0, ...result };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      signal: error.signal ?? null,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

test("returns bounded JSON and stores an owner-only full log", async (t) => {
  const root = await createRepository(t);
  await writeConfig(
    root,
    baseConfig([
      process.execPath,
      "-e",
      "console.log('Tests 12 passed'); console.error('Warning: known warning')",
    ]),
  );

  const result = await runCli(root);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const response = JSON.parse(result.stdout);
  assert.equal(response.profile, "check");
  assert.equal(response.status, "passed");
  assert.equal(response.exitCode, 0);
  assert.equal(response.signal, null);
  assert.equal(response.output.lines, 2);
  assert.equal(response.output.warningLines, 1);
  assert.deepEqual(response.highlights, ["Tests 12 passed", "Warning: known warning"]);
  assert.match(response.log, /^\.tmp\/output-sieve\/check-/);

  const logPath = path.join(root, response.log);
  assert.match(await readFile(logPath, "utf8"), /Tests 12 passed/);
  assert.equal((await stat(logPath)).mode & 0o777, 0o600);
});

test("preserves a failing exit code and bounds duplicate diagnostics", async (t) => {
  const root = await createRepository(t);
  const script = [
    "for (let index = 0; index < 100; index += 1) {",
    "  console.error(`src/file-${index}.ts: error TS2307: missing module`);",
    "}",
    "process.exit(7);",
  ].join("\n");
  await writeConfig(root, baseConfig([process.execPath, "-e", script], { maxHighlights: 4 }));

  const result = await runCli(root);
  assert.equal(result.code, 7);
  const response = JSON.parse(result.stdout);
  assert.equal(response.status, "failed");
  assert.equal(response.exitCode, 7);
  assert.equal(response.output.lines, 100);
  assert.equal(response.output.errorLines, 100);
  assert.equal(response.highlights.length, 4);
  assert.ok(result.stdout.length < 1_500);
});

test("keeps large successful output out of stdout", async (t) => {
  const root = await createRepository(t);
  const script = [
    "for (let index = 0; index < 5000; index += 1) {",
    "  console.log(`ordinary output ${index}`);",
    "}",
    "console.log('Tests 5000 passed');",
  ].join("\n");
  await writeConfig(root, baseConfig([process.execPath, "-e", script]));

  const result = await runCli(root);
  assert.equal(result.code, 0);
  const response = JSON.parse(result.stdout);
  assert.equal(response.output.lines, 5001);
  assert.deepEqual(response.highlights, ["Tests 5000 passed"]);
  assert.ok(result.stdout.length < 1_000);
  assert.ok((await stat(path.join(root, response.log))).size > 100_000);
});

test("reports a child signal with its conventional exit code", async (t) => {
  const root = await createRepository(t);
  await writeConfig(
    root,
    baseConfig([process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"]),
  );

  const result = await runCli(root);
  assert.equal(result.code, 143);
  const response = JSON.parse(result.stdout);
  assert.equal(response.status, "signaled");
  assert.equal(response.signal, "SIGTERM");
  assert.equal(response.exitCode, 143);
});

test("rejects unknown profiles and extra CLI arguments", async (t) => {
  const root = await createRepository(t);
  await writeConfig(root, baseConfig([process.execPath, "-e", "process.exit(0)"]));

  const unknown = await runCli(root, ["run", "missing"]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /Unknown profile/);

  const extra = await runCli(root, ["run", "check", "--extra"]);
  assert.equal(extra.code, 1);
  assert.match(extra.stderr, /Usage/);
});

test("requires a tracked config and an ignored log directory", async (t) => {
  const untrackedRoot = await createRepository(t);
  await writeConfig(
    untrackedRoot,
    baseConfig([process.execPath, "-e", "process.exit(0)"]),
    { tracked: false },
  );
  const untracked = await runCli(untrackedRoot);
  assert.equal(untracked.code, 1);
  assert.match(untracked.stderr, /must be Git-tracked/);

  const visibleRoot = await createRepository(t, { gitignore: "node_modules/\n" });
  await writeConfig(visibleRoot, baseConfig([process.execPath, "-e", "process.exit(0)"]));
  const visible = await runCli(visibleRoot);
  assert.equal(visible.code, 1);
  assert.match(visible.stderr, /must be ignored by Git/);
});

test("rejects a config that differs from HEAD", async (t) => {
  const root = await createRepository(t);
  const config = baseConfig([process.execPath, "-e", "process.exit(0)"]);
  await writeConfig(root, config);
  config.profiles.check.command = [process.execPath, "-e", "console.log('changed')"];
  await writeFile(
    path.join(root, ".agents", "output-sieve", "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );

  const result = await runCli(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must match HEAD/);
});

test("rejects log directories outside the root or through a symlink", async (t) => {
  const outsideRoot = await createRepository(t);
  await writeConfig(
    outsideRoot,
    baseConfig([process.execPath, "-e", "process.exit(0)"], { logDirectory: "../logs" }),
  );
  const outside = await runCli(outsideRoot);
  assert.equal(outside.code, 1);
  assert.match(outside.stderr, /subdirectory of the Git root/);

  const symlinkRoot = await createRepository(t, { gitignore: ".tmp-link/\n" });
  const target = await mkdtemp(path.join(os.tmpdir(), "output-sieve-target-"));
  t.after(async () => rm(target, { recursive: true, force: true }));
  await symlink(target, path.join(symlinkRoot, ".tmp-link"));
  await writeConfig(
    symlinkRoot,
    baseConfig([process.execPath, "-e", "process.exit(0)"], {
      logDirectory: ".tmp-link/output-sieve",
    }),
  );
  const linked = await runCli(symlinkRoot);
  assert.equal(linked.code, 1);
  assert.match(linked.stderr, /symlink components/);
});

test("rejects Git internal paths for logs", async (t) => {
  const root = await createRepository(t, { gitignore: ".git/output-sieve/\n" });
  await writeConfig(
    root,
    baseConfig([process.execPath, "-e", "process.exit(0)"], {
      logDirectory: ".git/output-sieve",
    }),
  );

  const result = await runCli(root);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must not use Git internal paths/);
});
