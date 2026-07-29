// @vitest-environment jsdom

import { act, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveAppMode } from "../src/main.jsx";
import { normalizeArchitecture } from "../src/observatory/architecture.js";
import { ObservatoryApp } from "../src/observatory/ObservatoryApp.jsx";

function denseArchitecture(layers = 6) {
  return {
    model_type: "generic_dense",
    num_hidden_layers: layers,
    hidden_size: 512,
    vocab_size: 4096,
    layer_type_pattern: [
      "linear_attention",
      "linear_attention",
      "linear_attention",
      "full_attention",
    ],
    num_attention_heads: 8,
    num_key_value_heads: 2,
    head_dim: 64,
    linear_num_key_heads: 4,
    linear_num_value_heads: 8,
    linear_key_head_dim: 32,
    linear_value_head_dim: 32,
    intermediate_size: 1536,
    mtp_num_hidden_layers: 1,
  };
}

function moeArchitecture() {
  return {
    model_type: "generic_moe",
    num_hidden_layers: 4,
    hidden_size: 384,
    vocab_size: 4096,
    layer_type_pattern: [
      "linear_attention",
      "linear_attention",
      "linear_attention",
      "full_attention",
    ],
    num_attention_heads: 6,
    num_key_value_heads: 2,
    head_dim: 64,
    linear_num_key_heads: 4,
    linear_num_value_heads: 6,
    linear_key_head_dim: 32,
    linear_value_head_dim: 32,
    moe_intermediate_size: 192,
    shared_expert_intermediate_size: 192,
    num_experts: 12,
    num_experts_per_tok: 3,
    mtp_num_hidden_layers: 1,
  };
}

const DENSE_TRACE = {
  id: "dense",
  label: "Dense candidate",
  model: "Dense 8B",
  mode: "MTP K3",
  quantization: "affine Q4 group 64",
  relativePath: "dense.jsonl",
  source_evidence_status: "verified-complete",
  architecture: denseArchitecture(),
};

const MOE_TRACE = {
  id: "moe",
  label: "Mixture candidate",
  model: "Mixture 12B",
  mode: "MTP K1",
  quantization: "affine Q4 group 64",
  relativePath: "moe.jsonl",
  source_evidence_status: "legacy-unverifiable",
  architecture: moeArchitecture(),
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
            commandBufferIndex: 0,
            dispatch: "threads",
            kernel,
            grid: [64, 1, 1],
            threadgroup: [32, 1, 1],
            bufferBinds: 4,
          },
          {
            seq: 1,
            atNs: 80,
            commandBufferIndex: 0,
            dispatch: "threads",
            kernel: "rms_norm",
            grid: [16, 1, 1],
            threadgroup: [16, 1, 1],
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
    health: {
      validEvidence: true,
      sourceCompleteness: "complete",
      droppedRows: 0,
      malformedRows: 0,
    },
  };
}

function registryResult(gallery = [DENSE_TRACE, MOE_TRACE]) {
  return {
    hosted: true,
    registry: { traces: gallery },
    gallery,
  };
}

function sessionFactory({
  loadImpl = async () => ({ dataset: dataset() }),
} = {}) {
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
  presentation,
  frameIndex,
  reducedMotion,
  animated,
  onCanvasReady,
  onCommand,
}) {
  const canvasRef = useRef(null);
  useEffect(() => {
    onCanvasReady?.(canvasRef.current);
    return () => onCanvasReady?.(null);
  }, [onCanvasReady]);
  return (
    <canvas
      ref={canvasRef}
      data-testid="scene"
      data-label={model?.label ?? ""}
      data-frame={frameIndex}
      data-layers={presentation?.architecture?.layerCount ?? 0}
      data-kernel={presentation?.kernel?.exactName ?? ""}
      data-reduced-motion={String(reducedMotion)}
      data-animated={String(animated)}
      onClick={() => onCommand?.("toggle")}
    />
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Silicon Observatory process", () => {
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
    if (root) await act(async () => root.unmount());
    container.remove();
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  it("selects Observatory only from an explicit URL mode", () => {
    expect(resolveAppMode("?mode=observatory")).toBe("observatory");
    expect(resolveAppMode("?mode=workbench")).toBe("workbench");
    expect(resolveAppMode("?mode=OBSERVATORY")).toBe("workbench");
    expect(resolveAppMode("")).toBe("workbench");
  });

  it("keeps the visible shell minimal while exposing complete semantic controls", async () => {
    const sessions = sessionFactory();
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult([DENSE_TRACE])}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
          reducedMotion={false}
        />,
      );
    });
    await settle();

    const scene = container.querySelector('[data-testid="scene"]');
    expect(scene.dataset.label).toBe("Dense candidate");
    expect(scene.dataset.layers).toBe("6");
    expect(scene.dataset.kernel).toBe("steel_gemm_fused_q4");
    expect(container.querySelector("main.observatory")).not.toBeNull();
    expect(
      container.querySelector(
        '[aria-label="Observatory playback controls"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('input[accept=".jsonl,.ndjson"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        'input[aria-label="Choose checkpoint config"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Save PNG frame"]'),
    ).not.toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="Record MP4 animation"]',
      ),
    ).not.toBeNull();

    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
    expect(container.querySelector(".observatory-story-hud")).toBeNull();
    expect(container.querySelector(".observatory-legend")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
  });

  it("steps, scrubs, and honors reduced motion without changing the scene contract", async () => {
    const sessions = sessionFactory();
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult([DENSE_TRACE])}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
          reducedMotion
        />,
      );
    });
    await settle();
    const scene = () =>
      container.querySelector('[data-testid="scene"]');
    expect(scene().dataset.frame).toBe("0");
    expect(scene().dataset.animated).toBe("false");

    await act(async () =>
      container
        .querySelector(
          'button[aria-label="Step forward one dispatch"]',
        )
        .click(),
    );
    expect(scene().dataset.frame).toBe("1");
    expect(scene().dataset.kernel).toBe("rms_norm");

    const scrubber = container.querySelector(
      'input[aria-label="Captured window position"]',
    );
    await act(async () => {
      scrubber.value = "0";
      scrubber.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(scene().dataset.frame).toBe("0");
    expect(
      container.querySelector(
        'button[aria-label="Animation disabled by reduced motion"]',
      ).disabled,
    ).toBe(true);
  });

  it("surfaces loader, empty registry, and recoverable failures", async () => {
    let resolveRegistry;
    const pendingRegistry = new Promise((resolve) => {
      resolveRegistry = resolve;
    });
    const sessions = sessionFactory();
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={() => pendingRegistry}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
        />,
      );
    });
    expect(container.querySelector(".observatory-loader")).not.toBeNull();
    expect(container.textContent).toMatch(/calibrating architecture/i);

    await act(async () => resolveRegistry(registryResult([])));
    expect(container.textContent).toMatch(/no configured signal/i);

    const retrySessions = sessionFactory({
      loadImpl: vi
        .fn()
        .mockRejectedValueOnce(new Error("Trace window unavailable"))
        .mockResolvedValueOnce({ dataset: dataset() }),
    });
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult([DENSE_TRACE])}
          analysisSessionFactory={retrySessions.factory}
          SceneComponent={SceneStub}
        />,
      );
    });
    await settle();
    expect(container.textContent).toMatch(/Trace window unavailable/i);
    await act(async () =>
      container
        .querySelector('button[aria-label="Retry trace loading"]')
        .click(),
    );
    await settle();
    expect(
      container.querySelector('[data-testid="scene"]').dataset.label,
    ).toBe("Dense candidate");
  });

  it("imports a local trace, releases its URL, and terminates every worker session", async () => {
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
          registryLoader={async () => registryResult([DENSE_TRACE])}
          analysisSessionFactory={sessions.factory}
          localTraceSourceFactory={localTraceSourceFactory}
          SceneComponent={SceneStub}
        />,
      );
    });
    await settle();

    const input = container.querySelector(
      'input[aria-label="Choose local MLX profiler trace"]',
    );
    const file = new File(["{}\n"], "local-profile.jsonl");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    await settle();

    expect(localTraceSourceFactory).toHaveBeenCalledWith(file);
    expect(
      container.querySelector('[data-testid="scene"]').dataset.label,
    ).toBe("local-profile.jsonl");
    expect(
      container.querySelector('[data-testid="scene"]').dataset.layers,
    ).toBe("0");

    await act(async () => root.unmount());
    root = null;
    expect(release).toHaveBeenCalledTimes(1);
    expect(
      sessions.sessions.every(
        ({ terminate }) => terminate.mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it("attaches a local architecture config without reloading the trace", async () => {
    const sessions = sessionFactory();
    const localArchitectureReader = vi.fn(async () =>
      normalizeArchitecture(denseArchitecture(7)),
    );
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult([DENSE_TRACE])}
          analysisSessionFactory={sessions.factory}
          localArchitectureReader={localArchitectureReader}
          SceneComponent={SceneStub}
        />,
      );
    });
    await settle();
    expect(sessions.factory).toHaveBeenCalledTimes(1);

    const input = container.querySelector(
      'input[aria-label="Choose checkpoint config"]',
    );
    const file = new File(["{}"], "config.json", {
      type: "application/json",
    });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    await settle();

    expect(localArchitectureReader).toHaveBeenCalledWith(file);
    expect(sessions.factory).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="scene"]').dataset.layers,
    ).toBe("7");
  });

  it("does not let a late registry response overwrite a local trace", async () => {
    let resolveRegistry;
    const pendingRegistry = new Promise((resolve) => {
      resolveRegistry = resolve;
    });
    const sessions = sessionFactory();
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={() => pendingRegistry}
          analysisSessionFactory={sessions.factory}
          localTraceSourceFactory={(file) => ({
            kind: "local",
            url: "blob:chosen",
            trace: { id: "chosen", label: file.name },
            release: vi.fn(),
          })}
          SceneComponent={SceneStub}
        />,
      );
    });
    const input = container.querySelector(
      'input[aria-label="Choose local MLX profiler trace"]',
    );
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["{}\n"], "chosen.jsonl")],
    });
    await act(async () =>
      input.dispatchEvent(new Event("change", { bubbles: true })),
    );
    await settle();

    await act(async () => resolveRegistry(registryResult()));
    await settle();
    expect(
      container.querySelector('[data-testid="scene"]').dataset.label,
    ).toBe("chosen.jsonl");
  });

  it("cycles a config-driven gallery and can pause the choreography", async () => {
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
    expect(
      container.querySelector('[data-testid="scene"]').dataset.label,
    ).toBe("Dense candidate");

    await act(async () => vi.advanceTimersByTime(1_000));
    await settle();
    expect(
      container.querySelector('[data-testid="scene"]').dataset.label,
    ).toBe("Mixture candidate");
    expect(
      container.querySelector('[data-testid="scene"]').dataset.layers,
    ).toBe("4");

    await act(async () =>
      container
        .querySelector('button[aria-label="Pause animation"]')
        .click(),
    );
    await act(async () => vi.advanceTimersByTime(2_000));
    expect(
      container.querySelector('[data-testid="scene"]').dataset.label,
    ).toBe("Mixture candidate");
  });

  it("exports PNG and H.264 MP4 locally through one recorder lifecycle", async () => {
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
          registryLoader={async () => registryResult([DENSE_TRACE])}
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
        onComplete: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    await act(async () =>
      container
        .querySelector('button[aria-label="Save PNG frame"]')
        .click(),
    );
    expect(pngDownloader).toHaveBeenCalledWith(
      canvas,
      expect.objectContaining({ label: "Dense candidate" }),
    );

    await act(async () =>
      container
        .querySelector('button[aria-label="Record MP4 animation"]')
        .click(),
    );
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".observatory-recording")).not.toBeNull();
    expect(
      container.querySelector(
        'button[aria-label="Import local MLX profiler trace"]',
      ).disabled,
    ).toBe(true);

    await act(async () =>
      container
        .querySelector('button[aria-label="Stop MP4 recording"]')
        .click(),
    );
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[role="status"]').textContent,
    ).toMatch(/animation\.mp4 saved locally/i);
  });

  it("keeps the same recording canvas while gallery architecture changes", async () => {
    vi.useFakeTimers();
    const sessions = sessionFactory();
    const recorder = {
      supported: true,
      start: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    const canvasRecorderFactory = vi.fn(() => recorder);
    await act(async () => {
      root.render(
        <ObservatoryApp
          registryLoader={async () => registryResult()}
          analysisSessionFactory={sessions.factory}
          SceneComponent={SceneStub}
          galleryDurationMs={1_000}
          canvasRecorderFactory={canvasRecorderFactory}
        />,
      );
    });
    await settle();
    const originalCanvas = container.querySelector(
      '[data-testid="scene"]',
    );

    await act(async () =>
      container
        .querySelector('button[aria-label="Record MP4 animation"]')
        .click(),
    );
    await act(async () => vi.advanceTimersByTime(1_000));
    await settle();

    expect(
      container.querySelector('[data-testid="scene"]'),
    ).toBe(originalCanvas);
    expect(
      container.querySelector('[data-testid="scene"]').dataset.label,
    ).toBe("Mixture candidate");
    expect(canvasRecorderFactory).toHaveBeenCalledTimes(1);
    expect(recorder.destroy).not.toHaveBeenCalled();
  });
});
