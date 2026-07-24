import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readProjectFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("components.json declares a JavaScript Vite project with stable aliases", async () => {
  const configuration = JSON.parse(await readProjectFile("components.json"));

  assert.equal(configuration.$schema, "https://ui.shadcn.com/schema.json");
  assert.equal(configuration.style, "new-york");
  assert.equal(configuration.rsc, false);
  assert.equal(configuration.tsx, false);
  assert.deepEqual(configuration.tailwind, {
    config: "",
    css: "src/index.css",
    baseColor: "neutral",
    cssVariables: true,
    prefix: "",
  });
  assert.equal(configuration.iconLibrary, "lucide");
  assert.deepEqual(configuration.aliases, {
    components: "@/components",
    utils: "@/lib/utils",
    ui: "@/components/ui",
    lib: "@/lib",
    hooks: "@/hooks",
  });
});

test("Vite and JavaScript tooling resolve the same source alias", async () => {
  const [viteSource, jsconfigSource] = await Promise.all([
    readProjectFile("vite.config.js"),
    readProjectFile("jsconfig.json"),
  ]);
  const jsconfig = JSON.parse(jsconfigSource);

  assert.match(viteSource, /import tailwindcss from ["']@tailwindcss\/vite["']/);
  assert.match(viteSource, /plugins:\s*\[react\(\),\s*tailwindcss\(\)\]/);
  assert.match(
    viteSource,
    /["@']@["']:\s*fileURLToPath\(new URL\(["']\.\/src["'],\s*import\.meta\.url\)\)/,
  );
  assert.deepEqual(jsconfig.compilerOptions.paths, {
    "@/*": ["./src/*"],
  });
  assert.equal(jsconfig.compilerOptions.baseUrl, ".");
  assert.deepEqual(jsconfig.include, ["src"]);
});

test("compatibility CSS loads before profiler CSS and bridges the existing theme", async () => {
  const [entrySource, compatibilityCss] = await Promise.all([
    readProjectFile("src/main.jsx"),
    readProjectFile("src/index.css"),
  ]);

  assert.ok(
    entrySource.indexOf('import "./index.css"') <
      entrySource.indexOf('import "../public/styles.css"'),
  );
  assert.match(
    compatibilityCss,
    /@import ["']tailwindcss\/theme\.css["'] layer\(theme\);/,
  );
  assert.match(
    compatibilityCss,
    /@import ["']tailwindcss\/utilities\.css["'] layer\(utilities\);/,
  );
  assert.match(compatibilityCss, /@import ["']tw-animate-css["'];/);
  assert.doesNotMatch(compatibilityCss, /@import ["']shadcn\//);
  assert.match(
    compatibilityCss,
    /@custom-variant dark \(&:where\(\[data-theme=["']dark["']\]/,
  );
  for (const bridge of [
    /--background:\s*var\(--canvas\)/,
    /--foreground:\s*var\(--text\)/,
    /--card:\s*var\(--panel\)/,
    /--border:\s*var\(--rule\)/,
    /--ring:\s*var\(--selection\)/,
  ]) {
    assert.match(compatibilityCss, bridge);
  }
  assert.doesNotMatch(compatibilityCss, /@layer\s+base/);
});

test("cn helper composes conditional classes and resolves Tailwind conflicts", async () => {
  const { cn } = await import("../src/lib/utils.js");

  assert.equal(cn("px-2", false && "hidden", ["py-1"]), "px-2 py-1");
  assert.equal(cn("px-2", "px-4"), "px-4");
});
