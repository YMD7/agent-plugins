import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Context Shunt Worker runtime", () => {
  it("serves the read-only health endpoint", async () => {
    const response = await exports.default.fetch("https://worker.example.test/health", {
      method: "HEAD",
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("does not expose a route other than bulk-read and health", async () => {
    const response = await exports.default.fetch("https://worker.example.test/unexpected");

    expect(response.status).toBe(404);
  });
});
