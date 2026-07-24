# Searchable Runs Repair and shadcn/Vite Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:executing-plans to implement this plan task-by-task.

**Goal:** Make the run selector a complete accessible searchable combobox and prepare the existing JavaScript React/Vite application for shadcn/ui components without changing the profiler's current controller or visual system.

**Architecture:** Combobox interaction state stays inside the existing `bootstrap()` lifecycle in `public/app.js`; opaque trace IDs and the current `selectTrace()` coordinator remain the only trace-selection authority. Tailwind v4 and shadcn compatibility are additive build configuration: a small compatibility stylesheet loads before the current profiler stylesheet, aliases point into `src`, and no existing interface is migrated to generated components.

**Tech Stack:** React 19, Vite 8, browser JavaScript modules, Tailwind CSS 4, shadcn CLI, Vitest/Node test runner, jsdom.

**Assumptions:** Registry metadata is available before trace contents; search remains metadata-only. The current `data-theme` attribute and profiler CSS variables remain the visual-theme authority.

---

### Task 1: Lock the broken combobox interaction in regression tests

**Files:**
- Modify: `test/app-integration.test.mjs`
- Modify: `test/ui-contract.test.mjs`

**Security flag:** none

**Does NOT cover:** Searching trace event contents or loading a trace while the user types.

- [x] Add a bootstrap integration test that focuses `#trace-search`, verifies the listbox opens with every registry item, types a metadata query, and verifies the rendered result updates without changing the selected trace:

  ```js
  elements["trace-search"].focus();
  elements["trace-search"].dispatch("focus");
  assert.equal(elements["trace-track"].hidden, false);
  assert.equal(elements["trace-search"].getAttribute("aria-expanded"), "true");

  elements["trace-search"].value = "hy3";
  elements["trace-search"].dispatch("input");
  assert.deepEqual(optionLabels(elements["trace-track"]), ["Hy3 2Q"]);
  assert.equal(elements["selected-trace-summary"].textContent, selectedBefore);
  ```

- [x] Extend the same test through keyboard behavior: Arrow Down/Up wraps the active option, `aria-activedescendant` references a stable option ID, Enter selects through the existing registry route, Escape restores the selected label without selection, Tab closes without `preventDefault()`, and Enter is a no-op for zero results.
- [x] Add pointer and lifecycle cases: clicking an option selects it, an outside `pointerdown` closes the list, refresh preserves a surviving opaque trace ID and reapplies an open query, and `destroy()` removes the listeners so a later bootstrap cannot duplicate them.
- [x] Add UI-contract assertions for the combobox/listbox relationship, stable option-ID prefix, active-option styling hook, and bounded narrow-width result panel.
- [x] Run the focused tests and record that they fail because the current input has no interaction listeners:

  ```bash
  node --test test/app-integration.test.mjs test/ui-contract.test.mjs
  ```

- [x] Commit the red tests:

  ```bash
  git add test/app-integration.test.mjs test/ui-contract.test.mjs
  git commit -m "test: cover searchable run interaction"
  ```

### Task 2: Implement the searchable combobox in the existing controller

**Files:**
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Test: `test/app-integration.test.mjs`
- Test: `test/ui-contract.test.mjs`

**Security flag:** none

**Does NOT cover:** Replacing trace selection, registry refresh, or asynchronous trace loading with React state.

- [x] Add lifecycle-owned combobox state beside the existing bootstrap state:

  ```js
  const runSearch = {
    open: false,
    query: "",
    activeId: null,
  };
  ```

- [x] Give every rendered result a deterministic ID derived from its opaque trace ID, expose the keyboard-active result separately from `aria-selected`, and keep `renderRegistry()` responsible for filtering the latest registry:

  ```js
  function traceOptionDomId(traceId) {
    return `trace-option-${encodeURIComponent(traceId)
      .replaceAll("%", "_")
      .replaceAll(".", "_")}`;
  }

  button.id = traceOptionDomId(trace.id);
  button.dataset.active = String(trace.id === runSearch.activeId);
  ```

- [x] Add small controller helpers for `openRunSearch`, `closeRunSearch`, `setRunSearchQuery`, `moveRunSearchActive`, and `commitRunSearch`. Opening clears the query and selects the displayed label for replacement; input filtering never calls `selectTrace()`.
- [x] Register `focus`, `pointerdown`, `input`, and `keydown` on the combobox and an outside `pointerdown` on `document`. Required key contract:

  ```js
  switch (event.key) {
    case "ArrowDown":
    case "ArrowUp":
      event.preventDefault();
      moveRunSearchActive(event.key === "ArrowDown" ? 1 : -1);
      break;
    case "Enter":
      if (runSearch.open && runSearch.activeId) {
        event.preventDefault();
        commitRunSearchActive();
      }
      break;
    case "Escape":
      event.preventDefault();
      closeRunSearch({ restoreLabel: true });
      break;
    case "Tab":
      closeRunSearch({ restoreLabel: false });
      break;
  }
  ```

- [x] Route pointer and keyboard commits through the current option-click selection callback so there remains exactly one trace-selection path.
- [x] On registry refresh, retain `activeId` only when it is still visible; otherwise choose the selected visible trace or the first visible trace. With no matches, remove `aria-activedescendant` and retain the loaded run.
- [x] Remove the obsolete rail keydown behavior, and remove every added listener in the existing idempotent `destroy()` without changing BFCache `pagehide` handling.
- [x] Add only the styling needed to make the active option visible and keep the result panel usable at narrow widths; preserve the existing instrument visual system.
- [x] Run the focused tests until green:

  ```bash
  node --test test/app-integration.test.mjs test/ui-contract.test.mjs
  ```

- [x] Commit the behavior:

  ```bash
  git add public/app.js public/styles.css test/app-integration.test.mjs test/ui-contract.test.mjs
  git commit -m "fix: complete searchable run combobox"
  ```

### Task 3: Add a shadcn-compatible JavaScript React/Vite foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.js`
- Modify: `src/main.jsx`
- Add: `components.json`
- Add: `jsconfig.json`
- Add: `src/index.css`
- Add: `src/lib/utils.js`
- Modify: `test/package-contract.test.mjs`
- Add: `test/shadcn-compatibility.test.mjs`

**Security flag:** dependency changes; audit before publication.

**Does NOT cover:** Generating or adopting a shadcn component, TypeScript conversion, or restyling the profiler.

- [x] Write failing package/config tests for exact versions and the required project contract:

  ```json
  {
    "dependencies": {
      "clsx": "2.1.1",
      "tailwind-merge": "3.6.0",
      "tw-animate-css": "1.4.0"
    },
    "devDependencies": {
      "@tailwindcss/vite": "4.3.3",
      "tailwindcss": "4.3.3"
    }
  }
  ```

  The tests must also assert the Vite Tailwind plugin, the `@/*` alias in both Vite and `jsconfig.json`, the JavaScript/no-RSC `components.json` contract, import ordering in `src/main.jsx`, the dark custom variant, semantic-token bridge, and `cn()` class merging.

- [x] Run the config tests and confirm they fail because the compatibility files and dependencies do not exist:

  ```bash
  node --test test/package-contract.test.mjs test/shadcn-compatibility.test.mjs
  ```

- [x] Install the exact baseline dependencies:

  ```bash
  npm install --save-exact clsx@2.1.1 tailwind-merge@3.6.0 tw-animate-css@1.4.0
  npm install --save-dev --save-exact @tailwindcss/vite@4.3.3 tailwindcss@4.3.3
  ```

- [x] Keep `shadcn@4.14.1` as an explicit `npx` tool rather than a project dependency. Its current MCP dependency requires a Hono 1.x adapter affected by GHSA-frvp-7c67-39w9, while the build and generated components do not require the CLI package.
- [x] Configure Vite without requiring Node type packages:

  ```js
  import tailwindcss from "@tailwindcss/vite";

  export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    // Preserve the existing base, publicDir, build, and test settings.
  });
  ```

- [x] Add `jsconfig.json` with `baseUrl: "."`, `@/*: ["./src/*"]`, and `src` included. Add `components.json` using the official schema, `style: "new-york"`, `rsc: false`, `tsx: false`, `tailwind.css: "src/index.css"`, CSS variables, neutral base color, Lucide icons, and aliases for components, UI, lib, utils, and hooks.
- [x] Add the conventional helper:

  ```js
  import { clsx } from "clsx";
  import { twMerge } from "tailwind-merge";

  export function cn(...inputs) {
    return twMerge(clsx(inputs));
  }
  ```

- [x] Add `src/index.css` with Tailwind and animation utility imports; map shadcn semantic variables to the profiler's existing tokens; and use the existing theme authority:

  ```css
  @layer theme, components, utilities;
  @import "tailwindcss/theme.css" layer(theme);
  @import "tailwindcss/utilities.css" layer(utilities);
  @import "tw-animate-css";

  @custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

  :root {
    --background: var(--canvas);
    --foreground: var(--text);
    --card: var(--panel);
    --card-foreground: var(--text);
    --border: var(--line);
    --input: var(--line);
    --ring: var(--accent);
  }
  ```

  Import Tailwind's theme and utilities explicitly without Preflight. A full
  `@import "tailwindcss"` resets the Field Manual's ordered and unordered list
  markers and therefore competes with the current profiler rules.

- [x] Import `./index.css` before `../public/styles.css` in `src/main.jsx`.
- [x] Run the config tests, CLI inspection, and no-write component resolution:

  ```bash
  node --test test/package-contract.test.mjs test/shadcn-compatibility.test.mjs
  npx --yes shadcn@4.14.1 info --json
  npx --yes shadcn@4.14.1 add button --dry-run
  git status --short
  ```

  Confirm the dry run leaves only the intended implementation changes.

- [x] Audit the new dependency graph:

  ```bash
  npm audit
  npm ls --all
  ```

- [x] Commit the compatibility foundation:

  ```bash
  git add package.json package-lock.json vite.config.js src/main.jsx components.json jsconfig.json src/index.css src/lib/utils.js test/package-contract.test.mjs test/shadcn-compatibility.test.mjs
  git commit -m "build: add shadcn-compatible vite foundation"
  ```

### Task 4: Document, verify, review, and publish

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-07-23-searchable-runs-shadcn-compatibility.md`
- Test: `test/package-contract.test.mjs`

**Security flag:** publication; do not merge without explicit approval.

- [x] Add a failing documentation assertion that the README explains local shadcn component generation and records that the current profiler interface remains controller-owned.
- [x] Update the README with the searchable selector controls and the exact future component command:

  ```bash
  npx --yes shadcn@4.14.1 add button
  ```

- [x] Run the full local gate:

  ```bash
  npm test
  npm run build
  npm run verify:pages
  npm audit
  git diff --check
  ```

- [x] Start the production preview and verify in a real browser at desktop and narrow widths:
  - focus opens the full run list;
  - typing `Hy3` immediately filters to Hy3 2Q without loading it;
  - Arrow Down and Enter load the active run;
  - Escape and outside pointer dismiss without changing the run;
  - Tab moves focus normally;
  - the theme toggle and timeline remain visually unchanged;
  - the result panel remains inside the viewport at 390 px width.
- [x] Capture before/after screenshots and compare the surrounding layout for unexplained Tailwind preflight regressions.
- [x] Review the complete diff against the approved design, run focused code and adversarial reviews, and resolve the reported Tailwind Preflight and keyboard-active contrast findings.
- [x] Mark completed plan boxes, commit documentation, and verify the worktree:

  ```bash
  git add README.md docs/plans/2026-07-23-searchable-runs-shadcn-compatibility.md docs/specs/2026-07-23-searchable-runs-shadcn-compatibility-design.md test/app-integration.test.mjs test/package-contract.test.mjs
  git commit -m "docs: describe searchable runs and shadcn setup"
  git status --short --branch
  ```

- [ ] Push `fix/searchable-runs-shadcn` and open a pull request summarizing the confirmed production defect, interaction repair, shadcn compatibility boundary, test evidence, browser evidence, and dependency audit. Do not merge the pull request without explicit approval.
