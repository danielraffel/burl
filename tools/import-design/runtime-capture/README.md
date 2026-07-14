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

`capture-interactions-cdp.ts` accepts selector- or role/name-driven scenarios.
It records pointer over/down/up/click, focus, keyboard and input, scrolling,
disabled/selected/value state, the normalized CDP accessibility tree after each
action, and the source document's DOM focus order. Protocol node IDs are
normalized to deterministic indexes; event timestamps are replaced by sequence
numbers. These traces prove observed scenarios only, not unexercised behavior.
`interaction-repeatability-gate.ts` reruns the complete scenario manifest twice
and requires exact evidence hashes.

Select options whose source DOM omits a value attribute can declare
`payloadReceipt: { "source": "associated-control-value" }` on their action
binding. The capture must then activate each option with a trusted pointer
event. It follows the option's identified listbox to its combobox controller,
observes the controller's associated form value after selection, and stamps
that exact value on every matching option instance. Labels are never treated
as values. Missing, empty, or ambiguous associated controls fail closed; the
interaction evidence records the before/after value and the trusted click.

Command palettes can declare
`activationReceipt: { "source": "command-item-runtime", "policy": ... }`.
Capture then requires the actual CMDK command-item DOM contract, records its
runtime `data-value`, the source React `CommandItem` handler and handler hash,
disabled state, and the component key when one exists. Dynamic commands may use
`payloadReceipt: { "source": "command-item-react-key" }` so theme, scheme, or
session IDs come from the source component key rather than visible text.
`reversible` and `navigation` commands must use trusted pointer or keyboard
input and produce a trusted click receipt. `disabled` and `unsafe` commands are
receipt-only: capture documents their source identity and handler but refuses
to activate them. This keeps destructive, restart-triggering, and developer
commands out of an automated import proof without silently dropping them.

The repeatability gate performs two fresh reloads and requires exact PNG,
evidence, and manifest SHA-256 equality. A failure is a source-fixture problem;
thresholds and image masks are deliberately not available here.

Structural application-state capture also fails closed on transient computed
styles. Before disabling motion for a discrete-state snapshot, it waits for
finite CSS transitions to finish and requires three stable computed-style
samples across settled animation frames. The evidence records the resulting
`transientStyleGate`; a capture with a live transition or unstable style cannot
be promoted. Infinite animations remain motion intent and are handled by the
separate motion-receipt lane.

Loaded remote `<img>` resources in an explicitly preserved live-source session
are captured as immutable evidence instead of becoming native runtime network
dependencies. The capture front end accepts at most 64 unique images, fetches
four at a time with a timeout, permits only PNG, JPEG, WebP, and SVG, verifies
the declared MIME against the payload signature, limits each payload to 1 MiB,
and records the source URL, byte count, SHA-256, and data URI. SVG then passes
through the same element, attribute, reference, and paint sanitizer as captured
inline SVG before native materialization. In the isolated recording-fake mode,
localization remains source-origin-only so it cannot bypass the external-network
deny policy.

Known boundary: CDP reports matched rule metadata but does not specify that
`matchedCSSRules` is returned in cascade order. Capture records that order only
as provenance and uses CSS Typed OM's post-cascade computed value as the
winning keyword receipt (for example, an `auto` margin whose legacy resolved
value is a pixel length). It never infers a winner from rule array order. CDP
and CSS Typed OM cannot reconstruct all build-time CSS transformations or
prove unobserved
responsive states. Those remain explicit import coverage gaps.

The property-scoped matched-style floor covers width, height, min/max
dimensions, and physical margins for every ordinary captured element. This is
ownership evidence, not a browser-used-pixel override: when legacy computed
style reports a used pixel width but CSS Typed OM reports the post-cascade
keyword `auto`, observed-DOM lowering preserves content sizing instead of
freezing that one viewport's measured width into native IR.
