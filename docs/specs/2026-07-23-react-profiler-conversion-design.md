# React profiler conversion

Date: 2026-07-23

## Decision

Convert the profiler's browser entrypoint and semantic UI to React while
preserving the current workbench as the behavioral authority.

This is a parity-first migration, not a visual reset and not a rewrite of the
trace-analysis engine. The current branch is the parity oracle for every label,
interaction, URL parameter, loading state, and inspector transition.

The profiler remains an independent application in
`OpenSourceWTF/metal-dispatch-viz`. `opensource.wtf` links to it but does not
build, embed, proxy, or publish it.

## Premise

React is not required for GitHub Pages. The existing browser modules can
already be hosted statically. A full rewrite would therefore be
disproportionate and would put recently fixed interaction races back at risk.

The proportional conversion is a strangler boundary:

- React owns the application root, semantic layout, and controller lifecycle.
- The proven workbench controller remains the state and interaction authority
  for this release.
- The parser, trace loader, analysis session, worker protocol, canvas timeline,
  and range navigator remain unchanged unless bundling requires an explicit
  path adapter.
- React emits the same stable element IDs and class names the controller
  currently owns, so the migration preserves behavior instead of duplicating
  it.

This provides a real React/Vite application boundary now while leaving
controller-to-hook migration as a separately testable future refactor.

## Required UI parity

The React build must preserve all current fixes:

- folder/API registry loading with hosted-manifest fallback;
- selection and toggling across all five showcase traces;
- honest trace states: `Not loaded` and `Capture complete`, without the old
  `Evidence: Pending` or ambiguous `Complete` labels;
- explicit degraded explanations for legacy, incomplete, dropped, or missing
  capture evidence;
- launch selection and multi-window disambiguation;
- View and Analyze time-window modes;
- draggable start/end handles, whole-band sliding, keyboard adjustments, fit,
  zoom, and URL restoration;
- exact range analysis through the existing worker session;
- drag continuity when exact results publish;
- inspector selection and pin persistence across cached loading, analysis
  readiness, pending launch swaps, and range interaction;
- pin clearing only when a confirmed exact canvas replacement invalidates it;
- dark/light theme behavior and canvas palette refresh;
- loading, error, empty, success, partial/degraded, and pending states;
- accessible trace-rail keyboard navigation and live-region announcements.

The current Node integration tests remain the behavior lock. React-specific
tests additionally prove that the rendered shell contains the complete
controller contract and that mount/unmount owns one controller lifecycle.

## React boundary

### Application shell

`src/ProfilerApp.jsx` renders the existing semantic workbench as React JSX.
The markup is split into focused presentational components when that reduces
file size without changing IDs or hierarchy:

- `TraceRail`
- `TraceContext`
- `MetricGrid`
- `TimelineWorkspace`
- `RangeControls`
- `DataTables`
- `Inspector`

These components receive no raw dispatch rows. They render static controller
mount points and accessible initial states.

### Lifecycle adapter

`src/main.jsx` mounts `ProfilerApp`. `ProfilerApp` starts the exported
`bootstrap()` controller in an effect after the DOM exists.

`bootstrap()` returns an idempotent `destroy()` method. React cleanup calls it,
including when development Strict Mode mounts twice. The controller no longer
auto-starts merely because `document` exists.

### Existing analysis modules

The existing ES modules stay isolated from React:

- `public/data.js`
- `public/trace-loader.js`
- `public/analysis-session.js`
- `public/client-dataset.js`
- `public/dataset-worker.js`
- `public/timeline.js`
- `public/range-navigator.js`
- `public/app.js`

Vite treats these as source modules rather than an unprocessed public
directory. Their `new URL(..., import.meta.url)` worker references are bundled
and content-hashed.

The React entry imports `dataset-worker.js?worker&url` and injects that
Vite-produced URL into the existing `TraceAnalysisSession` factory. This makes
the worker graph explicit to Vite; the controller's injectable worker seam
remains available to Node tests.

Registry and trace URLs are resolved from `document.baseURI`, not from `/`.
Vite uses `base: "./"` so the same client works at the default GitHub Pages
project path (`/metal-dispatch-viz/`) and at the custom-domain root.

React never stores the complete trace dataset or per-dispatch records in
component state. Large-data parsing and exact range analysis remain off the
main thread.

## Build and local runtime

Vite builds the React client into a staging directory outside `dist`.
`scripts/build_hosted.mjs` then:

1. copies the Vite client artifact;
2. writes the generated hosted registry;
3. publishes exactly the manifest-authorized showcase traces;
4. emits the existing Sites worker and hosting metadata;
5. atomically replaces `dist`.

`npm run build` remains authoritative and produces `dist/client`.

The staging directory is ignored, Vite empties it on every build, and a stale
sentinel regression proves old hashed assets cannot survive. The hosted builder
canonicalizes only the output parent and rejects a symlink or non-directory
output leaf before replacement.

Static publication fails closed when `traces/showcase/traces.json` is absent,
malformed, or symlinked. The builder requires exact equality between the
manifest paths and the registry paths before copying. Folder-driven Express
discovery keeps its existing optional-metadata behavior; only static
publication requires the allowlist.

The Express app serves `dist/client` and the folder-driven `/api/traces`
routes. `npm start` builds first, then starts the single Express application.
The hosted deployment uses the static manifest fallback and requires no
Express server.

## Pages artifact security

The post-build verifier treats the source manifest as a trust anchor and
requires it to be a regular non-symlink file.

It snapshots every artifact directory and regular file, opens files without
following the file entry, brackets every full read with ancestor identity
checks, and compares device, inode, size, modification time, and change time.
Only the index and generated registry are retained as decoded text; trace and
bundle contents are streamed through a bounded buffer and discarded.

It rejects:

- a symlinked output leaf that could redirect atomic replacement;
- a symlinked client root or any symlinked intermediate trace directory;
- POSIX or Windows absolute manifest paths;
- empty, dot, dot-dot, or backslash path segments;
- any unregistered regular file or special entry under
  `dist/client/traces/showcase`;
- any supported trace file outside that subtree;
- registry, manifest, or artifact set mismatches;
- missing React entrypoint, bundled worker, registry, or required browser
  assets;
- root-relative, unhashed, missing, or comment-only React boot assets.

The verifier follows the same case-insensitive `.jsonl` and `.ndjson`
extension policy as `TraceRegistry`. Its required module, stylesheet, and
worker paths use Vite's relative content-hashed output shape so the artifact
works at both the project Pages path and custom-domain root.

## GitHub Actions security

The Pages workflow has two jobs:

- `build` receives only `contents: read`, checks out with persisted credentials
  disabled, installs locked dependencies, tests, builds, audits, configures
  Pages, performs a final exact-artifact verification, and immediately uploads
  that verified Pages artifact;
- `deploy` depends on `build`, receives only `pages: write` and
  `id-token: write`, is restricted to `refs/heads/main`, and deploys into the
  `github-pages` environment.

Every action is pinned to a verified full commit SHA with its release tag in a
comment. The workflow contract is parsed as YAML and asserts exact triggers,
job permissions, action pins, gate ordering, dependency, branch restriction,
non-cancelling `pages` concurrency, and the `dist/client` upload path.

## Main-site integration

The existing `opensource.wtf` design remains unchanged:

- one canonical `https://mlx-profiler.opensource.wtf` constant;
- safe new-tab links in primary navigation, Home, Projects, and footer;
- a profiler-specific project mark;
- no local route, copied trace, iframe, or deployment dependency.

The external-link type requires an HTTPS URL. The structural link component
overrides hostile runtime `target`/`rel` props and includes an assistive
`opens in new tab` announcement.

## Testing

### Behavior parity

- Keep the complete existing Node suite green.
- Preserve the current fake-DOM integration tests for selection, range
  analysis, drag continuity, inspector pins, evidence copy, URL restoration,
  and lifecycle races.
- Add React render/lifecycle tests with Vitest and jsdom.
- Assert the React shell contains every controller-required ID exactly once.
- Assert bootstrap runs after mount and destroy runs on unmount.

### Build and artifact

- `npm test`
- `npm run build`
- `npm run verify:pages`
- `npm audit`
- serve `dist/client` through Express and smoke the index, generated registry,
  bundled worker, and one JSONL;
- verify the registry lists exactly five traces.

### Visual

Inspect the React build at desktop and narrow widths in both themes. Exercise
trace switching, launch switching, range dragging, Analyze mode, zoom, fit,
pin, clear, and refresh.

## Rollout

1. Land the React conversion and artifact gates on PR #3.
2. Enable workflow-based Pages before PR #3 is merged.
3. After merge, verify the automatic `main` deployment at the default Pages
   origin.
4. Claim `mlx-profiler.opensource.wtf` in GitHub Pages.
5. Remove only the pending Sites custom-domain claim.
6. Add the DNS-only Cloudflare CNAME to `opensourcewtf.github.io`.
7. Verify the HTTPS certificate and enable enforcement.
8. Verify the five-run live contract.
9. Publish the `opensource.wtf` links.
10. Keep the direct temporary Sites URL as rollback.

## Failure-mode check

### React mount resets an in-progress interaction

Severity: critical.

The controller is mounted once per React lifecycle, stable controller nodes are
not keyed by trace/range state, and the exact-result-during-drag plus
inspector-pin tests remain mandatory.

### Vite changes worker or hosted trace URLs

Severity: critical.

The worker is imported through Vite's explicit `?worker&url` graph, hosted
registry and trace URLs resolve from `document.baseURI`, and both the custom
root and default `/metal-dispatch-viz/` build are smoked rather than trusting
source tests.

### React rerenders raw trace data

Severity: critical.

React receives no raw dataset. Worker parsing, compact launch scopes, and
imperative canvas rendering stay outside React state.

### The conversion silently restores misleading copy

Severity: critical.

Current copy is asserted directly: unloaded traces say `Not loaded`, valid
loaded traces say `Capture complete`, and degraded captures name their actual
condition.

### The bridge becomes permanent accidental architecture

Severity: minor for this release.

Controller-to-hook migration is explicitly outside this parity release. The
bridge is isolated to one lifecycle effect and an exported idempotent destroy
contract, so a later refactor has a clear seam.
