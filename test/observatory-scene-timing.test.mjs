import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  frameIndexFromProgress,
  nextObservatoryFrameIndex,
  observatoryFrameStride,
  observatoryPixelRatio,
  shouldAnimateObservatory,
} from "../src/observatory/scene-timing.js";

test("only a visible, motion-enabled Observatory runs continuously", () => {
  assert.equal(
    shouldAnimateObservatory({
      active: true,
      reducedMotion: false,
      visible: true,
    }),
    true,
  );
  assert.equal(
    shouldAnimateObservatory({ reducedMotion: true, visible: true }),
    false,
  );
  assert.equal(
    shouldAnimateObservatory({
      active: false,
      reducedMotion: false,
      visible: true,
    }),
    false,
  );
  assert.equal(
    shouldAnimateObservatory({ reducedMotion: false, visible: false }),
    false,
  );
});

test("gallery playback samples an entire long launch within its slot", () => {
  assert.equal(
    observatoryFrameStride({
      frameCount: 1_957,
      frameDelayMs: 140,
      galleryDurationMs: 18_000,
    }),
    16,
  );
  assert.equal(
    observatoryFrameStride({
      frameCount: 2,
      frameDelayMs: 140,
      galleryDurationMs: 18_000,
    }),
    1,
  );
});

test("playback and scrubbing stay within the captured window", () => {
  assert.equal(
    nextObservatoryFrameIndex({
      current: 8,
      frameCount: 10,
      stride: 4,
    }),
    9,
  );
  assert.equal(
    nextObservatoryFrameIndex({
      current: -10,
      frameCount: 10,
      stride: 2,
    }),
    2,
  );
  assert.equal(
    frameIndexFromProgress({
      frameCount: 10,
      progress: 0.5,
    }),
    5,
  );
  assert.equal(
    frameIndexFromProgress({
      frameCount: 10,
      progress: 2,
    }),
    9,
  );
  assert.equal(frameIndexFromProgress({ frameCount: 0, progress: 0.5 }), 0);
});

test("a responsive resize explicitly invalidates a static WebGL frame", async () => {
  const source = await readFile(
    new URL("../src/observatory/ObservatoryScene.jsx", import.meta.url),
    "utf8",
  );
  const resizeStart = source.indexOf("    const resize = () => {");
  const resizeEnd = source.indexOf("\n    };", resizeStart);
  const resizeSource = source.slice(resizeStart, resizeEnd);
  assert.match(
    resizeSource,
    /camera\.updateProjectionMatrix\(\);[\s\S]*?renderRequestRef\.current\?\.\(\);/,
  );
});

test("the readable theater uses a fixed orthographic camera", async () => {
  const source = await readFile(
    new URL("../src/observatory/ObservatoryScene.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /new THREE\.OrthographicCamera\(/);
  assert.doesNotMatch(source, /new THREE\.PerspectiveCamera\(/);
  assert.doesNotMatch(
    source,
    /camera\.position\.x\s*=\s*Math\.sin/,
  );
});

test("runtime WebGL loss switches to the structured fallback and cleans up", async () => {
  const source = await readFile(
    new URL("../src/observatory/ObservatoryScene.jsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /addEventListener\("webglcontextlost", onContextLost\)/);
  assert.match(
    source,
    /onContextLost[\s\S]*?preventDefault\(\)[\s\S]*?setFailure\(/,
  );
  assert.match(
    source,
    /removeEventListener\(\s*"webglcontextlost",\s*onContextLost/,
  );
});

test("Retina rendering stays within X web video dimensions", () => {
  const pixelRatio = observatoryPixelRatio({
    devicePixelRatio: 2,
    width: 1_164,
    height: 776,
  });
  assert.ok(1 < pixelRatio && pixelRatio < 2);
  assert.ok(1_164 * pixelRatio <= 1_920);
  assert.ok(776 * pixelRatio <= 1_200);
  assert.equal(
    observatoryPixelRatio({
      devicePixelRatio: 2,
      width: 375,
      height: 450,
    }),
    2,
  );
});
