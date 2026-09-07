import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { CliError } from "./errors.mjs";
import { runProcess } from "./process.mjs";

export const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 8,
  maxFileBytes: 96 * 1024,
  maxTotalBytes: 256 * 1024,
});

const SENSITIVE_BASENAMES = new Set([
  ".env",
  ".envrc",
  ".npmrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_rsa",
  "id_ecdsa",
  "id_ed25519",
]);
const SENSITIVE_EXTENSIONS = new Set([".key", ".pem", ".p12", ".pfx", ".pkcs8"]);

export function isSensitivePath(relativePath) {
  return relativePath.split(path.sep).some((segment) => {
    const lower = segment.toLowerCase();
    return (
      lower.startsWith(".env.") ||
      SENSITIVE_BASENAMES.has(lower) ||
      SENSITIVE_EXTENSIONS.has(path.extname(lower))
    );
  });
}

function ensureInsideRoot(root, candidate) {
  const relativePath = path.relative(root, candidate);
  if (
    relativePath === "" ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new CliError("Context Shunt accepts files inside the Git root only.");
  }
  return relativePath;
}

async function isTracked(root, relativePath) {
  const result = await runProcess(
    "git",
    ["-C", root, "ls-files", "--error-unmatch", "--", relativePath],
    { input: "" },
  );
  return result.code === 0 && !result.exceeded;
}

async function isIgnored(root, relativePath) {
  const result = await runProcess(
    "git",
    ["-C", root, "check-ignore", "-q", "--no-index", "--", relativePath],
    { input: "" },
  );
  if (result.exceeded || result.code > 1) {
    throw new CliError("Could not verify whether a file is ignored.");
  }
  return result.code === 0;
}

async function readApprovedFile(root, inputPath, limits) {
  const candidate = path.resolve(root, inputPath);
  const relativePath = ensureInsideRoot(root, candidate);

  if (isSensitivePath(relativePath)) {
    throw new CliError("Context Shunt does not accept secret or credential paths.");
  }

  let entry;
  try {
    entry = await lstat(candidate);
  } catch {
    throw new CliError("Context Shunt accepts existing regular files only.");
  }

  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new CliError("Context Shunt accepts regular files, not symlinks or directories.");
  }

  const resolved = await realpath(candidate);
  ensureInsideRoot(root, resolved);

  if (!(await isTracked(root, relativePath))) {
    throw new CliError("Context Shunt accepts Git-tracked files only.");
  }
  if (await isIgnored(root, relativePath)) {
    throw new CliError("Context Shunt does not accept ignored files.");
  }

  const details = await stat(resolved);
  if (details.size > limits.maxFileBytes) {
    throw new CliError("A selected file exceeds the Context Shunt per-file limit.");
  }

  const bytes = await readFile(resolved);
  if (bytes.includes(0)) {
    throw new CliError("Context Shunt does not accept binary files.");
  }

  let content;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CliError("Context Shunt accepts UTF-8 text files only.");
  }

  return { path: relativePath.split(path.sep).join("/"), content, byteLength: bytes.length };
}

export async function collectApprovedFiles(root, inputPaths, limits = DEFAULT_LIMITS) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new CliError("Specify at least one path for Context Shunt.");
  }
  if (inputPaths.length > limits.maxFiles) {
    throw new CliError("Too many files were selected for one Context Shunt request.");
  }

  const files = [];
  const seen = new Set();
  let totalBytes = 0;
  let canonicalRoot;
  try {
    canonicalRoot = await realpath(root);
  } catch {
    throw new CliError("Context Shunt could not resolve the Git root.");
  }

  for (const inputPath of inputPaths) {
    if (typeof inputPath !== "string" || inputPath.trim() === "") {
      throw new CliError("Each Context Shunt path must be a non-empty string.");
    }
    const file = await readApprovedFile(canonicalRoot, inputPath, limits);
    if (seen.has(file.path)) {
      continue;
    }
    seen.add(file.path);
    totalBytes += file.byteLength;
    if (totalBytes > limits.maxTotalBytes) {
      throw new CliError("Selected files exceed the Context Shunt total payload limit.");
    }
    files.push({ path: file.path, content: file.content });
  }

  if (files.length === 0) {
    throw new CliError("Specify at least one distinct path for Context Shunt.");
  }
  return files;
}
