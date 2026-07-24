// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAnalysisSession, ProfilerApp } from "../src/ProfilerApp.jsx";

const BOOTSTRAP_IDS = [
  "directory-identity",
  "field-manual-button",
  "refresh-button",
  "theme-toggle",
  "trace-rail",
  "trace-selector-button",
  "trace-selector-label",
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
  "field-manual-drawer",
  "field-manual-close",
  "manual-search",
  "manual-search-status",
  "manual-quick-start",
  "manual-glossary-list",
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
  let originalScrollIntoView;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    originalScrollIntoView = globalThis.Element.prototype.scrollIntoView;
    globalThis.Element.prototype.scrollIntoView = () => {};
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
    delete globalThis.ResizeObserver;
    globalThis.Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("renders every bootstrap hook exactly once with honest initial evidence copy", async () => {
    const bootstrapController = vi.fn(async () => ({ destroy() {} }));

    await act(async () => {
      root.render(<ProfilerApp bootstrapController={bootstrapController} />);
    });

    for (const id of BOOTSTRAP_IDS) {
      expect(document.querySelectorAll(`#${id}`), `#${id}`).toHaveLength(1);
    }
    expect(container.textContent).toMatch(/Waiting for registry/i);
    expect(container.textContent).not.toMatch(/Evidence:\s*Pending/i);
    expect(
      container.querySelector("#trace-selector-button").getAttribute("role"),
    ).toBe("combobox");
    expect(document.querySelector("#trace-menu")).toBeNull();
    expect(container.textContent).toMatch(/Drag to zoom/i);
    expect(container.textContent).toMatch(/Shift-drag to pan/i);
    expect(container.querySelector("#kernel-scroll-hint").hidden).toBe(true);
    expect(container.querySelector("#wait-scroll-hint").hidden).toBe(true);
  });

  it("uses a compact shadcn combobox trigger for Run instead of a full-width form control", async () => {
    const bootstrapController = vi.fn(async () => ({ destroy() {} }));

    await act(async () => {
      root.render(<ProfilerApp bootstrapController={bootstrapController} />);
    });

    const trigger = container.querySelector("#trace-selector-button");
    expect(trigger.dataset.slot).toBe("popover-trigger");
    expect(trigger.getAttribute("role")).toBe("combobox");
    expect(trigger.className).toContain("h-9");
    expect(trigger.className).toContain("max-w");
    expect(trigger.querySelector("#trace-selector-label").className).toContain(
      "truncate",
    );
  });

  it("opens the shadcn command menu, searches runs, and selects one", async () => {
    let runSelector;
    const bootstrapController = vi.fn(async (options) => {
      runSelector = options.runSelector;
      return { destroy() {} };
    });
    const onSelect = vi.fn();

    await act(async () => {
      root.render(<ProfilerApp bootstrapController={bootstrapController} />);
    });
    await act(async () => {
      runSelector.render({
        runs: [
          { id: "a", label: "GLM-5.2 1.58q", model: "GLM-5.2" },
          { id: "b", label: "Qwen 3.6 27B", model: "Qwen 3.6" },
        ],
        selectedId: "a",
        onSelect,
      });
    });

    const trigger = container.querySelector("#trace-selector-button");
    expect(trigger.disabled).toBe(false);
    expect(trigger.textContent).toContain("GLM-5.2");
    await act(async () => {
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.innerHTML).toContain("trace-menu");
    expect(
      document.querySelector('[data-slot="popover-content"]'),
    ).not.toBeNull();
    const input = document.querySelector('[data-slot="command-input"]');
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, "Qwen");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const menu = document.querySelector("#trace-menu");
    expect(menu.textContent).toContain("Qwen 3.6 27B");
    expect(menu.textContent).not.toContain("GLM-5.2 1.58q");

    const qwenItem = [
      ...document.querySelectorAll('[data-slot="command-item"]'),
    ].find((item) => item.textContent.includes("Qwen 3.6 27B"));
    await act(async () => qwenItem.click());
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(document.querySelector("#trace-menu")).toBeNull();
  });

  it("exposes React adapters for the launch selector and loading progress", async () => {
    let launchSelector;
    let progressIndicator;
    let tableTabs;
    const bootstrapController = vi.fn(async (options) => {
      launchSelector = options.launchSelector;
      progressIndicator = options.progressIndicator;
      tableTabs = options.tableTabs;
      return { destroy() {} };
    });
    const onSelect = vi.fn();

    await act(async () => {
      root.render(<ProfilerApp bootstrapController={bootstrapController} />);
    });
    await act(async () => {
      launchSelector.render({
        options: [
          { value: "0", label: "Launch 1 · 2.5 ms" },
          { value: "1", label: "Launch 2 · 4.0 ms" },
        ],
        value: "0",
        disabled: false,
        onSelect,
      });
      progressIndicator.render({
        value: 50,
        text: "50%",
      });
      tableTabs.render({ value: "wait" });
    });

    const launchTrigger = container.querySelector("#window-select");
    expect(launchTrigger.dataset.slot).toBe("select-trigger");
    expect(launchTrigger.textContent).toContain("Launch 1");
    expect(launchTrigger.disabled).toBe(false);
    expect(container.querySelector("#loading-progress").dataset.slot).toBe(
      "progress",
    );
    expect(
      container
        .querySelector("#loading-progress")
        .getAttribute("aria-valuenow"),
    ).toBe("50");
    expect(
      container.querySelector("#wait-tab").getAttribute("data-state"),
    ).toBe("active");
  });

  it("renders contextual help and local export as hidden accessible utilities", async () => {
    const bootstrapController = vi.fn(async () => ({ destroy() {} }));

    await act(async () => {
      root.render(<ProfilerApp bootstrapController={bootstrapController} />);
    });

    const manualButton = container.querySelector("#field-manual-button");
    expect(manualButton.closest(".header-actions")).not.toBeNull();
    expect(manualButton.getAttribute("aria-controls")).toBe(
      "field-manual-drawer",
    );

    expect(container.querySelector("#utility-backdrop")).toBeNull();

    const manualDrawer = document.querySelector("#field-manual-drawer");
    expect(manualDrawer.dataset.slot).toBe("sheet-content");
    expect(manualDrawer.getAttribute("data-state")).toBe("closed");
    expect(manualDrawer.getAttribute("role")).toBe("dialog");
    expect(manualDrawer.getAttribute("aria-modal")).toBe("true");
    expect(
      container.querySelector("main").getAttribute("aria-hidden"),
    ).toBeNull();
    expect(container.querySelector("main").inert).toBe(false);
    expect(manualDrawer.getAttribute("aria-labelledby")).toBe(
      "field-manual-heading",
    );
    expect(document.querySelector('label[for="manual-search"]')).not.toBeNull();
    expect(document.body.textContent).toMatch(/Quick start/i);
    expect(document.body.textContent).toMatch(/Read the timeline/i);
    expect(document.body.textContent).toMatch(/Evidence limits/i);
    expect(document.body.textContent).toMatch(/Keyboard controls/i);

    const termTriggers = [...container.querySelectorAll(".term-trigger")];
    expect(termTriggers.length).toBeGreaterThanOrEqual(23);
    for (const trigger of termTriggers) {
      expect(trigger.tagName).toBe("BUTTON");
      expect(trigger.type).toBe("button");
      expect(trigger.dataset.term).toBeTruthy();
      expect(trigger.getAttribute("aria-label")).toMatch(/define/i);
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

    await act(async () => {
      termTriggers[0].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      document.querySelector('[data-slot="popover-content"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toMatch(/Open in Field manual/i);

    const exportButton = container.querySelector("#ai-export-button");
    expect(exportButton.disabled).toBe(true);
    expect(exportButton.closest(".timeline-actions")).not.toBeNull();
    expect(exportButton.getAttribute("aria-controls")).toBe("ai-export-drawer");
    const exportDrawer = document.querySelector("#ai-export-drawer");
    expect(exportDrawer.dataset.slot).toBe("sheet-content");
    expect(exportDrawer.getAttribute("data-state")).toBe("closed");
    expect(exportDrawer.getAttribute("role")).toBe("dialog");
    expect(document.querySelector("#ai-export-preview").readOnly).toBe(true);
    expect(
      document.querySelector("#ai-export-status").getAttribute("role"),
    ).toBe("status");
    expect(document.body.textContent).toMatch(/Generated locally/i);
    expect(document.body.textContent).toMatch(/Nothing is uploaded/i);
    expect(document.body.textContent).toMatch(/Prompt \+ data/i);
    expect(document.querySelector("#ai-export-format").dataset.slot).toBe(
      "select-trigger",
    );
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
    expect(container.querySelector("#kernel-panel").getAttribute("role")).toBe(
      "tabpanel",
    );
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
      root.render(<ProfilerApp bootstrapController={bootstrapController} />);
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
      root.render(<ProfilerApp bootstrapController={bootstrapController} />);
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
