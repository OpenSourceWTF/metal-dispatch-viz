import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const readmeUrl = new URL("../README.md", import.meta.url);

test("package contract locks the minimal Node/Express runtime", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.engines, { node: ">=18" });
  assert.deepEqual(packageJson.scripts, {
    start: "node server.mjs",
    test: "node --test",
  });
  assert.deepEqual(packageJson.dependencies, {
    express: "5.2.1",
  });
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.optionalDependencies, undefined);
  assert.equal(packageJson.peerDependencies, undefined);
});

test("README documents help and the visible-timeline AI export contract", async () => {
  const readme = await readFile(readmeUrl, "utf8");

  for (const requiredGuidance of [
    /Field manual/i,
    /contextual definitions/i,
    /visible timeline/i,
    /Prompt \+ data/i,
    /Structured (?:data|JSON)/i,
    /local-only/i,
    /clipp(?:ed|ing)/i,
    /ordered placement/i,
    /schema v1/i,
    /search runs/i,
    /drag to zoom/i,
    /shift-drag to pan/i,
  ]) {
    assert.match(readme, requiredGuidance);
  }

  const exportSection = readme.match(
    /## Export the visible timeline\n([\s\S]+?)(?=\n## )/,
  )?.[1];
  assert.ok(exportSection);
  assert.match(exportSection, /local-only/i);
  assert.match(exportSection, /does not call a model/i);
  assert.match(exportSection, /does not [^.]*upload/i);
  assert.match(exportSection, /aggregate visible placed-dispatch counts/i);
  assert.match(exportSection, /kernel-family totals/i);
  assert.match(exportSection, /ordered-placement provenance/i);
  assert.match(
    exportSection,
    /individual dispatch records (?:and|or) positions are not exported/i,
  );
  assert.match(
    exportSection,
    /narrow screens[^.]*horizontally visible scroller\s+subsection/i,
  );
  assert.match(exportSection, /displayed sample records/i);
  assert.match(
    exportSection,
    /exact viewport totals[^.]*unavailable[^.]*null/i,
  );
  assert.match(
    exportSection,
    /selected-launch headline\s+aggregates remain exact/i,
  );
});
