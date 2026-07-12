# Proposal: Semantic Web Import v2

Status: Review draft  
Audience: Burl/Pulp maintainers and independent architecture reviewers  
Decision requested: Approve, revise, or reject the proposed import architecture before Palot is reimplemented  
Reference revision: Burl `a22d776198f102179806f3eac5850a991dd4a48b`

## Executive summary

Burl should stop treating screenshots or flattened paint commands as an import format. The failed Palot prototype demonstrated why: a painted approximation can resemble one state while losing the source hierarchy, hit targets, focus behavior, responsive constraints, accessibility, and state transitions.

This proposal makes Pulp/Burl's existing `DesignIR` the render projection of a new additive Semantic UI IR v2. The import system becomes a compiler with two frontends:

1. A source-aware frontend for supported design and component formats.
2. A runtime-web frontend based on Chrome DevTools Protocol (CDP) and Playwright for arbitrary running web applications.

Both frontends lower into the same versioned semantic IR. The IR preserves or infers design tokens, represents components and interaction/state graphs explicitly, records property-level provenance, and lowers to real Burl views using Yoga, Skia, and Dawn. Screenshots remain validation evidence, never the primary source representation.

Palot will be restarted only after the importer passes smaller conformance fixtures. The current hand-painted Palot shell is a failed baseline, not a codebase to incrementally rescue.

## Problem

The current import stack is strong at visual structure but cannot faithfully represent a general interactive application.

Current `DesignIR` already provides useful foundations:

- rich style, layout, constraints, masks, transforms, grid, flex, shadows, and render bounds;
- mixed-style text ranges;
- source anchors and lock-to-source workflows;
- asset/font metadata, hashes, licensing, and diagnostics;
- fidelity scoring and deterministic JSON;
- specialized faithful-SVG interaction overlays.

However, the current schema is not sufficient as a canonical application IR:

- General interactions and state transitions are not first-class.
- Accessibility and semantics are carried through string attributes rather than typed structures.
- Components, slots, variants, and instance overrides are not represented in the tree.
- Tokens are limited to colors, float dimensions, and strings.
- Provenance is node-level rather than property-level.
- Unknown interaction kinds can be reinterpreted rather than preserved inertly.
- Responsive behavior and observed runtime states are not captured as a coherent contract.

The Palot prototype bypassed even these foundations and manually painted a screen. Visible controls and hit targets consequently diverged, native title-bar behavior was duplicated, responsive geometry drifted, and most visible affordances did not produce actions.

## Goals

1. Import unfamiliar interactive web applications repeatably without application-specific renderer branches.
2. Preserve semantics, interaction, responsive behavior, accessibility, and visual states—not only pixels.
3. Work when source design tokens exist and when they do not.
4. Retain Burl's native C++/Yoga/Skia/Dawn execution path without Chromium or a WebView in the shipped result.
5. Make unsupported behavior explicit and reviewable rather than silently approximated.
6. Support deterministic re-import and semantic diffing without overwriting product-owned code.
7. Provide a public conformance suite useful beyond Palot.

## Non-goals

- Running arbitrary browser JavaScript inside the shipped native application.
- Achieving full browser compatibility in Burl.
- Treating screenshots or generated raster layers as editable UI structure.
- Promising lossless import when a source depends on unsupported browser behavior.
- Replacing Yoga, Skia, Dawn, Burl's native reconciler, accessibility, or text-input stack.

## Architecture

```text
 Source-aware frontends                 Runtime-web frontend
 Figma / v0 / Pencil / JSX subset       CDP DOMSnapshot + AX tree
 Existing DesignIR adapters             Playwright state exploration
                  \                     /
                   Semantic UI IR v2
                   - semantic tree
                   - render projection
                   - component graph
                   - state/action graph
                   - visual states
                   - typed tokens
                   - assets and text
                   - property provenance
                   - diagnostics/capabilities
                              |
                      Burl native lowering
                   real Views + Yoga layout
                     Skia/Dawn rendering
                    native input and AX
                              |
                  behavior + screenshot oracle
```

### Frontend A: source-aware import

Existing adapters remain valuable when they can recover authored intent: component names, source tokens, constraints, variants, stable IDs, and assets. Their output is upgraded to Semantic UI IR v2.

Mitosis may be supported later as an optional greenfield authoring frontend. It is not the frontend for arbitrary existing React applications: it accepts its own static JSX subset and stores significant behavior as source-code strings. A Mitosis adapter must therefore be scoped to genuine Mitosis input and pinned behind an isolated package boundary.

### Frontend B: runtime-web capture

The runtime frontend captures the application in its authoritative browser execution environment during import only. CDP `DOMSnapshot.captureSnapshot` provides flattened DOM, layout, selected computed styles, paint order, DOM rectangles, iframes, templates, and shadow DOM. CDP's accessibility domain supplies the computed accessibility tree.

Playwright drives deterministic state exploration:

- viewport and responsive breakpoints;
- hover, focus, focus-visible, pressed, selected, checked, expanded, disabled, loading, and error states;
- click, keyboard activation, text entry, selection, clipboard, IME-relevant composition probes, scrolling, drag/drop, and cancellation;
- screenshots and traces before and after each action.

The capture environment is an importer tool. No Chromium runtime is included in the resulting Burl application.

## Semantic UI IR v2

V2 is additive. Existing v1 style/layout/assets remain the initial render projection while semantic layers are introduced beside them.

### Envelope

```json
{
  "schemaVersion": "2.0.0",
  "minimumReaderVersion": "2.0.0",
  "capabilities": ["semantics", "stateGraph", "visualStates", "typedTokens"],
  "sourceDocuments": [],
  "tokens": {},
  "components": {},
  "stateModel": {},
  "actions": {},
  "root": {},
  "diagnostics": [],
  "extensions": {}
}
```

Readers must preserve unknown fields and unknown tagged-union variants. Unknown actions are inert and emit a diagnostic; they must never be reinterpreted as a known control.

### Semantic node

Every rendered node may carry:

- stable semantic and source IDs;
- typed role plus custom-role escape hatch;
- accessible name, description, value, and live-region policy;
- checked, selected, expanded, invalid, busy, disabled, and hidden state;
- labelled-by, described-by, controls, owns, and active-descendant relationships;
- focus policy, focus scope, tab order, default action, and keyboard shortcuts;
- pointer-event and hit-test policy;
- event binding references;
- component definition/instance identity;
- style, layout, content, and asset render projection;
- property-level provenance.

An importer validation error is raised when a visible affordance has pointer/keyboard semantics but lowers only to a paint node.

### State and action graph

The IR adds typed structures:

- `IRStateVariable`: typed value, initial value, persistence, sensitivity.
- `IRDerivedState`: dependency list and bounded expression representation.
- `IREventBinding`: event type, phase, target, guard, action IDs.
- `IRAction`: tagged union such as set, toggle, increment, select, navigate, open, close, submit, invoke, emit, focus, blur, scroll, copy, retry, cancel.
- `IRTransition`: from-state, event, guard, to-state, effects.

Application-specific effects such as “start OpenCode session” are symbolic invocation actions bound by the consumer. The IR describes UI behavior and contracts; it does not embed arbitrary source JavaScript.

### Visual states

Nodes and component variants may define sparse overrides for:

- hover;
- focus and focus-visible;
- pressed;
- disabled;
- checked;
- selected;
- expanded;
- loading;
- error;
- source-defined custom states.

Overrides can affect style, layout, content, assets, semantics, and transitions. Captured visual states retain the action sequence and viewport that produced them.

### Components and variants

V2 adds:

- component definitions and stable source keys;
- typed properties and defaults;
- slots;
- instances and instance overrides;
- variants and compound variants;
- sparse tree/style/semantic deltas;
- component-local state and actions.

Repeated runtime subtrees can be proposed as inferred components, but inference is recorded with confidence and does not erase the original captured tree.

### Tokens

Token presence is not required at the source boundary.

If source tokens exist, preserve their stable IDs, aliases, collections, modes, descriptions, and provenance. Otherwise, synthesize provisional tokens from repeated computed values and usage context.

Supported token types include:

- color, number, dimension, boolean, string;
- duration and cubic-bezier;
- font family, weight, and typography composites;
- border, shadow, gradient, transition, and asset;
- references/aliases and mode-specific values.

Inference clusters by value and semantic use. The same color used as text and as a surface is not automatically one semantic token. Each inferred token records examples, confidence, algorithm version, and source properties. Literal values remain recoverable.

Tokens use a DTCG-compatible interchange representation. Style Dictionary can generate platform artifacts after tokens exist; it is not the inference engine.

### Provenance

Every material property can record:

- source document URI, revision, and content hash;
- DOM/source node ID;
- source span, JSON pointer, or CSS rule/selector;
- origin: literal, authored token, inferred token, inherited, computed, or fallback;
- transform step and adapter version;
- confidence;
- capture viewport and state sequence.

This enables diagnostic explanations, semantic re-import diffs, and targeted source locks.

## Lowering to native Burl

The native generator creates real Burl nodes:

- Yoga constraints for normal layout;
- existing Burl controls for buttons, lists, trees, editors, scroll containers, dialogs, and menus;
- Skia/Dawn paint for visual layers and vector assets;
- native text input, selection, clipboard, IME, and accessibility paths;
- virtualized variable-height lists where the semantic role requires them;
- explicit consumer bindings for application actions.

The generator must fail closed for unsupported semantics. A visual fallback may be emitted only when it is non-interactive, explicitly diagnosed, and accepted by the consumer's capability policy.

Generated artifacts are split into:

1. Regenerable import output.
2. Stable consumer-owned action bindings and product logic.
3. A semantic lockfile mapping source IDs to generated IDs and overrides.

Re-import updates the regenerable layer and produces a semantic diff. It does not overwrite consumer-owned code.

## Capability and fallback policy

Each adapter and backend publishes capabilities. Import produces a report with four outcomes per feature:

- exact;
- equivalent native realization;
- diagnosed approximation;
- unsupported/blocking.

No unsupported interactive feature may silently become inert or map to an unrelated widget. Release gates can reject diagnosed approximations according to project policy.

## Open-source bake-off

| Candidate | Decision | Reason |
|---|---|---|
| CDP DOMSnapshot + Accessibility | Adopt for runtime capture | Authoritative DOM/layout/computed-style/AX capture during import |
| Playwright | Adopt for state exploration and validation | Deterministic actions, responsive states, screenshots, and traces |
| Mitosis | Optional future frontend only | Useful IR for its own authored subset; not an arbitrary React importer |
| Style Dictionary | Adopt downstream of token extraction | Cross-platform token generation; does not infer tokens |
| RmlUi | Do not adopt as core | Partial HTML/CSS dialect and second layout/event/widget stack; no arbitrary React runtime |
| litehtml | Reject | Display/layout engine without application interaction semantics |
| Servo | Reject | Browser engine that would replace the Burl-native architecture |

Primary references:

- CDP DOMSnapshot: <https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/>
- CDP protocol domains: <https://chromedevtools.github.io/devtools-protocol/>
- Playwright: <https://github.com/microsoft/playwright>
- Mitosis overview: <https://mitosis.builder.io/docs/overview/>
- Mitosis customization: <https://mitosis.builder.io/docs/customizability/>
- Style Dictionary: <https://github.com/style-dictionary/style-dictionary>
- RmlUi: <https://github.com/mikke89/RmlUi>
- litehtml: <https://github.com/litehtml/litehtml>
- Servo embedding: <https://book.servo.org/embedding/overview.html>

## Phased proof, not a big-bang rewrite

### Phase 0: freeze the failed baseline

- Preserve current Palot screenshots, interaction results, and metrics as a negative fixture.
- Stop feature work on the hand-painted shell.
- Document which failures arose from lost semantics versus renderer/platform gaps.

### Phase 1: v2 schema and validators

- Add the versioned envelope and additive semantic/state/token/provenance types.
- Add v1 projection and round-trip compatibility.
- Preserve unknown tags and fields losslessly.
- Reject visible interactive paint-only nodes.

### Phase 2: runtime capture prototype

Capture three public fixtures:

1. A responsive navigation/sidebar with hover, selection, collapse, and keyboard activation.
2. A multiline composer with focus, selection, clipboard, IME composition, send, cancel, and disabled/loading states.
3. A variable-height streamed transcript with Markdown, tool details, retry, auto-follow, and manual scroll anchoring.

The output must be deterministic for the same browser/build/viewport/state sequence.

### Phase 3: native lowering prototype

- Generate real Burl views from those fixtures.
- Bind symbolic actions to a test state store.
- Prove mouse, keyboard, text input, accessibility, and responsive behavior.
- Compare source and native screenshots for every captured state.

### Phase 4: re-import and generalization

- Change each source fixture and re-import.
- Demonstrate semantic diffs and preservation of consumer bindings.
- Run the same pipeline on one unrelated open-source application screen.

### Phase 5: restart Palot

- Import the clean Electron Palot reference through the runtime frontend.
- Bind OpenCode product actions outside generated UI code.
- Complete the 11-pass screenshot and live interaction gate.
- Remove the discarded hand-painted shell after the new path proves superior.

## Prototype acceptance gates

The architecture is not approved for Palot merely because it can render a page. Before Phase 5:

1. No fixture-specific conditionals exist in the importer or Burl renderer.
2. Every visible interactive source element maps to a semantic node and native hit target.
3. Mouse, keyboard, focus, text, selection, clipboard, and IME tests pass through the live native host.
4. Scroll containers preserve wheel/trackpad behavior, variable heights, anchoring, and responsive bounds.
5. Hover, pressed, focus-visible, selected, disabled, loading, and error screenshots are captured and compared.
6. Accessibility roles, names, values, states, relationships, order, and actions match the source contract.
7. Unsupported source features produce stable source-located diagnostics.
8. Token inference is deterministic, reversible, provenance-bearing, and does not merge semantically different uses solely by equal value.
9. Re-import preserves consumer bindings and produces a reviewable semantic diff.
10. Generated output contains no Chromium/WebView dependency and renders through Yoga/Skia/Dawn.
11. A non-Palot fixture passes the same pipeline without importer modifications.

## Risks and mitigations

### Runtime observation cannot recover all authored intent

Mitigation: merge source-aware and runtime evidence when both are available; retain confidence and provenance; never present inference as authored truth.

### State-space explosion

Mitigation: bounded exploration seeded by semantics, event listeners, CSS pseudo-states, accessibility actions, and user-provided scenarios; record coverage and unexplored transitions.

### Browser layout differs from Yoga

Mitigation: capture constraints and multiple viewports, not only absolute boxes; maintain an explicit CSS/Yoga capability matrix; diagnose unsupported layout; use screenshot deltas as a lowering test.

### Arbitrary JavaScript cannot be translated safely

Mitigation: capture UI state transitions and lower known actions; require explicit consumer bindings for application effects; do not embed or guess arbitrary JavaScript.

### IR grows into an unmaintainable browser clone

Mitigation: represent application semantics and observed visual contracts, not the full DOM/CSS/JS platform; keep capability boundaries explicit; reject features rather than silently accumulating partial behavior.

### Inferred tokens become noisy or misleading

Mitigation: distinguish authored and inferred tokens, retain literals and examples, apply confidence thresholds, and make inference proposals reviewable.

## Repository boundaries

- Generic schema, capture adapters, validators, native lowering, and conformance fixtures belong in Burl.
- Palot-specific action bindings, OpenCode integration, sessions, persistence, and product copy belong in `burl-palot`.
- No Palot product code or fixture-specific renderer behavior may enter Burl.
- The clean Electron Palot checkout remains read-only reference material.

## Decision record

Recommended decision: approve a time-boxed Phase 1–4 proof. Do not approve restarting Palot until all prototype acceptance gates pass. Reject RmlUi, litehtml, Servo, and arbitrary React-to-Mitosis conversion as the primary architecture.

The proof should be abandoned or redesigned if it requires fixture-specific renderer branches, cannot preserve live text/IME/accessibility behavior, or cannot re-import without overwriting consumer code.

## Independent review questions

The reviewer should answer these explicitly:

1. Is extending DesignIR v1 additively safer than defining a separate canonical Semantic UI IR? Identify migration or ownership traps.
2. Does runtime CDP/Playwright capture provide enough evidence to reconstruct interaction semantics without embedding a browser runtime? Where is the irreducible boundary?
3. Is the proposed state/action graph expressive enough for real applications while remaining bounded and safe?
4. Are visual states, responsive constraints, accessibility, IME, and variable-height scrolling treated as first-class, testable contracts?
5. Is token inference useful and reversible, or likely to create false semantics? Recommend a stricter alternative if needed.
6. Does the lowering and re-import ownership model prevent generated-code lock-in and destructive updates?
7. Are any rejected open-source projects or other projects materially better than the proposed composition?
8. Which prototype gate is too weak, missing, or impossible to verify?
9. What would falsify this architecture before significant implementation cost is incurred?
10. Final verdict: GO, CONDITIONAL GO with required changes, or NO-GO.
