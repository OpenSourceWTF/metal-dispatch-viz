import {
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Pause,
  Play,
  RotateCcw,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createAnalysisSession } from "../ProfilerApp.jsx";
import { Badge } from "../components/ui/badge.jsx";
import { Button } from "../components/ui/button.jsx";
import { Progress } from "../components/ui/progress.jsx";
import { buildSceneModel } from "./scene-model.js";
import { createCanvasRecorder, downloadCanvasPng } from "./export.js";
import { ObservatoryScene } from "./ObservatoryScene.jsx";
import {
  nextObservatoryFrameIndex,
  observatoryFrameStride,
} from "./scene-timing.js";
import { buildStoryFrame } from "./story-frame.js";
import {
  createGalleryTraceSource,
  createLocalTraceSource,
  loadObservatoryRegistry,
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
    const query = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return undefined;
    const update = () => setPreferred(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, [forcedValue]);

  return preferred;
}

function progressPercent(progress) {
  const bytes = Number.isFinite(progress?.sourceBytes)
    ? progress.sourceBytes
    : 0;
  const total = Number.isFinite(progress?.totalBytes)
    ? progress.totalBytes
    : 0;
  if (progress?.done) return 100;
  return total > 0 ? Math.min(99, Math.round((bytes / total) * 100)) : 0;
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

function displayEvidence(value) {
  return typeof value === "string" && value.trim() !== ""
    ? value.replaceAll("-", " ")
    : "unspecified";
}

const REGION_EXPLANATIONS = Object.freeze({
  memory:
    "Aggregated model blocks in unified memory. Illumination is a derived binding presentation, not an allocation map.",
  kernel:
    "The active kernel family and recorded dispatch grid. Math particles appear only while this operation is active.",
  gpu:
    "Representative lanes, not physical cores. The exact recorded dispatch grid remains visible beside the aggregation.",
});

function EvidenceDetails({ activeFrame, model }) {
  const configuredWidth = model?.speculation?.configuredWidth;
  const modelMass = model?.model?.estimatedWeightGigabytes;
  const health = model?.evidenceHealth;
  return (
    <div className="evidence-details">
      <div className="evidence-heading">
        <span>Signal key</span>
        <Badge variant="outline">
          {health?.level === "verified"
            ? "evidence verified"
            : "evidence caution"}
        </Badge>
      </div>
      <p className="evidence-status">
        {health?.summary ?? "Evidence health is resolved with the trace."}
      </p>
      <dl>
        <div>
          <dt>Source provenance</dt>
          <dd>
            {displayEvidence(health?.sourceStatus ?? model?.sourceEvidence)}
          </dd>
        </div>
        <div>
          <dt>Source completeness</dt>
          <dd>{displayEvidence(health?.sourceCompleteness)}</dd>
        </div>
        <div>
          <dt>{health?.windowLabel ?? "Trace window"}</dt>
          <dd>{displayEvidence(health?.windowCompleteness)}</dd>
        </div>
        <div>
          <dt>Timing</dt>
          <dd>{model?.evidence?.timing ?? "awaiting trace"}</dd>
        </div>
        <div>
          <dt>Dispatch</dt>
          <dd>{model?.evidence?.dispatch ?? "awaiting trace"}</dd>
        </div>
        <div>
          <dt>Current kernel</dt>
          <dd>{activeFrame?.kernel ?? "awaiting trace"}</dd>
        </div>
        <div>
          <dt>Frame coverage</dt>
          <dd>
            {model?.dispatchCoverage
              ? `${model.dispatchCoverage.displayed.toLocaleString()} of ${model.dispatchCoverage.total.toLocaleString()} launch dispatches`
              : "awaiting trace"}
          </dd>
        </div>
        <div>
          <dt>Model mass</dt>
          <dd>
            {modelMass === null || modelMass === undefined
              ? "architecture metadata unavailable"
              : `~${modelMass} GB manifest estimate`}
          </dd>
        </div>
        <div>
          <dt>Speculation</dt>
          <dd>
            {configuredWidth
              ? `MTP K${configuredWidth} configured; acceptance not measured`
              : "not declared by trace metadata"}
          </dd>
        </div>
        <div>
          <dt>Memory ribbons</dt>
          <dd>Binding activity is derived from bind and setBytes counts.</dd>
        </div>
        <div>
          <dt>Storage</dt>
          <dd>SSD activity is not present in profiler schema v1.</dd>
        </div>
      </dl>
    </div>
  );
}

function Loader({ progress }) {
  const percent = progressPercent(progress);
  return (
    <section className="observatory-loader" aria-busy="true">
      <div className="loader-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="observatory-kicker">Trace cartography</p>
      <strong>Mapping unified memory</strong>
      <span>
        {progress?.parsedRows
          ? `${progress.parsedRows.toLocaleString()} records resolved`
          : "Locating command buffers and kernel families"}
      </span>
      <Progress value={percent} aria-label="Trace loading progress" />
    </section>
  );
}

export function ObservatoryApp({
  registryLoader = loadObservatoryRegistry,
  analysisSessionFactory = createAnalysisSession,
  localTraceSourceFactory = createLocalTraceSource,
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
  const [phase, setPhase] = useState("registry-loading");
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);
  const [sceneModel, setSceneModel] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [speed, setSpeed] = useState(1);
  const [explainedRegion, setExplainedRegion] = useState("kernel");
  const [reloadKey, setReloadKey] = useState(0);
  const [registryReloadKey, setRegistryReloadKey] = useState(0);
  const [status, setStatus] = useState("Opening the trace registry.");
  const [canvas, setCanvas] = useState(null);
  const [canvasRecorder, setCanvasRecorder] = useState(null);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef(null);
  const loadGeneration = useRef(0);
  const selectionRevision = useRef(0);
  const sceneLabelRef = useRef("trace");
  sceneLabelRef.current =
    sceneModel?.label ?? activeSource?.trace?.label ?? "trace";
  const handleCanvasReady = useCallback((nextCanvas) => {
    setCanvas(nextCanvas);
  }, []);
  const handleRecorderError = useCallback((reason) => {
    setRecording(false);
    setStatus(
      reason instanceof Error
        ? reason.message
        : "The browser stopped recording unexpectedly.",
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
      onError: handleRecorderError,
    });
    setCanvasRecorder(nextRecorder);
    setRecording(false);
    return () => nextRecorder.destroy();
  }, [canvas, canvasRecorderFactory, handleRecorderError]);

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
          setStatus("No Qwen gallery traces were found.");
          return;
        }
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
        setStatus("The trace registry could not be opened.");
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
          const model = buildSceneModel({
            trace: activeSource.trace,
            dataset: loaded?.dataset,
          });
          setSceneModel(model);
          setProgress((previous) => ({ ...previous, done: true }));
          setPhase("ready");
          setStatus(`${model.label} is ready.`);
        },
        (reason) => {
          if (!current || generation !== loadGeneration.current) return;
          setError(
            reason instanceof Error
              ? reason
              : new Error("The selected trace could not be loaded."),
          );
          setPhase("error");
          setStatus("Trace loading failed.");
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

  const activateGallery = useCallback(
    (requestedIndex) => {
      const nextIndex = wrapIndex(requestedIndex, gallery.length);
      if (nextIndex === null) return;
      selectionRevision.current += 1;
      setGalleryIndex(nextIndex);
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

  useEffect(() => {
    if (
      phase !== "ready" ||
      !playing ||
      reducedMotion ||
      sceneModel?.frames?.length < 2
    ) {
      return undefined;
    }
    const delay = Math.max(48, 140 / speed);
    const stride = observatoryFrameStride({
      frameCount: sceneModel.frames.length,
      frameDelayMs: delay,
      galleryDurationMs: galleryDurationMs / speed,
    });
    const timer = setInterval(() => {
      setFrameIndex(
        (index) =>
          nextObservatoryFrameIndex({
            current: index,
            frameCount: sceneModel.frames.length,
            stride,
          }),
      );
    }, delay);
    return () => clearInterval(timer);
  }, [
    galleryDurationMs,
    phase,
    playing,
    reducedMotion,
    sceneModel,
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
    activeSource,
    gallery.length,
    galleryDurationMs,
    nextGallery,
    phase,
    playing,
    reducedMotion,
    speed,
  ]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (["input", "select", "textarea", "button", "a"].includes(tagName)) {
        return;
      }
      if (event.key === "ArrowRight") {
        nextGallery();
      } else if (event.key === "ArrowLeft") {
        previousGallery();
      } else if (event.key === " ") {
        event.preventDefault();
        if (!reducedMotion) setPlaying((value) => !value);
      }
    };
    globalThis.addEventListener?.("keydown", onKeyDown);
    return () => globalThis.removeEventListener?.("keydown", onKeyDown);
  }, [nextGallery, previousGallery, reducedMotion]);

  const handleLocalTrace = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const source = localTraceSourceFactory(file);
      selectionRevision.current += 1;
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
      setStatus("Local trace import failed.");
    }
  };

  const savePng = async () => {
    if (!canvas) return;
    try {
      const result = await canvasPngDownloader(canvas, {
        label: sceneModel?.label ?? selectedTrace?.label ?? "trace",
      });
      setStatus(`${result.filename} saved locally.`);
    } catch (reason) {
      setStatus(
        reason instanceof Error
          ? reason.message
          : "The PNG snapshot could not be saved.",
      );
    }
  };

  const toggleRecording = async () => {
    if (!canvasRecorder?.supported) {
      setStatus(
        "H.264 MP4 recording unavailable; PNG snapshots remain available.",
      );
      return;
    }
    try {
      if (recording) {
        const result = await canvasRecorder.stop();
        setRecording(false);
        if (result?.filename) setStatus(`${result.filename} saved locally.`);
      } else {
        canvasRecorder.start();
        setRecording(true);
        setStatus(
          "Recording locally. Stop recording before leaving the Observatory.",
        );
      }
    } catch (reason) {
      setRecording(false);
      setStatus(
        reason instanceof Error
          ? reason.message
          : "The MP4 recording could not be saved.",
      );
    }
  };

  const selectedTrace = activeSource?.trace;
  const galleryPosition =
    activeSource?.kind === "gallery" ? galleryIndex + 1 : null;
  const storyFrame = useMemo(
    () => buildStoryFrame(sceneModel, frameIndex),
    [frameIndex, sceneModel],
  );
  const frameCount = sceneModel?.frames?.length ?? 0;
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
  const title = sceneModel?.label ?? selectedTrace?.label ?? "Silicon Observatory";
  const metadataLine = [
    selectedTrace?.model,
    selectedTrace?.mode,
    selectedTrace?.quantization,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <a className="observatory-skip-link" href="#observatory-stage">
        Skip to observatory
      </a>
      <main
        id="observatory-stage"
        className="observatory"
        data-phase={phase}
        tabIndex="-1"
      >
        <header className="observatory-header">
          <div className="observatory-identity">
            <p className="observatory-kicker">Metal Dispatch Visualizer</p>
            <h1>Silicon Observatory</h1>
          </div>
          <nav className="observatory-actions" aria-label="Observatory modes">
            {recording ? (
              <Button
                variant="outline"
                type="button"
                disabled
                title="Stop recording before leaving the Observatory."
              >
                Workbench
              </Button>
            ) : (
              <Button asChild variant="outline">
                <a href="?">Workbench</a>
              </Button>
            )}
            <Button
              variant="outline"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload aria-hidden="true" />
              Import trace
            </Button>
            <input
              ref={fileInputRef}
              className="observatory-file-input"
              type="file"
              accept=".jsonl,.ndjson"
              aria-label="Import local MLX profiler trace"
              onChange={handleLocalTrace}
            />
            {recording ? (
              <Button
                variant="outline"
                type="button"
                disabled
                title="Stop recording before leaving the Observatory."
              >
                Open trace
              </Button>
            ) : (
              <Button asChild variant="outline">
                <a href={traceWorkbenchHref(activeSource)}>Open trace</a>
              </Button>
            )}
          </nav>
        </header>

        <section className="observatory-stage" aria-label="Trace animation">
          <SceneComponent
            model={sceneModel}
            storyFrame={storyFrame}
            frameIndex={frameIndex}
            reducedMotion={reducedMotion}
            animated={phase === "ready" && playing && !reducedMotion}
            onCanvasReady={handleCanvasReady}
          />
          <div className="observatory-vignette" aria-hidden="true" />

          {(phase === "registry-loading" || phase === "trace-loading") && (
            <Loader progress={progress} />
          )}

          {phase === "empty" && (
            <section className="observatory-state-card">
              <p className="observatory-kicker">Gallery empty</p>
              <h2>No Qwen gallery traces</h2>
              <p>
                Import a local MLX profiler trace to map its kernel topology.
              </p>
              <Button type="button" onClick={() => fileInputRef.current?.click()}>
                <Upload aria-hidden="true" />
                Import local trace
              </Button>
            </section>
          )}

          {phase === "error" && (
            <section className="observatory-state-card" role="alert">
              <p className="observatory-kicker">Signal interrupted</p>
              <h2>{error?.message ?? "Trace loading failed"}</h2>
              <p>
                {activeSource
                  ? "Try loading this trace again, or import another capture."
                  : "Retry the registry or import a local profiler trace."}
              </p>
              <div>
                {activeSource && (
                  <Button
                    type="button"
                    aria-label="Retry trace loading"
                    onClick={() => setReloadKey((value) => value + 1)}
                  >
                    <RotateCcw aria-hidden="true" />
                    Retry
                  </Button>
                )}
                {!activeSource && (
                  <Button
                    type="button"
                    aria-label="Retry trace registry"
                    onClick={() =>
                      setRegistryReloadKey((value) => value + 1)
                    }
                  >
                    <RotateCcw aria-hidden="true" />
                    Retry registry
                  </Button>
                )}
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload aria-hidden="true" />
                  Import trace
                </Button>
              </div>
            </section>
          )}

          <section className="observatory-story-hud" aria-label="Active trace">
            <div className="observatory-trace-title">
              <p className="observatory-kicker">
                {galleryPosition
                  ? `Gallery ${galleryPosition} / ${gallery.length}`
                  : "Local trace"}
              </p>
              <h2>{title}</h2>
              <p>{metadataLine || "Architecture metadata unavailable"}</p>
            </div>

            <section
              className="observatory-progress"
              aria-label="Captured trace progress"
            >
              <div className="progress-copy">
                <span>{storyFrame.progress.capturedWindowLabel}</span>
                <strong>{storyFrame.progress.percent}%</strong>
                <span>Buffer {storyFrame.progress.bufferLabel}</span>
                <span>Dispatch {storyFrame.progress.dispatchLabel}</span>
                <span>{storyFrame.progress.elapsedLabel}</span>
              </div>
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
            </section>

            <section
              className="active-operation"
              aria-label="Active kernel operation"
            >
              <p className="observatory-kicker">Active kernel</p>
              <h3>{storyFrame.active.family}</h3>
              <span>{storyFrame.active.shapeLabel}</span>
              <code>{storyFrame.active.kernel}</code>
            </section>

            <div
              className="observatory-legend"
              aria-label="Animation legend"
            >
              <span data-signal="memory">
                <i aria-hidden="true" /> Unified memory
              </span>
              <span data-signal="math">
                <i aria-hidden="true" /> Active math
              </span>
              <span data-signal="speculation">
                <i aria-hidden="true" /> Configured speculation
              </span>
            </div>

            <div
              className="observatory-evidence-chip"
              data-evidence-level={
                sceneModel?.evidenceHealth?.level ?? "pending"
              }
            >
              <Badge variant="outline">
                {sceneModel?.evidenceHealth?.level === "verified"
                  ? "Measured trace"
                  : "Evidence caution"}
              </Badge>
            </div>
          </section>

          <section className="observatory-region-guide">
            <nav aria-label="Explain stage regions">
              {[
                ["memory", "Unified memory"],
                ["kernel", "Active kernel"],
                ["gpu", "GPU lanes"],
              ].map(([region, label]) => (
                <button
                  key={region}
                  type="button"
                  aria-pressed={explainedRegion === region}
                  onFocus={() => setExplainedRegion(region)}
                  onPointerEnter={() => setExplainedRegion(region)}
                  onClick={() => setExplainedRegion(region)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <p aria-live="polite">
              {REGION_EXPLANATIONS[explainedRegion]}
            </p>
          </section>
        </section>

        <details
          className="observatory-evidence"
          aria-label="What is measured?"
          data-evidence-level={
            sceneModel?.evidenceHealth?.level ?? "pending"
          }
        >
          <summary>What is measured?</summary>
          <EvidenceDetails
            model={sceneModel}
            activeFrame={storyFrame.active}
          />
        </details>

        <footer
          className="observatory-transport"
          aria-label="Observatory playback controls"
        >
          <div className="transport-primary">
            <Button
              variant="outline"
              size="icon-lg"
              type="button"
              aria-label="Previous gallery trace"
              disabled={gallery.length < 2}
              onClick={previousGallery}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              size="icon-lg"
              type="button"
              aria-label={playing ? "Pause animation" : "Play animation"}
              aria-pressed={playing}
              onClick={() => {
                if (reducedMotion) {
                  setStatus(
                    "Reduced motion is active; use the dispatch step controls.",
                  );
                  return;
                }
                setPlaying((value) => !value);
              }}
            >
              {playing ? (
                <Pause aria-hidden="true" />
              ) : (
                <Play aria-hidden="true" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon-lg"
              type="button"
              aria-label="Next gallery trace"
              disabled={gallery.length < 2}
              onClick={nextGallery}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              type="button"
              aria-label="Step backward one dispatch"
              disabled={frameCount < 2 || frameIndex <= 0}
              onClick={() => stepFrame(-1)}
            >
              Step −
            </Button>
            <Button
              variant="ghost"
              type="button"
              aria-label="Step forward one dispatch"
              disabled={frameCount < 2 || frameIndex >= frameCount - 1}
              onClick={() => stepFrame(1)}
            >
              Step +
            </Button>
          </div>
          <div className="transport-speed" aria-label="Playback speed">
            {[0.5, 1, 2].map((value) => (
              <Button
                key={value}
                type="button"
                variant={speed === value ? "secondary" : "ghost"}
                aria-pressed={speed === value}
                onClick={() => setSpeed(value)}
              >
                {value}×
              </Button>
            ))}
          </div>
          <div className="transport-export" aria-label="Local export controls">
            <Button
              type="button"
              variant="outline"
              aria-label="Save PNG frame"
              disabled={!canvas || !sceneModel}
              onClick={savePng}
            >
              <Download aria-hidden="true" />
              Save PNG
            </Button>
            <Button
              type="button"
              variant={recording ? "secondary" : "outline"}
              aria-label={
                recording
                  ? "Stop MP4 recording"
                  : "Record MP4 animation"
              }
              disabled={!sceneModel || !canvasRecorder?.supported}
              onClick={toggleRecording}
            >
              <Film aria-hidden="true" />
              {recording ? "Stop recording" : "Record MP4"}
            </Button>
            {canvasRecorder?.supported ? (
              <span>X-ready · H.264 · 720p</span>
            ) : (
              canvasRecorder && <span>H.264 MP4 recording unavailable</span>
            )}
          </div>
          <p className="transport-status" aria-live="polite">
            {status}
          </p>
        </footer>
      </main>
    </>
  );
}
