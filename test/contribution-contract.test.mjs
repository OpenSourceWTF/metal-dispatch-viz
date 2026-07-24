import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse as parseYaml } from "yaml";

const repositoryRoot = new URL("../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, repositoryRoot), "utf8");
}

test("README provides complete local run and verification commands", async () => {
  const readme = await read("README.md");
  for (const command of [
    "npm ci",
    "npm exec -- vite --host 127.0.0.1 --port 5173",
    "npm start -- --trace-dir /path/to/trace-folder",
    "npm run build",
    "npm test",
    "npm run verify:pages",
  ]) {
    assert.match(readme, new RegExp(command.replaceAll("/", "\\/")));
  }
  assert.match(readme, /\[Contributing\]\(CONTRIBUTING\.md\)/);
  assert.match(
    readme,
    /\[Submitting a profiler run\]\(docs\/submitting-traces\.md\)/,
  );
});

test("contributor guide separates code and trace evidence workflows", async () => {
  const guide = await read("CONTRIBUTING.md");
  for (const expectation of [
    /fork/i,
    /feature\s+branch/i,
    /npm ci/,
    /targeted tests/i,
    /npm test/,
    /npm run build/,
    /npm run verify:pages/,
    /docs\/submitting-traces\.md/,
    /MIT\s+license/i,
    /do not commit.*raw trace/is,
    /do not.*secret/is,
    /one concern/i,
  ]) {
    assert.match(guide, expectation);
  }
});

test("trace submission guide preserves capture, evidence, and privacy traps", async () => {
  const guide = await read("docs/submitting-traces.md");
  for (const expectation of [
    /OpenSourceWTF\/mlx-profiler/,
    /<hf-owner>--<hf-repo>__<contributor>__<utc-date>\.<artifact>\.jsonl/,
    /huggingface_repo/,
    /huggingface_revision/,
    /npm run validate:run-name/,
    /MLX_DISPATCH_CENSUS/,
    /before Python starts/i,
    /cannot attach/i,
    /complete.*true/is,
    /dropped_rows.*0/is,
    /scripts\/curate_trace\.py/,
    /--verify/,
    /Never hand-trim/i,
    /shasum -a 256/,
    /model\s+weights/i,
    /prompts/i,
    /generated\s+text/i,
    /private\s+filesystem\s+paths/i,
    /ordered\s+placement/i,
    /critical\s+path/i,
    /redistribute.*MIT\s+license/is,
  ]) {
    assert.match(guide, expectation);
  }
});

test("new-run issue form requires reproducible model and evidence identity", async () => {
  const source = await read(".github/ISSUE_TEMPLATE/new-trace-run.yml");
  const template = parseYaml(source);
  assert.equal(template.name, "Submit a profiler run");
  assert.match(template.title, /^\[run\]/);
  assert.ok(Array.isArray(template.body));

  const controls = new Map(
    template.body
      .filter((entry) => typeof entry?.id === "string")
      .map((entry) => [entry.id, entry]),
  );
  for (const id of [
    "filename",
    "huggingface_repo",
    "huggingface_revision",
    "contributor",
    "capture_utc",
    "hardware",
    "macos",
    "quantization",
    "mode",
    "profiler_commit",
    "workload_commit",
    "workload_command",
    "terminal_summary",
    "raw_sha256",
    "curated_sha256",
    "curator_command",
    "attachment",
  ]) {
    assert.equal(
      controls.get(id)?.validations?.required,
      true,
      `${id} is required`,
    );
  }

  const confirmations = controls.get("confirmations");
  assert.equal(confirmations?.type, "checkboxes");
  assert.ok(confirmations.attributes.options.length >= 4);
  assert.ok(
    confirmations.attributes.options.every(
      (option) => option.required === true,
    ),
  );
  const confirmationText = confirmations.attributes.options
    .map(({ label }) => label)
    .join(" ");
  assert.match(confirmationText, /public Hugging Face/i);
  assert.match(confirmationText, /no secrets/i);
  assert.match(confirmationText, /not hand-edited/i);
  assert.match(confirmationText, /MIT license/i);
});
