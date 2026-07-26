# Contributing

Metal Dispatch Workbench accepts two kinds of contribution:

1. code, tests, documentation, and interface improvements;
2. authentic MLX Metal dispatch-census traces.

Keep those paths separate. A code change should not quietly replace profiler
evidence, and a trace submission should not carry unrelated application edits.

## Code and documentation contributions

### Set up a fork

Fork `OpenSourceWTF/metal-dispatch-viz`, clone your fork, and create a feature
branch. Do not work directly on `main`.

```sh
git clone https://github.com/YOUR-NAME/metal-dispatch-viz.git
cd metal-dispatch-viz
git remote add upstream https://github.com/OpenSourceWTF/metal-dispatch-viz.git
git checkout -b describe-the-change
npm ci
```

The supported Node versions and complete local-running instructions are in the
[README](README.md).

### Work in reviewable units

- Keep a pull request focused on one concern.
- Add or update tests for every behavior change. Run targeted tests while
  iterating; for example:

  ```sh
  node --test test/run-identity.test.mjs
  npx vitest run test/react-shell.test.jsx
  ```

- Preserve the application’s evidence language. Ordered dispatch placement is
  not a measured per-kernel timestamp, and schema v1 cannot establish tensor or
  output critical paths.
- Keep the Express trace server read-only. Browser-local file selection and
  drag-and-drop must use local object URLs; do not add upload endpoints,
  implicit network transfers, fallback sample data, path traversal, or symlink
  following.
- Do not commit `dist/`, dependency caches, raw profiler captures, model
  weights, secrets, tokens, credentials, private filesystem paths, prompts, or
  generated model text.
- Do not weaken completeness, manifest-to-artifact equality, or source
  provenance checks to make a fixture pass.
- Treat dependency changes as their own reviewed change. Keep the lockfile
  synchronized and explain why each new package is necessary.
- When adding shadcn components, follow the pinned and reviewed command in the
  README and inspect every generated file.

### Run the complete gate

Before opening a pull request:

```sh
npm test
npm run build
npm run verify:pages
npm audit
git diff --check
```

The pull request should explain the problem, the resulting behavior, the tests
run, and any evidence or schema limitations. Screenshots are useful for visible
interface changes, but they do not replace interaction tests.

## Trace-data contributions

Follow [Submitting a profiler run](docs/submitting-traces.md). The dedicated
[new-run issue form](https://github.com/OpenSourceWTF/metal-dispatch-viz/issues/new?template=new-trace-run.yml)
is the default path for community traces.

Raw captures can be hundreds of megabytes. Do not commit a raw trace to a pull
request. Submit a ZIP attachment containing a curator-verified, structurally
closed window and retain the raw source until review is complete.

A direct trace pull request is appropriate only when:

- the curated artifact is review-sized;
- its filename passes `npm run validate:run-name`;
- `traces/showcase/traces.json` contains exact provenance;
- the terminal summary is complete and count-exact;
- the raw and curated SHA-256 values are recorded;
- the primary executed checkpoint has a public Hugging Face repository and an
  exact revision;
- the complete repository gate passes.

Maintainers may request the original source, a new curation window, or a clean
recapture. Never hand-edit evidence rows, totals, completeness flags, or dropped
row counts to make a submission pass.

## Privacy and security

Review every trace, manifest entry, log excerpt, screenshot, and command before
publishing it. Do not disclose:

- API keys, access tokens, cookies, credentials, or private URLs;
- local usernames, hostnames, private filesystem paths, or mounted-volume
  names;
- prompts, generated text, customer data, or proprietary workload content;
- model weights or artifacts whose license does not permit redistribution.

If safe redaction would alter profiler evidence, stop and ask a maintainer
instead of editing the trace. Do not place a live secret in an issue even when
reporting a security problem.

## License

Code and documentation contributions are accepted under this repository’s MIT
license. Trace submitters must affirm that they created or are authorized to
share the capture and permit OpenSourceWTF to redistribute the submitted
artifact under the MIT license.
