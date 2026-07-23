import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJsonUrl = new URL("../package.json", import.meta.url);

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
