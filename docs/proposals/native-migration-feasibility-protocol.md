# Native Migration Feasibility Protocol

Status: Review draft, revision 3  
Purpose: Falsify or justify schema and Palot migration work  
Decision boundary: No SemanticApplicationIR implementation and no Palot restart until all positive gates pass  
Burl reference: `a22d776198f102179806f3eac5850a991dd4a48b`  
Palot reference: `fd63a75dad3d0e8555ba22a47e720d285889fbf0`

## Outcome being tested

This protocol tests one bounded claim:

> Given application source, explicit typed product bindings, declared scenarios,
> and a supported capability subset, Burl can migrate an interactive screen to
> native Views/Yoga/Skia/Dawn without fixture-specific renderer branches while
> preserving the behavior covered by the declared scenarios.

It does not test or claim arbitrary application conversion. Refusing an unsupported fixture may prove diagnostic quality, but never proves positive migration feasibility.

## Approval rule

The study returns:

- **GO** only if every required positive gate passes without fixture-specific renderer branches or a shipped browser runtime.
- **CONDITIONAL GO** if all foundational gates pass and only explicitly deferred non-Palot capabilities remain.
- **NO-GO** if a positive gate requires hidden-JavaScript reconstruction, screenshot-fitted layout, product behavior inside generic renderer code, or weakens the native input/accessibility requirements.

Expected-negative tests are reported separately and cannot offset a failed positive test.

## Product lanes

### Source-aware migration

Source constructs are classified individually as:

1. generic source adapter;
2. generic Burl framework capability;
3. retained non-browser module with an explicit runtime;
4. consumer-owned typed binding;
5. unsupported blocker.

The migration report must account for every executable dependency reachable from the imported screen. “Source available” is not itself evidence of translatability.

### Scenario-observed migration

A scenario manifest declares initial state, environment, event sequence, expected outcomes, parameter predicates, allowed effects, and unknown-transition policy. Guarantees are limited to the predicates and traces in that manifest.

Unknown events are rejected before mutation, recorded as `UnknownTransition`, and surfaced to the consumer binding. They never become an inert silent action and never terminate the process unless the consumer policy explicitly selects fail-fast.

## Palot source inventory

| Construct | Source evidence | Classification | Required realization |
|---|---|---|---|
| React component and hook hierarchy | `chat/chat-turn.tsx:621-685,983-998`; `chat/chat-view.tsx:126-178` | Generic source adapter plus retained React state runtime where not lowered | Preserve JSX hierarchy, props, conditions, keyed lists, memoization, and supported hooks; no coordinate flattening |
| Jotai atom families and actions | `atoms/messages.ts:10-38,47-89`; `atoms/parts.ts:37-58,64-115`; `atoms/actions/event-processor.ts:162-205` | Retained non-browser module initially | Run behind the existing JS/React state runtime or replace only after store-equivalence traces pass |
| TanStack Router | `router.tsx:1-7,31-69` | Generic Burl gap | Declarative routes, params, history/hash, redirects, lifecycle and error boundaries; deferred from first slice |
| TanStack Virtual | `review/review-panel.tsx:430-483` | Generic Burl gap | Generic collection adapter and prefix-sum measurement; never translate DOM geometry calls literally |
| Composer DOM/caret behavior | `chat/chat-input.tsx:117-118,264-281`; `prompt-input.tsx:608-612,734,1036` | Generic Burl text/input gap | Native multiline editor, selection/caret insertion, focus, keyboard, IME, files and drag/drop; DOM listeners replaced by typed host services |
| Streaming Markdown | `message.tsx:12-20,273-289`; `chat-turn.tsx:627-630,983-998` | Generic Burl gap; math/Mermaid blockers | Incremental basic Markdown and code relayout first; native math/Mermaid or explicit blocking diagnostics later |
| SSE ingestion and batching | `services/opencode.ts:421`; `services/connection-manager.ts:414-539,565-638` | Consumer-owned typed binding | Preserve OpenCode event schema, reconnect generations, cancellation, bounded coalescing and ordered delivery |
| Delta collection | `atoms/streaming.ts:107-163`; `event-processor.ts:173-205` | Retained non-browser module initially | Preserve message/part identity, append deltas, dirty-session notification and frame-budget flush |
| Cancel and retry | `connection-manager.ts:565-638`; `use-server.ts:37-44`; `use-commands.ts:106,138`; `chat-view.tsx:845-847` | Consumer-owned typed binding | Generic cancellation/timers/async stream in Burl; product retry and double-Escape behavior in consumer |
| Persistence | `atoms/preferences.ts:23-105`; `use-draft.ts:35-75`; `chat-view.tsx:841-843` | Retained module plus generic storage service | Preserve versions, migrations, key semantics and draft debounce through native storage adapter |
| Accessibility | `conversation.tsx:14-21`; `chat-question.tsx:409-410,471-498`; `chat-permission.tsx:115` | Source adapter plus Burl platform gap | Typed roles/states/order, stable IDs, live-log semantics, bounded announcements and focus restoration |
| Scroll/focus | `conversation.tsx:14-27,65-91`; `chat-view.tsx:126-228,820-838` | Generic Burl gap | Anchor-aware variable heights, conditional bottom-follow, relayout compensation and focus stability |
| Window chrome/responsive | `main/index.ts:152-198`; `sidebar-layout.tsx:40-130` | Generic Burl gap | Native 1200x800 full-size transparent titlebar and real traffic lights; 600px responsive collapse contract |
| Lucide icons | `sidebar-layout.tsx:16,117`; `message.tsx:17,225,245` | Generic source adapter | Resolve known imports to SVG/vector nodes; unknown icons block |
| Tailwind/shadcn/Base UI | `styles/globals.css:1-3`; `message.tsx:26-44`; `sidebar.tsx:494` | Source adapter plus bounded blockers | Normalize supported utilities/tokens/variants; unsupported cascade, selectors, portals or primitives fail closed |

Palot-specific typed adapters and action bindings are expected in `burl-palot`. Palot-specific renderer or layout branches are forbidden in Burl.

## Positive Palot vertical slice

The first positive slice is one streamed assistant text part:

1. Feed one typed `message.part.updated` event followed by at least three ordered `message.part.delta` events through the consumer OpenCode binding.
2. Reduce them through generation-aware, bounded, frame-coalesced async semantics.
3. Update one stable `(sessionID, messageID, partID, field)` collection entry and notify only that session.
4. Reconcile one assistant turn without recreating its semantic, focus, or accessibility identity.
5. Render plain text, emphasis, and inline code through native `MarkdownView`; every batch performs measured incremental relayout.
6. If the transcript was bottom-following, retain the bottom. If the user was scrolled away, preserve the visual anchor within 0.5 px.
7. Keep composer focus, selection, marked text, and candidate rectangle unchanged during transcript updates.
8. Expose the transcript as an accessibility log with stable message IDs and at most one bounded polite announcement per frame.
9. Repeat with cancellation and a new generation; no event from the old generation may mutate the new state.
10. Run the same trace deterministically and once against a real OpenCode stream.

Required proof:

- exact final text and deterministic per-step state hashes;
- no stale mutation after cancel/generation switch;
- at most one collection/UI/AX notification per frame;
- measured Markdown height updates without row identity loss;
- bottom-follow and scrolled-away invariants;
- unchanged composer focus/selection/marked-text state;
- stable VoiceOver log/message identity and one bounded announcement;
- source and native before/after screenshots at 1200x800;
- no Palot conditional in generic renderer code.

## Executable async semantics

### Types

```text
TaskKey = { channel: u64, generation: u64 }
Command = { key, commandId: u64, kind, payload, baseRevision: u64 }
Event = { key, seq: u64, commandId: u64, kind, payload }
EventKind = Accepted | Delta | Progress | Snapshot | CancelAccepted |
            Completed | Failed | RolledBack | Disposed
Terminal = Completed | Failed | RolledBack | Disposed
```

Each channel owns `generation`, `nextCommandId`, `nextExpectedSeq`, `phase`, `revision`, terminal state, byte/event budgets and optional retry origin. ID overflow fails in debug and starts a new persisted epoch in release.

### Ordering and atomicity

1. `start` increments generation before publishing the task and resets sequence state.
2. Producers may emit concurrently, but all reduction occurs on one UI executor.
3. An event is accepted only for the current `TaskKey`, a nonterminal task, and the expected sequence.
4. Duplicates are ignored and counted. Gaps use a bounded reorder buffer; timeout or overflow terminates with `protocol_gap`.
5. Command acceptance linearizes when `Accepted(commandId)` is reduced.
6. A successful task linearizes when `Completed(finalSnapshot)` is reduced. Final state and terminal status commit atomically before observers run.
7. Local cancellation linearizes when the reducer enters `Cancelling` and sets the cancellation token. `Completed` may win only if reduced first under the declared producer contract; exactly one valid terminal event wins.
8. Events for stale generations are dropped before payload materialization and traced as `stale_drop`.
9. Reducer actions are run-to-completion transactions. Observers never see partial revisions.
10. Event-source fairness is round-robin across nonempty channels with a per-frame event/byte budget; terminals and errors reserve capacity.

### Backpressure

- Event-count and byte-count bounds are explicit.
- `Accepted`, snapshots, tool lifecycle, failures and terminals are lossless.
- Adjacent deltas for the same logical part may coalesce while preserving an inclusive sequence range.
- New progress replaces older progress for the same logical ID.
- Lossless overflow closes ingress and emits exactly one reserved `Failed(overload)`; semantic events are never silently dropped.

### Retry, rollback and teardown

- Mutating commands name `baseRevision` and retain a bounded checkpoint.
- Failure or cancellation restores the checkpoint atomically and emits `RolledBack`.
- Retry creates a new generation/command ID, records `retryOf`, and starts from the last committed revision.
- `dispose` increments generation first, detaches observers, cancels work, closes ingress and joins owned workers off the UI thread.
- Destructors invoke no consumer callbacks; queued closures hold weak state plus `TaskKey`.

### Deterministic replay

Traces record commands, reducer inputs, coalescing ranges, virtual-clock firings, cancellation, checkpoints and output hashes. Canonical payload ordering and a single deterministic executor must reproduce identical state hashes.

### Required positive async traces

- stale generation after restart;
- out-of-order gap recovery and gap timeout;
- delta/cancel/cancel-accepted/rollback ordering;
- completion versus cancellation in both enqueue orders;
- 100k deltas under a 128-event bound with byte-identical reconstruction;
- reserved overload failure without semantic loss;
- disposal with queued closures under ASan/TSan;
- 100 deterministic replays with randomized original worker scheduling.

## Generic variable-height collection ABI

### Snapshot and patch

```text
CollectionSnapshot {
  epoch, revision, count,
  keyAt(index), estimateHeight(index,widthKey),
  contentVersion(key), roleAt(index)
}
CollectionPatch { baseRevision, newRevision, operations[] }
Operation = Insert | Remove | Move | Reload | Reset
```

Snapshots apply only on the UI executor. A patch commits atomically only when its base revision matches, keys are unique, and operation/key assertions pass. Otherwise the old revision remains visible and one reset is requested.

Stable keys are application-owned and never derived solely from index. Selection, focus, measurements, async work and accessibility identity use stable key plus content version.

### Adapter lifecycle

```text
create(reuseKind) -> Row
bind(row, key, index, contentVersion) -> BindingToken
unbind(row, key)
measure(row, widthConstraint) -> { height, measurementVersion }
prepareAccessibility(row, key)
onFocusTransfer(oldKey?, newKey?)
```

All callbacks run on the UI executor unless explicitly marked measurement-worker-safe. Async results carry `{key, contentVersion, bindingGeneration, measurementEpoch}` and are stale-dropped on any mismatch.

### Measurement and anchoring

- Cache key: stable key, content version, quantized exact width, font scale and locale.
- Actual height commits only for a still-valid binding and updates a prefix-sum tree in O(log n).
- Before patch or height change, capture the first fully visible row and its intra-row offset.
- Restore that visual point after commit; if removed, choose deterministic successor then predecessor.
- Bottom-follow applies only when previously within threshold and the user is not scrolling/selecting.
- Composition pins its row. Removal resolves composition through platform policy before unbind.

### Recycling, focus and accessibility

- Pools and pinned rows have explicit count/byte limits.
- `unbind` occurs exactly once before rebind/destruction and clears all transient row state.
- Logical focus is stable key plus descendant semantic ID, never a row pointer.
- Accessibility IDs derive from collection ID, stable key and descendant ID and survive recycling/moves.
- Accessibility traversal observes one pinned collection revision.
- Recycling causes no announcement; semantic insert/update patches may announce.

### Required positive collection traces

- 10k randomized operations against a vector/prefix-sum oracle;
- 500-row prepend plus delayed measurements with <=0.5 px anchor drift;
- late async result after row reuse cannot change the new row;
- width 800→600→800 with reversed completion order;
- focused item moved across 9000 indices retains logical focus and AX ID;
- composing row removal resolves once before unbind;
- bottom-follow versus user-scrolled append behavior;
- anchor removal with concurrent height changes;
- invalid revision/duplicate keys leaves old pixels unchanged and requests reset;
- 100k-row fling stays within live/pool/pinned budgets;
- AX traversal during reset sees exactly one revision;
- deterministic replay under reversed measurement completion.

## Machine-enforced CSS capability intersection

The compiler reads a versioned machine format extending `compat/yoga.json`. Each source feature/value maps to:

- required source semantics;
- exact/equivalent/approximate/unsupported status;
- selected Burl/Yoga/native realization;
- platform/version constraints;
- quantitative geometry/paint tolerances;
- invariant semantic, focus, hit-test and accessibility behavior;
- WPT or project fixture IDs.

Import fails before generation when reachable source semantics have no allowed realization. Runtime observations never overwrite authored CSS semantics.

Required positive responsive fixture: a held-out sidebar/chat layout using supported flex, min/max sizing, overflow and a declared 600px breakpoint. It must match continuously sampled widths, dynamic localized content, two font metric sets, DPR 1/2 and zoom policy without per-fixture rules. Separate expected-negative fixtures cover container queries, subgrid, unsupported intrinsic sizing, writing modes and sticky/fixed combinations.

## Platform text and accessibility matrix

The initial positive boundary is plain native-equivalent multiline input, not contenteditable.

On the pinned macOS/Xcode runtime, automated host tests plus Computer Use and a documented human-assisted VoiceOver/IME protocol must cover:

- committed and marked text;
- replacement ranges and candidate-window rectangle;
- Japanese, Korean and Chinese input methods;
- dead keys and composed accents;
- emoji grapheme and bidi cursor/deletion;
- selection, copy/cut/paste and undo grouping;
- reconversion where the selected IME supports it;
- focus transfer, window deactivation and teardown during composition;
- role, name, value, selected/expanded/disabled/busy state;
- focus order/restoration, keyboard activation and live-region timing.

Every run records OS/build, IME, locale, keyboard layout, VoiceOver version, automation/human steps, screenshots/AX dumps, retries and flakes. Contenteditable/code editors are expected-negative diagnostics and cannot satisfy the positive gate.

## Projection contract

`SemanticApplicationIR` owns semantic identity, behavior and projection selectors. `DesignIR` owns render values only.

- Every semantic node has a globally stable semantic ID.
- Render nodes reference exactly one semantic ID or explicitly declare nonsemantic decoration.
- Visual/responsive projections are typed sparse deltas over a base projection, not independent full application trees.
- Selector guards execute in the semantic reducer and commit semantic state plus render delta atomically.
- Projection swaps preserve semantic ID, logical focus, accessibility ID, pointer capture and collection keys.
- Unknown selector/action variants remain inert, preserved and diagnosed.

## Re-import operation algebra

Consumer overlays name the exact generated base document hash and contain operations over stable contract IDs:

```text
SetProperty | ClearProperty | BindAction | UnbindAction | InsertOwnedNode |
MoveOwnedNode | RemoveOwnedNode | SuppressGeneratedNode | RestoreGeneratedNode
```

Stable IDs derive from source identity when available; generated identities use a persisted namespace plus creation ID and are never silently re-anchored by path, index or content hash.

Merge order is old generated → new generated → replay base-versioned consumer operations. Moves, renames, deletions and type/signature changes produce deterministic tombstones, conflicts or orphan-binding reports. Conflicts are materialized as data; no side is silently selected. Tombstones are garbage-collected only after all overlay bases advance beyond the deletion revision.

Property-based tests cover rename, move, delete, reorder, split/merge, concurrent consumer edit, action signature change, schema migration, rollback and repeated idempotent import.

## Capture threat model and license gate

Trusted-source and hostile-capture modes are separate policies. Hostile capture runs in an OS-isolated disposable environment with no host credentials, clipboard, home directory, SSH agent, browser profile or writable source checkout.

The capture proxy enforces origin, method, body, redirect, DNS resolution and WebSocket policy; disables service workers and persistent caches; limits CPU, memory, disk, requests, response bytes and time; and records an audit log. Inputs are read-only staged copies. Outputs are quarantined and secret-scanned before leaving isolation.

Every asset/font requires an explicit source and redistribution attestation or allowlisted license. Unknown rights exclude the bytes before generation. Output includes an SBOM, content hashes, provenance, exclusions and reviewer decisions.

## Positive versus expected-negative gates

Required positive native-equivalence gates:

1. async streaming/cancellation/replay traces;
2. plain multiline macOS IME and clipboard;
3. supported responsive sidebar/chat across continuous widths;
4. variable-height streamed collection and anchoring;
5. accessibility log/focus/announcement under VoiceOver;
6. the complete Palot vertical slice;
7. one unrelated held-out application slice using the same generic framework paths.

Expected-negative diagnostic gates:

- contenteditable/code editor;
- unsupported container-query/subgrid/writing-mode fixture;
- arbitrary hidden JavaScript transition;
- unlicensed asset/font;
- hostile capture attempting network mutation or secret access;
- unknown action/projection variant.

An expected-negative success requires a stable source-located diagnostic and zero partial output, but does not count toward positive feasibility.

## Final study deliverables

- exact source/fixture revisions and immutable dependencies;
- machine-readable capability and scenario manifests;
- async and collection headless traces;
- live native app builds and architecture/linkage proof;
- real IME/VoiceOver evidence;
- matched source/native screenshots and deltas;
- security audit logs and license/SBOM output;
- re-import property-test corpus;
- independent architecture and adversarial reviews;
- GO/CONDITIONAL GO/NO-GO decision with no deferred mandatory finding.

Only a GO or explicitly scoped CONDITIONAL GO authorizes SemanticApplicationIR schema implementation and a full Palot restart.
