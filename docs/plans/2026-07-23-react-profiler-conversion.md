# React Profiler Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a working React/Vite profiler that preserves every current interaction and builds into the independently deployable `dist/client` artifact.

**Architecture:** React renders the semantic shell and owns the controller lifecycle. The proven controller, parser, worker, canvas timeline, and range navigator remain the behavior authority. Vite bundles the browser graph into a staging directory, then the existing hosted builder atomically publishes it with the five manifest-authorized traces.

**Tech Stack:** React 19, React DOM 19, Vite 8, Vitest 4, jsdom 29, Express 5, supported Node lines (`^20.19.0 || ^22.13.0 || >=24.0.0`), npm, GitHub Pages.

**Assumptions:**

- Assumes current `public/app.js` remains the parity oracle — this round does not migrate controller state into React hooks.
- Assumes Vite preserves `new URL(..., import.meta.url)` worker assets — build smoke tests fail if that stops being true.
- Assumes the controller-required DOM IDs remain stable — React component refactors must not rename them.

### Task 1: Add the React/Vite toolchain with exact versions

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `test/package-contract.test.mjs`

**Security flag:** security

- [x] Add exact runtime dependencies `react@19.2.8` and `react-dom@19.2.8`.
- [x] Add exact dev dependencies `vite@8.1.5`, `@vitejs/plugin-react@6.0.4`, `vitest@4.1.10`, `jsdom@29.1.1`, and patched `yaml@2.9.0`.
- [x] Set the Node engine to the supported intersection `^20.19.0 || ^22.13.0 || >=24.0.0`.
- [x] Update the package-contract test before each package change and observe its failure.
- [x] After each tightly coupled dependency group, run `npm test`, `npm ls --all`, and `npm audit`.
- [x] Commit with `Add the React profiler toolchain`.

### Task 2: Render the proven workbench from React

**Files:**

- Create: `index.html`
- Create: `src/main.jsx`
- Create: `src/ProfilerApp.jsx`
- Create: `test/react-shell.test.jsx`
- Modify: `public/app.js`
- Modify: `public/analysis-session.js`
- Modify: `test/ui-contract.test.mjs`
- Modify: `test/app-integration.test.mjs`
- Remove: `public/index.html`

**Security flag:** none

- [x] Write a failing React shell test that renders `ProfilerApp` in jsdom and asserts every ID consumed by `bootstrap()` exists exactly once.
- [x] Write failing lifecycle tests for resolved and pending bootstrap; assert teardown occurs exactly once.
- [x] Convert the current semantic HTML to JSX without changing IDs, class names, accessible names, initial copy, table headings, or control states.
- [x] Split presentational sections only when the output contract remains role-equivalent.
- [x] Add an idempotent controller `destroy()` method and remove document-driven auto-bootstrap.
- [x] Import `dataset-worker.js?worker&url` in the React entry and inject the generated absolute URL through `analysisSessionFactory`.
- [x] Resolve registry, API, and hosted-trace URLs from `document.baseURI`; add root and `/metal-dispatch-viz/` tests.
- [x] Mount through `src/main.jsx`; import the existing CSS and controller modules through Vite.
- [x] Update the UI contract to inspect the React shell rather than deleted static HTML.
- [x] Run focused React, integration, range, timeline, and UI-contract tests.
- [x] Commit with `Render the profiler workbench from React`.

### Task 3: Make the authoritative build and Express runtime serve React

**Files:**

- Create: `vite.config.js`
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `scripts/build_hosted.mjs`
- Modify: `server.mjs`
- Modify: `server/app.mjs`
- Modify: `test/hosted-build.test.mjs`
- Modify: `test/server.test.mjs`

**Security flag:** security

- [x] Write failing tests that require the hosted builder to consume a compiled client root and Express to serve `dist/client`.
- [x] Configure Vite with `publicDir: false` and a staging output outside `dist`.
- [x] Configure `base: "./"` and `emptyOutDir: true`; ignore the staging directory and prove a stale sentinel is removed.
- [x] Reject a symlink or non-directory hosted output leaf while canonicalizing only its parent; prove an external symlink target survives.
- [x] Add a builder-only fail-closed manifest allowlist; reject absent, malformed, or symlinked manifests and unlisted supported traces without changing Express folder discovery.
- [x] Make `npm run build` run Vite followed by the existing atomic hosted builder.
- [x] Preserve `dist/client`, the Sites worker, hosting metadata, generated registry, and exactly five traces.
- [x] Make `npm start` build first, then launch the single folder-driven Express app.
- [x] Smoke fallback from `/api/traces` to `/hosted-traces.json`.
- [x] Run the full Node and Vitest suites plus `npm run build`.
- [x] Commit with `Build and serve the React profiler`.

### Task 4: Add the hardened Pages artifact verifier and workflow

**Files:**

- Create: `scripts/verify_pages_artifact.mjs`
- Create: `test/pages-artifact.test.mjs`
- Create: `test/pages-workflow.test.mjs`
- Create: `.github/workflows/deploy-pages.yml`
- Modify: `package.json`
- Modify: `test/package-contract.test.mjs`

**Security flag:** security

- [x] Write failing verifier tests for valid output, root and intermediate symlinks, non-trace files, `.ndjson`, uppercase extensions, Windows absolute paths, and supported trace files outside the showcase subtree.
- [x] Require the source manifest and every required asset to be regular non-symlink files, with ancestor-identity and full-read race checks.
- [x] Prove exact manifest-registry-artifact equality and reject every extra showcase entry.
- [x] Enforce relative hashed boot assets and add `npm run verify:pages`.
- [x] Parse the workflow with `yaml`; assert exact triggers, split job permissions, checkout credential removal, full action SHAs, gate order, `needs`, main-only deploy, concurrency, and `dist/client`.
- [x] Use these verified action pins:
  - `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (`v7.0.1`)
  - `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` (`v7.0.0`)
  - `actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d` (`v6.0.0`)
  - `actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9` (`v5.0.0`)
  - `actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128` (`v5.0.0`)
- [x] Run `npm test`, `npm run build`, `npm run verify:pages`, and `npm audit`.
- [x] Commit with `Deploy the React profiler with GitHub Pages`.

### Task 5: Verify UI parity and publish PR #3

**Files:**

- Modify: `README.md`
- Modify remotely: branch `feature/time-window-navigator`
- Modify remotely: draft PR #3

**Security flag:** none

- [x] Document React development, Express folder loading, manifest publication, Pages deployment, and exact local gates.
- [x] Run the complete test, build, verifier, audit, and stub-scan gates.
- [x] Start the production Express app on an available loopback port and record its PID.
- [x] Exercise all five traces, launch selection, View/Analyze, band and handle drags, zoom, fit, inspector pin/clear, refresh, theme, URL restoration, loading, error, empty, and degraded states.
- [x] Inspect desktop and narrow screenshots in both themes.
- [x] Stop only the recorded server PID and verify the port is free.
- [x] Merge current `main` UI fixes into the React shell, including the Field manual, contextual definitions, local AI export, and hidden-drawer hardening.
- [x] Push `feature/time-window-navigator` without force and update draft PR #3 with exact verification evidence.

### Task 6: Cut over only after merge

**Files:**

- Modify remotely: GitHub Pages settings
- Modify remotely: Sites custom-domain attachment
- Modify manually: Cloudflare DNS

**Security flag:** security

- [x] Enable workflow-based Pages before PR #3 is merged.
- [x] Stop if PR #3 remains open; this plan does not authorize merging.
- [ ] After merge, verify the automatic `main` workflow and default Pages origin.
- [ ] Claim `mlx-profiler.opensource.wtf` in GitHub Pages before changing DNS.
- [ ] Remove only Sites domain `appgdom_6a625f027840819197fc3bcc1ba81169` from project `appgprj_6a6257da7d008191bf19efaa69f939d9`.
- [ ] Add the DNS-only Cloudflare CNAME `mlx-profiler` to `opensourcewtf.github.io`.
- [ ] Verify GitHub's HTTPS certificate, enable enforcement, and smoke the index, five-run registry, bundled worker, and one JSONL.
- [ ] Keep `https://mlx-profiler.david301637.chatgpt.site` as rollback.
