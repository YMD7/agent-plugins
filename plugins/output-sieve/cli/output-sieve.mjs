#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

const VERSION = "0.1.0";
const CONFIG_PATH = ".agents/output-sieve/config.json";
const PROFILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_COMMAND_PARTS = 16;
const MAX_COMMAND_PART_LENGTH = 512;
const MAX_HIGHLIGHT_LENGTH = 240;

class CliError extends Error {}

function printHelp() {
  process.stdout.write(`Output Sieve ${VERSION}

Usage:
  output-sieve run <profile>
  output-sieve help
  output-sieve version

Profiles and the ignored log directory come from ${CONFIG_PATH}.
`);
}

function runGit(root, args, options = {}) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return null;
    }
    throw new CliError("Output Sieve requires a Git worktree.", { cause: error });
  }
}

function resolveGitRoot(cwd = process.cwd()) {
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  return realpathSync(root);
}

function assertInsideRoot(root, target, label) {
  const relative = path.relative(root, target);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new CliError(`${label} must be a subdirectory of the Git root.`);
  }
  return relative.split(path.sep).join("/");
}

function assertNoSymlinkComponents(root, relativePath) {
  let current = root;
  for (const part of relativePath.split("/")) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new CliError("logDirectory must not contain symlink components.");
      }
    } catch (error) {
      if (error instanceof CliError) {
        throw error;
      }
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
  }
}

function validateCommand(command) {
  if (!Array.isArray(command) || command.length === 0 || command.length > MAX_COMMAND_PARTS) {
    throw new CliError(`profile command must contain 1-${MAX_COMMAND_PARTS} argv parts.`);
  }
  if (
    command.some(
      (part) =>
        typeof part !== "string" ||
        part.length === 0 ||
        part.length > MAX_COMMAND_PART_LENGTH ||
        part.includes("\0"),
    )
  ) {
    throw new CliError("profile command contains an invalid argv part.");
  }
  return [...command];
}

function loadConfig(root) {
  const configFile = path.join(root, CONFIG_PATH);
  if (runGit(root, ["ls-files", "--error-unmatch", "--", CONFIG_PATH], { allowFailure: true }) === null) {
    throw new CliError(`${CONFIG_PATH} must be Git-tracked.`);
  }
  if (runGit(root, ["status", "--porcelain=v1", "--untracked-files=no", "--", CONFIG_PATH])) {
    throw new CliError(`${CONFIG_PATH} must match HEAD before use.`);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configFile, "utf8"));
  } catch (error) {
    throw new CliError(`${CONFIG_PATH} must contain valid JSON.`, { cause: error });
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new CliError("Output Sieve config must be an object.");
  }
  if (!Number.isInteger(config.maxHighlights) || config.maxHighlights < 1 || config.maxHighlights > 20) {
    throw new CliError("maxHighlights must be an integer from 1 to 20.");
  }
  if (!config.profiles || typeof config.profiles !== "object" || Array.isArray(config.profiles)) {
    throw new CliError("profiles must be an object.");
  }

  const profiles = {};
  for (const [name, profile] of Object.entries(config.profiles)) {
    if (!PROFILE_PATTERN.test(name) || !profile || typeof profile !== "object") {
      throw new CliError(`Invalid profile: ${name}`);
    }
    profiles[name] = { command: validateCommand(profile.command) };
  }
  if (Object.keys(profiles).length === 0) {
    throw new CliError("At least one profile is required.");
  }

  if (typeof config.logDirectory !== "string" || path.isAbsolute(config.logDirectory)) {
    throw new CliError("logDirectory must be a relative path.");
  }
  const logDirectory = path.resolve(root, config.logDirectory);
  const logRelative = assertInsideRoot(root, logDirectory, "logDirectory");
  if (logRelative === ".git" || logRelative.startsWith(".git/")) {
    throw new CliError("logDirectory must not use Git internal paths.");
  }
  assertNoSymlinkComponents(root, logRelative);

  const ignoreProbe = `${logRelative}/output-sieve-ignore-probe`;
  if (runGit(root, ["check-ignore", "--quiet", "--no-index", "--", ignoreProbe], { allowFailure: true }) === null) {
    throw new CliError("logDirectory must be ignored by Git.");
  }
  if (runGit(root, ["ls-files", "--", logRelative])) {
    throw new CliError("logDirectory must not contain tracked files.");
  }

  return {
    logDirectory,
    logRelative,
    maxHighlights: config.maxHighlights,
    profiles,
  };
}

function sanitizeLine(line, root) {
  return line
    .replaceAll(root, "$PROJECT_ROOT")
    .replaceAll(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replaceAll("\r", "")
    .trim()
    .slice(0, MAX_HIGHLIGHT_LENGTH);
}

function addUnique(target, seen, line, limit) {
  if (!line || seen.has(line) || target.length >= limit) {
    return;
  }
  seen.add(line);
  target.push(line);
}

class OutputCollector {
  constructor(root, maxHighlights) {
    this.root = root;
    this.maxHighlights = maxHighlights;
    this.bytes = 0;
    this.lines = 0;
    this.warningLines = 0;
    this.errorLines = 0;
    this.errors = [];
    this.warnings = [];
    this.summaries = [];
    this.tail = [];
    this.seen = new Set();
  }

  acceptLine(rawLine) {
    const line = sanitizeLine(rawLine, this.root);
    if (!line) {
      return;
    }
    this.tail.push(line);
    if (this.tail.length > this.maxHighlights) {
      this.tail.shift();
    }

    const isWarning = /(?:\bwarn(?:ing)?\b|⚠|^\(!\))/i.test(line);
    const isError = /(?:\berror(?:\s+(?:TS\d+|command|code)|:)|ERR_|ELIFECYCLE|failed|failure|^✖)/i.test(line);
    const isSummary = /(?:Test Files|Tests\s+\d|Test Suites|Snapshots|Ran all test|built in|Compiled successfully|No ESLint|problems \(|tests? \d+|pass \d+|fail \d+)/i.test(line);

    if (isWarning) {
      this.warningLines += 1;
      addUnique(this.warnings, this.seen, line, this.maxHighlights);
    }
    if (isError) {
      this.errorLines += 1;
      addUnique(this.errors, this.seen, line, this.maxHighlights);
    }
    if (isSummary) {
      addUnique(this.summaries, this.seen, line, this.maxHighlights);
    }
  }

  highlights(failed) {
    const ordered = failed
      ? [...this.errors, ...this.summaries, ...this.warnings, ...this.tail]
      : [...this.summaries, ...this.warnings];
    return [...new Set(ordered)].slice(0, this.maxHighlights);
  }
}

function attachStream(stream, fd, collector) {
  const decoder = new StringDecoder("utf8");
  let pending = "";

  stream.on("data", (chunk) => {
    collector.bytes += chunk.length;
    for (const byte of chunk) {
      if (byte === 10) {
        collector.lines += 1;
      }
    }
    writeSync(fd, chunk);
    const text = pending + decoder.write(chunk);
    const parts = text.split("\n");
    pending = parts.pop() ?? "";
    for (const line of parts) {
      collector.acceptLine(line);
    }
  });

  return () => {
    const final = pending + decoder.end();
    if (final) {
      collector.lines += 1;
      collector.acceptLine(final);
    }
  };
}

function conventionalSignalExitCode(signal) {
  const signalNumber = os.constants.signals[signal];
  return Number.isInteger(signalNumber) ? 128 + signalNumber : 1;
}

async function runProfile(root, config, profileName) {
  if (!PROFILE_PATTERN.test(profileName) || !config.profiles[profileName]) {
    throw new CliError(`Unknown profile: ${profileName}`);
  }
  assertNoSymlinkComponents(root, config.logRelative);
  mkdirSync(config.logDirectory, { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(root, config.logRelative);

  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const suffix = randomUUID().slice(0, 8);
  const filename = `${profileName}-${timestamp}-${suffix}.log`;
  const logPath = path.join(config.logDirectory, filename);
  const logRelative = path.relative(root, logPath).split(path.sep).join("/");
  const fd = openSync(logPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  const collector = new OutputCollector(root, config.maxHighlights);
  const [executable, ...args] = config.profiles[profileName].command;
  const startedAt = process.hrtime.bigint();

  let child;
  try {
    child = spawn(executable, args, {
      cwd: root,
      env: process.env,
      shell: false,
      stdio: ["inherit", "pipe", "pipe"],
    });
  } catch (error) {
    closeSync(fd);
    throw new CliError(`Could not start profile: ${profileName}`, { cause: error });
  }

  const flushStdout = attachStream(child.stdout, fd, collector);
  const flushStderr = attachStream(child.stderr, fd, collector);
  const forwardedSignals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const handlers = new Map(
    forwardedSignals.map((signal) => [signal, () => child.kill(signal)]),
  );
  for (const [signal, handler] of handlers) {
    process.once(signal, handler);
  }

  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
    flushStdout();
    flushStderr();
    closeSync(fd);
  });

  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  const exitCode = result.exitCode ?? conventionalSignalExitCode(result.signal);
  const failed = exitCode !== 0;
  const response = {
    profile: profileName,
    status: result.signal ? "signaled" : failed ? "failed" : "passed",
    exitCode,
    signal: result.signal,
    durationMs,
    output: {
      bytes: collector.bytes,
      lines: collector.lines,
      warningLines: collector.warningLines,
      errorLines: collector.errorLines,
    },
    highlights: collector.highlights(failed),
    log: logRelative,
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exitCode = exitCode;
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "help" || command === "--help") {
    printHelp();
    return;
  }
  if (command === "version" || command === "--version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command !== "run" || args.length !== 1) {
    throw new CliError("Usage: output-sieve run <profile>");
  }
  const root = resolveGitRoot();
  const config = loadConfig(root);
  await runProfile(root, config, args[0]);
}

main().catch((error) => {
  const message = error instanceof CliError ? error.message : "Output Sieve failed safely.";
  process.stderr.write(`output-sieve: ${message}\n`);
  process.exitCode = 1;
});

export { CliError, OutputCollector, loadConfig, resolveGitRoot, runProfile };
