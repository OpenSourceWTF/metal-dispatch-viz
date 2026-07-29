import assert from "node:assert/strict";
import test from "node:test";

import {
  createGalleryTraceSource,
  createLocalTraceSource,
  loadObservatoryRegistry,
  readLocalArchitectureConfig,
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

test("local checkpoint config is normalized entirely from the selected file", async () => {
  let networkRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkRequests += 1;
    throw new Error("Local config must not use the network");
  };
  try {
    const source = {
      text_config: {
        model_type: "qwen3_5_text",
        num_hidden_layers: 4,
        hidden_size: 128,
        vocab_size: 1024,
        layer_types: [
          "linear_attention",
          "linear_attention",
          "linear_attention",
          "full_attention",
        ],
        num_attention_heads: 4,
        num_key_value_heads: 2,
        head_dim: 32,
        linear_num_key_heads: 2,
        linear_num_value_heads: 4,
        linear_key_head_dim: 16,
        linear_value_head_dim: 16,
        intermediate_size: 384,
        mtp_num_hidden_layers: 1,
        mtp_use_dedicated_embeddings: false,
      },
    };
    const serialized = JSON.stringify(source);
    const architecture = await readLocalArchitectureConfig({
      name: "config.json",
      size: serialized.length,
      text: async () => serialized,
    });

    assert.equal(architecture.numHiddenLayers, 4);
    assert.equal(architecture.hiddenSize, 128);
    assert.equal(architecture.feedForward.kind, "dense");
    assert.equal(Object.isFrozen(architecture), true);
    assert.equal(networkRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local checkpoint config rejects unsafe files before scene installation", async () => {
  await assert.rejects(
    readLocalArchitectureConfig({
      name: "config.txt",
      size: 2,
      text: async () => "{}",
    }),
    /\.json file/i,
  );
  await assert.rejects(
    readLocalArchitectureConfig({
      name: "config.json",
      size: 9,
      text: async () => "{not json",
    }),
    /not valid JSON/i,
  );
  await assert.rejects(
    readLocalArchitectureConfig({
      name: "config.json",
      size: 2,
      text: async () => "{}",
    }),
    /architecture configuration is required/i,
  );

  let readOversized = false;
  await assert.rejects(
    readLocalArchitectureConfig({
      name: "config.json",
      size: 2 * 1024 * 1024 + 1,
      text: async () => {
        readOversized = true;
        return "{}";
      },
    }),
    /2 MiB or smaller/i,
  );
  assert.equal(readOversized, false);
});
