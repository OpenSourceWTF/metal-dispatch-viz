const DEFAULT_LIMITS = Object.freeze({
  maxDispatches: 4_000,
  maxCommandBuffers: 3_000,
  maxWaits: 2_000,
});

function positiveLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 1 ? value : fallback;
}

function evenlySample(items, limit) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (items.length <= limit) return items;

  const sampled = new Array(limit);
  const finalIndex = items.length - 1;
  for (let index = 0; index < limit; index += 1) {
    sampled[index] =
      items[Math.floor((index * finalIndex) / (limit - 1))];
  }
  return sampled;
}

function compactScope(
  scope,
  {
    maxDispatches,
    maxCommandBuffers,
    maxWaits,
  },
) {
  const source = scope && typeof scope === "object" ? scope : {};
  const sourceDispatches = Array.isArray(source.dispatches)
    ? source.dispatches
    : [];
  const sourceCommandBuffers = Array.isArray(source.commandBuffers)
    ? source.commandBuffers
    : [];
  const sourceWaits = Array.isArray(source.waits) ? source.waits : [];
  const dispatches = evenlySample(sourceDispatches, maxDispatches);
  const commandBuffers = evenlySample(
    sourceCommandBuffers,
    maxCommandBuffers,
  );
  const waits = evenlySample(sourceWaits, maxWaits);

  return Object.freeze({
    index: source.index,
    commandBufferIndices: source.commandBufferIndices,
    startNs: source.startNs,
    endNs: source.endNs,
    gapBeforeNs: source.gapBeforeNs,
    gapThresholdNs: source.gapThresholdNs,
    dispatches: Object.freeze(dispatches),
    commandBuffers: Object.freeze(commandBuffers),
    waits: Object.freeze(waits),
    gpuIntervals: source.gpuIntervals,
    waitTaxonomy: source.waitTaxonomy,
    kernelCensus: source.kernelCensus,
    summary: source.summary,
    overview: source.overview,
    range: source.range,
    omissions: source.omissions,
    renderSampling: Object.freeze({
      active:
        dispatches.length !== sourceDispatches.length ||
        commandBuffers.length !== sourceCommandBuffers.length ||
        waits.length !== sourceWaits.length,
      dispatches: Object.freeze({
        displayed: dispatches.length,
        total: sourceDispatches.length,
      }),
      commandBuffers: Object.freeze({
        displayed: commandBuffers.length,
        total: sourceCommandBuffers.length,
      }),
      waits: Object.freeze({
        displayed: waits.length,
        total: sourceWaits.length,
      }),
    }),
  });
}

function clientLimits(options = {}) {
  return Object.freeze({
    maxDispatches: positiveLimit(
      options.maxDispatches,
      DEFAULT_LIMITS.maxDispatches,
    ),
    maxCommandBuffers: positiveLimit(
      options.maxCommandBuffers,
      DEFAULT_LIMITS.maxCommandBuffers,
    ),
    maxWaits: positiveLimit(options.maxWaits, DEFAULT_LIMITS.maxWaits),
  });
}

export function compactScopeForClient(scope, options = {}) {
  return compactScope(scope, clientLimits(options));
}

/**
 * Remove analysis-only collections before crossing the worker boundary.
 * Exact metrics and taxonomies are retained while very large event arrays are
 * sampled deterministically for the interactive canvas.
 */
export function compactDatasetForClient(dataset, options = {}) {
  const source = dataset && typeof dataset === "object" ? dataset : {};
  const limits = clientLimits(options);
  const compactTopLevel = compactScope(source, limits);
  const launchWindows = (Array.isArray(source.launchWindows)
    ? source.launchWindows
    : []
  ).map((window) => compactScope(window, limits));

  return Object.freeze({
    ...compactTopLevel,
    sourceSummary: source.sourceSummary,
    sourceCompleteness: source.sourceCompleteness,
    launchWindows: Object.freeze(launchWindows),
    unassignedDispatches: Object.freeze(
      evenlySample(
        source.unassignedDispatches,
        limits.maxDispatches,
      ),
    ),
    unassignedWaits: Object.freeze(
      evenlySample(source.unassignedWaits, limits.maxWaits),
    ),
    health: source.health,
    diagnostics: source.diagnostics,
  });
}
