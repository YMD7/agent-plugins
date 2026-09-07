import { spawn } from "node:child_process";

export async function runProcess(command, args, options = {}) {
  const { input = "", maxOutputBytes = 128 * 1024, cwd } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      cwd,
    });
    const output = { stdout: [], stderr: [], bytes: 0, exceeded: false };

    const collect = (key) => (chunk) => {
      output.bytes += chunk.length;
      if (output.bytes > maxOutputBytes) {
        output.exceeded = true;
        child.kill();
        return;
      }
      output[key].push(chunk);
    };

    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        code,
        signal,
        exceeded: output.exceeded,
        stdout: Buffer.concat(output.stdout).toString("utf8"),
        stderr: Buffer.concat(output.stderr).toString("utf8"),
      });
    });

    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export async function runInteractive(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      windowsHide: true,
      cwd,
    });

    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}
