import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJsonUrl = new URL("../package.json", import.meta.url);

test("package contract locks the React profiler toolchain", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

  assert.equal(packageJson.private, true);
  assert.equal(packageJson.type, "module");
  assert.deepEqual(packageJson.engines, {
    node: "^20.19.0 || ^22.13.0 || >=24.0.0",
  });
  assert.deepEqual(packageJson.scripts, {
    build: "vite build && node scripts/build_hosted.mjs",
    start: "npm run build && node server.mjs",
    test: "node --test && vitest run",
  });
  assert.deepEqual(packageJson.dependencies, {
    express: "5.2.1",
    react: "19.2.8",
    "react-dom": "19.2.8",
  });
  assert.deepEqual(packageJson.devDependencies, {
    "@vitejs/plugin-react": "6.0.4",
    jsdom: "29.1.1",
    vite: "8.1.5",
    vitest: "4.1.10",
    yaml: "2.9.0",
  });
  assert.equal(packageJson.optionalDependencies, undefined);
  assert.equal(packageJson.peerDependencies, undefined);
});
