import { useEffect, useMemo, useRef, useState } from "react";

import datasetWorkerUrl from "../public/dataset-worker.js?worker&url";
import { TraceAnalysisSession } from "../public/analysis-session.js";
import { bootstrap } from "../public/app.js";
import { glossaryEntry } from "../public/glossary.js";
import { RunCombobox } from "./components/RunCombobox.jsx";
import { Badge } from "./components/ui/badge.jsx";
import { Button } from "./components/ui/button.jsx";
import { Input } from "./components/ui/input.jsx";
import { Progress } from "./components/ui/progress.jsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover.jsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select.jsx";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "./components/ui/sheet.jsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table.jsx";
import { Textarea } from "./components/ui/textarea.jsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "./components/ui/tabs.jsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip.jsx";
import { ToggleGroup, ToggleGroupItem } from "./components/ui/toggle-group.jsx";

export function resolveWorkerUrl(workerUrl, baseUrl) {
  const source =
    typeof workerUrl === "string" && workerUrl.startsWith("/")
      ? `.${workerUrl}`
      : workerUrl;
  return new URL(source, baseUrl).href;
}

export function createAnalysisSession(options) {
  return new TraceAnalysisSession({
    ...options,
    workerUrl: resolveWorkerUrl(
      datasetWorkerUrl,
      globalThis.document?.baseURI ?? import.meta.url,
    ),
  });
}

function DefinitionTrigger({ term, label }) {
  const entry = glossaryEntry(term);
  const detail =
    entry?.definition ?? `No definition is available for ${label}.`;
  const openInManual = () => {
    document.dispatchEvent(
      new CustomEvent("mdv:open-manual-definition", {
        detail: { term },
      }),
    );
  };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              className="term-trigger"
              type="button"
              data-term={term}
              aria-label={`Define ${label}`}
            >
              ⓘ
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent className="definition-help-tooltip">
          <strong>{entry?.label ?? label}</strong>
          <span>{detail}</span>
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        className="definition-help-popover"
        aria-label={`${entry?.label ?? label} definition`}
      >
        <div className="definition-help-heading">
          <strong>{entry?.label ?? label}</strong>
          {entry?.evidence ? <span>{entry.evidence}</span> : null}
        </div>
        <p>{detail}</p>
        {entry?.method ? <p>Method: {entry.method}</p> : null}
        {entry?.limitation ? <p>Limit: {entry.limitation}</p> : null}
        <Button type="button" onClick={openInManual}>
          Open in Field manual
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function SortableHeader({ id, label, term }) {
  return (
    <TableHead scope="col" aria-sort="none">
      <Button
        id={id}
        className="table-sort-button"
        type="button"
        aria-label={`Sort ${label}`}
      >
        <span>{label}</span>
        <span className="sort-indicator" aria-hidden="true">
          ↕
        </span>
      </Button>
      {term ? <DefinitionTrigger term={term} label={label} /> : null}
    </TableHead>
  );
}

function initialMetric(label, term, className = "metric", unit = true) {
  return (
    <div className={className}>
      <dt>
        {label} <DefinitionTrigger term={term} label={label} />
      </dt>
      <dd>—{unit ? <span className="unit"> ms</span> : null}</dd>
    </div>
  );
}

export function ProfilerApp({
  bootstrapController = bootstrap,
  analysisSessionFactory = createAnalysisSession,
}) {
  const [runSelectorState, setRunSelectorState] = useState({
    runs: [],
    selectedId: null,
  });
  const runSelectionHandler = useRef(() => {});
  const runSelector = useMemo(
    () => ({
      render({ runs, selectedId, onSelect }) {
        runSelectionHandler.current =
          typeof onSelect === "function" ? onSelect : () => {};
        setRunSelectorState({ runs, selectedId });
      },
    }),
    [],
  );
  const [launchSelectorState, setLaunchSelectorState] = useState({
    options: [],
    value: null,
    disabled: true,
  });
  const launchSelectionHandler = useRef(() => {});
  const launchSelector = useMemo(
    () => ({
      render({ options = [], value = null, disabled = true, onSelect }) {
        launchSelectionHandler.current =
          typeof onSelect === "function" ? onSelect : () => {};
        setLaunchSelectorState({ options, value, disabled });
      },
    }),
    [],
  );
  const [loadingProgress, setLoadingProgress] = useState({
    value: 0,
    text: "0%",
  });
  const progressIndicator = useMemo(
    () => ({
      render(next) {
        setLoadingProgress(next);
      },
    }),
    [],
  );
  const [tableTab, setTableTab] = useState("kernel");
  const tableTabSelectionHandler = useRef(() => {});
  const tableTabs = useMemo(
    () => ({
      render({ value = "kernel", onSelect }) {
        tableTabSelectionHandler.current =
          typeof onSelect === "function" ? onSelect : () => {};
        setTableTab(value);
      },
    }),
    [],
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenChangeHandler = useRef(() => {});
  const helpSheet = useMemo(
    () => ({
      render({ open, onOpenChange }) {
        helpOpenChangeHandler.current =
          typeof onOpenChange === "function" ? onOpenChange : () => {};
        setHelpOpen(Boolean(open));
      },
    }),
    [],
  );
  const [exportOpen, setExportOpen] = useState(false);
  const exportOpenChangeHandler = useRef(() => {});
  const exportSheet = useMemo(
    () => ({
      render({ open, onOpenChange }) {
        exportOpenChangeHandler.current =
          typeof onOpenChange === "function" ? onOpenChange : () => {};
        setExportOpen(Boolean(open));
      },
    }),
    [],
  );
  const [exportFormatValue, setExportFormatValue] = useState("markdown");
  const exportFormatSelectionHandler = useRef(() => {});
  const exportFormatSelector = useMemo(
    () => ({
      render({ value = "markdown", onSelect }) {
        exportFormatSelectionHandler.current =
          typeof onSelect === "function" ? onSelect : () => {};
        setExportFormatValue(value);
      },
    }),
    [],
  );
  const [rangeModeState, setRangeModeState] = useState({
    value: "view",
    analyzeDisabled: true,
    analyzeLabel: "Preparing exact analysis",
  });
  const rangeModeSelectionHandler = useRef(() => {});
  const rangeModeSelector = useMemo(
    () => ({
      render({ value, analyzeDisabled, analyzeLabel, onSelect }) {
        rangeModeSelectionHandler.current =
          typeof onSelect === "function" ? onSelect : () => {};
        setRangeModeState({ value, analyzeDisabled, analyzeLabel });
      },
    }),
    [],
  );

  useEffect(() => {
    const background = [
      document.querySelector(".site-header"),
      document.querySelector("main"),
    ].filter(Boolean);
    const modalOpen = helpOpen || exportOpen;
    for (const element of background) element.inert = modalOpen;
    return () => {
      for (const element of background) element.inert = false;
    };
  }, [exportOpen, helpOpen]);

  useEffect(() => {
    const controllerAbort = new AbortController();
    let active = true;
    const startTimer = setTimeout(() => {
      if (!active) return;

      void Promise.resolve(
        bootstrapController({
          analysisSessionFactory,
          exportSheet,
          exportFormatSelector,
          helpSheet,
          launchSelector,
          progressIndicator,
          reactDefinitions: true,
          rangeModeSelector,
          runSelector,
          tableTabs,
          signal: controllerAbort.signal,
        }),
      ).then(
        () => {},
        (error) => {
          if (!active) return;
          const status = document.getElementById("trace-status");
          if (status) {
            const message =
              error instanceof Error
                ? error.message
                : "The workbench could not start.";
            status.textContent = `Workbench failed to start: ${message}`;
          }
        },
      );
    }, 0);

    return () => {
      active = false;
      clearTimeout(startTimer);
      controllerAbort.abort();
    };
  }, [
    analysisSessionFactory,
    bootstrapController,
    exportSheet,
    exportFormatSelector,
    helpSheet,
    launchSelector,
    progressIndicator,
    rangeModeSelector,
    runSelector,
    tableTabs,
  ]);

  return (
    <TooltipProvider>
      <header className="site-header">
        <div className="identity-lockup">
          <p className="wordmark" aria-hidden="true">
            MDV
          </p>
          <div>
            <h1>Metal Dispatch Workbench</h1>
            <p className="directory-line">
              Trace directory{" "}
              <code id="directory-identity">resolving local source…</code>
            </p>
          </div>
        </div>
        <div className="header-actions" aria-label="Workbench controls">
          <Button
            id="open-trace-button"
            type="button"
            aria-controls="local-trace-input"
            data-ready-control
            disabled
          >
            Open trace
          </Button>
          <input
            id="local-trace-input"
            className="visually-hidden"
            type="file"
            accept=".jsonl,.ndjson,application/x-ndjson"
            aria-label="Open local profiler traces"
            multiple
          />
          <Button
            id="field-manual-button"
            type="button"
            aria-haspopup="dialog"
            aria-controls="field-manual-drawer"
          >
            Field manual
          </Button>
          <Button
            id="refresh-button"
            type="button"
            aria-label="Refresh trace directory"
            data-ready-control
            disabled
          >
            Refresh
          </Button>
          <Button
            id="theme-toggle"
            type="button"
            aria-label="Switch color theme"
            aria-pressed="false"
            data-ready-control
            disabled
          >
            Theme
          </Button>
        </div>
      </header>

      <div
        id="trace-drop-overlay"
        className="trace-drop-overlay"
        role="status"
        aria-live="polite"
        hidden
      >
        <div className="trace-drop-card">
          <strong>Drop profiler traces</strong>
          <span id="trace-drop-status">
            .jsonl and .ndjson stay in this browser
          </span>
        </div>
      </div>

      <main>
        <div className="instrument">
          <h2 className="visually-hidden">Available runs</h2>
          <nav
            id="trace-rail"
            className="trace-rail"
            aria-label="Run selector"
            aria-busy="true"
          >
            <RunCombobox
              runs={runSelectorState.runs}
              selectedId={runSelectorState.selectedId}
              onSelect={(id) => runSelectionHandler.current(id)}
            />
            <output
              id="selected-trace-summary"
              className="selected-trace-summary"
            >
              Waiting for registry
            </output>
          </nav>

          <section
            className="trace-context"
            aria-labelledby="trace-context-heading"
          >
            <h2 id="trace-context-heading" className="visually-hidden">
              Selected trace provenance
            </h2>
            <div id="provenance-strip" className="provenance-strip">
              <span className="strip-label">Provenance</span>
              <span className="provenance-item">
                <b>File</b> waiting for registry
              </span>
              <span className="provenance-item">
                <b>Model</b> —
              </span>
              <span className="provenance-item">
                <b>Quantization</b> —
              </span>
              <span className="provenance-item">
                <b>Mode</b> —
              </span>
              <span id="evidence-badges" className="evidence-badges">
                <Badge
                  id="evidence-badge"
                  className="evidence-badge evidence-badge-invalid"
                  variant="destructive"
                >
                  Invalid or legacy evidence
                </Badge>
              </span>
            </div>
            <div id="health-strip" className="health-strip">
              <div
                id="trace-status"
                className="trace-status"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                Reading the trace registry…
              </div>
              <div id="window-control" className="window-control">
                <span id="window-select-label">Launch</span>
                <Select
                  value={launchSelectorState.value ?? undefined}
                  onValueChange={(value) =>
                    launchSelectionHandler.current(value)
                  }
                  disabled={launchSelectorState.disabled}
                >
                  <SelectTrigger
                    id="window-select"
                    aria-labelledby="window-select-label"
                  >
                    <SelectValue placeholder="Waiting for launch windows" />
                  </SelectTrigger>
                  <SelectContent>
                    {launchSelectorState.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="metric-band" aria-labelledby="metric-heading">
            <div className="metric-band-heading">
              <h2 id="metric-heading">Selected window decomposition</h2>
              <span id="metric-scope-label">Launch totals</span>
            </div>
            <dl id="metric-grid" className="metric-grid" aria-busy="true">
              {initialMetric("Wall span", "wall-span", "metric metric-primary")}
              {initialMetric(
                "Exposed host",
                "exposed-host",
                "metric metric-exposed",
              )}
              {initialMetric(
                "Hidden host",
                "hidden-host",
                "metric metric-hidden",
              )}
              {initialMetric("GPU busy", "gpu-busy", "metric metric-gpu")}
              {initialMetric("GPU work", "gpu-work", "metric metric-gpu")}
              {initialMetric(
                "Decision drain",
                "decision-drain",
                "metric metric-decision",
              )}
              {initialMetric("Cap wait", "cap-wait", "metric metric-cap")}
              {initialMetric(
                "Dependency",
                "dependency-wait",
                "metric metric-dependency",
              )}
              {initialMetric(
                "Command buffers",
                "command-buffer",
                "metric",
                false,
              )}
              {initialMetric("Dispatches", "dispatch", "metric", false)}
            </dl>
          </section>

          <div className="workbench-grid">
            <div className="analysis-column">
              <figure
                className="timeline-figure"
                aria-labelledby="timeline-heading"
              >
                <div className="timeline-toolbar">
                  <div>
                    <p className="eyebrow">Synchronized pipeline</p>
                    <h2 id="timeline-heading">Dispatch overlap timeline</h2>
                  </div>
                  <div
                    className="timeline-actions"
                    aria-label="Timeline view controls"
                  >
                    <Button
                      id="ai-export-button"
                      className="ai-export-button"
                      type="button"
                      aria-haspopup="dialog"
                      aria-controls="ai-export-drawer"
                      disabled
                    >
                      Export for AI
                    </Button>
                    <output id="timeline-scale" className="timeline-scale">
                      Fit · — ns/px
                    </output>
                    <Button
                      id="zoom-out"
                      type="button"
                      aria-label="Zoom timeline out"
                      disabled
                    >
                      −
                    </Button>
                    <Button id="fit-timeline" type="button" disabled>
                      Fit
                    </Button>
                    <Button
                      id="zoom-in"
                      type="button"
                      aria-label="Zoom timeline in"
                      disabled
                    >
                      +
                    </Button>
                  </div>
                </div>

                <p id="timeline-scroll-label" className="scroll-label">
                  Drag to zoom · Shift-drag to pan · horizontal scrolling
                  reveals more timeline detail on narrow screens.
                </p>
                <div
                  className="timeline-term-legend"
                  aria-label="Timeline terminology"
                >
                  <span>
                    Host encode{" "}
                    <DefinitionTrigger term="host-encode" label="Host encode" />
                  </span>
                  <span>
                    GPU execute{" "}
                    <DefinitionTrigger term="gpu-execute" label="GPU execute" />
                  </span>
                  <span>
                    Waits{" "}
                    <DefinitionTrigger
                      term="wait-taxonomy"
                      label="Wait taxonomy"
                    />
                  </span>
                  <span>
                    Dispatch order{" "}
                    <DefinitionTrigger term="dispatch" label="Dispatch" />
                  </span>
                  <span>
                    Dispatch density{" "}
                    <DefinitionTrigger
                      term="dispatch-density"
                      label="Dispatch density"
                    />
                  </span>
                </div>
                <div id="timeline-viewport" className="timeline-viewport">
                  <div
                    id="timeline-scroller"
                    className="timeline-scroller"
                    role="region"
                    aria-label="Scrollable dispatch timeline"
                    aria-describedby="timeline-scroll-label timeline-description"
                    tabIndex="0"
                  >
                    <div id="plot-frame" className="plot-frame is-loading">
                      <canvas
                        id="timeline"
                        width="1120"
                        height="396"
                        tabIndex="-1"
                        role="img"
                        aria-label="Dispatch overlap timeline"
                        aria-describedby="timeline-description"
                        aria-disabled="true"
                        data-ready-control
                      >
                        Your browser does not support canvas. The selected trace
                        metrics, kernel census, and wait taxonomy remain
                        available in the tables below.
                      </canvas>
                      <div
                        id="timeline-placeholder"
                        className="timeline-placeholder"
                        aria-hidden="true"
                      >
                        <div className="placeholder-lane lane-ruler">
                          <span>Ruler</span>
                        </div>
                        <div className="placeholder-lane lane-host">
                          <span>Host encode</span>
                        </div>
                        <div className="placeholder-lane lane-gpu">
                          <span>GPU execute</span>
                        </div>
                        <div className="placeholder-lane lane-waits">
                          <span>Waits</span>
                        </div>
                        <div className="placeholder-lane lane-dispatch">
                          <span>Dispatch order</span>
                        </div>
                        <div className="placeholder-lane lane-footer">
                          <span>Footer</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <section
                    id="loading-state"
                    className="state-region loading-state"
                    aria-label="Trace loading progress"
                  >
                    <div className="timeline-loading-visual" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </div>
                    <div>
                      <strong>Preparing timeline</strong>
                      <span id="loading-filename">
                        Waiting for a trace selection
                      </span>
                    </div>
                    <div className="progress-readout">
                      <span
                        id="loading-progress-label"
                        className="visually-hidden"
                      >
                        Trace read progress
                      </span>
                      <Progress
                        id="loading-progress"
                        value={loadingProgress.value}
                        aria-labelledby="loading-progress-label"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-valuenow={loadingProgress.value}
                        aria-valuetext={loadingProgress.text}
                      />
                      <p id="loading-readout" className="mono">
                        0 bytes read · 0 rows parsed
                      </p>
                    </div>
                  </section>
                </div>

                <section
                  id="range-navigator"
                  className="range-navigator"
                  aria-labelledby="range-heading"
                  hidden
                >
                  <div className="range-toolbar">
                    <div>
                      <p className="eyebrow">Time window</p>
                      <h3 id="range-heading">Launch overview</h3>
                    </div>
                    <ToggleGroup
                      className="range-mode"
                      type="single"
                      value={rangeModeState.value}
                      onValueChange={(value) => {
                        if (value) rangeModeSelectionHandler.current(value);
                      }}
                      aria-label="Time window behavior"
                    >
                      <ToggleGroupItem
                        id="range-mode-view"
                        className="range-mode-button"
                        value="view"
                      >
                        View
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        id="range-mode-analyze"
                        className="range-mode-button"
                        value="analyze"
                        disabled={rangeModeState.analyzeDisabled}
                      >
                        {rangeModeState.analyzeLabel}
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  <div className="range-overview-frame">
                    <canvas
                      id="range-overview"
                      width="1120"
                      height="58"
                      role="img"
                      aria-label="Full-launch host, GPU, dispatch, and wait navigation summary"
                      aria-describedby="range-overview-summary"
                    >
                      The time-window sliders below remain available when the
                      navigation summary cannot be drawn.
                    </canvas>
                    <div
                      id="range-band"
                      className="range-band"
                      aria-disabled="false"
                    >
                      <span
                        id="range-start-handle"
                        className="range-handle range-handle-start"
                        role="slider"
                        tabIndex="0"
                        aria-label="Range start"
                      />
                      <span
                        id="range-end-handle"
                        className="range-handle range-handle-end"
                        role="slider"
                        tabIndex="0"
                        aria-label="Range end"
                      />
                    </div>
                  </div>
                  <p id="range-overview-summary" className="visually-hidden">
                    The overview is a navigation summary, not
                    measurement-resolution events.
                  </p>
                  <div className="range-readouts">
                    <output id="range-start-readout">Start —</output>
                    <output id="range-end-readout">End —</output>
                    <output id="range-duration-readout">Duration —</output>
                    <span id="range-status" role="status" aria-live="polite">
                      Complete launch selected
                    </span>
                  </div>
                  <p
                    id="range-omissions"
                    className="range-omissions"
                    role="note"
                    hidden
                  />
                </section>
                <p id="timeline-description" className="timeline-description">
                  Six coupled lanes show the ruler, host encoding, GPU
                  execution, waits, dispatch order, and scale. Dispatch marks
                  use{" "}
                  <span className="term-label">
                    ordered placement{" "}
                    <DefinitionTrigger
                      term="ordered-placement"
                      label="Ordered placement"
                    />
                  </span>{" "}
                  within each command buffer; they are not measured
                  per-operation timestamps. With the canvas focused, [ and ]
                  move to the previous and next mark; Enter pins the active
                  mark.
                </p>
                <p
                  id="timeline-sampling-note"
                  className="timeline-sampling-note"
                  role="note"
                  hidden
                />

                <section id="empty-state" className="state-region" hidden>
                  <h3>No trace files found</h3>
                  <p>
                    Add a <code>.jsonl</code> or <code>.ndjson</code> profiler
                    capture to the configured directory, then refresh.
                  </p>
                </section>
                <section
                  id="error-state"
                  className="state-region state-error"
                  role="alert"
                  hidden
                >
                  <h3>Trace unavailable</h3>
                  <p>
                    The selected file could not be read. Its timeline remains
                    empty; no sample data has been substituted.
                  </p>
                </section>
              </figure>

              <Tabs
                id="analysis-tables"
                className="tables-grid"
                value={tableTab}
                onValueChange={(value) =>
                  tableTabSelectionHandler.current(value)
                }
              >
                <TabsList id="analysis-table-tabs" aria-label="Analysis tables">
                  <TabsTrigger id="kernel-tab" value="kernel">
                    Kernel families
                  </TabsTrigger>
                  <TabsTrigger id="wait-tab" value="wait">
                    Wait taxonomy
                  </TabsTrigger>
                </TabsList>
                <TabsContent asChild forceMount value="kernel">
                  <section
                    id="kernel-panel"
                    className="data-section"
                    aria-labelledby="kernel-tab"
                    hidden={tableTab !== "kernel"}
                  >
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">Dispatch census</p>
                        <h2 id="kernel-heading">
                          Kernel families{" "}
                          <DefinitionTrigger
                            term="kernel-family"
                            label="Kernel family"
                          />
                        </h2>
                      </div>
                      <span id="kernel-table-state" className="table-state">
                        Awaiting rows
                      </span>
                    </div>
                    <div
                      id="kernel-table-scroller"
                      className="table-scroller"
                      tabIndex="0"
                      role="region"
                      aria-label="Scrollable kernel census"
                    >
                      <p
                        id="kernel-scroll-hint"
                        className="table-scroll-hint"
                        role="note"
                        hidden
                      >
                        Scroll horizontally for more columns →
                      </p>
                      <Table id="kernel-table">
                        <TableCaption>
                          Kernel dispatch counts, setBytes activity, and buffer
                          binds
                        </TableCaption>
                        <TableHeader>
                          <TableRow>
                            <SortableHeader
                              id="kernel-sort-kernel"
                              label="Kernel family"
                            />
                            <SortableHeader
                              id="kernel-sort-count"
                              label="Dispatches"
                            />
                            <SortableHeader
                              id="kernel-sort-setbytes-calls"
                              label="setBytes calls"
                              term="setbytes-call"
                            />
                            <SortableHeader
                              id="kernel-sort-setbytes-bytes"
                              label="setBytes bytes"
                              term="setbytes-bytes"
                            />
                            <SortableHeader
                              id="kernel-sort-buffer-binds"
                              label="Buffer binds"
                              term="buffer-bind"
                            />
                          </TableRow>
                        </TableHeader>
                        <TableBody id="kernel-table-body">
                          <TableRow className="placeholder-row">
                            <TableHead scope="row">No parsed kernels</TableHead>
                            <TableCell>—</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>—</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                </TabsContent>

                <TabsContent asChild forceMount value="wait">
                  <section
                    id="wait-panel"
                    className="data-section"
                    aria-labelledby="wait-tab"
                    hidden={tableTab !== "wait"}
                  >
                    <div className="section-heading">
                      <div>
                        <p className="eyebrow">Synchronization cost</p>
                        <h2 id="wait-heading">
                          Wait taxonomy{" "}
                          <DefinitionTrigger
                            term="wait-taxonomy"
                            label="Wait taxonomy"
                          />
                        </h2>
                      </div>
                      <span id="wait-table-state" className="table-state">
                        Awaiting rows
                      </span>
                    </div>
                    <section
                      id="source-summary-panel"
                      className="source-summary-panel"
                      aria-labelledby="source-summary-heading"
                      role="region"
                      hidden
                    >
                      <div className="source-summary-heading">
                        <div>
                          <p className="eyebrow">Profiler rollup</p>
                          <h3 id="source-summary-heading">Capture summary</h3>
                        </div>
                        <span
                          id="source-summary-state"
                          className="table-state"
                        >
                          Awaiting summary
                        </span>
                      </div>
                      <dl className="source-summary-metrics">
                        <div>
                          <dt>ops_total</dt>
                          <dd id="summary-ops-total">—</dd>
                        </div>
                        <div>
                          <dt>cbs_total</dt>
                          <dd id="summary-cbs-total">—</dd>
                        </div>
                        <div>
                          <dt>dropped_rows</dt>
                          <dd id="summary-dropped-rows">—</dd>
                        </div>
                        <div>
                          <dt>complete</dt>
                          <dd id="summary-complete">—</dd>
                        </div>
                      </dl>
                      <div className="table-scroller">
                        <Table id="summary-bucket-table">
                          <TableCaption>
                            Selected profiler summary wait buckets
                          </TableCaption>
                          <TableHeader>
                            <TableRow>
                              <TableHead scope="col">Wait bucket</TableHead>
                              <TableHead scope="col">Count</TableHead>
                              <TableHead scope="col">total_ns</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody id="summary-bucket-body">
                            <TableRow className="placeholder-row">
                              <TableHead scope="row">
                                No summary buckets
                              </TableHead>
                              <TableCell>—</TableCell>
                              <TableCell>—</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>
                    </section>
                    <div
                      id="wait-table-scroller"
                      className="table-scroller"
                      tabIndex="0"
                      role="region"
                      aria-label="Scrollable wait taxonomy"
                    >
                      <p
                        id="wait-scroll-hint"
                        className="table-scroll-hint"
                        role="note"
                        hidden
                      >
                        Scroll horizontally for more columns →
                      </p>
                      <Table id="wait-table">
                        <TableCaption>
                          Wait causes, counts, and measured duration
                        </TableCaption>
                        <TableHeader>
                          <TableRow>
                            <SortableHeader
                              id="wait-sort-bucket"
                              label="Wait cause"
                            />
                            <SortableHeader
                              id="wait-sort-count"
                              label="Events"
                            />
                            <SortableHeader
                              id="wait-sort-duration"
                              label="Duration"
                            />
                            <SortableHeader
                              id="wait-sort-evidence"
                              label="Evidence"
                            />
                          </TableRow>
                        </TableHeader>
                        <TableBody id="wait-table-body">
                          <TableRow className="placeholder-row">
                            <TableHead scope="row">No parsed waits</TableHead>
                            <TableCell>—</TableCell>
                            <TableCell>—</TableCell>
                            <TableCell>—</TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                </TabsContent>
              </Tabs>
            </div>

            <aside
              id="inspector"
              className="inspector"
              aria-labelledby="inspector-heading"
            >
              <div className="inspector-heading">
                <div>
                  <p className="eyebrow">Pinned detail</p>
                  <h2 id="inspector-heading">Inspector</h2>
                </div>
                <Button id="clear-selection" type="button" disabled>
                  Clear
                </Button>
              </div>
              <div id="inspector-body">
                <p className="inspector-empty">
                  Select a command buffer or dispatch to connect host, GPU,
                  wait, and kernel evidence.
                </p>
                <dl className="inspector-readout">
                  <div>
                    <dt>Selection</dt>
                    <dd>None</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>—</dd>
                  </div>
                  <div>
                    <dt>Time basis</dt>
                    <dd>—</dd>
                  </div>
                </dl>
                <p className="inspector-note">
                  Values are labeled as{" "}
                  <span className="term-label">
                    measured{" "}
                    <DefinitionTrigger
                      term="measured"
                      label="Measured evidence"
                    />
                  </span>
                  , derived, ordered, or metadata when available.
                </p>
              </div>
            </aside>
          </div>

          <footer className="disclosure">
            <p>
              Evidence note: dispatch marks are{" "}
              <strong>ordered placement</strong>{" "}
              <DefinitionTrigger
                term="ordered-placement"
                label="Ordered placement"
              />{" "}
              within their parent command buffer, not measured timestamps.
            </p>
            <div className="disclosure-meta">
              <p>Local read-only workbench · source files are never modified</p>
              <nav
                className="source-repositories"
                aria-label="Source repositories"
              >
                <span>Source</span>
                <a
                  className="source-repository-link"
                  href="https://github.com/OpenSourceWTF/metal-dispatch-viz"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the Metal Dispatch Visualizer repository on GitHub; opens in a new tab"
                >
                  Visualizer <span aria-hidden="true">↗</span>
                </a>
                <a
                  className="source-repository-link"
                  href="https://github.com/OpenSourceWTF/mlx-profiler"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open the MLX Profiler repository on GitHub; opens in a new tab"
                >
                  Profiler <span aria-hidden="true">↗</span>
                </a>
              </nav>
            </div>
          </footer>
        </div>
      </main>

      <Sheet
        modal={false}
        open={helpOpen}
        onOpenChange={(open) => helpOpenChangeHandler.current(open)}
      >
        <SheetContent
          id="field-manual-drawer"
          className="field-manual-sheet"
          aria-labelledby="field-manual-heading"
          aria-modal="true"
          forceMount
          showCloseButton={false}
        >
          <SheetHeader className="field-manual-sheet-header">
            <div>
              <p className="eyebrow">Reference / local</p>
              <SheetTitle id="field-manual-heading">Field manual</SheetTitle>
            </div>
            <Button
              id="field-manual-close"
              type="button"
              aria-label="Close Field manual"
            >
              Close
            </Button>
          </SheetHeader>
          <div className="manual-search-control">
            <label htmlFor="manual-search">Search glossary</label>
            <Input
              id="manual-search"
              type="search"
              autoComplete="off"
              placeholder="Term, method, or limitation"
            />
            <output
              id="manual-search-status"
              className="manual-search-status"
              aria-live="polite"
            />
          </div>
          <div id="manual-content" className="manual-content" tabIndex="-1">
            <section
              id="manual-quick-start"
              className="manual-section"
              tabIndex="-1"
              aria-labelledby="manual-quick-start-heading"
            >
              <p className="manual-index">01 / OPERATE</p>
              <h3 id="manual-quick-start-heading">Quick start</h3>
              <ol>
                <li>
                  Search runs from the top dropdown, select a match, then choose
                  a launch when more than one is present.
                </li>
                <li>
                  In View, drag the range band or either handle. On the main
                  timeline, drag to zoom and Shift-drag to pan.
                </li>
                <li>
                  Switch to Analyze when you need exact metrics and tables for
                  the selected range instead of launch totals.
                </li>
                <li>
                  Select a command buffer, dispatch, density bin, or wait to
                  inspect linked evidence.
                </li>
                <li>
                  Switch between Kernel families and Wait taxonomy tabs;
                  activate any column heading to sort ascending or descending.
                </li>
                <li>
                  Use Export for AI when available to package only the visible
                  range; help never sends trace data anywhere.
                </li>
              </ol>
            </section>
            <section
              className="manual-section"
              aria-labelledby="manual-timeline-heading"
            >
              <p className="manual-index">02 / READ</p>
              <h3 id="manual-timeline-heading">Read the timeline</h3>
              <p>
                The ruler anchors the visible time range. Host encode and GPU
                execute lanes show measured command-buffer intervals. Wait marks
                show producer-reported synchronization. Dispatch marks preserve
                sequence through ordered placement; density mode groups those
                placements when individual marks would be too dense.
              </p>
            </section>
            <section
              className="manual-section"
              aria-labelledby="manual-measurements-heading"
            >
              <p className="manual-index">03 / MEASURE</p>
              <h3 id="manual-measurements-heading">Measurements</h3>
              <p>
                Headline metrics pair a value with its evidence basis. Measured
                endpoints, interval-derived unions and intersections, recorded
                waits, and counts answer different questions and must not be
                added together by default.
              </p>
            </section>
            <section
              className="manual-section manual-glossary"
              aria-labelledby="manual-glossary-heading"
            >
              <p className="manual-index">04 / DEFINE</p>
              <h3 id="manual-glossary-heading">Glossary</h3>
              <div id="manual-glossary-list" className="manual-glossary-list" />
            </section>
            <section
              className="manual-section"
              aria-labelledby="manual-evidence-heading"
            >
              <p className="manual-index">05 / LIMITS</p>
              <h3 id="manual-evidence-heading">Evidence limits</h3>
              <ul>
                <li>
                  Canvas sampling changes visible marks, never the exact
                  headline metrics or tables.
                </li>
                <li>
                  Malformed, unsupported, dropped, or legacy rows remain
                  disclosed and can limit completeness.
                </li>
                <li>
                  Ordered dispatch placement is not a measured per-operation
                  timestamp or duration.
                </li>
                <li>
                  Scheduler detail is non-additive, and wait totals do not
                  establish a critical path.
                </li>
                <li>
                  Schema v1 does not record tensor producer or consumer
                  identities, so it cannot prove tensor dependency paths.
                </li>
              </ul>
            </section>
            <section
              className="manual-section"
              aria-labelledby="manual-keyboard-heading"
            >
              <p className="manual-index">06 / KEYS</p>
              <h3 id="manual-keyboard-heading">Keyboard controls</h3>
              <dl className="shortcut-grid">
                <div>
                  <dt>Run results</dt>
                  <dd>↑ / ↓ / Enter</dd>
                </div>
                <div>
                  <dt>Range handles</dt>
                  <dd>Arrow keys</dd>
                </div>
                <div>
                  <dt>Range zoom</dt>
                  <dd>Drag</dd>
                </div>
                <div>
                  <dt>Pan</dt>
                  <dd>Shift-drag</dd>
                </div>
                <div>
                  <dt>Zoom</dt>
                  <dd>+ / −</dd>
                </div>
                <div>
                  <dt>Reset range</dt>
                  <dd>Fit</dd>
                </div>
                <div>
                  <dt>Marks</dt>
                  <dd>[ / ]</dd>
                </div>
                <div>
                  <dt>Pin mark</dt>
                  <dd>Enter</dd>
                </div>
                <div>
                  <dt>Dismiss help</dt>
                  <dd>Escape</dd>
                </div>
              </dl>
            </section>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet
        modal={false}
        open={exportOpen}
        onOpenChange={(open) => exportOpenChangeHandler.current(open)}
      >
        <SheetContent
          id="ai-export-drawer"
          className="ai-export-sheet"
          aria-labelledby="ai-export-heading"
          aria-modal="true"
          forceMount
          showCloseButton={false}
        >
          <SheetHeader className="ai-export-sheet-header">
            <div>
              <p className="eyebrow">Visible evidence / local</p>
              <SheetTitle id="ai-export-heading">Export for AI</SheetTitle>
            </div>
            <Button
              id="ai-export-close"
              type="button"
              aria-label="Close AI export"
            >
              Close
            </Button>
          </SheetHeader>
          <div className="ai-export-controls">
            <span id="ai-export-format-label">Format</span>
            <Select
              value={exportFormatValue}
              onValueChange={(value) => {
                setExportFormatValue(value);
                exportFormatSelectionHandler.current(value);
              }}
            >
              <SelectTrigger
                id="ai-export-format"
                aria-labelledby="ai-export-format-label"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="markdown">Prompt + data (.md)</SelectItem>
                <SelectItem value="json">Structured data (.json)</SelectItem>
              </SelectContent>
            </Select>
            <Button id="ai-export-refresh" type="button">
              Refresh snapshot
            </Button>
          </div>
          <section
            className="ai-export-scope"
            aria-labelledby="ai-export-scope-heading"
          >
            <p id="ai-export-scope-heading" className="manual-index">
              EXPORT SCOPE
            </p>
            <output id="ai-export-scope">No visible range captured.</output>
            <p className="local-only-notice">
              Generated locally from the selected launch and visible timeline
              range. Nothing is uploaded and no model is called.
            </p>
          </section>
          <div className="ai-export-preview-wrap">
            <label htmlFor="ai-export-preview">Read-only export preview</label>
            <Textarea id="ai-export-preview" readOnly spellCheck="false" />
          </div>
          <div className="ai-export-actions">
            <Button id="copy-export" type="button">
              Copy export
            </Button>
            <Button id="download-export" type="button">
              Download
            </Button>
          </div>
          <output
            id="ai-export-status"
            className="ai-export-status"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          />
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
