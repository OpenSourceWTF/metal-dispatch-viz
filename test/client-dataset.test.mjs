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
  const rangeAnalysis = Object.freeze({
    available: false,
    reason: "missing-command-buffer-timing",
  });
  const scope = {
    dispatches: Array.from({ length: 20 }, (_, atNs) => ({ atNs })),
    commandBuffers: [],
    waits: [],
    overview,
    range,
    omissions,
    rangeAnalysis,
  };

  const compact = compactScopeForClient(scope, { maxDispatches: 4 });

  assert.equal(compact.dispatches.length, 4);
  assert.equal(compact.overview, overview);
  assert.equal(compact.range, range);
  assert.equal(compact.omissions, omissions);
  assert.equal(compact.rangeAnalysis, rangeAnalysis);
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
    rangeAnalysis: Object.freeze({ available: true, reason: null }),
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
  assert.equal(
    compact.launchWindows[0].rangeAnalysis,
    launch.rangeAnalysis,
  );
  assert.equal(compact.health, dataset.health);
  assert.equal(compact.diagnostics, dataset.diagnostics);
});

test("worker-bound event arrays are bounded and merged GPU intervals stay exact-only", () => {
  const eventCount = 20_000;
  const scope = {
    dispatches: Array.from({ length: eventCount }, (_, index) => ({
      atNs: index * 4,
    })),
    commandBuffers: Array.from({ length: eventCount }, (_, index) => ({
      commandBufferIndex: index,
    })),
    waits: Array.from({ length: eventCount }, (_, index) => ({
      atNs: index * 4 + 1,
    })),
    gpuIntervals: Array.from({ length: eventCount }, (_, index) =>
      Object.freeze([index * 4 + 2, index * 4 + 3]),
    ),
    summary: Object.freeze({ opsTotal: eventCount }),
  };
  const limits = {
    maxDispatches: 40,
    maxCommandBuffers: 30,
    maxWaits: 20,
  };
  const compactRange = compactScopeForClient(scope, limits);
  const compact = compactDatasetForClient(
    {
      ...scope,
      launchWindows: [{ index: 0, ...scope }],
      unassignedDispatches: scope.dispatches,
      unassignedWaits: scope.waits,
    },
    limits,
  );

  assert.equal(compactRange.dispatches.length, 40);
  assert.equal(compactRange.commandBuffers.length, 30);
  assert.equal(compactRange.waits.length, 20);
  assert.equal("gpuIntervals" in compactRange, false);
  assert.equal(compact.dispatches.length, 40);
  assert.equal(compact.commandBuffers.length, 30);
  assert.equal(compact.waits.length, 20);
  assert.equal(compact.unassignedDispatches.length, 40);
  assert.equal(compact.unassignedWaits.length, 20);
  assert.equal(compact.launchWindows[0].dispatches.length, 40);
  assert.equal(compact.launchWindows[0].commandBuffers.length, 30);
  assert.equal(compact.launchWindows[0].waits.length, 20);
  assert.equal("gpuIntervals" in compact, false);
  assert.equal("gpuIntervals" in compact.launchWindows[0], false);
  assert.equal(scope.gpuIntervals.length, eventCount);
});
