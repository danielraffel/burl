# Deterministic runtime source capture

This framework-owned import tool records browser/Electron source evidence; it is
not a shipped renderer and does not add a WebView. It captures a full CDP DOM
snapshot (geometry, paint order, selected computed styles), a PNG, and matched
CSS declarations in DOM order. Ephemeral CDP backend-node IDs are deliberately
removed because they change after each reload and are not source evidence.

Every declaration is labelled `authored`, `inherited`, or `ua`; the resolved
value remains separately recorded as `computed`. This preserves what CDP can
prove without pretending that computed pixels recover the authored cascade.

The manifest fixes viewport, DPR, clock, settle frames, motion policy, and an
optional forced pseudo-state. CDP is accepted only on loopback. Network is
denied during capture and common host bridges are replaced at document start by
recording fakes that reject calls. Capture must target an already-started,
isolated application whose initial document is locally available; this tool
never starts or authorizes Electron/Tauri host services.

```sh
bun tools/import-design/runtime-capture/capture-source-cdp.ts --manifest capture.json
bun tools/import-design/runtime-capture/repeatability-gate.ts --manifest capture.json
bun test tools/import-design/runtime-capture/test
```

The repeatability gate performs two fresh reloads and requires exact PNG,
evidence, and manifest SHA-256 equality. A failure is a source-fixture problem;
thresholds and image masks are deliberately not available here.

Known boundary: CDP reports winning computed values and matched rule metadata,
but cannot reconstruct all build-time CSS transformations or prove unobserved
responsive states. Those remain explicit import coverage gaps.
