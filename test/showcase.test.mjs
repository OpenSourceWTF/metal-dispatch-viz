import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import {
  huggingFaceRepoUrl,
  LEGACY_SHOWCASE_FILENAMES,
  validateRunFilename,
} from "../public/run-identity.js";

const showcaseUrl = new URL("../traces/showcase/", import.meta.url);
const manifestUrl = new URL("traces.json", showcaseUrl);

function countRecords(rows, record) {
  return rows.filter((row) => row?.record === record).length;
}

test("bundled showcase is an exact manifest-to-folder bijection", async () => {
  const manifestText = await readFile(manifestUrl, "utf8");
  const manifest = JSON.parse(manifestText);
  const files = (await readdir(showcaseUrl))
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  const manifestFiles = Object.keys(manifest.traces).sort();

  assert.equal(manifest.schema_version, 1);
  assert.deepEqual(files, manifestFiles);
  assert.doesNotMatch(manifestText, /\/Users\//);

  for (const legacyFilename of LEGACY_SHOWCASE_FILENAMES) {
    assert.ok(
      Object.hasOwn(manifest.traces, legacyFilename),
      `${legacyFilename}: grandfathered path remains published`,
    );
  }

  for (const [filename, metadata] of Object.entries(manifest.traces)) {
    assert.equal(typeof metadata.label, "string", `${filename}: label`);
    assert.ok(metadata.label.length > 0, `${filename}: non-empty label`);
    const exactRepository = metadata.huggingface_repo;
    const sourceRepository = metadata.huggingface_source_repo;
    assert.notEqual(
      Boolean(exactRepository),
      Boolean(sourceRepository),
      `${filename}: exactly one Hugging Face provenance field`,
    );
    const repository = exactRepository ?? sourceRepository;
    assert.ok(
      huggingFaceRepoUrl(repository),
      `${filename}: valid Hugging Face provenance`,
    );
    if (sourceRepository) {
      assert.equal(
        exactRepository,
        undefined,
        `${filename}: local derivative is not mislabeled as a public checkpoint`,
      );
    }
    assert.equal(metadata.artifact_status, "curated-window");
    assert.match(metadata.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof metadata.source_complete, metadata.source_complete === null ? "object" : "boolean");
    assert.equal(typeof metadata.valid_evidence, "boolean");
  }
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

  for (const filename of Object.keys(manifest.traces)) {
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
