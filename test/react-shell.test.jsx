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
  "field-manual-button",
  "refresh-button",
  "theme-toggle",
  "trace-rail",
  "trace-selector-button",
  "trace-selector-label",
  "trace-menu",
  "trace-search",
  "trace-track",
  "selected-trace-summary",
  "provenance-strip",
  "health-strip",
  "trace-status",
  "window-control",
  "window-select",
  "metric-scope-label",
  "metric-grid",
  "timeline",
  "timeline-scroller",
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
  "analysis-table-tabs",
  "kernel-tab",
  "wait-tab",
  "kernel-panel",
  "wait-panel",
  "kernel-table-scroller",
  "kernel-scroll-hint",
  "wait-table-scroller",
  "wait-scroll-hint",
  "kernel-sort-kernel",
  "kernel-sort-count",
  "kernel-sort-setbytes-calls",
  "kernel-sort-setbytes-bytes",
  "kernel-sort-buffer-binds",
  "wait-sort-bucket",
  "wait-sort-count",
  "wait-sort-duration",
  "wait-sort-evidence",
  "utility-backdrop",
  "field-manual-drawer",
  "field-manual-close",
  "manual-search",
  "manual-search-status",
  "manual-quick-start",
  "manual-glossary-list",
  "definition-tooltip",
  "definition-tooltip-title",
  "definition-tooltip-body",
  "definition-tooltip-evidence",
  "definition-tooltip-method",
  "definition-tooltip-limitation",
  "definition-popover",
  "definition-popover-title",
  "definition-popover-body",
  "definition-popover-evidence",
  "definition-popover-method",
  "definition-popover-limitation",
  "definition-popover-close",
  "definition-popover-manual",
  "ai-export-button",
  "ai-export-drawer",
  "ai-export-close",
  "ai-export-refresh",
  "ai-export-format",
  "ai-export-scope",
  "ai-export-preview",
  "copy-export",
  "download-export",
  "ai-export-status",
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
    expect(container.textContent).toMatch(/Waiting for registry/i);
    expect(container.textContent).not.toMatch(/Evidence:\s*Pending/i);
    expect(container.querySelector("#trace-selector-button").getAttribute("aria-haspopup"))
      .toBe("listbox");
    expect(container.querySelector("#trace-menu").hidden).toBe(true);
    expect(container.querySelector("#trace-search").getAttribute("role"))
      .toBe("searchbox");
    expect(container.querySelector("#trace-track").getAttribute("role"))
      .toBe("listbox");
    expect(container.textContent).toMatch(/Drag to zoom/i);
    expect(container.textContent).toMatch(/Shift-drag to pan/i);
    expect(container.querySelector("#kernel-scroll-hint").hidden).toBe(true);
    expect(container.querySelector("#wait-scroll-hint").hidden).toBe(true);
  });

  it("renders contextual help and local export as hidden accessible utilities", async () => {
    const bootstrapController = vi.fn(async () => ({ destroy() {} }));

    await act(async () => {
      root.render(
        <ProfilerApp bootstrapController={bootstrapController} />,
      );
    });

    const manualButton = container.querySelector("#field-manual-button");
    expect(manualButton.closest(".header-actions")).not.toBeNull();
    expect(manualButton.getAttribute("aria-controls")).toBe(
      "field-manual-drawer",
    );

    const backdrop = container.querySelector("#utility-backdrop");
    expect(container.querySelectorAll("#utility-backdrop")).toHaveLength(1);
    expect(backdrop.hidden).toBe(true);

    const manualDrawer = container.querySelector("#field-manual-drawer");
    expect(manualDrawer.hidden).toBe(true);
    expect(manualDrawer.getAttribute("role")).toBe("dialog");
    expect(manualDrawer.getAttribute("aria-modal")).toBe("true");
    expect(manualDrawer.getAttribute("aria-labelledby")).toBe(
      "field-manual-heading",
    );
    expect(
      container.querySelector('label[for="manual-search"]'),
    ).not.toBeNull();
    expect(container.textContent).toMatch(/Quick start/i);
    expect(container.textContent).toMatch(/Read the timeline/i);
    expect(container.textContent).toMatch(/Evidence limits/i);
    expect(container.textContent).toMatch(/Keyboard controls/i);

    const termTriggers = [
      ...container.querySelectorAll(".term-trigger"),
    ];
    expect(termTriggers.length).toBeGreaterThanOrEqual(23);
    for (const trigger of termTriggers) {
      expect(trigger.tagName).toBe("BUTTON");
      expect(trigger.type).toBe("button");
      expect(trigger.dataset.term).toBeTruthy();
      expect(trigger.getAttribute("aria-label")).toMatch(/define/i);
      expect(trigger.getAttribute("aria-controls")).toBe(
        "definition-tooltip",
      );
    }
    for (const term of [
      "host-encode",
      "gpu-execute",
      "wait-taxonomy",
      "dispatch",
      "dispatch-density",
      "ordered-placement",
    ]) {
      expect(
        container.querySelector(`.term-trigger[data-term="${term}"]`),
      ).not.toBeNull();
    }

    const tooltip = container.querySelector("#definition-tooltip");
    expect(tooltip.hidden).toBe(true);
    expect(tooltip.getAttribute("role")).toBe("tooltip");
    expect(tooltip.querySelector("button, a, input, select, textarea")).toBeNull();

    const popover = container.querySelector("#definition-popover");
    expect(popover.hidden).toBe(true);
    expect(popover.getAttribute("role")).toBe("dialog");
    expect(popover.getAttribute("aria-modal")).toBe("false");

    const exportButton = container.querySelector("#ai-export-button");
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.closest(".timeline-actions")).not.toBeNull();
    expect(exportButton.getAttribute("aria-controls")).toBe(
      "ai-export-drawer",
    );
    const exportDrawer = container.querySelector("#ai-export-drawer");
    expect(exportDrawer.hidden).toBe(true);
    expect(exportDrawer.getAttribute("role")).toBe("dialog");
    expect(exportDrawer.getAttribute("aria-modal")).toBe("true");
    expect(container.querySelector("#ai-export-preview").readOnly).toBe(true);
    expect(container.querySelector("#ai-export-status").getAttribute("role")).toBe(
      "status",
    );
    expect(container.textContent).toMatch(/Generated locally/i);
    expect(container.textContent).toMatch(/Nothing is uploaded/i);
    expect(container.textContent).toMatch(/Prompt \+ data/i);
    expect(container.textContent).toMatch(/Structured data/i);
  });

  it("renders wide analysis tables as sortable accessible tabs", async () => {
    const bootstrapController = vi.fn(async () => ({ destroy() {} }));
    await act(async () => {
      root.render(<ProfilerApp bootstrapController={bootstrapController} />);
    });

    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    expect(container.querySelector("#kernel-panel").getAttribute("role"))
      .toBe("tabpanel");
    expect(container.querySelector("#wait-panel").hidden).toBe(true);

    const sortButtons = container.querySelectorAll(".table-sort-button");
    expect(sortButtons).toHaveLength(9);
    for (const button of sortButtons) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.type).toBe("button");
      expect(button.getAttribute("aria-label")).toMatch(/^Sort /);
    }
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
