import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildHostedSite } from "../scripts/build_hosted.mjs";

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

  const result = await buildHostedSite({
    publicRoot,
    traceRoot,
    outputRoot,
  });

  assert.equal(result.traceCount, 1);
  assert.match(
    await readFile(path.join(outputRoot, "index.html"), "utf8"),
    /Hosted profiler/,
  );
  assert.equal(
    await readFile(path.join(outputRoot, "app.js"), "utf8"),
    "export {};\n",
  );
  assert.match(
    await readFile(
      path.join(
        outputRoot,
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
    await readFile(path.join(outputRoot, "hosted-traces.json"), "utf8"),
  );
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.rootLabel, "Hosted showcase");
  assert.equal(registry.traces.length, 1);
  assert.equal(registry.traces[0].label, "Capture one");
  assert.equal(registry.traces[0].relativePath, "nested/capture one.jsonl");
  assert.equal("sourceUrl" in registry.traces[0], false);
});
