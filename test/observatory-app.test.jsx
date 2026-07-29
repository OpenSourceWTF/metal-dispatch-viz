// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAppMode } from "../src/main.jsx";
import { ObservatoryApp } from "../src/observatory/ObservatoryApp.jsx";

const QWEN_27 = {
  id: "q27",
  label: "Qwen3.6 27B",
  model: "Qwen3.6 27B",
  mode: "MTP K3",
  quantization: "affine Q4 group 64",
  relativePath: "q27.jsonl",
  source_evidence_status: "verified-complete",
};
const QWEN_35 = {
  id: "q35",
  label: "Qwen3.6 35B",
  model: "Qwen3.6 35B-A3B",
  mode: "MTP K1",
  quantization: "affine Q4 group 64; router gates Q8",
  relativePath: "q35.jsonl",
  source_evidence_status: "legacy-unverifiable",
};

function dataset(kernel = "steel_gemm_fused_q4") {
  return {
    launchWindows: [
      {
        startNs: 0,
        endNs: 100,
        dispatches: [
          {
            seq: 0,
            atNs: 20,
            kernel,
            grid: [64, 1, 1],
            bufferBinds: 4,
          },
          {
            seq: 1,
            atNs: 80,
            kernel: "rms_norm",
            grid: [16, 1, 1],
            bufferBinds: 2,
          },
        ],
        commandBuffers: [
          {
            commandBufferIndex: 0,
            gpuStartNs: 10,
            gpuEndNs: 90,
          },
        ],
      },
    ],
    health: { validEvidence: true },
  };
}

function registryResult(gallery = [QWEN_27, QWEN_35]) {
  return {
    hosted: true,
    registry: { traces: gallery },
    gallery,
  };
}

function sessionFactory({ loadImpl = async () => ({ dataset: dataset() }) } = {}) {
  const sessions = [];
  const factory = vi.fn((options) => {
    const session = {
      load: vi.fn(async (url) => {
        options.onProgress?.({
          sourceBytes: 512,
          totalBytes: 1024,
          parsedRows: 4,
          done: false,
        });
        return loadImpl(url);
      }),
      terminate: vi.fn(),
    };
    sessions.push(session);
    return session;
  });
  return { factory, sessions };
}

function SceneStub({
  model,
  frameIndex,
  reducedMotion,
  animated,
  onCanvasReady,
}) {
  return (
    <canvas
      ref={onCanvasReady}
      data-testid="scene"
      data-label={model?.label ?? ""}
      data-frame={frameIndex}
      data-reduced-motion={String(reducedMotion)}
      data-animated={String(animated)}
    />
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Silicon Observatory", () => {
  let container;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (root) {
      await act(async () => root.unmount());
    }
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("selects Observatory only from an explicit URL mode", () => {
    expect(resolveAppMode("?mode=observatory")).toBe("observatory");
    expect(resolveAppMode("?mode=workbench")).toBe("workbench");
    expect(resolveAppMode("?mode=OBSERVATORY")).toBe("workbench");
    expect(resolveAppMode("")).toBe("workbench");
  });

  it("renders a full-screen evidence-labeled Qwen scene and accessible controls", async () => {
    const sessions = sessionFactory();
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult()}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
          reducedMotion={false}
        />,
      );
    });
    await settle();

    expect(container.querySelector("main.observatory")).not.toBeNull();
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1").textContent).toMatch(
      /Silicon Observatory/i,
    );
    expect(
      container.querySelector(
        '[aria-label="Observatory playback controls"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('input[type="file"][accept=".jsonl,.ndjson"]'),
    ).not.toBeNull();
    expect(container.textContent).toMatch(/Unified memory/i);
    expect(container.textContent).toMatch(/Binding activity is derived/i);
    expect(container.textContent).toMatch(/SSD activity is not present/i);
    expect(container.textContent).toMatch(/MTP K3 configured/i);
    expect(container.textContent).toMatch(/measured command-buffer timing/i);
    expect(
      container.querySelector('[data-evidence-level="verified"]'),
    ).not.toBeNull();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "Qwen3.6 27B",
    );
    expect(container.querySelector('a[href="?"]')).not.toBeNull();
  });

  it("shows loading, empty, and recoverable error states", async () => {
    let resolveRegistry;
    const registryPromise = new Promise((resolve) => {
      resolveRegistry = resolve;
    });
    const sessions = sessionFactory();
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={() => registryPromise}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
        />,
      );
    });
    expect(container.textContent).toMatch(/Mapping unified memory/i);
    expect(container.querySelector(".observatory-loader")).not.toBeNull();

    await act(async () => resolveRegistry(registryResult([])));
    expect(container.textContent).toMatch(/No Qwen gallery traces/i);
    expect(container.textContent).toMatch(/Import a local MLX profiler trace/i);

    const retrySessions = sessionFactory({
      loadImpl: vi
        .fn()
        .mockRejectedValueOnce(new Error("Trace window is unavailable"))
        .mockResolvedValueOnce({ dataset: dataset() }),
    });
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult([QWEN_27])}
          analysisSessionFactory={retrySessions.factory}
          SceneComponent={SceneStub}
        />,
      );
    });
    await settle();
    expect(container.textContent).toMatch(/Trace window is unavailable/i);
    expect(container.textContent).toMatch(/Try loading this trace again/i);
    await act(async () =>
      container
        .querySelector('button[aria-label="Retry trace loading"]')
        .click(),
    );
    await settle();
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "Qwen3.6 27B",
    );
  });

  it("retries a failed registry without requiring a page reload", async () => {
    const sessions = sessionFactory();
    const registryLoader = vi
      .fn()
      .mockRejectedValueOnce(new Error("Registry is temporarily unavailable"))
      .mockResolvedValueOnce(registryResult([QWEN_27]));
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={registryLoader}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
        />,
      );
    });
    await settle();
    expect(container.textContent).toMatch(/Registry is temporarily unavailable/i);
    await act(async () =>
      container
        .querySelector('button[aria-label="Retry trace registry"]')
        .click(),
    );
    await settle();
    expect(registryLoader).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "Qwen3.6 27B",
    );
  });

  it("cycles the metadata gallery, pauses, and respects reduced motion", async () => {
    vi.useFakeTimers();
    const sessions = sessionFactory();
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult()}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
          galleryDurationMs={1_000}
          reducedMotion={false}
        />,
      );
    });
    await settle();
    expect(container.textContent).toMatch(/Qwen3.6 27B/);

    await act(async () => vi.advanceTimersByTime(1_000));
    await settle();
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "Qwen3.6 35B",
    );
    expect(container.textContent).toMatch(/legacy unverifiable/i);
    expect(
      container.querySelector('[data-evidence-level="warning"]'),
    ).not.toBeNull();
    expect(container.textContent).toMatch(/source completeness unverifiable/i);

    await act(async () =>
      container.querySelector('button[aria-label="Pause animation"]').click(),
    );
    expect(container.querySelector('[data-testid="scene"]').dataset.animated).toBe(
      "false",
    );
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "Qwen3.6 35B",
    );
    await act(async () =>
      container.querySelector('button[aria-label="Previous gallery trace"]').click(),
    );
    await settle();
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "Qwen3.6 27B",
    );

    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult()}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
          galleryDurationMs={1_000}
          reducedMotion
        />,
      );
    });
    await settle();
    expect(
      container.querySelector('button[aria-label="Play animation"]'),
    ).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "Qwen3.6 27B",
    );
    expect(
      container.querySelector('[data-testid="scene"]').dataset.reducedMotion,
    ).toBe("true");
    expect(container.querySelector('[data-testid="scene"]').dataset.animated).toBe(
      "false",
    );
  });

  it("loads one local trace, releases its URL, and terminates worker sessions", async () => {
    const sessions = sessionFactory();
    const release = vi.fn();
    const localTraceSourceFactory = vi.fn((file) => ({
      kind: "local",
      url: "blob:local-observatory",
      trace: {
        id: "local",
        label: file.name,
        source_evidence_status: "browser-local",
      },
      release,
    }));

    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult([QWEN_27])}
          analysisSessionFactory={sessions.factory}
          localTraceSourceFactory={localTraceSourceFactory}
          SceneComponent={SceneStub}
        />,
      );
    });
    await settle();
    const input = container.querySelector('input[type="file"]');
    const file = new File(['{"record":"summary"}\n'], "local-profile.jsonl", {
      type: "application/x-ndjson",
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();

    expect(localTraceSourceFactory).toHaveBeenCalledWith(file);
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "local-profile.jsonl",
    );
    await act(async () => root.unmount());
    root = null;
    expect(release).toHaveBeenCalledTimes(1);
    expect(
      sessions.sessions.every(
        ({ terminate }) => terminate.mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it("does not let a late registry response overwrite a local trace selection", async () => {
    let resolveRegistry;
    const pendingRegistry = new Promise((resolve) => {
      resolveRegistry = resolve;
    });
    const sessions = sessionFactory();
    const localTraceSourceFactory = vi.fn((file) => ({
      kind: "local",
      url: "blob:local-during-registry",
      trace: {
        id: "local-pending",
        label: file.name,
        source_evidence_status: "browser-local",
      },
      release: vi.fn(),
    }));
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={() => pendingRegistry}
          analysisSessionFactory={sessions.factory}
          localTraceSourceFactory={localTraceSourceFactory}
          SceneComponent={SceneStub}
        />,
      );
    });
    const input = container.querySelector('input[type="file"]');
    const file = new File(["{}\n"], "chosen-locally.jsonl");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    await settle();
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "chosen-locally.jsonl",
    );

    await act(async () => resolveRegistry(registryResult()));
    await settle();
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "chosen-locally.jsonl",
    );
  });

  it("exports PNG and X-compatible MP4 locally and explains unsupported recording", async () => {
    const sessions = sessionFactory();
    const pngDownloader = vi.fn(async () => ({ filename: "frame.png" }));
    const recorder = {
      supported: true,
      recording: false,
      start: vi.fn(),
      stop: vi.fn(async () => ({ filename: "animation.mp4" })),
      destroy: vi.fn(),
    };
    const canvasRecorderFactory = vi.fn(() => recorder);
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult([QWEN_27])}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
          canvasPngDownloader={pngDownloader}
          canvasRecorderFactory={canvasRecorderFactory}
        />,
      );
    });
    await settle();

    const canvas = container.querySelector('[data-testid="scene"]');
    expect(canvasRecorderFactory).toHaveBeenCalledWith(
      canvas,
      expect.objectContaining({
        label: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(canvasRecorderFactory.mock.calls.at(-1)[1].label()).toBe(
      "Qwen3.6 27B",
    );
    expect(container.textContent).toMatch(/X-ready · H\.264 · 720p/i);
    await act(async () =>
      container.querySelector('button[aria-label="Save PNG frame"]').click(),
    );
    expect(pngDownloader).toHaveBeenCalledWith(
      canvas,
      expect.objectContaining({ label: "Qwen3.6 27B" }),
    );

    await act(async () =>
      container.querySelector('button[aria-label="Record MP4 animation"]').click(),
    );
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('button[aria-label="Stop MP4 recording"]'),
    ).not.toBeNull();
    expect(
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Workbench"))
        .disabled,
    ).toBe(true);
    expect(
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent.includes("Open trace"))
        .disabled,
    ).toBe(true);
    expect(container.textContent).toMatch(
      /Stop recording before leaving the Observatory/i,
    );

    await act(async () =>
      canvasRecorderFactory.mock.calls
        .at(-1)[1]
        .onError(new Error("Browser encoder stopped unexpectedly")),
    );
    expect(
      container.querySelector('button[aria-label="Record MP4 animation"]'),
    ).not.toBeNull();
    expect(container.textContent).toMatch(
      /Browser encoder stopped unexpectedly/i,
    );

    await act(async () =>
      container.querySelector('button[aria-label="Record MP4 animation"]').click(),
    );
    await act(async () =>
      container.querySelector('button[aria-label="Stop MP4 recording"]').click(),
    );
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(container.textContent).toMatch(/animation\.mp4 saved locally/i);

    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult([QWEN_27])}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
          canvasPngDownloader={pngDownloader}
          canvasRecorderFactory={() => ({
            ...recorder,
            supported: false,
          })}
        />,
      );
    });
    await settle();
    expect(container.textContent).toMatch(/H\.264 MP4 recording unavailable/i);
    expect(
      container.querySelector('button[aria-label="Record MP4 animation"]')
        .disabled,
    ).toBe(true);
  });

  it("keeps one recording alive while the gallery advances", async () => {
    vi.useFakeTimers();
    const sessions = sessionFactory();
    const recorder = {
      supported: true,
      recording: false,
      start: vi.fn(),
      stop: vi.fn(async () => ({ filename: "gallery.mp4" })),
      destroy: vi.fn(),
    };
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult()}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
          galleryDurationMs={1_000}
          canvasRecorderFactory={() => recorder}
        />,
      );
    });
    await settle();
    await act(async () =>
      container.querySelector('button[aria-label="Record MP4 animation"]').click(),
    );
    expect(
      container.querySelector('button[aria-label="Stop MP4 recording"]'),
    ).not.toBeNull();

    await act(async () => vi.advanceTimersByTime(1_000));
    await settle();
    expect(container.querySelector('[data-testid="scene"]').dataset.label).toBe(
      "Qwen3.6 35B",
    );
    expect(
      container.querySelector('button[aria-label="Stop MP4 recording"]'),
    ).not.toBeNull();
    expect(recorder.destroy).not.toHaveBeenCalled();
  });
});
