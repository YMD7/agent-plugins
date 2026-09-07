#!/usr/bin/env node

import { doctor, login, requestSummary } from "./lib/access-client.mjs";
import { CliError } from "./lib/errors.mjs";
import { createPreToolUseDecision } from "./lib/hook-guard.mjs";
import { loadProjectConfig, resolveEndpoint, resolveGitRoot } from "./lib/project.mjs";
import { collectApprovedFiles } from "./lib/repository.mjs";

const VERSION = "0.1.0";
const MAX_QUESTION_LENGTH = 4_000;

function printHelp() {
  process.stdout.write(`Context Shunt ${VERSION}

Usage:
  context-shunt login [--endpoint <https-origin>]
  context-shunt doctor [--endpoint <https-origin>]
  context-shunt bulk-read --question <text> --paths <path> [<path> ...]
  context-shunt guard

The endpoint and line threshold normally come from
.agents/context-shunt/config.json in the current Git project.
`);
}

function parseCommandOptions(args, { requireQuestion = false } = {}) {
  const options = { endpoint: null, question: null, paths: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--endpoint" || value === "--question") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new CliError(`${value} requires a value.`);
      }
      options[value.slice(2)] = next;
      index += 1;
      continue;
    }
    if (value === "--paths") {
      options.paths = args.slice(index + 1);
      if (options.paths.length === 0) {
        throw new CliError("--paths requires at least one file path.");
      }
      break;
    }
    throw new CliError(`Unknown option: ${value}`);
  }

  if (requireQuestion) {
    if (!options.question || options.question.length > MAX_QUESTION_LENGTH) {
      throw new CliError("--question must contain at most 4,000 characters.");
    }
    if (options.paths.some((entry) => entry.startsWith("--"))) {
      throw new CliError("Place --paths last and pass paths without option-like names.");
    }
  }
  return options;
}

async function loadRuntimeConfig() {
  const root = await resolveGitRoot();
  const config = await loadProjectConfig(root);
  return { root, config };
}

async function readStdin() {
  let byteLength = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    byteLength += chunk.length;
    if (byteLength > 128 * 1024) {
      throw new CliError("Hook input exceeded the safe size limit.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function runGuard() {
  const raw = await readStdin();
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    throw new CliError("Hook input must be valid JSON.");
  }
  const decision = await createPreToolUseDecision(event, event.cwd ?? process.cwd());
  if (decision) {
    process.stdout.write(`${JSON.stringify(decision)}\n`);
  }
}

async function runBulkRead(args) {
  const options = parseCommandOptions(args, { requireQuestion: true });
  const { root, config } = await loadRuntimeConfig();
  const endpoint = resolveEndpoint(options.endpoint, config);
  const files = await collectApprovedFiles(root, options.paths);
  const response = await requestSummary(endpoint, {
    question: options.question,
    files,
  });
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

async function runAccessCommand(command, args) {
  const options = parseCommandOptions(args);
  const { config } = await loadRuntimeConfig();
  const endpoint = resolveEndpoint(options.endpoint, config);

  if (command === "login") {
    await login(endpoint);
    process.stdout.write("Cloudflare Access login completed.\n");
    return;
  }
  const result = await doctor(endpoint);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "--help" || command === "help") {
    printHelp();
    return;
  }
  if (command === "--version" || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (command === "guard") {
    await runGuard();
    return;
  }
  if (command === "bulk-read") {
    await runBulkRead(args);
    return;
  }
  if (command === "login" || command === "doctor") {
    await runAccessCommand(command, args);
    return;
  }
  throw new CliError(`Unknown command: ${command}`);
}

main().catch((error) => {
  const message = error instanceof CliError
    ? error.message
    : "Context Shunt failed without exposing source content.";
  process.stderr.write(`context-shunt: ${message}\n`);
  process.exitCode = 1;
});
