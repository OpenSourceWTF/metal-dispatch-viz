import {
  cp,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TraceRegistry } from "../server/trace-registry.mjs";

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

function pathsOverlap(left, right) {
  return containsPath(left, right) || containsPath(right, left);
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
  registryHooks = {},
}) {
  const sourcePublic = await realpath(
    resolvedDirectory(publicRoot, "publicRoot"),
  );
  const sourceTraces = await realpath(
    resolvedDirectory(traceRoot, "traceRoot"),
  );
  const output = await canonicalProspectivePath(
    resolvedDirectory(outputRoot, "outputRoot"),
  );
  if (
    pathsOverlap(output, sourcePublic) ||
    pathsOverlap(output, sourceTraces)
  ) {
    throw new RangeError(
      "outputRoot must not overlap either source directory.",
    );
  }

  const registry = new TraceRegistry(sourceTraces, {
    hooks: registryHooks,
  });
  const registryPayload = await registry.refresh();
  const outputParent = path.dirname(output);
  await mkdir(outputParent, { recursive: true });
  const staging = await mkdtemp(
    path.join(outputParent, ".metal-dispatch-viz-hosted-"),
  );
  let published = false;
  try {
    await cp(sourcePublic, staging, { recursive: true });
    await publishRegisteredTraces({
      registry,
      registryPayload,
      outputRoot: path.join(staging, "traces", "showcase"),
    });
    await writeFile(
      path.join(staging, "hosted-traces.json"),
      `${JSON.stringify(registryPayload)}\n`,
    );
    await rm(output, { recursive: true, force: true });
    await rename(staging, output);
    published = true;
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
    publicRoot: new URL("../public/", import.meta.url),
    traceRoot: new URL("../traces/showcase/", import.meta.url),
    outputRoot: new URL("../dist/", import.meta.url),
  });
  console.log(
    `Built hosted profiler with ${result.traceCount} traces in ${result.outputRoot}`,
  );
}
