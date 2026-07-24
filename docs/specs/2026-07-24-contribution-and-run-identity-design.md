# Contribution and Run Identity Design

**Status:** Approved
**Date:** 2026-07-24

## Goal

Make the repository self-sufficient for local use and open-source
contributions, and give every new trace a compact, sortable identity tied to a
public Hugging Face model, its contributor, and its capture date.

## Scope

This change:

- documents clone, install, local trace loading, Vite development, production
  builds, tests, and Pages verification;
- adds a versioned contributor guide with separate code and trace-data paths;
- moves the complete trace-submission procedure into the repository;
- adds a GitHub issue form dedicated to new trace runs;
- defines and validates the filename contract for new runs;
- adds canonical Hugging Face repository metadata to published runs;
- renders safe Hugging Face links in the selected-run provenance;
- preserves the five existing published filenames and their stable trace IDs.

It does not:

- rename already-published traces;
- make remote HTTP requests during build or runtime to verify Hugging Face
  availability;
- accept private Hugging Face repositories for hosted publication;
- infer an exact public checkpoint for a local derived artifact;
- change profiler capture behavior or attach to live processes;
- loosen schema-v1 evidence or completeness requirements.

## Run filename contract

New raw captures and curated windows use:

```text
<hf-owner>--<hf-repo>__<contributor>__<utc-date>.<artifact>.jsonl
```

Example:

```text
youssofal--qwen3.6-27b-mtplx-optimized-speed__davidtai__2026-07-24t18-30-15z.window-cb64.jsonl
```

The lexical order is deliberately:

1. primary Hugging Face repository;
2. contributor GitHub handle;
3. UTC capture timestamp.

The Hugging Face `owner/repository` separator becomes `--` in the filename.
The filename representation is lowercase ASCII even when the canonical
repository ID contains capitals. The manifest retains the exact canonical
repository ID.

Allowed artifacts are:

- `raw`;
- `window-cb<number>`.

All name segments use ASCII letters, digits, `.` and `-`. Contributor and
repository segments cannot begin or end with punctuation, use repeated field
separators, contain paths, or contain private machine information. Filenames
are capped at 200 characters.

The five paths published before this contract are a closed grandfathered set.
Every other top-level showcase JSONL/NDJSON filename must validate. Published
filenames are immutable because trace IDs and shared URLs derive from paths.

## Manifest contract

Every new hosted trace must include:

- `huggingface_repo`: exact public `owner/repository` identifier for the
  primary executed checkpoint;
- `huggingface_revision`: exact commit or immutable revision used;
- `contributor`: submitting GitHub handle;
- `capture_utc`: RFC 3339 UTC timestamp matching the filename;
- `hardware`: exact Mac model and memory;
- existing exact checkpoint, quantization, execution mode, evidence, curation,
  and hash provenance.

`huggingface_source_repo` is reserved for legacy or derived captures whose
executed artifact is not itself public. It is visibly labeled as a source and
does not satisfy the new-run publication requirement.

`related_huggingface_repos` may list additional component repositories but does
not replace the primary repository.

The initial five showcase traces gain the strongest honest metadata available:

- Qwen3.6 27B, Qwen3.6 35B, Laguna, and Hy3 receive primary repository IDs;
- the locally-derived GLM run receives `huggingface_source_repo:
  "zai-org/GLM-5.2"` while its existing local checkpoint description remains
  unchanged;
- no unknown revision, contributor, or hardware is invented.

## Safe Hugging Face links

The browser derives links from validated repository IDs:

```text
https://huggingface.co/<encoded-owner>/<encoded-repository>
```

It never renders an arbitrary manifest URL. A primary repository appears as
`Hugging Face model`; a source-only repository appears as
`Hugging Face source`. Links open in a new tab with
`rel="noopener noreferrer"`. Invalid repository IDs remain unlinked metadata.
Run search includes primary and source repository IDs.

## Contribution paths

`CONTRIBUTING.md` is the entry point:

- code and documentation contributors fork, branch, install with `npm ci`,
  run targeted tests while iterating, and run the complete gate before a PR;
- trace contributors follow `docs/submitting-traces.md`;
- direct public-run PRs include a curated, structurally closed window and an
  exact manifest entry;
- large raw traces are attached as ZIP files to the new-run issue form and are
  never committed directly.

The guide calls out the campaign’s important traps:

- census instrumentation is discovery-only and must not run in production
  serving or gated performance measurements;
- capture starts with a new process and cannot attach to a live GPU process;
- the environment variable must be set before Python starts;
- a clean terminal summary is required and evidence fields are never edited;
- JSONL must not be hand-trimmed;
- source hashes, exact commits, hardware, mode, and workload command are
  mandatory;
- model weights, prompts, generated text, secrets, usernames, hostnames, and
  private paths must not be submitted;
- unlike quantization, mode, hardware, or workload shapes are not presented as
  directly comparable;
- the workbench’s ordered dispatch placement is not per-kernel timing and
  schema v1 cannot prove tensor critical paths.

## Error handling

- The filename validator exits nonzero with field-specific diagnostics.
- New showcase paths that do not validate fail the test suite.
- Invalid Hugging Face metadata is displayed as text, never converted into an
  unsafe link.
- Missing primary Hugging Face metadata prevents acceptance of a new hosted
  run through review policy, while legacy paths remain usable.
- Local trace folders continue to accept arbitrary JSONL/NDJSON names and
  optional manifests.

## Testing

- unit tests cover valid and invalid run filenames, timestamp normalization,
  artifacts, path rejection, and the legacy allowlist;
- registry/UI tests cover Hugging Face metadata search and safe link rendering;
- showcase tests cover honest repository metadata without changing paths;
- contract tests cover the contributor guide, trace-submission guide, issue
  form, and local commands;
- the complete `npm test`, `npm run build`, and `npm run verify:pages` gates
  run before completion.

## Failure-mode review

1. **Local derived checkpoints could be mislabeled as exact public artifacts.**
   The separate `huggingface_source_repo` field prevents that claim.
2. **Renaming old traces could break links.** Existing paths are explicitly
   grandfathered and remain immutable.
3. **A manifest could inject an arbitrary outbound URL.** The UI accepts only a
   validated repository ID and constructs the Hugging Face URL itself.
4. **Long filenames could become unusable.** Filenames contain only model,
   contributor, date, and artifact, with a 200-character cap; exact descriptive
   metadata remains in the manifest.

