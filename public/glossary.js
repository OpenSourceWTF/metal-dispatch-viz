const entries = [
  {
    id: "wall-span",
    label: "Wall span",
    definition:
      "Elapsed time from the selected launch's earliest usable profiler endpoint to its latest usable endpoint.",
    method:
      "Subtract the first usable host, GPU, or wait endpoint from the last usable endpoint.",
    provenance: "measured",
    limitation:
      "This is an elapsed range, not the sum of work and waits, and it does not identify a critical path.",
    section: "Measurements",
  },
  {
    id: "exposed-host",
    label: "Exposed host",
    definition:
      "Host encode time outside GPU activity, where no measured GPU interval overlaps that host interval.",
    method:
      "Subtract the union of valid GPU intervals from each valid host encode interval, then sum the uncovered pieces.",
    provenance: "derived",
    limitation:
      "Overlap describes timing coincidence only; it does not prove that host work delayed the GPU.",
    section: "Measurements",
  },
  {
    id: "hidden-host",
    label: "Hidden host",
    definition:
      "Host encode time that overlaps measured GPU activity and is therefore hidden behind GPU execution in the timeline.",
    method:
      "Intersect each valid host encode interval with the union of valid GPU intervals, then sum the intersections.",
    provenance: "derived",
    limitation:
      "Overlap is not proof of a dependency or of useful parallel work.",
    section: "Measurements",
  },
  {
    id: "gpu-busy",
    label: "GPU busy",
    definition:
      "Time covered by at least one valid GPU execution interval in the selected launch.",
    method:
      "Merge overlapping GPU intervals and sum the resulting union so concurrent command buffers are not double-counted.",
    provenance: "derived",
    limitation:
      "Busy time shows interval occupancy, not hardware utilization, achieved throughput, or the critical path.",
    section: "Measurements",
  },
  {
    id: "gpu-work",
    label: "GPU work",
    definition:
      "The total duration of all valid command-buffer GPU execution intervals before overlaps are removed.",
    method:
      "Sum each measured GPU end timestamp minus its matching GPU start timestamp.",
    provenance: "measured",
    limitation:
      "Overlapping command buffers contribute simultaneously, so GPU work can exceed GPU busy time or wall span.",
    section: "Measurements",
  },
  {
    id: "decision-drain",
    label: "Decision drain",
    definition:
      "A recorded wait while the host waits for a command buffer to complete before making its next decision.",
    method:
      "Sum measured durations in the cb_wait_until_completed wait bucket.",
    provenance: "measured",
    limitation:
      "Wait totals are descriptive and may overlap other activity; they are not automatically additive with wall span.",
    section: "Measurements",
  },
  {
    id: "cap-wait",
    label: "Cap wait",
    definition:
      "A recorded wait caused by a configured or runtime cap on work admitted by the profiler's producer.",
    method: "Sum measured durations in the cap_wait bucket.",
    provenance: "measured",
    limitation:
      "The trace names the bucket but does not by itself prove which cap setting should change.",
    section: "Measurements",
  },
  {
    id: "dependency-wait",
    label: "Dependency wait",
    definition:
      "A recorded wait categorized as memory or condition-variable dependency synchronization.",
    method:
      "Sum measured durations in the memory_wait and dependency_cv_wait buckets.",
    provenance: "measured",
    limitation:
      "Schema v1 has no tensor producer/consumer identities, so this cannot establish a tensor dependency path.",
    section: "Measurements",
  },
  {
    id: "command-buffer",
    label: "Command buffer",
    definition:
      "A recorded batch of encoded Metal operations with optional measured host-encode and GPU-execution endpoints.",
    limitation:
      "Missing, reversed, or ambiguous duplicate endpoints are excluded from interval arithmetic.",
    section: "Glossary",
  },
  {
    id: "dispatch",
    label: "Dispatch",
    definition:
      "One recorded operation that asks the GPU to run a kernel over a grid of work.",
    limitation:
      "Schema v1 records its order and command-buffer ownership, but no measured timestamp for the individual operation.",
    section: "Glossary",
  },
  {
    id: "kernel-family",
    label: "Kernel family",
    definition:
      "Dispatches grouped by their recorded kernel name for census and density summaries.",
    limitation:
      "A shared name groups metadata; it does not prove identical inputs, shapes, cost, or execution time.",
    section: "Glossary",
  },
  {
    id: "setbytes-call",
    label: "setBytes call",
    definition:
      "One recorded call that copies a small inline value into a Metal encoder argument.",
    method:
      "Add the setBytes call counts reported by dispatch records in the selected launch or kernel-family group.",
    provenance: "counted",
    limitation:
      "The count does not measure CPU cost, GPU cost, or whether calls could safely be removed.",
    section: "Measurements",
  },
  {
    id: "setbytes-bytes",
    label: "setBytes bytes",
    definition:
      "The reported number of inline argument bytes supplied through setBytes calls.",
    method:
      "Add setBytes_total_bytes values reported by dispatch records in the selected launch or kernel-family group.",
    provenance: "counted",
    limitation:
      "This is transferred argument volume, not total buffer traffic or GPU memory bandwidth.",
    section: "Measurements",
  },
  {
    id: "buffer-bind",
    label: "Buffer bind",
    definition:
      "One recorded binding of a Metal buffer to an encoder argument slot.",
    method:
      "Add buffer_binds counts reported by dispatch records in the selected launch or kernel-family group.",
    provenance: "counted",
    limitation:
      "The count does not reveal buffer size, reuse, memory residency, or binding cost.",
    section: "Measurements",
  },
  {
    id: "host-encode",
    label: "Host encode",
    definition:
      "The CPU-side interval during which commands are encoded into a command buffer.",
    limitation:
      "It is a command-buffer interval and does not assign measured time to each dispatch.",
    section: "Read the timeline",
  },
  {
    id: "gpu-execute",
    label: "GPU execute",
    definition:
      "The measured interval from a command buffer's GPU start endpoint to its GPU end endpoint.",
    limitation:
      "It does not separate individual kernels or report device-unit utilization.",
    section: "Read the timeline",
  },
  {
    id: "ordered-placement",
    label: "Ordered placement",
    definition:
      "An interpolated timeline position that preserves dispatch sequence within its owning command buffer's host encode interval.",
    limitation:
      "It is not measured per-dispatch timing and cannot support operation-duration or critical-path claims.",
    section: "Read the timeline",
  },
  {
    id: "dispatch-density",
    label: "Dispatch density",
    definition:
      "A binned view of how many ordered dispatch placements fall within portions of the visible timeline.",
    method:
      "Count placed dispatches in each visible time bin; unplaceable dispatches remain disclosed separately.",
    provenance: "counted",
    limitation:
      "Density reflects ordered placements, not measured kernel start times, durations, or GPU load.",
    section: "Measurements",
  },
  {
    id: "wait-taxonomy",
    label: "Wait taxonomy",
    definition:
      "The grouping of recorded wait buckets into cap, dependency, decision, other, and non-additive scheduler detail.",
    limitation:
      "Buckets describe producer-reported categories; totals may overlap and do not form a critical path.",
    section: "Glossary",
  },
  {
    id: "scheduler-backpressure",
    label: "Scheduler backpressure",
    definition:
      "A scheduler-detail signal that work admission or handoff was being constrained.",
    limitation:
      "It mirrors scheduler detail and is non-additive, so it is not added to headline wait totals.",
    section: "Glossary",
  },
  {
    id: "worker-wait",
    label: "Worker wait",
    definition:
      "A scheduler-detail signal that a worker was idle or waiting for work.",
    limitation:
      "It is non-additive detail and does not by itself identify why useful work was unavailable.",
    section: "Glossary",
  },
  {
    id: "measured",
    label: "Measured evidence",
    definition:
      "A value read from profiler-supplied timestamps or durations, or direct arithmetic on matching measured endpoints.",
    limitation:
      "Measured timing can establish what the trace recorded, but not causality beyond the recorded schema.",
    section: "Evidence limits",
  },
  {
    id: "derived",
    label: "Derived evidence",
    definition:
      "A value calculated from measured or anchored records, such as interval union, intersection, subtraction, or a legacy fallback.",
    limitation:
      "Its strength depends on its inputs and method; derived does not mean independently measured.",
    section: "Evidence limits",
  },
  {
    id: "ordered",
    label: "Ordered evidence",
    definition:
      "A position or relationship inferred from recorded sequence order rather than an operation timestamp.",
    limitation:
      "Order does not establish exact start time, duration, concurrency, or dependency.",
    section: "Evidence limits",
  },
  {
    id: "counted",
    label: "Counted evidence",
    definition:
      "A total formed from observed records or producer-supplied count fields.",
    limitation:
      "Counts do not supply timing or prove that every source event was captured when evidence is incomplete.",
    section: "Evidence limits",
  },
  {
    id: "metadata",
    label: "Metadata evidence",
    definition:
      "A descriptive field copied from the trace, such as a kernel name, sequence, grid, or ownership identifier.",
    limitation:
      "Metadata labels an event but is not timing, dependency, or performance proof.",
    section: "Evidence limits",
  },
  {
    id: "complete",
    label: "Complete evidence",
    definition:
      "Schema-v1 evidence with a complete final summary, no dropped, malformed, or unsupported rows, matching reported counts, and no ambiguous command-buffer duplicates.",
    limitation:
      "Complete means the capture passed these checks; it does not add fields the schema never recorded.",
    section: "Evidence limits",
  },
  {
    id: "incomplete",
    label: "Incomplete evidence",
    definition:
      "Evidence whose summary reports an incomplete capture or whose dropped rows, malformed rows, count mismatches, or duplicate records prevent a complete status.",
    limitation:
      "Usable records can still be viewed, but missing evidence can change totals and apparent gaps.",
    section: "Evidence limits",
  },
  {
    id: "legacy-unverifiable",
    label: "Legacy/unverifiable evidence",
    definition:
      "An older capture whose summary lacks the fields required to verify current completeness rules.",
    limitation:
      "The workbench can render usable records but cannot upgrade the capture to complete by assumption.",
    section: "Evidence limits",
  },
  {
    id: "unsupported",
    label: "Unsupported evidence",
    definition:
      "A row or schema version that the current workbench does not know how to interpret under its evidence contract.",
    limitation:
      "Unsupported input remains disclosed and is excluded from claims that require understood records.",
    section: "Evidence limits",
  },
];

for (const entry of entries) {
  Object.freeze(entry);
}

export const GLOSSARY = Object.freeze(
  Object.fromEntries(entries.map((entry) => [entry.id, entry])),
);

/**
 * Return a glossary entry by stable identifier, or null when no entry exists.
 */
export function glossaryEntry(id) {
  if (typeof id !== "string") {
    return null;
  }
  const normalizedId = id.trim().toLowerCase();
  return Object.hasOwn(GLOSSARY, normalizedId) ? GLOSSARY[normalizedId] : null;
}

/**
 * Find glossary entries using case-insensitive text from all explanatory fields.
 */
export function searchGlossary(query) {
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  const matches =
    needle.length === 0
      ? entries
      : entries.filter((entry) =>
          Object.values(entry).some(
            (value) =>
              typeof value === "string" &&
              value.toLowerCase().includes(needle),
          ),
        );
  return Object.freeze([...matches]);
}
