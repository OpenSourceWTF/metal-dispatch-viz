# MLX Profiler GitHub Pages Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the profiler independently from `OpenSourceWTF/metal-dispatch-viz` on GitHub Pages and prepare the safe cutover of `mlx-profiler.opensource.wtf`.

**Architecture:** The existing hosted builder remains the only producer of browser assets and curated traces. A post-build verifier proves that `dist/client` contains the required static entrypoints and a bijection between the source manifest, generated registry, and emitted JSONL files. A repository-owned GitHub Actions workflow tests, builds, verifies, and deploys only `dist/client`; GitHub Pages and Cloudflare own the custom hostname.

**Tech Stack:** Node.js 22, Node test runner, npm, GitHub Actions, GitHub Pages, GitHub CLI, Cloudflare DNS.

**Assumptions:**

- Assumes `main` remains the GitHub default branch — the automatic deployment will NOT run after merge if the default branch is renamed without updating the workflow.
- Assumes the existing `npm run build` contract keeps browser output under `dist/client` — the Pages upload will NOT include the Sites worker or hosting metadata.
- Assumes PR #3 remains the publication branch for this work — a replacement PR requires updating the publication commands.
- Assumes Cloudflare DNS can be changed in the dashboard — this machine has no configured Cloudflare CLI, so DNS cutover will NOT be automated.
- Assumes the temporary Sites project remains available at `https://mlx-profiler.david301637.chatgpt.site` — rollback will NOT depend on the custom-domain claim after it is removed.

## File structure

- Create `scripts/verify_pages_artifact.mjs`: validate the static Pages artifact against the source manifest and hosted registry.
- Create `test/pages-artifact.test.mjs`: cover a valid artifact, an extra JSONL, and a missing required browser file.
- Modify `package.json`: expose `npm run verify:pages`.
- Modify `test/package-contract.test.mjs`: lock the new command into the package contract.
- Create `test/pages-workflow.test.mjs`: lock workflow triggers, gates, permissions, and upload path.
- Create `.github/workflows/deploy-pages.yml`: build and deploy the profiler from this repository.
- Modify `README.md`: document run publication, Pages deployment, custom-domain setup, and local verification.

### Task 1: Prove the Pages artifact is exactly the curated run set

**Files:**

- Create: `test/pages-artifact.test.mjs`
- Create: `scripts/verify_pages_artifact.mjs`

**Security flag:** security

**Does NOT cover:** This validator checks the completed static artifact; it does not change trace curation rules, accept arbitrary upload paths, or inspect JSONL contents.

- [ ] **Step 1: Write the failing artifact-contract test**

```js
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyPagesArtifact } from "../scripts/verify_pages_artifact.mjs";

async function writeFixture(root) {
  const clientRoot = path.join(root, "client");
  const manifestPath = path.join(root, "traces.json");
  await mkdir(path.join(clientRoot, "traces", "showcase"), {
    recursive: true,
  });
  await writeFile(path.join(clientRoot, "index.html"), "<!doctype html>");
  await writeFile(path.join(clientRoot, "dataset-worker.js"), "export {};\n");
  await writeFile(
    path.join(clientRoot, "traces", "showcase", "run.jsonl"),
    '{"record":"summary"}\n',
  );
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      root_label: "Fixture",
      traces: { "run.jsonl": { label: "Run" } },
    }),
  );
  await writeFile(
    path.join(clientRoot, "hosted-traces.json"),
    JSON.stringify({
      schemaVersion: 1,
      rootLabel: "Fixture",
      traces: [{ id: "run", label: "Run", relativePath: "run.jsonl" }],
    }),
  );
  return { clientRoot, manifestPath };
}

test("Pages artifact matches its source manifest and hosted registry", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metal-viz-pages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await writeFixture(root);

  assert.deepEqual(await verifyPagesArtifact(fixture), { traceCount: 1 });
});

test("Pages artifact rejects an unregistered JSONL", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metal-viz-pages-extra-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await writeFixture(root);
  await writeFile(
    path.join(
      fixture.clientRoot,
      "traces",
      "showcase",
      "unregistered.jsonl",
    ),
    '{"record":"summary"}\n',
  );

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /emitted trace files do not match the source manifest/i,
  );
});

test("Pages artifact rejects a missing dataset worker", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "metal-viz-pages-worker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await writeFixture(root);
  await rm(path.join(fixture.clientRoot, "dataset-worker.js"));

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /dataset-worker\.js must be a regular file/i,
  );
});
```

- [ ] **Step 2: Run the test and confirm the module is absent**

Run: `node --test test/pages-artifact.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/verify_pages_artifact.mjs`.

- [ ] **Step 3: Implement the artifact verifier**

```js
import {
  lstat,
  opendir,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function assertSafeRelativePath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    path.posix.isAbsolute(value) ||
    value.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw new TypeError(`${label} must be a safe relative POSIX path.`);
  }
}

async function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} must be readable JSON: ${error.message}`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must contain a JSON object.`);
  }
  return value;
}

async function assertRegularFile(filePath, label) {
  let stat;
  try {
    stat = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} must be a regular file.`);
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
}

async function collectJsonl(root, relative = "") {
  const found = [];
  const directory = await opendir(path.join(root, relative));
  for await (const entry of directory) {
    const child = relative
      ? path.posix.join(relative, entry.name)
      : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`Pages trace output must not contain symlinks: ${child}`);
    }
    if (entry.isDirectory()) {
      found.push(...(await collectJsonl(root, child)));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      found.push(child);
    }
  }
  return found.sort();
}

function assertSameMembers(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

export async function verifyPagesArtifact({ clientRoot, manifestPath }) {
  const resolvedClient = path.resolve(clientRoot);
  const resolvedManifest = path.resolve(manifestPath);
  for (const required of [
    "index.html",
    "dataset-worker.js",
    "hosted-traces.json",
  ]) {
    await assertRegularFile(
      path.join(resolvedClient, required),
      required,
    );
  }

  const manifest = await readJson(resolvedManifest, "source manifest");
  const registry = await readJson(
    path.join(resolvedClient, "hosted-traces.json"),
    "hosted registry",
  );
  if (
    manifest.traces === null ||
    typeof manifest.traces !== "object" ||
    Array.isArray(manifest.traces)
  ) {
    throw new TypeError("source manifest traces must be an object.");
  }
  if (!Array.isArray(registry.traces)) {
    throw new TypeError("hosted registry traces must be an array.");
  }
  if (
    registry.schemaVersion !== manifest.schema_version ||
    registry.rootLabel !== manifest.root_label
  ) {
    throw new Error("hosted registry metadata does not match the source manifest.");
  }

  const expected = Object.keys(manifest.traces).sort();
  for (const relativePath of expected) {
    assertSafeRelativePath(relativePath, "manifest trace path");
  }
  const registered = registry.traces
    .map((trace, index) => {
      assertSafeRelativePath(
        trace?.relativePath,
        `registry trace ${index} relativePath`,
      );
      return trace.relativePath;
    })
    .sort();
  assertSameMembers(
    registered,
    expected,
    "hosted registry does not match the source manifest",
  );

  const emitted = await collectJsonl(
    path.join(resolvedClient, "traces", "showcase"),
  );
  assertSameMembers(
    emitted,
    expected,
    "emitted trace files do not match the source manifest",
  );
  return Object.freeze({ traceCount: expected.length });
}

function isMainModule() {
  return (
    typeof process.argv[1] === "string" &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  const result = await verifyPagesArtifact({
    clientRoot: new URL("../dist/client/", import.meta.url).pathname,
    manifestPath: new URL(
      "../traces/showcase/traces.json",
      import.meta.url,
    ).pathname,
  });
  console.log(`Verified Pages artifact with ${result.traceCount} traces.`);
}
```

- [ ] **Step 4: Run the focused and full test suites**

Run: `node --test test/pages-artifact.test.mjs && npm test`

Expected: the three artifact tests pass and the full Node suite remains green.

- [ ] **Step 5: Commit the verifier**

```bash
git add scripts/verify_pages_artifact.mjs test/pages-artifact.test.mjs
git commit -m "Verify the static Pages artifact"
```

### Task 2: Expose verification as a locked package command

**Files:**

- Modify: `test/package-contract.test.mjs`
- Modify: `package.json`

**Security flag:** none

- [ ] **Step 1: Change the package-contract expectation first**

```js
assert.deepEqual(packageJson.scripts, {
  build: "node scripts/build_hosted.mjs",
  start: "node server.mjs",
  test: "node --test",
  "verify:pages": "node scripts/verify_pages_artifact.mjs",
});
```

- [ ] **Step 2: Confirm the package contract fails**

Run: `node --test test/package-contract.test.mjs`

Expected: FAIL because `package.json` does not yet define `verify:pages`.

- [ ] **Step 3: Add the package command**

```json
"scripts": {
  "build": "node scripts/build_hosted.mjs",
  "start": "node server.mjs",
  "test": "node --test",
  "verify:pages": "node scripts/verify_pages_artifact.mjs"
}
```

- [ ] **Step 4: Build and verify the real five-trace artifact**

Run: `npm run build && npm run verify:pages`

Expected: `Built hosted profiler with 5 traces` followed by `Verified Pages artifact with 5 traces.`

- [ ] **Step 5: Commit the package contract**

```bash
git add package.json test/package-contract.test.mjs
git commit -m "Expose the Pages artifact verification gate"
```

### Task 3: Add the independent GitHub Pages workflow

**Files:**

- Create: `test/pages-workflow.test.mjs`
- Create: `.github/workflows/deploy-pages.yml`

**Security flag:** security

**Does NOT cover:** The workflow deploys repository-controlled static files only; it does not accept trace uploads, dispatch the main-site workflow, configure DNS, or publish from pull requests automatically.

- [ ] **Step 1: Write the failing workflow contract**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
  "../.github/workflows/deploy-pages.yml",
  import.meta.url,
);

test("Pages workflow owns the complete profiler deployment gate", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  for (const required of [
    "branches: [main]",
    "workflow_dispatch:",
    "pages: write",
    "id-token: write",
    "npm ci",
    "npm test",
    "npm run build",
    "npm run verify:pages",
    "npm audit --omit=dev",
    "actions/configure-pages@v5",
    "actions/upload-pages-artifact@v3",
    "path: dist/client",
    "actions/deploy-pages@v4",
  ]) {
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /opensource\.wtf.*workflow/i);
});
```

- [ ] **Step 2: Confirm the workflow is absent**

Run: `node --test test/pages-workflow.test.mjs`

Expected: FAIL with `ENOENT` for `.github/workflows/deploy-pages.yml`.

- [ ] **Step 3: Add the deployment workflow**

```yaml
name: Deploy profiler to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout profiler
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm

      - name: Install locked dependencies
        run: npm ci

      - name: Test
        run: npm test

      - name: Build hosted profiler
        run: npm run build

      - name: Verify Pages artifact
        run: npm run verify:pages

      - name: Audit production dependencies
        run: npm audit --omit=dev

      - name: Configure Pages
        uses: actions/configure-pages@v5

      - name: Upload static profiler
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist/client

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 4: Run the workflow and package contracts**

Run: `node --test test/pages-workflow.test.mjs test/package-contract.test.mjs`

Expected: both contract files pass.

- [ ] **Step 5: Commit the workflow**

```bash
git add .github/workflows/deploy-pages.yml test/pages-workflow.test.mjs
git commit -m "Deploy the profiler with GitHub Pages"
```

### Task 4: Document the independent release and run-publication contract

**Files:**

- Modify: `README.md`

**Security flag:** none

- [ ] **Step 1: Add the deployment documentation**

Append these sections, preserving the existing local-development documentation:

```markdown
## Published showcase

The public profiler is built from `traces/showcase/traces.json`. That manifest
is the publication allowlist: `npm run build` copies only its registered JSONL
files into `dist/client/traces/showcase` and writes the browser registry to
`dist/client/hosted-traces.json`.

To add or replace a public run:

1. Put the curated JSONL under `traces/showcase/`.
2. Add its metadata and relative path to `traces/showcase/traces.json`.
3. Run `npm test`.
4. Run `npm run build && npm run verify:pages`.
5. Review the generated registry and load the run through the local server.

Unlisted JSONL files are not published.

## GitHub Pages

`.github/workflows/deploy-pages.yml` owns the independent profiler release. A
push to `main`, or a manual workflow dispatch, installs locked dependencies,
tests, builds, verifies the manifest-to-artifact mapping, audits production
dependencies, and uploads only `dist/client`.

The canonical origin is `https://mlx-profiler.opensource.wtf`. Configure that
hostname in the repository's GitHub Pages settings before adding the Cloudflare
DNS-only CNAME to `opensourcewtf.github.io`. A committed `CNAME` file is not
part of this custom-Actions publishing path.
```

- [ ] **Step 2: Run the documented local gate verbatim**

Run: `npm ci && npm test && npm run build && npm run verify:pages && npm audit --omit=dev`

Expected: installation succeeds, every test passes, the build and verifier each report five traces, and the production dependency audit is clean.

- [ ] **Step 3: Commit the documentation**

```bash
git add README.md
git commit -m "Document independent profiler publication"
```

### Task 5: Publish the implementation to draft PR #3

**Files:**

- Modify remotely: `OpenSourceWTF/metal-dispatch-viz` branch `feature/time-window-navigator`
- Modify remotely: PR #3

**Security flag:** none

- [ ] **Step 1: Verify the exact outgoing branch**

Run: `git status --short --branch && git log --oneline origin/feature/time-window-navigator..HEAD`

Expected: only the planned commits are ahead of `origin/feature/time-window-navigator`, with no unrelated worktree changes.

- [ ] **Step 2: Push the branch**

Run: `git push origin feature/time-window-navigator`

Expected: the remote branch advances without a force push.

- [ ] **Step 3: Update the existing PR body**

Run:

```bash
gh pr edit 3 --repo OpenSourceWTF/metal-dispatch-viz \
  --body-file /tmp/metal-dispatch-viz-pr3.md
```

The body file must retain the existing time-window feature summary and add:

```markdown
## Independent GitHub Pages release

- deploys `dist/client` from this repository only
- publication remains allowlisted by `traces/showcase/traces.json`
- tests the build, verifies the registry/artifact bijection, and audits production dependencies before upload
- prepares `mlx-profiler.opensource.wtf`; it does not couple to the `opensource.wtf` build

## Verification

- `npm test`
- `npm run build`
- `npm run verify:pages`
- `npm audit --omit=dev`
```

Expected: PR #3 remains draft and shows the new commits and verification block.

### Task 6: Cut over the custom hostname after PR #3 is merged

**Files:**

- Modify remotely: GitHub Pages settings for `OpenSourceWTF/metal-dispatch-viz`
- Modify remotely: temporary Sites custom-domain attachment
- Modify manually: Cloudflare DNS zone `opensource.wtf`

**Security flag:** security

**Does NOT cover:** This task does not merge PR #3, remove the temporary Sites deployment, proxy traffic through Cloudflare during certificate issuance, or publish links from `opensource.wtf` before the profiler origin is healthy.

- [ ] **Step 1: Enable workflow-based GitHub Pages**

Run:

```bash
gh api --method POST repos/OpenSourceWTF/metal-dispatch-viz/pages \
  -f build_type=workflow
```

Expected: the Pages API returns a site object whose `build_type` is `workflow`. If the site already exists, inspect it with `gh api repos/OpenSourceWTF/metal-dispatch-viz/pages` and use `PUT` only when `build_type` differs. Complete this before PR #3 is merged so its push-to-`main` event can deploy.

- [ ] **Step 2: Stop until PR #3 is merged**

Run:

```bash
gh pr view 3 \
  --repo OpenSourceWTF/metal-dispatch-viz \
  --json state,mergeCommit \
  --jq '{state,mergeCommit: .mergeCommit.oid}'
```

Expected: `state` is `MERGED`. If it is still `OPEN`, pause; this plan does not authorize merging it.

- [ ] **Step 3: Verify the automatic main-branch deployment**

Run:

```bash
PROFILER_RUN_ID="$(
  gh run list \
    --repo OpenSourceWTF/metal-dispatch-viz \
    --workflow deploy-pages.yml \
    --branch main \
    --event push \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId'
)"
test -n "$PROFILER_RUN_ID"
gh run watch "$PROFILER_RUN_ID" \
  --repo OpenSourceWTF/metal-dispatch-viz \
  --exit-status
```

Expected: the workflow succeeds and its deployment URL serves the profiler before DNS changes.

- [ ] **Step 4: Claim the custom domain in GitHub Pages before DNS**

Run:

```bash
gh api --method PUT repos/OpenSourceWTF/metal-dispatch-viz/pages \
  -f build_type=workflow \
  -f cname=mlx-profiler.opensource.wtf
```

Expected: `gh api repos/OpenSourceWTF/metal-dispatch-viz/pages --jq '{cname,build_type}'` reports `mlx-profiler.opensource.wtf` and `workflow`.

- [ ] **Step 5: Remove only the pending Sites hostname claim**

Use the Sites custom-domain removal operation with:

```text
project_id: appgprj_6a6257da7d008191bf19efaa69f939d9
custom_domain_id: appgdom_6a625f027840819197fc3bcc1ba81169
```

Expected: the Sites project no longer lists `mlx-profiler.opensource.wtf`; `https://mlx-profiler.david301637.chatgpt.site` remains deployed.

- [ ] **Step 6: Make the Cloudflare DNS-only cutover**

In the Cloudflare dashboard for `opensource.wtf`:

```text
Delete if present:
  TXT _openai-site-verification.mlx-profiler
  TXT _cf-custom-hostname.mlx-profiler

Create:
  Type: CNAME
  Name: mlx-profiler
  Target: opensourcewtf.github.io
  Proxy status: DNS only
  TTL: Auto
```

Expected: `dig +short CNAME mlx-profiler.opensource.wtf` returns `opensourcewtf.github.io.`.

- [ ] **Step 7: Verify HTTPS, then enable enforcement**

Run:

```bash
gh api repos/OpenSourceWTF/metal-dispatch-viz/pages \
  --jq '{cname,https_certificate,https_enforced,status}'
curl --fail --silent --show-error \
  https://mlx-profiler.opensource.wtf/ >/dev/null
```

When GitHub reports the certificate approved, run:

```bash
gh api --method PUT repos/OpenSourceWTF/metal-dispatch-viz/pages \
  -F https_enforced=true
```

Expected: the Pages API reports `https_enforced: true`.

- [ ] **Step 8: Verify the live five-run contract**

Run:

```bash
curl --fail --silent --show-error \
  https://mlx-profiler.opensource.wtf/hosted-traces.json \
  | node -e '
    let body = "";
    process.stdin.on("data", chunk => body += chunk);
    process.stdin.on("end", () => {
      const registry = JSON.parse(body);
      if (registry.traces.length !== 5) process.exit(1);
      console.log(registry.traces.map(trace => trace.label).join("\n"));
    });
  '
curl --fail --silent --show-error \
  https://mlx-profiler.opensource.wtf/traces/showcase/hy3-oq2e-mtp-k2.jsonl \
  | head -n 1
```

Expected: the registry lists all five showcase labels and the source JSONL returns a record.

## Rollback

- Before DNS cutover: leave the pending Sites custom domain attached and correct the Pages deployment.
- After DNS cutover but before HTTPS is healthy: restore the Cloudflare CNAME to `custom-domains.chatgpt.site` only if the Sites custom-domain claim is reattached and revalidated first.
- At all stages: the direct temporary URL `https://mlx-profiler.david301637.chatgpt.site` remains the user-facing fallback.
