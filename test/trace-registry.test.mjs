import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TraceRegistry,
  discoverTraceFiles,
  isContained,
  readManifest,
  stableTraceId,
} from "../server/trace-registry.mjs";

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function within(milliseconds, promise) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("timed out waiting for test hook")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

test("discovers nested trace extensions and merges path-keyed display metadata", async (t) => {
  const root = await temporaryDirectory(t, "mdv-registry-");
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, "alpha.JSONL"), '{"record":"summary"}\n');
  await writeFile(path.join(root, "nested", "beta.ndjson"), "{}\n");
  await writeFile(path.join(root, "nested", "ignored.json"), "{}\n");
  await writeFile(
    path.join(root, "traces.json"),
    JSON.stringify({
      schema_version: 1,
      root_label: "Decode captures",
      traces: {
        "nested/beta.ndjson": {
          label: "Hy3 2-bit",
          mode: "MTP K3",
          id: "manifest-cannot-replace-id",
          relativePath: "../../outside.jsonl",
          realPath: "/private/outside.jsonl",
        },
      },
    }),
  );

  const registry = new TraceRegistry(root);
  const payload = await registry.refresh();

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.rootLabel, "Decode captures");
  assert.deepEqual(
    payload.traces.map(({ relativePath }) => relativePath),
    ["alpha.JSONL", "nested/beta.ndjson"],
  );
  assert.equal(payload.warnings.length, 0);

  const alpha = payload.traces[0];
  assert.equal(alpha.name, "alpha.JSONL");
  assert.equal(alpha.extension, ".jsonl");
  assert.equal(alpha.size, Buffer.byteLength('{"record":"summary"}\n'));
  assert.match(alpha.modifiedTime, /^\d{4}-\d\d-\d\dT/);

  const beta = payload.traces[1];
  assert.equal(beta.label, "Hy3 2-bit");
  assert.equal(beta.mode, "MTP K3");
  assert.equal(beta.relativePath, "nested/beta.ndjson");
  assert.match(beta.id, /^[a-f0-9]{24}$/);
  assert.equal("realPath" in beta, false);

  const privateEntry = registry.get(beta.id);
  assert.equal(
    privateEntry.realPath,
    await realpath(path.join(root, "nested", "beta.ndjson")),
  );
});

test("ignores dotfiles, dot-directories, and every symlink without following them", async (t) => {
  const root = await temporaryDirectory(t, "mdv-links-");
  const outside = await temporaryDirectory(t, "mdv-outside-");

  await mkdir(path.join(root, ".hidden"));
  await mkdir(path.join(root, "visible"));
  await writeFile(path.join(root, ".secret.jsonl"), "{}\n");
  await writeFile(path.join(root, ".hidden", "trace.jsonl"), "{}\n");
  await writeFile(path.join(root, "visible", ".nested.ndjson"), "{}\n");
  await writeFile(path.join(root, "visible", "real.jsonl"), "{}\n");
  await writeFile(path.join(outside, "secret.jsonl"), "{}\n");

  await symlink(
    path.join(outside, "secret.jsonl"),
    path.join(root, "escape.ndjson"),
  );
  await symlink(
    path.join(root, "visible", "real.jsonl"),
    path.join(root, "alias.jsonl"),
  );
  await symlink(outside, path.join(root, "linked-directory"));

  const traces = await discoverTraceFiles(root);
  assert.deepEqual(
    traces.map(({ relativePath }) => relativePath),
    ["visible/real.jsonl"],
  );
});

test("stable IDs are deterministic and do not expose filesystem paths", async (t) => {
  const root = await temporaryDirectory(t, "mdv-stable-");
  const relativePath = "nested/model.jsonl";
  await mkdir(path.join(root, "nested"));
  await writeFile(path.join(root, relativePath), "{}\n");

  const first = await new TraceRegistry(root).refresh();
  const second = await new TraceRegistry(root).refresh();
  const id = first.traces[0].id;

  assert.equal(id, second.traces[0].id);
  assert.equal(id, stableTraceId(relativePath));
  assert.match(id, /^[a-f0-9]{24}$/);
  assert.equal(id.includes("model"), false);
  assert.equal(id.includes(root), false);
});

test("missing and malformed manifests leave discovery usable", async (t) => {
  const missingRoot = await temporaryDirectory(t, "mdv-no-manifest-");
  await writeFile(path.join(missingRoot, "trace.jsonl"), "{}\n");

  const missing = await readManifest(missingRoot);
  assert.deepEqual(missing, {
    rootLabel: undefined,
    traces: {},
    warnings: [],
  });
  assert.equal((await new TraceRegistry(missingRoot).refresh()).warnings.length, 0);

  const malformedRoot = await temporaryDirectory(t, "mdv-bad-manifest-");
  await writeFile(path.join(malformedRoot, "trace.jsonl"), "{}\n");
  await writeFile(path.join(malformedRoot, "traces.json"), "{not json");

  const malformed = await new TraceRegistry(malformedRoot).refresh();
  assert.equal(malformed.traces.length, 1);
  assert.equal(malformed.traces[0].label, undefined);
  assert.equal(malformed.warnings.length, 1);
  assert.match(malformed.warnings[0], /traces\.json/i);
});

test("manifest reads stay on the no-follow descriptor during a pathname swap", async (t) => {
  const root = await temporaryDirectory(t, "mdv-manifest-race-");
  const outside = await temporaryDirectory(t, "mdv-manifest-race-outside-");
  const manifestPath = path.join(root, "traces.json");
  const outsideManifestPath = path.join(outside, "outside.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      traces: { "trace.jsonl": { label: "Original metadata" } },
    }),
  );
  await writeFile(
    outsideManifestPath,
    JSON.stringify({
      schema_version: 1,
      traces: { "trace.jsonl": { label: "Outside metadata" } },
    }),
  );

  let swapped = false;
  let manifestHandle;
  const manifest = await readManifest(root, {
    hooks: {
      async afterManifestOpen({ fileHandle }) {
        manifestHandle = fileHandle;
        await rename(manifestPath, path.join(root, "original-traces.json"));
        await symlink(outsideManifestPath, manifestPath);
        swapped = true;
      },
    },
  });

  assert.equal(swapped, true);
  assert.equal(manifest.traces["trace.jsonl"].label, "Original metadata");
  assert.notEqual(manifest.traces["trace.jsonl"].label, "Outside metadata");
  await assert.rejects(
    manifestHandle.stat(),
    (error) => error?.code === "EBADF",
  );

  const rejectedOutsideManifest = await readManifest(root);
  assert.equal(rejectedOutsideManifest.traces["trace.jsonl"], undefined);
  assert.equal(rejectedOutsideManifest.warnings.length, 1);
});

test("manifests without supported schema_version do not merge metadata", async (t) => {
  const root = await temporaryDirectory(t, "mdv-manifest-version-");
  await writeFile(path.join(root, "trace.jsonl"), "{}\n");
  const registry = new TraceRegistry(root);

  for (const manifest of [
    {
      traces: { "trace.jsonl": { label: "Missing schema" } },
    },
    {
      schema_version: 2,
      traces: { "trace.jsonl": { label: "Future schema" } },
    },
  ]) {
    await writeFile(
      path.join(root, "traces.json"),
      JSON.stringify(manifest),
    );

    const payload = await registry.refresh();
    assert.equal(payload.traces.length, 1);
    assert.equal(payload.traces[0].label, undefined);
    assert.equal(payload.warnings.length, 1);
    assert.match(payload.warnings[0], /schema_version.*1/i);
  }
});

test("oversized manifests warn without allocating or merging metadata", async (t) => {
  const root = await temporaryDirectory(t, "mdv-manifest-large-");
  await writeFile(path.join(root, "trace.jsonl"), "{}\n");
  await writeFile(
    path.join(root, "traces.json"),
    JSON.stringify({
      schema_version: 1,
      traces: {
        "trace.jsonl": { label: "x".repeat(1024 * 1024) },
      },
    }),
  );

  const payload = await new TraceRegistry(root).refresh();
  assert.equal(payload.traces[0].label, undefined);
  assert.equal(payload.warnings.length, 1);
  assert.match(payload.warnings[0], /traces\.json.*1 MiB/i);
  assert.equal(payload.warnings[0].includes(root), false);
});

test("manifest lookup accepts only own path keys", async (t) => {
  const root = await temporaryDirectory(t, "mdv-manifest-own-");
  const relativePath = "trace.jsonl";
  await writeFile(path.join(root, relativePath), "{}\n");
  await writeFile(
    path.join(root, "traces.json"),
    JSON.stringify({ schema_version: 1, traces: {} }),
  );

  Object.defineProperty(Object.prototype, relativePath, {
    configurable: true,
    value: { label: "Inherited metadata" },
  });
  try {
    const payload = await new TraceRegistry(root).refresh();
    assert.equal(payload.traces[0].label, undefined);
  } finally {
    delete Object.prototype[relativePath];
  }
});

test("empty folders stay empty and refresh discovers later files", async (t) => {
  const root = await temporaryDirectory(t, "mdv-empty-");
  const registry = new TraceRegistry(root);

  assert.deepEqual((await registry.refresh()).traces, []);
  assert.equal(registry.get("unknown"), undefined);
  assert.equal(await registry.open("unknown"), undefined);

  await writeFile(path.join(root, "later.ndjson"), "{}\n");
  assert.equal((await registry.refresh()).traces.length, 1);
});

test("an older overlapping refresh cannot overwrite the newest registry generation", async (t) => {
  const root = await temporaryDirectory(t, "mdv-refresh-generation-");
  const oldPath = path.join(root, "old.jsonl");
  await writeFile(oldPath, '{"generation":"old"}\n');

  let commitCount = 0;
  let announceFirstCommit;
  let releaseFirstCommit;
  const firstAtCommit = new Promise((resolve) => {
    announceFirstCommit = resolve;
  });
  const firstMayCommit = new Promise((resolve) => {
    releaseFirstCommit = resolve;
  });
  const registry = new TraceRegistry(root, {
    hooks: {
      async beforeRefreshCommit() {
        commitCount += 1;
        if (commitCount === 1) {
          announceFirstCommit();
          await firstMayCommit;
        }
      },
    },
  });

  const olderRefresh = registry.refresh();
  await within(250, firstAtCommit);

  await rm(oldPath);
  await writeFile(
    path.join(root, "new.jsonl"),
    '{"generation":"new"}\n',
  );
  const newerPayload = await registry.refresh();
  releaseFirstCommit();
  const olderPayload = await olderRefresh;

  assert.deepEqual(
    olderPayload.traces.map(({ relativePath }) => relativePath),
    ["old.jsonl"],
  );
  assert.deepEqual(
    newerPayload.traces.map(({ relativePath }) => relativePath),
    ["new.jsonl"],
  );
  assert.equal(registry.get(olderPayload.traces[0].id), undefined);
  assert.equal(
    registry.get(newerPayload.traces[0].id)?.relativePath,
    "new.jsonl",
  );
});

test("a failed newer refresh does not suppress an older successful commit", async (t) => {
  const root = await temporaryDirectory(t, "mdv-refresh-failure-");
  await writeFile(path.join(root, "trace.jsonl"), "{}\n");

  let rootVisitCount = 0;
  let announceOlderCommit;
  let releaseOlderCommit;
  const olderAtCommit = new Promise((resolve) => {
    announceOlderCommit = resolve;
  });
  const olderMayCommit = new Promise((resolve) => {
    releaseOlderCommit = resolve;
  });
  const registry = new TraceRegistry(root, {
    hooks: {
      beforeDirectory(relativePath) {
        if (relativePath === "") {
          rootVisitCount += 1;
          if (rootVisitCount === 2) {
            throw new Error("forced newer refresh failure");
          }
        }
      },
      async beforeRefreshCommit({ generation }) {
        if (generation === 1) {
          announceOlderCommit();
          await olderMayCommit;
        }
      },
    },
  });

  const olderRefresh = registry.refresh();
  await within(250, olderAtCommit);

  try {
    await assert.rejects(
      registry.refresh(),
      (error) => error?.code === "TRACE_ROOT_UNAVAILABLE",
    );
  } finally {
    releaseOlderCommit();
  }

  const olderPayload = await olderRefresh;
  assert.equal(olderPayload.traces.length, 1);
  assert.equal(
    registry.get(olderPayload.traces[0].id)?.relativePath,
    "trace.jsonl",
  );
});

test("secure open rejects a pre-open swap and retains the original descriptor after return", async (t) => {
  const root = await temporaryDirectory(t, "mdv-open-");
  const outside = await temporaryDirectory(t, "mdv-open-outside-");
  const tracePath = path.join(root, "trace.jsonl");
  const outsidePath = path.join(outside, "secret.jsonl");
  await writeFile(tracePath, '{"source":"original"}\n');
  await writeFile(outsidePath, '{"secret":true}\n');

  const registry = new TraceRegistry(root);
  const { traces } = await registry.refresh();
  const opened = await registry.open(traces[0].id);
  assert.ok(opened?.fileHandle);
  assert.equal(opened.trace.id, traces[0].id);
  assert.equal("realPath" in opened.trace, false);

  await rename(tracePath, path.join(root, "original.jsonl"));
  await symlink(outsidePath, tracePath);

  try {
    assert.equal(
      await opened.fileHandle.readFile("utf8"),
      '{"source":"original"}\n',
    );
  } finally {
    await opened.fileHandle.close();
  }

  assert.equal(await registry.open(traces[0].id), undefined);
  await rm(tracePath);
  await writeFile(tracePath, '{"source":"replacement"}\n');
  assert.equal(await registry.open(traces[0].id), undefined);
  assert.equal(await registry.open("not-a-registry-id"), undefined);
});

test("secure open closes its descriptor on validation failure", async (t) => {
  const root = await temporaryDirectory(t, "mdv-open-close-");
  await writeFile(path.join(root, "trace.jsonl"), "{}\n");
  let capturedHandle;
  const registry = new TraceRegistry(root, {
    hooks: {
      afterTraceOpen({ fileHandle }) {
        capturedHandle = fileHandle;
        throw new Error("forced validation failure /private/secret");
      },
    },
  });
  const { traces } = await registry.refresh();

  assert.equal(await registry.open(traces[0].id), undefined);
  assert.ok(capturedHandle);
  await assert.rejects(
    capturedHandle.stat(),
    (error) => error?.code === "EBADF",
  );
});

test("an inaccessible nested subtree is skipped with a sanitized warning", async (t) => {
  const root = await temporaryDirectory(t, "mdv-subtree-");
  await mkdir(path.join(root, "blocked"));
  await mkdir(path.join(root, "visible"));
  await writeFile(path.join(root, "blocked", "hidden.jsonl"), "{}\n");
  await writeFile(path.join(root, "visible", "trace.jsonl"), "{}\n");
  const secret = "/private/operator/secret";
  const registry = new TraceRegistry(root, {
    hooks: {
      beforeDirectory(relativePath) {
        if (relativePath === "blocked") {
          throw new Error(`EACCES: ${secret}`);
        }
      },
    },
  });

  const payload = await registry.refresh();
  assert.deepEqual(
    payload.traces.map(({ relativePath }) => relativePath),
    ["visible/trace.jsonl"],
  );
  assert.equal(payload.warnings.length, 1);
  assert.match(payload.warnings[0], /subdirectory/i);
  assert.equal(payload.warnings[0].includes(root), false);
  assert.equal(payload.warnings[0].includes(secret), false);
  assert.equal(payload.warnings[0].includes("EACCES"), false);
});

test("manifest filesystem failures return sanitized warnings", async (t) => {
  const root = await temporaryDirectory(t, "mdv-manifest-error-");
  await writeFile(
    path.join(root, "traces.json"),
    JSON.stringify({ schema_version: 1, traces: {} }),
  );
  const secret = "/private/operator/manifest";

  const manifest = await readManifest(root, {
    hooks: {
      beforeManifestOpen() {
        throw new Error(`EACCES: ${secret}`);
      },
    },
  });

  assert.equal(manifest.warnings.length, 1);
  assert.match(manifest.warnings[0], /traces\.json/i);
  assert.equal(manifest.warnings[0].includes(root), false);
  assert.equal(manifest.warnings[0].includes(secret), false);
  assert.equal(manifest.warnings[0].includes("EACCES"), false);
});

test("unavailable or non-directory roots reject with a stable error code", async (t) => {
  const parent = await temporaryDirectory(t, "mdv-unavailable-");
  const missing = path.join(parent, "missing");
  const file = path.join(parent, "file");
  await writeFile(file, "not a directory");

  for (const root of [missing, file]) {
    await assert.rejects(
      new TraceRegistry(root).refresh(),
      (error) =>
        error?.code === "TRACE_ROOT_UNAVAILABLE" &&
        /trace root/i.test(error.message) &&
        !error.message.includes(parent) &&
        error.cause === undefined,
    );
  }
});

test("containment rejects siblings with a shared string prefix", () => {
  const root = path.resolve("/tmp/trace-root");
  assert.equal(isContained(root, path.join(root, "nested", "trace.jsonl")), true);
  assert.equal(isContained(root, root), true);
  assert.equal(isContained(root, `${root}-outside/trace.jsonl`), false);
  assert.equal(isContained(root, path.dirname(root)), false);
});
