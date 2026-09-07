import { CliError } from "./errors.mjs";
import { runInteractive, runProcess } from "./process.mjs";

function assertSuccess(result, message) {
  if (result.exceeded) {
    throw new CliError(`${message} Output exceeded the safe CLI limit.`);
  }
  if (result.code !== 0) {
    throw new CliError(`${message} Run Context Shunt doctor or login and try again.`);
  }
}

export async function login(endpoint) {
  const result = await runInteractive("cloudflared", ["access", "login", endpoint]);
  if (result.code !== 0) {
    throw new CliError("Cloudflare Access login did not complete.");
  }
}

export async function doctor(endpoint) {
  const version = await runProcess("cloudflared", ["--version"], { input: "" });
  assertSuccess(version, "cloudflared is unavailable.");

  const health = await runProcess(
    "cloudflared",
    ["access", "curl", `${endpoint}/health`, "--head", "--silent", "--show-error", "--fail"],
    { input: "" },
  );
  assertSuccess(health, "The Context Shunt Worker could not be reached through Access.");

  return { cloudflared: version.stdout.trim() };
}

export async function requestSummary(endpoint, payload) {
  const result = await runProcess(
    "cloudflared",
    [
      "access",
      "curl",
      `${endpoint}/v1/bulk-read`,
      "--request",
      "POST",
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      "@-",
      "--silent",
      "--show-error",
      "--fail-with-body",
    ],
    { input: JSON.stringify(payload) },
  );
  assertSuccess(result, "The Context Shunt Worker request failed.");

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new CliError("The Context Shunt Worker returned an invalid response.");
  }
}
