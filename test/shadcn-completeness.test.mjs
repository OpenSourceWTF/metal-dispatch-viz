import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/ProfilerApp.jsx", import.meta.url);

test("the React workbench uses shadcn components instead of raw form and table primitives", async () => {
  const source = await readFile(sourceUrl, "utf8");

  for (const primitive of [
    "button",
    "input",
    "select",
    "textarea",
    "progress",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`<${primitive}\\b`),
      `raw <${primitive}> remains in ProfilerApp`,
    );
  }

  for (const customComponent of [
    "utility-drawer",
    "definition-tooltip",
    "definition-popover",
    "analysis-table-tabs",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`className=["'][^"']*${customComponent}`),
      `legacy ${customComponent} implementation remains`,
    );
  }
});
