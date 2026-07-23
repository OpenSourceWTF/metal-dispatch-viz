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

function initialMetric(label, className = "metric", unit = true) {
  return (
    <div className={className}>
      <dt>{label}</dt>
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
          <h2 className="visually-hidden">Available traces</h2>
          <nav
            id="trace-rail"
            className="trace-rail"
            aria-label="Trace files"
            aria-busy="true"
          >
            <div id="trace-track" className="trace-track">
              <button
                className="trace-toggle trace-toggle-placeholder"
                type="button"
                aria-pressed="false"
                disabled
              >
                <span className="trace-name">Scanning directory</span>
                <span className="trace-model">Model: Unknown</span>
                <span className="trace-mode">Mode: Unknown</span>
                <span className="trace-badge trace-evidence-pending">
                  Not loaded
                </span>
              </button>
            </div>
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
              {initialMetric("Wall span", "metric metric-primary")}
              {initialMetric("Exposed host", "metric metric-exposed")}
              {initialMetric("Hidden host", "metric metric-hidden")}
              {initialMetric("GPU busy", "metric metric-gpu")}
              {initialMetric("GPU work", "metric metric-gpu")}
              {initialMetric("Decision drain", "metric metric-decision")}
              {initialMetric("Cap wait", "metric metric-cap")}
              {initialMetric("Dependency", "metric metric-dependency")}
              {initialMetric("Command buffers", "metric", false)}
              {initialMetric("Dispatches", "metric", false)}
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
                  Timeline viewport; horizontal scrolling reveals more timeline
                  detail on narrow screens.
                </p>
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
                  waits, dispatch order, and scale. Dispatch marks use ordered
                  placement within each command buffer; they are not measured
                  per-operation timestamps. With the canvas focused, [ and ] move
                  to the previous and next mark; Enter pins the active mark.
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
                <section
                  className="data-section"
                  aria-labelledby="kernel-heading"
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Dispatch census</p>
                      <h2 id="kernel-heading">Kernel families</h2>
                    </div>
                    <span id="kernel-table-state" className="table-state">
                      Awaiting rows
                    </span>
                  </div>
                  <div
                    className="table-scroller"
                    tabIndex="0"
                    role="region"
                    aria-label="Scrollable kernel census"
                  >
                    <table id="kernel-table">
                      <caption>
                        Kernel dispatch counts, setBytes activity, and buffer binds
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Kernel family</th>
                          <th scope="col">Dispatches</th>
                          <th scope="col">setBytes calls</th>
                          <th scope="col">setBytes bytes</th>
                          <th scope="col">Buffer binds</th>
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
                  className="data-section"
                  aria-labelledby="wait-heading"
                >
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Synchronization cost</p>
                      <h2 id="wait-heading">Wait taxonomy</h2>
                    </div>
                    <span id="wait-table-state" className="table-state">
                      Awaiting rows
                    </span>
                  </div>
                  <div
                    className="table-scroller"
                    tabIndex="0"
                    role="region"
                    aria-label="Scrollable wait taxonomy"
                  >
                    <table id="wait-table">
                      <caption>Wait causes, counts, and measured duration</caption>
                      <thead>
                        <tr>
                          <th scope="col">Wait cause</th>
                          <th scope="col">Events</th>
                          <th scope="col">Duration</th>
                          <th scope="col">Evidence</th>
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
                  Values are labeled as measured, derived, ordered, or metadata
                  when available.
                </p>
              </div>
            </aside>
          </div>

          <footer className="disclosure">
            <p>
              Evidence note: dispatch marks are{" "}
              <strong>ordered placement</strong> within their parent command
              buffer, not measured timestamps.
            </p>
            <p>Local read-only workbench · source files are never modified</p>
          </footer>
        </div>
      </main>
    </>
  );
}
