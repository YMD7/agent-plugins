import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { boundedResponse, parseInvocation, safeEnvironment } from "../cli/symbol-scout.mjs";

const execFileAsync = promisify(execFile);
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(pluginRoot, "cli", "symbol-scout.mjs");
const fakeServerPath = path.join(pluginRoot, "tests", "fake-lsp-server.mjs");

async function git(root, args) {
  await execFileAsync("git", ["-C", root, ...args]);
}

function baseConfig(overrides = {}) {
  const serverOverrides = overrides.server ?? {};
  return {
    maxItems: overrides.maxItems ?? 5,
    maxOutputBytes: overrides.maxOutputBytes ?? 2048,
    requestTimeoutMs: overrides.requestTimeoutMs ?? 2000,
    servers: {
      fake: {
        extensions: [".ts"],
        languageIds: { ".ts": "typescript" },
        command: [process.execPath, fakeServerPath, ...(overrides.serverArgs ?? [])],
        rootMarkers: ["tsconfig.json"],
        readyDelayMs: 0,
        contentModifiedRetries: 0,
        ...serverOverrides,
      },
    },
  };
}

async function createRepository(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "symbol-scout-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "--quiet"]);
  await git(root, ["config", "user.email", "test@example.invalid"]);
  await git(root, ["config", "user.name", "Symbol Scout Test"]);
  await mkdir(path.join(root, ".agents", "symbol-scout"), { recursive: true });
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), ".tmp/\n");
  await writeFile(path.join(root, "tsconfig.json"), "{}\n");
  await writeFile(path.join(root, "src", "main.ts"), "class Container { member() {} }\n");
  await writeFile(
    path.join(root, ".agents", "symbol-scout", "config.json"),
    `${JSON.stringify(baseConfig(overrides), null, 2)}\n`,
  );
  if (overrides.untrackedConfig) {
    await git(root, ["add", "--", ".gitignore", "tsconfig.json", "src/main.ts"]);
  } else {
    await git(root, [
      "add",
      "--",
      ".gitignore",
      "tsconfig.json",
      "src/main.ts",
      ".agents/symbol-scout/config.json",
    ]);
  }
  await git(root, ["commit", "--quiet", "--no-gpg-sign", "-m", "add fixture"]);
  return root;
}

async function runCli(root, args, environment = {}) {
  try {
    const result = await execFileAsync(process.execPath, [cliPath, ...args], {
      cwd: root,
      env: { ...process.env, ...environment },
      maxBuffer: 1024 * 1024,
      timeout: 8000,
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

test("outline returns only bounded top-level symbols", async (t) => {
  const root = await createRepository(t);
  const result = await runCli(root, ["outline", "src/main.ts"]);

  assert.equal(result.code, 0);
  const response = JSON.parse(result.stdout);
  assert.equal(response.action, "outline");
  assert.equal(response.totalCount, 81);
  assert.equal(response.returnedCount, 5);
  assert.equal(response.truncated, true);
  assert.equal(response.items[0].name, "Container");
  assert.ok(Buffer.byteLength(result.stdout) < 2048);
});

test("outline parent and locate select nested exact symbols", async (t) => {
  const root = await createRepository(t);
  const outline = await runCli(root, ["outline", "src/main.ts", "Container"]);
  const located = await runCli(root, ["locate", "src/main.ts", "member"]);

  assert.equal(outline.code, 0);
  assert.deepEqual(JSON.parse(outline.stdout).items.map((item) => item.name), ["member"]);
  assert.equal(located.code, 0);
  assert.deepEqual(JSON.parse(located.stdout).items[0].start, [2, 3]);
});

test("references retries content-modified and omits external locations", async (t) => {
  const root = await createRepository(t, {
    serverArgs: ["--content-modified-once"],
    server: { contentModifiedRetries: 2 },
  });
  const result = await runCli(root, ["references", "src/main.ts", "1", "7"]);

  assert.equal(result.code, 0);
  const response = JSON.parse(result.stdout);
  assert.equal(response.totalCount, 61);
  assert.equal(response.omittedExternal, 1);
  assert.equal(response.returnedCount, 5);
  assert.equal(response.truncated, true);
  assert.ok(response.items.every((item) => item.file === "src/main.ts"));
  assert.equal(response.items[0].ranges.length, 5);
});

test("definition normalizes one-based project locations", async (t) => {
  const root = await createRepository(t);
  const result = await runCli(root, ["definition", "src/main.ts", "1", "7"]);

  assert.equal(result.code, 0);
  const response = JSON.parse(result.stdout);
  assert.equal(response.totalCount, 2);
  assert.equal(response.omittedExternal, 1);
  assert.deepEqual(response.items[0].ranges[0][0], [1, 2]);
});

test("rejects untracked and dirty configuration", async (t) => {
  const untrackedRoot = await createRepository(t, { untrackedConfig: true });
  const untracked = await runCli(untrackedRoot, ["outline", "src/main.ts"]);
  assert.equal(untracked.code, 1);
  assert.match(untracked.stderr, /must be Git-tracked/);

  const dirtyRoot = await createRepository(t);
  const configPath = path.join(dirtyRoot, ".agents", "symbol-scout", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  config.maxItems = 6;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const dirty = await runCli(dirtyRoot, ["outline", "src/main.ts"]);
  assert.equal(dirty.code, 1);
  assert.match(dirty.stderr, /must match HEAD/);
});

test("rejects source paths outside the project through symlinks", async (t) => {
  const root = await createRepository(t);
  const outside = path.join(os.tmpdir(), `symbol-scout-outside-${process.pid}.ts`);
  await writeFile(outside, "export const outside = true\n");
  t.after(async () => rm(outside, { force: true }));
  await symlink(outside, path.join(root, "src", "outside.ts"));

  const result = await runCli(root, ["outline", "src/outside.ts"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must stay inside the Git root/);
});

test("uses only ignored project scratch storage", async (t) => {
  const root = await createRepository(t, {
    server: {
      scratchDirectory: ".tmp/symbol-scout",
      scratchArgument: "--scratch-path",
    },
  });
  const result = await runCli(root, ["outline", "src/main.ts"]);

  assert.equal(result.code, 0);
  const scratch = path.join(root, ".tmp", "symbol-scout");
  assert.equal((await git(root, ["check-ignore", "--quiet", "--no-index", "--", scratch])), undefined);
});

test("rejects a symlinked per-language scratch target", async (t) => {
  const root = await createRepository(t, {
    server: {
      scratchDirectory: ".tmp/symbol-scout",
      scratchArgument: "--scratch-path",
    },
  });
  const scratch = path.join(root, ".tmp", "symbol-scout");
  const outside = await mkdtemp(path.join(os.tmpdir(), "symbol-scout-scratch-"));
  t.after(async () => rm(outside, { recursive: true, force: true }));
  await mkdir(scratch, { recursive: true });
  const digest = createHash("sha256").update(await realpath(root)).digest("hex").slice(0, 12);
  await symlink(outside, path.join(scratch, `fake-${digest}`));

  const result = await runCli(root, ["outline", "src/main.ts"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /scratch target must not contain symlink/);
});

test("fails with bounded output when a server request times out", async (t) => {
  const root = await createRepository(t, {
    requestTimeoutMs: 1000,
    serverArgs: ["--hang"],
  });
  const result = await runCli(root, ["outline", "src/main.ts"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /timed out/);
  assert.ok(result.stderr.length < 300);
});

test("bounds serialized responses and excludes secret-bearing environment keys", () => {
  const response = boundedResponse(
    { action: "outline" },
    Array.from({ length: 50 }, (_, index) => ({ name: `symbol-${index}-${"x".repeat(200)}` })),
    50,
    { maxItems: 50, maxOutputBytes: 1024 },
  );
  assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 1024);
  assert.equal(response.truncated, true);

  const environment = safeEnvironment({
    PATH: "/bin",
    HOME: "/tmp/home",
    CLOUDFLARE_API_TOKEN: "secret",
    DATABASE_URL: "secret",
  });
  assert.deepEqual(environment, { PATH: "/bin", HOME: "/tmp/home" });
});

test("validates the fixed invocation surface", () => {
  assert.deepEqual(parseInvocation(["definition", "src/main.ts", "3", "4"]), {
    action: "definition",
    file: "src/main.ts",
    position: { line: 2, character: 3 },
  });
  assert.throws(() => parseInvocation(["references", "src/main.ts", "0", "1"]));
  assert.throws(() => parseInvocation(["locate", "src/main.ts", "name", "--extra"]));
  assert.throws(() => parseInvocation(["outline", "src/main.ts", "x".repeat(257)]));
});
