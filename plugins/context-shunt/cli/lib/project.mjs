import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { CliError } from "./errors.mjs";
import { runProcess } from "./process.mjs";

export async function resolveGitRoot(cwd = process.cwd()) {
  const result = await runProcess("git", ["rev-parse", "--show-toplevel"], {
    input: "",
    cwd,
  });

  if (result.code !== 0 || result.exceeded) {
    throw new CliError("Run Context Shunt from a Git working tree.");
  }

  const root = result.stdout.trim();
  if (!root) {
    throw new CliError("Git did not return a project root.");
  }
  return realpath(path.resolve(root));
}

export function normalizeEndpoint(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CliError("A Context Shunt HTTPS endpoint is required.");
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("The Context Shunt endpoint must be a valid HTTPS URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new CliError("The Context Shunt endpoint must be an HTTPS origin.");
  }

  return url.origin;
}

export async function loadProjectConfig(root, { allowMissing = false } = {}) {
  const configPath = path.join(root, ".agents", "context-shunt", "config.json");
  let raw;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (allowMissing && error && error.code === "ENOENT") {
      return null;
    }
    if (error && error.code === "ENOENT") {
      throw new CliError("Missing .agents/context-shunt/config.json.");
    }
    throw new CliError("Could not read .agents/context-shunt/config.json.");
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new CliError("Context Shunt configuration must be valid JSON.");
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new CliError("Context Shunt configuration must be a JSON object.");
  }

  const lineThreshold = Number.isSafeInteger(config.lineThreshold) && config.lineThreshold > 0
    ? config.lineThreshold
    : null;
  const endpoint = typeof config.endpoint === "string" && config.endpoint.trim() !== ""
    ? normalizeEndpoint(config.endpoint)
    : null;

  return { endpoint, lineThreshold };
}

export function resolveEndpoint(optionEndpoint, config) {
  if (optionEndpoint) {
    return normalizeEndpoint(optionEndpoint);
  }
  if (config && config.endpoint) {
    return config.endpoint;
  }
  throw new CliError("Configure a Context Shunt HTTPS endpoint before using this command.");
}
