import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { loadProjectConfig, resolveGitRoot } from "./project.mjs";
import { collectApprovedFiles, DEFAULT_LIMITS } from "./repository.mjs";

function isReadTool(toolName) {
  return (
    toolName === "Read" ||
    toolName === "read_file" ||
    /(?:^|__)read(?:_|$)/i.test(toolName)
  );
}

function hasRange(toolInput) {
  return (
    Object.prototype.hasOwnProperty.call(toolInput, "offset") ||
    Object.prototype.hasOwnProperty.call(toolInput, "limit")
  );
}

function resolveLocalPath(root, filePath) {
  const candidate = path.resolve(root, filePath);
  const relativePath = path.relative(root, candidate);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return candidate;
}

async function countLinesUntil(filePath, threshold) {
  const details = await stat(filePath);
  if (details.size === 0) {
    return 0;
  }

  let lineCount = 0;
  let lastByte = null;
  const stream = createReadStream(filePath);
  try {
    for await (const chunk of stream) {
      for (const byte of chunk) {
        lastByte = byte;
        if (byte === 10) {
          lineCount += 1;
          if (lineCount > threshold) {
            stream.destroy();
            return lineCount;
          }
        }
      }
    }
  } finally {
    stream.destroy();
  }
  if (lastByte !== 10) {
    lineCount += 1;
  }
  return lineCount;
}

export async function createPreToolUseDecision(event, cwd = process.cwd()) {
  if (!event || typeof event !== "object" || !isReadTool(event.tool_name)) {
    return null;
  }

  const toolInput = event.tool_input;
  if (!toolInput || typeof toolInput !== "object" || hasRange(toolInput)) {
    return null;
  }
  const filePath = toolInput.file_path ?? toolInput.path;
  if (typeof filePath !== "string" || filePath === "") {
    return null;
  }

  let root;
  let config;
  try {
    root = await resolveGitRoot(cwd);
    config = await loadProjectConfig(root, { allowMissing: true });
  } catch {
    return null;
  }
  if (!config || !config.lineThreshold) {
    return null;
  }

  const candidate = resolveLocalPath(root, filePath);
  if (!candidate) {
    return null;
  }

  try {
    const entry = await lstat(candidate);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      return null;
    }
    const resolved = await realpath(candidate);
    if (!resolveLocalPath(root, resolved)) {
      return null;
    }
    const details = await stat(resolved);
    if (details.size > DEFAULT_LIMITS.maxFileBytes) {
      return null;
    }
    const relativePath = path.relative(root, resolved);
    try {
      await collectApprovedFiles(root, [relativePath]);
    } catch {
      return null;
    }
    const lineCount = await countLinesUntil(resolved, config.lineThreshold);
    if (lineCount <= config.lineThreshold) {
      return null;
    }
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `Large full-file read blocked (${lineCount} lines; threshold ${config.lineThreshold}). ` +
          "Use Context Shunt with a focused question and explicit paths, or use a ranged read.",
      },
    };
  } catch {
    return null;
  }
}
