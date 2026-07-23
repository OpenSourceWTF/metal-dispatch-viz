import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOSSARY,
  glossaryEntry,
  searchGlossary,
} from "../public/glossary.js";

const REQUIRED_TERM_IDS = [
  "wall-span",
  "exposed-host",
  "hidden-host",
  "gpu-busy",
  "gpu-work",
  "decision-drain",
  "cap-wait",
  "dependency-wait",
  "command-buffer",
  "dispatch",
  "kernel-family",
  "setbytes-call",
  "setbytes-bytes",
  "buffer-bind",
  "host-encode",
  "gpu-execute",
  "ordered-placement",
  "dispatch-density",
  "wait-taxonomy",
  "scheduler-backpressure",
  "worker-wait",
  "measured",
  "derived",
  "ordered",
  "counted",
  "metadata",
  "complete",
  "incomplete",
  "legacy-unverifiable",
  "unsupported",
];

const MEASUREMENT_IDS = [
  "wall-span",
  "exposed-host",
  "hidden-host",
  "gpu-busy",
  "gpu-work",
  "decision-drain",
  "cap-wait",
  "dependency-wait",
  "setbytes-call",
  "setbytes-bytes",
  "buffer-bind",
  "dispatch-density",
];

test("covers every required profiler term with immutable definitions", () => {
  assert.deepEqual(Object.keys(GLOSSARY).sort(), [...REQUIRED_TERM_IDS].sort());
  assert.equal(Object.isFrozen(GLOSSARY), true);

  for (const id of REQUIRED_TERM_IDS) {
    const entry = glossaryEntry(id);
    assert.equal(entry.id, id);
    assert.equal(typeof entry.label, "string");
    assert.ok(entry.label.trim());
    assert.equal(typeof entry.definition, "string");
    assert.ok(entry.definition.trim());
    assert.equal(Object.isFrozen(entry), true);
  }

  assert.equal(glossaryEntry("does-not-exist"), null);
  assert.equal(glossaryEntry("__proto__"), null);
  assert.equal(glossaryEntry("constructor"), null);
});

test("measurement definitions state their method and evidence provenance", () => {
  for (const id of MEASUREMENT_IDS) {
    const entry = GLOSSARY[id];
    assert.equal(typeof entry.method, "string", `${id} method`);
    assert.ok(entry.method.trim(), `${id} method`);
    assert.equal(typeof entry.provenance, "string", `${id} provenance`);
    assert.ok(entry.provenance.trim(), `${id} provenance`);
  }

  assert.equal(GLOSSARY["wall-span"].provenance, "measured");
  assert.equal(GLOSSARY["gpu-busy"].provenance, "derived");
  assert.match(GLOSSARY["ordered-placement"].limitation, /not measured/i);
});

test("glossary lookup and search are case-insensitive without exposing mutable arrays", () => {
  assert.equal(glossaryEntry("  GPU-BUSY  "), GLOSSARY["gpu-busy"]);

  const gpuMatches = searchGlossary("GPU");
  assert.equal(Object.isFrozen(gpuMatches), true);
  assert.ok(gpuMatches.some((entry) => entry.id === "gpu-busy"));
  assert.ok(
    searchGlossary("outside gpu").some((entry) => entry.id === "exposed-host"),
  );
  assert.ok(
    searchGlossary("PRODUCER/CONSUMER").some(
      (entry) => entry.id === "dependency-wait",
    ),
  );
  assert.ok(
    searchGlossary("INTERPOLATED").some(
      (entry) => entry.id === "ordered-placement",
    ),
  );

  const allEntries = searchGlossary("  ");
  assert.equal(Object.isFrozen(allEntries), true);
  assert.equal(allEntries.length, REQUIRED_TERM_IDS.length);
});

test("glossary search uses locale-independent English case normalization", () => {
  const originalToLocaleLowerCase = String.prototype.toLocaleLowerCase;
  String.prototype.toLocaleLowerCase = () => {
    throw new Error("locale-dependent normalization must not be used");
  };

  try {
    assert.ok(
      searchGlossary("GPU").some((entry) => entry.id === "gpu-busy"),
    );
  } finally {
    String.prototype.toLocaleLowerCase = originalToLocaleLowerCase;
  }
});
