import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildTheaterLabels,
  evidenceAccent,
  fitCanvasLabel,
  theaterProgressTransform,
} from "../src/observatory/theater-labels.js";

test("theater labels make progress, geometry, and evidence visible in exports", () => {
  const labels = buildTheaterLabels({
    progress: {
      percent: 80,
      dispatchLabel: "2 / 2",
      bufferLabel: "2 / 2",
      measuredDurationLabel: "MEASURED GPU · 4.8 µs",
    },
    memory: { exactMassLabel: "~17.5 GB" },
    active: { family: "projection", shapeLabel: "64 × 4 × 1" },
    gpu: {
      lanes: Array.from({ length: 16 }, (_, index) => ({ index })),
      gridLabel: "GRID 64 × 4 × 1",
      evidence: "measured geometry",
    },
    flow: { label: "DERIVED BINDING FLOW" },
    speculation: {
      visible: true,
      label: "CONFIGURED SPECULATION · K3",
    },
    evidence: {
      level: "warning",
      summary: "4000 of 330494 dispatches shown by deterministic sampling",
      statusLabel: "SAMPLED 4,000/330,494 · SOURCE UNVERIFIABLE",
    },
  });

  assert.equal(labels.progress, "CAPTURED WINDOW 80% · DISPATCH 2 / 2");
  assert.equal(
    labels.control,
    "CPU COMMAND QUEUE · BUFFER 2 / 2 · MEASURED GPU 4.8 µs",
  );
  assert.equal(labels.memory, "UNIFIED MEMORY · ~17.5 GB");
  assert.equal(labels.kernel, "PROJECTION · 64 × 4 × 1");
  assert.equal(
    labels.gpu,
    "MEASURED GRID · 16 REPRESENTATIVE LANES · GRID 64 × 4 × 1",
  );
  assert.equal(labels.flow, "DERIVED BINDING FLOW");
  assert.equal(labels.speculation, "CONFIGURED SPECULATION · K3");
  assert.equal(
    labels.evidence,
    "SAMPLED 4,000/330,494 · SOURCE UNVERIFIABLE",
  );
  assert.equal(
    labels.legend,
    "MEASURED · DERIVED · CONFIGURED",
  );
});

test("theater progress stays anchored to the left edge", () => {
  assert.deepEqual(theaterProgressTransform(0.8), {
    scaleX: 0.8,
    positionX: -4.2,
  });
  assert.deepEqual(theaterProgressTransform(4), {
    scaleX: 1,
    positionX: -4.2,
  });
});

test("evidence accents distinguish verified, warning, and pending frames", () => {
  assert.equal(evidenceAccent("verified"), "#48e7ff");
  assert.equal(evidenceAccent("warning"), "#ff7d8f");
  assert.equal(evidenceAccent("pending"), "#8da8b9");
  assert.notEqual(evidenceAccent("warning"), "#ffbd69");
});

test("theater labels degrade explicitly when geometry is unavailable", () => {
  const labels = buildTheaterLabels(null);
  assert.equal(labels.progress, "CAPTURED WINDOW 0% · DISPATCH —");
  assert.equal(labels.control, "CPU COMMAND QUEUE · BUFFER —");
  assert.equal(labels.memory, "UNIFIED MEMORY · MASS UNKNOWN");
  assert.equal(labels.kernel, "AWAITING · SHAPE UNAVAILABLE");
  assert.equal(
    labels.gpu,
    "GRID UNAVAILABLE · NO PARALLELISM CLAIM",
  );
  assert.equal(labels.speculation, "SPECULATION NOT DECLARED");
  assert.equal(
    labels.evidence,
    "EVIDENCE PENDING",
  );
  assert.equal(
    labels.legend,
    "GRID UNAVAILABLE · DERIVED · CONFIGURED",
  );
});

test("canvas labels fit their plate at the minimum readable type size", () => {
  const context = {
    font: "",
    measureText(text) {
      const fontSize = Number.parseInt(this.font.match(/(\d+)px/)?.[1], 10);
      return { width: text.length * fontSize * 0.62 };
    },
  };
  const fitted = fitCanvasLabel(
    context,
    "EVIDENCE WARNING · 4000 of 330494 dispatches shown by deterministic sampling from a source with omissions",
    46,
    942,
  );

  context.font = `700 ${fitted.fontSize}px Inter, Arial, sans-serif`;
  assert.ok(context.measureText(fitted.text).width <= 942);
  assert.match(fitted.text, /…$/);
});

test("combined sampling and provenance warnings survive canvas fitting", () => {
  const context = {
    font: "",
    measureText(text) {
      const fontSize = Number.parseInt(this.font.match(/(\d+)px/)?.[1], 10);
      return { width: text.length * fontSize * 0.62 };
    },
  };
  const labels = buildTheaterLabels({
    evidence: {
      level: "warning",
      statusLabel: "SAMPLED 4,000/330,494 · SOURCE UNVERIFIABLE",
    },
  });
  const fitted = fitCanvasLabel(context, labels.evidence, 46, 942);

  assert.match(fitted.text, /SAMPLED 4,000\/330,494/);
  assert.match(fitted.text, /SOURCE UNVERIFIABLE/);
});

test("the fixed stage captures the compact evidence warning", async () => {
  const source = await readFile(
    new URL("../src/observatory/ObservatoryScene.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /evidence:\s*\{\s*text:\s*labels\.evidence,/);
  assert.match(
    source,
    /plate\.update\(\s*labels\[name\],[\s\S]*?evidenceAccent\(story\.evidence\.level\)/,
  );
});

test("the progress rail wraps without uppercasing microsecond units", async () => {
  const css = await readFile(
    new URL("../src/observatory/observatory.css", import.meta.url),
    "utf8",
  );
  const progressRule = css.match(/\.progress-copy\s*\{[^}]+\}/)?.[0] ?? "";
  assert.match(progressRule, /display:\s*flex/);
  assert.match(progressRule, /flex-wrap:\s*wrap/);
  assert.match(progressRule, /text-transform:\s*none/);
  assert.doesNotMatch(css, /\.progress-copy\s*>\s*span:last-child/);
});
