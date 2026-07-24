# LLM Range API Design

**Status:** Approved direction; written-spec review pending  
**Date:** 2026-07-23  
**Repository:** `OpenSourceWTF/metal-dispatch-viz`  
**Branch:** `fix/searchable-runs-shadcn`

## Goal

Give an LLM or command-line client a stable public URL that returns exact
profiler evidence for one trace launch and an optional time range. Omitting the
range returns the complete measured launch. A selected range returns the same
exact worker-side analysis used by the workbench, never the bounded Canvas
sample.

The canonical contract is:

```text
GET https://mlx-profiler.opensource.wtf/api/llm/v1/traces/<trace-id>
    ?window=<zero-based-launch-index>
    &from=<launch-relative-nanoseconds>
    &to=<launch-relative-nanoseconds>
    &format=json|markdown
```

`window` defaults to `0`. `from` and `to` must either both be omitted or both
be present. Omitting them selects the launch's complete measured bounds.
`format` defaults to `json`.

## Premise

The existing **Export for AI** feature solves a different problem: it packages
the browser's visible viewport after an explicit local copy or download. It
does not expose a public machine-readable range URL, and its visible event
collections may reflect deterministic render sampling.

The new API is justified because without it:

- an LLM cannot fetch a shareable evidence slice directly;
- users must manually export and paste each range;
- a consumer can accidentally confuse rendered samples with exact
  selected-range aggregates.

A narrowly routed edge endpoint plus build-generated analysis artifacts is
proportional to this gap. Replacing GitHub Pages, adding a general backend, or
accepting uploads is not.

## Scope

This round includes:

- one versioned public GET/HEAD endpoint on the canonical profiler hostname;
- exact complete-launch and selected-range analysis;
- measured CPU encode and GPU execute activity;
- exposed and hidden host interval decomposition;
- GPU busy union, GPU work, and wait aggregates;
- every recorded kernel-census row, without top-N truncation;
- JSON and Markdown representations of one semantic payload;
- a workbench action that copies the current LLM data URL;
- build-time analysis artifacts for every published showcase trace;
- a Cloudflare Worker route in front of the existing GitHub Pages origin;
- tests, build verification, deployment documentation, and rollback
  instructions.

## Non-goals

- No trace upload or SQLite ingestion.
- No authentication or private trace access.
- No arbitrary filesystem paths or origin URLs.
- No model invocation from the profiler.
- No replacement of the current local Express trace-folder workflow.
- No critical-path, tensor-dependency, or output-dependency inference.
- No per-kernel GPU duration in schema v1. Dispatch records have ordered
  placement, not measured per-dispatch start/end timestamps.
- No attempt to make unrecorded kernel names appear. Missing kernel identity is
  reported as unavailable.
- No API over uncurated files that are absent from the published trace
  manifest.

## Hosting architecture

The React application and trace assets remain on GitHub Pages. The existing
`mlx-profiler.opensource.wtf` DNS record remains proxied through Cloudflare.
A Cloudflare Worker route intercepts only:

```text
mlx-profiler.opensource.wtf/api/llm/v1/traces/*
```

Cloudflare routes are designed to run in front of an existing proxied origin.
Requests outside the route continue directly to GitHub Pages:

- [Cloudflare Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Wrangler route configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

The Worker fetches generated source artifacts from:

```text
/llm-data/v1/<trace-id>.json
```

That path is deliberately outside the Worker route and therefore resolves
against the existing GitHub Pages origin. The Worker never fetches its own API
path.

## Build-generated analysis artifacts

The hosted build parses each registered showcase JSONL using the existing
normalization and dataset analysis code. It emits one exact, versioned artifact
per opaque trace ID under `dist/client/llm-data/v1/`.

Each artifact contains:

- artifact schema and build/source revision;
- sanitized trace metadata from the public registry;
- evidence health and source-completeness state;
- exact launch windows;
- normalized command buffers and their measured encode/GPU endpoints;
- derived hidden/exposed host intervals;
- normalized dispatch records, including recorded kernel census inputs and
  ordered placement;
- normalized waits and their anchor provenance;
- exact launch summaries and omissions.

Artifacts retain the collections required to run `buildRangeScope`. They are
not client-render samples. The Pages verifier proves a bijection among the
source manifest, hosted registry, trace files, and LLM artifacts.

Artifacts do not contain local absolute paths, file descriptors, environment
values, or other unpublished server state.

## Request contract

### Path

`<trace-id>` must match the existing opaque 24-character lowercase hexadecimal
identifier. Unknown or malformed IDs return `404 TRACE_NOT_FOUND`.

### Query

- `window`: optional safe non-negative integer; default `0`.
- `from`: optional safe non-negative integer nanosecond offset from the
  selected launch start.
- `to`: optional safe positive integer nanosecond offset from the selected
  launch start.
- `format`: optional `json` or `markdown`; default `json`.

Unknown query parameters, duplicate parameters, only one range boundary,
non-integer values, `from >= to`, or bounds outside the selected launch return
`400 INVALID_RANGE_REQUEST`. The API rejects ambiguous input instead of
clamping it silently.

### Methods and headers

- `GET` returns the selected representation.
- `HEAD` returns the same status and headers without a body.
- Other methods return `405 METHOD_NOT_ALLOWED` with `Allow: GET, HEAD`.
- JSON uses `application/json; charset=utf-8`.
- Markdown uses `text/markdown; charset=utf-8`.
- Successful responses include `Access-Control-Allow-Origin: *`,
  `X-Content-Type-Options: nosniff`, an `ETag`, and a public cache policy.
- Errors use the JSON error envelope even when Markdown was requested.

## Response schema

The semantic payload is versioned as:

```text
metal-dispatch-range/v1
```

Top-level fields:

```json
{
  "schema": "metal-dispatch-range/v1",
  "self": "https://mlx-profiler.opensource.wtf/api/llm/v1/traces/...",
  "source": {},
  "selection": {},
  "evidence_health": {},
  "summary": {},
  "cpu_activity": [],
  "gpu_activity": {},
  "kernel_breakdown": {},
  "wait_breakdown": {},
  "omissions": {},
  "limitations": []
}
```

### Selection

`selection` contains:

- trace ID;
- zero-based launch index;
- absolute launch bounds;
- requested launch-relative offsets or `null`;
- effective absolute and launch-relative range bounds;
- `complete_measured_launch`, true only when the effective range equals the
  launch bounds;
- endpoint units and inclusivity.

### CPU activity

`cpu_activity` contains every command-buffer host encode interval intersecting
the effective range:

- command-buffer index;
- original measured encode endpoints;
- endpoints clipped to the selected range;
- clipped hidden-host intervals;
- clipped exposed-host intervals;
- hidden and exposed duration totals;
- endpoint provenance: `measured`;
- overlap provenance: `derived-interval-intersection`.

### GPU activity

`gpu_activity` contains:

- every intersecting command-buffer GPU interval with original and clipped
  endpoints;
- the exact union of clipped GPU intervals;
- GPU busy duration from the union;
- GPU work from raw clipped intervals, preserving overlap;
- GPU span;
- endpoint and derivation provenance.

### Kernel breakdown

`kernel_breakdown.rows` contains every kernel name recorded for dispatches
assigned to the selected range under the existing ordered-placement rule:

- kernel;
- dispatch count;
- `setBytes` call count;
- total `setBytes` bytes;
- buffer-bind count.

The response includes:

```json
{
  "membership_provenance": "ordered-placement",
  "duration_ns": null,
  "duration_availability": "unavailable-with-schema-v1"
}
```

The API never represents ordered dispatch placement as a measured timestamp and
never allocates command-buffer GPU time among kernels.

If no dispatch contains a recorded kernel name, rows are empty and
`identity_availability` is `not-recorded`; this is not treated as a zero-kernel
measurement.

### Waits, omissions, and limitations

Wait taxonomy rows retain count, duration, class, detail class, and whether the
row contributes to headline totals. Unanchored waits and unplaced dispatches
are disclosed and excluded from selected-range membership.

Limitations always state the schema-v1 dependency and per-dispatch timing
boundaries. Additional source-completeness or omission limitations are added
from evidence health.

## Markdown representation

Markdown is a deterministic rendering of the same semantic payload. It begins
with the schema, source, range, evidence status, and provenance warnings, then
shows:

1. exact summary;
2. CPU activity table;
3. GPU activity table and union;
4. complete kernel breakdown;
5. wait taxonomy;
6. omissions and limitations.

It contains no embedded instructions sourced from trace metadata. Trace strings
are treated as untrusted evidence and escaped before rendering.

## Workbench integration

The existing Export for AI drawer gains an **LLM data URL** action.

- On the initial full launch it copies the endpoint without `from`/`to`.
- When the range band is smaller than the launch, it copies exact integer
  launch-relative `from` and `to` parameters.
- It uses the current trace ID and launch index.
- It does not trigger analysis, fetch the API, upload data, or change the
  selected mode.
- The adjacent disclosure states that the URL is public and fetchable by
  anyone.

The endpoint URL is derived by a pure helper shared by tests and the UI. The
action is enabled only when the registry reports the published hosted trace
set. Local folder mode keeps the existing local AI export and explains that
unpublished traces do not have public LLM URLs; it never constructs a public
URL for a private local file.

## Cloudflare deployment

Worker source and `wrangler.jsonc` live in the repository. The configuration
uses the narrow production route and does not claim the hostname as a Worker
Custom Domain.

A dedicated deployment workflow supports an explicit `workflow_dispatch` for
the reviewed pre-merge Worker deployment. Its automatic path uses
`workflow_run` only after the repository's main-branch **Deploy profiler to
GitHub Pages** workflow succeeds. The automatic path checks out that workflow's
exact `head_sha`, then:

1. checks out the exact main commit;
2. installs locked dependencies;
3. runs the Worker and artifact contract tests;
4. builds and verifies the Pages artifact;
5. performs a pinned Wrangler dry run;
6. deploys the Worker route only after the GitHub Pages deployment succeeds;
7. probes a known complete-launch URL and one selected-range URL.

Repository configuration required before production deployment:

- secret `CLOUDFLARE_API_TOKEN`;
- secret `CLOUDFLARE_ACCOUNT_ID`.
- variable `CLOUDFLARE_WORKER_ENABLED=true`.

The repository currently has neither secret. They must be installed before the
deployment job is enabled with a repository variable. Missing credentials must
not break the existing GitHub Pages deployment; the Worker workflow remains
explicitly gated until configuration is complete.

## Error handling

- Missing or invalid artifact: `503 ANALYSIS_ARTIFACT_UNAVAILABLE`.
- Artifact schema mismatch: `503 ANALYSIS_SCHEMA_MISMATCH`.
- Trace ID absent from published artifacts: `404 TRACE_NOT_FOUND`.
- Launch absent: `404 LAUNCH_NOT_FOUND`.
- Invalid query/range: `400 INVALID_RANGE_REQUEST`.
- Exact range analysis unavailable because timing is missing:
  `422 RANGE_ANALYSIS_UNAVAILABLE`.
- Unexpected failures: `500 INTERNAL_ERROR` with no paths, stack traces, or
  origin details.

The Worker never substitutes a render sample, partial result, or raw JSONL body
for a failed exact response.

## Cache and update behavior

Artifacts and API responses are deterministic for one deployed source
revision. The response `ETag` includes the artifact revision, trace ID, launch,
effective range, format, and response schema.

The Worker may cache successful public responses. Errors that can heal after a
Pages deployment use a short cache or no cache. A Pages/Worker revision
mismatch fails closed with `503` until the matching artifact is available.

## Testing strategy

### Pure range payload tests

- omitted bounds return the complete measured launch;
- explicit bounds return exact clipped CPU/GPU activity;
- GPU busy uses interval union while GPU work preserves overlapping work;
- all selected kernel rows and census columns survive;
- kernel duration stays unavailable;
- ordered placement is labeled and unplaced dispatches are omitted/disclosed;
- waits and source-health limitations remain honest;
- JSON and Markdown represent the same selection and totals.

### Request parser and Worker tests

- GET/HEAD behavior and response headers;
- all invalid query combinations;
- malformed, unknown, and missing trace/launch states;
- artifact schema/revision failure;
- JSON/Markdown content types;
- no origin-path, stack, or metadata-instruction leakage;
- asset fetch targets only `/llm-data/v1/<validated-id>.json`;
- request aborts and origin failures terminate cleanly.

### Build and Pages tests

- exact manifest/registry/trace/artifact bijection;
- no sampled collections in LLM artifacts;
- no symlinks or unregistered artifacts;
- deterministic rebuild output;
- all five showcase traces produce valid artifacts.

### Browser tests

- copied full-launch URL omits range bounds;
- copied selected-range URL uses exact launch-relative integers;
- copying does not change selection or mode;
- disclosure accurately states public accessibility.

### Production probes

- `curl` receives JSON without executing JavaScript;
- Markdown content negotiation is explicit;
- full and selected ranges reconcile to local `buildRangeScope`;
- the ordinary React and trace-asset URLs still bypass the Worker.

## Failure-mode review

### Critical: the Worker recursively fetches itself

The route covers only `/api/llm/v1/traces/*`; artifacts live under
`/llm-data/v1/`. Tests assert the exact origin pathname. No Worker fetch targets
an API path.

### Critical: a selected response is derived from sampled Canvas data

LLM artifacts are generated directly from exact normalized datasets during the
hosted build. The artifact schema has no render-sampling field, and the Pages
verifier rejects missing or unregistered artifacts. The Worker runs the exact
range builder over those collections.

### Critical: kernel rows imply measured per-kernel duration

The schema hard-codes duration as unavailable and labels membership as ordered
placement. Tests reject a finite kernel-duration field in schema v1.

### Critical: the Worker deploys before its matching Pages artifacts

Deployment order is Pages first, Worker second, followed by production probes.
Every artifact and response carries a source revision; a mismatch returns 503
instead of serving stale or mixed evidence.

### Minor: future community traces may be too large for an edge artifact

This round publishes only the five curated showcase traces, currently under
one MiB each. Uploads and unbounded community artifacts remain a separate
design. Build-time size gates will stop publication rather than truncate.

### Minor: Cloudflare credentials are not installed yet

Implementation and dry-run verification can proceed locally. Production
deployment is gated until the two repository secrets exist. GitHub Pages
continues to deploy independently.

## Rollout and rollback

1. Install the Cloudflare repository secrets and enable the Worker deployment
   variable.
2. Deploy the narrow Worker route from the reviewed branch before merging. It
   may return a fail-closed artifact-unavailable response while the old Pages
   release is still live.
3. Land and deploy the matching Pages artifacts and copy action.
4. Let the successful Pages workflow trigger the exact-main-sha Worker
   deployment.
5. Probe full and selected ranges against local expected payloads.

Rollback removes or disables only the Worker route and copy action. The React
site, GitHub Pages deployment, raw trace assets, local Express app, and existing
AI export remain operational.
