export const KERNEL_GLYPH_GRAMMARS = Object.freeze({
  attention: "phased-rings",
  projection: "matrix-slab",
  normalization: "equalizer-torus",
  routing: "switch-manifold",
  activation: "ignition-chamber",
  "embedding-output": "vocabulary-aperture",
  "transfer-binding": "conduit-coupler",
  other: "neutral-capsule",
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function nonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function dimensions(value) {
  const source = Array.isArray(value) ? value : [];
  return Object.freeze(
    [0, 1, 2].map((index) => {
      const dimension = source[index];
      return Number.isFinite(dimension) && dimension > 0
        ? Math.floor(dimension)
        : 1;
    }),
  );
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function buildKernelGlyphDescriptor(dispatch) {
  const measuredIdentity =
    dispatch !== null &&
    typeof dispatch === "object" &&
    typeof dispatch.kernel === "string" &&
    dispatch.kernel.trim() !== "";
  const exactName = measuredIdentity
    ? dispatch.kernel.trim()
    : "Awaiting dispatch";
  const family = Object.hasOwn(
    KERNEL_GLYPH_GRAMMARS,
    dispatch?.family,
  )
    ? dispatch.family
    : "other";
  const grid = dimensions(dispatch?.grid);
  const threadgroup = dimensions(dispatch?.threadgroup);
  const gridAvailable = dispatch?.gridAvailable === true;
  const threadgroupAvailable =
    dispatch?.threadgroupAvailable === true;
  const dispatchMode =
    dispatch?.dispatchMode === "threads" ||
    dispatch?.dispatchMode === "threadgroups"
      ? dispatch.dispatchMode
      : null;
  const activity =
    nonNegative(dispatch?.bufferBinds) +
    nonNegative(dispatch?.setBytesCalls) +
    (nonNegative(dispatch?.setBytesTotalBytes) > 0 ? 1 : 0);

  return deepFreeze({
    exactName,
    family,
    grammar: KERNEL_GLYPH_GRAMMARS[family],
    dispatchMode,
    grid,
    threadgroup,
    gridAvailable,
    threadgroupAvailable,
    proportions: grid.map((dimension) =>
      clamp(0.55 + Math.log2(dimension + 1) / 8, 0.55, 2.4),
    ),
    microcells: threadgroup.map((dimension) =>
      clamp(Math.floor(dimension), 1, 12),
    ),
    portCount: clamp(Math.ceil(activity), 1, 8),
    ornamentSeed: fnv1a(exactName),
    evidence: {
      identity: measuredIdentity ? "measured" : "unavailable",
      dispatch: gridAvailable ? "measured" : "unavailable",
      geometry: "derived",
    },
  });
}
