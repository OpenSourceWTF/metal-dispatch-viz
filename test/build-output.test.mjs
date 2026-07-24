import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function walkFiles(root, relativeRoot = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relativeRoot), {
    withFileTypes: true,
  })) {
    const relativePath = path.posix.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

test("production build emits a relocatable compiled client and bundled analysis worker", async () => {
  const viteOutput = path.join(projectRoot, ".vite-client");
  const staleSentinel = path.join(viteOutput, "stale-sentinel.txt");
  await mkdir(viteOutput, { recursive: true });
  await writeFile(staleSentinel, "must be removed");

  await execFileAsync("npm", ["run", "build"], {
    cwd: projectRoot,
    timeout: 120_000,
  });

  await assert.rejects(readFile(staleSentinel), { code: "ENOENT" });

  const clientRoot = path.join(projectRoot, "dist", "client");
  const indexHtml = await readFile(path.join(clientRoot, "index.html"), "utf8");
  const assetReferences = [
    ...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g),
  ].map((match) => match[1]);
  const emittedAssets = assetReferences.filter((reference) =>
    reference.includes("assets/"),
  );
  assert.ok(emittedAssets.length >= 2);
  assert.ok(
    emittedAssets.every((reference) => reference.startsWith("./assets/")),
  );

  for (const indexUrl of [
    "https://mlx-profiler.opensource.wtf/index.html",
    "https://opensourcewtf.github.io/metal-dispatch-viz/index.html",
  ]) {
    const indexDirectory = new URL("./", indexUrl);
    for (const reference of emittedAssets) {
      assert.equal(
        new URL(reference, indexUrl).pathname.startsWith(indexDirectory.pathname),
        true,
      );
    }
  }

  const mainReference = assetReferences.find((reference) =>
    reference.endsWith(".js"),
  );
  assert.ok(mainReference);
  const styleReference = assetReferences.find((reference) =>
    reference.endsWith(".css"),
  );
  assert.ok(styleReference);
  const styleSource = await readFile(
    path.join(clientRoot, styleReference.replace(/^\.\//, "")),
    "utf8",
  );
  assert.doesNotMatch(
    styleSource,
    /ol,ul,menu\{list-style:none/,
    "Tailwind compatibility must not reset the Field Manual list markers",
  );
  const mainSource = await readFile(
    path.join(clientRoot, mainReference.replace(/^\.\//, "")),
    "utf8",
  );
  const workerReference = mainSource.match(
    /(dataset-worker-[A-Za-z0-9_-]+\.js)/,
  )?.[1];
  assert.ok(workerReference, "client bundle must reference the emitted worker");

  const workerSource = await readFile(
    path.join(clientRoot, "assets", workerReference),
    "utf8",
  );
  assert.match(workerSource, /analyze-range/);
  assert.match(workerSource, /Unsupported worker request/);
  assert.doesNotMatch(
    workerSource,
    /(?:from\s*|import\s*)["']\.\/(?:data|trace-loader|client-dataset)\.js["']/,
  );

  const registry = JSON.parse(
    await readFile(path.join(clientRoot, "hosted-traces.json"), "utf8"),
  );
  const publishedTraceRoot = path.join(clientRoot, "traces", "showcase");
  const publishedTraces = (await walkFiles(publishedTraceRoot)).filter(
    (relativePath) => /\.(?:jsonl|ndjson)$/i.test(relativePath),
  );
  assert.equal(registry.traces.length, 5);
  assert.equal(publishedTraces.length, 5);
  assert.deepEqual(
    publishedTraces.sort(),
    registry.traces.map(({ relativePath }) => relativePath).sort(),
  );
});
