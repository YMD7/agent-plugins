#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const VERSION = "0.1.0";
const CONFIG_PATH = ".agents/symbol-scout/config.json";
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EXTENSION_PATTERN = /^\.[a-z0-9]+$/;
const MARKER_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_COMMAND_PARTS = 16;
const MAX_COMMAND_PART_LENGTH = 512;
const MAX_LSP_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_SERVER_ERROR_BYTES = 4096;
const CONTENT_MODIFIED = -32801;
const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "SHELL",
  "TERM",
  "NO_COLOR",
  "MISE_CONFIG_DIR",
  "MISE_DATA_DIR",
  "MISE_CACHE_DIR",
  "MISE_STATE_DIR",
  "RUSTUP_HOME",
  "CARGO_HOME",
  "RUSTUP_TOOLCHAIN",
  "SDKROOT",
  "DEVELOPER_DIR",
  "TOOLCHAINS",
  "SOURCEKIT_TOOLCHAIN_PATH",
];

class CliError extends Error {}

class RpcError extends Error {
  constructor(error) {
    super(error?.message ?? "Language server request failed.");
    this.code = error?.code;
  }
}

function printHelp() {
  process.stdout.write(`Symbol Scout ${VERSION}

Usage:
  symbol-scout outline <file> [parent]
  symbol-scout locate <file> <exact-symbol>
  symbol-scout definition <file> <line> <column>
  symbol-scout references <file> <line> <column>
  symbol-scout help
  symbol-scout version

Line and column arguments are one-based. Server commands and limits come from ${CONFIG_PATH}.
`);
}

function runGit(root, args, options = {}) {
  const { allowFailure = false, ...execOptions } = options;
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...execOptions,
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw new CliError("Symbol Scout requires a Git worktree.", { cause: error });
  }
}

function resolveGitRoot(cwd = process.cwd()) {
  return realpathSync(runGit(cwd, ["rev-parse", "--show-toplevel"]));
}

function relativeInside(root, target, label, { allowRoot = false } = {}) {
  const relative = path.relative(root, target);
  if (
    (!allowRoot && relative === "") ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new CliError(`${label} must stay inside the Git root.`);
  }
  return relative.split(path.sep).join("/");
}

function assertNoSymlinkComponents(root, relativePath, label) {
  let current = root;
  for (const part of relativePath.split("/").filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new CliError(`${label} must not contain symlink components.`);
      }
    } catch (error) {
      if (error instanceof CliError) throw error;
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

function validateCommand(command) {
  if (!Array.isArray(command) || command.length === 0 || command.length > MAX_COMMAND_PARTS) {
    throw new CliError(`server command must contain 1-${MAX_COMMAND_PARTS} argv parts.`);
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
    throw new CliError("server command contains an invalid argv part.");
  }
  return [...command];
}

function integerInRange(value, minimum, maximum, label) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new CliError(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function optionalObject(value, label) {
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(`${label} must be an object.`);
  }
  return value;
}

function validateScratch(root, serverName, server) {
  if (server.scratchDirectory === undefined && server.scratchArgument === undefined) return null;
  if (
    typeof server.scratchDirectory !== "string" ||
    path.isAbsolute(server.scratchDirectory) ||
    typeof server.scratchArgument !== "string" ||
    server.scratchArgument.length === 0 ||
    server.scratchArgument.length > 64
  ) {
    throw new CliError(`${serverName} scratch configuration is invalid.`);
  }
  const absolute = path.resolve(root, server.scratchDirectory);
  const relative = relativeInside(root, absolute, `${serverName} scratchDirectory`);
  if (relative === ".git" || relative.startsWith(".git/")) {
    throw new CliError("scratchDirectory must not use Git internal paths.");
  }
  assertNoSymlinkComponents(root, relative, "scratchDirectory");
  const probe = `${relative}/symbol-scout-ignore-probe`;
  if (runGit(root, ["check-ignore", "--quiet", "--no-index", "--", probe], { allowFailure: true }) === null) {
    throw new CliError(`${serverName} scratchDirectory must be ignored by Git.`);
  }
  if (runGit(root, ["ls-files", "--", relative])) {
    throw new CliError(`${serverName} scratchDirectory must not contain tracked files.`);
  }
  return { absolute, relative, argument: server.scratchArgument };
}

function loadConfig(root) {
  if (runGit(root, ["ls-files", "--error-unmatch", "--", CONFIG_PATH], { allowFailure: true }) === null) {
    throw new CliError(`${CONFIG_PATH} must be Git-tracked.`);
  }
  if (runGit(root, ["status", "--porcelain=v1", "--untracked-files=no", "--", CONFIG_PATH])) {
    throw new CliError(`${CONFIG_PATH} must match HEAD before use.`);
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(path.join(root, CONFIG_PATH), "utf8"));
  } catch (error) {
    throw new CliError(`${CONFIG_PATH} must contain valid JSON.`, { cause: error });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CliError("Symbol Scout config must be an object.");
  }
  const maxItems = integerInRange(raw.maxItems, 1, 100, "maxItems");
  const maxOutputBytes = integerInRange(raw.maxOutputBytes, 1024, 32768, "maxOutputBytes");
  const requestTimeoutMs = integerInRange(raw.requestTimeoutMs, 1000, 120000, "requestTimeoutMs");
  if (!raw.servers || typeof raw.servers !== "object" || Array.isArray(raw.servers)) {
    throw new CliError("servers must be an object.");
  }

  const extensionOwners = new Map();
  const servers = {};
  for (const [name, server] of Object.entries(raw.servers)) {
    if (!NAME_PATTERN.test(name) || !server || typeof server !== "object" || Array.isArray(server)) {
      throw new CliError(`Invalid server: ${name}`);
    }
    if (
      !Array.isArray(server.extensions) ||
      server.extensions.length === 0 ||
      server.extensions.length > 16 ||
      server.extensions.some((extension) => !EXTENSION_PATTERN.test(extension))
    ) {
      throw new CliError(`${name} extensions are invalid.`);
    }
    const extensions = [...new Set(server.extensions)];
    if (extensions.length !== server.extensions.length) {
      throw new CliError(`${name} extensions must be unique.`);
    }
    if (!server.languageIds || typeof server.languageIds !== "object" || Array.isArray(server.languageIds)) {
      throw new CliError(`${name} languageIds must be an object.`);
    }
    const languageIds = {};
    for (const extension of extensions) {
      const languageId = server.languageIds[extension];
      if (typeof languageId !== "string" || languageId.length === 0 || languageId.length > 64) {
        throw new CliError(`${name} languageIds must cover every extension.`);
      }
      if (extensionOwners.has(extension)) {
        throw new CliError(`${extension} is assigned to multiple servers.`);
      }
      extensionOwners.set(extension, name);
      languageIds[extension] = languageId;
    }
    if (
      !Array.isArray(server.rootMarkers) ||
      server.rootMarkers.length === 0 ||
      server.rootMarkers.length > 8 ||
      server.rootMarkers.some((marker) => !MARKER_PATTERN.test(marker))
    ) {
      throw new CliError(`${name} rootMarkers are invalid.`);
    }
    servers[name] = {
      command: validateCommand(server.command),
      extensions,
      languageIds,
      rootMarkers: [...new Set(server.rootMarkers)],
      readyDelayMs: integerInRange(server.readyDelayMs ?? 0, 0, 30000, `${name} readyDelayMs`),
      contentModifiedRetries: integerInRange(
        server.contentModifiedRetries ?? 0,
        0,
        3,
        `${name} contentModifiedRetries`,
      ),
      initializationOptions: optionalObject(server.initializationOptions, `${name} initializationOptions`),
      settings: optionalObject(server.settings, `${name} settings`),
      scratch: validateScratch(root, name, server),
    };
  }
  if (Object.keys(servers).length === 0) throw new CliError("At least one server is required.");
  return { maxItems, maxOutputBytes, requestTimeoutMs, servers, extensionOwners };
}

function resolveSourceFile(root, argument) {
  if (typeof argument !== "string" || argument.length === 0 || path.isAbsolute(argument)) {
    throw new CliError("file must be a relative project path.");
  }
  let file;
  try {
    file = realpathSync(path.resolve(root, argument));
  } catch (error) {
    throw new CliError("file must exist.", { cause: error });
  }
  const relative = relativeInside(root, file, "file");
  assertNoSymlinkComponents(root, relative, "file");
  if (!statSync(file).isFile()) throw new CliError("file must be a regular file.");
  return { file, relative };
}

function findLanguageRoot(projectRoot, file, rootMarkers) {
  let current = path.dirname(file);
  while (true) {
    if (rootMarkers.some((marker) => existsSync(path.join(current, marker)))) return current;
    if (current === projectRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    relativeInside(projectRoot, parent, "language root", { allowRoot: true });
    current = parent;
  }
  throw new CliError(`No language root marker found for ${path.basename(file)}.`);
}

function safeEnvironment(environment = process.env) {
  return Object.fromEntries(
    SAFE_ENV_KEYS.flatMap((key) => (environment[key] === undefined ? [] : [[key, environment[key]]])),
  );
}

function unrefDelay(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

function prepareCommand(projectRoot, languageRoot, serverName, server) {
  const command = [...server.command];
  if (!server.scratch) return command;
  assertNoSymlinkComponents(projectRoot, server.scratch.relative, "scratchDirectory");
  mkdirSync(server.scratch.absolute, { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(projectRoot, server.scratch.relative, "scratchDirectory");
  const digest = createHash("sha256").update(languageRoot).digest("hex").slice(0, 12);
  const target = path.join(server.scratch.absolute, `${serverName}-${digest}`);
  const targetRelative = relativeInside(projectRoot, target, "scratch target");
  assertNoSymlinkComponents(projectRoot, targetRelative, "scratch target");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  assertNoSymlinkComponents(projectRoot, targetRelative, "scratch target");
  command.push(server.scratch.argument, target);
  return command;
}

class LspClient {
  constructor(command, cwd, options) {
    const [executable, ...args] = command;
    this.child = spawn(executable, args, {
      cwd,
      env: safeEnvironment(),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.cwd = cwd;
    this.timeoutMs = options.timeoutMs;
    this.settings = options.settings;
    this.rootUri = pathToFileURL(cwd).href;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = "";
    this.failure = null;
    this.closing = false;
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-MAX_SERVER_ERROR_BYTES);
    });
    this.child.stdout.on("data", (chunk) => this.accept(chunk));
    this.child.once("error", (error) => this.fail(new CliError("Language server could not start.", { cause: error })));
    this.child.once("close", (code, signal) => {
      if (!this.closing) {
        this.fail(new CliError(`Language server exited before completing the query (${code ?? signal}).`));
      }
    });
  }

  fail(error) {
    this.failure ??= error;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(this.failure);
    }
    this.pending.clear();
  }

  accept(chunk) {
    if (this.failure) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    try {
      while (true) {
        const marker = this.buffer.indexOf("\r\n\r\n");
        if (marker < 0) return;
        const header = this.buffer.subarray(0, marker).toString("ascii");
        const match = /(?:^|\r\n)Content-Length: (\d+)(?:\r\n|$)/i.exec(header);
        if (!match) throw new CliError("Language server returned an invalid frame.");
        const length = Number(match[1]);
        if (!Number.isSafeInteger(length) || length < 0 || length > MAX_LSP_MESSAGE_BYTES) {
          throw new CliError("Language server message exceeded the size limit.");
        }
        const end = marker + 4 + length;
        if (this.buffer.length < end) return;
        const body = this.buffer.subarray(marker + 4, end).toString("utf8");
        this.buffer = this.buffer.subarray(end);
        this.handle(JSON.parse(body));
      }
    } catch (error) {
      this.fail(error instanceof CliError ? error : new CliError("Language server returned invalid JSON."));
      this.child.kill("SIGTERM");
    }
  }

  handle(message) {
    if (message.id !== undefined && message.method === undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new RpcError(message.error));
      else waiter.resolve(message.result);
      return;
    }
    if (message.id === undefined || message.method === undefined) return;
    let result = null;
    if (message.method === "workspace/configuration") {
      result = (message.params?.items ?? []).map(() => this.settings);
    } else if (message.method === "workspace/workspaceFolders") {
      result = [{ uri: this.rootUri, name: path.basename(this.cwd) }];
    }
    this.send({ jsonrpc: "2.0", id: message.id, result });
  }

  send(message) {
    if (this.failure) throw this.failure;
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method, params) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CliError(`Language server timed out during ${method}.`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async requestWithRetry(method, params, retries) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await this.request(method, params);
      } catch (error) {
        if (!(error instanceof RpcError) || error.code !== CONTENT_MODIFIED || attempt === retries) {
          throw error;
        }
        await delay(500);
      }
    }
  }

  async initialize(initializationOptions) {
    await this.request("initialize", {
      processId: process.pid,
      rootUri: this.rootUri,
      workspaceFolders: [{ uri: this.rootUri, name: path.basename(this.cwd) }],
      initializationOptions,
      capabilities: {
        workspace: { configuration: true, workspaceFolders: true },
        textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } },
      },
    });
    this.notify("initialized", {});
  }

  open(uri, languageId, text) {
    this.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  async close() {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.closing = true;
    const closed = once(this.child, "close");
    try {
      await this.request("shutdown", null);
      this.notify("exit", null);
    } catch {
      // The original query result or failure remains authoritative.
    }
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      await Promise.race([closed, unrefDelay(2000)]);
    }
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM");
  }
}

function point(position) {
  return [position.line + 1, position.character + 1];
}

function flattenSymbols(items, parent = null, target = []) {
  for (const item of items ?? []) {
    const range = item.range ?? item.location?.range;
    if (!range?.start || !range?.end || typeof item.name !== "string") continue;
    const currentParent = item.containerName ?? parent;
    target.push({
      name: item.name.slice(0, 256),
      kind: item.kind,
      parent: currentParent ? String(currentParent).slice(0, 256) : null,
      start: point(range.start),
      end: point(range.end),
      position: item.selectionRange?.start ?? range.start,
    });
    if (Array.isArray(item.children)) flattenSymbols(item.children, item.name, target);
  }
  return target;
}

function projectLocation(projectRoot, item) {
  const uri = item.uri ?? item.targetUri;
  const range = item.range ?? item.targetSelectionRange ?? item.targetRange;
  if (typeof uri !== "string" || !uri.startsWith("file:") || !range?.start || !range?.end) return null;
  let absolute;
  try {
    absolute = fileURLToPath(uri);
  } catch {
    return null;
  }
  const relative = path.relative(projectRoot, absolute);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return {
    file: relative.split(path.sep).join("/"),
    start: point(range.start),
    end: point(range.end),
  };
}

function boundedResponse(base, items, totalCount, config) {
  const response = { ...base, totalCount, returnedCount: 0, truncated: false, items: [] };
  for (const item of items) {
    if (response.items.length >= config.maxItems) break;
    const candidate = { ...response, items: [...response.items, item] };
    if (Buffer.byteLength(JSON.stringify(candidate)) > config.maxOutputBytes) break;
    response.items.push(item);
  }
  response.returnedCount = response.items.length;
  response.truncated = response.returnedCount < items.length;
  while (Buffer.byteLength(JSON.stringify(response)) > config.maxOutputBytes && response.items.length > 0) {
    response.items.pop();
    response.returnedCount = response.items.length;
    response.truncated = true;
  }
  if (Buffer.byteLength(JSON.stringify(response)) > config.maxOutputBytes) {
    throw new CliError("Response metadata exceeded maxOutputBytes.");
  }
  return response;
}

function parsePosition(line, column) {
  if (!/^\d+$/.test(line) || !/^\d+$/.test(column)) {
    throw new CliError("line and column must be positive integers.");
  }
  const parsed = { line: Number(line) - 1, character: Number(column) - 1 };
  if (!Number.isSafeInteger(parsed.line) || !Number.isSafeInteger(parsed.character) || parsed.line < 0 || parsed.character < 0) {
    throw new CliError("line and column must be positive integers.");
  }
  return parsed;
}

function parseInvocation(argv) {
  const [action = "help", ...args] = argv;
  if (action === "help" || action === "--help") return { action: "help" };
  if (action === "version" || action === "--version") return { action: "version" };
  if (
    action === "outline" &&
    (args.length === 1 || args.length === 2) &&
    (args[1] === undefined || (args[1].length > 0 && args[1].length <= 256))
  ) {
    return { action, file: args[0], parent: args[1] ?? null };
  }
  if (action === "locate" && args.length === 2 && args[1].length > 0 && args[1].length <= 256) {
    return { action, file: args[0], symbol: args[1] };
  }
  if ((action === "definition" || action === "references") && args.length === 3) {
    return { action, file: args[0], position: parsePosition(args[1], args[2]) };
  }
  throw new CliError(`Invalid invocation. Run symbol-scout help.`);
}

async function executeQuery(invocation, cwd = process.cwd()) {
  const projectRoot = resolveGitRoot(cwd);
  const config = loadConfig(projectRoot);
  const source = resolveSourceFile(projectRoot, invocation.file);
  const extension = path.extname(source.file).toLowerCase();
  const serverName = config.extensionOwners.get(extension);
  if (!serverName) throw new CliError(`No configured server for ${extension || "this file"}.`);
  const server = config.servers[serverName];
  const languageRoot = findLanguageRoot(projectRoot, source.file, server.rootMarkers);
  const command = prepareCommand(projectRoot, languageRoot, serverName, server);
  const client = new LspClient(command, languageRoot, {
    timeoutMs: config.requestTimeoutMs,
    settings: server.settings,
  });
  const uri = pathToFileURL(source.file).href;
  const startedAt = process.hrtime.bigint();
  try {
    await client.initialize(server.initializationOptions);
    client.open(uri, server.languageIds[extension], await readFile(source.file, "utf8"));
    if (server.readyDelayMs > 0) await delay(server.readyDelayMs);

    let items;
    let totalCount;
    let omittedExternal = 0;
    if (invocation.action === "outline" || invocation.action === "locate") {
      const raw = await client.requestWithRetry(
        "textDocument/documentSymbol",
        { textDocument: { uri } },
        server.contentModifiedRetries,
      );
      const symbols = flattenSymbols(raw);
      const filtered =
        invocation.action === "locate"
          ? symbols.filter((item) => item.name === invocation.symbol)
          : symbols.filter((item) => item.parent === invocation.parent);
      items = filtered.map(({ position, ...item }) => item);
      totalCount = items.length;
    } else {
      const raw =
        (await client.requestWithRetry(
          `textDocument/${invocation.action}`,
          {
            textDocument: { uri },
            position: invocation.position,
            ...(invocation.action === "references" ? { context: { includeDeclaration: true } } : {}),
          },
          server.contentModifiedRetries,
        )) ?? [];
      const normalized = Array.isArray(raw) ? raw : [raw];
      const projectItems = normalized.map((item) => projectLocation(projectRoot, item)).filter(Boolean);
      items = [...new Map(projectItems.map((item) => [JSON.stringify(item), item])).values()];
      omittedExternal = normalized.length - projectItems.length;
      totalCount = normalized.length;
    }

    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    return boundedResponse(
      {
        action: invocation.action,
        server: serverName,
        file: source.relative,
        languageRoot: relativeInside(projectRoot, languageRoot, "language root", { allowRoot: true }) || ".",
        durationMs,
        omittedExternal,
      },
      items,
      totalCount,
      config,
    );
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (error instanceof RpcError) {
      throw new CliError(`Language server request failed (${error.code ?? "unknown"}).`);
    }
    throw new CliError("Language server query failed.", { cause: error });
  } finally {
    await client.close();
  }
}

async function main() {
  const invocation = parseInvocation(process.argv.slice(2));
  if (invocation.action === "help") return printHelp();
  if (invocation.action === "version") return process.stdout.write(`${VERSION}\n`);
  process.stdout.write(`${JSON.stringify(await executeQuery(invocation))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    const message = error instanceof CliError ? error.message : "Symbol Scout failed safely.";
    process.stderr.write(`symbol-scout: ${message}\n`);
    process.exitCode = 1;
  });
}

export {
  CliError,
  LspClient,
  boundedResponse,
  executeQuery,
  findLanguageRoot,
  flattenSymbols,
  loadConfig,
  parseInvocation,
  projectLocation,
  resolveGitRoot,
  safeEnvironment,
};
