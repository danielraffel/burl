# Proposal: Source-Aware and Scenario-Observed Native Migration

Status: Review draft, revision 2  
Audience: Burl/Pulp maintainers and independent architecture reviewers  
Decision requested: Approve, revise, or reject a time-boxed pre-schema feasibility study  
Reference revision: Burl `a22d776198f102179806f3eac5850a991dd4a48b`

## Executive summary

Burl should provide a native migration compiler, not promise an automatic converter for arbitrary web applications.

Two distinct product lanes are proposed:

1. **Source-aware migration** combines source adapters, authored tokens and components, explicit application bindings, and runtime evidence. This is the preferred lane when application source is available, including Palot.
2. **Scenario-observed migration** uses CDP and Playwright to reproduce an explicitly enumerated set of states and transitions. It never claims behavior equivalence outside covered scenarios.

Both lanes produce a canonical `SemanticApplicationIR`. That application IR references one or more versioned Pulp/Burl `DesignIR` documents as render projections; it does not make render-oriented DesignIR own application state, async behavior, or consumer logic.

No schema implementation or Palot restart is approved yet. First, six adversarial kill tests must establish whether the approach can preserve the required native behaviors without fixture-specific renderer code or a shipped browser runtime.

## Why the previous proposal was rejected

Runtime observation is incomplete by construction. Identical observed traces can conceal different timers, network outcomes, optimistic updates, rollback, cancellation, permissions, history, collaboration events, validation, and error paths. CDP captures runtime structure and computed results, not the authored program or complete responsive contract. Playwright executes scenarios; it does not infer a complete state machine.

The previous proposal also placed application semantics inside an additive DesignIR v2. That was the wrong ownership boundary. Current DesignIR is a render/import value tree with style, layout, content, assets, diagnostics, and limited specialized interactions. Application state, effects, data contracts, and lifecycle require a separate document with separate versioning and ownership.

## Product contract

### Source-aware migration

Inputs may include:

- application source and dependency graph;
- supported JSX/design adapters;
- authored CSS variables, token files, components, routes, and schemas;
- developer-authored behavior scenarios;
- explicit bindings for effects and data;
- runtime DOM/layout/accessibility snapshots and screenshots as evidence.

The compiler may translate only supported source constructs. Unsupported logic is reported with source locations and requires an explicit native binding or retained source-owned module. It must never infer hidden application behavior from pixels or traces.

### Scenario-observed migration

Inputs include a scenario manifest that names:

- initial data and environment;
- viewport, scale, locale, theme, and platform;
- ordered user and external events;
- expected semantic, visual, and data outcomes;
- allowed network and storage effects;
- cancellation/error branches;
- coverage boundary.

The output is guaranteed only for those scenarios and declared parameter ranges. Every unobserved transition is `unknown`, not inferred.

### Explicit non-claims

- The tool does not import arbitrary application semantics from a running page.
- Screenshot similarity does not prove behavioral equivalence.
- CDP computed layouts do not reveal authored CSS constraints.
- A browser automation trace is not a complete state model.
- Rich text, custom editors, virtualization, and composite accessibility widgets are not automatically portable.

## Architecture

```text
 source-aware evidence                scenario-observed evidence
 source AST / tokens / components     scenario manifest
 explicit actions and data bindings   CDP DOM/layout/AX snapshots
 runtime oracle                       Playwright traces/screenshots
                  \                   /
                   SemanticApplicationIR
                    - semantic nodes
                    - typed state and events
                    - async/effect contracts
                    - component contracts
                    - accessibility contract
                    - collection/scroll contracts
                    - source provenance
                    - coverage boundary
                    - DesignIR projection refs
                               |
                     versioned DesignIR documents
                       style/layout/text/assets
                               |
                       Burl native generator
                    Views + Yoga + Skia/Dawn
                     native text/input/AX
                               |
                    live behavior and visual oracle
```

## Canonical documents

### SemanticApplicationIR

This is a new schema, not DesignIR v2. It owns:

- application and component identity;
- typed semantic nodes and accessibility relationships;
- state variables, derived state, events, guards, transitions, and effects;
- formal async/cancellation semantics;
- action/data binding contracts;
- collection identity and scrolling policies;
- scenario coverage and unknown transitions;
- source/property provenance;
- references to render projections.

Unknown tagged variants are preserved losslessly, remain inert, and emit diagnostics.

### DesignIR render projections

Existing DesignIR remains responsible for:

- style and layout values;
- text runs;
- vector/raster assets and fonts;
- static render hierarchy;
- diagnostics and fidelity measurements;
- source anchors relevant to rendering.

A semantic node may reference different DesignIR projections for declared visual states and responsive regimes. Observed absolute layouts are stored as observations, never promoted to authored constraints without source evidence or an approved inference record.

## Formal behavior model required before schema approval

The feasibility study must specify:

- synchronous event ordering and propagation;
- event payload types;
- state mutation atomicity;
- tasks, timers, debounce, throttle, and queues;
- async start/completion/failure;
- cancellation ownership and propagation;
- optimistic state, rollback, and retry;
- navigation/history effects;
- external events and data dependencies;
- lifecycle and resource cleanup;
- persistence and sensitive-state handling.

Application effects use typed binding contracts implemented by consumer-owned code. An untyped `invoke` escape hatch is not sufficient.

## CSS and responsive lowering

Before importing real applications, Burl must publish a property-by-property compatibility matrix:

- exact support;
- equivalent native realization;
- diagnosed approximation;
- unsupported/blocking.

The matrix must cover at least flexbox, grid, intrinsic sizing, container/media queries, logical properties and writing modes, sticky/fixed positioning, overflow, stacking contexts, transforms, replaced elements, variable fonts, zoom, DPR, and dynamic content.

CDP `DOMSnapshot` is useful evidence but is experimental and returns flattened DOM, sampled layout, and whitelisted computed styles. It does not recover the cascade, query predicates, intrinsic algorithms, or source constraints. Multiple viewport samples remain observations. Unsupported responsive semantics block migration rather than being screenshot-fit into Yoga.

## Tokens

Authored tokens are preserved with stable IDs, aliases, collections, modes, and source evidence.

When authored identity cannot be established, the tool produces a separate **literal deduplication suggestions** report. Suggestions include examples, stability measurements, and confidence, but generated properties continue to reference their original literals. The importer must not manufacture semantic token ownership or automatically rewrite properties to inferred tokens.

DTCG-compatible output and Style Dictionary may be used after token identity is authored or approved.

## Text and input boundary

The initial supported boundary is native-equivalent plain `<input>` and `<textarea>` behavior.

The following block migration until separately proven:

- contenteditable and rich-text editors;
- code editors with custom document models;
- password-manager integrations;
- custom selection/undo/clipboard schemas;
- source behavior that depends on browser editing commands.

Validation uses real platform input services, not synthetic composition events alone. Required matrices include Japanese, Korean, Chinese, dead keys, emoji graphemes, bidi text, marked text, candidate-window geometry, selection, reconversion where supported, clipboard formats, undo/redo, autocorrect, and dictation policy.

## Accessibility boundary

Browser AX trees are runtime oracles, not sufficient canonical contracts. Each imported role, state, relationship, action, focus rule, and announcement must be supported by the native backend and validated under platform assistive technology.

The feasibility study uses ARIA Authoring Practices patterns, ARIA-AT where applicable, and axe-core only as supplemental static analysis. Live-region timing, virtual descendants, focus restoration, and keyboard contracts are explicit gates.

## Collections and variable-height scrolling

Runtime capture must not infer virtualization from mounted DOM rows.

Virtualized or streamed collections require a source-provided adapter defining:

- stable item identity and data access;
- known/estimated/measured heights;
- overscan and recycling;
- prepend/append anchoring;
- delayed image/font/Markdown relayout;
- focus and selection retention;
- keyboard navigation;
- auto-follow suspension/resumption;
- end-of-list and loading policy.

A runtime-only migration may reproduce a static scroll container, not claim equivalent virtualization.

## Re-import ownership

Generated output and consumer logic are separate compiled surfaces.

Re-import is a three-way merge over:

1. previous generated semantic/render documents;
2. new generated semantic/render documents;
3. consumer overlay and binding manifests.

The merge contract must define stable IDs, moves, renames, deletions, tombstones, signature changes, schema migrations, conflicts, rollback, and orphan bindings. Consumer effects are keyed by versioned contract IDs and never stored as edits inside generated source text.

## Security, privacy, and licensing

Capture runs in a disposable isolated profile with:

- default-deny network mutations;
- explicit origin and request allowlists;
- blocked purchases, messages, deletion, uploads, downloads, dialogs, and permissions unless scenario-authorized;
- blocked clipboard and persistent storage by default;
- cross-origin frame policy;
- secret and personal-data redaction;
- CPU, memory, storage, response-size, and time limits;
- deterministic teardown.

Output includes an SBOM and asset/font/license provenance report. Unknown redistribution rights block assets from distributable output. Captured appearance is not treated as proof of license.

## Open-source components and comparators

Recommended foundations:

- CDP DOMSnapshot and Accessibility for runtime observations;
- Playwright or Puppeteer/CDP Recorder for authored scenarios;
- existing Pulp/Burl DesignIR for render projections;
- DTCG/Style Dictionary after token identity is known.

Required evaluations before implementation:

- Crawljax as prior art for event-driven state-flow exploration;
- rrweb for event/mutation recording, replay evidence, and privacy lessons;
- web-platform-tests for CSS/input/selection negative fixtures;
- ARIA-AT and axe-core for accessibility comparison;
- Taffy only as a layout-capability comparator, not a semantic solution;
- Puppeteer/CDP Recorder versus Playwright for protocol proximity and scenario authoring.

Mitosis remains an optional frontend for genuine Mitosis-authored components. RmlUi, litehtml, and Servo are rejected as Burl's core migration architecture.

## Kill tests before schema work

The following held-out fixtures are run before expanding Burl's schemas:

1. **Async/races:** timers, WebSocket events, optimistic update, rollback, retry, debounce, and cancellation races.
2. **Text:** contenteditable or code editing with real Japanese, Korean, Chinese, dead-key, emoji-grapheme, bidi, selection, and clipboard behavior. Expected result may be a correct blocking diagnostic.
3. **Responsive layout:** container queries, subgrid, intrinsic sizing, logical/writing modes, sticky/fixed elements, dynamic content, continuous widths, zoom, and DPR.
4. **Collections:** virtualized streaming list with prepend anchoring, delayed media/font height changes, focused offscreen items, resize, and manual/automatic following.
5. **Accessibility:** composite widget and live regions under actual assistive technology.
6. **Protocol drift:** repeated capture under pinned and upgraded Chromium with an explicit compatibility report.

Scenario definitions and fixture implementations are held out from importer authors. Results report covered traces and unknown transitions, never a percentage of semantic completeness.

The architecture is rejected or narrowed further if a passing result requires fixture-specific renderer branches, reconstruction of hidden JavaScript, or a shipped browser runtime.

## Time-boxed feasibility decision

Only after the kill tests may maintainers approve:

1. the SemanticApplicationIR schema;
2. source-aware and scenario-observed frontend prototypes;
3. a Burl native lowering prototype;
4. Palot migration.

Palot is suitable for the source-aware lane because its clean source and expected product bindings are available. Its OpenCode/session logic remains consumer-owned. The current hand-painted native shell is retained only as negative evidence and is not incrementally repaired.

## Independent review questions

1. Is the source-aware versus scenario-observed boundary honest and enforceable?
2. Does separating SemanticApplicationIR from DesignIR resolve ownership and lifecycle concerns?
3. Which formal async/event semantics are still missing?
4. Are the CSS, text, accessibility, collection, security, and licensing boundaries sufficiently explicit?
5. Can the kill tests falsify the architecture before significant schema work?
6. Is the three-way re-import model concrete enough to prototype safely?
7. Are Crawljax, rrweb, WPT, ARIA-AT, Taffy, or another open-source project a better foundation?
8. What claim remains broader than the available evidence?
9. What mandatory change is required before a CONDITIONAL GO?
10. Final verdict: GO, CONDITIONAL GO, or NO-GO.

## Primary references

- CDP DOMSnapshot: <https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/>
- Playwright input: <https://playwright.dev/docs/input>
- Yoga styling: <https://www.yogalayout.dev/docs/styling/>
- WAI-ARIA 1.2: <https://www.w3.org/TR/wai-aria-1.2/>
- ARIA-AT: <https://github.com/w3c-cg/aria-at>
- axe-core: <https://github.com/dequelabs/axe-core>
- Crawljax: <https://github.com/crawljax/crawljax>
- rrweb: <https://github.com/rrweb-io/rrweb>
- web-platform-tests: <https://github.com/web-platform-tests/wpt>
- Taffy: <https://github.com/DioxusLabs/taffy>
