import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGACY_SHOWCASE_FILENAMES,
  huggingFaceRepoUrl,
  parseRunFilename,
  validateRunFilename,
} from "../public/run-identity.js";

const VALID_NAME =
  "youssofal--qwen3.6-27b-mtplx-optimized-speed__davidtai__2026-07-24t18-30-15z.window-cb64.jsonl";

test("parses model-first run filenames into sortable identity fields", () => {
  assert.deepEqual(parseRunFilename(VALID_NAME), {
    repositorySlug: "youssofal/qwen3.6-27b-mtplx-optimized-speed",
    contributor: "davidtai",
    captureUtc: "2026-07-24T18:30:15Z",
    artifact: "window-cb64",
    extension: ".jsonl",
  });
  assert.deepEqual(validateRunFilename(VALID_NAME), {
    valid: true,
    errors: [],
  });
});

test("accepts raw NDJSON and derives canonical Hugging Face URLs", () => {
  const filename =
    "mlx-community--laguna-s-2.1-oq4e__trace-author__2026-12-31t23-59-59z.raw.ndjson";
  assert.equal(parseRunFilename(filename)?.artifact, "raw");
  assert.equal(
    huggingFaceRepoUrl("mlx-community/Laguna-S-2.1-oQ4e"),
    "https://huggingface.co/mlx-community/Laguna-S-2.1-oQ4e",
  );
  assert.equal(
    huggingFaceRepoUrl("owner/model_with-dots.v2"),
    "https://huggingface.co/owner/model_with-dots.v2",
  );
});

test("rejects unsafe or ambiguous Hugging Face repository identifiers", () => {
  for (const repository of [
    "",
    "single-segment",
    "/model",
    "owner/",
    "owner/model/extra",
    "owner/../model",
    "owner/model?download=1",
    "owner/model#files",
    "owner//model",
    "owner/space model",
    "owner/https://example.com",
  ]) {
    assert.equal(
      huggingFaceRepoUrl(repository),
      null,
      `should reject ${JSON.stringify(repository)}`,
    );
  }
});

test("rejects malformed dates, fields, paths, and artifact names", () => {
  for (const filename of [
    "Youssofal--model__davidtai__2026-07-24t18-30-15z.raw.jsonl",
    "owner--model__DavidTai__2026-07-24t18-30-15z.raw.jsonl",
    "owner--model__davidtai__2026-02-30t18-30-15z.raw.jsonl",
    "owner--model__davidtai__2026-07-24t24-00-00z.raw.jsonl",
    "owner--model__davidtai__2026-07-24.raw.jsonl",
    "owner--model__davidtai__2026-07-24t18-30-15z.window.jsonl",
    "owner--model__davidtai__2026-07-24t18-30-15z.window-cb0.jsonl",
    "owner--model__davidtai__2026-07-24t18-30-15z.raw.txt",
    "owner--model__davidtai__extra__2026-07-24t18-30-15z.raw.jsonl",
    "../owner--model__davidtai__2026-07-24t18-30-15z.raw.jsonl",
    "folder/owner--model__davidtai__2026-07-24t18-30-15z.raw.jsonl",
    "owner---model__davidtai__2026-07-24t18-30-15z.raw.jsonl",
    "owner--model__david--tai__2026-07-24t18-30-15z.raw.jsonl",
  ]) {
    const result = validateRunFilename(filename);
    assert.equal(result.valid, false, `should reject ${filename}`);
    assert.ok(result.errors.length > 0, `should explain ${filename}`);
    assert.equal(parseRunFilename(filename), null);
  }
});

test("rejects filenames longer than the publication cap", () => {
  const filename =
    `owner--${"m".repeat(170)}__davidtai__2026-07-24t18-30-15z.raw.jsonl`;
  const result = validateRunFilename(filename);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /200 characters/i);
});

test("keeps the published legacy filename allowlist exact and closed", () => {
  assert.deepEqual(LEGACY_SHOWCASE_FILENAMES, [
    "glm52-q1t-t158-mtp-k3.jsonl",
    "hy3-oq2e-mtp-k2.jsonl",
    "laguna-s21-oq4e-ar.jsonl",
    "qwen36-27b-mtp-k3.jsonl",
    "qwen36-35b-a3b-k1.jsonl",
  ]);
  assert.equal(Object.isFrozen(LEGACY_SHOWCASE_FILENAMES), true);
});
