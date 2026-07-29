import assert from "node:assert/strict";
import test from "node:test";

import { buildDataset } from "../public/data.js";
import {
  buildSceneModel,
  classifyKernelFamily,
  discoverObservatoryGallery,
  parseParameterCountBillions,
} from "../src/observatory/scene-model.js";

function qwenDataset() {
  return buildDataset([
    {
      record: "op",
      seq: 0,
      command_buffer_index: 0,
      kernel_name: "steel_gemm_fused_q4",
      grid: [64, 8, 1],
      threadgroup: [32, 1, 1],
      setBytes_calls: 2,
      setBytes_total_bytes: 128,
      buffer_binds: 4,
    },
    {
      record: "op",
      seq: 1,
      command_buffer_index: 0,
      kernel_name: "rms_norm",
      grid: [32, 1, 1],
      threadgroup: [32, 1, 1],
      buffer_binds: 2,
    },
    {
      record: "op",
      seq: 2,
      command_buffer_index: 0,
      kernel_name: "moe_router_topk",
      grid: [8, 1, 1],
      threadgroup: [8, 1, 1],
      buffer_binds: 1,
    },
    {
      record: "cb",
      command_buffer_index: 0,
      op_count: 3,
      first_op_seq: 0,
      last_op_seq: 2,
      encode_start_ns: 100,
      encode_end_ns: 400,
      gpu_start_ns: 200,
      gpu_end_ns: 500,
    },
    {
      record: "summary",
      final: true,
      complete: true,
      ops_total: 3,
      cbs_total: 1,
      dropped_rows: 0,
    },
  ]);
}

test("gallery discovery is metadata-driven and stable without fixed filenames or counts", () => {
  const registry = {
    traces: [
      { id: "x", model: "GLM-5.2", relativePath: "glm.jsonl" },
      {
        id: "a",
        model: "Qwen3.6 35B-A3B",
        relativePath: "anything-a.jsonl",
        mode: "MTP K1",
      },
      {
        id: "b",
        label: "Qwen3.6 27B",
        relativePath: "anything-b.jsonl",
        mode: "MTP K3",
      },
      {
        id: "c",
        checkpoint: "example/Qwen-7B",
        relativePath: "anything-c.jsonl",
      },
    ],
  };

  assert.deepEqual(
    discoverObservatoryGallery(registry).map(({ id }) => id),
    ["c", "b", "a"],
  );
  assert.deepEqual(discoverObservatoryGallery({ traces: [] }), []);
  assert.deepEqual(discoverObservatoryGallery(null), []);
});

test("parameter scale and kernel families are derived from metadata", () => {
  assert.equal(parseParameterCountBillions("Qwen3.6 35B-A3B"), 35);
  assert.equal(parseParameterCountBillions("model 2.7 b instruct"), 2.7);
  assert.equal(parseParameterCountBillions("unlabeled capture"), null);
  assert.equal(parseParameterCountBillions("model 0B"), null);

  assert.equal(classifyKernelFamily("flash_attention_decode"), "attention");
  assert.equal(classifyKernelFamily("steel_gemm_fused_q4"), "projection");
  assert.equal(classifyKernelFamily("rms_norm"), "normalization");
  assert.equal(classifyKernelFamily("moe_router_topk"), "routing");
  assert.equal(classifyKernelFamily("silu_gate"), "activation");
  assert.equal(classifyKernelFamily("token_embedding"), "embedding-output");
  assert.equal(classifyKernelFamily("copy_buffer"), "transfer-binding");
  assert.equal(classifyKernelFamily("mystery_kernel"), "other");
});

test("scene geometry preserves measured order and labels every inference boundary", () => {
  const model = buildSceneModel({
    trace: {
      id: "qwen-27",
      label: "Qwen3.6 27B",
      model: "Qwen3.6 27B",
      mode: "MTP K3",
      quantization: "affine Q4 group 64 target with native MTP head",
      source_evidence_status: "verified-complete",
    },
    dataset: qwenDataset(),
  });

  assert.equal(model.model.parameterBillions, 27);
  assert.equal(model.model.quantizationBits, 4);
  assert.equal(model.model.estimatedWeightGigabytes, 13.5);
  assert.equal(model.evidence.memory, "manifest-derived estimate");
  assert.equal(model.evidence.dispatch, "measured order");
  assert.equal(model.evidence.binding, "derived binding activity");
  assert.equal(model.evidence.storage, "unavailable in schema v1");
  assert.equal(model.speculation.configuredWidth, 3);
  assert.equal(model.speculation.acceptanceMeasured, false);
  assert.equal(model.parallelism.maxGpuCommandBuffers, 1);
  assert.equal(model.parallelism.evidence, "measured command-buffer overlap");

  assert.equal(model.frames.length, 3);
  assert.deepEqual(
    model.frames.map(({ family }) => family),
    ["projection", "normalization", "routing"],
  );
  assert.ok(
    model.frames.every(
      (frame) =>
        frame.progress >= 0 &&
        frame.progress <= 1 &&
        frame.ribbonLabel === "binding activity" &&
        !Object.hasOwn(frame, "read") &&
        !Object.hasOwn(frame, "write"),
    ),
  );
  assert.ok(model.frames[0].progress < model.frames[1].progress);
  assert.ok(model.frames[1].progress < model.frames[2].progress);
  assert.equal(
    model.kernelFamilies.reduce((sum, family) => sum + family.share, 0),
    1,
  );
  assert.ok(model.kernelFamilies.every(({ share }) => share > 0));
});

test("missing architecture metadata uses topology without inventing model mass", () => {
  const model = buildSceneModel({
    trace: {
      id: "local",
      label: "local-profile.jsonl",
      source_evidence_status: "browser-local",
    },
    dataset: qwenDataset(),
  });

  assert.equal(model.model.parameterBillions, null);
  assert.equal(model.model.quantizationBits, null);
  assert.equal(model.model.estimatedWeightGigabytes, null);
  assert.equal(model.model.geometrySource, "trace topology");
  assert.equal(model.evidence.memory, "architecture metadata unavailable");
  assert.equal(model.speculation.configuredWidth, null);
  assert.equal(model.speculation.acceptanceMeasured, false);
});

test("untimed dispatches retain source order with ordinal visual progress", () => {
  const dataset = {
    launchWindows: [
      {
        startNs: null,
        endNs: null,
        dispatches: [
          { seq: 9, kernel: "rms_norm", atNs: null },
          { seq: 10, kernel: "silu", atNs: null },
        ],
        commandBuffers: [],
      },
    ],
    health: { validEvidence: false },
  };

  const model = buildSceneModel({
    trace: { label: "local.jsonl" },
    dataset,
  });

  assert.deepEqual(
    model.frames.map(({ progress }) => progress),
    [0, 1],
  );
  assert.equal(model.evidence.timing, "ordinal fallback");
});
