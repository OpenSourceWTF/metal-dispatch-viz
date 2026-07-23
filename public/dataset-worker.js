import { buildDataset } from "./data.js";
import { compactDatasetForClient } from "./client-dataset.js";
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

globalThis.addEventListener("message", async (event) => {
  try {
    if (event?.data?.type === "load") {
      const response = await fetch(event.data.url);
      const parsed = await parseNdjsonResponse(response, {
        onProgress(progress) {
          globalThis.postMessage({ type: "progress", progress });
        },
      });
      globalThis.postMessage({ type: "state", state: "analyzing" });
      const dataset = compactDatasetForClient(
        buildDataset(parsed.rows, parsed.diagnostics),
      );
      globalThis.postMessage({
        type: "complete",
        ok: true,
        dataset,
        diagnostics: parsed.diagnostics,
      });
      return;
    }

    const rows = Array.isArray(event?.data?.rows) ? event.data.rows : [];
    const diagnostics =
      event?.data?.diagnostics &&
      typeof event.data.diagnostics === "object"
        ? event.data.diagnostics
        : {};
    globalThis.postMessage({
      ok: true,
      dataset: buildDataset(rows, diagnostics),
    });
  } catch (error) {
    globalThis.postMessage({
      type: "complete",
      ok: false,
      error: serializedError(error),
    });
  }
});
