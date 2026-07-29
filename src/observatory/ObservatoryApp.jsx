import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createAnalysisSession } from "../ProfilerApp.jsx";
import { Button } from "../components/ui/button.jsx";
import {
  createCanvasRecorder,
  downloadCanvasPng,
} from "./export.js";
import { ObservatoryScene } from "./ObservatoryScene.jsx";
import { buildSceneModel } from "./scene-model.js";
import { playbackFrameFromElapsed } from "./scene-timing.js";
import { buildStatueFrame } from "./statue-state.js";
import {
  createGalleryTraceSource,
  createLocalTraceSource,
  loadObservatoryRegistry,
  readLocalArchitectureConfig,
} from "./trace-source.js";
import "./observatory.css";

function useReducedMotion(forcedValue) {
  const [preferred, setPreferred] = useState(() => {
    if (typeof forcedValue === "boolean") return forcedValue;
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")
      ?.matches === true;
  });

  useEffect(() => {
    if (typeof forcedValue === "boolean") {
      setPreferred(forcedValue);
      return undefined;
    }
    const query = globalThis.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );
    if (!query) return undefined;
    const update = () => setPreferred(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [forcedValue]);

  return preferred;
}

function progressPercent(progress) {
  if (progress?.done) return 100;
  const bytes = Number.isFinite(progress?.sourceBytes)
    ? progress.sourceBytes
    : 0;
  const total = Number.isFinite(progress?.totalBytes)
    ? progress.totalBytes
    : 0;
  return total > 0
    ? Math.min(99, Math.round((bytes / total) * 100))
    : 0;
}

function wrapIndex(index, length) {
  if (length <= 0) return null;
  return ((index % length) + length) % length;
}

function traceWorkbenchHref(source) {
  return source?.kind === "gallery" && source.trace?.id
    ? `?trace=${encodeURIComponent(source.trace.id)}`
    : "?";
}

function Loader({ progress }) {
  const percent = progressPercent(progress);
  return (
    <section className="observatory-loader" aria-busy="true">
      <div className="loader-sculpture" aria-hidden="true">
        <span />
        <span />
        <span />
        <i />
      </div>
      <p>CALIBRATING ARCHITECTURE</p>
      <strong>{percent.toString().padStart(2, "0")}</strong>
      <progress
        value={percent}
        max="100"
        aria-label="Trace loading progress"
      />
    </section>
  );
}

export function ObservatoryApp({
  registryLoader = loadObservatoryRegistry,
  analysisSessionFactory = createAnalysisSession,
  localTraceSourceFactory = createLocalTraceSource,
  localArchitectureReader = readLocalArchitectureConfig,
  SceneComponent = ObservatoryScene,
  canvasPngDownloader = downloadCanvasPng,
  canvasRecorderFactory = createCanvasRecorder,
  galleryDurationMs = 18_000,
  reducedMotion: forcedReducedMotion,
  baseUrl = globalThis.document?.baseURI,
}) {
  const reducedMotion = useReducedMotion(forcedReducedMotion);
  const [gallery, setGallery] = useState([]);
  const [hosted, setHosted] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [activeSource, setActiveSource] = useState(null);
  const [architectureOverride, setArchitectureOverride] = useState(null);
  const [datasetState, setDatasetState] = useState(null);
  const [sceneModel, setSceneModel] = useState(null);
  const [phase, setPhase] = useState("registry-loading");
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [speed, setSpeed] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [registryReloadKey, setRegistryReloadKey] = useState(0);
  const [status, setStatus] = useState("Opening trace registry.");
  const [canvas, setCanvas] = useState(null);
  const [canvasRecorder, setCanvasRecorder] = useState(null);
  const [recording, setRecording] = useState(false);

  const traceInputRef = useRef(null);
  const configInputRef = useRef(null);
  const captureControllerRef = useRef(null);
  const loadGeneration = useRef(0);
  const selectionRevision = useRef(0);
  const sceneLabelRef = useRef("trace");
  sceneLabelRef.current =
    sceneModel?.label ?? activeSource?.trace?.label ?? "trace";

  const handleCanvasReady = useCallback((nextCanvas) => {
    setCanvas(nextCanvas);
  }, []);
  const handleCaptureController = useCallback((controller) => {
    captureControllerRef.current = controller;
  }, []);
  const handleRecorderError = useCallback((reason) => {
    captureControllerRef.current?.release?.();
    setRecording(false);
    setStatus(
      reason instanceof Error
        ? reason.message
        : "The browser stopped recording unexpectedly.",
    );
  }, []);
  const handleRecorderComplete = useCallback((result) => {
    captureControllerRef.current?.release?.();
    setRecording(false);
    if (!result?.filename) return;
    setStatus(
      result.reason === "duration-limit"
        ? `${result.filename} saved at the recording limit.`
        : `${result.filename} saved locally.`,
    );
  }, []);

  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  useEffect(() => {
    if (!canvas) {
      setCanvasRecorder(null);
      setRecording(false);
      return undefined;
    }
    const nextRecorder = canvasRecorderFactory(canvas, {
      label: () => sceneLabelRef.current,
      onComplete: handleRecorderComplete,
      onError: handleRecorderError,
    });
    setCanvasRecorder(nextRecorder);
    setRecording(false);
    return () => nextRecorder.destroy();
  }, [
    canvas,
    canvasRecorderFactory,
    handleRecorderComplete,
    handleRecorderError,
  ]);

  useEffect(() => {
    let current = true;
    const revisionAtStart = selectionRevision.current;
    setPhase("registry-loading");
    setError(null);
    void Promise.resolve(registryLoader({ baseUrl })).then(
      (loaded) => {
        if (!current) return;
        const nextGallery = Array.isArray(loaded?.gallery)
          ? loaded.gallery
          : [];
        setGallery(nextGallery);
        setHosted(Boolean(loaded?.hosted));
        setGalleryIndex(0);
        if (selectionRevision.current !== revisionAtStart) return;
        if (nextGallery.length === 0) {
          setActiveSource(null);
          setPhase("empty");
          setStatus("No Observatory gallery traces were configured.");
          return;
        }
        setArchitectureOverride(null);
        setActiveSource(
          createGalleryTraceSource({
            trace: nextGallery[0],
            hosted: Boolean(loaded?.hosted),
            baseUrl,
          }),
        );
      },
      (reason) => {
        if (!current || selectionRevision.current !== revisionAtStart) {
          return;
        }
        setError(
          reason instanceof Error
            ? reason
            : new Error("The trace registry could not be opened."),
        );
        setPhase("error");
      },
    );
    return () => {
      current = false;
    };
  }, [baseUrl, registryLoader, registryReloadKey]);

  useEffect(() => {
    if (!activeSource) return undefined;
    return () => activeSource.release?.();
  }, [activeSource]);

  useEffect(() => {
    if (!activeSource) return undefined;
    const generation = ++loadGeneration.current;
    let session;
    let current = true;
    setPhase("trace-loading");
    setError(null);
    setProgress(null);
    setDatasetState(null);
    setSceneModel(null);
    setFrameIndex(0);
    setStatus(`Loading ${activeSource.trace?.label ?? "trace"}.`);

    try {
      session = analysisSessionFactory({
        onProgress(nextProgress) {
          if (current && generation === loadGeneration.current) {
            setProgress(nextProgress);
          }
        },
      });
      void session.load(activeSource.url).then(
        (loaded) => {
          if (!current || generation !== loadGeneration.current) return;
          setProgress((previous) => ({ ...previous, done: true }));
          setDatasetState({ value: loaded?.dataset });
        },
        (reason) => {
          if (!current || generation !== loadGeneration.current) return;
          setError(
            reason instanceof Error
              ? reason
              : new Error("The selected trace could not be loaded."),
          );
          setPhase("error");
        },
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
          : new Error("The selected trace could not be loaded."),
      );
      setPhase("error");
    }

    return () => {
      current = false;
      session?.terminate?.();
    };
  }, [activeSource, analysisSessionFactory, reloadKey]);

  useEffect(() => {
    if (!activeSource || datasetState === null) return;
    try {
      const trace = architectureOverride
        ? {
            ...activeSource.trace,
            architecture: architectureOverride,
          }
        : activeSource.trace;
      const model = buildSceneModel({
        trace,
        dataset: datasetState.value,
      });
      setSceneModel(model);
      setFrameIndex(0);
      setPhase("ready");
      setError(null);
      setStatus(`${model.label} is ready.`);
    } catch (reason) {
      setSceneModel(null);
      setError(
        reason instanceof Error
          ? reason
          : new Error("The selected trace could not be visualized."),
      );
      setPhase("error");
    }
  }, [activeSource, architectureOverride, datasetState]);

  const activateGallery = useCallback(
    (requestedIndex) => {
      const nextIndex = wrapIndex(requestedIndex, gallery.length);
      if (nextIndex === null) return;
      selectionRevision.current += 1;
      setGalleryIndex(nextIndex);
      setArchitectureOverride(null);
      setActiveSource(
        createGalleryTraceSource({
          trace: gallery[nextIndex],
          hosted,
          baseUrl,
        }),
      );
    },
    [baseUrl, gallery, hosted],
  );
  const nextGallery = useCallback(
    () => activateGallery(galleryIndex + 1),
    [activateGallery, galleryIndex],
  );
  const previousGallery = useCallback(
    () => activateGallery(galleryIndex - 1),
    [activateGallery, galleryIndex],
  );

  const frameCount = sceneModel?.frames?.length ?? 0;
  useEffect(() => {
    if (
      phase !== "ready" ||
      !playing ||
      reducedMotion ||
      frameCount < 2
    ) {
      return undefined;
    }
    const initialIndex = frameIndex;
    const terminalIndex = frameCount - 1;
    const remainingFrames = terminalIndex - initialIndex;
    const remainingShare =
      terminalIndex <= 0 ? 0 : remainingFrames / terminalIndex;
    const duration = Math.max(
      1,
      (galleryDurationMs / speed) * remainingShare,
    );
    const startedAt = performance.now();
    const advance = () => {
      const elapsed = performance.now() - startedAt;
      const target = playbackFrameFromElapsed({
        initialIndex,
        frameCount,
        elapsedMs: elapsed,
        durationMs: duration,
      });
      setFrameIndex((current) => Math.max(current, target));
    };
    const timer = setInterval(advance, 90);
    advance();
    return () => clearInterval(timer);
  }, [
    frameCount,
    galleryDurationMs,
    phase,
    playing,
    reducedMotion,
    speed,
  ]);

  useEffect(() => {
    if (
      phase !== "ready" ||
      !playing ||
      reducedMotion ||
      activeSource?.kind !== "gallery" ||
      gallery.length < 2
    ) {
      return undefined;
    }
    const timer = setTimeout(nextGallery, galleryDurationMs / speed);
    return () => clearTimeout(timer);
  }, [
    activeSource?.kind,
    gallery.length,
    galleryDurationMs,
    nextGallery,
    phase,
    playing,
    reducedMotion,
    speed,
  ]);

  useEffect(() => {
    const hasGalleryTransition =
      activeSource?.kind === "gallery" && gallery.length > 1;
    if (
      phase === "ready" &&
      playing &&
      !hasGalleryTransition &&
      frameCount > 0 &&
      frameIndex >= frameCount - 1
    ) {
      setPlaying(false);
    }
  }, [
    activeSource?.kind,
    frameCount,
    frameIndex,
    gallery.length,
    phase,
    playing,
  ]);

  const handleLocalTrace = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || recording) return;
    try {
      const source = localTraceSourceFactory(file);
      selectionRevision.current += 1;
      setArchitectureOverride(null);
      setActiveSource(source);
      setError(null);
      setStatus(`${file.name} remains local to this browser.`);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason
          : new Error("The selected file is not a profiler trace."),
      );
      setPhase("error");
    }
  };

  const handleLocalConfig = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || recording) return;
    try {
      const architecture = await localArchitectureReader(file);
      setArchitectureOverride(architecture);
      setStatus(`${file.name} installed locally for the active trace.`);
    } catch (reason) {
      setStatus(
        reason instanceof Error
          ? reason.message
          : "The checkpoint configuration could not be read.",
      );
    }
  };

  const seekFrame = useCallback(
    (nextIndex) => {
      setPlaying(false);
      setFrameIndex(
        Math.min(
          Math.max(0, frameCount - 1),
          Math.max(0, Number.isFinite(nextIndex) ? nextIndex : 0),
        ),
      );
    },
    [frameCount],
  );
  const stepFrame = useCallback(
    (delta) => {
      setPlaying(false);
      setFrameIndex((current) =>
        Math.min(
          Math.max(0, frameCount - 1),
          Math.max(0, current + delta),
        ),
      );
    },
    [frameCount],
  );
  const scrubSculpture = useCallback(
    (deltaY) => {
      const direction = Math.sign(deltaY);
      if (direction === 0) return;
      const stride = Math.max(1, Math.round(frameCount / 180));
      setPlaying(false);
      setFrameIndex((current) =>
        Math.min(
          Math.max(0, frameCount - 1),
          Math.max(0, current + direction * stride),
        ),
      );
    },
    [frameCount],
  );

  const savePng = useCallback(async () => {
    if (!canvas) return;
    captureControllerRef.current?.prepare?.();
    try {
      const result = await canvasPngDownloader(canvas, {
        label: sceneLabelRef.current,
      });
      setStatus(`${result.filename} saved locally.`);
    } catch (reason) {
      setStatus(
        reason instanceof Error
          ? reason.message
          : "The PNG snapshot could not be saved.",
      );
    } finally {
      captureControllerRef.current?.release?.();
    }
  }, [canvas, canvasPngDownloader]);

  const toggleRecording = useCallback(async () => {
    if (!canvasRecorder?.supported) {
      setStatus(
        "H.264 MP4 recording unavailable; PNG snapshots remain available.",
      );
      return;
    }
    try {
      if (recording) {
        const result = await canvasRecorder.stop();
        captureControllerRef.current?.release?.();
        setRecording(false);
        if (result?.filename) {
          setStatus(`${result.filename} saved locally.`);
        }
      } else {
        captureControllerRef.current?.prepare?.();
        canvasRecorder.start();
        setRecording(true);
        setStatus("Recording locally.");
      }
    } catch (reason) {
      captureControllerRef.current?.release?.();
      setRecording(false);
      setStatus(
        reason instanceof Error
          ? reason.message
          : "The MP4 recording could not be saved.",
      );
    }
  }, [canvasRecorder, recording]);

  const onSceneCommand = useCallback(
    (command) => {
      if (command === "previous") previousGallery();
      if (command === "next") nextGallery();
      if (command === "toggle" && !reducedMotion) {
        setPlaying((value) => !value);
      }
      if (command === "import" && !recording) {
        if (
          activeSource?.kind === "local" &&
          architectureOverride === null
        ) {
          configInputRef.current?.click();
        } else {
          traceInputRef.current?.click();
        }
      }
      if (command === "png") void savePng();
      if (command === "record") void toggleRecording();
    },
    [
      activeSource?.kind,
      architectureOverride,
      nextGallery,
      previousGallery,
      recording,
      reducedMotion,
      savePng,
      toggleRecording,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (
        ["input", "select", "textarea", "button", "a"].includes(
          tagName,
        )
      ) {
        return;
      }
      if (event.key === "ArrowRight") nextGallery();
      if (event.key === "ArrowLeft") previousGallery();
      if (event.key === " " && !reducedMotion) {
        event.preventDefault();
        setPlaying((value) => !value);
      }
      if (event.key.toLowerCase() === "i" && !recording) {
        traceInputRef.current?.click();
      }
    };
    globalThis.addEventListener?.("keydown", onKeyDown);
    return () =>
      globalThis.removeEventListener?.("keydown", onKeyDown);
  }, [nextGallery, previousGallery, recording, reducedMotion]);

  const presentation = useMemo(
    () => buildStatueFrame(sceneModel, frameIndex),
    [frameIndex, sceneModel],
  );

  return (
    <main
      id="observatory-stage"
      className="observatory"
      data-phase={phase}
    >
      <h1 className="observatory-sr-only">Silicon Observatory</h1>

      <SceneComponent
        model={sceneModel}
        presentation={presentation}
        frameIndex={frameIndex}
        reducedMotion={reducedMotion}
        animated={phase === "ready" && playing && !reducedMotion}
        onCanvasReady={handleCanvasReady}
        onCaptureController={handleCaptureController}
        onCommand={onSceneCommand}
        onScrub={scrubSculpture}
      />
      <div className="observatory-vignette" aria-hidden="true" />
      <div className="observatory-scanline" aria-hidden="true" />

      {(phase === "registry-loading" || phase === "trace-loading") && (
        <Loader progress={progress} />
      )}

      {phase === "empty" && (
        <section className="observatory-state-card">
          <p>NO CONFIGURED SIGNAL</p>
          <Button
            type="button"
            onClick={() => traceInputRef.current?.click()}
          >
            OPEN TRACE
          </Button>
        </section>
      )}

      {phase === "error" && (
        <section className="observatory-state-card" role="alert">
          <p>SIGNAL INTERRUPTED</p>
          <strong>{error?.message ?? "Trace loading failed"}</strong>
          <div>
            {activeSource ? (
              <Button
                type="button"
                aria-label="Retry trace loading"
                onClick={() => setReloadKey((value) => value + 1)}
              >
                RETRY
              </Button>
            ) : (
              <Button
                type="button"
                aria-label="Retry trace registry"
                onClick={() =>
                  setRegistryReloadKey((value) => value + 1)
                }
              >
                RETRY
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => traceInputRef.current?.click()}
            >
              OPEN TRACE
            </Button>
          </div>
        </section>
      )}

      {recording && (
        <div className="observatory-recording" aria-hidden="true" />
      )}

      <section
        className="observatory-accessible-controls"
        aria-label="Observatory playback controls"
      >
        <a href={traceWorkbenchHref(activeSource)}>Open in workbench</a>
        <button
          type="button"
          aria-label="Previous gallery trace"
          disabled={gallery.length < 2}
          onClick={previousGallery}
        >
          Previous trace
        </button>
        <button
          type="button"
          aria-label={
            reducedMotion
              ? "Animation disabled by reduced motion"
              : playing
                ? "Pause animation"
                : "Play animation"
          }
          disabled={reducedMotion}
          onClick={() => setPlaying((value) => !value)}
        >
          Toggle playback
        </button>
        <button
          type="button"
          aria-label="Next gallery trace"
          disabled={gallery.length < 2}
          onClick={nextGallery}
        >
          Next trace
        </button>
        <button
          type="button"
          aria-label="Step backward one dispatch"
          disabled={frameCount < 2 || frameIndex <= 0}
          onClick={() => stepFrame(-1)}
        >
          Step backward
        </button>
        <button
          type="button"
          aria-label="Step forward one dispatch"
          disabled={frameCount < 2 || frameIndex >= frameCount - 1}
          onClick={() => stepFrame(1)}
        >
          Step forward
        </button>
        <label>
          Captured window position
          <input
            aria-label="Captured window position"
            type="range"
            min="0"
            max={Math.max(0, frameCount - 1)}
            step="1"
            value={Math.min(frameIndex, Math.max(0, frameCount - 1))}
            disabled={frameCount < 2}
            onInput={(event) =>
              seekFrame(Number(event.currentTarget.value))
            }
          />
        </label>
        <label>
          Playback speed
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
          >
            <option value="0.5">0.5×</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
          </select>
        </label>
        <button
          type="button"
          aria-label="Import local MLX profiler trace"
          disabled={recording}
          onClick={() => traceInputRef.current?.click()}
        >
          Import trace
        </button>
        <input
          ref={traceInputRef}
          type="file"
          accept=".jsonl,.ndjson"
          aria-label="Choose local MLX profiler trace"
          onChange={handleLocalTrace}
        />
        <button
          type="button"
          aria-label="Import checkpoint architecture config"
          disabled={recording}
          onClick={() => configInputRef.current?.click()}
        >
          Import config
        </button>
        <input
          ref={configInputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Choose checkpoint config"
          onChange={handleLocalConfig}
        />
        <button
          type="button"
          aria-label="Save PNG frame"
          disabled={!canvas || !sceneModel}
          onClick={savePng}
        >
          Save PNG
        </button>
        <button
          type="button"
          aria-label={
            recording
              ? "Stop MP4 recording"
              : "Record MP4 animation"
          }
          disabled={!sceneModel || !canvasRecorder?.supported}
          onClick={toggleRecording}
        >
          {recording ? "Stop recording" : "Record MP4"}
        </button>
      </section>

      <p
        className="observatory-sr-only"
        role="status"
        aria-live="polite"
      >
        {status}
      </p>
    </main>
  );
}
