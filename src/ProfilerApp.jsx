import { useEffect } from "react";

import datasetWorkerUrl from "../public/dataset-worker.js?worker&url";
import { TraceAnalysisSession } from "../public/analysis-session.js";
import { bootstrap } from "../public/app.js";

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
  return (
    <button
      className="term-trigger"
      type="button"
      data-term={term}
      aria-label={`Define ${label}`}
      aria-controls="definition-tooltip"
      aria-expanded="false"
    >
      ⓘ
    </button>
  );
}

function SortableHeader({ id, label, term }) {
  return (
    <th scope="col" aria-sort="none">
      <button
        id={id}
        className="table-sort-button"
        type="button"
        aria-label={`Sort ${label}`}
      >
        <span>{label}</span>
        <span className="sort-indicator" aria-hidden="true">↕</span>
      </button>
      {term ? <DefinitionTrigger term={term} label={label} /> : null}
    </th>
  );
}

function initialMetric(
  label,
  term,
  className = "metric",
  unit = true,
) {
  return (
    <div className={className}>
      <dt>
        {label} <DefinitionTrigger term={term} label={label} />
      </dt>
      <dd>
        —
        {unit ? <span className="unit"> ms</span> : null}
      </dd>
    </div>
  );
}

export function ProfilerApp({
  bootstrapController = bootstrap,
  analysisSessionFactory = createAnalysisSession,
}) {
  useEffect(() => {
    const controllerAbort = new AbortController();
    let active = true;

    void Promise.resolve(
      bootstrapController({
        analysisSessionFactory,
        signal: controllerAbort.signal,
      }),
    ).then(
      () => {},
      (error) => {
        if (!active) return;
        const status = document.getElementById("trace-status");
        if (status) {
          const message =
            error instanceof Error ? error.message : "The workbench could not start.";
          status.textContent = `Workbench failed to start: ${message}`;
        }
      },
    );

    return () => {
      active = false;
      controllerAbort.abort();
    };
  }, [analysisSessionFactory, bootstrapController]);

  return (
    <>
      <header className="site-header">
        <div className="identity-lockup">
          <p className="wordmark" aria-hidden="true">MDV</p>
          <div>
            <h1>Metal Dispatch Workbench</h1>
            <p className="directory-line">
              Trace directory{" "}
              <code id="directory-identity">resolving local source…</code>
            </p>
          </div>
        </div>
        <div className="header-actions" aria-label="Workbench controls">
          <button
            id="field-manual-button"
            type="button"
            aria-haspopup="dialog"
            aria-controls="field-manual-drawer"
          >
            Field manual
          </button>
          <button
            id="refresh-button"
            type="button"
            aria-label="Refresh trace directory"
            data-ready-control
            disabled
          >
            Refresh
          </button>
          <button
            id="theme-toggle"
            type="button"
            aria-label="Switch color theme"
            aria-pressed="false"
            data-ready-control
            disabled
          >
            Theme
          </button>
        </div>
      </header>

      <main>
        <div className="instrument">
          <h2 className="visually-hidden">Available runs</h2>
          <nav
            id="trace-rail"
            className="trace-rail"
            aria-label="Run selector"
            aria-busy="true"
          >
            <div className="trace-dropdown">
              <span className="trace-dropdown-caption">Run</span>
              <button
                id="trace-selector-button"
                className="trace-selector-button"
                type="button"
                aria-haspopup="listbox"
                aria-controls="trace-menu"
                aria-expanded="false"
                disabled
              >
                <span id="trace-selector-label">Waiting for registry</span>
                <span className="dropdown-caret" aria-hidden="true">▾</span>
              </button>
              <div id="trace-menu" className="trace-menu" hidden>
                <label htmlFor="trace-search">Search runs</label>
                <input
                  id="trace-search"
                  type="search"
                  role="searchbox"
                  aria-controls="trace-track"
                  placeholder="Model, mode, path…"
                  autoComplete="off"
                />
                <div
                  id="trace-track"
                  className="trace-track"
                  role="listbox"
                >
                  <p className="trace-rail-empty">Scanning directory…</p>
                </div>
              </div>
            </div>
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
              <span className="provenance-item"><b>Model</b> —</span>
              <span className="provenance-item"><b>Quantization</b> —</span>
              <span className="provenance-item"><b>Mode</b> —</span>
              <span id="evidence-badges" className="evidence-badges">
                <span
                  id="evidence-badge"
                  className="evidence-badge evidence-badge-invalid"
                >
                  Invalid or legacy evidence
                </span>
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
              <label
                id="window-control"
                className="window-control"
                htmlFor="window-select"
              >
                Launch
                <select id="window-select" disabled defaultValue="waiting">
                  <option value="waiting">Waiting for launch windows</option>
                </select>
              </label>
            </div>
          </section>

          <section className="metric-band" aria-labelledby="metric-heading">
            <div className="metric-band-heading">
              <h2 id="metric-heading">Selected window decomposition</h2>
              <span id="metric-scope-label">Launch totals</span>
            </div>
            <dl id="metric-grid" className="metric-grid" aria-busy="true">
              {initialMetric("Wall span", "wall-span", "metric metric-primary")}
              {initialMetric("Exposed host", "exposed-host", "metric metric-exposed")}
              {initialMetric("Hidden host", "hidden-host", "metric metric-hidden")}
              {initialMetric("GPU busy", "gpu-busy", "metric metric-gpu")}
              {initialMetric("GPU work", "gpu-work", "metric metric-gpu")}
              {initialMetric("Decision drain", "decision-drain", "metric metric-decision")}
              {initialMetric("Cap wait", "cap-wait", "metric metric-cap")}
              {initialMetric("Dependency", "dependency-wait", "metric metric-dependency")}
              {initialMetric("Command buffers", "command-buffer", "metric", false)}
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
                    <button
                      id="ai-export-button"
                      className="ai-export-button"
                      type="button"
                      aria-haspopup="dialog"
                      aria-controls="ai-export-drawer"
                      disabled
                    >
                      Export for AI
                    </button>
                    <output id="timeline-scale" className="timeline-scale">
                      Fit · — ns/px
                    </output>
                    <button
                      id="zoom-out"
                      type="button"
                      aria-label="Zoom timeline out"
                      disabled
                    >
                      −
                    </button>
                    <button id="fit-timeline" type="button" disabled>
                      Fit
                    </button>
                    <button
                      id="zoom-in"
                      type="button"
                      aria-label="Zoom timeline in"
                      disabled
                    >
                      +
                    </button>
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
                    <DefinitionTrigger term="wait-taxonomy" label="Wait taxonomy" />
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
                        metrics, kernel census, and wait taxonomy remain available
                        in the tables below.
                      </canvas>
                      <div
                        id="timeline-placeholder"
                        className="timeline-placeholder"
                        aria-hidden="true"
                      >
                        <div className="placeholder-lane lane-ruler"><span>Ruler</span></div>
                        <div className="placeholder-lane lane-host"><span>Host encode</span></div>
                        <div className="placeholder-lane lane-gpu"><span>GPU execute</span></div>
                        <div className="placeholder-lane lane-waits"><span>Waits</span></div>
                        <div className="placeholder-lane lane-dispatch"><span>Dispatch order</span></div>
                        <div className="placeholder-lane lane-footer"><span>Footer</span></div>
                      </div>
                    </div>
                  </div>
                  <section
                    id="loading-state"
                    className="state-region loading-state"
                    aria-label="Trace loading progress"
                  >
                    <div>
                      <strong>Preparing timeline</strong>
                      <span id="loading-filename">
                        Waiting for a trace selection
                      </span>
                    </div>
                    <div className="progress-readout">
                      <label
                        className="visually-hidden"
                        htmlFor="loading-progress"
                      >
                        Trace read progress
                      </label>
                      <progress id="loading-progress" value="0" max="1">
                        0%
                      </progress>
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
                    <div
                      className="range-mode"
                      role="group"
                      aria-label="Time window behavior"
                    >
                      <button
                        id="range-mode-view"
                        className="range-mode-button"
                        type="button"
                        aria-pressed="true"
                      >
                        View
                      </button>
                      <button
                        id="range-mode-analyze"
                        className="range-mode-button"
                        type="button"
                        aria-pressed="false"
                        disabled
                      >
                        Preparing exact analysis
                      </button>
                    </div>
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
                  <p
                    id="range-overview-summary"
                    className="visually-hidden"
                  >
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
                  Six coupled lanes show the ruler, host encoding, GPU execution,
                  waits, dispatch order, and scale. Dispatch marks use{" "}
                  <span className="term-label">
                    ordered placement{" "}
                    <DefinitionTrigger
                      term="ordered-placement"
                      label="Ordered placement"
                    />
                  </span>{" "}
                  within each command buffer; they are not measured per-operation
                  timestamps. With the canvas focused, [ and ] move to the previous
                  and next mark; Enter pins the active mark.
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

              <div id="analysis-tables" className="tables-grid">
                <div
                  id="analysis-table-tabs"
                  className="analysis-table-tabs"
                  role="tablist"
                  aria-label="Analysis tables"
                >
                  <button
                    id="kernel-tab"
                    type="button"
                    role="tab"
                    aria-selected="true"
                    aria-controls="kernel-panel"
                    tabIndex="0"
                  >
                    Kernel families
                  </button>
                  <button
                    id="wait-tab"
                    type="button"
                    role="tab"
                    aria-selected="false"
                    aria-controls="wait-panel"
                    tabIndex="-1"
                  >
                    Wait taxonomy
                  </button>
                </div>
                <section
                  id="kernel-panel"
                  className="data-section"
                  role="tabpanel"
                  aria-labelledby="kernel-tab"
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
                    <table id="kernel-table">
                      <caption>
                        Kernel dispatch counts, setBytes activity, and buffer binds
                      </caption>
                      <thead>
                        <tr>
                          <SortableHeader id="kernel-sort-kernel" label="Kernel family" />
                          <SortableHeader id="kernel-sort-count" label="Dispatches" />
                          <SortableHeader id="kernel-sort-setbytes-calls" label="setBytes calls" term="setbytes-call" />
                          <SortableHeader id="kernel-sort-setbytes-bytes" label="setBytes bytes" term="setbytes-bytes" />
                          <SortableHeader id="kernel-sort-buffer-binds" label="Buffer binds" term="buffer-bind" />
                        </tr>
                      </thead>
                      <tbody id="kernel-table-body">
                        <tr className="placeholder-row">
                          <th scope="row">No parsed kernels</th>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section
                  id="wait-panel"
                  className="data-section"
                  role="tabpanel"
                  aria-labelledby="wait-tab"
                  hidden
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
                    <table id="wait-table">
                      <caption>Wait causes, counts, and measured duration</caption>
                      <thead>
                        <tr>
                          <SortableHeader id="wait-sort-bucket" label="Wait cause" />
                          <SortableHeader id="wait-sort-count" label="Events" />
                          <SortableHeader id="wait-sort-duration" label="Duration" />
                          <SortableHeader id="wait-sort-evidence" label="Evidence" />
                        </tr>
                      </thead>
                      <tbody id="wait-table-body">
                        <tr className="placeholder-row">
                          <th scope="row">No parsed waits</th>
                          <td>—</td>
                          <td>—</td>
                          <td>—</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
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
                <button id="clear-selection" type="button" disabled>
                  Clear
                </button>
              </div>
              <div id="inspector-body">
                <p className="inspector-empty">
                  Select a command buffer or dispatch to connect host, GPU, wait,
                  and kernel evidence.
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
            <p>Local read-only workbench · source files are never modified</p>
          </footer>
        </div>
      </main>

      <div id="utility-backdrop" className="utility-backdrop" hidden />

      <div
        id="field-manual-drawer"
        className="utility-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="field-manual-heading"
        aria-hidden="true"
        hidden
      >
        <div className="utility-drawer-header">
          <div>
            <p className="eyebrow">Reference / local</p>
            <h2 id="field-manual-heading">Field manual</h2>
          </div>
          <button
            id="field-manual-close"
            type="button"
            aria-label="Close Field manual"
          >
            Close
          </button>
        </div>
        <div className="manual-search-control">
          <label htmlFor="manual-search">Search glossary</label>
          <input
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
                Switch to Analyze when you need exact metrics and tables for the
                selected range instead of launch totals.
              </li>
              <li>
                Select a command buffer, dispatch, density bin, or wait to
                inspect linked evidence.
              </li>
              <li>
                Switch between Kernel families and Wait taxonomy tabs; activate
                any column heading to sort ascending or descending.
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
            <div
              id="manual-glossary-list"
              className="manual-glossary-list"
            />
          </section>
          <section
            className="manual-section"
            aria-labelledby="manual-evidence-heading"
          >
            <p className="manual-index">05 / LIMITS</p>
            <h3 id="manual-evidence-heading">Evidence limits</h3>
            <ul>
              <li>
                Canvas sampling changes visible marks, never the exact headline
                metrics or tables.
              </li>
              <li>
                Malformed, unsupported, dropped, or legacy rows remain disclosed
                and can limit completeness.
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
              <div><dt>Run results</dt><dd>↑ / ↓ / Enter</dd></div>
              <div><dt>Range handles</dt><dd>Arrow keys</dd></div>
              <div><dt>Range zoom</dt><dd>Drag</dd></div>
              <div><dt>Pan</dt><dd>Shift-drag</dd></div>
              <div><dt>Zoom</dt><dd>+ / −</dd></div>
              <div><dt>Reset range</dt><dd>Fit</dd></div>
              <div><dt>Marks</dt><dd>[ / ]</dd></div>
              <div><dt>Pin mark</dt><dd>Enter</dd></div>
              <div><dt>Dismiss help</dt><dd>Escape</dd></div>
            </dl>
          </section>
        </div>
      </div>

      <div
        id="ai-export-drawer"
        className="utility-drawer ai-export-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-export-heading"
        aria-hidden="true"
        hidden
      >
        <div className="utility-drawer-header">
          <div>
            <p className="eyebrow">Visible evidence / local</p>
            <h2 id="ai-export-heading">Export for AI</h2>
          </div>
          <button
            id="ai-export-close"
            type="button"
            aria-label="Close AI export"
          >
            Close
          </button>
        </div>
        <div className="ai-export-controls">
          <label htmlFor="ai-export-format">Format</label>
          <select id="ai-export-format" defaultValue="markdown">
            <option value="markdown">Prompt + data (.md)</option>
            <option value="json">Structured data (.json)</option>
          </select>
          <button id="ai-export-refresh" type="button">
            Refresh snapshot
          </button>
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
          <textarea
            id="ai-export-preview"
            readOnly
            spellCheck="false"
          />
        </div>
        <div className="ai-export-actions">
          <button id="copy-export" type="button">Copy export</button>
          <button id="download-export" type="button">Download</button>
        </div>
        <output
          id="ai-export-status"
          className="ai-export-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        />
      </div>

      <div
        id="definition-tooltip"
        className="definition-tooltip"
        role="tooltip"
        aria-live="polite"
        data-pinned="false"
        hidden
      >
        <div className="definition-tooltip-heading">
          <strong id="definition-tooltip-title" />
          <span
            id="definition-tooltip-evidence"
            className="evidence-tag"
            hidden
          />
        </div>
        <p id="definition-tooltip-body" />
        <p
          id="definition-tooltip-method"
          className="definition-detail"
          hidden
        />
        <p
          id="definition-tooltip-limitation"
          className="definition-limit"
          hidden
        />
      </div>

      <div
        id="definition-popover"
        className="definition-popover"
        role="dialog"
        aria-modal="false"
        aria-labelledby="definition-popover-title"
        aria-hidden="true"
        hidden
      >
        <div className="definition-popover-heading">
          <strong id="definition-popover-title" />
          <span
            id="definition-popover-evidence"
            className="evidence-tag"
            hidden
          />
        </div>
        <p id="definition-popover-body" />
        <p
          id="definition-popover-method"
          className="definition-detail"
          hidden
        />
        <p
          id="definition-popover-limitation"
          className="definition-limit"
          hidden
        />
        <div className="definition-popover-actions">
          <button id="definition-popover-close" type="button">Close</button>
          <button id="definition-popover-manual" type="button">
            Open in Field manual
          </button>
        </div>
      </div>
    </>
  );
}
