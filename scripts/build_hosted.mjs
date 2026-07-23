import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TraceRegistry } from "../server/trace-registry.mjs";

const MANIFEST_NAME = "traces.json";
const MANIFEST_MAX_BYTES = 1024 * 1024;
const TRACE_EXTENSIONS = new Set([".jsonl", ".ndjson"]);

const SITES_WORKER_SOURCE = `export default {
  async fetch(request, env) {
    if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return new Response("Hosted assets are unavailable.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const url = new URL(request.url);
    const readsAsset =
      request.method === "GET" || request.method === "HEAD";
    if (
      url.pathname === "/api/traces" &&
      readsAsset
    ) {
      url.pathname = "/hosted-traces.json";
      request = new Request(url, request);
    } else if (
      url.pathname === "/" &&
      readsAsset
    ) {
      url.pathname = "/index.html";
      request = new Request(url, request);
    }
    return env.ASSETS.fetch(request);
  },
};
`;

function resolvedDirectory(value, label) {
  if (value instanceof URL) {
    return fileURLToPath(value);
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty filesystem path.`);
  }
  return path.resolve(value);
}

function containsPath(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function canonicalProspectivePath(targetPath) {
  let cursor = path.resolve(targetPath);
  const missingSegments = [];
  while (true) {
    try {
      const existing = await realpath(cursor);
      return path.join(existing, ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function canonicalOutputPath(targetPath) {
  const requestedOutput = path.resolve(targetPath);
  const outputLeaf = path.basename(requestedOutput);
  if (outputLeaf === "") {
    throw new RangeError("outputRoot must name a directory leaf.");
  }
  const outputParent = await canonicalProspectivePath(
    path.dirname(requestedOutput),
  );
  return path.join(outputParent, outputLeaf);
}

function pathsOverlap(left, right) {
  return containsPath(left, right) || containsPath(right, left);
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function safeManifestTracePath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath === "" ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    path.posix.isAbsolute(relativePath) ||
    path.posix.normalize(relativePath) !== relativePath
  ) {
    return false;
  }
  const segments = relativePath.split("/");
  return (
    segments.every(
      (segment) => segment !== "" && segment !== "." && segment !== "..",
    ) &&
    TRACE_EXTENSIONS.has(path.posix.extname(relativePath).toLowerCase())
  );
}

async function readRequiredStaticManifest(traceRoot) {
  const manifestPath = path.join(traceRoot, MANIFEST_NAME);
  let pathStats;
  try {
    pathStats = await lstat(manifestPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `Hosted publication requires ${MANIFEST_NAME}.`,
      );
    }
    throw error;
  }
  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw new Error(
      `Hosted publication requires ${MANIFEST_NAME} to be a regular non-symlink file.`,
    );
  }
  if (pathStats.size > BigInt(MANIFEST_MAX_BYTES)) {
    throw new Error(
      `Hosted publication requires ${MANIFEST_NAME} to be at most 1 MiB.`,
    );
  }

  const noFollow =
    typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  let fileHandle;
  try {
    fileHandle = await open(manifestPath, constants.O_RDONLY | noFollow);
    const handleStats = await fileHandle.stat({ bigint: true });
    if (
      !handleStats.isFile() ||
      !sameIdentity(pathStats, handleStats) ||
      (await realpath(manifestPath)) !== path.resolve(manifestPath)
    ) {
      throw new Error(
        `Hosted publication could not open ${MANIFEST_NAME} safely.`,
      );
    }
    const source = await fileHandle.readFile("utf8");
    const finalStats = await stat(manifestPath, { bigint: true });
    if (!finalStats.isFile() || !sameIdentity(handleStats, finalStats)) {
      throw new Error(
        `Hosted publication detected a changed ${MANIFEST_NAME}.`,
      );
    }

    let manifest;
    try {
      manifest = JSON.parse(source);
    } catch {
      throw new Error(
        `Hosted publication requires ${MANIFEST_NAME} to contain valid JSON.`,
      );
    }
    if (
      !plainObject(manifest) ||
      manifest.schema_version !== 1 ||
      !plainObject(manifest.traces)
    ) {
      throw new Error(
        `Hosted publication requires a schema-versioned ${MANIFEST_NAME}.`,
      );
    }
    const entries = Object.entries(manifest.traces);
    if (
      entries.some(
        ([relativePath, metadata]) =>
          !safeManifestTracePath(relativePath) || !plainObject(metadata),
      )
    ) {
      throw new Error(
        `Hosted publication requires ${MANIFEST_NAME} to contain safe relative paths and object metadata.`,
      );
    }
    return Object.freeze({
      source,
      device: handleStats.dev,
      inode: handleStats.ino,
      relativePaths: entries.map(([relativePath]) => relativePath).sort(),
    });
  } catch (error) {
    if (
      error?.message?.includes(MANIFEST_NAME) &&
      error?.message?.startsWith("Hosted publication")
    ) {
      throw error;
    }
    throw new Error(
      `Hosted publication could not open ${MANIFEST_NAME} safely.`,
      { cause: error },
    );
  } finally {
    await fileHandle?.close().catch(() => {});
  }
}

function assertManifestMatchesRegistry(manifest, registryPayload) {
  const registryPaths = registryPayload.traces
    .map(({ relativePath }) => relativePath)
    .sort();
  if (
    manifest.relativePaths.length !== registryPaths.length ||
    manifest.relativePaths.some(
      (relativePath, index) => relativePath !== registryPaths[index],
    )
  ) {
    throw new Error(
      `${MANIFEST_NAME} paths must exactly match the published trace registry.`,
    );
  }
}

function assertStableManifest(before, after) {
  if (
    before.device !== after.device ||
    before.inode !== after.inode ||
    before.source !== after.source
  ) {
    throw new Error(
      `Hosted publication detected a changed ${MANIFEST_NAME}.`,
    );
  }
}

async function assertReplaceableOutputLeaf(output) {
  let outputStats;
  try {
    outputStats = await lstat(output);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (outputStats.isSymbolicLink()) {
    throw new Error(
      "outputRoot must not be an existing symbolic link.",
    );
  }
  if (!outputStats.isDirectory()) {
    throw new Error(
      "outputRoot must be a directory when it already exists.",
    );
  }
  return true;
}

async function assertNoSymlinks(root) {
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Hosted public assets must not contain symbolic links: ${entry.name}`,
        );
      }
      if (entry.isDirectory()) {
        pending.push(candidate);
      } else if (!entry.isFile()) {
        throw new Error(
          `Hosted public assets must be regular files: ${entry.name}`,
        );
      }
    }
  }
}

async function assertMissing(targetPath, label) {
  try {
    await lstat(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} is reserved for generated hosted output.`);
}

async function readHostingConfig(hostingConfigPath) {
  const source = await readFile(
    resolvedDirectory(hostingConfigPath, "hostingConfigPath"),
    "utf8",
  );
  let config;
  try {
    config = JSON.parse(source);
  } catch (error) {
    throw new SyntaxError(
      `hostingConfigPath must contain valid JSON: ${error.message}`,
    );
  }
  if (
    config === null ||
    typeof config !== "object" ||
    Array.isArray(config) ||
    typeof config.project_id !== "string" ||
    config.project_id.trim() === ""
  ) {
    throw new TypeError(
      "hostingConfigPath must contain a non-empty project_id.",
    );
  }
  return source;
}

async function publishRegisteredTraces({
  registry,
  registryPayload,
  outputRoot,
}) {
  for (const trace of registryPayload.traces) {
    const opened = await registry.open(trace.id);
    if (!opened) {
      throw new Error(
        `Trace ${trace.id} changed before it could be published.`,
      );
    }
    const destination = path.join(
      outputRoot,
      ...trace.relativePath.split("/"),
    );
    if (!containsPath(outputRoot, destination)) {
      await opened.fileHandle.close().catch(() => {});
      throw new Error("Hosted trace path escaped its output directory.");
    }
    await mkdir(path.dirname(destination), { recursive: true });
    try {
      await pipeline(
        opened.fileHandle.createReadStream({ autoClose: false }),
        createWriteStream(destination, { flags: "wx" }),
      );
    } finally {
      await opened.fileHandle.close().catch(() => {});
    }
  }
}

export async function buildHostedSite({
  publicRoot,
  traceRoot,
  outputRoot,
  hostingConfigPath = new URL("../.openai/hosting.json", import.meta.url),
  expectedTraceCount,
  registryHooks = {},
  replacementHooks = {},
}) {
  const sourcePublic = await realpath(
    resolvedDirectory(publicRoot, "publicRoot"),
  );
  const sourceTraces = await realpath(
    resolvedDirectory(traceRoot, "traceRoot"),
  );
  const output = await canonicalOutputPath(
    resolvedDirectory(outputRoot, "outputRoot"),
  );
  await assertReplaceableOutputLeaf(output);
  if (
    pathsOverlap(output, sourcePublic) ||
    pathsOverlap(output, sourceTraces)
  ) {
    throw new RangeError(
      "outputRoot must not overlap either source directory.",
    );
  }
  const hostingConfig = await readHostingConfig(hostingConfigPath);
  if (
    expectedTraceCount !== undefined &&
    (!Number.isSafeInteger(expectedTraceCount) || expectedTraceCount < 0)
  ) {
    throw new TypeError(
      "expectedTraceCount must be a non-negative integer when provided.",
    );
  }

  const initialManifest = await readRequiredStaticManifest(sourceTraces);
  const registry = new TraceRegistry(sourceTraces, {
    hooks: registryHooks,
  });
  const registryPayload = await registry.refresh();
  const verifiedManifest = await readRequiredStaticManifest(sourceTraces);
  assertStableManifest(initialManifest, verifiedManifest);
  assertManifestMatchesRegistry(verifiedManifest, registryPayload);
  if (
    expectedTraceCount !== undefined &&
    registryPayload.traces.length !== expectedTraceCount
  ) {
    throw new Error(
      `Hosted publication requires exactly ${expectedTraceCount} traces.`,
    );
  }
  await assertNoSymlinks(sourcePublic);
  const outputParent = path.dirname(output);
  await mkdir(outputParent, { recursive: true });
  const staging = await mkdtemp(
    path.join(outputParent, ".metal-dispatch-viz-hosted-"),
  );
  let published = false;
  let backup = null;
  try {
    const clientRoot = path.join(staging, "client");
    await cp(sourcePublic, clientRoot, { recursive: true });
    await assertNoSymlinks(clientRoot);
    await assertMissing(
      path.join(clientRoot, "traces"),
      "public/traces",
    );
    await assertMissing(
      path.join(clientRoot, "hosted-traces.json"),
      "public/hosted-traces.json",
    );
    await publishRegisteredTraces({
      registry,
      registryPayload,
      outputRoot: path.join(clientRoot, "traces", "showcase"),
    });
    await writeFile(
      path.join(clientRoot, "hosted-traces.json"),
      `${JSON.stringify(registryPayload)}\n`,
    );
    await mkdir(path.join(staging, "server"), { recursive: true });
    await writeFile(
      path.join(staging, "server", "index.js"),
      SITES_WORKER_SOURCE,
    );
    await mkdir(path.join(staging, ".openai"), { recursive: true });
    await writeFile(
      path.join(staging, ".openai", "hosting.json"),
      hostingConfig,
    );
    await writeFile(
      path.join(staging, "package.json"),
      '{"type":"module"}\n',
    );
    if (await assertReplaceableOutputLeaf(output)) {
      backup = await mkdtemp(
        path.join(outputParent, ".metal-dispatch-viz-backup-"),
      );
      await rm(backup, { recursive: true, force: true });
      await rename(output, backup);
    }
    try {
      await replacementHooks.beforeFinalRename?.();
      await rename(staging, output);
    } catch (error) {
      if (backup !== null) {
        await rm(output, { recursive: true, force: true }).catch(() => {});
        await rename(backup, output);
        backup = null;
      }
      throw error;
    }
    published = true;
    if (backup !== null) {
      await rm(backup, { recursive: true, force: true });
      backup = null;
    }
    return Object.freeze({
      outputRoot: output,
      traceCount: registryPayload.traces.length,
    });
  } finally {
    if (!published) {
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function isMainModule() {
  return (
    typeof process.argv[1] === "string" &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  const result = await buildHostedSite({
    publicRoot: new URL("../.vite-client/", import.meta.url),
    traceRoot: new URL("../traces/showcase/", import.meta.url),
    outputRoot: new URL("../dist/", import.meta.url),
    expectedTraceCount: 5,
  });
  console.log(
    `Built hosted profiler with ${result.traceCount} traces in ${result.outputRoot}`,
  );
}
