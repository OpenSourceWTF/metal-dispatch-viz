import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateKernelRows,
  aggregateWaitRows,
  chooseRefreshTraceId,
  chooseTraceId,
  chooseWindowIndex,
  evidenceBadges,
  metricRows,
  publishIfCurrent,
  selectionUrl,
  traceLabel,
} from "../public/app.js";

const publicHtmlUrl = new URL("../public/index.html", import.meta.url);
const publicCssUrl = new URL("../public/styles.css", import.meta.url);
const publicAppUrl = new URL("../public/app.js", import.meta.url);
const legacyHtmlUrl = new URL("../index.html", import.meta.url);

const voidElements = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

function parseHtmlStartTags(source) {
  const nodes = [];
  const stack = [];
  const tokenPattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?([A-Za-z][\w:-]*)(?:\s[^<>]*?)?>/g;

  for (const match of source.matchAll(tokenPattern)) {
    const raw = match[0];
    if (!match[1]) {
      continue;
    }

    const name = match[1].toLowerCase();
    if (raw.startsWith("</")) {
      while (stack.length > 0) {
        if (stack.pop().name === name) {
          break;
        }
      }
      continue;
    }

    const attributeText = raw.slice(
      1 + match[1].length,
      raw.length - (raw.endsWith("/>") ? 2 : 1),
    );
    const attributes = new Map();
    const attributePattern =
      /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const attribute of attributeText.matchAll(attributePattern)) {
      attributes.set(
        attribute[1].toLowerCase(),
        attribute[2] ?? attribute[3] ?? attribute[4] ?? true,
      );
    }

    const parent = stack.at(-1) ?? null;
    const node = { name, attributes, parent };
    nodes.push(node);
    if (!raw.endsWith("/>") && !voidElements.has(name)) {
      stack.push(node);
    }
  }
  return nodes;
}

function hasClass(node, className) {
  return String(node.attributes.get("class") ?? "").split(/\s+/).includes(className);
}

function isDescendantOf(node, ancestor) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent === ancestor) {
      return true;
    }
  }
  return false;
}

function stripCssComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseDeclarations(block) {
  const declarations = new Map();
  for (const declaration of block.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) {
      continue;
    }
    declarations.set(
      declaration.slice(0, colon).trim(),
      declaration.slice(colon + 1).trim(),
    );
  }
  return declarations;
}

function parseFlatCssRules(source) {
  const rules = [];
  for (const match of stripCssComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      .split(",")
      .map((selector) => selector.trim())
      .filter((selector) => selector && !selector.startsWith("@"));
    if (selectors.length > 0) {
      rules.push({ selectors, declarations: parseDeclarations(match[2]) });
    }
  }
  return rules;
}

function declarationsFor(rules, selector) {
  return rules
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.declarations);
}

function requireDeclarationRule(rules, selector, description) {
  const matches = declarationsFor(rules, selector);
  assert.ok(matches.length > 0, description ?? `CSS rule for ${selector}`);
  return matches;
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

test("workbench shell has real landmark topology, unique IDs, and safe initial controls", async () => {
  const html = await readFile(publicHtmlUrl, "utf8");
  const nodes = parseHtmlStartTags(html);
  const byId = new Map();

  for (const node of nodes) {
    const id = node.attributes.get("id");
    if (typeof id === "string") {
      assert.equal(byId.has(id), false, `#${id} must be unique`);
      byId.set(id, node);
    }
  }

  const mainNodes = nodes.filter((node) => node.name === "main");
  assert.equal(mainNodes.length, 1, "exactly one main landmark");
  const main = mainNodes[0];
  assert.equal(nodes.filter((node) => node.name === "header").length, 1);
  for (const landmark of ["nav", "figure", "aside", "footer"]) {
    const matches = nodes.filter((node) => node.name === landmark);
    assert.ok(matches.length > 0, `${landmark} landmark`);
    assert.ok(matches.every((node) => isDescendantOf(node, main)), `${landmark} belongs to main`);
  }

  for (const id of [
    "directory-identity",
    "refresh-button",
    "theme-toggle",
    "trace-rail",
    "trace-status",
    "provenance-strip",
    "health-strip",
    "evidence-badge",
    "window-select",
    "metric-scope-label",
    "metric-grid",
    "timeline",
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
    "timeline-sampling-note",
    "timeline-viewport",
    "timeline-scroller",
    "loading-state",
    "loading-progress",
    "loading-readout",
    "empty-state",
    "error-state",
    "inspector",
    "kernel-table",
    "kernel-table-body",
    "wait-table",
    "wait-table-body",
  ]) {
    assert.ok(byId.has(id), `#${id}`);
  }

  const labels = nodes.filter((node) => node.name === "label");
  for (const targetId of ["window-select", "loading-progress"]) {
    const label = labels.find((node) => node.attributes.get("for") === targetId);
    assert.ok(label, `explicit label for #${targetId}`);
    assert.ok(byId.has(targetId), `label target #${targetId} exists`);
  }

  const status = byId.get("trace-status");
  assert.equal(status.attributes.get("role"), "status");
  assert.equal(status.attributes.get("aria-live"), "polite");
  assert.equal(status.attributes.get("aria-atomic"), "true");

  const metricGrid = byId.get("metric-grid");
  assert.equal(metricGrid.name, "dl");
  const windowSelect = byId.get("window-select");
  assert.equal(windowSelect.name, "select");
  assert.equal(windowSelect.attributes.get("disabled"), true);

  for (const id of ["refresh-button", "theme-toggle"]) {
    const control = byId.get(id);
    assert.equal(control.name, "button");
    assert.equal(control.attributes.get("disabled"), true, `#${id} starts inert`);
    assert.equal(control.attributes.get("data-ready-control"), true, `#${id} has enable hook`);
  }

  const canvas = byId.get("timeline");
  assert.equal(canvas.name, "canvas");
  assert.equal(canvas.attributes.get("aria-label"), "Dispatch overlap timeline");
  assert.equal(canvas.attributes.get("tabindex"), "-1", "canvas is not focusable before handlers");
  assert.equal(canvas.attributes.get("aria-disabled"), "true");
  assert.equal(canvas.attributes.get("data-ready-control"), true);
  assert.ok(
    String(canvas.attributes.get("aria-describedby")).split(/\s+/).includes("timeline-description"),
  );
  assert.equal(byId.get("timeline-scroller").attributes.get("tabindex"), "0");

  const overview = byId.get("range-overview");
  assert.equal(overview.name, "canvas");
  assert.equal(overview.attributes.get("role"), "img");
  assert.ok(
    String(overview.attributes.get("aria-describedby"))
      .split(/\s+/)
      .includes("range-overview-summary"),
  );
  for (const id of ["range-start-handle", "range-end-handle"]) {
    assert.equal(byId.get(id).attributes.get("role"), "slider");
    assert.equal(byId.get(id).attributes.get("tabindex"), "0");
  }
  for (const id of ["range-mode-view", "range-mode-analyze"]) {
    assert.equal(byId.get(id).name, "button");
    assert.ok(byId.get(id).attributes.has("aria-pressed"));
  }
  assert.equal(byId.get("range-mode-analyze").attributes.get("disabled"), true);

  assert.equal(byId.get("kernel-table-body").name, "tbody");
  assert.equal(byId.get("wait-table-body").name, "tbody");

  const timelineViewport = byId.get("timeline-viewport");
  const timelineScroller = byId.get("timeline-scroller");
  const plotFrame = nodes.find((node) => hasClass(node, "plot-frame"));
  assert.ok(plotFrame, "plot frame exists");
  assert.ok(isDescendantOf(timelineScroller, timelineViewport), "scroller belongs to viewport");
  assert.ok(isDescendantOf(plotFrame, timelineScroller), "wide plot belongs to scroller");
  assert.ok(
    isDescendantOf(byId.get("loading-state"), timelineViewport),
    "loading progress belongs to visible viewport",
  );
  assert.equal(
    isDescendantOf(byId.get("loading-state"), plotFrame),
    false,
    "loading progress is not positioned against 720px plot content",
  );

  const scripts = nodes.filter((node) => node.name === "script");
  assert.equal(scripts.length, 1, "one external script");
  assert.equal(scripts[0].attributes.get("type"), "module");
  assert.equal(scripts[0].attributes.get("src"), "/app.js");
  assert.equal(rawInlineExecutableScriptCount(html), 0, "no inline executable scripts");
  assert.doesNotMatch(html, /\binnerHTML\b/);
  assert.match(html, /horizontal scrolling reveals more timeline detail/i);
  assert.match(html, /Your browser does not support canvas/i);
  assert.match(html, /bytes read/i);
  assert.match(html, /rows parsed/i);
  assert.match(html, /invalid or legacy evidence/i);
  assert.match(html, /ordered placement/i);
});

function rawInlineExecutableScriptCount(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(
    (match) => {
      const [tag] = parseHtmlStartTags(`<script ${match[1]}>`);
      const type = String(tag?.attributes.get("type") ?? "").toLowerCase();
      const inertType = type && !["module", "text/javascript", "application/javascript"].includes(type);
      return !tag?.attributes.has("src") && !inertType && match[2].trim().length > 0;
    },
  ).length;
}

test("visual system uses measured tokens, effective sizing, and clipped-safe focus", async () => {
  const css = await readFile(publicCssUrl, "utf8");
  const cleanCss = stripCssComments(css);
  const rules = parseFlatCssRules(cleanCss);
  const root = requireDeclarationRule(rules, ":root")[0];
  const light = requireDeclarationRule(rules, '[data-theme="light"]')[0];

  for (const [property, value] of Object.entries({
    "--canvas": "#071116",
    "--panel": "#0b181e",
    "--raised": "#10232b",
    "--rule": "#213942",
    "--text": "#edf7f8",
    "--secondary": "#91aab2",
    "--gpu": "#48d7ff",
    "--exposed-host": "#ff756d",
    "--decision-cap": "#ffc857",
    "--dependency": "#b49cff",
    "--selection": "#f5fbff",
    "--trace-rail-height": "76px",
    "--metric-band-height": "96px",
    "--inspector-width": "304px",
  })) {
    assert.equal(root.get(property)?.toLowerCase(), value);
  }

  for (const [themeName, theme] of [["dark", root], ["light", light]]) {
    for (const token of ["--control-border", "--control-fill", "--panel"]) {
      assert.match(theme.get(token) ?? "", /^#[0-9a-f]{6}$/i, `${themeName} ${token}`);
    }
    assert.ok(
      contrastRatio(theme.get("--control-border"), theme.get("--control-fill")) >= 3,
      `${themeName} control border contrasts with its fill`,
    );
    assert.ok(
      contrastRatio(theme.get("--control-border"), theme.get("--panel")) >= 3,
      `${themeName} control border contrasts with adjacent panel`,
    );
  }

  const buttonRule = requireDeclarationRule(rules, "button")[0];
  assert.equal(buttonRule.get("border"), "1px solid var(--control-border)");
  assert.equal(buttonRule.get("background"), "var(--control-fill)");
  const selectRule = requireDeclarationRule(rules, "select")[0];
  assert.equal(selectRule.get("border"), "1px solid var(--control-border)");
  assert.equal(selectRule.get("background"), "var(--control-fill)");

  const invalidBadge = requireDeclarationRule(rules, ".evidence-badge-invalid")[0];
  assert.equal(invalidBadge.get("border-style"), "dashed");
  const invalidCue = requireDeclarationRule(rules, ".evidence-badge-invalid::before")[0];
  assert.match(invalidCue.get("content") ?? "", /!/);
  const invalidRailEvidence =
    requireDeclarationRule(rules, ".trace-evidence-invalid")[0];
  assert.equal(invalidRailEvidence.get("border-style"), "dashed");

  const desktopGrid = requireDeclarationRule(rules, ".workbench-grid")[0];
  assert.equal(
    desktopGrid.get("grid-template-columns"),
    "minmax(0, 1fr) var(--inspector-width)",
  );
  const plotFrame = requireDeclarationRule(rules, ".plot-frame")[0];
  assert.match(plotFrame.get("height") ?? "", /^clamp\(360px,.+440px\)$/);
  assert.equal(plotFrame.get("min-width"), "720px");
  const canvasRules = requireDeclarationRule(rules, "#timeline");
  assert.ok(canvasRules.some((rule) => rule.get("min-width") === "720px"));

  const launchSelect = requireDeclarationRule(rules, ".window-control select")[0];
  assert.equal(launchSelect.get("height"), "44px");
  assert.equal(launchSelect.get("min-block-size"), "44px");

  const loadingState = requireDeclarationRule(rules, ".loading-state")[0];
  assert.equal(loadingState.get("position"), "absolute");
  const timelineViewport = requireDeclarationRule(rules, ".timeline-viewport")[0];
  assert.equal(timelineViewport.get("position"), "relative");

  const narrowLoadingState = requireDeclarationRule(rules, ".loading-state").find(
    (rule) => rule.get("left") === "8px",
  );
  assert.ok(narrowLoadingState, "narrow loader uses a viewport-edge inset");
  assert.equal(narrowLoadingState.get("width"), "calc(100% - 16px)");
  assert.equal(narrowLoadingState.get("transform"), "translateY(-50%)");
  const narrowBox = computeInsetBox(320, narrowLoadingState);
  assert.deepEqual(narrowBox, { left: 8, width: 304, right: 312 });
  assert.ok(narrowBox.right <= 320, "320px loader is fully visible without horizontal scroll");

  const rangeHandle = requireDeclarationRule(rules, ".range-handle")[0];
  assert.ok(Number.parseFloat(rangeHandle.get("min-width")) >= 44);
  assert.ok(Number.parseFloat(rangeHandle.get("min-height")) >= 44);
  assert.equal(rangeHandle.get("touch-action"), "none");
  requireDeclarationRule(rules, ".range-band");
  requireDeclarationRule(rules, '.range-mode-button[aria-pressed="true"]');

  for (const selector of [
    ".trace-toggle:focus-visible",
    ".timeline-scroller:focus-visible",
    "#timeline:focus-visible",
  ]) {
    const focusRules = requireDeclarationRule(rules, selector, `${selector} inset focus rule`);
    assert.ok(
      focusRules.some((rule) => Number.parseFloat(rule.get("outline-offset")) < 0),
      `${selector} focus ring stays inside overflow boundary`,
    );
  }

  assert.match(cleanCss, /@media\s*\(max-width:\s*980px\)/);
  assert.match(cleanCss, /@media\s*\(max-width:\s*760px\)/);
  const metricRules = requireDeclarationRule(rules, ".metric-grid");
  assert.ok(
    metricRules.some(
      (rule) => rule.get("grid-template-columns") === "repeat(2, minmax(0, 1fr))",
    ),
  );
  assert.match(cleanCss, /font-variant-numeric:\s*tabular-nums/);
  assert.match(cleanCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(cleanCss, /@media\s*\(forced-colors:\s*active\)/);
  assert.doesNotMatch(cleanCss, /linear-gradient|radial-gradient/i);
  assert.doesNotMatch(cleanCss, /transition\s*:\s*all\b/i);
  assert.doesNotMatch(cleanCss, /animation\s*:\s*[^;]*infinite/i);
  assert.doesNotMatch(cleanCss, /::first-letter|font-size:\s*0(?:[;\s}]|$)/i);
});

function computeInsetBox(viewportWidth, declarations) {
  const left = Number.parseFloat(declarations.get("left"));
  const subtraction = Number.parseFloat(
    declarations.get("width").match(/^calc\(100% - ([\d.]+)px\)$/)?.[1],
  );
  assert.ok(Number.isFinite(left) && Number.isFinite(subtraction));
  const width = viewportWidth - subtraction;
  return { left, width, right: left + width };
}

test("legacy root document is retired after the public shell exists", async () => {
  await access(publicHtmlUrl);
  await assert.rejects(access(legacyHtmlUrl), { code: "ENOENT" });
});

test("app module is safe without document and pure trace selection is deterministic", () => {
  const traces = [
    { id: "first", name: "first.jsonl" },
    { id: "second", name: "second.jsonl" },
  ];

  assert.equal(globalThis.document, undefined);
  assert.equal(chooseTraceId(traces, "second"), "second");
  assert.equal(chooseTraceId(traces, "missing"), "first");
  assert.equal(chooseTraceId([], "missing"), null);
  assert.equal(chooseTraceId(null, "missing"), null);
  assert.equal(traceLabel({ label: "Manifest label", name: "raw.jsonl" }), "Manifest label");
  assert.equal(traceLabel({ model: "Qwen", mode: "decode", name: "raw.jsonl" }), "Qwen · decode");
  assert.equal(traceLabel({ relativePath: "nested/raw.jsonl" }), "nested/raw.jsonl");
  assert.equal(
    chooseRefreshTraceId(
      [{ id: "a" }, { id: "removed" }, { id: "c" }],
      [{ id: "a" }, { id: "c" }],
      "removed",
    ),
    "c",
    "refresh chooses the nearest surviving registry position",
  );
  assert.equal(
    chooseRefreshTraceId([{ id: "a" }], [{ id: "z" }], "a"),
    "z",
  );
});

test("window, URL, metric, census, wait, and evidence helpers preserve truth labels", () => {
  assert.equal(chooseWindowIndex([{}, {}], "1"), 1);
  assert.equal(chooseWindowIndex([{}], "9"), 0);
  assert.equal(chooseWindowIndex([], "0"), null);

  const selected = selectionUrl(
    "http://127.0.0.1:4173/?debug=1&trace=old&window=7#plot",
    "opaque / id",
    2,
  );
  assert.equal(selected.searchParams.get("debug"), "1");
  assert.equal(selected.searchParams.get("trace"), "opaque / id");
  assert.equal(selected.searchParams.get("window"), "2");
  assert.equal(selected.hash, "#plot");

  const metrics = metricRows({
    summary: {
      wallSpanNs: 100,
      exposedHostNs: 20,
      hiddenHostNs: 30,
      gpuBusyNs: 40,
      gpuWorkNs: 50,
      decisionWaitNs: 6,
      capWaitNs: 7,
      dependencyWaitNs: 8,
      cbsTotal: 2,
      opsTotal: 3,
    },
  });
  assert.deepEqual(
    metrics.map(({ label, evidence }) => [label, evidence]),
    [
      ["Wall span", "measured endpoints"],
      ["Exposed host", "interval-derived"],
      ["Hidden host", "interval-derived"],
      ["GPU busy", "interval-derived union"],
      ["GPU work", "measured intervals"],
      ["Decision drain", "measured waits"],
      ["Cap wait", "measured waits"],
      ["Dependency wait", "measured waits"],
      ["Command buffers", "record count"],
      ["Dispatches", "record count"],
    ],
  );
  assert.equal(metrics.some(({ label }) => /tensor|output critical/i.test(label)), false);

  assert.deepEqual(
    aggregateKernelRows([
      { kernel: "zeta", setBytesCalls: 1, setBytesTotalBytes: 4, bufferBinds: 2 },
      { kernel: "alpha", setBytesCalls: 2, setBytesTotalBytes: 8, bufferBinds: 3 },
      { kernel: "zeta", setBytesCalls: 3, setBytesTotalBytes: 12, bufferBinds: 4 },
    ]),
    [
      { kernel: "zeta", count: 2, setBytesCalls: 4, setBytesTotalBytes: 16, bufferBinds: 6 },
      { kernel: "alpha", count: 1, setBytesCalls: 2, setBytesTotalBytes: 8, bufferBinds: 3 },
    ],
  );
  assert.deepEqual(
    aggregateWaitRows([
      { bucket: "sched_worker_wait", waitNs: 11 },
      { bucket: "cap_wait", waitNs: 3 },
      { bucket: "sched_backpressure", waitNs: 5 },
      { bucket: "cap_wait", waitNs: 7 },
    ]).map(({ bucket, count, waitNs, additive }) => ({ bucket, count, waitNs, additive })),
    [
      { bucket: "cap_wait", count: 2, waitNs: 10, additive: true },
      { bucket: "sched_backpressure", count: 1, waitNs: 5, additive: false },
      { bucket: "sched_worker_wait", count: 1, waitNs: 11, additive: false },
    ],
  );

  const badges = evidenceBadges({
    health: {
      validEvidence: false,
      sourceCompleteness: "dropped-rows",
      malformedRows: 2,
      unknownRows: 1,
      droppedRows: 4,
      countMismatches: { opsTotal: { reported: 8, analyzed: 7 } },
      duplicateCommandBufferIndices: [3],
    },
  });
  assert.ok(badges.every(({ valid }) => valid === false));
  for (const pattern of [/dropped/i, /malformed/i, /unsupported/i, /count mismatch/i, /duplicate/i]) {
    assert.ok(badges.some(({ label }) => pattern.test(label)), String(pattern));
  }

  const published = [];
  const currentToken = {};
  const staleToken = {};
  const coordinator = {
    isCurrent(token) {
      return token === currentToken;
    },
  };
  assert.equal(
    publishIfCurrent(coordinator, staleToken, () => published.push("stale")),
    false,
  );
  assert.equal(
    publishIfCurrent(coordinator, currentToken, () => published.push("current")),
    true,
  );
  assert.deepEqual(published, ["current"]);
});

test("dynamic integration source exposes secure state hooks and ordered setup", async () => {
  const [html, source] = await Promise.all([
    readFile(publicHtmlUrl, "utf8"),
    readFile(publicAppUrl, "utf8"),
  ]);

  for (const id of [
    "trace-track",
    "inspector-body",
    "kernel-table-body",
    "wait-table-body",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(source, /createElement\(["']button["']\)/);
  assert.match(source, /setAttribute\(["']aria-pressed["']/);
  assert.match(source, /URLSearchParams|searchParams/);
  assert.match(source, /searchParams\.get\(["']trace["']\)/);
  assert.match(source, /searchParams\.get\(["']window["']\)/);
  assert.match(source, /replaceState/);
  assert.match(source, /new SelectionCoordinator/);
  assert.match(source, /new TraceCache/);
  assert.match(source, /new TimelineRenderer/);
  assert.match(source, /isCurrent/);
  assert.match(
    source,
    /clearAnalysisState\(\);[\s\S]*?if \(cached\)[\s\S]*?else \{\s*renderPendingProvenance\(trace\);\s*showLoading\(trace\);/,
    "a new trace clears prior evidence before showing its loading state",
  );
  assert.match(source, /new RangeNavigator\(/);
  assert.match(source, /new RangeRequestAuthority\(/);
  assert.match(source, /analysisSessionFactory\(\{/);
  assert.match(source, /analysisSession\.analyzeRange\(\{/);
  assert.match(source, /analysisDebounceMs/);
  assert.match(source, /rangeAuthority\.isCurrent/);
  assert.match(
    source,
    /refreshRendererPalette\(\);\s*renderer\.requestRender\(\);\s*rangeNavigator\.requestRender\(\);/,
    "theme changes repaint both timeline and overview canvases",
  );
  assert.match(
    source,
    /function showEmpty\(\)[\s\S]*?renderEmptyProvenance\(\);[\s\S]*?No trace files found/,
    "an empty refresh cannot retain provenance from a removed trace",
  );
  assert.match(source, /addEventListener\(["']click["']/);
  assert.match(source, /removeAttribute\(["']disabled["']\)/);
  assert.ok(
    source.indexOf('addEventListener("click"') <
      source.indexOf('removeAttribute("disabled")'),
    "ready controls enable only after click handlers are installed",
  );
  assert.doesNotMatch(source, /\.innerHTML\b/);
  assert.doesNotMatch(source, /sample(?:Data|Trace)|fixtures\/sample/i);
});
