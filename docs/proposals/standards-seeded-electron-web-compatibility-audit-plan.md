# Standards-seeded Electron/web compatibility audit

Status: proposal for independent review  
Scope: Burl framework tooling and test infrastructure; consumer-specific audit reports remain in consumer repositories  
Relationship: extends the existing Pulp compatibility catalogs, prop routing tests, native bridge tests, and screenshot harness

## 1. Intent

Make importing a token-less Electron/React application into Burl predictable,
source-faithful, and repeatable. Palot is a demanding proof input, not the
framework specification.

For any source application, the tooling must answer mechanically:

1. Which web, React, accessibility, and Electron capabilities does it use?
2. Which are already supported by Burl, and at what fidelity?
3. Which route through an intentional lowering or observed projection?
4. Which are unsupported and fail closed?
5. Does every supported capability have the correct implementation test?
6. Does every visually meaningful capability have a Chromium-reference versus
   native-Skia reftest at the relevant values and states?
7. Can the application be re-imported without silently losing source behavior
   or design fidelity?

The target outcome is not “support all of Chromium.” It is a deliberate,
tracked subset whose coverage is exact, source-prioritized, and regression
gated.

### 1.1 Core assumptions reviewers must challenge

1. A token-less application is a normal input. Exact source literals, assets,
   fonts, semantics, and constraints are captured before token inference.
2. Chromium/Electron is the visual and behavioral oracle for the source app,
   but not the architecture transplanted into Burl.
3. Native Skia/Dawn rendering can reach one-for-one parity for a bounded,
   audited web-platform surface; unsupported browser behavior must be named,
   not approximated invisibly.
4. Static source analysis alone is insufficient; runtime computed values,
   generated content, pseudo states, responsive regimes, and actual event flow
   are required.
5. Runtime screenshots alone are insufficient; they do not recover responsive
   constraints, application ownership, or event contracts.
6. Existing compatibility data is strong at inventory and bridge completeness,
   but much of it is curated manually and many existing visual tests prove only
   non-empty rendering. The new system must distinguish stronger evidence.
7. Electron, Tauri, and a browser-hosted React app should share the same
   renderer/web audit. Only their platform bridges differ.
8. A successful Palot import is necessary evidence but not sufficient evidence
   of generality; a held-out non-Palot source is mandatory.

### 1.2 What “one-for-one parity” means

For a pinned source revision, viewport, DPR, OS, fonts, state, and deterministic
data scenario, Burl must reproduce:

- exact geometry, clipping, responsive regime, and scroll state;
- paint, gradients, shadows, opacity, borders, radii, icons, and assets;
- font face/weight/style, glyph coverage, baselines, wrapping, truncation, and
  selection;
- hover, pressed, focus, selected, disabled, animation, and cancellation state;
- pointer, keyboard, IME, clipboard, accessibility, persistence, and application
  actions;
- platform window chrome and services where they are part of the experience.

Passing means the declared regional pixel/structural tolerances and semantic
postconditions pass. It does not mean that Burl implements arbitrary Chromium
features outside the audited source surface. An out-of-surface feature must
fail closed or extend the general compatibility layer with its own tests.

## 2. Existing system to extend

This proposal does not introduce a second compatibility mechanism. It joins and
hardens the surfaces already present:

- upstream property catalogs under `tools/import-design/catalogs/`;
- published CSS, React Native, and React compatibility references under
  `docs/reference/compat/`;
- machine-readable CSS support oracles under `tools/harness/oracles/`;
- `@pulp/react` prop routing and its per-wave tests;
- WidgetBridge API manifests, native setters, event routing, and tests;
- DesignIR/import diagnostics and fidelity ledgers;
- native screenshot capture, content-floor, region diff, MAE, local-window
  SSIM, edge-map, and interaction/semantic harnesses.

The current system proves many individual routes. The missing join is:

`source observation -> catalog entry -> implementation route -> native endpoint -> required tests -> evidence`

Without that join, a source can use a supported property value that is not
captured, a captured value can be dropped during lowering, or a setter can exist
without a source-to-native fidelity proof.

### 2.1 Verified current-system reality

The proposal is based on code inspection, with these constraints:

- `compat.json` is the public aggregate; `compat/*.json` slices are mechanically
  synchronized by `tools/scripts/compat_aggregate.py`, but their semantic
  contents are primarily hand-maintained.
- `tools/harness` auto-registers surface adapters and generates reports, while
  current CSS/HTML/RN/Yoga/Canvas oracles are largely curated snapshots whose
  READMEs already describe future runtime-differential upgrades.
- `tools/harness/verify_evidence.py` already supports typed evidence routes such
  as unit, semantic, visual, DOM, and behavior tests. This is the enforcement
  seam for stronger evidence grades.
- `@pulp/react` prop-applier tests are granular and DesignIR deliberately reuses
  the same property vocabulary through `lower-via-prop-applier.ts`.
- `widget_bridge_api_manifest.tsv` is manually maintained but has strong
  two-way registrar completeness tests.
- compatibility docs and catalogs already have a dedicated compat-sync hook,
  pre-push, and CI gate; adding a new surface requires extending its recognized
  prefixes/path map rather than creating a new docs checker.
- existing web compatibility visual tests often prove only that a PNG is
  non-empty. Screenshot regression and design-import tooling have stronger
  comparison primitives, but they are not yet required per supported catalog
  entry.
- `frontend_ir_report.py` and related source analyzers already carry source
  counts, spans, and dynamic-risk information. Electron/Tauri usage should
  extend that envelope rather than introduce an unrelated source-report format.

These facts are deliberate review targets: the proposal must not describe
today's curated catalogs as generated semantic truth, and must not describe
non-empty renders as visual equivalence.

### 2.2 Prototype audit warning

An initial Phase-1 audit prototype was exercised against the clean Palot source
and its observed DOM before this proposal was finalized. It was useful for
discovering literal Electron IPC channels/API members and captured CSS values,
but its raw compatibility-gap totals were not decision-grade:

- regex scanning confused arbitrary TypeScript object/type keys with CSS
  properties;
- TypeScript generics, React components, and type syntax were misclassified as
  HTML elements;
- custom React props, intrinsic HTML attributes, and SVG attributes were mixed;
- computed-style defaults on every captured node overwhelmed authored-use
  frequency;
- aliases such as `word-wrap`/`overflow-wrap` did not normalize to one catalog
  identity;
- browser API feature IDs did not join the existing HTML/DOM catalog naming;
- test ownership strings were interpreted as filesystem paths even when they
  named a test target/tag.

Therefore the source analyzer must be AST/context-aware before strict CI use.
Authored, generated, and computed observations must be separate evidence
classes; aliases must normalize before counting; utility-class semantics must
be decoded; test references need typed resolution; and dynamic/unknown source
constructs must be reported as analysis uncertainty rather than compatibility
failures. Until those gates pass, prototype reports may guide IPC/API discovery
but cannot prioritize framework implementation by raw count.

## 3. Sources of truth

### 3.1 Web platform

- W3C CSS Snapshot and referenced CSS modules for property/value semantics.
- WHATWG HTML, DOM, UI Events, Canvas, and related living standards.
- WAI-ARIA and accessibility API mappings for roles, states, properties, and
  platform exposure.
- Web Platform Tests for executable behavior and visual reftest patterns.
- Existing Pulp catalogs remain the pinned local build inputs; upstream
  revisions and licenses are recorded rather than fetched implicitly in normal
  builds.

### 3.2 React

- React and `react-reconciler` surfaces already targeted by `@pulp/react`.
- Existing prop-applier, host-config, event, style, and intrinsic contracts.
- Source-observed component props, hooks, keyed-list identity, state ownership,
  error boundaries, suspense/async behavior, and portal/overlay use.

### 3.3 Electron

- Official Electron API documentation and, where practical, its machine-readable
  API metadata/type declarations.
- Main/preload/renderer imports and calls actually observed in the source.
- BrowserWindow/BaseWindow options and lifecycle.
- webContents/navigation/window-open/devtools behavior.
- contextBridge/preload/IPC channel contracts.
- menus, dialogs, clipboard, shell, notifications, shortcuts, power/session,
  screen/display, native theme, and window state.
- platform-specific window chrome: titlebar style, traffic-light position,
  draggable regions, full-size content, vibrancy/transparency, shadows, and
  native control insets.

Electron platform capabilities are cataloged separately from renderer/web
properties. They lower behind portable Burl service interfaces with the
smallest safe platform implementation; they never become renderer conditionals.

### 3.4 Tauri

Tauri is a planned sibling host adapter after the Electron catalog is working.
It reuses the complete renderer/web/React/ARIA audit and adds a separate native
host catalog:

- Tauri configuration, window/webview options, capabilities and permissions;
- command invocation and typed payload/result contracts;
- event/listen/emit channels;
- plugin APIs for dialog, filesystem, shell/opener, clipboard, notification,
  shortcuts, updater, process, and window state;
- Rust command implementations and allow/capability policy;
- platform-specific titlebar, drag region, transparency, and window behavior.

The normalized application-service contract is host-neutral:

`Electron IPC/preload | Tauri invoke/events | browser adapter -> ApplicationBindingManifest/Burl service interface`

Tauri must not become an alternate WebView renderer inside the shipped Burl
application. Its source webview is an import oracle, just as Electron's Chromium
renderer is an oracle. Host-specific permissions and security models remain
separate catalog domains rather than being flattened into DOM capabilities.

## 4. Capability model

Every normalized capability record has:

```json
{
  "id": "css.background-image.linear-gradient",
  "domain": "web-renderer",
  "standard": {"name": "CSS Images", "revision": "pinned", "source": "w3c"},
  "syntax": ["linear-gradient(...)"],
  "status": "lowered",
  "route": ["observed-dom", "DesignIR", "IRStyle", "View"],
  "nativeEndpoint": "View::set_background_gradient",
  "platforms": ["macos", "windows", "linux"],
  "limitations": [],
  "tests": {
    "catalog": [],
    "route": [],
    "nativeState": [],
    "visual": [],
    "interaction": [],
    "accessibility": []
  },
  "evidence": []
}
```

Allowed statuses:

- `unseen`: known upstream capability, not used by the audited source.
- `supported`: preserved with equivalent semantics.
- `lowered`: deterministically represented by a different native construct.
- `projected`: scenario/regime-specific observed representation; provenance and
  limitations are required.
- `unsupported`: named fail-closed diagnostic; never silently ignored.

`partial` is intentionally not a status. A subset is expressed as separate
value-family records with explicit unsupported siblings.

### 4.1 Evidence grades

Status and evidence strength are separate. Every claim records these grades:

- `catalogued`: known syntax/API and provenance only;
- `reachable`: a source route and native endpoint exist;
- `semantic`: executable state/behavior equivalence passes;
- `platform`: actual native platform realization passes;
- `visual`: exact-size Chromium/WebKit-source versus Skia reftest passes;
- `application`: source-derived end-to-end interaction passes.

A `supported` visual property cannot stop at `reachable`. A supported Electron
or Tauri service cannot stop at a typed method signature. This prevents the
current weak pattern where a non-empty screenshot or registered setter is
mistaken for fidelity.

## 5. Source usage audit

The audit merges static and runtime evidence.

### 5.1 Static scan

Parse source rather than grep when structure matters:

- TS/JS/JSX imports and member calls;
- React components, props, hooks, events, keys, portals, and contexts;
- CSS files, CSS modules, utility classes after config expansion, inline styles,
  custom properties, media/container queries, pseudo selectors, animations;
- DOM/browser globals and methods;
- ARIA attributes/roles;
- Electron imports, constructor options, event listeners, preload exports,
  IPC sends/invokes/handlers and payload shapes.

Each observation records count, source file/range, representative values, and
whether the value is statically known.

### 5.2 Runtime observation

At deterministic scenario points capture:

- computed styles and resolved values;
- layout geometry and responsive regime;
- ordered direct text/child/pseudo content;
- pseudo states and pseudo elements;
- actual font face/weight/style/glyph coverage;
- SVG/raster assets and hashes;
- semantic roles, accessibility names/states;
- focus/tab order, selection, pointer and keyboard events;
- scroll containers and offsets;
- application action identities and payload contracts;
- platform/window configuration visible through the Electron boundary.

Runtime evidence cannot grant support by itself. It prioritizes and validates
catalog entries; captured absolute geometry remains a projection unless source
constraints prove a reusable rule.

### 5.3 Reconciliation

The report distinguishes:

- statically present and runtime exercised;
- statically present but scenario-uncovered;
- runtime-generated and absent from static source;
- known catalog entry with implementation/test coverage;
- observed but uncataloged;
- observed and explicitly unsupported.

## 6. Generated test obligations

A capability may be `supported` only after its required proof class passes.

| Capability | Required proof |
|---|---|
| Visual CSS/layout/value family | catalog/parser test; route test; native state assertion; exact-size Chromium-vs-Skia reftest; relevant state/responsive variants |
| Text/font/rich text | face/weight/style/glyph proof; wrapping/baseline/selection test; visual region comparison |
| DOM/UI event | real native input trace; order/cancellation/default behavior; semantic postcondition |
| ARIA/accessibility | semantic tree; platform AX mapping; keyboard behavior |
| React prop/hook behavior | reconciler/prop route; update/unmount/key semantics; native result |
| Browser API | deterministic contract/output/error behavior |
| Electron platform API | Burl service adapter contract; platform implementation test; lifecycle/error behavior |
| Unsupported capability | named diagnostic fixture; no mutation/default substitution |

Visual reftests use Chromium/Electron as the source renderer and Burl's real
Skia path as the candidate. They require exact dimensions and record region
MAE, changed pixels, diff bounds, local-window SSIM, edge similarity, content
floor, fonts, and backend identity. Resizing images to make them comparable is
forbidden.

WPT is used selectively:

- import relevant short self-contained tests and reftest patterns by pinned
  revision or generate equivalent local fixtures from the normative behavior;
- record upstream test IDs and licenses;
- do not claim WPT-wide browser conformance;
- prioritize capabilities observed in audited sources, plus structural
  framework fundamentals.

## 7. CI gates

CI fails when:

1. a source observation has no catalog record;
2. a `supported`/`lowered` record lacks its required tests;
3. a parser recognizes a property but lowering drops it;
4. native materialization consumes a value through an undocumented fallback;
5. an unsupported value does not produce a stable diagnostic;
6. docs, machine oracle, router, native endpoint, and tests disagree;
7. a visual reftest changes outside its declared tolerance/provenance;
8. an Electron preload/IPC contract is untyped, unbounded, or unmapped;
9. a source scenario required by static coverage was never exercised;
10. a previously covered capability regresses.

The audit supports two modes:

- framework conformance: all catalog records and neutral fixtures;
- consumer audit: only capabilities used by a pinned source revision/scenario
  set, with counts and evidence links.

## 8. Artifacts and repository ownership

### Burl framework repository

- normalized catalogs and schema;
- standards/upstream revision metadata;
- audit CLI and report validator;
- generic parsers and source scanners;
- route/native/test ownership index;
- neutral fixtures and WPT-derived/equivalent tests;
- generated compatibility docs/oracles;
- CI zero-silent-drop gates.

### Consumer repository

- pinned source revision and scenario manifest;
- source usage report;
- Electron platform/API usage report;
- application binding manifest;
- source and native screenshots/traces/diffs;
- product-specific selectors, action IDs, assets, and expected states.

No product selector, action name, color, coordinate, or screenshot is allowed in
Burl.

## 9. Proposed commands

```sh
# Refresh pinned upstream catalogs intentionally.
burl compat catalog update --css-snapshot <revision> --wpt <revision> --electron <version>

# Audit one source application.
burl compat audit \
  --source /path/to/app \
  --observed evidence/source-semantics.json \
  --electron-version 40.10.6 \
  --out build/compat-audit

# Validate joins and required proofs.
burl compat validate build/compat-audit/report.json --strict

# List prioritized gaps by observed frequency/scenario impact.
burl compat gaps build/compat-audit/report.json

# Run generated/registered proof obligations.
burl compat test build/compat-audit/report.json --backend skia
```

Command names are provisional; the schema and gates matter more than CLI shape.

## 10. Implementation phases

### Phase A — schema and current-system join

- inventory existing catalogs/oracles/docs/routes/tests;
- define the normalized capability and evidence schemas;
- join CSS/RN/React records to current native endpoints and tests;
- make discrepancies visible without changing support claims.

Gate: existing known supported properties resolve to one route and required test
set; uncataloged and orphaned records are enumerated deterministically.

### Phase B — source usage analyzer

- static TS/JS/JSX/CSS/ARIA scan;
- observed-DOM/runtime evidence ingest;
- static/runtime reconciliation and scenario coverage;
- prioritized consumer report.

Gate: two runs byte-identical; every observation has source provenance and a
catalog status; no product data enters the framework catalog.

### Phase C — visual/behavioral obligation generator

- map capability types to proof classes;
- generate fixture manifests, not hand-written screenshots;
- integrate Chromium source capture and native Skia capture;
- exact-size/region/state/responsive comparison.

Gate: intentionally removing one route, endpoint, or reftest produces the
expected CI failure.

### Phase D — Electron platform catalog

- ingest official Electron API/version metadata;
- scan main/preload/renderer and IPC contracts;
- map used APIs to Burl portable service adapters;
- add platform-specific macOS window-chrome proof first, then Windows/Linux.

Gate: every Electron API used by the source is supported/lowered/unsupported;
unknown required preload/IPC contracts fail closed.

### Phase D2 — Tauri platform catalog

- ingest a pinned Tauri schema/API/plugin/capability universe;
- scan TypeScript invoke/event use and Rust command/plugin implementations;
- map used host APIs to the same portable Burl services used by Electron;
- test permission denial, malformed payloads, cancellation, and platform
  lifecycle behavior;
- run the same renderer visual obligations against the source WebKit/WebView2
  environment where source output differs from Chromium.

Gate: a Tauri source audit reuses renderer capability IDs without duplication;
every Tauri-only host API is mapped or explicitly unsupported; no WebView ships
as the primary Burl UI.

### Phase E — held-out generalization

- import a pinned non-Palot multi-component Electron/React source with a real
  source screenshot and exact viewport/DPR metadata;
- make no pipeline changes except reviewed general rules;
- compare its source audit, generated obligations, and native evidence.

Gate: held-out source reaches its declared coverage without product exceptions.

## 11. Relationship to source-faithful import and tokens

This audit does not replace DesignIR, VisualSkin, or token inference. It proves
their coverage:

- literal source values are captured first;
- layout/paint/text/assets/interactions are preserved or diagnosed;
- token candidates may be inferred afterward;
- reviewed promotion rewrites literals to token references;
- the rewrite remains pixel-identical;
- the compatibility report links each tokenized property back to the same
  capability and source evidence.

An application without design tokens is therefore a normal input, not a degraded
lane.

## 12. Security, licensing, and reproducibility

- pin catalog/WPT/Electron revisions and record licenses;
- do not execute untrusted preload/main code during static audit;
- runtime capture occurs in the existing isolated deterministic harness;
- secrets and IPC payload values are redacted while shapes/limits remain;
- external assets are hashed and license tracked;
- network catalog refresh is explicit, never an implicit build step;
- generated reports record tool versions, source commit, viewport, DPR, OS,
  Electron/Chromium version, and renderer backend.

## 13. Review questions

1. Is the five-state model sufficient, or should `emulated` and `native` be
   separate from `lowered`?
2. Which current compatibility files are authoritative versus generated today?
3. Can current WidgetBridge manifests provide a stable endpoint/test index, or
   is a small annotation schema needed?
4. Should WPT-derived tests be vendored at a pinned subset or generated as local
   normative equivalents with upstream IDs?
5. What minimum Electron API domains are required for the first macOS import?
6. How should conditional/dynamic Electron IPC channel names be represented and
   bounded?
7. Which visual values require one representative equivalence class versus
   exhaustive syntax/value tests?
8. How should platform-specific behavior be reported without overstating
   cross-platform support?
9. What is the smallest legitimate held-out Electron/React fixture with a real,
   redistributable source screenshot?
10. Are any proposed CI gates too expensive for presubmit and better split into
    nightly/full tiers?
11. Does the parity definition accidentally permit source-specific projection
    where a reusable constraint or semantic primitive is required?
12. Are Electron and Tauri genuinely sharing one renderer audit, or does the
    schema conceal host-specific rendering differences that need explicit
    source-renderer variants?
13. Which assumptions above are false, insufficiently bounded, or impossible to
    verify mechanically?

## 14. Acceptance criteria

The proposal succeeds when:

- the existing compatibility system has one documented machine-readable join;
- a source audit deterministically enumerates all used web/React/ARIA/Electron
  capabilities;
- every observation maps to an explicit status and proof obligation;
- silent drops and unsupported defaults fail CI;
- visual claims are backed by exact-size Chromium/Electron versus real Skia
  evidence;
- Electron platform features map behind portable Burl services;
- token-less source applications remain first-class;
- Palot contains no framework exceptions;
- a held-out non-Palot application validates the same pipeline.

## 15. Required independent-review response

The reviewing agent should create and return a concrete review artifact, not a
general conversational reaction. Preferred path:

`docs/proposals/reviews/standards-seeded-electron-web-compatibility-audit-review.md`

The response must contain:

1. **Verdict:** `GO`, `CONDITIONAL GO`, or `NO-GO`.
2. **Blockers:** correctness or architecture issues that must change before
   implementation proceeds.
3. **High/medium findings:** each tied to a proposal section and, where the
   finding concerns current feasibility, exact code/test file evidence.
4. **Assumption audit:** accept/reject/modify every assumption in §1.1.
5. **Parity audit:** whether §1.2 is sufficient to justify one-for-one claims and
   what evidence is missing.
6. **Existing-system fit:** whether the plan correctly extends current catalogs,
   harness adapters, oracles, prop-applier tests, WidgetBridge manifest, and
   compat-sync gates rather than duplicating them.
7. **Electron/Tauri boundary review:** whether renderer reuse and distinct host
   service/security catalogs are correctly separated.
8. **Test-harness review:** whether generated obligations genuinely prove
   routing, semantics, platform behavior, accessibility, and visual fidelity;
   flag any “non-empty screenshot” or setter-exists false proof.
9. **Schema/CI critique:** missing states, evidence grades, provenance, failure
   modes, performance tiers, and drift risks.
10. **Required revisions:** exact replacement language or workstreams for every
    blocker.
11. **Answers to all questions in §13.**

The reviewer should inspect the actual current code and tests, not review this
document in isolation. They should commit the review on their own review branch
or return the full Markdown plus its exact path/commit so the root integrator can
ingest and resolve it.
