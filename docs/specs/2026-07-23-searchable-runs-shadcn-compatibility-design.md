# Searchable Runs Repair and shadcn/Vite Compatibility Design

Date: 2026-07-23

## Purpose

Repair the searchable run selector merged in PR #5 and make the existing
React/Vite application a valid shadcn/ui target without replacing the
profiler's established controller, worker, timeline, or visual system.

## Confirmed failure

The merged selector contains the expected combobox input, listbox, option
rendering, and pure metadata filter, but no behavior opens the listbox or reacts
to user input:

- `#trace-search` is only read while `renderRegistry()` is already running;
- no `focus`, `click`, `input`, or `keydown` listener is registered;
- no outside-pointer or Tab dismissal is registered;
- no active-option state or `aria-activedescendant` is maintained;
- the tests assert filter output and static roles, but not an actual user
  interaction.

The deployed PR #5 artifact reproduces the defect: after typing `Hy3` and
pressing Arrow Down, `#trace-track` remains hidden, its rendered option remains
the previously selected GLM run, and `aria-expanded` remains `false`.

## Scope

This change:

- restores the complete searchable combobox interaction described by the
  existing searchable-runs design;
- preserves the existing opaque trace-ID selection and asynchronous loading
  authority;
- adds real DOM and production-browser regression coverage;
- configures the JavaScript React/Vite project as a shadcn/ui-compatible
  existing Vite application;
- bridges shadcn semantic theme variables to the current measured visual
  tokens and `data-theme` dark-mode contract;
- proves the shadcn CLI can inspect the project and resolve an install with a
  dry run.

It does not:

- search inside trace contents;
- load a run merely because the query changes;
- migrate the run selector or the rest of the workbench to shadcn components;
- move trace parsing, exact analysis, or timeline state into React;
- convert the project to TypeScript;
- replace the current instrument visual system with a stock shadcn theme.

## Run selector behavior

### State

Combobox interaction state is separate from trace selection state:

- `open`: whether the listbox is exposed;
- `query`: the current user-entered metadata query;
- `activeId`: the opaque trace ID of the keyboard-active visible result.

The existing registry selection guard remains authoritative for the loaded run.
Typing and keyboard movement never call `selectTrace()`.

### Opening and querying

- Focus or pointer activation opens the listbox.
- Opening a closed selector with the selected run label displayed uses an empty
  query and renders every run in registry order.
- The displayed selected label is selected as text so the first typed character
  replaces it.
- An `input` event updates `query`, opens the listbox, filters locally, and
  rerenders immediately.
- Filtering remains case-insensitive, tokenized, and metadata-only.
- `No runs match this search.` leaves the currently loaded run unchanged.

### Keyboard and pointer interaction

- Arrow Down and Arrow Up open the list when necessary and move the active
  option with wraparound.
- The active option receives a stable DOM ID; the input exposes it through
  `aria-activedescendant`.
- Enter selects only the active option.
- Escape closes without changing the run and restores the selected run label.
- Tab closes without preventing normal focus movement.
- Pointer selection uses the same existing `selectTrace()` route as keyboard
  selection.
- A pointer press outside the combobox closes it without stealing focus from
  the newly pressed control.

### Refresh and teardown

- While open, a registry refresh reruns the current query against the refreshed
  registry and retains `activeId` when it remains visible.
- When the selected trace survives refresh, its opaque ID remains selected.
- When the selected trace disappears, the existing deterministic fallback
  policy remains authoritative.
- Controller destruction removes every newly registered listener.
- BFCache-preserving `pagehide` behavior remains unchanged.

## shadcn/Vite compatibility

The project follows the official existing-Vite setup while remaining a
JavaScript application:

- Tailwind CSS v4 and the Vite Tailwind plugin are configured in
  `vite.config.js`.
- `@/*` resolves to `src/*` in both Vite and `jsconfig.json`.
- `components.json` declares the supported shadcn schema, JavaScript output
  (`tsx: false`), no React Server Components, CSS variables, the global CSS
  entrypoint, and `@/components`, `@/components/ui`, `@/lib`,
  `@/lib/utils`, and `@/hooks` aliases.
- `src/lib/utils.js` exports the conventional `cn()` helper using `clsx` and
  `tailwind-merge`.
- `src/index.css` imports Tailwind and the animation utilities, defines shadcn
  semantic tokens in terms of the existing profiler tokens, and maps dark
  variants to `[data-theme="dark"]`.
- `src/main.jsx` imports the compatibility stylesheet before the existing
  profiler stylesheet so the profiler's current rules remain authoritative.

The compatibility gate is:

1. `npx --yes shadcn@4.14.1 info --json` resolves the project as React/Vite,
   JavaScript, Tailwind v4, and the declared aliases.
2. `npx --yes shadcn@4.14.1 add button --dry-run` resolves the target paths and
   dependencies without modifying the worktree.
3. The production bundle and existing Pages verifier still pass.

## Dependency boundary

Only baseline shadcn compatibility dependencies are installed. Component-
specific primitives are not added until a real component is selected in a
future change. Every package is exact-version pinned and audited under the
repository's existing dependency contract.

The shadcn CLI itself remains a pinned `npx` tool rather than a project
dependency. Version 4.14.1 currently pulls an MCP SDK whose Hono 1.x adapter is
affected by GHSA-frvp-7c67-39w9 and has no compatible patched transitive
release. The CLI is used only for explicit inspection and generation; the
runtime and build remain audit-clean without it.

## Error handling

- An unavailable registry keeps the combobox disabled and closed.
- Empty registries retain the existing honest empty state.
- A query with no visible option clears the active descendant.
- Enter with no active option is a no-op.
- Dismissal never initiates trace I/O.
- shadcn CLI incompatibility fails the compatibility test rather than silently
  producing files in unexpected locations.

## Testing strategy

Tests are written before production changes:

- pure state tests cover opening, query replacement, active-option movement,
  wraparound, selection, dismissal, refresh, and no-results behavior;
- bootstrap integration tests dispatch real focus, input, keydown, pointer, and
  teardown events against the rendered React shell;
- accessibility tests cover `aria-expanded`, `aria-selected`,
  `aria-activedescendant`, listbox visibility, and stable option IDs;
- package/config tests cover exact dependencies, Tailwind plugin wiring,
  aliases, `components.json`, theme bridging, and the `cn()` helper;
- browser tests cover pointer and keyboard selection at desktop and narrow
  widths;
- full tests, build, Pages verification, audit, dependency tree, and CLI
  compatibility gates run before publication.

## Failure-mode review

### Critical: duplicate listeners or stale closures after React lifecycle reuse

All combobox listeners are registered through the existing bootstrap lifecycle
and removed by its idempotent `destroy()`. Integration coverage destroys and
recreates the controller, then proves one interaction produces one selection.

### Critical: opening shows only the selected run

The displayed selected label and the active query are intentionally separate.
Opening uses an empty query while selecting the displayed label for replacement.
Tests require all runs to appear before the first edit.

### Critical: Tailwind preflight changes the profiler layout

The compatibility stylesheet imports Tailwind's theme and utilities without
Preflight, then loads before the existing visual system. This preserves Field
Manual list markers and the profiler's established element defaults. Desktop
and narrow screenshot comparisons plus the existing UI contract must remain
stable. Any unexplained layout delta blocks publication.

### Critical: theme ownership diverges

shadcn variables reference existing profiler variables, and the dark variant
uses the current `data-theme` attribute. The app retains a single theme
authority.

### Minor: the repaired selector is not itself a generated shadcn component

This is intentional. Migrating the selector would split or relocate trace
selection authority and is a separate architectural change. This round makes
future shadcn components installable without risking profiler behavior.

## Rollout

The work ships from a new branch based on current `main`. It receives local and
browser verification before a pull request. After merge, the GitHub Pages
workflow republishes the app. The existing Sites deployment remains available
as rollback during the custom-domain DNS and certificate transition.

## References

- https://ui.shadcn.com/docs/installation/vite
- https://ui.shadcn.com/docs/components-json
- https://ui.shadcn.com/docs/cli
