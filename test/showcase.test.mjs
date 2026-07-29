import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  LEGACY_SHOWCASE_FILENAMES,
  validateRunFilename,
} from "../public/run-identity.js";

const showcaseUrl = new URL("../traces/showcase/", import.meta.url);
const manifestUrl = new URL("traces.json", showcaseUrl);

const EXPECTED_TRACES = new Map([
  ["glm52-q1t-t158-mtp-k3.jsonl", "GLM-5.2 1.58q"],
  ["hy3-oq2e-mtp-k2.jsonl", "Hy3 2q"],
  ["laguna-s21-oq4e-ar.jsonl", "Laguna 2.1 S"],
  ["qwen36-27b-mtp-k3.jsonl", "Qwen3.6 27B"],
  ["qwen36-35b-a3b-k1.jsonl", "Qwen3.6 35B"],
]);

const EXPECTED_HUGGING_FACE = new Map([
  ["hy3-oq2e-mtp-k2.jsonl", {
    field: "huggingface_repo",
    repository: "mlx-community/Hy3-oQ2e",
  }],
  ["qwen36-27b-mtp-k3.jsonl", {
    field: "huggingface_repo",
    repository: "Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed",
  }],
  ["qwen36-35b-a3b-k1.jsonl", {
    field: "huggingface_repo",
    repository: "Youssofal/Qwen3.6-35B-A3B-MTPLX-Optimized-Speed",
  }],
  ["glm52-q1t-t158-mtp-k3.jsonl", {
    field: "huggingface_source_repo",
    repository: "zai-org/GLM-5.2",
  }],
  ["laguna-s21-oq4e-ar.jsonl", {
    field: "huggingface_repo",
    repository: "mlx-community/Laguna-S-2.1-oQ4e",
  }],
]);

function countRecords(rows, record) {
  return rows.filter((row) => row?.record === record).length;
}

test("bundled showcase is an exact five-trace manifest-to-folder bijection", async () => {
  const manifestText = await readFile(manifestUrl, "utf8");
  const manifest = JSON.parse(manifestText);
  const files = (await readdir(showcaseUrl))
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  const manifestFiles = Object.keys(manifest.traces).sort();
  const expectedFiles = [...EXPECTED_TRACES.keys()].sort();

  assert.equal(manifest.schema_version, 1);
  assert.deepEqual(files, expectedFiles);
  assert.deepEqual(manifestFiles, expectedFiles);
  assert.deepEqual(LEGACY_SHOWCASE_FILENAMES, expectedFiles);
  assert.doesNotMatch(manifestText, /\/Users\//);

  for (const [filename, expectedLabel] of EXPECTED_TRACES) {
    const metadata = manifest.traces[filename];
    const huggingFace = EXPECTED_HUGGING_FACE.get(filename);
    assert.equal(metadata.label, expectedLabel);
    assert.equal(
      metadata[huggingFace.field],
      huggingFace.repository,
      `${filename}: honest Hugging Face provenance`,
    );
    if (huggingFace.field === "huggingface_source_repo") {
      assert.equal(
        metadata.huggingface_repo,
        undefined,
        `${filename}: local derivative is not mislabeled as a public checkpoint`,
      );
    }
    assert.equal(metadata.artifact_status, "curated-window");
    assert.match(metadata.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof metadata.source_complete, metadata.source_complete === null ? "object" : "boolean");
    assert.equal(typeof metadata.valid_evidence, "boolean");
  }

  const qwen27 =
    manifest.traces["qwen36-27b-mtp-k3.jsonl"].architecture;
  assert.equal(qwen27.num_hidden_layers, 64);
  assert.equal(qwen27.hidden_size, 5120);
  assert.equal(qwen27.linear_num_value_heads, 48);
  assert.equal(qwen27.intermediate_size, 17408);
  assert.equal(qwen27.mtp_num_hidden_layers, 1);

  const qwen35 =
    manifest.traces["qwen36-35b-a3b-k1.jsonl"].architecture;
  assert.equal(qwen35.num_hidden_layers, 40);
  assert.equal(qwen35.hidden_size, 2048);
  assert.equal(qwen35.linear_num_value_heads, 32);
  assert.equal(qwen35.num_experts, 256);
  assert.equal(qwen35.num_experts_per_tok, 8);
  assert.equal(qwen35.moe_intermediate_size, 512);
  assert.equal(qwen35.shared_expert_intermediate_size, 512);
  assert.equal(qwen35.mtp_num_hidden_layers, 1);
});

test("future showcase paths must use the model-contributor-date contract", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const legacy = new Set(LEGACY_SHOWCASE_FILENAMES);

  for (const filename of Object.keys(manifest.traces)) {
    if (legacy.has(filename)) continue;
    assert.deepEqual(
      validateRunFilename(filename),
      { valid: true, errors: [] },
      `${filename}: new showcase filename`,
    );
  }
});

test("every bundled window terminates in a count-exact standard v1 summary", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  for (const filename of EXPECTED_TRACES.keys()) {
    const text = await readFile(new URL(filename, showcaseUrl), "utf8");
    const rows = text.trimEnd().split("\n").map(JSON.parse);
    const summary = rows.at(-1);

    assert.equal(summary.record, "summary", `${filename}: terminal record`);
    assert.equal(summary.schema_version, 1, `${filename}: schema version`);
    assert.equal(summary.final, true, `${filename}: terminal flag`);
    assert.equal(summary.complete, true, `${filename}: completeness`);
    assert.equal(summary.dropped_rows, 0, `${filename}: dropped rows`);
    assert.equal(summary.ops_total, countRecords(rows, "op"), `${filename}: op total`);
    assert.equal(summary.cbs_total, countRecords(rows, "cb"), `${filename}: CB total`);
    assert.equal(summary.curated_window, true, `${filename}: curated marker`);
    assert.equal(
      summary.curator_schema,
      "metal-dispatch-viz.curated-window",
      `${filename}: curator schema`,
    );
    assert.equal(
      summary.source_sha256,
      manifest.traces[filename].source_sha256,
      `${filename}: raw source provenance`,
    );
  }
});
