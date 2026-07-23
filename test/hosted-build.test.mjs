import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { buildHostedSite } from "../scripts/build_hosted.mjs";

test("hosted build emits the Sites worker artifact contract", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metal-viz-sites-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicRoot = path.join(root, "public");
  const traceRoot = path.join(root, "showcase");
  const outputRoot = path.join(root, "dist");
  const hostingConfigPath = path.join(root, ".openai", "hosting.json");
  await mkdir(publicRoot, { recursive: true });
  await mkdir(traceRoot, { recursive: true });
  await mkdir(path.dirname(hostingConfigPath), { recursive: true });
  await writeFile(
    path.join(publicRoot, "index.html"),
    "<!doctype html><title>Hosted profiler</title>",
  );
  await writeFile(
    path.join(traceRoot, "capture.jsonl"),
    '{"record":"summary"}\n',
  );
  await writeFile(
    hostingConfigPath,
    '{"project_id":"appgprj_test"}\n',
  );

  await buildHostedSite({
    publicRoot,
    traceRoot,
    outputRoot,
    hostingConfigPath,
  });

  assert.match(
    await readFile(path.join(outputRoot, "client", "index.html"), "utf8"),
    /Hosted profiler/,
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        path.join(outputRoot, ".openai", "hosting.json"),
        "utf8",
      ),
    ),
    { project_id: "appgprj_test" },
  );

  const workerUrl = pathToFileURL(
    path.join(outputRoot, "server", "index.js"),
  );
  workerUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);
  const worker = (await import(workerUrl.href)).default;
  let assetPath = null;
  const response = await worker.fetch(
    new Request("https://profiler.example/"),
    {
      ASSETS: {
        fetch(request) {
          assetPath = new URL(request.url).pathname;
          return new Response("asset");
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset");
  assert.equal(assetPath, "/index.html");

  const missingBinding = await worker.fetch(
    new Request("https://profiler.example/"),
    {},
  );
  assert.equal(missingBinding.status, 503);
});

test("hosted build emits static UI, registry, and source traces", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metal-viz-hosted-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicRoot = path.join(root, "public");
  const traceRoot = path.join(root, "showcase");
  const outputRoot = path.join(root, "dist");
  await mkdir(path.join(traceRoot, "nested"), { recursive: true });
  await mkdir(publicRoot, { recursive: true });
  await writeFile(
    path.join(publicRoot, "index.html"),
    "<!doctype html><title>Hosted profiler</title>",
  );
  await writeFile(path.join(publicRoot, "app.js"), "export {};\n");
  await writeFile(
    path.join(traceRoot, "nested", "capture one.jsonl"),
    '{"record":"summary","schema_version":1}\\n',
  );
  await writeFile(
    path.join(traceRoot, "traces.json"),
    JSON.stringify({
      schema_version: 1,
      root_label: "Hosted showcase",
      traces: {
        "nested/capture one.jsonl": {
          label: "Capture one",
        },
      },
    }),
  );
  await writeFile(path.join(traceRoot, ".private-token"), "do not publish");
  await writeFile(path.join(traceRoot, "notes.txt"), "do not publish");
  const outsideTrace = path.join(root, "outside.jsonl");
  await writeFile(outsideTrace, '{"record":"outside"}\n');
  await symlink(outsideTrace, path.join(traceRoot, "nested", "linked.jsonl"));

  const result = await buildHostedSite({
    publicRoot,
    traceRoot,
    outputRoot,
  });

  assert.equal(result.traceCount, 1);
  assert.match(
    await readFile(path.join(outputRoot, "client", "index.html"), "utf8"),
    /Hosted profiler/,
  );
  assert.equal(
    await readFile(path.join(outputRoot, "client", "app.js"), "utf8"),
    "export {};\n",
  );
  assert.match(
    await readFile(
      path.join(
        outputRoot,
        "client",
        "traces",
        "showcase",
        "nested",
        "capture one.jsonl",
      ),
      "utf8",
    ),
    /"summary"/,
  );
  const registry = JSON.parse(
    await readFile(
      path.join(outputRoot, "client", "hosted-traces.json"),
      "utf8",
    ),
  );
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.rootLabel, "Hosted showcase");
  assert.equal(registry.traces.length, 1);
  assert.equal(registry.traces[0].label, "Capture one");
  assert.equal(registry.traces[0].relativePath, "nested/capture one.jsonl");
  assert.equal("sourceUrl" in registry.traces[0], false);
  for (const unpublished of [
    path.join(
      outputRoot,
      "client",
      "traces",
      "showcase",
      ".private-token",
    ),
    path.join(
      outputRoot,
      "client",
      "traces",
      "showcase",
      "notes.txt",
    ),
    path.join(
      outputRoot,
      "client",
      "traces",
      "showcase",
      "nested",
      "linked.jsonl",
    ),
  ]) {
    await assert.rejects(readFile(unpublished), { code: "ENOENT" });
  }
});

test("hosted build rejects nested and symlink-aliased output without deleting sources", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metal-viz-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicRoot = path.join(root, "public");
  const traceRoot = path.join(root, "showcase");
  await mkdir(publicRoot, { recursive: true });
  await mkdir(traceRoot, { recursive: true });
  const publicMarker = path.join(publicRoot, "index.html");
  const traceMarker = path.join(traceRoot, "capture.jsonl");
  await writeFile(publicMarker, "public marker");
  await writeFile(traceMarker, '{"record":"summary"}\n');

  await assert.rejects(
    buildHostedSite({
      publicRoot,
      traceRoot,
      outputRoot: path.join(publicRoot, "dist"),
    }),
    /must not overlap/i,
  );
  assert.equal(await readFile(publicMarker, "utf8"), "public marker");

  const publicAlias = path.join(root, "public-alias");
  await symlink(publicRoot, publicAlias);
  await assert.rejects(
    buildHostedSite({
      publicRoot,
      traceRoot,
      outputRoot: path.join(publicAlias, "dist"),
    }),
    /must not overlap/i,
  );
  assert.equal(await readFile(publicMarker, "utf8"), "public marker");
  assert.match(await readFile(traceMarker, "utf8"), /summary/);
});

test("hosted build keeps the prior artifact when a registered trace path is swapped", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metal-viz-swap-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicRoot = path.join(root, "public");
  const traceRoot = path.join(root, "showcase");
  const outputRoot = path.join(root, "dist");
  await mkdir(publicRoot, { recursive: true });
  await mkdir(traceRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(publicRoot, "index.html"), "new public");
  const tracePath = path.join(traceRoot, "capture.jsonl");
  const originalPath = path.join(root, "original.jsonl");
  const replacementPath = path.join(root, "replacement.jsonl");
  await writeFile(tracePath, '{"record":"original"}\n');
  await writeFile(replacementPath, '{"record":"replacement"}\n');
  await writeFile(path.join(outputRoot, "sentinel.txt"), "prior artifact");

  let swapped = false;
  await assert.rejects(
    buildHostedSite({
      publicRoot,
      traceRoot,
      outputRoot,
      registryHooks: {
        async afterTraceOpen() {
          if (swapped) return;
          swapped = true;
          await rename(tracePath, originalPath);
          await rename(replacementPath, tracePath);
        },
      },
    }),
    /changed before it could be published/i,
  );

  assert.equal(
    await readFile(path.join(outputRoot, "sentinel.txt"), "utf8"),
    "prior artifact",
  );
  assert.match(await readFile(tracePath, "utf8"), /replacement/);
});

test("hosted build rejects public symlinks before generated trace writes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metal-viz-public-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicRoot = path.join(root, "public");
  const traceRoot = path.join(root, "showcase");
  const outputRoot = path.join(root, "dist");
  const externalRoot = path.join(root, "external");
  await mkdir(publicRoot, { recursive: true });
  await mkdir(traceRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await mkdir(externalRoot, { recursive: true });
  await writeFile(path.join(publicRoot, "index.html"), "new public");
  await symlink(externalRoot, path.join(publicRoot, "traces"));
  await writeFile(
    path.join(traceRoot, "capture.jsonl"),
    '{"record":"summary"}\n',
  );
  await writeFile(path.join(outputRoot, "sentinel.txt"), "prior artifact");

  await assert.rejects(
    buildHostedSite({ publicRoot, traceRoot, outputRoot }),
    /symbolic links/i,
  );

  await assert.rejects(
    readFile(path.join(externalRoot, "showcase", "capture.jsonl")),
    { code: "ENOENT" },
  );
  assert.equal(
    await readFile(path.join(outputRoot, "sentinel.txt"), "utf8"),
    "prior artifact",
  );
});

test("hosted build rolls back when the final artifact rename fails", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metal-viz-rename-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const publicRoot = path.join(root, "public");
  const traceRoot = path.join(root, "showcase");
  const outputRoot = path.join(root, "dist");
  await mkdir(publicRoot, { recursive: true });
  await mkdir(traceRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(publicRoot, "index.html"), "new public");
  await writeFile(
    path.join(traceRoot, "capture.jsonl"),
    '{"record":"summary"}\n',
  );
  await writeFile(path.join(outputRoot, "sentinel.txt"), "prior artifact");

  await assert.rejects(
    buildHostedSite({
      publicRoot,
      traceRoot,
      outputRoot,
      replacementHooks: {
        async beforeFinalRename() {
          throw new Error("injected final rename failure");
        },
      },
    }),
    /injected final rename failure/,
  );

  assert.equal(
    await readFile(path.join(outputRoot, "sentinel.txt"), "utf8"),
    "prior artifact",
  );
  await assert.rejects(
    readFile(path.join(outputRoot, "client", "index.html")),
    {
      code: "ENOENT",
    },
  );
});
