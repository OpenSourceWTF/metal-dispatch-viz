# Submitting a profiler run

This guide covers authentic traces created by the
[OpenSourceWTF MLX
profiler](https://github.com/OpenSourceWTF/mlx-profiler/blob/main/PROFILER.md#first-census-quickstart).
The workbench does not capture a GPU itself. It reads census JSONL after a
profiled workload has run.

Use the
[new-run issue form](https://github.com/OpenSourceWTF/metal-dispatch-viz/issues/new?template=new-trace-run.yml)
for a community submission. Do not paste raw JSONL into an issue comment.

## 1. Identify the run

New trace names sort by primary Hugging Face model, contributor, and capture
date:

```text
<hf-owner>--<hf-repo>__<contributor>__<utc-date>.<artifact>.jsonl
```

Use:

- the exact public Hugging Face repository for the executed checkpoint;
- your lowercase GitHub handle as `contributor`;
- a UTC timestamp formatted as `yyyy-mm-ddThh-mm-ssZ`, with the literal
  letters lowercased in the filename;
- `raw` for an uncurated capture or `window-cb<number>` for a curated window.

The Hugging Face `/` becomes `--`. Filename identity is lowercase; exact
capitalization remains in manifest metadata.

Example:

```text
youssofal--qwen3.6-27b-mtplx-optimized-speed__davidtai__2026-07-24t18-30-15z.raw.jsonl
youssofal--qwen3.6-27b-mtplx-optimized-speed__davidtai__2026-07-24t18-30-15z.window-cb64.jsonl
```

Validate the basename before capture or submission:

```sh
npm run validate:run-name -- \
  youssofal--qwen3.6-27b-mtplx-optimized-speed__davidtai__2026-07-24t18-30-15z.raw.jsonl
```

The hosted showcase requires:

- `huggingface_repo`: exact public `owner/repository`;
- `huggingface_revision`: exact commit or immutable revision used;
- `contributor`, `capture_utc`, hardware, macOS, quantization, and execution
  mode.

A base or source repository is not an exact checkpoint. Legacy derived
captures use `huggingface_source_repo` and stay labeled as source-only. New
hosted submissions need a public primary checkpoint.

## 2. Capture with the public profiler

Build and verify the
[`OpenSourceWTF/mlx-profiler` source
checkout](https://github.com/OpenSourceWTF/mlx-profiler/blob/main/PROFILER.md#first-census-quickstart).
Do not use the official `pip install mlx` wheel for capture: it does not contain
the OpenSourceWTF instrumentation. Set `MLX_DISPATCH_CENSUS` before Python starts:

```sh
mkdir -p captures
TRACE_NAME='youssofal--qwen3.6-27b-mtplx-optimized-speed__davidtai__2026-07-24t18-30-15z.raw.jsonl'

MLX_DISPATCH_CENSUS="$PWD/captures/$TRACE_NAME" \
  python3 your_workload.py
```

The destination must be a regular file on a fast local volume. Let the process
exit cleanly so the profiler writes its terminal summary.

Important capture traps:

- The census is discovery instrumentation. Do not enable it in production
  serving or a gated performance run.
- The profiler cannot attach to an already-running process or live GPU. Start a
  new workload process with the environment variable set.
- Do not add per-token or per-dispatch engagement counters to a measured
  serving path.
- Capture the real workload shape, model, quantization, and execution lane.
  Do not transplant a label from a similar model or run.

## 3. Verify terminal evidence

Set the absolute path, inspect its final row, and verify the required evidence:

```sh
TRACE=/absolute/path/to/the-run.raw.jsonl

tail -n 1 "$TRACE" | python3 -c '
import json, sys
row = json.load(sys.stdin)
assert row.get("record") == "summary", "final row is not a summary"
assert row.get("schema_version") == 1, "unsupported schema"
assert row.get("final") is True, "missing terminal final:true summary"
assert row.get("complete") is True, "capture is incomplete"
assert row.get("dropped_rows") == 0, "capture dropped rows"
print("clean terminal summary:",
      row.get("ops_total"), "ops,",
      row.get("cbs_total"), "command buffers")
'

shasum -a 256 "$TRACE"
wc -l "$TRACE"
du -h "$TRACE"
```

If `complete` is false or `dropped_rows` is nonzero, recapture to a faster
local volume. Do not edit these fields. Authentic older captures without
completeness fields may be reviewed, but remain **legacy / unverifiable** and
do not satisfy the current new-run gate.

## 4. Curate a structurally closed window

Raw traces can be too large for source control and browser review. Clone this
repository and select whole command buffers around a decision-sync window:

```sh
git clone https://github.com/OpenSourceWTF/metal-dispatch-viz.git
cd metal-dispatch-viz
npm ci

python3 scripts/curate_trace.py \
  --max-command-buffers 64 \
  /absolute/path/to/the-run.raw.jsonl \
  youssofal--qwen3.6-27b-mtplx-optimized-speed__davidtai__2026-07-24t18-30-15z.window-cb64.jsonl

python3 scripts/curate_trace.py --verify \
  youssofal--qwen3.6-27b-mtplx-optimized-speed__davidtai__2026-07-24t18-30-15z.window-cb64.jsonl
```

For a current profiler capture, do not use `--allow-legacy-summary`. That
option exists only for authentic older captures whose source summary predates
`complete` and `dropped_rows`.

The curator records raw source SHA-256, source and selected counts, exact
bounds, the preserved source summary, and whether the raw source is valid
evidence. Never hand-trim JSONL. Row-level trimming can orphan operations,
break command-buffer closure, or make completeness claims false.

## 5. Preview locally

Place the raw or curated files in a folder and start the authoritative Express
runtime:

```sh
npm start -- --trace-dir /absolute/path/to/folder-containing-the-jsonl
```

Open `http://127.0.0.1:4173`, select the trace, and inspect its evidence badge,
launch boundaries, timeline, kernel census, and wait taxonomy.

Remember:

- command-buffer host/GPU intervals are measured;
- dispatch marks are ordered placement, not measured per-kernel timestamps;
- schema v1 has no tensor producer/consumer identity and cannot establish an
  output critical path;
- traces with different models, revisions, quantizations, modes, hardware, or
  workload shapes are not automatically comparable.

## 6. Package the submission

GitHub does not reliably accept `.jsonl` directly. ZIP the curated window and
record both hashes:

```sh
WINDOW=/absolute/path/to/the-run.window-cb64.jsonl
zip -j -9 profiler-run.zip "$WINDOW"
zipinfo -1 profiler-run.zip
shasum -a 256 "$TRACE" "$WINDOW" profiler-run.zip
```

`zipinfo` must list only the JSONL basename, with no parent directories. The
`-j` flag discards path components so the archive cannot disclose a username,
workspace name, or private directory layout.

Attach `profiler-run.zip` to the new-run issue. Retain the raw capture until
review is complete so maintainers can reproduce curation or verify its hash.

Before uploading, check that neither the JSONL nor its metadata contains model
weights, prompts, generated text, API keys, cookies, credentials, usernames,
hostnames, private filesystem paths, mounted-volume names, customer data, or
private repository URLs. If safe redaction would change profiler evidence,
stop and ask rather than modifying the capture.

## 7. Supply exact metadata

The issue form requires:

- filename and attachment;
- primary Hugging Face repository and immutable revision;
- contributor and UTC capture time;
- exact checkpoint, quantization, mode, capture phase, hardware, and macOS;
- MLX profiler and workload commits;
- exact workload command;
- terminal summary;
- raw and curated SHA-256 values;
- curator command and reviewer notes.

For a direct pull request, add corresponding manifest metadata:

```json
{
  "schema_version": 1,
  "root_label": "Showcase captures",
  "traces": {
    "owner--model__contributor__2026-07-24t18-30-15z.window-cb64.jsonl": {
      "label": "Readable run label",
      "model": "Model family",
      "checkpoint": "owner/model",
      "huggingface_repo": "owner/model",
      "huggingface_revision": "full immutable revision",
      "contributor": "github-handle",
      "capture_utc": "2026-07-24T18:30:15Z",
      "hardware": "Mac model and unified memory",
      "quantization": "exact storage and group geometry",
      "mode": "AR, MTP depth, or other exact lane",
      "capture": "exact captured phase",
      "artifact_status": "curated-window",
      "source_sha256": "64 lowercase hexadecimal characters",
      "curator_command": "exact command"
    }
  }
}
```

By submitting, you affirm that you created or are authorized to share the
capture and permit OpenSourceWTF to redistribute the accepted artifact under
this repository’s MIT license.

## Review outcome

Maintainers verify hashes, structural closure, terminal evidence, provenance,
privacy, local rendering, and the complete test/build gate. A submission may be
rejected or returned for recapture when it is synthetic, malformed, incomplete,
has dropped rows, lacks exact provenance, exposes sensitive data, points only
to a private/nonexistent model, or cannot legally be redistributed.
