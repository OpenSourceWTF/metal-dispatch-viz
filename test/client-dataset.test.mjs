import assert from "node:assert/strict";
import test from "node:test";

import {
  compactDatasetForClient,
  compactScopeForClient,
} from "../public/client-dataset.js";

test("scope compaction retains exact range metadata and overview bins", () => {
  const overview = Object.freeze({
    startNs: 0,
    endNs: 10,
    binCount: 1,
    bins: Object.freeze([Object.freeze({ dispatchCount: 10 })]),
  });
  const range = Object.freeze({ startNs: 2, endNs: 8 });
  const omissions = Object.freeze({
    unplacedDispatches: 1,
    unanchoredWaits: 2,
  });
  const scope = {
    dispatches: Array.from({ length: 20 }, (_, atNs) => ({ atNs })),
    commandBuffers: [],
    waits: [],
    overview,
    range,
    omissions,
  };

  const compact = compactScopeForClient(scope, { maxDispatches: 4 });

  assert.equal(compact.dispatches.length, 4);
  assert.equal(compact.overview, overview);
  assert.equal(compact.range, range);
  assert.equal(compact.omissions, omissions);
  assert.equal(Object.isFrozen(compact), true);
});

test("dataset compaction remains compatible while preserving launch overviews", () => {
  const overview = Object.freeze({
    startNs: 0,
    endNs: 10,
    binCount: 1,
    bins: Object.freeze([Object.freeze({ gpuBusyNs: 5 })]),
  });
  const launch = {
    index: 0,
    startNs: 0,
    endNs: 10,
    dispatches: Array.from({ length: 10 }, (_, atNs) => ({ atNs })),
    commandBuffers: [],
    waits: [],
    overview,
  };
  const dataset = {
    ...launch,
    launchWindows: [launch],
    health: Object.freeze({ validEvidence: true }),
    diagnostics: Object.freeze({ parsedRows: 10 }),
  };

  const compact = compactDatasetForClient(dataset, { maxDispatches: 3 });

  assert.equal(compact.dispatches.length, 3);
  assert.equal(compact.launchWindows[0].dispatches.length, 3);
  assert.equal(compact.overview, overview);
  assert.equal(compact.launchWindows[0].overview, overview);
  assert.equal(compact.health, dataset.health);
  assert.equal(compact.diagnostics, dataset.diagnostics);
});
