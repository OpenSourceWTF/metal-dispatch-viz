import assert from "node:assert/strict";
import test from "node:test";

import { buildTheaterLabels } from "../src/observatory/theater-labels.js";

test("theater labels make progress, geometry, and evidence visible in exports", () => {
  const labels = buildTheaterLabels({
    progress: { percent: 80, dispatchLabel: "2 / 2" },
    memory: { exactMassLabel: "~17.5 GB" },
    active: { family: "projection", shapeLabel: "64 × 4 × 1" },
    gpu: {
      lanes: Array.from({ length: 16 }, (_, index) => ({ index })),
      gridLabel: "GRID 64 × 4 × 1",
    },
    flow: { label: "DERIVED BINDING FLOW" },
    speculation: {
      visible: true,
      label: "CONFIGURED SPECULATION · K3",
    },
  });

  assert.equal(labels.progress, "CAPTURED WINDOW 80% · DISPATCH 2 / 2");
  assert.equal(labels.memory, "UNIFIED MEMORY · ~17.5 GB");
  assert.equal(labels.kernel, "PROJECTION · 64 × 4 × 1");
  assert.equal(
    labels.gpu,
    "16 REPRESENTATIVE LANES · GRID 64 × 4 × 1",
  );
  assert.equal(labels.flow, "DERIVED BINDING FLOW");
  assert.equal(labels.speculation, "CONFIGURED SPECULATION · K3");
  assert.equal(
    labels.legend,
    "CYAN MEMORY · AMBER MATH · VIOLET CONFIGURED",
  );
});

test("theater labels degrade explicitly when geometry is unavailable", () => {
  const labels = buildTheaterLabels(null);
  assert.equal(labels.progress, "CAPTURED WINDOW 0% · DISPATCH —");
  assert.equal(labels.memory, "UNIFIED MEMORY · MASS UNKNOWN");
  assert.equal(labels.kernel, "AWAITING · 1 × 1 × 1");
  assert.equal(labels.gpu, "4 REPRESENTATIVE LANES · GRID 1 × 1 × 1");
  assert.equal(labels.speculation, "SPECULATION NOT DECLARED");
});
