import assert from "node:assert/strict";
import test from "node:test";

import { normalizeArchitecture } from "../src/observatory/architecture.js";

function qwenDenseConfig() {
  return {
    text_config: {
      model_type: "qwen3_5_text",
      num_hidden_layers: 64,
      hidden_size: 5120,
      vocab_size: 248320,
      layer_types: Array.from(
        { length: 64 },
        (_, index) =>
          index % 4 === 3 ? "full_attention" : "linear_attention",
      ),
      num_attention_heads: 24,
      num_key_value_heads: 4,
      head_dim: 256,
      linear_num_key_heads: 16,
      linear_num_value_heads: 48,
      linear_key_head_dim: 128,
      linear_value_head_dim: 128,
      intermediate_size: 17408,
      mtp_num_hidden_layers: 1,
      mtp_use_dedicated_embeddings: false,
    },
  };
}

function qwenMoeMetadata() {
  return {
    source: "checkpoint-config",
    model_type: "qwen3_5_moe_text",
    num_hidden_layers: 40,
    hidden_size: 2048,
    vocab_size: 248320,
    layer_type_pattern: [
      "linear_attention",
      "linear_attention",
      "linear_attention",
      "full_attention",
    ],
    num_attention_heads: 16,
    num_key_value_heads: 2,
    head_dim: 256,
    linear_num_key_heads: 16,
    linear_num_value_heads: 32,
    linear_key_head_dim: 128,
    linear_value_head_dim: 128,
    moe_intermediate_size: 512,
    shared_expert_intermediate_size: 512,
    num_experts: 256,
    num_experts_per_tok: 8,
    mtp_num_hidden_layers: 1,
    mtp_use_dedicated_embeddings: false,
  };
}

test("normalizes a nested dense checkpoint config into an immutable architecture", () => {
  const architecture = normalizeArchitecture(qwenDenseConfig());

  assert.equal(architecture.source, "checkpoint-config");
  assert.equal(architecture.modelType, "qwen3_5_text");
  assert.equal(architecture.numHiddenLayers, 64);
  assert.equal(architecture.hiddenSize, 5120);
  assert.equal(architecture.vocabSize, 248320);
  assert.equal(architecture.layerTypes.length, 64);
  assert.equal(architecture.layerTypes[0], "linear_attention");
  assert.equal(architecture.layerTypes[3], "full_attention");
  assert.deepEqual(architecture.attention, {
    queryHeads: 24,
    keyValueHeads: 4,
    headDimension: 256,
  });
  assert.deepEqual(architecture.linearAttention, {
    keyHeads: 16,
    valueHeads: 48,
    keyHeadDimension: 128,
    valueHeadDimension: 128,
  });
  assert.deepEqual(architecture.feedForward, {
    kind: "dense",
    intermediateSize: 17408,
    sharedIntermediateSize: null,
    experts: null,
    expertsPerToken: null,
  });
  assert.deepEqual(architecture.mtp, {
    layers: 1,
    dedicatedEmbeddings: false,
  });
  assert.equal(Object.isFrozen(architecture), true);
  assert.equal(Object.isFrozen(architecture.layerTypes), true);
  assert.equal(Object.isFrozen(architecture.feedForward), true);
});

test("expands top-level MoE pattern metadata to the exact configured layer count", () => {
  const architecture = normalizeArchitecture(qwenMoeMetadata());

  assert.equal(architecture.modelType, "qwen3_5_moe_text");
  assert.equal(architecture.numHiddenLayers, 40);
  assert.equal(architecture.layerTypes.length, 40);
  assert.deepEqual(architecture.layerTypes.slice(0, 8), [
    "linear_attention",
    "linear_attention",
    "linear_attention",
    "full_attention",
    "linear_attention",
    "linear_attention",
    "linear_attention",
    "full_attention",
  ]);
  assert.deepEqual(architecture.linearAttention, {
    keyHeads: 16,
    valueHeads: 32,
    keyHeadDimension: 128,
    valueHeadDimension: 128,
  });
  assert.deepEqual(architecture.feedForward, {
    kind: "moe",
    intermediateSize: 512,
    sharedIntermediateSize: 512,
    experts: 256,
    expertsPerToken: 8,
  });
});

test("accepts its own normalized output without changing the data contract", () => {
  const normalized = normalizeArchitecture(qwenDenseConfig());
  assert.deepEqual(normalizeArchitecture(normalized), normalized);
});

test("returns null only when optional architecture is absent", () => {
  assert.equal(
    normalizeArchitecture(undefined, { required: false }),
    null,
  );
  assert.throws(
    () => normalizeArchitecture(undefined),
    /architecture configuration is required/i,
  );
});

test("rejects incomplete, inconsistent, or inherited architecture data", () => {
  assert.throws(
    () => normalizeArchitecture({ num_hidden_layers: 40 }),
    /hidden_size/i,
  );
  assert.throws(
    () =>
      normalizeArchitecture({
        ...qwenMoeMetadata(),
        layer_type_pattern: ["invented_attention"],
      }),
    /layer type/i,
  );
  assert.throws(
    () =>
      normalizeArchitecture({
        ...qwenMoeMetadata(),
        num_experts_per_tok: 257,
      }),
    /num_experts_per_tok/i,
  );
  const inherited = Object.create(qwenMoeMetadata());
  assert.throws(
    () => normalizeArchitecture(inherited),
    /plain object/i,
  );
  assert.throws(
    () =>
      normalizeArchitecture({
        ...qwenMoeMetadata(),
        num_hidden_layers: 10_000,
      }),
    /num_hidden_layers/i,
  );
});
