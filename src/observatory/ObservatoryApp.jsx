import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Gauge,
  HardDrive,
  Pause,
  Play,
  RotateCcw,
  Upload,
  Zap,
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
import { ObservatoryScene } from "./ObservatoryScene.jsx";
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

function EvidenceRail({ model }) {
  const configuredWidth = model?.speculation?.configuredWidth;
  const modelMass = model?.model?.estimatedWeightGigabytes;
  return (
    <aside className="observatory-evidence" aria-label="Visual evidence key">
      <div className="evidence-heading">
        <span>Signal key</span>
        <Badge variant="outline">schema v1</Badge>
      </div>
      <dl>
        <div>
          <dt>Timing</dt>
          <dd>{model?.evidence?.timing ?? "awaiting trace"}</dd>
        </div>
        <div>
          <dt>Dispatch</dt>
          <dd>{model?.evidence?.dispatch ?? "awaiting trace"}</dd>
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
    </aside>
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
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState("Opening the trace registry.");
  const fileInputRef = useRef(null);
  const loadGeneration = useRef(0);

  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  useEffect(() => {
    let current = true;
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
        if (!current) return;
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
  }, [baseUrl, registryLoader]);

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
    const timer = setInterval(() => {
      setFrameIndex((index) => (index + 1) % sceneModel.frames.length);
    }, delay);
    return () => clearInterval(timer);
  }, [phase, playing, reducedMotion, sceneModel, speed]);

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

  const selectedTrace = activeSource?.trace;
  const galleryPosition =
    activeSource?.kind === "gallery" ? galleryIndex + 1 : null;
  const activeFrame = sceneModel?.frames?.[frameIndex] ?? null;
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
            <Button asChild variant="outline">
              <a href="?">Workbench</a>
            </Button>
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
            <Button asChild variant="outline">
              <a href={traceWorkbenchHref(activeSource)}>Open trace</a>
            </Button>
          </nav>
        </header>

        <section className="observatory-stage" aria-label="Trace animation">
          <SceneComponent
            model={sceneModel}
            frameIndex={frameIndex}
            reducedMotion={reducedMotion}
          />
          <div className="observatory-vignette" aria-hidden="true" />
          <div className="observatory-zones" aria-hidden="true">
            <span className="zone-label zone-ssd">
              <HardDrive /> SSD reservoir
            </span>
            <span className="zone-label zone-cpu">
              <Cpu /> CPU encode
            </span>
            <span className="zone-label zone-memory">Unified memory</span>
            <span className="zone-label zone-gpu">
              <Zap /> GPU kernels
            </span>
          </div>

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

          <section className="observatory-readout" aria-label="Active trace">
            <div className="readout-index">
              <span>
                {galleryPosition
                  ? `${String(galleryPosition).padStart(2, "0")} / ${String(
                      gallery.length,
                    ).padStart(2, "0")}`
                  : "LOCAL"}
              </span>
              <i aria-hidden="true" />
            </div>
            <div>
              <p className="observatory-kicker">Now observing</p>
              <h2>{title}</h2>
              <p>{metadataLine || "Architecture metadata unavailable"}</p>
            </div>
            <div className="kernel-readout">
              <Gauge aria-hidden="true" />
              <span>{activeFrame?.family ?? "awaiting kernel"}</span>
              <code>
                {activeFrame
                  ? `${Math.round(activeFrame.progress * 100)}%`
                  : "—"}
              </code>
            </div>
          </section>
        </section>

        <EvidenceRail model={sceneModel} />

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
                    "Reduced motion is active; use previous and next to step manually.",
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
          <p className="transport-status" aria-live="polite">
            {status}
          </p>
        </footer>
      </main>
    </>
  );
}
