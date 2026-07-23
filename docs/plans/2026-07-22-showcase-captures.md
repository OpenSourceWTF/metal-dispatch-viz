# Five-model showcase capture implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers-optimized:executing-plans`. GPU tasks are sequential, supervised,
> and share machine state; do not dispatch them in parallel.

**Goal:** Populate the Express app's default trace folder with authentic,
referentially complete decode windows for the five requested models.

**Architecture:** Rebuild the public MLX profiler once, run each model in its
established offline diagnostic lane with `MLX_DISPATCH_CENSUS` enabled, preserve
the raw append-only captures outside the web repo, and use a deterministic
curator to extract a bounded command-buffer window plus provenance metadata.

**Tech stack:** Public `mlx-profiler` CMake build, existing MTPLX Python
harnesses, Python 3 standard library curator/tests, JSONL, SHA-256.

**Assumptions:**

- Assumes David's “ship it” approval includes the previously proposed
  supervised GPU capture windows — it does not authorize serving changes.
- Assumes each capture is run with the exact existing model route — it excludes
  topology substitutions and comparison-driven mode changes.
- Assumes `/tmp/mtplx-gpu-exclusive.lock` and process census are both clean — a
  free flock alone is not sufficient after a reboot.
- Assumes GLM remains on `f-nocache` — buffered mode is forbidden because it has
  previously panicked this host.
- No task commits or pushes.

---

## File structure

```text
scripts/curate_trace.py             deterministic raw-to-window curator
test_curate_trace.py                Python standard-library tests
traces/showcase/traces.json         five-model display and provenance manifest
traces/showcase/*.jsonl             authentic curated windows
../bench/dispatch-census/raw/       append-only raw captures outside this repo
```

### Task 1: Implement deterministic curation with referential-integrity gates

**Files:**

- Create: `scripts/curate_trace.py`
- Create: `test_curate_trace.py`
- Create: `traces/showcase/.gitkeep`

**Security flag:** none

**Does NOT cover:** inventing missing summary fields or accepting a source with
dropped rows as valid evidence.

- [x] **Step 1: Write a failing curator test**

```py
import json
import tempfile
import unittest
from pathlib import Path
from scripts.curate_trace import curate_trace

class CurateTraceTest(unittest.TestCase):
    def test_selects_whole_command_buffers_and_referenced_ops(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "raw.jsonl"
            rows = [
                {"record":"op","seq":0,"command_buffer_index":0,"kernel":"a"},
                {"record":"cb","command_buffer_index":0,"first_op_seq":0,
                 "last_op_seq":0,"op_count":1,
                 "encode_start_ns":10,"encode_end_ns":20,"gpu_start_ns":15,"gpu_end_ns":30},
                {"record":"wait","bucket":"cb_wait_until_completed","at_ns":31,"wait_ns":4},
                {"record":"summary","complete":True,"dropped_rows":0}
            ]
            source.write_text("".join(json.dumps(row)+"\n" for row in rows))
            result = curate_trace(source, root / "out.jsonl", max_command_buffers=1)
            self.assertEqual(result["command_buffers"], 1)
            self.assertEqual(result["ops"], 1)
            self.assertEqual(result["source_sha256"], __import__("hashlib").sha256(source.read_bytes()).hexdigest())
```

- [x] **Step 2: Prove the curator test fails**

Run: `python3 -m unittest -v test_curate_trace.py`  
Expected: FAIL because `scripts.curate_trace` does not exist.

- [x] **Step 3: Implement `curate_trace` and CLI**

```py
def curate_trace(source: Path, destination: Path, *, max_command_buffers: int,
                 anchor_bucket: str = "cb_wait_until_completed",
                 allow_legacy_summary: bool = False) -> dict:
    """Write one deterministic, referentially closed command-buffer window."""
```

Parse strict JSONL; reject an incomplete summary, nonzero dropped rows,
duplicate CB indices, missing op ranges, or op references to unselected CBs.
An explicit `allow_legacy_summary=True` may accept an older summary that omits
`complete` and `dropped_rows`; its output must set `source_complete: null` and
`valid_evidence: false`, never invent a clean source gate.
Choose the final anchor wait with enough preceding CBs, include up to
`max_command_buffers` whole CBs ending at that anchor, include every referenced
op and wait whose timestamp falls inside the selected time bounds, rebase all
timestamps to zero, preserve original indices and raw fields, append a new
summary with `complete: true`, `curated_window: true`, source counts, selected
counts, and source SHA-256. Write through a sibling temporary file and rename.

CLI:

```bash
python3 scripts/curate_trace.py RAW.jsonl OUT.jsonl --max-command-buffers 64
```

- [x] **Step 4: Verify rejection and determinism**

Run: `python3 -m unittest -v test_curate_trace.py`  
Expected: PASS for public and legacy aliases, malformed input, dropped rows,
missing references, anchor selection, timestamp rebasing, and byte-identical
repeat output.

### Task 2: Rebuild the public profiler and curate the existing Qwen 35B trace

**Files:**

- Build only: `/Users/davidtai/projects/OpenSourceWTF/mlx-profiler/build/cr`
- Environment only: `/Users/davidtai/projects/OpenSourceWTF/mlx-fork/.venv-s2`
- Read: `/Users/davidtai/projects/OpenSourceWTF/bench/a3b/a3b-174-s2a-census-20260721-172229.jsonl`
- Create: `traces/showcase/qwen36-35b-a3b-k1.jsonl`
- Create: `traces/showcase/traces.json`

**Security flag:** none

**Does NOT cover:** installing profiler MLX into the production MTPLX venv or
setting `MLX_DISPATCH_CENSUS` in a LaunchAgent. It also does not re-run Qwen
35B; the existing authentic legacy source is retained with unverifiable-source
completeness rather than upgraded by assertion.

- [x] **Step 1: Verify source and the existing diagnostic interpreter**

Run:

```bash
git -C /Users/davidtai/projects/OpenSourceWTF/mlx-profiler status --short --branch
git -C /Users/davidtai/projects/OpenSourceWTF/mlx-profiler rev-parse HEAD
/Users/davidtai/projects/OpenSourceWTF/mlx-fork/.venv-s2/bin/python - <<'PY'
import numpy, safetensors, tokenizers, transformers, huggingface_hub, jinja2
print("diagnostic dependencies import")
PY
```

Expected: clean `main` at the current public profiler commit and dependencies
available in the existing diagnostics-only venv. If the source is dirty, stop
and inspect rather than overwriting it. This venv is not used by serving.

- [x] **Step 2: Configure, build, and install exactly as the profiler law requires**

Run:

```bash
cd /Users/davidtai/projects/OpenSourceWTF/mlx-profiler
DIAG_VENV=/Users/davidtai/projects/OpenSourceWTF/mlx-fork/.venv-s2
PREBUILT_METAL="$PWD/build/native-check/mlx/backend/metal/kernels/mlx.metallib"
test -f "$PREBUILT_METAL" -a -f "$PREBUILT_METAL.manifest"
"$DIAG_VENV/bin/cmake" -S . -B build/cr \
  -DMLX_BUILD_METAL=ON -DMLX_BUILD_CPU=ON -DMLX_BUILD_TESTS=ON \
  -DMLX_BUILD_PYTHON_BINDINGS=ON -DCMAKE_BUILD_TYPE=Release \
  -DPython_EXECUTABLE="$DIAG_VENV/bin/python" \
  -DMLX_PYTHON_BINDINGS_OUTPUT_DIRECTORY="$PWD/python/mlx" \
  -DCMAKE_INSTALL_PREFIX="$PWD/python/mlx" \
  -DMLX_METAL_PREBUILT_LIB="$PREBUILT_METAL" \
  -DMLX_METAL_VERSION=400
"$DIAG_VENV/bin/cmake" --build build/cr --target install -j 8
PATH="$DIAG_VENV/bin:$PATH" \
  CMAKE_ARGS="-DMLX_METAL_PREBUILT_LIB=$PREBUILT_METAL -DMLX_METAL_VERSION=400" \
  "$DIAG_VENV/bin/python" -m pip install -e "$PWD" --no-deps \
  --no-build-isolation
```

Expected: build succeeds; CMake output is authoritative over IDE diagnostics.

- [x] **Step 3: Prove import location and dark-mode behavior**

Run:

```bash
/Users/davidtai/projects/OpenSourceWTF/mlx-fork/.venv-s2/bin/python - <<'PY'
import os
import mlx.core as mx
mx.set_default_device(mx.cpu)
print(mx.__version__)
print(mx.__file__)
assert "mlx-profiler" in mx.__file__
assert "MLX_DISPATCH_CENSUS" not in os.environ
PY
```

Expected: import points inside `mlx-profiler/python/mlx`, census env is unset,
and no GPU work is created by the CPU-only probe.

- [x] **Step 4: Verify the legacy source counts and hash**

Run a streaming Python check that counts `op`, `cb`, `wait`, `summary`, asserts
exactly one summary, and records that legacy `complete`/`dropped_rows` fields are
absent; print SHA-256 and mark the source completeness unverifiable.
Expected known scale: about 320,922 ops and 10,710 CBs. Any contradiction stops
curation.

- [x] **Step 5: Curate and validate the output**

Run:

```bash
python3 scripts/curate_trace.py \
  /Users/davidtai/projects/OpenSourceWTF/bench/a3b/a3b-174-s2a-census-20260721-172229.jsonl \
  traces/showcase/qwen36-35b-a3b-k1.jsonl --max-command-buffers 64 \
  --allow-legacy-summary
python3 scripts/curate_trace.py --verify traces/showcase/qwen36-35b-a3b-k1.jsonl
```

Expected: internally complete curated window, legacy-source evidence badge, and
all selected ops referencing present CBs.

- [x] **Step 6: Add exact manifest metadata**

Add `Qwen3.6 35B`, installed checkpoint path, affine Q4 mixed-router metadata,
`MTP K1`, source filename, source SHA-256, capture date, raw row counts,
`curated-window`, and curator command. Validate with `jq empty`.

### Task 3: Capture the four missing native-mode traces sequentially

**Files:**

- Create outside repo: `/Users/davidtai/projects/OpenSourceWTF/bench/dispatch-census/raw/*.jsonl`
- Create: `traces/showcase/hy3-oq2e-mtp-k2.jsonl`
- Create: `traces/showcase/qwen36-27b-mtp-k3.jsonl`
- Create: `traces/showcase/glm52-q1t-t158-mtp-k3.jsonl`
- Create: `traces/showcase/laguna-s21-oq4e-ar.jsonl`

**Security flag:** none

**Does NOT cover:** parallel GPU runs, serving-attached instrumentation,
buffered GLM I/O, or benchmark verdicts. These are diagnostic captures only.

- [x] **Step 1: Perform the mandatory preflight before each model**

Run:

```bash
lsof /tmp/mtplx-gpu-exclusive.lock || true
ps -axo pid,rss,command | rg 'venv/bin/python.*(benchmark_|oneshot|prefill-ladder)|mtplx.server.openai' || true
launchctl print gui/501/com.tea.qwen >/dev/null && echo qwen-loaded || echo qwen-not-loaded
```

Then enter the established `run_with_qwen_stopped.py`/`gpu_lane` wrapper, verify
Qwen is actually absent after acquisition, and use `run_in_background` with a
live supervising session. If another GPU process exists, wait; never kill a
lock holder.

- [x] **Step 2: Run each established native lane with the profiler interpreter**

Use one fresh `MLX_DISPATCH_CENSUS` destination per process and the existing
model commands with short retained decode:

```text
Hy3:    benchmark_q2_mtp_depth_matrix.py --model hy3-q2 --hy3-q2-model-root
        ~/.cache/huggingface/hy3-oq2e-mlx --hy3-q2-manifest
        ~/.cache/huggingface/hy3-oq2e-mlx/expert-manifest.json --hy3-depths 2
        --contexts 1024 --output-tokens 16 --f-nocache --island-layer-count 79
        --verify-strategy batched --compiled-verify-mode off --draft-core stock

Qwen27: mtplx run --model
        ~/.mtplx/models/Youssofal--Qwen3.6-27B-MTPLX-Optimized-Speed
        --profile sustained --depth 3 --max-tokens 16 --seed 0
        --reasoning off --json

GLM:    benchmark_q2_mtp_depth_matrix.py --model glm52-q1t --glm52-depths 3
        --contexts 1024 --output-tokens 16 --memory-limit 96GiB
        --runtime-reserve 12GiB --expert-cache-limit 72GiB --cache-scope layer
        --slot-layout component-banks --transient-slots 48 --f-nocache
        --expert-integrity headers-only --split-route-release deferred
        --prefetch-slots 0 --streamed-codec none --mtp-precision q4
        --glm52-q1t-mtp-artifacts ~/.cache/huggingface/glm52-mtp-layer78-q4
        --verify-strategy batched --compiled-verify-mode off --draft-core stock

Laguna: mtplx run --model mlx-community/Laguna-S-2.1-oQ4e --no-mtp
        --profile sustained --max-tokens 16 --seed 0 --reasoning off --json
```

For each command, set `PYTHONPATH` to its proven MTPLX worktree, execute through
the isolated profiler Python rather than the stale site package, and write the
model receipt beside the raw census. Do not reuse the production interpreter.
The GLM process must be watched for free memory and terminated cleanly if free
memory approaches the established 8 GB floor.

- [x] **Step 3: Gate every raw capture before curation**

For each raw file assert: nonempty; at least one `op`, `cb`, and `summary` row;
zero or more strictly increasing cumulative checkpoints and exactly one
terminal summary; terminal `complete == true`; `dropped_rows == 0`; monotonic
usable timestamps; and profiler source metadata matching the public build. A
failed capture is retained with a `.failed` receipt but never added to the
showcase.

- [x] **Step 4: Curate and register all four traces**

Run the curator with `--max-command-buffers 64`, verify each output, and add
model/checkpoint/quantization/mode/date/source hash/row counts/curator command to
`traces/showcase/traces.json`. Label Laguna `AR K1`, Qwen27 `MTP K3`, Hy3
`MTP K2`, and GLM `MTP depth 3`; mark every file `curated-window`.

#### Completion evidence

| Trace | Raw rows | Ops | CBs | Waits | Source SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| Hy3 oQ2e MTP K2 | 182,299 | 143,627 | 18,101 | 20,560 | `00ae87a156f814773b76d4495a7747ff363dd5207b6bc441f537293197de388f` |
| Qwen3.6 27B MTP K3 | 25,510 | 17,503 | 1,228 | 6,777 | `35869a09e6616bd14bfcbde502415ecf9f54071068f752cf2b13dd8cc6dd55ac` |
| GLM-5.2 q1t/t158 MTP K3 | 459,848 | 333,284 | 66,022 | 60,531 | `5f19679cf22e337e793a8ecdcd4890cae4292f0050d3f4e4ce5c9ebafca21ac3` |
| Laguna-S 2.1 target-only AR | 52,312 | 41,991 | 3,438 | 6,881 | `da12054e8d5cf3c95d87f8c0273b65c81e6aaad687aa8020a0ecb42703db0457` |

All four current sources ended with `complete: true`, zero dropped rows, and
zero malformed rows. Captures remained diagnostics-only and the Qwen serving
LaunchAgent was restored after every guarded window.

### Task 4: Prove the five-file folder in the real Express app

**Files:**

- Modify: `traces/showcase/traces.json` only if verification finds metadata gaps.

**Security flag:** none

**Does NOT cover:** pushing the large traces or source changes.

- [x] **Step 1: Verify manifest-to-folder bijection and provenance**

Run a Python verifier that asserts exactly five `.jsonl` files, exactly five
manifest keys, every key exists, every source hash is 64 lowercase hex digits,
and labels equal the five requested names. Re-run curator verification on all
five files.

- [x] **Step 2: Load and toggle all five through the server**

Run: `npm start -- --trace-dir traces/showcase`, fetch `/api/traces`, assert five
entries, then fetch every ID and stream-parse it. In the browser, select each
toggle and confirm filename, exact mode, counts, metrics, timeline, kernel table,
and wait table update without a reload.

- [x] **Step 3: Run final combined gates**

Run:

```bash
npm test
python3 -m unittest -v test_curate_trace.py
npm audit --omit=dev
git diff --check
```

Expected: all green. Confirm `MLX_DISPATCH_CENSUS` is absent from the current
shell and the restored Qwen service answers its health endpoint after the last
guarded window.
