#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let buffer = Buffer.alloc(0);
let root = process.cwd();
let documentUri = null;
let referenceAttempts = 0;
const contentModifiedOnce = process.argv.includes("--content-modified-once");
const hang = process.argv.includes("--hang");

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function range(line, start = 0, end = 10) {
  return {
    start: { line, character: start },
    end: { line, character: end },
  };
}

function symbols() {
  return [
    {
      name: "Container",
      kind: 5,
      range: range(0, 0, 20),
      selectionRange: range(0, 6, 15),
      children: [
        {
          name: "member",
          kind: 6,
          range: range(1, 2, 18),
          selectionRange: range(1, 5, 11),
        },
      ],
    },
    ...Array.from({ length: 80 }, (_, index) => ({
      name: `symbol-${index}`,
      kind: 12,
      range: range(index + 2),
      selectionRange: range(index + 2, 3, 8),
    })),
  ];
}

function projectLocations(count) {
  const source = fileURLToPath(documentUri);
  return [
    ...Array.from({ length: count }, (_, index) => ({
      uri: pathToFileURL(source).href,
      range: range(index, 1, 4),
    })),
    {
      uri: pathToFileURL(path.join(path.dirname(root), "external.ts")).href,
      range: range(0),
    },
  ];
}

function respond(message) {
  if (message.method === "initialize") {
    root = fileURLToPath(message.params.rootUri);
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: {} } });
    return;
  }
  if (message.method === "textDocument/didOpen") {
    documentUri = message.params.textDocument.uri;
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    if (!hang) send({ jsonrpc: "2.0", id: message.id, result: symbols() });
    return;
  }
  if (message.method === "textDocument/references") {
    referenceAttempts += 1;
    if (contentModifiedOnce && referenceAttempts === 1) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32801, message: "content modified" },
      });
    } else {
      send({ jsonrpc: "2.0", id: message.id, result: projectLocations(60) });
    }
    return;
  }
  if (message.method === "textDocument/definition") {
    send({ jsonrpc: "2.0", id: message.id, result: projectLocations(1) });
    return;
  }
  if (message.method === "shutdown") {
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "exit") process.exit(0);
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const marker = buffer.indexOf("\r\n\r\n");
    if (marker < 0) return;
    const header = buffer.subarray(0, marker).toString("ascii");
    const match = /Content-Length: (\d+)/i.exec(header);
    if (!match) process.exit(2);
    const length = Number(match[1]);
    const end = marker + 4 + length;
    if (buffer.length < end) return;
    const body = buffer.subarray(marker + 4, end).toString("utf8");
    buffer = buffer.subarray(end);
    respond(JSON.parse(body));
  }
});
