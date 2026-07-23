import { buildDataset, buildRangeScope } from "./data.js";
import {
  compactDatasetForClient,
  compactScopeForClient,
} from "./client-dataset.js";
import { parseNdjsonResponse } from "./trace-loader.js";

function serializedError(error) {
  return {
    name: error instanceof Error ? error.name : "DatasetWorkerError",
    message:
      error instanceof Error ? error.message : "Dataset analysis failed.",
    status: Number.isInteger(error?.status) ? error.status : undefined,
    code: typeof error?.code === "string" ? error.code : undefined,
  };
}

let exactDataset = null;
let activeGeneration = null;

async function loadTrace(message) {
  exactDataset = null;
  activeGeneration = null;
  const response = await fetch(message.url);
  const parsed = await parseNdjsonResponse(response, {
    onProgress(progress) {
      globalThis.postMessage({
        type: "progress",
        generation: message.generation,
        progress,
      });
    },
  });
  globalThis.postMessage({
    type: "state",
    generation: message.generation,
    state: "analyzing",
  });
  const dataset = buildDataset(parsed.rows, parsed.diagnostics);
  exactDataset = dataset;
  activeGeneration = message.generation;
  globalThis.postMessage({
    type: "ready",
    generation: message.generation,
    dataset: compactDatasetForClient(exactDataset),
    diagnostics: parsed.diagnostics,
  });
}

function analyzeRange(message) {
  if (
    exactDataset === null ||
    message.generation !== activeGeneration
  ) {
    throw new Error("Exact trace session is not ready.");
  }
  const launch = exactDataset.launchWindows?.find(
    (candidate) => candidate.index === message.launchIndex,
  );
  if (!launch) {
    throw new RangeError("Selected launch does not exist.");
  }
  const range = buildRangeScope(launch, {
    startNs: message.startNs,
    endNs: message.endNs,
  });
  globalThis.postMessage({
    type: "range-result",
    generation: message.generation,
    requestId: message.requestId,
    launchIndex: message.launchIndex,
    range: range.range,
    dataset: compactScopeForClient(range),
  });
}

function buildLegacyDataset(message) {
  const rows = Array.isArray(message.rows) ? message.rows : [];
  const diagnostics =
    message.diagnostics && typeof message.diagnostics === "object"
      ? message.diagnostics
      : {};
  globalThis.postMessage({
    ok: true,
    dataset: buildDataset(rows, diagnostics),
  });
}

function requestIdentity(message) {
  const identity = {};
  for (const key of ["generation", "requestId", "launchIndex"]) {
    if (message[key] !== undefined) {
      identity[key] = message[key];
    }
  }
  return identity;
}

globalThis.addEventListener("message", async (event) => {
  const message = event?.data ?? {};
  try {
    if (message.type === "load") {
      await loadTrace(message);
      return;
    }
    if (message.type === "analyze-range") {
      analyzeRange(message);
      return;
    }
    if (message.type === undefined) {
      buildLegacyDataset(message);
      return;
    }
    throw new TypeError(
      `Unsupported worker request: ${String(message.type)}`,
    );
  } catch (error) {
    globalThis.postMessage({
      type: "complete",
      ...requestIdentity(message),
      ok: false,
      error: serializedError(error),
    });
  }
});
