import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyPagesArtifact } from "../scripts/verify_pages_artifact.mjs";

const DEFAULT_TRACES = ["capture.jsonl", "nested/second.ndjson"];
const MAIN_CSS = "main-fixture123.css";
const MAIN_JS = "main-fixture123.js";

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value)}\n`);
}

async function writeFixture(root, tracePaths = DEFAULT_TRACES) {
  const clientRoot = path.join(root, "client");
  const showcaseRoot = path.join(clientRoot, "traces", "showcase");
  const manifestPath = path.join(root, "traces.json");
  const workerPath = path.join(
    clientRoot,
    "assets",
    "dataset-worker-fixture123.js",
  );
  const mainCssPath = path.join(clientRoot, "assets", MAIN_CSS);
  const mainJsPath = path.join(clientRoot, "assets", MAIN_JS);
  await mkdir(path.join(showcaseRoot, "nested"), { recursive: true });
  await mkdir(path.join(clientRoot, "assets"), { recursive: true });
  await writeFile(
    path.join(clientRoot, "index.html"),
    [
      "<!doctype html>",
      `<link rel="stylesheet" crossorigin href="./assets/${MAIN_CSS}">`,
      `<script type="module" crossorigin src="./assets/${MAIN_JS}"></script>`,
    ].join("\n"),
  );
  await writeFile(mainCssPath, "body {}\n");
  await writeFile(mainJsPath, "export {};\n");
  await writeFile(workerPath, "self.onmessage = () => {};\n");

  for (const relativePath of tracePaths) {
    const tracePath = path.join(showcaseRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(tracePath), { recursive: true });
    await writeFile(tracePath, '{"record":"summary"}\n');
  }

  const manifest = {
    schema_version: 1,
    root_label: "Fixture traces",
    traces: Object.fromEntries(
      tracePaths.map((relativePath) => [relativePath, {}]),
    ),
  };
  const registry = {
    schemaVersion: 1,
    rootLabel: "Fixture traces",
    traces: tracePaths.map((relativePath, index) => ({
      id: `trace-${index}`,
      relativePath,
    })),
  };
  await writeJson(manifestPath, manifest);
  await writeJson(
    path.join(clientRoot, "hosted-traces.json"),
    registry,
  );
  return {
    clientRoot,
    mainCssPath,
    mainJsPath,
    manifest,
    manifestPath,
    registry,
    showcaseRoot,
    workerPath,
  };
}

async function withFixture(t, tracePaths = DEFAULT_TRACES) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pages-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    ...(await writeFixture(root, tracePaths)),
  };
}

test("accepts a valid Pages artifact", async (t) => {
  const fixture = await withFixture(t);

  assert.deepEqual(await verifyPagesArtifact(fixture), {
    traceCount: 2,
  });
});

test("requires the source manifest to be a regular non-symlink file", async (t) => {
  const fixture = await withFixture(t);
  const actualManifest = path.join(fixture.root, "actual-traces.json");
  await rename(fixture.manifestPath, actualManifest);
  await symlink(actualManifest, fixture.manifestPath);

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /source manifest must be a regular non-symlink file/i,
  );
});

test("rejects a symlinked client root", async (t) => {
  const fixture = await withFixture(t);
  const clientAlias = path.join(fixture.root, "client-alias");
  await symlink(fixture.clientRoot, clientAlias);

  await assert.rejects(
    verifyPagesArtifact({
      clientRoot: clientAlias,
      manifestPath: fixture.manifestPath,
    }),
    /client root must be a regular non-symlink directory/i,
  );
});

test("rejects symlinked traces and showcase intermediates", async (t) => {
  await t.test("traces", async (t) => {
    const fixture = await withFixture(t);
    const tracesPath = path.join(fixture.clientRoot, "traces");
    const actualTraces = path.join(fixture.root, "actual-traces");
    await rename(tracesPath, actualTraces);
    await symlink(actualTraces, tracesPath);

    await assert.rejects(
      verifyPagesArtifact(fixture),
      /must not contain symbolic links.*traces/i,
    );
  });

  await t.test("showcase", async (t) => {
    const fixture = await withFixture(t);
    const actualShowcase = path.join(fixture.root, "actual-showcase");
    await rename(fixture.showcaseRoot, actualShowcase);
    await symlink(actualShowcase, fixture.showcaseRoot);

    await assert.rejects(
      verifyPagesArtifact(fixture),
      /must not contain symbolic links.*traces\/showcase/i,
    );
  });
});

test("rejects symlinked trace entries without following them", async (t) => {
  const fixture = await withFixture(t);
  const tracePath = path.join(fixture.showcaseRoot, "capture.jsonl");
  const actualTrace = path.join(fixture.root, "actual.jsonl");
  await rename(tracePath, actualTrace);
  await symlink(actualTrace, tracePath);

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /must not contain symbolic links.*capture\.jsonl/i,
  );
});

test("rejects a same-inode artifact rewrite during its read", async (t) => {
  const fixture = await withFixture(t);
  let rewritten = false;

  await assert.rejects(
    verifyPagesArtifact({
      ...fixture,
      hooks: {
        async afterArtifactFileOpen({ filePath, relativePath }) {
          if (relativePath === "traces/showcase/capture.jsonl") {
            rewritten = true;
            await writeFile(filePath, '{"record":"changed"}\n');
          }
        },
      },
    }),
    /traces\/showcase\/capture\.jsonl changed while it was being verified/i,
  );
  assert.equal(rewritten, true);
});

test("rejects a trace path swap after artifact enumeration", async (t) => {
  const fixture = await withFixture(t);
  const tracePath = path.join(fixture.showcaseRoot, "capture.jsonl");
  const originalPath = path.join(fixture.root, "original-capture.jsonl");
  let swapped = false;

  await assert.rejects(
    verifyPagesArtifact({
      ...fixture,
      hooks: {
        async afterArtifactEnumeration() {
          await rename(tracePath, originalPath);
          await writeFile(tracePath, '{"record":"summary"}\n');
          swapped = true;
        },
      },
    }),
    /(?:traces\/showcase\/capture\.jsonl|artifact directory traces\/showcase) changed after artifact enumeration/i,
  );
  assert.equal(swapped, true);
});

test("rejects ancestor directory symlink swaps after enumeration", async (t) => {
  for (const [name, relativeDirectory] of [
    ["assets", ["assets"]],
    ["traces/showcase", ["traces", "showcase"]],
  ]) {
    await t.test(name, async (t) => {
      const fixture = await withFixture(t);
      const directoryPath = path.join(
        fixture.clientRoot,
        ...relativeDirectory,
      );
      const renamedDirectory = path.join(
        fixture.root,
        `renamed-${relativeDirectory.join("-")}`,
      );
      let swapped = false;

      await assert.rejects(
        verifyPagesArtifact({
          ...fixture,
          hooks: {
            async afterArtifactEnumeration() {
              await rename(directoryPath, renamedDirectory);
              await symlink(renamedDirectory, directoryPath, "dir");
              swapped = true;
            },
          },
        }),
        /artifact directory (?:client root|assets|traces|traces\/showcase) (?:changed after artifact enumeration|must remain a regular non-symlink directory)/i,
      );
      assert.equal(swapped, true);
    });
  }
});

test("rejects every extra regular non-trace file under showcase", async (t) => {
  const fixture = await withFixture(t);
  await writeFile(
    path.join(fixture.showcaseRoot, "nested", "notes.txt"),
    "not publishable\n",
  );

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /showcase must contain only registered trace files.*notes\.txt/i,
  );
});

test("accepts case-insensitive jsonl and ndjson trace extensions", async (t) => {
  const fixture = await withFixture(t, [
    "capture.NDJSON",
    "nested/second.JSONL",
  ]);

  assert.deepEqual(await verifyPagesArtifact(fixture), {
    traceCount: 2,
  });
});

test("rejects Windows absolute manifest paths", async (t) => {
  const fixture = await withFixture(t);
  fixture.manifest.traces = {
    "C:/outside/capture.jsonl": {},
  };
  await writeJson(fixture.manifestPath, fixture.manifest);

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /manifest trace path must be a safe relative POSIX trace path/i,
  );
});

test("rejects unsafe POSIX manifest paths", async (t) => {
  const fixture = await withFixture(t);
  fixture.manifest.traces = {
    "../outside.jsonl": {},
  };
  await writeJson(fixture.manifestPath, fixture.manifest);

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /manifest trace path must be a safe relative POSIX trace path/i,
  );
});

test("rejects supported trace files outside traces/showcase", async (t) => {
  const fixture = await withFixture(t);
  await writeFile(
    path.join(fixture.clientRoot, "assets", "unregistered.NDJSON"),
    '{"record":"summary"}\n',
  );

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /supported trace files must only appear under traces\/showcase.*assets\/unregistered\.NDJSON/i,
  );
});

test("requires the index, registry, and bundled hashed worker", async (t) => {
  for (const [name, relativePath, pattern] of [
    ["index", "index.html", /index\.html must be a regular file/i],
    [
      "registry",
      "hosted-traces.json",
      /hosted-traces\.json must be a regular file/i,
    ],
    [
      "worker",
      "assets/dataset-worker-fixture123.js",
      /at least one bundled .*assets\/dataset-worker-\*\.js/i,
    ],
  ]) {
    await t.test(name, async (t) => {
      const fixture = await withFixture(t);
      await unlink(path.join(fixture.clientRoot, relativePath));

      await assert.rejects(
        verifyPagesArtifact(fixture),
        pattern,
      );
    });
  }
});

test("requires a Vite hash in the bundled worker filename", async (t) => {
  for (const invalidName of [
    "dataset-worker.js",
    "dataset-worker-short.js",
    "dataset-worker-abcdefgh!.js",
  ]) {
    await t.test(invalidName, async (t) => {
      const fixture = await withFixture(t);
      await rename(
        fixture.workerPath,
        path.join(fixture.clientRoot, "assets", invalidName),
      );

      await assert.rejects(
        verifyPagesArtifact(fixture),
        /bundled Vite-hashed assets\/dataset-worker-\*\.js/i,
      );
    });
  }
});

test("requires Vite-hashed filenames for index JavaScript and CSS", async (t) => {
  for (const [extension, sourcePath] of [
    ["js", "mainJsPath"],
    ["css", "mainCssPath"],
  ]) {
    await t.test(extension, async (t) => {
      const fixture = await withFixture(t);
      const invalidName = `main.${extension}`;
      await rename(
        fixture[sourcePath],
        path.join(fixture.clientRoot, "assets", invalidName),
      );
      const indexPath = path.join(fixture.clientRoot, "index.html");
      await writeFile(
        indexPath,
        (await readFile(indexPath, "utf8")).replace(
          `main-fixture123.${extension}`,
          invalidName,
        ),
      );

      await assert.rejects(
        verifyPagesArtifact(fixture),
        new RegExp(
          `index-referenced local bundle must use a Vite-hashed filename.*assets/main\\.${extension}`,
          "i",
        ),
      );
    });
  }
});

test("rejects root-relative local index bundles", async (t) => {
  const fixture = await withFixture(t);
  const indexPath = path.join(fixture.clientRoot, "index.html");
  await writeFile(
    indexPath,
    (await readFile(indexPath, "utf8")).replace(
      `./assets/${MAIN_JS}`,
      `/assets/${MAIN_JS}`,
    ),
  );

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /local bundle reference must be relative for project Pages.*\/assets\/main-fixture123\.js/i,
  );
});

test("requires the hashed module JavaScript and stylesheet boot contract", async (t) => {
  for (const [name, linePattern, errorPattern] of [
    [
      "module JavaScript",
      /<script[^>]*><\/script>\n?/,
      /index\.html must reference at least one hashed local module JavaScript bundle/i,
    ],
    [
      "stylesheet",
      /<link[^>]*>\n?/,
      /index\.html must reference at least one hashed local stylesheet bundle/i,
    ],
  ]) {
    await t.test(name, async (t) => {
      const fixture = await withFixture(t);
      const indexPath = path.join(fixture.clientRoot, "index.html");
      await writeFile(
        indexPath,
        (await readFile(indexPath, "utf8")).replace(linePattern, ""),
      );

      await assert.rejects(
        verifyPagesArtifact(fixture),
        errorPattern,
      );
    });
  }
});

test("does not count boot tags inside multiline HTML comments", async (t) => {
  const fixture = await withFixture(t);
  await writeFile(
    path.join(fixture.clientRoot, "index.html"),
    [
      "<!doctype html>",
      "<!--",
      `<link rel="stylesheet" href="./assets/${MAIN_CSS}">`,
      `<script type="module" src="./assets/${MAIN_JS}"></script>`,
      "-->",
      "<main>Profiler</main>",
    ].join("\n"),
  );

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /index\.html must reference at least one hashed local module JavaScript bundle/i,
  );
});

test("requires every local JavaScript and CSS reference from index.html", async (t) => {
  const fixture = await withFixture(t);
  const indexPath = path.join(fixture.clientRoot, "index.html");
  await writeFile(
    indexPath,
    `${await readFile(indexPath, "utf8")}\n<link href="./assets/missing-abcdefgh.css" rel="stylesheet">\n`,
  );

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /index-referenced asset assets\/missing-abcdefgh\.css must be a regular file/i,
  );
});

test("requires unquoted local JavaScript and CSS references", async (t) => {
  const fixture = await withFixture(t);
  const indexPath = path.join(fixture.clientRoot, "index.html");
  await writeFile(
    indexPath,
    `${await readFile(indexPath, "utf8")}\n<script src=./assets/missing-abcdefgh.js></script>\n`,
  );

  await assert.rejects(
    verifyPagesArtifact(fixture),
    /index-referenced asset assets\/missing-abcdefgh\.js must be a regular file/i,
  );
});

test("ignores external, data, and hash-only index references", async (t) => {
  const fixture = await withFixture(t);
  const indexPath = path.join(fixture.clientRoot, "index.html");
  await writeFile(
    indexPath,
    [
      await readFile(indexPath, "utf8"),
      '<script src="https://cdn.example/external.js"></script>',
      '<link href="data:text/css,body{}" rel="stylesheet">',
      '<a href="#local-section">Local section</a>',
    ].join("\n"),
  );

  assert.deepEqual(await verifyPagesArtifact(fixture), {
    traceCount: 2,
  });
});

test("requires exact manifest, registry, and artifact equality", async (t) => {
  await t.test("manifest and registry", async (t) => {
    const fixture = await withFixture(t);
    fixture.registry.traces.pop();
    await writeJson(
      path.join(fixture.clientRoot, "hosted-traces.json"),
      fixture.registry,
    );

    await assert.rejects(
      verifyPagesArtifact(fixture),
      /hosted registry does not exactly match the source manifest/i,
    );
  });

  await t.test("manifest and emitted artifact", async (t) => {
    const fixture = await withFixture(t);
    await unlink(
      path.join(fixture.showcaseRoot, "nested", "second.ndjson"),
    );

    await assert.rejects(
      verifyPagesArtifact(fixture),
      /emitted trace files do not exactly match the source manifest/i,
    );
  });

  await t.test("unregistered supported artifact trace", async (t) => {
    const fixture = await withFixture(t);
    await writeFile(
      path.join(fixture.showcaseRoot, "extra.jsonl"),
      '{"record":"summary"}\n',
    );

    await assert.rejects(
      verifyPagesArtifact(fixture),
      /emitted trace files do not exactly match the source manifest/i,
    );
  });
});
