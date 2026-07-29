import { loadTraceRegistry, traceSourceUrl } from "../../public/app.js";
import { discoverObservatoryGallery } from "./scene-model.js";

const LOCAL_TRACE_EXTENSION = /\.(?:jsonl|ndjson)$/i;
const NOOP = () => {};

function defaultCreateObjectUrl(file) {
  if (typeof globalThis.URL?.createObjectURL !== "function") {
    throw new Error("This browser cannot open local trace files.");
  }
  return globalThis.URL.createObjectURL(file);
}

function defaultRevokeObjectUrl(url) {
  globalThis.URL?.revokeObjectURL?.(url);
}

export async function loadObservatoryRegistry({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  baseUrl,
} = {}) {
  const loaded = await loadTraceRegistry(fetchImpl, { baseUrl });
  return Object.freeze({
    ...loaded,
    gallery: Object.freeze(discoverObservatoryGallery(loaded.registry)),
  });
}

export function createGalleryTraceSource({ trace, hosted = false, baseUrl } = {}) {
  return Object.freeze({
    kind: "gallery",
    trace,
    url: traceSourceUrl(trace, { hosted, baseUrl }),
    release: NOOP,
  });
}

export function createLocalTraceSource(
  file,
  {
    createObjectURL = defaultCreateObjectUrl,
    revokeObjectURL = defaultRevokeObjectUrl,
  } = {},
) {
  if (
    file === null ||
    typeof file !== "object" ||
    typeof file.name !== "string" ||
    file.name.trim() === ""
  ) {
    throw new TypeError("Select a profiler .jsonl or .ndjson file.");
  }
  if (!LOCAL_TRACE_EXTENSION.test(file.name)) {
    throw new TypeError("Local traces must use a .jsonl or .ndjson extension.");
  }
  if (typeof createObjectURL !== "function" || typeof revokeObjectURL !== "function") {
    throw new TypeError("Local trace URL handlers must be functions.");
  }

  const url = createObjectURL(file);
  if (typeof url !== "string" || !url.startsWith("blob:")) {
    throw new Error("The browser did not create a safe local trace URL.");
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    revokeObjectURL(url);
  };
  const label = file.name.trim();
  const trace = Object.freeze({
    id: `local:${encodeURIComponent(label)}:${file.lastModified ?? 0}:${file.size ?? 0}`,
    name: label,
    label,
    size: Number.isFinite(file.size) ? file.size : null,
    modifiedTime: Number.isFinite(file.lastModified)
      ? new Date(file.lastModified).toISOString()
      : null,
    sourceKind: "local-file",
    sourceUrl: url,
    source_evidence_status: "browser-local",
  });

  return Object.freeze({
    kind: "local",
    trace,
    url,
    release,
  });
}
