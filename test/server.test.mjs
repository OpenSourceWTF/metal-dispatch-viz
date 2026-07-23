import assert from "node:assert/strict";
import { once } from "node:events";
import {
  appendFile,
  mkdir,
  mkdtemp,
  open,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createApp,
  parseRuntimeConfig,
} from "../server/app.mjs";
import {
  installGracefulShutdown,
  startServer,
} from "../server.mjs";

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function listen(t, options) {
  const app = createApp(options);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  );

  return {
    app,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
  };
}

async function jsonResponse(url) {
  const response = await fetch(url);
  return { response, body: await response.json() };
}

async function waitForClosedHandle(fileHandle) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fileHandle.stat();
    } catch (error) {
      if (error?.code === "EBADF") {
        return;
      }
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.fail(
    `trace descriptor remained open after client abort${lastError ? `: ${lastError.message}` : ""}`,
  );
}

test("health and trace listing refresh without exposing the configured root", async (t) => {
  const root = await temporaryDirectory(t, "mdv-api-");
  await writeFile(path.join(root, "first.jsonl"), '{"record":"summary"}\n');
  await writeFile(
    path.join(root, "traces.json"),
    JSON.stringify({
      schema_version: 1,
      root_label: "Decode captures",
      traces: {},
    }),
  );
  const { baseUrl } = await listen(t, { traceRoot: root });

  const health = await jsonResponse(`${baseUrl}/api/health`);
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, {
    status: "ok",
    app: { status: "ok" },
    registry: {
      status: "ok",
      schemaVersion: 1,
      rootLabel: "Decode captures",
      traceCount: 1,
      warnings: [],
    },
  });
  assert.equal(JSON.stringify(health.body).includes(root), false);

  const firstList = await jsonResponse(`${baseUrl}/api/traces`);
  assert.equal(firstList.response.status, 200);
  assert.equal(firstList.body.schemaVersion, 1);
  assert.equal(firstList.body.rootLabel, "Decode captures");
  assert.deepEqual(
    firstList.body.traces.map(({ relativePath }) => relativePath),
    ["first.jsonl"],
  );
  assert.equal(JSON.stringify(firstList.body).includes(root), false);

  await writeFile(path.join(root, "second.ndjson"), '{"record":"op"}\n');
  const refreshedList = await jsonResponse(`${baseUrl}/api/traces`);
  assert.deepEqual(
    refreshedList.body.traces.map(({ relativePath }) => relativePath),
    ["first.jsonl", "second.ndjson"],
  );
  assert.equal(JSON.stringify(refreshedList.body).includes(root), false);
});

test("trace endpoint streams current bytes and rejects IDs rather than paths", async (t) => {
  const root = await temporaryDirectory(t, "mdv-stream-");
  const contents = '{"record":"summary","complete":true}\n';
  await writeFile(path.join(root, 'trace "one".jsonl'), contents);
  const { baseUrl } = await listen(t, { traceRoot: root });

  const { body: list } = await jsonResponse(`${baseUrl}/api/traces`);
  const response = await fetch(`${baseUrl}/api/traces/${list.traces[0].id}`);
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    "application/x-ndjson; charset=utf-8",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("transfer-encoding"), "chunked");
  assert.match(
    response.headers.get("content-disposition"),
    /^attachment; filename="trace _one_\.jsonl"$/,
  );
  assert.equal(await response.text(), contents);

  const invalidId = await jsonResponse(
    `${baseUrl}/api/traces/not-an-id`,
  );
  assert.equal(invalidId.response.status, 404);
  assert.deepEqual(invalidId.body, {
    error: {
      code: "TRACE_NOT_FOUND",
      message: "Trace not found.",
    },
  });

  for (const requestPath of [
    "..%2F..%2Fetc%2Fpasswd",
    "%2e%2e",
    `${list.traces[0].id}extra`,
  ]) {
    const missing = await jsonResponse(
      `${baseUrl}/api/traces/${requestPath}`,
    );
    assert.equal(missing.response.status, 404);
    assert.equal(typeof missing.body.error?.code, "string");
    assert.equal(typeof missing.body.error?.message, "string");
  }
});

test("trace streaming remains correctly framed when the opened file grows after fstat", async (t) => {
  const root = await temporaryDirectory(t, "mdv-stream-grow-");
  const tracePath = path.join(root, "growing.jsonl");
  const original = '{"record":"summary"}\n';
  const appended = '{"record":"op","seq":1}\n';
  await writeFile(tracePath, original);
  const { app, baseUrl } = await listen(t, { traceRoot: root });
  const { body: list } = await jsonResponse(`${baseUrl}/api/traces`);

  app.locals.traceRegistry.hooks.afterTraceOpen = async () => {
    await appendFile(tracePath, appended);
  };

  const response = await fetch(
    `${baseUrl}/api/traces/${list.traces[0].id}`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("transfer-encoding"), "chunked");
  assert.equal(await response.text(), original + appended);
});

test("trace streaming remains correctly framed when the opened file shrinks after fstat", async (t) => {
  const root = await temporaryDirectory(t, "mdv-stream-shrink-");
  const tracePath = path.join(root, "shrinking.jsonl");
  const retained = '{"record":"summary"}\n';
  await writeFile(
    tracePath,
    retained + '{"record":"op","seq":1,"payload":"removed"}\n',
  );
  const { app, baseUrl } = await listen(t, { traceRoot: root });
  const { body: list } = await jsonResponse(`${baseUrl}/api/traces`);

  app.locals.traceRegistry.hooks.afterTraceOpen = async () => {
    await truncate(tracePath, Buffer.byteLength(retained));
  };

  const response = await fetch(
    `${baseUrl}/api/traces/${list.traces[0].id}`,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("transfer-encoding"), "chunked");
  assert.equal(await response.text(), retained);
});

test("static root and public assets are served from the configured directory", async (t) => {
  const root = await temporaryDirectory(t, "mdv-static-traces-");
  const publicDir = await temporaryDirectory(t, "mdv-static-public-");
  await writeFile(path.join(publicDir, "index.html"), "<h1>Workbench</h1>");
  await mkdir(path.join(publicDir, "assets"));
  await writeFile(
    path.join(publicDir, "assets", "workbench.js"),
    "globalThis.workbench = true;",
  );
  const { baseUrl } = await listen(t, { traceRoot: root, publicDir });

  const rootResponse = await fetch(`${baseUrl}/`);
  assert.equal(rootResponse.status, 200);
  assert.match(rootResponse.headers.get("content-type"), /text\/html/);
  assert.equal(await rootResponse.text(), "<h1>Workbench</h1>");

  const assetResponse = await fetch(`${baseUrl}/assets/workbench.js`);
  assert.equal(assetResponse.status, 200);
  assert.match(
    assetResponse.headers.get("content-type"),
    /(?:text|application)\/javascript/,
  );
  assert.equal(
    await assetResponse.text(),
    "globalThis.workbench = true;",
  );
});

test("missing trace roots produce stable structured errors without path leaks", async (t) => {
  const parent = await temporaryDirectory(t, "mdv-missing-");
  const missingRoot = path.join(parent, "operator-secret", "absent");
  const { baseUrl } = await listen(t, { traceRoot: missingRoot });

  const health = await jsonResponse(`${baseUrl}/api/health`);
  assert.equal(health.response.status, 503);
  assert.deepEqual(health.body, {
    status: "degraded",
    app: { status: "ok" },
    registry: {
      status: "error",
      error: {
        code: "TRACE_ROOT_UNAVAILABLE",
        message: "Trace root is unavailable or is not a directory.",
      },
    },
  });

  const traces = await jsonResponse(`${baseUrl}/api/traces`);
  assert.equal(traces.response.status, 503);
  assert.deepEqual(traces.body, {
    error: {
      code: "TRACE_ROOT_UNAVAILABLE",
      message: "Trace root is unavailable or is not a directory.",
    },
  });

  for (const body of [health.body, traces.body]) {
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(parent), false);
    assert.equal(serialized.includes(missingRoot), false);
    assert.equal(serialized.includes("stack"), false);
  }
});

test("malformed percent-encoded paths return a sanitized bad-request error", async (t) => {
  const root = await temporaryDirectory(t, "mdv-bad-path-");
  const { baseUrl } = await listen(t, { traceRoot: root });

  const malformed = await jsonResponse(
    `${baseUrl}/api/traces/%E0%A4%A`,
  );
  assert.equal(malformed.response.status, 400);
  assert.deepEqual(malformed.body, {
    error: {
      code: "BAD_REQUEST",
      message: "The request path is malformed.",
    },
  });
  assert.equal(JSON.stringify(malformed.body).includes(root), false);
  assert.equal(JSON.stringify(malformed.body).includes("URIError"), false);
});

test("runtime configuration uses CLI, environment, and default precedence", () => {
  assert.deepEqual(
    parseRuntimeConfig(
      ["--trace-dir", "cli-traces"],
      { TRACE_DIR: "env-traces", PORT: "8123", HOST: "0.0.0.0" },
    ),
    {
      traceRoot: path.resolve("cli-traces"),
      rootLabel: "cli-traces",
      port: 8123,
      host: "0.0.0.0",
    },
  );

  assert.deepEqual(
    parseRuntimeConfig(
      ["--trace-dir=joined-traces"],
      { TRACE_DIR: "env-traces" },
    ),
    {
      traceRoot: path.resolve("joined-traces"),
      rootLabel: "joined-traces",
      port: 4173,
      host: "127.0.0.1",
    },
  );

  assert.deepEqual(parseRuntimeConfig([], { TRACE_DIR: "env-traces" }), {
    traceRoot: path.resolve("env-traces"),
    rootLabel: "env-traces",
    port: 4173,
    host: "127.0.0.1",
  });

  assert.deepEqual(parseRuntimeConfig([], {}), {
    traceRoot: path.resolve("./traces/showcase"),
    rootLabel: "showcase",
    port: 4173,
    host: "127.0.0.1",
  });
});

test("runtime configuration rejects malformed options and ports before listen", () => {
  for (const argv of [
    ["--trace-dir"],
    ["--trace-dir="],
    ["--trace-dir", "--other"],
    ["--trace-root", "traces"],
    ["traces"],
    ["--trace-dir", "one", "--trace-dir", "two"],
  ]) {
    assert.throws(
      () => parseRuntimeConfig(argv, {}),
      (error) =>
        error?.code === "INVALID_ARGUMENT" &&
        !error.message.includes(process.cwd()),
    );
  }

  for (const port of ["", "0", "65536", "-1", "3.5", "4e3", "port"]) {
    assert.throws(
      () => parseRuntimeConfig([], { PORT: port }),
      (error) => error?.code === "INVALID_PORT" && /PORT/.test(error.message),
    );
  }
});

test("listener logs only its URL and safe root label, then closes on SIGTERM", async (t) => {
  const root = await temporaryDirectory(t, "mdv-lifecycle-");
  const messages = [];
  const logger = {
    log(message) {
      messages.push(message);
    },
    error(message) {
      messages.push(message);
    },
  };
  const server = startServer(
    {
      traceRoot: root,
      rootLabel: "lifecycle-traces",
      port: 0,
      host: "127.0.0.1",
    },
    { logger },
  );
  await once(server, "listening");
  const removeSignalHandlers = installGracefulShutdown(server, { logger });
  t.after(removeSignalHandlers);

  assert.match(
    messages[0],
    new RegExp(`^metal-dispatch-viz listening at http://127\\.0\\.0\\.1:${server.address().port}$`),
  );
  assert.equal(messages[1], "Trace root: lifecycle-traces");
  assert.equal(messages.join("\n").includes(root), false);

  const closed = once(server, "close");
  process.emit("SIGTERM");
  await closed;
  assert.equal(messages.at(-1), "Received SIGTERM; closing server.");
  assert.equal(messages.join("\n").includes(root), false);
});

test("aborting a trace response destroys the descriptor-backed stream", async (t) => {
  const root = await temporaryDirectory(t, "mdv-abort-");
  const tracePath = path.join(root, "large.jsonl");
  const traceHandle = await open(tracePath, "w");
  await traceHandle.truncate(32 * 1024 * 1024);
  await traceHandle.close();

  const { app, baseUrl } = await listen(t, { traceRoot: root });
  const { body: list } = await jsonResponse(`${baseUrl}/api/traces`);
  let openedHandle;
  app.locals.traceRegistry.hooks.afterTraceOpen = ({ fileHandle }) => {
    openedHandle = fileHandle;
  };

  await new Promise((resolve, reject) => {
    const request = http.get(
      `${baseUrl}/api/traces/${list.traces[0].id}`,
      (response) => {
        response.once("error", () => {});
        response.destroy();
        request.destroy();
        resolve();
      },
    );
    request.once("error", (error) => {
      if (error.code === "ECONNRESET") {
        resolve();
      } else {
        reject(error);
      }
    });
  });

  assert.ok(openedHandle);
  await waitForClosedHandle(openedHandle);
});
