# Source Repository Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-optimized:subagent-driven-development (recommended) or superpowers-optimized:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accessible, responsive links to the visualizer and profiler GitHub repositories in the workbench footer.

**Architecture:** Extend the static React shell footer with a semantic source-repository navigation group. Style it inside the existing instrument design system; no controller state, GitHub API calls, or new dependencies are involved.

**Tech Stack:** React, CSS, Vitest, Node test runner.

---

## File structure

- `src/ProfilerApp.jsx` — renders the semantic repository navigation and links.
- `public/styles.css` — provides compact footer link layout, interaction, focus, and responsive wrapping.
- `test/react-shell.test.jsx` — verifies URLs, semantics, safe external-link attributes, and accessible labels.
- `test/ui-contract.test.mjs` — verifies wrapping and visible keyboard focus styling.

### Task 1: Add and style source repository navigation

**Files:**
- Modify: `src/ProfilerApp.jsx`
- Modify: `public/styles.css`
- Test: `test/react-shell.test.jsx`
- Test: `test/ui-contract.test.mjs`

**Security flag:** `none`

- [ ] **Step 1: Write failing React shell test**

Add a test that renders `ProfilerApp`, selects
`nav[aria-label="Source repositories"]`, and asserts:

```jsx
const links = [...sourceNav.querySelectorAll("a")];
expect(links.map(({ href }) => href)).toEqual([
  "https://github.com/OpenSourceWTF/metal-dispatch-viz",
  "https://github.com/OpenSourceWTF/mlx-profiler",
]);
for (const link of links) {
  expect(link.target).toBe("_blank");
  expect(link.rel).toBe("noopener noreferrer");
  expect(link.getAttribute("aria-label")).toMatch(/opens in a new tab/i);
}
```

- [ ] **Step 2: Write failing UI contract assertions**

Extend the visual-system contract to require:

```js
const sourceLinks = requireDeclarationRule(rules, ".source-repositories")[0];
assert.equal(sourceLinks.get("flex-wrap"), "wrap");
const sourceLinkFocus = requireDeclarationRule(
  rules,
  ".source-repository-link:focus-visible",
)[0];
assert.match(sourceLinkFocus.get("outline") ?? "", /var\(--focus\)/);
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npx vitest run test/react-shell.test.jsx
node --test test/ui-contract.test.mjs
```

Expected: FAIL because the source navigation and CSS rules do not exist.

- [ ] **Step 4: Implement the static source navigation**

Inside `.disclosure`, add:

```jsx
<nav className="source-repositories" aria-label="Source repositories">
  <span>Source</span>
  <a
    className="source-repository-link"
    href="https://github.com/OpenSourceWTF/metal-dispatch-viz"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Open the Metal Dispatch Visualizer repository on GitHub; opens in a new tab"
  >
    Visualizer <span aria-hidden="true">↗</span>
  </a>
  <a
    className="source-repository-link"
    href="https://github.com/OpenSourceWTF/mlx-profiler"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Open the MLX Profiler repository on GitHub; opens in a new tab"
  >
    Profiler <span aria-hidden="true">↗</span>
  </a>
</nav>
```

Add compact footer styling using existing color and typography tokens. The
group must use `display: flex`, `flex-wrap: wrap`, preserve visible focus with
`outline: 2px solid var(--focus)`, and avoid a fixed width so it can wrap
without horizontal overflow.

- [ ] **Step 5: Run focused verification**

Run:

```bash
npx vitest run test/react-shell.test.jsx
node --test test/ui-contract.test.mjs
```

Expected: both focused suites PASS.

- [ ] **Step 6: Run commit gate**

Run:

```bash
npm test
npm run build
git diff --check
```

Expected: all tests and production build PASS with no whitespace errors.

- [ ] **Step 7: Commit**

```bash
git add src/ProfilerApp.jsx public/styles.css test/react-shell.test.jsx test/ui-contract.test.mjs docs/plans/2026-07-24-source-repository-links.md
git commit -m "Add source repository links"
```
