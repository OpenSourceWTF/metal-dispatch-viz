import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKernelGlyphDescriptor,
  KERNEL_GLYPH_GRAMMARS,
} from "../src/observatory/kernel-glyph.js";

const PROJECTION_DISPATCH = Object.freeze({
  kernel:
    "affine_qmv_wide_bfloat16_t_gs_64_b_4_nv_3_kl_8_batch_0",
  family: "projection",
  dispatchMode: "threadgroups",
  grid: [1, 1280, 1],
  threadgroup: [32, 2, 1],
  gridAvailable: true,
  threadgroupAvailable: true,
  bufferBinds: 5,
  setBytesCalls: 3,
  setBytesTotalBytes: 12,
});

test("derives a bounded mechanical glyph while preserving exact measured identity", () => {
  const glyph = buildKernelGlyphDescriptor(PROJECTION_DISPATCH);

  assert.equal(glyph.exactName, PROJECTION_DISPATCH.kernel);
  assert.equal(glyph.family, "projection");
  assert.equal(glyph.grammar, "matrix-slab");
  assert.equal(glyph.dispatchMode, "threadgroups");
  assert.deepEqual(glyph.grid, [1, 1280, 1]);
  assert.deepEqual(glyph.threadgroup, [32, 2, 1]);
  assert.ok(
    glyph.proportions.every((value) => value >= 0.55 && value <= 2.4),
  );
  assert.ok(
    glyph.microcells.every((value) => value >= 1 && value <= 12),
  );
  assert.ok(glyph.portCount >= 1 && glyph.portCount <= 8);
  assert.deepEqual(glyph.evidence, {
    identity: "measured",
    dispatch: "measured",
    geometry: "derived",
  });
  assert.equal(Object.isFrozen(glyph), true);
  assert.equal(Object.isFrozen(glyph.evidence), true);
});

test("supported families select deterministic descriptors without freezing artwork", () => {
  for (const family of Object.keys(KERNEL_GLYPH_GRAMMARS)) {
    const input = {
      ...PROJECTION_DISPATCH,
      kernel: `exact_${family}_kernel`,
      family,
    };
    const first = buildKernelGlyphDescriptor(input);
    const repeat = buildKernelGlyphDescriptor(input);
    assert.equal(first.family, family);
    assert.equal(typeof first.grammar, "string");
    assert.ok(first.grammar.length > 0);
    assert.deepEqual(first, repeat);
  }
});

test("exact kernel names select deterministic ornament without changing evidence", () => {
  const first = buildKernelGlyphDescriptor(PROJECTION_DISPATCH);
  const repeat = buildKernelGlyphDescriptor(PROJECTION_DISPATCH);
  const other = buildKernelGlyphDescriptor({
    ...PROJECTION_DISPATCH,
    kernel: "another_projection_kernel",
  });

  assert.deepEqual(repeat, first);
  assert.notEqual(other.ornamentSeed, first.ornamentSeed);
  assert.deepEqual(other.grid, first.grid);
  assert.deepEqual(other.evidence, first.evidence);
});

test("missing geometry stays unavailable and extreme dimensions remain bounded", () => {
  const unavailable = buildKernelGlyphDescriptor({
    kernel: "exact_unknown_kernel",
    family: "other",
    gridAvailable: false,
    threadgroupAvailable: false,
    bufferBinds: 0,
    setBytesCalls: 0,
    setBytesTotalBytes: 0,
  });
  assert.equal(unavailable.evidence.dispatch, "unavailable");
  assert.equal(unavailable.dispatchMode, null);
  assert.deepEqual(unavailable.grid, [1, 1, 1]);
  assert.deepEqual(unavailable.threadgroup, [1, 1, 1]);
  assert.equal(unavailable.portCount, 1);

  const extreme = buildKernelGlyphDescriptor({
    ...PROJECTION_DISPATCH,
    grid: [Number.MAX_SAFE_INTEGER, 1, 1],
    threadgroup: [4096, 2048, 1024],
    bufferBinds: 1_000,
    setBytesCalls: 1_000,
    setBytesTotalBytes: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(Math.max(...extreme.proportions), 2.4);
  assert.equal(Math.max(...extreme.microcells), 12);
  assert.equal(extreme.portCount, 8);
});

test("an absent dispatch creates a neutral unavailable capsule", () => {
  const glyph = buildKernelGlyphDescriptor(null);
  assert.equal(glyph.exactName, "Awaiting dispatch");
  assert.equal(glyph.family, "other");
  assert.equal(glyph.grammar, "neutral-capsule");
  assert.deepEqual(glyph.evidence, {
    identity: "unavailable",
    dispatch: "unavailable",
    geometry: "derived",
  });
});
