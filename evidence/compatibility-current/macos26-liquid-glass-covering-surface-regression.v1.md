# macOS 26 liquid-glass covering-surface regression receipt

Date: 2026-07-15

## Verdict

The Burl macOS host installs the required transparent native composition stack.
The current Palot import hides that stack with a full-window opaque root captured
from the source application's browser fallback state. This is a source-capture
environment projection failure, not an `NSGlassEffectView`, Skia, Dawn, or Metal
alpha failure.

Automatically deleting an imported root background is not a valid fix: an
opaque page inside a transparent native window can be intentional. The generic
fix belongs at the capture contract boundary. Capture must either:

1. attach to the live Electron renderer through CDP and verify the expected
   authoritative root state before recording it; or
2. install a reviewed, bounded, declarative host-capability projection whose
   exact method paths and JSON-safe return values are recorded in provenance.

Unprojected host calls remain denied. A capture that depends on an unavailable
host capability must fail closed instead of silently recording browser fallback
pixels.

## Source and import evidence

- Palot detects Electron through `window.palot` and calls
  `window.palot.getChromeTier()` in
  `/Users/danielraffel/Code/palot/apps/desktop/src/renderer/hooks/use-chrome-tier.ts:7-10,39-45`.
- The returned `liquid-glass` state installs the `electron-transparent` root
  class at `use-chrome-tier.ts:59-80`. Browser mode deliberately installs no
  glass class at `use-chrome-tier.ts:27-29,68-69`.
- The authoritative transparent CSS uses 40% body, 45% sidebar, and 80% content
  color mixes from
  `/Users/danielraffel/Code/palot/packages/ui/src/styles/globals.css:208-214,
  235-245,296-308,508-524`.
- The consumer window contract still requests a transparent liquid-glass host:
  `/Users/danielraffel/Code/burl-palot-wt-semantic-restart/apps/desktop-burl/contracts/source-window.browser-window.v1.json:6,14-17`.
- The imported root nevertheless paints `#181818ff` at
  `/Users/danielraffel/Code/burl-palot-wt-semantic-restart/apps/desktop-burl/resources/import/main-chat.observed.design-ir.v1.json:37-39`.
- The reload capture bootstrap freezes time and installs deny-only generic host
  bridges at `tools/import-design/runtime-capture/capture-source-cdp.ts:510-522`.
  It has no declarative projection for source-specific preload capabilities.
  Therefore a source whose visual state depends on `window.palot` can enter its
  documented browser fallback state during capture.
- The existing consumer appearance test only requires
  `passes_content_floor()` at
  `/Users/danielraffel/Code/burl-palot-wt-semantic-restart/apps/desktop-burl/test/mac_settings_appearance_test.cpp:182-202`.
  That floor accepts high opaque coverage, so it cannot prove native glass is
  visible through the rendered root.

The Palot paths above are read-only source evidence. No consumer or reference
checkout was modified for this receipt.

## Framework regression

`test/mac_window_harness.{hpp,mm}` now exposes a native composition receipt that
inspects the production `NSWindow`, `NSGlassEffectView`, hosted `NSView`, and
hosted `CAMetalLayer` rather than inferring native setup from a PNG.

`test/test_mac_platform_harness.cpp` adds:

`liquid glass host receipt distinguishes transparent Burl paint from an opaque covering root`

The test holds the native hierarchy constant and proves both halves:

- transparent Burl root: nonopaque window/view/layer, zero layer-background
  alpha, the `NSGlassEffectView` and Burl content share the same zero-inset
  material container, and captured back-buffer opaque coverage is below 1%;
- opaque full-window root: the exact same native hierarchy remains installed
  while captured opaque coverage exceeds 99%.

This prevents future diagnostics from claiming that the native host is broken
when imported paint is actually occluding it.

## Required promotion gate

A transparent/effect window capture is promotable only when all of the following
are true:

- capture provenance identifies either `live-existing` host services or the
  exact bounded declarative host projection used;
- required visual-state host capabilities resolved successfully;
- a source-owned root-state predicate passes (for example a class, attribute,
  or other stable selector declared by the capture manifest);
- the imported back-buffer alpha/occlusion receipt is compatible with the source
  window contract; and
- the reference screenshot was taken from the same authoritative state cohort.

The predicate and alpha gate are generic manifest data. They must not contain
Palot-specific method names, class names, or colors in Burl implementation code.

`tools/import-design/validate_window_compositing_capture.py` now enforces this
gate independently of capture and lowering. It parses the imported root alpha,
proves whether the root fills both window axes, treats layered roots
conservatively, and rejects a covering root for any transparent/backdrop source
window. The only allowed opaque case requires a
`burl-capture-environment-state-v1` receipt containing:

- `surfaceState: opaque-preference`;
- a `live-existing` or `declarative-projection` host-environment mode;
- a SHA-256 provenance receipt; and
- a passed, source-owned root-state predicate declared by the capture manifest.

The validator does not mutate paint. Its tests use synthetic generic contracts
and values; the real current Palot contract plus imported IR is also exercised
as a negative command-line proof and is rejected for its missing authoritative
opaque-preference receipt.

The runtime capture manifest now supports the other side of this contract
through `hostCapabilityProjection`. The framework-owned implementation is in
`tools/import-design/runtime-capture/host-capability-projection.ts`; it accepts
only bounded read-only property values and fixed sync/Promise method results on
safe custom global paths. It rejects browser globals, prototype paths,
credential-like names, non-JSON values, conflicts, excessive depth/count/size,
and implicit method return semantics. Projected calls are recorded and capped.

The canonical projection participates in the capture cohort identity. Captured
source evidence identifies `hostServices: declarative-projection` and records a
`burl-host-capability-projection-v1` receipt containing its SHA-256 and bounded
path inventory, without duplicating projected return values into the public
receipt. A projection cannot be combined with a preserved live page. The
compositing validator now accepts `declarative-projection` only when that exact
validated receipt is present and its SHA-256 matches the enclosing host-state
receipt; otherwise it fails closed.

Projected captures now require a bounded `rootStatePredicate`. Capture evaluates
its selector plus class/attribute assertions after the DOM reaches the stable
provenance window, requires exactly one match, and records a hash-addressed
receipt. The manifest's `windowSurfaceState` is cohort-hashed and copied into
source evidence; consumers cannot supply or relabel that state later.

`tools/import-validation/guarded_import_promotion.py` is the canonical
replacement boundary. It verifies candidate, source-window, source-capture,
capture-manifest, root-predicate, host-environment, and compositing provenance,
then uses a same-directory fsynced temporary file and atomic replacement. Any
failure preserves the prior canonical artifact.

## Commands

```sh
cmake --build build --target pulp-test-mac-platform-harness -j4
./build/test/pulp-test-mac-platform-harness '[liquid-glass][coverage]' --reporter console
./build/test/pulp-test-mac-platform-harness '[window-chrome]' --reporter console
python3 tools/import-design/test_validate_window_compositing_capture.py -v
python3 tools/import-validation/test_guarded_import_promotion.py -v
bun test \
  tools/import-design/runtime-capture/host-capability-projection.test.ts \
  tools/import-design/runtime-capture/host-capability-projection-capture-integration.test.ts \
  tools/import-design/runtime-capture/root-state-predicate.test.ts \
  tools/import-design/runtime-capture/test/capture-source-cdp.test.ts
python3 tools/import-design/validate_window_compositing_capture.py \
  /Users/danielraffel/Code/burl-palot-wt-semantic-restart/apps/desktop-burl/contracts/source-window.browser-window.v1.json \
  /Users/danielraffel/Code/burl-palot-wt-semantic-restart/apps/desktop-burl/resources/import/main-chat.observed.design-ir.v1.json
```

Results on 2026-07-15:

- focused liquid-glass coverage regression: 15 assertions, 1 test case, pass;
- complete window-chrome cohort: 133 assertions, 8 test cases, pass, including
  a live WindowServer A/B backdrop proof described in
  `macos26-live-glass-pattern-proof/README.md`.
- generic compositing validator: 8 tests, pass;
- guarded canonical promotion: 9 tests, pass;
- complete runtime-capture directory, including bounded projection, root-state
  proof, and capture integration regressions: 64 tests, 237 expectations, pass;
- consumer cross-repository promotion hook: 2 tests, 7 expectations, pass;
- current Palot base IR negative proof: correctly rejected because its opaque
  covering root has no authoritative opaque-preference state receipt.
