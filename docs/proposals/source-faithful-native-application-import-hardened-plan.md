# Source-Faithful Native Application Import — Hardened Plan

## 0A. Second-review reconciliation: fidelity remains the product gate

This plan is now subordinate to the nine-blocker execution lock in
`standards-seeded-electron-web-compatibility-audit-plan.md`. Both independent
reviews returned **CONDITIONAL GO**. Their findings strengthen, rather than
replace, the original objective: a reusable import system must produce a native
C++/Yoga/Skia/Dawn application whose appearance and behavior converge on the
source through measured screenshots and interaction evidence. Catalog coverage,
token generation, or a successful materialization is not UX completion.

Where a later historical baseline statement conflicts with this reconciliation,
this section and the compatibility plan's §0 govern. The older text remains as
review traceability, not current implementation status.

### Commit-pinned status and corrected scope

Implementation status in this document is verified only at Burl commit
`1ebab6cf5429c21d9ec87e6fa5056d92942d73f7` and `burl-palot` commit
`28cd437260250fa4b5effed85b3c1bf07911c3e7`. Later claims require new pins.

At those pins, VisualSkin, token promotion, poison-theme checks, layout
classification/lowering, font/SVG work, and component-matrix infrastructure exist
on the feasibility branch. Existing code is not proof that each contract or gate
in this plan passes. Conversely, Palot capture/evidence is not absent: the
consumer contains `scripts/capture-source-cdp.ts`, interaction-state capture,
and hashed artifacts under `evidence/`. The remaining capture task is to promote
that Palot-specific prototype into a reusable Burl-owned front end with
declaration provenance, uncertainty, deterministic environment control, and a
denied-by-default recording host bridge. Palot-specific scenarios and evidence
remain consumer-owned.

### Added framework gates

Before full-screen Palot convergence resumes, the following are mandatory:

1. Adopt the four-axis compatibility schema—conformance, implementation route,
   observation, and resolving evidence ownership—and forbid `partial -> lowered`.
2. Make the analyzer syntax-aware and enforce
   `runtime-observed ⊆ static-predicted ∪ declared-dynamic ∪ analysis-unknown`.
3. Complete Phase A0 capture promotion and prove byte-stable state/provenance
   output plus denied-effect and redaction behavior.
4. Calibrate renderer-specific visual comparison with exact geometry, pinned
   fonts/DPR/backend, freshness, independent baseline review, critical regions,
   mutation tests, and explicit event/accessibility traces.
5. Seal a token-less, block-heavy held-out application now. Palot proves the
   authored/dynamic-token and flex-dominant lane; it cannot alone prove token
   inference or block lowering.
6. Represent runtime custom-property mutation and environment-bound values such
   as macOS accent/appearance as dynamic portable bindings with lifecycle tests.
7. Split in-window Skia backdrop work from behind-window macOS glass/vibrancy
   services. Transparent-window comparison uses an opaque tier, immutable harness
   backdrop, or narrowly reviewed masks—never an uncontrolled desktop.
8. Separate Chromium/Electron and WebKit/Tauri source oracles while normalizing
   portable service contracts; keep adapter security and evidence distinct.
9. Require explicit decisions for `:has()`, `color-mix()`, container queries,
   styled scrollbars, sticky/per-axis overflow, variable fonts/features,
   exit/unmount animation, Shiki, GFM/Streamdown, KaTeX, Mermaid, diffs, and each
   conditional glass tier before a Palot parity claim.

### UX acceptance consequence

The eleven-pass loop must compare the independently captured Electron source and
native app at identical logical dimensions and states, sweat critical-region
details (chrome, gradients/glass, radii, icons, fonts, truncation, selection,
caret, scrollbars, transcript, composer), and pair every visual state with a real
input trace. Hover, active, focus-visible, selected, disabled, loading, scrolling,
keyboard, clipboard, IME, accessibility, cancellation, retry, persistence, and a
real streamed OpenCode exchange are application gates. A static mock, non-empty
PNG, approximate theme, substituted icon/font, aggregate score hiding a local
failure, or working scroll/text input with dead surrounding controls fails.

Repository ownership remains strict: generic capture, IR, compatibility,
renderer, platform-service interfaces, and neutral fixtures land in Burl;
Palot adapters, scenarios, exact assets, product bindings, baselines, and evidence
land in `burl-palot`. The held-out consumer remains separate. No Palot selector,
color, icon, component name, or action may enter Burl.

Status: hardened revision after independent code-grounded review; supersedes
`source-faithful-native-application-import-plan.md`
Primary proof application: Palot (private consumer repo)
Generalization target: any Electron-style React/JS application, **including
applications with no design tokens**
Target framework: Burl
Primary runtime target: native macOS C++/Yoga/Skia/Dawn
Secondary targets (compatibility requirement only): AppKit, SwiftUI

---

## 0. Review verdict on the prior plan

**CONDITIONAL GO.** The prior plan's architecture principles, phase ordering,
capture discipline, and no-hacking rules are sound and are carried forward.
Four blockers were found by verifying the plan against the actual framework
source; each becomes a first-class workstream or gate below.

### Blocker 1 — the visual-skin gap is real, precisely located, and unaddressed by tokens alone

Verified in framework source: `View::resolve_color()` walks
`theme_.color(name) → parent → hardcoded fallback literal`
(`core/view/src/view.cpp`). `TextButton::paint`
(`core/view/src/buttons.cpp`) resolves `accent.primary`, `bg.elevated`,
`control.border`, `text.primary` against that chain and carries **no
per-instance paint state** — no background/text/border/radius/typography
setters exist on it. The native materializer
(`core/view/src/design_import_native_common.cpp`) constructs
`case NativeWidgetKind::text_button: return std::make_unique<TextButton>(text);`
— label only. Imported paint has no channel into the painter, so the
hardcoded fallbacks paint. The prior plan's "TextButton painted default
purple/gray" diagnosis is confirmed, and the fix cannot be a token table
alone: even a perfectly authored token document only reaches painters through
theme names each widget happens to read. A **uniform skin contract**
(Workstream 1, §4) is a prerequisite, not an option.

Note the contrast case that proves the pattern works when plumbed:
`toggle_button` materialization *does* transfer imported paint via
`set_on_background_color` / `set_off_background_color` / `set_corner_radius`
/ `set_font_size` setters. The skin contract generalizes that ad-hoc pattern
into one mechanism instead of N×M scattered setters.

### Blocker 2 — token inference does not exist anywhere in the pipeline

The token machinery (`core/view/src/design_tokens.cpp`) **parses tokens that
already exist**: Figma variables, Stitch design systems, W3C/DTCG, DESIGN.md
frontmatter. There is no candidate-palette extraction, no dedup/clustering,
no promotion path from repeated literal values to named tokens. A token-less
React app currently flows as raw literals on `TypedPaint`/`IRStyle`, which
`design lint-adherence` then flags as `raw-color`. Since the stated product
goal explicitly includes token-less sources, token inference and promotion
(Workstream 2, §5) is a required deliverable with its own render-neutrality
gate — not a "candidates may be reported" aside.

### Blocker 3 — the layout ceiling is the largest unnamed risk

Burl's layout engine is Yoga: **flexbox + grid only**. `display: block`,
table layout, floats, inline flow, and multi-column are architecturally out
of scope. Design-tool imports (Figma, Stitch, Claude Design) emit flex — but
arbitrary Electron/React applications use `display: block` pervasively. The
prior plan never addresses this. Without a deterministic block-flow lowering
strategy and a display-mode capability report (Workstream 3, §6), Phase A's
"unsupported properties are named" gate cannot be honest, and the first
non-Palot application will fail unpredictably.

### Blocker 4 — the validation section cites metrics that do not exist

The framework's comparison harness (`core/view/include/pulp/view/screenshot_compare.hpp`)
implements tolerance-thresholded per-pixel comparison
(`CompareResult{similarity, diff_pixels, mean_error}`), `diff_bounds()`
region localization, and `analyze_screenshot_content()` content-floor stats.
There is **no SSIM or PSNR implementation** in the repo. The prior plan's
§11.4 gates on "MAE/RMSE/PSNR/SSIM" — an unimplemented harness would either
block every phase or, worse, get quietly replaced by eyeballing. §10 rebuilds
the metric plan on what exists plus a small, pinned set of additions.

### Answers to the prior plan's reviewer questions (§19)

1. **Unnecessary architecture?** The Swift/AppKit/SwiftUI emitters as Phase-B
   deliverables. Target-neutrality is preserved by keeping the skin and token
   documents free of Burl types (both are serialized JSON with no C++
   dependencies); actually *building* a second emitter before the first one
   passes the component gate is scope creep. Baked SwiftUI codegen already
   exists (`design_swift_codegen.cpp`) as an existence proof. Demoted to §13.
2. **Source truth still lost?** Three concrete losses the prior plan missed:
   (a) CSS transition/animation timing (hover states will snap rather than
   fade — must be captured per-state or named unsupported); (b) source
   `prefers-color-scheme` mode pairing (needed for mode-aware tokens);
   (c) scroll-conditional styling (scrollbar appearance, overflow shadows).
   All three are added to the Phase A capability report.
3. **Is `ApplicationBindingManifest` the right seam?** Yes. It matches the
   existing, working precedent: the importer already emits binding manifests
   and bridge-handler scaffolds (`design_binding_metadata.cpp`,
   `--param-binding-manifest`). Keep it typed, bounded, fail-closed on
   unknown *required* variants — as proposed.
4. **Skin: shared View contract, widget-specific contracts, or generated
   painters?** One shared per-state skin struct + per-widget *role mapping*
   (§4). Widget-specific contracts are the current ad-hoc setter sprawl;
   generated painter objects mean maintaining a parallel painter per import —
   both rejected.
5. **How does stateful skin inheritance avoid recreating CSS?** By resolving
   flat at materialization time: no selectors, no cascade, no runtime
   inheritance except typography defaults down the imported subtree. Each
   state (rest/hover/pressed/focused/selected/disabled) is either fully
   resolved or falls back to the nearest defined state, terminating at rest
   (§4.3).
6. **Authored token document + resolved projection sufficient for
   Swift/AppKit/SwiftUI?** Yes, provided the document stays serialized DTCG-
   compatible JSON (the existing `parse_w3c_tokens`/`export_w3c_tokens` lane)
   and the skin retains token references alongside resolved values, as
   proposed.
7. **Smallest component matrix that predicts full-screen fidelity?** The six
   proposed components plus two additions: a focus-ring/keyboard-focus case
   and a scroll container with styled overflow (scrollbars are a notorious
   default-leakage surface). Eight total (§10.1).
8. **Responsive constraints from source?** Source-aware lane parses the
   source's actual media/container queries into per-regime constraint sets;
   scenario-observed projections remain a bridge, tagged per-regime, never
   promoted without source evidence — as proposed, now with the block-flow
   lowering rules of §6 applied per regime.
9. **Missing negative tests?** Poison-theme leakage (§10.2), token-rewrite
   render-neutrality (§5.4), font-substitution detection (§8), dropped-SVG
   diagnostics, orphaned-binding on source rename, and stale-checkout /
   wrong-screenshot-backend false-regression guards (§10.4).
10. **Evidence before implementation resumes?** The Phase B package of §15 —
    now including the skin contract and poison-theme gate, which the prior
    resume package omitted.

---

## 1. Decision requested

Approve the workstreams and gates below as the plan of record for a
repeatable source-to-native import workflow that:

1. imports an existing React/JS application **with or without design
   tokens**;
2. renders it faithfully on the C++/Yoga/Skia/Dawn stack — the same fidelity
   bar the existing token-carrying import lanes (Figma, Claude Design,
   DESIGN.md) already meet;
3. preserves source behavior through a bounded binding manifest rather than
   translating the application into a new language;
4. produces an authored token document even when the source ships none, via
   explicit candidate promotion;
5. proves itself on Palot first, and generalizes via a held-out second
   application slice.

## 2. Verified infrastructure baseline

Everything in this plan builds on surfaces verified present in the framework
repo. This section replaces the prior plan's §16, which mixed framework
facts with consumer-repo claims that cannot be audited here.

**Exists and is load-bearing (build on it, do not rebuild):**

| Surface | Location | Role in this plan |
|---|---|---|
| `@pulp/import-ir` TS package | `packages/pulp-import-ir/` | Canonical typed IR: `TypedLayout`/`TypedPaint`/`TypedText`, `TokenRef`, content-hash stable anchors, tweaks-survive-reimport, `diff()` drift reporting, provenance/confidence |
| C++ `DesignIR` + JSON envelope | `core/view/include/pulp/view/design_ir.hpp`, `design_ir_json.cpp` | Native projection: versioned schema, `IRTokens`, `IRAssetManifest` (sha256 + license), `IRFontAsset`, `IRTextRun[]`, `faithful_svg` render mode with interactive-element overlays |
| Native materializer | `core/view/src/design_import_native_common.cpp` | `resolve_design_ir_native()` → native widget tree; the seam Workstream 1 extends |
| React execution lane | `--from jsx`, `--execute-bundle`, `parse_jsx_react`, `claude_bundle.cpp` | Runs the real esbuild React bundle headless via the `@pulp/react` reconciler and walks the materialized DOM — the observed-DOM lane for token-less React |
| `@pulp/react` + prop-applier | `packages/pulp-react/src/` | ~70-prop React→native translation layer; consumes literal values with zero token dependency |
| web-compat layer + coverage DB | `core/view/js/web-compat*.js`, `compat.json` | DOM-lite execution surface; per-property `supported/partial/wontfix` status is the feasibility map for any source app |
| Faithful vector lane | `DesignFrameView`, `Canvas::draw_svg` (SkSVGDOM) | Pixel-faithful SVG rendering with SVG-patch + native-overlay interaction; the escape hatch when widget-level fidelity is not yet reachable |
| Text shaping | `TextShaper`/`PreparedText` (SkParagraph), `AttributedString`, `IRTextRun` | prepare()/layout() split; per-range attributed typography; bundled-font registration |
| Token parsing/export | `core/view/src/design_tokens.cpp` | DTCG/W3C, Figma variables, Stitch, DESIGN.md, CSS-variable export, `ir_tokens_to_theme` |
| Adherence lint | `design_adherence.cpp` | `raw-color`/`unknown-token` drift detection — becomes the post-promotion gate in §5 |
| Screenshot harness | `screenshot_compare.hpp`, `render_to_png` Skia backend, region diff tooling | Tolerance-MAE + `diff_bounds` + content-floor; §10 extends it |
| Semantic testing | `View::simulate_click`, view-tree/DOM inspection, headless input events | Post-action semantic assertions |
| Re-import identity | anchors + `pulp-tweaks.json` + drift/orphan reporting | Ownership mechanism of §12 |

**Verified absent (this plan's new work):**

1. Any general per-instance skin/painter-override path (Workstream 1).
2. Any token inference from token-less input (Workstream 2).
3. Any block-flow lowering or display-mode capability reporting
   (Workstream 3).
4. SSIM/structural metrics; per-state component capture harness (§10).
5. Automatic inline `<svg>` → native vector-widget rewriting (§8).
6. `AsyncReducer`, `CollectionModel`, `ApplicationBindingManifest`,
   `AuthoredTokenDocument`, scenario manifests, observed-DOM capture scripts
   as named types — these exist, if at all, only in the private consumer
   repo. This plan treats them as **to be delivered**, with the framework-
   generic parts landing in Burl under neutral fixtures and only
   product-specific manifests/fixtures in the consumer repo (§2.1).

### 2.1 Repo boundary (hard rule)

`tools/scripts/public_hygiene_check.py` fails CI if any `palot/` path exists
in this repo — by design. Every deliverable below is therefore tagged with
its landing repo:

- **Burl (framework):** skin contract, token inference/promotion machinery,
  block-flow lowering, importer/CLI changes, validation harness extensions,
  binding-manifest and token-document schemas, and neutral test fixtures
  (the held-out "field journal" style slice).
- **Consumer repo (Palot):** Palot scenario manifests, captures, stream
  fixtures, binding-manifest instances, promoted token documents, and the
  eleven-pass evidence.

A framework capability may not gate on a fixture that lives only in the
consumer repo. Every Burl-side deliverable ships with a Burl-side test.

## 3. Architecture principles

Carried forward unchanged from the prior plan: preserve the source program
(§5.1 there); reuse existing import infrastructure (§5.2); describe behavior
seams with a compact manifest, not an application language (§5.3); separate
native behavior from source-owned appearance (§5.4); treat source-aware and
scenario-observed evidence honestly and never promote observed absolute
geometry to authored constraints without source evidence (§5.5). The
no-hacking prohibitions of the prior plan's §3 remain binding verbatim.

Three principles are added:

### 3.1 Paint precedence is a single, uniform rule

For every painted property of every widget:

```text
imported visual skin (if the node has one and the state resolves the property)
  > theme token lookup (resolve_color / resolve_dimension chain)
    > widget fallback literal
```

No widget may consult the theme before consulting its skin. This is the
mechanical form of "imported visual properties must override Burl defaults."

### 3.2 Representation changes must be render-neutral

Any pass that rewrites the IR without intending a visual change — token
promotion (literal → `TokenRef`), anchor re-keying, asset re-hashing — must
prove pixel-identical output before/after on the same scenario set. This
turns "tokens are an enrichment layer" into a gate instead of a hope.

### 3.3 Every importer fix is a generalizable rule

Inherited from the existing import lanes and now binding here: a fidelity fix
must read the design/source data and apply to any input exhibiting the
pattern. Per-application literals, per-layer-name special cases, and
hardcoded pixel patches are rejected in review regardless of how much they
improve the proof app.

## 4. Workstream 1 — native visual skin contract

**Landing repo: Burl. This is the plan's critical path.**

### 4.1 Shape

One target-neutral, serializable struct, resolved flat at materialization
time:

```text
VisualSkin
  states: map<WidgetState, StateStyle>     // rest required; others optional
  token_refs: map<property-path, TokenRef> // retained for re-export & emitters

StateStyle (all properties optional)
  background: color | gradient
  foreground: color            // text / glyph
  icon: color
  border: per-side color, width, style
  corner_radii: per-corner
  shadows: BoxShadowOp[]
  opacity
  typography: family, size, weight, style, features, line_height,
              letter_spacing        // resolved against bundled IRFontAsset
  insets: content padding
  alignment
  vector_asset: asset_id       // exact SVG/raster reference where applicable
```

`WidgetState` enumerates `rest, hover, pressed, focused, selected, disabled,
active, validation`. Resolution for a missing state falls back along a fixed
chain (`pressed → hover → rest`, `selected → rest`, etc.) terminating at
rest. There are no selectors, no cascade, no runtime specificity — the
importer resolves the source's cascade *once*, per state, before the skin is
constructed. Typography defaults may inherit down the imported subtree during
materialization only. This is deliberately less expressive than CSS; anything
it cannot express is a named unsupported capability, not a reason to grow a
selector engine (prior plan risk 1, answered).

### 4.2 Plumbing

- `View` gains optional skin storage (`set_visual_skin` /
  `visual_skin()`), and two painter-facing helpers that encode the §3.1
  precedence: `skin_color(role, state, token_name, fallback)` and
  `skin_dimension(...)`. Painters swap their current
  `resolve_color(token, literal)` calls for these — a mechanical, widget-by-
  widget migration with the poison-theme gate (§10.2) proving completion.
- The materializer maps `DesignIR` node style + interaction states into a
  `VisualSkin` and attaches it in every `NativeWidgetKind` case. The
  `toggle_button` case's existing hand-plumbed setters are retired onto the
  same path.
- Per-widget **role mapping** documents which skin properties each widget
  consumes (a button consumes background/foreground/border/radii/typography;
  a scroll container consumes track/thumb via `background`/`foreground` roles
  on its scrollbar sub-parts). Unconsumed skin properties on a widget produce
  a named `skin-property-unsupported` diagnostic — never silence.
- The skin serializes into the DesignIR JSON envelope (additive, versioned)
  so baked C++/SwiftUI lowerings and re-import diffs see it.

### 4.3 Explicitly rejected alternatives

- **Per-widget setter sprawl** (the `ToggleButton` pattern): N widgets × M
  properties of API surface, inconsistently covered — the current state that
  produced the failure.
- **Node-scoped synthetic Theme injection** (materializer writes imported
  colors under the token names each painter happens to read): works for
  colors only, couples the importer to private painter token strings, cannot
  express per-corner radii/typography/states, and silently breaks when a
  painter renames a token. Acceptable as nothing more than a debugging trick.
- **Generated painter objects per import:** a parallel painter codebase to
  maintain; kills the native widget's theme-driven API for non-import use.

### 4.4 Gate

The eight-component matrix (§10.1) renders each component in every applicable
state with **zero poison-theme pixels** (§10.2) and no Palot literals in
framework code. The skin path must also be provably inert when absent: all
existing theme-driven rendering tests pass unchanged with no skin attached.

## 5. Workstream 2 — token inference and promotion for token-less sources

**Landing repo: Burl (machinery + neutral fixtures); consumer repo (promoted
documents).**

This workstream turns the product goal — "sources without tokens should end
up as well-tokenized as a Claude Design import" — into a pipeline with
review checkpoints. It runs *after* faithful literal rendering works; tokens
are a representation upgrade, never a rendering prerequisite.

### 5.1 Candidate extraction (mechanical, deterministic)

A pass over the lowered IR (all scenarios, all states) collects usage of
colors, dimensions (radii, spacing, borders), typography tuples, and shadow
specs:

- values normalized (colors to canonical RGBA, dimensions to px at DPR 1);
- **exact-value clustering only** — near-duplicates (e.g. ΔE < 2 colors,
  ±1px dimensions) are reported as *merge suggestions*, never auto-merged
  (the prior plan's "must not be silently deduplicated" made enforceable);
- each candidate records: value, usage count, property roles seen
  (background vs text vs border), sample stable anchors, per-scenario/state
  distribution, and a suggested name derived from role + luminance/scale
  heuristics (`color.bg.surface-1`, `space.3`, `radius.control`);
- when scenarios capture both `prefers-color-scheme` modes, values are
  paired by anchor across modes to propose **mode-aware** candidates;
- output is a deterministic `token-candidates.json` with full provenance.

### 5.2 Promotion (explicit, reviewed)

Promotion from candidate to authored token is a recorded decision — an agent
or human edits/approves the candidate set (CLI verb on the importer, e.g.
`tokens promote`), producing entries in the `AuthoredTokenDocument` with
provenance `{kind: promoted-candidate, source_values, reviewed_by/at,
merge_decisions}`. Unpromoted candidates remain literals in the IR — still
rendered faithfully, still re-reported on the next import.

### 5.3 Authored token document

As in the prior plan §6.3, with the format pinned to what exists: the
document is DTCG-compatible JSON round-tripping through the existing
`parse_w3c_tokens` / `export_w3c_tokens` lane, preserving original
declarations, aliases, groups, modes, provenance, and an explicitly lossy
resolved `Theme` projection via the existing `ir_tokens_to_theme`. Sources
that *do* ship tokens (CSS custom properties, Tailwind config, styled-system
themes) enter here as authored declarations, not candidates.

### 5.4 Rewrite + gates

After promotion, a rewrite pass replaces matching literals with `TokenRef`s
(the IR's existing first-class token reference type).

- **Render-neutrality gate (§3.2):** re-render all pinned scenarios; output
  must be pixel-identical to the pre-rewrite render. Token adoption changes
  representation, never appearance.
- **Adherence gate:** after rewrite, `design lint-adherence` runs with the
  promoted document; remaining `raw-color` hits must exactly equal the
  unpromoted-candidate list. Anything else is a rewrite bug.
- **Re-import gate:** a source-side literal change to a promoted value must
  surface as a token-value drift against the authored document — not as a
  silent literal reintroduction (§12).

## 6. Workstream 3 — layout ceiling and block-flow lowering

**Landing repo: Burl.**

Burl is flex+grid only, by architecture. Arbitrary React/Electron sources are
not. The importer must make this boundary explicit and mechanically handled:

### 6.1 Display-mode capability report (Phase A deliverable)

The observed-DOM lane records each node's computed `display`,
`position`, float/clear, and inline-flow participation, and classifies it:

| Class | Lowering |
|---|---|
| `flex`, `inline-flex`, `grid` | direct (existing engine) |
| **block-simple** — block container whose in-flow children are all block-level or atomic inline (images, buttons, inline-blocks that occupy their own line) | deterministic lowering to column flex: children stacked, margins mapped to gaps/margins, auto-margins to alignment, **vertical margin collapsing resolved by the importer** (computed observed geometry is the oracle) |
| **inline-text** — container whose children are only text/inline spans | one `Label`/`AttributedString` with `IRTextRun[]` runs |
| **unsupported** — floats with wrap-around text, table layout, multi-column, mixed inline flow with embedded boxes | named `layout-unsupported` diagnostic + scenario-scoped observed-geometry projection as the fallback render |

The lowering must reproduce the *observed* geometry for the captured
scenarios; where the flexbox lowering and the observed geometry disagree by
more than tolerance, the node is flagged, not silently accepted.

### 6.2 Responsive constraints

Per the prior plan §5.5, observed absolute geometry stays a per-regime
projection. Source-aware recovery parses the source's actual media/container
queries into per-regime constraint sets; the block-flow lowering runs per
regime. Promotion of a projection to an authored responsive constraint
requires source evidence, recorded in provenance.

## 7. Representation

Carried from the prior plan with these bindings to existing types:

- **Render IR** — extend `@pulp/import-ir` and C++ `DesignIR` additively
  (both are versioned; the DesignIR JSON reader is already
  permissive/versioned). Every imported node retains stable anchor
  (content-hash strategy for observed DOM), source provenance, typed
  layout/paint/text, raw source or observed evidence, semantic role +
  accessible name, optional action-binding ID, keyed-list identity,
  confidence, and unsupported-capability diagnostics — all fields that
  already exist or extend existing groups.
- **ApplicationBindingManifest** — new, bounded, versioned schema as in the
  prior plan §5.3/§6.2: source module/component anchors, stable semantic
  identities, typed action/event/data-contract signatures, retained
  source-owned entry points, required Burl capabilities, scenario coverage.
  Unknown **required** contract variants fail closed; unknown optional
  variants are preserved and diagnosed. Schema + validator + neutral fixture
  in Burl; Palot instance in the consumer repo.
- **AuthoredTokenDocument** — §5.3.
- **VisualSkin** — §4, serialized in the DesignIR envelope.

## 8. Text, fonts, and icons

Text and icon fidelity are where the existing import lanes accumulated the
most scars; those lessons become requirements:

- **Fonts are pinned and bundled.** Source font files ship via the existing
  `IRFontAsset` lane and register with the shaper so `fontFamily` resolves to
  the exact face. A shaper fallback substitution during parity validation is
  a **hard failure with a named diagnostic**, never a silent visual
  approximation. Skia/HarfBuzz/ICU stay at the visual harness's pinned
  versions for all parity captures.
- **Metrics parity is measured, not assumed.** Native text runs measurably
  wider/narrower than Chromium's. Wrap policy is authored data (white-space,
  break, max-lines, overflow — prior plan §8, kept verbatim), and the
  component matrix includes a text case whose pass criteria are line-break
  positions and baselines, not just pixels. Shaped glyph state never
  serializes into the IR (prepare/layout split, kept).
- **Inline `<svg>` → native vector rewrite is a named deliverable.** The
  observed-DOM lane must rewrite inline SVG (Lucide et al.) into exact vector
  assets or typed SVG primitives — the known open gap in the existing lanes.
  Vector widgets must default to no-fill (the opaque-black default-fill trap
  is a known leakage source and is covered by the poison audit §10.2).
  Unicode substitution remains a hard failure.
- **Icon semantics** are classified as in the prior plan §9 (decorative vs
  labeled vs stateful vs library-inherited vs unavailable), with license
  provenance and content hashes via the existing asset manifest. Missing
  assets fail with visible diagnostics.
- **The faithful-SVG lane is the sanctioned fallback**, not a cheat: where a
  subtree cannot yet be expressed as skinned native widgets, `faithful_svg` +
  interactive overlays renders the source's own vector output with live
  native controls — with provenance marking it a projection, and a
  diagnostic keeping it on the gap ledger until widget-level import covers
  it.

## 9. Interaction and application behavior

Unchanged from the prior plan §10: every visible primary control is a real
native widget or native-semantic composite; the twelve Palot flows (project
selection through variable-height scrolling with anchor/focus preservation)
are the behavior bar; bindings are verified through post-action semantic
state, not screenshots. The stream reducer, collection anchoring, and
text-editing contracts are delivered where they live today (consumer repo
and/or framework as appropriate), with the framework-generic parts backed by
Burl-side tests per §2.1.

## 10. Validation strategy

### 10.1 Component gate before screen assembly

Eight components, each captured in every applicable state
(rest/hover/pressed/focused/selected/disabled):

1. Transparent sidebar ghost button.
2. Selected sidebar session row.
3. Composer: border, radius, placeholder, toolbar, focus state.
4. Exact SVG icon button.
5. Inline-code Markdown span.
6. Primary stop/cancel pill.
7. Keyboard-focus ring on an interactive control (focus-visible parity).
8. Scroll container with styled overflow/scrollbar.

Each comparison records source properties, token refs, skin values, geometry,
screenshot metrics, and semantic assertions.

### 10.2 Poison-theme leakage gate (new, mechanical)

"Any unrequested Burl default color is a failure" becomes testable: render
every component-matrix and full-screen scenario against a **poison theme**
in which every theme color token and widget fallback resolves to a reserved
sentinel color. Any sentinel pixel in the capture proves a painter consulted
theme/default instead of the skin. Zero sentinel pixels is the gate. This
also proves §4.2's painter migration is complete without auditing painters
by hand.

### 10.3 Metrics (rebuilt on the real harness)

Per pass:

- exact dimension validation (existing);
- full-frame and **per-region** tolerance-MAE, changed-pixel counts, and
  diff bounding boxes (existing `compare_screenshots`, `diff_bounds`,
  region-diff tooling with labeled region files);
- content-floor validation to reject blank/degenerate captures (existing
  `analyze_screenshot_content`);
- text line-break and baseline assertions (§8);
- semantic-tree and interaction-trace assertions (existing simulate/inspect
  surfaces);
- **new, small, pinned additions:** an SSIM implementation in the validation
  tooling (Python lane, pinned deps) for structural comparison, and
  edge-map comparison for geometry drift. These are deliverables of Phase B,
  not assumptions.

Antialiasing tolerances may be declared narrowly per renderer pair and can
never excuse geometry, wrapping, color, icon, or control-state differences
(kept verbatim).

### 10.4 Capture discipline and false-regression guards

The prior plan's §11.3 manifest pinning is kept in full (clean source
revision, route/mock state, frozen clock, theme, 1200×800 @ DPR 2, exact
dimensions, capture boundary, method, regions, postconditions; no resizing,
cover-fit, implicit crop, or mixed boundaries). Added, from hard experience
in the existing lanes:

- **Skia screenshot backend only** for any capture containing images or
  vectors — the CoreGraphics backend renders file-backed images as filename
  placeholders and produces false regressions;
- native captures come from a build verified to contain the GPU host
  (`MacGpuWindowHost` present), never a CPU-only fallback;
- parity runs refuse stale checkouts/binaries (freshness check before any
  reported score);
- comparison montages are labeled;
- two consecutive captures of a deterministic scenario must be
  byte-identical before any diff score is reported (kept from Phase A gate).

## 11. Implementation phases and gates

### Phase A — source truth and contracts

Deliverables: deterministic source capture; stable observed-DOM inventory
with content-hash anchors; **display-mode capability report (§6.1)**;
binding-manifest schema + Palot instance; authored-token document schema +
**token-candidates.json** for the token-less lane; exact asset + font
inventory (hashes, licenses); capability report naming every unsupported
property, layout class, transition, and mode-pairing gap.

Gate: two repeated captures byte-identical per deterministic scenario; every
primary control has stable identity; every unsupported capability is named —
including layout classes; candidate extraction is deterministic across two
runs.

### Phase B — visual skin + token machinery (framework critical path)

Deliverables: `VisualSkin` schema + serialization; `View` skin storage +
precedence helpers; painter migration for the widgets in the component
matrix; materializer skin attachment (all `NativeWidgetKind` cases);
poison-theme harness; exact CSS color normalization; font resolution +
bundling; inline-SVG rewrite path; **token promotion CLI + rewrite pass +
render-neutrality gate**; SSIM/edge-map additions to the validation tooling;
block-simple flow lowering; draft (schema-only) Swift/AppKit token emitter
contract.

Gate: eight-component matrix passes in all states with zero poison pixels,
no Palot literals in Burl, no default-theme leakage; token
promote-and-rewrite is render-neutral on the component fixtures; all
existing theme-driven tests pass with no skin attached.

### Phase C — bounded native vertical slice

As the prior plan: sidebar selection, variable-height transcript, native
composer, typed stream reducer, one responsive regime change.
Gate: mouse, keyboard, IME, accessibility, re-import, screenshot, and ≥3
streamed fixture deltas pass through one implementation.

### Phase D — full screen and eleven-pass convergence

As the prior plan: all controls and assets; all eleven scenario passes
(shell geometry; window chrome; header; sidebar; transcript; typography/
Markdown/tool content; resting composer; editing/selection/clipboard/IME;
scrolling + anchors; responsive regimes at 1200/760/600; real streamed
interaction with cancel/retry) — all current at one exact source/native
commit pair; region-by-region gap ledger; no regression of accepted passes.
Gate: every pass green at one commit; every control has post-action semantic
proof.

### Phase E — real OpenCode and standalone closeout

Unchanged from the prior plan: immutable Burl pin; standalone `.app`; real
project/session/chat flow with multiple streamed chunks; cancel/retry/
persistence; launch responsiveness; architecture/linkage inspection
excluding Chromium/WebView; accessibility + IME evidence; benchmark/trace/
screenshot/adversarial-review artifacts. Gate: completion claimed only after
the built app is launched, visually inspected, driven by real mouse/keyboard
automation, and completes a real conversation.

### Phase F — generalization proof (new)

Deliverables: the held-out second application slice (neutral fixture in
Burl) imported through the same pipeline with **no pipeline changes other
than generalizable rules**; its own capability report, component matrix
subset, and token-candidate → promotion run.
Gate: the held-out slice reaches its component-matrix bar using only
mechanisms that existed when Palot's Phase D closed; any required fix is
reviewed against §3.3 before landing.

## 12. Re-import and ownership

As the prior plan §13 — anchors, tweaks, drift/orphan reporting as the base
mechanism; the binding manifest records source-owned vs consumer-owned
seams; conflicts produce deterministic diagnostics; generated-source string
rewriting is not the ownership mechanism. Required re-import tests, with two
additions (marked):

- source color/token change;
- **source literal change to a value promoted to a token** (must surface as
  token-value drift, not a silent literal reintroduction) *(new)*;
- source text change;
- component reorder;
- responsive layout change;
- action signature change;
- deleted bound node;
- renamed or moved source component;
- asset replacement;
- **skin-affecting state style change (e.g. hover color) round-trips into
  the VisualSkin diff, preserving consumer tweaks on other states** *(new)*.

## 13. Cross-platform targets

Unchanged in intent from the prior plan §14, demoted in schedule: the
canonical artifacts (IR, VisualSkin, AuthoredTokenDocument, binding
manifest) are serialized JSON with no Burl C++ types, which is the
target-neutrality guarantee. The Palot proof targets `burl-skia` only.
AppKit/SwiftUI lowering is a post-Phase-E experiment consuming the same
artifacts; the existing baked SwiftUI codegen is the existence proof that
the DesignIR side lowers. No Swift emitter code before Phase E closes.

## 14. Security, licensing, and supply chain

Unchanged from the prior plan §15: hashed, license-tracked assets; opt-in
hash-verified network fetch; credentials outside render/transport logs;
pinned/checksummed sidecar with notices; pinned build-time-only generators;
generated output records tool versions and source hashes; license-
incompatible fonts/assets fail closed during parity validation.

## 15. Resume decision package

Implementation resumes only with a reviewed, bounded Phase B package:

- no full-screen Palot work;
- no Palot literals in Burl;
- the `VisualSkin` contract + precedence helpers + painter migration for the
  matrix widgets;
- the poison-theme harness proving zero default leakage;
- one exact color/token resolver and one exact inline-SVG path;
- token candidate extraction + promotion + render-neutral rewrite on the
  component fixtures;
- eight representative native components with stateful screenshots and
  semantic interaction tests;
- an architectural and adversarial review of the resulting diff.

If that package cannot reproduce the source components without default-theme
leakage or product-specific exceptions, stop and revise the architecture
before continuing Palot.

## 16. Risks requiring continued scrutiny

1. **Skin expressiveness creep** — the pressure to grow `VisualSkin` toward
   CSS. Mitigation: the fixed state model + named-unsupported diagnostics;
   any proposed selector/cascade semantics is an architecture change
   requiring review, not a patch.
2. **Block-flow lowering fidelity** — margin collapsing and inline-flow
   edge cases silently mis-lowered. Mitigation: observed-geometry oracle
   check per scenario (§6.1) and the unsupported class failing loudly.
3. **Text metrics divergence** between Chromium and Skia shaping beyond
   honest tolerances. Mitigation: bundled fonts, pinned shaper stack,
   line-break/baseline assertions; if a case cannot converge, it is a named
   diagnostic, not a relaxed threshold.
4. **Token inference over-promotion** — a plausible-looking generated
   palette treated as design truth. Mitigation: promotion is explicit and
   provenance-recorded; render-neutrality keeps promotion from ever changing
   appearance; unpromoted candidates persist visibly.
5. **Painter migration half-done** — some widgets skinned, others leaking.
   Mitigation: the poison-theme gate is binary and covers every capture.
6. **Observed projections calcifying** — per-regime absolute geometry
   accumulating instead of source constraints. Mitigation: provenance tags +
   the §6.2 promotion rule; the gap ledger keeps projections visible.
7. **Consumer/framework boundary erosion** — Palot specifics drifting into
   Burl under schedule pressure. Mitigation: the hygiene check plus §3.3
   review discipline; Phase F is the structural test that the pipeline is
   product-agnostic.
