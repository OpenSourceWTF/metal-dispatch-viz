import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateKernelRows,
  aggregateWaitRows,
  captureVisibleTimelineExport,
  chooseRefreshTraceId,
  chooseTraceId,
  chooseWindowIndex,
  dismissHelpOnEscape,
  dismissPinnedDefinitionFromPointer,
  downloadExportText,
  evidenceBadges,
  filterGlossaryEntries,
  formatVisibleTimelineExport,
  guardHelpDrawerFocus,
  metricRows,
  publishIfCurrent,
  copyExportText,
  createAiExportController,
  cycleHelpDrawerFocus,
  setHelpDrawerState,
  setPinnedDefinitionState,
  selectedLaunchExportContext,
  selectionUrl,
  shouldTeardownOnPageHide,
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
    "metric-grid",
    "timeline",
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
    /clearAnalysisState\(\);\s*renderPendingProvenance\(trace\);\s*showLoading\(trace\);/,
    "a new trace clears prior evidence before showing its loading state",
  );
  assert.match(
    source,
    /function showEmpty\(\)[\s\S]*?renderEmptyProvenance\(\);[\s\S]*?No trace files found/,
    "an empty refresh cannot retain provenance from a removed trace",
  );
  assert.match(source, /addEventListener\(["']click["']/);
  assert.match(
    source,
    /if \(!shouldTeardownOnPageHide\(event\)\) return;/,
    "BFCache pagehide retains live controllers and renderer",
  );
  assert.match(source, /addEventListener\(["']pagehide["'], pagehide\)/);
  assert.doesNotMatch(
    source,
    /addEventListener\(["']pagehide["'], pagehide,\s*\{\s*once:\s*true/,
  );
  assert.match(source, /removeAttribute\(["']disabled["']\)/);
  assert.ok(
    source.indexOf('addEventListener("click"') <
      source.indexOf('removeAttribute("disabled")'),
    "ready controls enable only after click handlers are installed",
  );
  assert.doesNotMatch(source, /\.innerHTML\b/);
  assert.doesNotMatch(source, /sample(?:Data|Trace)|fixtures\/sample/i);
});

test("contextual help shell is accessible, singular, and placed with workbench controls", async () => {
  const html = await readFile(publicHtmlUrl, "utf8");
  const nodes = parseHtmlStartTags(html);
  const byId = new Map(
    nodes
      .filter((node) => typeof node.attributes.get("id") === "string")
      .map((node) => [node.attributes.get("id"), node]),
  );

  for (const id of [
    "field-manual-button",
    "utility-backdrop",
    "field-manual-drawer",
    "field-manual-close",
    "manual-search",
    "manual-content",
    "manual-glossary-list",
    "definition-tooltip",
    "definition-tooltip-title",
    "definition-tooltip-body",
    "definition-popover",
    "definition-popover-close",
    "definition-popover-manual",
  ]) {
    assert.ok(byId.has(id), `#${id}`);
  }

  const headerActions = nodes.find((node) => hasClass(node, "header-actions"));
  assert.ok(isDescendantOf(byId.get("field-manual-button"), headerActions));
  assert.equal(
    nodes.filter((node) => node.attributes.get("id") === "utility-backdrop").length,
    1,
    "one shared utility backdrop",
  );

  const drawer = byId.get("field-manual-drawer");
  assert.equal(drawer.attributes.get("role"), "dialog");
  assert.equal(drawer.attributes.get("aria-modal"), "true");
  assert.equal(drawer.attributes.get("aria-labelledby"), "field-manual-heading");
  assert.equal(drawer.attributes.get("hidden"), true);
  assert.equal(byId.get("utility-backdrop").attributes.get("hidden"), true);
  assert.equal(byId.get("definition-tooltip").attributes.get("role"), "tooltip");
  assert.equal(byId.get("definition-tooltip").attributes.get("hidden"), true);
  assert.equal(byId.get("definition-popover").attributes.get("role"), "dialog");
  assert.equal(byId.get("definition-popover").attributes.get("aria-modal"), "false");
  assert.equal(byId.get("definition-popover").attributes.get("hidden"), true);
  assert.equal(
    nodes.some(
      (node) =>
        node.name === "button" &&
        isDescendantOf(node, byId.get("definition-tooltip")),
    ),
    false,
    "role=tooltip remains noninteractive",
  );

  const manualSearch = byId.get("manual-search");
  assert.equal(manualSearch.name, "input");
  assert.equal(manualSearch.attributes.get("type"), "search");
  assert.ok(
    nodes.some(
      (node) =>
        node.name === "label" &&
        node.attributes.get("for") === "manual-search",
    ),
    "manual search has an explicit label",
  );

  for (const node of nodes.filter((node) => hasClass(node, "term-trigger"))) {
    assert.equal(node.name, "button");
    assert.equal(node.attributes.get("type"), "button");
    assert.match(String(node.attributes.get("aria-label") ?? ""), /define/i);
    assert.ok(node.attributes.get("data-term"), "term trigger has a stable glossary id");
  }
  assert.ok(
    nodes.filter((node) => hasClass(node, "term-trigger")).length >= 12,
    "initial shell exposes contextual definitions for specialized labels",
  );
  for (const termId of [
    "host-encode",
    "gpu-execute",
    "wait-taxonomy",
    "dispatch",
    "dispatch-density",
  ]) {
    assert.ok(
      nodes.some(
        (node) =>
          hasClass(node, "term-trigger") &&
          node.attributes.get("data-term") === termId,
      ),
      `timeline help trigger for ${termId}`,
    );
  }

  for (const heading of [
    /Quick start/i,
    /Read the timeline/i,
    /Measurements/i,
    /Glossary/i,
    /Evidence limits/i,
    /Keyboard controls/i,
  ]) {
    assert.match(html, heading);
  }
});

test("help styling preserves dense targets and responsive utility-drawer behavior", async () => {
  const css = await readFile(publicCssUrl, "utf8");
  const cleanCss = stripCssComments(css);
  const rules = parseFlatCssRules(cleanCss);

  const trigger = requireDeclarationRule(rules, ".term-trigger")[0];
  assert.equal(trigger.get("min-width"), "44px");
  assert.equal(trigger.get("min-block-size"), "44px");

  const drawer = requireDeclarationRule(rules, ".utility-drawer")[0];
  assert.equal(drawer.get("position"), "fixed");
  assert.equal(drawer.get("right"), "0");
  assert.match(drawer.get("width") ?? "", /min\(/);
  assert.equal(drawer.get("display"), "flex");
  assert.equal(drawer.get("flex-direction"), "column");
  const manualContent = requireDeclarationRule(rules, ".manual-content")[0];
  assert.equal(manualContent.get("flex"), "1");
  assert.equal(manualContent.get("min-height"), "0");
  assert.equal(manualContent.get("overflow-y"), "auto");
  assert.equal(manualContent.has("height"), false);

  const hidden = requireDeclarationRule(
    rules,
    "[hidden]",
    "author CSS must preserve native hidden state against component display rules",
  )[0];
  assert.equal(hidden.get("display"), "none !important");

  const mobileDrawer = requireDeclarationRule(rules, ".utility-drawer").find(
    (rule) => rule.get("width") === "100%",
  );
  assert.ok(mobileDrawer, "narrow utility drawer becomes a full-width sheet");
  assert.equal(mobileDrawer.get("height"), "100dvh");
  assert.match(cleanCss, /@media\s*\(max-width:\s*760px\)/);
  assert.match(cleanCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);

  const tooltip = requireDeclarationRule(rules, ".definition-tooltip")[0];
  assert.equal(tooltip.get("position"), "fixed");
  assert.equal(tooltip.get("z-index"), "30");
  assert.match(cleanCss, /\.manual-entry:focus-visible/);
});

test("help helpers filter shared definitions, dismiss in priority order, and restore focus", () => {
  assert.equal(filterGlossaryEntries("GPU BUSY")[0].id, "gpu-busy");
  assert.ok(
    filterGlossaryEntries("per-dispatch timing").some(
      (entry) => entry.id === "ordered-placement",
    ),
  );

  const calls = [];
  const pinnedEvent = { key: "Escape", preventDefault() { calls.push("prevent"); } };
  assert.equal(
    dismissHelpOnEscape(pinnedEvent, {
      drawerOpen: true,
      tooltipPinned: true,
      closeDrawer() { calls.push("drawer"); },
      closeTooltip() { calls.push("tooltip"); },
    }),
    true,
  );
  assert.deepEqual(calls, ["prevent", "tooltip"]);

  const attrs = new Map();
  const drawer = {
    hidden: true,
    setAttribute(name, value) { attrs.set(name, value); },
  };
  const backdrop = { hidden: true };
  const background = [{ inert: false }, { inert: false }];
  let focused = null;
  const opener = { focus() { focused = "opener"; } };
  const focusTarget = { focus() { focused = "target"; } };
  const state = { opener: null };

  setHelpDrawerState({
    drawer,
    backdrop,
    background,
    open: true,
    opener,
    focusTarget,
    state,
  });
  assert.equal(drawer.hidden, false);
  assert.equal(backdrop.hidden, false);
  assert.deepEqual(background.map((item) => item.inert), [true, true]);
  assert.equal(attrs.get("aria-hidden"), "false");
  assert.equal(focused, "target");

  setHelpDrawerState({
    drawer,
    backdrop,
    background,
    open: false,
    state,
  });
  assert.equal(drawer.hidden, true);
  assert.equal(backdrop.hidden, true);
  assert.deepEqual(background.map((item) => item.inert), [false, false]);
  assert.equal(attrs.get("aria-hidden"), "true");
  assert.equal(focused, "opener");
});

test("BFCache pagehide preserves live controllers for pageshow restoration", () => {
  assert.equal(shouldTeardownOnPageHide({ persisted: true }), false);
  assert.equal(shouldTeardownOnPageHide({ persisted: false }), true);
  assert.equal(shouldTeardownOnPageHide({}), true);
});

test("drawer focus cycles at both boundaries and pinned definition restores its trigger", () => {
  const focused = [];
  const first = { focus() { focused.push("first"); } };
  const middle = { focus() { focused.push("middle"); } };
  const last = { focus() { focused.push("last"); } };
  const documentObject = { activeElement: last };
  const drawer = {
    ownerDocument: documentObject,
    querySelectorAll() { return [first, middle, last]; },
  };
  const forward = {
    key: "Tab",
    shiftKey: false,
    preventDefault() { focused.push("prevent-forward"); },
  };
  assert.equal(cycleHelpDrawerFocus(forward, drawer), true);
  assert.deepEqual(focused, ["prevent-forward", "first"]);

  documentObject.activeElement = first;
  const backward = {
    key: "Tab",
    shiftKey: true,
    preventDefault() { focused.push("prevent-backward"); },
  };
  assert.equal(cycleHelpDrawerFocus(backward, drawer), true);
  assert.deepEqual(focused.slice(-2), ["prevent-backward", "last"]);

  const programmaticTarget = {};
  drawer.contains = (target) =>
    target === first ||
    target === middle ||
    target === last ||
    target === programmaticTarget;
  documentObject.activeElement = programmaticTarget;
  assert.equal(cycleHelpDrawerFocus(forward, drawer), true);
  assert.deepEqual(focused.slice(-2), ["prevent-forward", "first"]);
  documentObject.activeElement = programmaticTarget;
  assert.equal(cycleHelpDrawerFocus(backward, drawer), true);
  assert.deepEqual(focused.slice(-2), ["prevent-backward", "last"]);

  drawer.contains = (target) => target === first || target === middle || target === last;
  assert.equal(
    guardHelpDrawerFocus({ target: {} }, drawer, first),
    true,
  );
  assert.equal(focused.at(-1), "first");

  const attrs = new Map();
  const popover = {
    hidden: true,
    setAttribute(name, value) { attrs.set(name, value); },
  };
  const triggerAttrs = new Map();
  const trigger = {
    isConnected: true,
    setAttribute(name, value) { triggerAttrs.set(name, value); },
    focus() { focused.push("trigger"); },
  };
  const stableFallback = {
    focus() { focused.push("fallback"); },
  };
  const action = { focus() { focused.push("action"); } };
  const state = {};
  setPinnedDefinitionState({
    popover,
    open: true,
    trigger,
    focusTarget: action,
    state,
  });
  assert.equal(popover.hidden, false);
  assert.equal(attrs.get("aria-hidden"), "false");
  assert.equal(triggerAttrs.get("aria-expanded"), "true");
  assert.equal(focused.at(-1), "action");

  setPinnedDefinitionState({ popover, open: false, state });
  assert.equal(popover.hidden, true);
  assert.equal(attrs.get("aria-hidden"), "true");
  assert.equal(triggerAttrs.get("aria-expanded"), "false");
  assert.equal(focused.at(-1), "trigger");

  trigger.isConnected = false;
  setPinnedDefinitionState({
    popover,
    open: true,
    trigger,
    focusTarget: action,
    focusFallback: stableFallback,
    state,
  });
  setPinnedDefinitionState({ popover, open: false, state });
  assert.equal(focused.at(-1), "fallback");
});

test("outside pointer dismissal preserves focus on the newly clicked control", () => {
  const popover = {
    contains(target) {
      return target === "inside";
    },
  };
  const calls = [];
  assert.equal(
    dismissPinnedDefinitionFromPointer(
      { target: "inside" },
      popover,
      (options) => calls.push(options),
    ),
    false,
  );
  assert.equal(
    dismissPinnedDefinitionFromPointer(
      { target: "outside" },
      popover,
      (options) => calls.push(options),
    ),
    true,
  );
  assert.deepEqual(calls, [{ restoreFocus: false }]);
});

test("AI export shell is local-only, scoped, read-only, and initially unavailable", async () => {
  const html = await readFile(publicHtmlUrl, "utf8");
  const nodes = parseHtmlStartTags(html);
  const byId = new Map(
    nodes
      .filter((node) => typeof node.attributes.get("id") === "string")
      .map((node) => [node.attributes.get("id"), node]),
  );
  for (const id of [
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
  ]) {
    assert.ok(byId.has(id), `#${id}`);
  }
  const exportButton = byId.get("ai-export-button");
  assert.equal(exportButton.name, "button");
  assert.equal(exportButton.attributes.get("disabled"), true);
  assert.equal(exportButton.attributes.get("aria-controls"), "ai-export-drawer");
  assert.ok(
    isDescendantOf(
      exportButton,
      nodes.find((node) => hasClass(node, "timeline-actions")),
    ),
    "export action belongs to timeline controls",
  );
  const drawer = byId.get("ai-export-drawer");
  assert.equal(drawer.attributes.get("role"), "dialog");
  assert.equal(drawer.attributes.get("aria-modal"), "true");
  assert.equal(drawer.attributes.get("hidden"), true);
  assert.equal(byId.get("ai-export-preview").name, "textarea");
  assert.equal(byId.get("ai-export-preview").attributes.get("readonly"), true);
  assert.equal(byId.get("ai-export-status").attributes.get("role"), "status");
  assert.equal(byId.get("ai-export-status").attributes.get("aria-live"), "polite");
  assert.match(html, /generated locally/i);
  assert.match(html, /nothing is uploaded/i);
  assert.match(html, /Prompt \+ data/i);
  assert.match(html, /Structured data/i);
});

test("AI export capture is fresh, formats without recapture, copies explicitly, and revokes downloads", async () => {
  let snapshotCount = 0;
  const renderer = {
    visibleEvidenceSnapshot() {
      snapshotCount += 1;
      return {
        viewport: { startNs: snapshotCount * 10, endNs: snapshotCount * 10 + 5 },
        commandBuffers: [],
        dispatches: [],
        waits: [],
        unplacedDispatchCount: 0,
        unanchoredWaitCount: 0,
        densityMode: false,
      };
    },
  };
  const input = {
    renderer,
    trace: { id: "opaque", label: "Visible trace" },
    launchIndex: 0,
    launch: { startNs: 0, endNs: 100, summary: {} },
    evidenceHealth: { validEvidence: true },
    generatedAt: "2026-07-23T12:00:00.000Z",
  };
  const first = captureVisibleTimelineExport(input);
  const second = captureVisibleTimelineExport(input);
  assert.equal(snapshotCount, 2, "each opening capture reads the renderer again");
  assert.notDeepEqual(
    first.selection.viewport_ns,
    second.selection.viewport_ns,
  );

  const markdown = formatVisibleTimelineExport(first, "markdown");
  const json = formatVisibleTimelineExport(first, "json");
  assert.match(markdown.text, /Analyze this visible Metal dispatch/i);
  assert.deepEqual(JSON.parse(json.text), first);
  assert.equal(snapshotCount, 2, "format changes reuse the captured payload");
  assert.equal(markdown.extension, "md");
  assert.equal(json.extension, "json");

  let copied = null;
  const copyResult = await copyExportText("visible only", {
    clipboard: {
      async writeText(value) {
        copied = value;
      },
    },
  });
  assert.equal(copied, "visible only");
  assert.equal(copyResult.ok, true);
  const unavailable = await copyExportText("visible only", {});
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.message, /select.*preview|clipboard.*unavailable/i);

  const calls = [];
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
    }
  }
  const anchor = {
    click() { calls.push("click"); },
    remove() { calls.push("remove"); },
  };
  const documentObject = {
    createElement(tagName) {
      assert.equal(tagName, "a");
      return anchor;
    },
    body: {
      append(element) {
        assert.equal(element, anchor);
        calls.push("append");
      },
    },
  };
  const urlObject = {
    createObjectURL(blob) {
      assert.ok(blob instanceof FakeBlob);
      calls.push("create");
      return "blob:visible";
    },
    revokeObjectURL(url) {
      calls.push(`revoke:${url}`);
    },
  };
  downloadExportText("payload", {
    BlobClass: FakeBlob,
    documentObject,
    filename: "visible.json",
    mimeType: "application/json",
    urlObject,
  });
  assert.equal(anchor.download, "visible.json");
  assert.deepEqual(calls, [
    "create",
    "append",
    "click",
    "remove",
    "revoke:blob:visible",
  ]);
});

test("AI export controller requires a real selected launch and wires local actions end to end", async () => {
  assert.equal(
    selectedLaunchExportContext({
      currentTrace: { id: "trace" },
      currentDataset: { summary: { wallSpanNs: 10 }, launchWindows: [] },
      currentWindowIndex: null,
    }),
    null,
    "whole-dataset fallback is not mislabeled as a selected launch",
  );
  assert.equal(
    selectedLaunchExportContext({
      currentTrace: { id: "trace" },
      currentDataset: { launchWindows: [{ summary: { wallSpanNs: 10 } }] },
      currentWindowIndex: 3,
    }),
    null,
    "stale launch index is unavailable",
  );
  assert.equal(
    selectedLaunchExportContext({
      currentTrace: { id: "trace" },
      currentDataset: {
        health: { validEvidence: true },
        launchWindows: [{ summary: { wallSpanNs: 10 } }],
      },
      currentWindowIndex: 0,
    }).launchIndex,
    0,
  );

  class FakeElement {
    constructor(documentObject) {
      this.ownerDocument = documentObject;
      this.listeners = new Map();
      this.attributes = new Map();
      this.hidden = false;
      this.disabled = false;
      this.value = "";
      this.textContent = "";
      this.focusCount = 0;
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) this.listeners.delete(type);
    }
    async emit(type, event = {}) {
      return this.listeners.get(type)?.({ target: this, ...event });
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    focus() {
      this.ownerDocument.activeElement = this;
      this.focusCount += 1;
    }
    contains(target) {
      return target === this || this.children?.includes(target);
    }
    querySelectorAll() {
      return this.children ?? [];
    }
  }

  const documentListeners = new Map();
  const background = [{ inert: false }, { inert: false }];
  const anchorCalls = [];
  const anchor = {
    click() { anchorCalls.push("click"); },
    remove() { anchorCalls.push("remove"); },
  };
  const documentObject = {
    activeElement: null,
    querySelector(selector) {
      return selector === ".site-header" ? background[0] : background[1];
    },
    addEventListener(type, listener) {
      documentListeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
    },
    createElement(tagName) {
      assert.equal(tagName, "a");
      return anchor;
    },
    body: {
      append(value) {
        assert.equal(value, anchor);
        anchorCalls.push("append");
      },
    },
  };
  const make = () => new FakeElement(documentObject);
  const elements = {
    exportButton: make(),
    exportDrawer: make(),
    exportClose: make(),
    exportRefresh: make(),
    exportFormat: make(),
    exportScope: make(),
    exportPreview: make(),
    copyExport: make(),
    downloadExport: make(),
    exportStatus: make(),
    utilityBackdrop: make(),
    timelineScroller: {
      scrollLeft: 120,
      clientWidth: 300,
      scrollWidth: 900,
    },
    canvas: {
      clientWidth: 720,
    },
  };
  elements.exportDrawer.hidden = true;
  elements.utilityBackdrop.hidden = true;
  elements.exportFormat.value = "markdown";
  elements.exportDrawer.children = [
    elements.exportClose,
    elements.exportFormat,
    elements.exportRefresh,
    elements.exportPreview,
    elements.copyExport,
    elements.downloadExport,
  ];

  let currentContext = null;
  let snapshotCount = 0;
  const snapshotWindows = [];
  let closeOtherCount = 0;
  let clipboardText = null;
  let deferClipboard = false;
  let resolveClipboard = null;
  const revoked = [];
  const timestamps = [
    new Date("2026-07-23T12:00:00.000Z"),
    new Date("2026-07-23T12:00:01.000Z"),
    new Date("2026-07-23T12:00:02.000Z"),
  ];
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
    }
  }
  const windowObject = {
    Blob: FakeBlob,
    navigator: {
      clipboard: {
        async writeText(value) {
          clipboardText = value;
          if (deferClipboard) {
            await new Promise((resolve) => {
              resolveClipboard = resolve;
            });
          }
        },
      },
    },
    URL: {
      createObjectURL(blob) {
        assert.ok(blob instanceof FakeBlob);
        return "blob:controller";
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
    },
  };
  const renderer = {
    visibleEvidenceSnapshot(pixelWindow) {
      snapshotCount += 1;
      snapshotWindows.push(pixelWindow);
      return {
        viewport: {
          startNs: pixelWindow.scrollLeft,
          endNs: pixelWindow.scrollLeft + pixelWindow.clientWidth,
        },
        commandBuffers: [],
        dispatches: [],
        waits: [],
        unplacedDispatchCount: 0,
        unanchoredWaitCount: 0,
        densityMode: false,
      };
    },
  };
  const controller = createAiExportController({
    documentObject,
    windowObject,
    elements,
    renderer,
    getContext: () => currentContext,
    closeOtherDrawer() {
      closeOtherCount += 1;
    },
    now: () => timestamps.shift(),
  });

  controller.setAvailable(true);
  assert.equal(elements.exportButton.disabled, true, "no launch stays unavailable");
  await elements.exportButton.emit("click");
  assert.equal(snapshotCount, 0);
  assert.equal(elements.exportDrawer.hidden, true);

  const validContext = {
    trace: { id: "visible", label: "Visible" },
    launchIndex: 0,
    launch: {
      startNs: 0,
      endNs: 100,
      summary: {},
      renderSampling: {
        active: true,
        dispatches: { displayed: 4, total: 40 },
      },
    },
    evidenceHealth: { validEvidence: true },
  };
  currentContext = validContext;
  controller.setAvailable(true);
  assert.equal(elements.exportButton.disabled, false);
  await elements.exportButton.emit("click");
  assert.equal(snapshotCount, 1);
  assert.deepEqual(snapshotWindows[0], {
    scrollLeft: 96,
    clientWidth: 240,
  });
  assert.equal(closeOtherCount, 1);
  assert.equal(elements.exportDrawer.hidden, false);
  assert.equal(elements.utilityBackdrop.hidden, false);
  assert.equal(elements.exportFormat.focusCount, 1);
  assert.equal(controller.state.payload.generated_at, "2026-07-23T12:00:00.000Z");
  assert.match(elements.exportPreview.value, /Analyze this visible Metal dispatch/i);
  assert.match(elements.exportScope.textContent, /displayed sample records/i);

  elements.timelineScroller.scrollLeft = 240;
  await elements.exportRefresh.emit("click");
  assert.equal(snapshotCount, 2);
  assert.deepEqual(snapshotWindows[1], {
    scrollLeft: 192,
    clientWidth: 240,
  });
  assert.notEqual(
    controller.state.payload.selection.viewport_ns.start,
    96,
    "changed horizontal scroll produces a newly scoped capture",
  );
  assert.equal(controller.state.payload.generated_at, "2026-07-23T12:00:01.000Z");
  elements.exportFormat.value = "json";
  await elements.exportFormat.emit("change");
  assert.equal(snapshotCount, 2, "format change does not recapture");
  assert.deepEqual(JSON.parse(elements.exportPreview.value), controller.state.payload);

  await elements.copyExport.emit("click");
  assert.equal(clipboardText, elements.exportPreview.value);
  assert.match(elements.exportStatus.textContent, /copied/i);
  await elements.downloadExport.emit("click");
  assert.deepEqual(revoked, ["blob:controller"]);
  assert.deepEqual(anchorCalls, ["append", "click", "remove"]);

  await documentListeners.get("keydown")({
    key: "Escape",
    preventDefault() {},
  });
  assert.equal(elements.exportDrawer.hidden, true);
  assert.equal(elements.exportButton.focusCount, 1);

  currentContext = null;
  await elements.exportButton.emit("click");
  assert.equal(elements.exportButton.disabled, true, "stale context disables on open");
  assert.equal(snapshotCount, 2);
  currentContext = validContext;
  controller.setAvailable(true);
  await elements.exportButton.emit("click");
  assert.equal(snapshotCount, 3, "reopening captures fresh viewport evidence");
  assert.deepEqual(snapshotWindows[2], {
    scrollLeft: 192,
    clientWidth: 240,
  });
  assert.equal(controller.state.payload.generated_at, "2026-07-23T12:00:02.000Z");

  elements.exportFormat.value = "markdown";
  await elements.exportFormat.emit("change");
  deferClipboard = true;
  const delayedCopy = elements.copyExport.emit("click");
  elements.exportFormat.value = "json";
  await elements.exportFormat.emit("change");
  resolveClipboard();
  await delayedCopy;
  assert.match(elements.exportPreview.value, /^\{/);
  assert.doesNotMatch(
    elements.exportStatus.textContent,
    /copied/i,
    "stale clipboard completion does not describe a different preview",
  );

  await elements.exportClose.emit("click");
  assert.equal(elements.exportButton.focusCount, 2);

  currentContext = null;
  controller.setAvailable(true);
  assert.equal(elements.exportButton.disabled, true);
  controller.destroy();
});
