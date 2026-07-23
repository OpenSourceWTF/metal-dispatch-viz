import {
  cp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
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

export async function buildHostedSite({
  publicRoot,
  traceRoot,
  outputRoot,
}) {
  const sourcePublic = resolvedDirectory(publicRoot, "publicRoot");
  const sourceTraces = resolvedDirectory(traceRoot, "traceRoot");
  const output = resolvedDirectory(outputRoot, "outputRoot");
  if (
    containsPath(output, sourcePublic) ||
    containsPath(output, sourceTraces)
  ) {
    throw new RangeError(
      "outputRoot must not contain either source directory.",
    );
  }

  const registry = await new TraceRegistry(sourceTraces).refresh();
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(sourcePublic, output, { recursive: true });
  await cp(
    sourceTraces,
    path.join(output, "traces", "showcase"),
    { recursive: true },
  );
  await writeFile(
    path.join(output, "hosted-traces.json"),
    `${JSON.stringify(registry)}\n`,
  );
  return Object.freeze({
    outputRoot: output,
    traceCount: registry.traces.length,
  });
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
