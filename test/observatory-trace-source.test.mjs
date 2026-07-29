import assert from "node:assert/strict";
import test from "node:test";

import {
  createGalleryTraceSource,
  createLocalTraceSource,
  loadObservatoryRegistry,
} from "../src/observatory/trace-source.js";

test("registry loading returns a metadata-discovered Qwen gallery", async () => {
  const requests = [];
  const registry = {
    traces: [
      {
        id: "q35",
        model: "Qwen3.6 35B-A3B",
        relativePath: "q35.jsonl",
      },
      {
        id: "glm",
        model: "GLM-5.2",
        relativePath: "glm.jsonl",
      },
      {
        id: "q27",
        model: "Qwen3.6 27B",
        relativePath: "q27.jsonl",
      },
    ],
  };
  const result = await loadObservatoryRegistry({
    baseUrl: "https://example.test/viz/",
    async fetchImpl(url) {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => "hosted" },
        json: async () => registry,
      };
    },
  });

  assert.deepEqual(requests, ["https://example.test/viz/api/traces"]);
  assert.equal(result.hosted, true);
  assert.equal(result.registry, registry);
  assert.deepEqual(
    result.gallery.map(({ id }) => id),
    ["q27", "q35"],
  );
});

test("gallery sources retain the existing safe hosted and server routing", () => {
  const hosted = createGalleryTraceSource({
    trace: {
      id: "safe-id",
      relativePath: "nested/capture one.jsonl",
    },
    hosted: true,
    baseUrl: "https://example.test/viz/",
  });
  assert.equal(hosted.kind, "gallery");
  assert.equal(
    hosted.url,
    "https://example.test/viz/traces/showcase/nested/capture%20one.jsonl",
  );
  assert.doesNotThrow(() => hosted.release());

  assert.equal(
    createGalleryTraceSource({
      trace: { id: "safe-id", relativePath: "capture.jsonl" },
      hosted: false,
      baseUrl: "https://example.test/viz/",
    }).url,
    "https://example.test/viz/api/traces/safe-id",
  );

  assert.throws(
    () =>
      createGalleryTraceSource({
        trace: { id: "unsafe", relativePath: "../secret.jsonl" },
        hosted: true,
      }),
    /safe relativePath/i,
  );
});

test("local trace sources accept profiler files and revoke their object URL once", () => {
  const created = [];
  const revoked = [];
  const file = {
    name: "My Capture.NDJSON",
    size: 1024,
    lastModified: 123,
  };
  const source = createLocalTraceSource(file, {
    createObjectURL(value) {
      created.push(value);
      return "blob:observatory-test";
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  });

  assert.deepEqual(created, [file]);
  assert.equal(source.kind, "local");
  assert.equal(source.url, "blob:observatory-test");
  assert.equal(source.trace.label, "My Capture.NDJSON");
  assert.equal(source.trace.size, 1024);
  assert.equal(source.trace.sourceKind, "local-file");
  source.release();
  source.release();
  assert.deepEqual(revoked, ["blob:observatory-test"]);
});

test("local trace sources reject unsupported files before allocating a URL", () => {
  let created = false;
  assert.throws(
    () =>
      createLocalTraceSource(
        { name: "capture.txt", size: 10 },
        {
          createObjectURL() {
            created = true;
            return "blob:should-not-exist";
          },
          revokeObjectURL() {},
        },
      ),
    /jsonl.*ndjson/i,
  );
  assert.equal(created, false);
});
