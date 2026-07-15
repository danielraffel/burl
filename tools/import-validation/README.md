# tools/import-validation/

Scripts for the Spectr import-validation harness — the closed loop that
re-runs `pulp import-design` against `spectr/resources/editor.html`,
relaunches the native Spectr build, captures the live render, and compares
it against the canonical browser screenshot.

See `planning/spectr-validated-runtime-import-product-spec.md` (private
submodule) for the full design.

## What's in here

| Script | Purpose |
|--------|---------|
| `spectr-roundtrip.sh` | The full A→D loop: re-import editor.html → rebuild Spectr → launch → capture → diff. Top-level entry point for "did my Pulp fix narrow the gap?" |
| `diff_against_reference.py` | Deterministic histogram, pixel-distance, local-window luminance SSIM, and edge-map comparison between exact-size PNGs. Resizing is explicit and forbidden for parity gates. Used by `spectr-roundtrip.sh` step 5. |
| `diff_against_reference_regions.py` | Exact-geometry per-region diff that fails on the first broken sub-region instead of averaging the whole frame. Resampling is diagnostic-only and requires `--allow-resize`. |
| `compare_layout_anchors.py` | Source-identity A/B gate for captured DOM versus native layout. Reports missing/duplicate structural nodes, exact rect deltas, and actionable controls without hit regions; it can also emit source-derived pixel regions for `diff_against_reference_regions.py`. |
| `capture_cohort_gate.py` | Rejects visual comparisons whose source state, viewport, fonts, host environment, or capture policy are not the same immutable cohort. |
| `guarded_import_promotion.py` | The only framework operation for replacing a canonical imported IR: verifies candidate/source/manifest hashes, a passed root-state predicate, host-environment provenance, and transparent-window compositing before an atomic rename. |
| `visual_parity_gate.py` | Generic, fail-closed source/native gate driven by `visual-parity-manifest.schema.json`: pins artifacts, fonts, geometry, DPR/backends, calibration, baseline provenance, backdrop/masks, and independently required critical regions. |
| `semantic_probes.sh` | **Semantic-probe vector** — pixel-diff complement. Asserts no soft runtime-import error, lifecycle reached `mounted`+`settled`, and the canvas region actually painted. See below. |
| `check_label_coverage.sh` | Structural label-coverage check — string-match expected reference labels against the imported IR. |
| `reference-labels-spectr.txt` | Ground-truth list of UI labels that must appear in any successful Spectr import. |

`visual_parity_gate.py` is the product-neutral gate. It accepts no command-line
threshold override and no diagnostic resize mode. Thresholds, regions, and masks
are hashed as one reviewed policy; changing any one invalidates the approval.
Every named critical region must pass independently, so a strong whole-window
score cannot hide a broken icon, composer, scrollbar, or glass region. Source
and candidate captures must have exact dimensions, matching DPR and font hashes,
fresh hashes/provenance, and two distinct same-renderer repeat captures whose
measured noise is pinned in the manifest.

For imported applications, run the anchor gate before interpreting broad pixel
regions. It uses the source identities already preserved in Design IR, and does
not accept app-specific selectors or coordinates:

```bash
python3 tools/import-validation/compare_layout_anchors.py \
  --source path/to/source-capture.json \
  --native-layout path/to/native-layout.json \
  --report path/to/anchor-report.json \
  --regions path/to/anchor-regions.json
```

The emitted regions turn every failed source box into a small screenshot A/B
probe. This prevents a visually similar large panel from masking a missing
icon, shifted dropdown, or inert button.

Canonical import artifacts must first be written to a distinct staging path.
`guarded_import_promotion.py` then binds that candidate to its source window
contract, runtime capture, capture manifest, and root-state receipt. It validates
the host projection and window compositing contract before replacing the
canonical path with a same-directory atomic rename. Validation failure never
touches the existing canonical artifact; `--check-only` exercises the complete
gate without replacement. The surface-state claim is read from the source
capture's cohort-hashed `windowSurfaceState`; a consumer-supplied relabel is
rejected.

```bash
python3 tools/import-validation/visual_parity_gate.py path/to/manifest.json
```

## Semantic probes

`semantic_probes.sh` complements the pixel-diff pipeline (planning spec,
2026-05-12). Pixel diff alone has documented
blind spots — a render that "looks right" can still have silent runtime
failures the histogram never sees. The probes catch those:

| Probe | Pixel diff misses... | What the probe asserts |
|-------|----------------------|-------------------------|
| `runtime_import_err` | A Babel-transform or payload-eval failure that left React partially mounted. The chrome paints, the histogram is close, but `__pulpRuntimeImportErr__` is set and `onError` was never wired. | `__pulpRuntimeImportErr__` in the runtime log is `''` (or absent), not a non-empty error string. |
| `runtime_import_trace` | A render that bailed before `useEffect` queues drained, or a stale paint from a previous mount. The pixels are fine; the lifecycle never finished. | The runtime log contains both `phase=mounted` and `phase=settled` markers (or their JSON-shaped equivalents). |
| `canvas_non_blank` | A blank canvas with intact chrome — the chrome dominates the histogram, the overall similarity score passes, but the canvas region (the actual product surface) is empty. | `diff_against_reference_regions.py`'s `central_canvas.blank_candidate` is `false`. |

### Usage

```bash
# After a spectr-roundtrip.sh run, probe the artifacts:
tools/import-validation/semantic_probes.sh \
    --log /tmp/spectr-rt-runtime.log \
    --screenshot planning/screenshots/spectr-native-latest.png

# JSON output for downstream consumers:
tools/import-validation/semantic_probes.sh \
    --log /tmp/spectr-rt-runtime.log \
    --screenshot planning/screenshots/spectr-native-latest.png \
    --json

# Enforce trace presence (turn the trace probe from advisory → hard gate):
tools/import-validation/semantic_probes.sh ... --require-trace
```

The script is intentionally decoupled from `spectr-roundtrip.sh` — it
operates on artifacts produced by an earlier run, so the same probe can
score a screenshot collected anywhere (CI run, hand-captured PNG, frame
extracted from a video). The roundtrip script's contract — write
`/tmp/spectr-rt-runtime.log` and `planning/screenshots/spectr-native-latest.png`
— is the integration surface.

### Exit codes

- `0` — every probe that ran passed (skipped probes do not fail).
- `1` — at least one probe failed.
- `2` — invalid arguments / artifacts unusable.

### Dependencies

- `python3` + the pinned Pillow version in `requirements.txt`. Install with
  `python3 -m pip install -r tools/import-validation/requirements.txt`.
- `diff_against_reference_regions.py` for the canvas probe —
  falls back to whole-frame blank detection from `diff_against_reference.py`
  if the per-region script isn't yet present.
- The trace probe expects the Spectr bridge to emit `phase=<name>` lines
  to the runtime log via `__spectrLog`. While that instrumentation is
  still landing, the probe is advisory by default; pass `--require-trace`
  to enforce.
