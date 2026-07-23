// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAnalysisSession,
  ProfilerApp,
} from "../src/ProfilerApp.jsx";

const BOOTSTRAP_IDS = [
  "directory-identity",
  "refresh-button",
  "theme-toggle",
  "trace-rail",
  "trace-track",
  "provenance-strip",
  "health-strip",
  "trace-status",
  "window-control",
  "window-select",
  "metric-scope-label",
  "metric-grid",
  "timeline",
  "plot-frame",
  "timeline-placeholder",
  "timeline-sampling-note",
  "loading-state",
  "loading-filename",
  "loading-progress",
  "loading-readout",
  "empty-state",
  "error-state",
  "inspector-body",
  "clear-selection",
  "kernel-table-body",
  "kernel-table-state",
  "wait-table-body",
  "wait-table-state",
  "timeline-scale",
  "zoom-out",
  "fit-timeline",
  "zoom-in",
  "range-navigator",
  "range-overview",
  "range-overview-summary",
  "range-band",
  "range-start-handle",
  "range-end-handle",
  "range-mode-view",
  "range-mode-analyze",
  "range-start-readout",
  "range-end-readout",
  "range-duration-readout",
  "range-status",
  "range-omissions",
  "analysis-tables",
];

describe("ProfilerApp shell", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
    }
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders every bootstrap hook exactly once with honest initial evidence copy", async () => {
    const bootstrapController = vi.fn(async () => ({ destroy() {} }));

    await act(async () => {
      root.render(
        <ProfilerApp bootstrapController={bootstrapController} />,
      );
    });

    for (const id of BOOTSTRAP_IDS) {
      expect(
        container.querySelectorAll(`#${id}`),
        `#${id}`,
      ).toHaveLength(1);
    }
    expect(container.textContent).toMatch(/Not loaded/i);
    expect(container.textContent).not.toMatch(/Evidence:\s*Pending/i);
  });

  it("starts the injected controller after mount and destroys it once on unmount", async () => {
    const destroy = vi.fn();
    const bootstrapController = vi.fn(async ({ signal }) => {
      expect(container.querySelector("#timeline")).not.toBeNull();
      signal.addEventListener("abort", destroy, { once: true });
      return { destroy };
    });

    await act(async () => {
      root.render(
        <ProfilerApp bootstrapController={bootstrapController} />,
      );
    });

    expect(bootstrapController).toHaveBeenCalledTimes(1);
    expect(destroy).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    root = null;

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("does not destroy an abort-aware pending bootstrap twice after late resolution", async () => {
    const destroy = vi.fn();
    let resolveBootstrap;
    const bootstrapController = vi.fn(({ signal }) => {
      signal.addEventListener("abort", destroy, { once: true });
      return new Promise((resolve) => {
        resolveBootstrap = resolve;
      });
    });

    await act(async () => {
      root.render(
        <ProfilerApp bootstrapController={bootstrapController} />,
      );
    });
    await act(async () => root.unmount());
    root = null;

    expect(destroy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveBootstrap({ destroy });
      await Promise.resolve();
    });

    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("injects an absolute Vite worker URL at root and project bases", () => {
    class WorkerDouble {
      constructor(url, options) {
        this.url = url;
        this.options = options;
      }

      addEventListener() {}
      removeEventListener() {}
      terminate() {}
    }

    for (const baseUrl of [
      "https://mlx-profiler.opensource.wtf/",
      "https://opensourcewtf.github.io/metal-dispatch-viz/",
    ]) {
      const base = document.createElement("base");
      base.href = baseUrl;
      document.head.append(base);
      const session = createAnalysisSession({
        WorkerClass: WorkerDouble,
        generation: 0,
      });
      const workerUrl = new URL(session.worker.url);
      const expectedBase = new URL(baseUrl);

      expect(workerUrl.origin).toBe(expectedBase.origin);
      expect(workerUrl.pathname).toMatch(/dataset-worker(?:-[^/]+)?\.js$/);
      expect(workerUrl.pathname.startsWith(expectedBase.pathname)).toBe(true);
      expect(session.worker.options).toEqual({
        type: "module",
        name: "metal-dispatch-analysis",
      });
      session.terminate();
      base.remove();
    }
  });
});
