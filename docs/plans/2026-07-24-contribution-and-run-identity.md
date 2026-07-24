# Contribution and Run Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship complete local/contribution documentation, a new-run submission form, sortable model-first trace names, and safe Hugging Face provenance links.

**Architecture:** A small pure module owns Hugging Face repository validation, URL derivation, and new-run filename parsing. The existing registry passes manifest metadata through, while the browser renders only derived Hugging Face URLs. Repository docs and an issue form own the human submission contract; tests grandfather the five stable published paths and enforce the new contract for future showcase files.

**Tech Stack:** Node.js ESM, React DOM shell with controller-owned rendering, Node test runner, Vitest, YAML GitHub issue forms, Markdown.

**Assumptions:**

- Assumes a new hosted run has a public primary Hugging Face repository — private or local-only checkpoints will not qualify until published.
- Assumes the five current paths must remain stable — this plan will not rename them.
- Assumes local trace browsing remains permissive — filename enforcement applies to new hosted contributions, not arbitrary local folders.

---

## File structure

- `public/run-identity.js` — pure repository-ID, URL, and filename contract.
- `scripts/validate_run_name.mjs` — Node CLI around the browser-safe contract.
- `test/run-identity.test.mjs` — filename and safe URL unit coverage.
- `public/app.js` — repository search and provenance-link rendering.
- `test/app-integration.test.mjs` — browser metadata behavior.
- `traces/showcase/traces.json` — honest Hugging Face metadata for current runs.
- `test/showcase.test.mjs` — stable-path grandfathering and metadata assertions.
- `CONTRIBUTING.md` — contributor entry point and code/data gates.
- `docs/submitting-traces.md` — complete trace capture and submission procedure.
- `.github/ISSUE_TEMPLATE/new-trace-run.yml` — structured new-run intake.
- `test/contribution-contract.test.mjs` — documentation and template contract.
- `README.md` — concise local-running path and contributor links.
- `package.json` — filename-validation command.

### Task 1: Run identity contract

**Files:**
- Create: `public/run-identity.js`
- Create: `scripts/validate_run_name.mjs`
- Create: `test/run-identity.test.mjs`
- Modify: `package.json`

**Security flag:** `security`

**Does NOT cover:** arbitrary local trace filenames; only the explicit validator and new hosted-run review path use this contract.

- [ ] **Step 1: Write failing tests**

Add tests that import `huggingFaceRepoUrl`, `parseRunFilename`,
`validateRunFilename`, and `LEGACY_SHOWCASE_FILENAMES`; assert the Qwen example
parses into repository, contributor, UTC timestamp, and `window-cb64`; reject
slashes, uppercase filename slugs, bad dates, extra fields, private paths,
unknown artifact forms, and names longer than 200 characters; prove the five
legacy paths are exact and closed.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/run-identity.test.mjs
```

Expected: fail because `public/run-identity.js` does not exist.

- [ ] **Step 3: Implement the pure module and CLI**

Export the four tested symbols. Validate canonical repository IDs as exactly
two nonempty path segments, construct URLs with `encodeURIComponent`, parse:

```text
<owner>--<repo>__<contributor>__<yyyy-mm-ddThh-mm-ssZ>.<raw|window-cbN>.(jsonl|ndjson)
```

Keep the public module browser-safe. Add a separate Node CLI that prints
diagnostics with exit code 1 when invoked as:

```bash
node scripts/validate_run_name.mjs <filename>
```

Add:

```json
"validate:run-name": "node scripts/validate_run_name.mjs"
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/run-identity.test.mjs
```

Expected: all run-identity tests pass.

### Task 2: Safe Hugging Face provenance

**Files:**
- Modify: `public/app.js`
- Modify: `test/app-integration.test.mjs`
- Modify: `test/ui-contract.test.mjs`

**Security flag:** `security`

**Does NOT cover:** arbitrary outbound manifest URLs or remote repository availability checks.

- [ ] **Step 1: Write failing integration tests**

Assert that run search matches `huggingface_repo` and
`huggingface_source_repo`. Add a DOM test proving primary metadata renders an
anchor whose URL is derived as
`https://huggingface.co/Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed`, with
`target="_blank"` and `rel="noopener noreferrer"`; source-only metadata uses
the `Hugging Face source` label; malformed IDs render no link.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/app-integration.test.mjs test/ui-contract.test.mjs
```

Expected: the new search and provenance-link assertions fail.

- [ ] **Step 3: Implement browser behavior**

Import `huggingFaceRepoUrl` into `public/app.js`, add both repository fields to
the search haystack, change `sourceMetadata()` rows to objects carrying
optional derived `href`, and render links only for those derived rows.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/app-integration.test.mjs test/ui-contract.test.mjs
```

Expected: all targeted browser contract tests pass.

### Task 3: Current showcase metadata and future-name enforcement

**Files:**
- Modify: `traces/showcase/traces.json`
- Modify: `test/showcase.test.mjs`

**Security flag:** `none`

**Does NOT cover:** inventing unknown contributor, revision, or hardware data for existing captures.

- [ ] **Step 1: Write failing showcase assertions**

Assert exact primary repository values for Hy3, both Qwen runs, and Laguna;
assert GLM has source-only `zai-org/GLM-5.2`; assert every current filename is
in `LEGACY_SHOWCASE_FILENAMES`; and assert any future non-legacy manifest path
passes `validateRunFilename`.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/showcase.test.mjs
```

Expected: fail because the manifest lacks Hugging Face repository fields.

- [ ] **Step 3: Add honest manifest metadata**

Add:

```json
"huggingface_repo": "mlx-community/Hy3-oQ2e"
"huggingface_repo": "Youssofal/Qwen3.6-27B-MTPLX-Optimized-Speed"
"huggingface_repo": "Youssofal/Qwen3.6-35B-A3B-MTPLX-Optimized-Speed"
"huggingface_source_repo": "zai-org/GLM-5.2"
"huggingface_repo": "mlx-community/Laguna-S-2.1-oQ4e"
```

to their corresponding entries without changing filenames or other evidence.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/showcase.test.mjs
```

Expected: all showcase tests pass.

### Task 4: Contributor documentation and new-run template

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `docs/submitting-traces.md`
- Create: `.github/ISSUE_TEMPLATE/new-trace-run.yml`
- Create: `test/contribution-contract.test.mjs`
- Modify: `README.md`

**Security flag:** `security`

**Does NOT cover:** an automated upload service, hosted raw-trace storage, or permission to redistribute files without the submitter’s affirmation.

- [ ] **Step 1: Write failing contract tests**

Assert the files exist; the README contains `npm ci`,
`npm start -- --trace-dir`, `npm run build`, `npm test`, and
`npm run verify:pages`; the contributor guide links the submission guide and
states branch/PR/test/security expectations; the trace guide contains the exact
filename grammar, terminal-summary validation, curator verification, privacy
traps, Hugging Face requirements, and redistribution permission; parse the
issue form with `yaml` and assert required fields/checks for model URL,
revision, contributor, capture UTC, hardware, profiler commit, workload
command, summary, hashes, attachment, and permission.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/contribution-contract.test.mjs
```

Expected: fail because the contribution files do not exist.

- [ ] **Step 3: Write the documentation and issue form**

Make `CONTRIBUTING.md` the entry point, move the complete Issue #1 procedure
into `docs/submitting-traces.md`, add the YAML new-run form, and keep the README
quick-start concise with links to the detailed guides.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/contribution-contract.test.mjs
```

Expected: all contribution contract tests pass.

### Task 5: Full verification

**Files:**
- Modify: `project-map.md`

**Security flag:** `none`

- [ ] **Step 1: Run formatting and contract checks**

```bash
npm run validate:run-name -- \
  youssofal--qwen3.6-27b-mtplx-optimized-speed__davidtai__2026-07-24t18-30-15z.window-cb64.jsonl
npm test
```

Expected: validator exits 0 and the complete test suite passes.

- [ ] **Step 2: Build and verify publication**

```bash
npm run build
npm run verify:pages
```

Expected: the Vite/hosted build and Pages artifact verification pass.

- [ ] **Step 3: Review the diff and update the project map**

Confirm no trace path or JSONL content changed, no arbitrary outbound URL is
rendered, and document the new identity/contribution files in
`project-map.md`.

- [ ] **Step 4: Commit**

```bash
git add README.md CONTRIBUTING.md docs/submitting-traces.md \
  .github/ISSUE_TEMPLATE/new-trace-run.yml public/run-identity.js \
  scripts/validate_run_name.mjs \
  public/app.js traces/showcase/traces.json package.json project-map.md \
  test/run-identity.test.mjs test/app-integration.test.mjs \
  test/ui-contract.test.mjs test/showcase.test.mjs \
  test/contribution-contract.test.mjs \
  docs/specs/2026-07-24-contribution-and-run-identity-design.md \
  docs/plans/2026-07-24-contribution-and-run-identity.md
git commit -m "feat: standardize community trace submissions"
```
