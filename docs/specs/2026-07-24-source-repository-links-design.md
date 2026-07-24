# Source Repository Links Design

## Scope

Add persistent links from the workbench to the two public repositories that
produce and display its data:

- Visualizer: `https://github.com/OpenSourceWTF/metal-dispatch-viz`
- Profiler: `https://github.com/OpenSourceWTF/mlx-profiler`

The links belong in the existing evidence footer, where provenance and
read-only behavior are already disclosed. This keeps repository navigation
available without competing with the header's primary workbench controls.

## Design

The footer gains a semantic navigation group labeled `Source repositories`.
It contains two concise external links:

- `Visualizer ↗`
- `Profiler ↗`

The links use the existing compact, technical visual system: monospace text,
cyan interaction color, square corners, and rule-based separation. They wrap
as a group on narrow screens and retain a visible keyboard focus state.

## Interfaces and behavior

- Use a real `<nav>` with an accessible label.
- Use ordinary `<a>` elements so links work without JavaScript.
- Open repositories in a new tab with `target="_blank"`.
- Include `rel="noopener noreferrer"` on both external links.
- Give each link an accessible label that includes the repository name and
  states that it opens in a new tab.
- Do not add a menu, tooltip, icon dependency, runtime state, or controller
  integration.

## Error handling

The repository URLs are static and verified as public. If GitHub is
unavailable, browser-native link behavior applies; the workbench itself is
unaffected.

## Testing

- React shell coverage asserts both canonical URLs, semantic navigation, safe
  external-link attributes, and accessible labels.
- UI contract coverage asserts the source-link group wraps and provides a
  visible focus treatment.
- Run the focused React and UI contract tests during implementation.
- Run the full test suite and production build at the commit gate.

## Non-goals

- No GitHub API calls, repository status, stars, or dynamic metadata.
- No header redesign or additional navigation hierarchy.
- No changes to profiler output or trace loading.

## Failure-mode check

1. **Wrong or private repository URL — critical.** Both canonical GitHub URLs
   were verified as public before design approval.
2. **New-tab opener access — critical.** Both links require
   `rel="noopener noreferrer"`.
3. **Footer crowding on mobile — minor.** The group wraps onto its own line
   rather than clipping or forcing horizontal scrolling.

## Rollout

This is a static, backward-compatible shell change with no migration or
deployment dependency. The local server can be rebuilt and restarted after
merge.
