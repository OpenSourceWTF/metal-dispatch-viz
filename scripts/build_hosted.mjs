import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  readFile,
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

const SITES_WORKER_SOURCE = `export default {
  async fetch(request, env) {
    if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
      return new Response("Hosted assets are unavailable.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    const url = new URL(request.url);
    if (
      url.pathname === "/" &&
      (request.method === "GET" || request.method === "HEAD")
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

function pathsOverlap(left, right) {
  return containsPath(left, right) || containsPath(right, left);
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

async function pathExists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
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
  registryHooks = {},
  replacementHooks = {},
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
  const hostingConfig = await readHostingConfig(hostingConfigPath);

  const registry = new TraceRegistry(sourceTraces, {
    hooks: registryHooks,
  });
  const registryPayload = await registry.refresh();
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
    if (await pathExists(output)) {
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
    publicRoot: new URL("../public/", import.meta.url),
    traceRoot: new URL("../traces/showcase/", import.meta.url),
    outputRoot: new URL("../dist/", import.meta.url),
  });
  console.log(
    `Built hosted profiler with ${result.traceCount} traces in ${result.outputRoot}`,
  );
}
