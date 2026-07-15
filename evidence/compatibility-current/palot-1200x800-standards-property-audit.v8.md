# Palot 1200x800 standards/property audit v8

v8 supersedes v7 after route-matching the complete physical border-side and border-corner families used by the canonical capture. This remains an intermediate compatibility ledger, not a whole-app parity claim.

JSON SHA-256: `2a13e23afcfe4d3928de45cc0de74398727ed9571b1d306ffd80001b80fe3833`

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v8.json \
  --no-fail
```

## Cumulative evidence delta

| Metric | v5 | v6 | v7 | v8 |
|---|---:|---:|---:|---:|
| Resolved typed evidence references | 4 | 37 | 38 | 50 |
| Unresolved evidence references | 134 | 87 | 85 | 73 |
| Supported observed rows without resolved evidence | 86 | 53 | 52 | 40 |

Implementation conformance remains unchanged: 89 supported, 12 partial, 2 missing, 11 unsupported, and 1,868 unknown observations.

## Newly resolved rows

All twelve physical longhands now have one exact typed reference and zero unresolved references:

- `border-{top,right,bottom,left}-{color,width}`
- `border-{top-left,top-right,bottom-right,bottom-left}-radius`

The side-family test covers every color equivalence class and width observed in the capture across all four physical sides, including CSS Color 4 values, fractional alpha, transparent identity, zero width, one pixel, and the two-pixel accent edge. The native tests prove independent Skia fills, transparent/zero suppression, rounded-side joining, and fail-closed asymmetric promoted controls.

The corner-family tests cover zero, all observed fractional pixel radii, and Chromium's oversized pill value. The native paint route preserves authored values and recomputes CSS common-scale overlap normalization when the box resizes instead of freezing captured used geometry.

## Proof run

```sh
bun --cwd=packages/pulp-import-ir test \
  border-side-observed border-corner-zero border-corner-large border-corner-fractional
# 10 pass, 0 fail, 564 expectations

./build/test/pulp-test-design-import-native-materializer \
  '[border-side],[border-side-left],[border-side-right],[border-side-top],\
[border-corner-zero],[border-corner-large],[border-corner-fractional],\
[border-corner-physical-sides]'
# 8 cases, 171 assertions, pass
```

The full importer suite (553/553; 2,489 expectations), full TextShaper suite (38/38), and full native materializer suite (139/139; 3,748 assertions) are green. No canonical Palot source, consumer IR, selectors, or product constants were modified.

## Remaining red gates

The audit still reports 40 supported observed rows without resolved typed evidence and 73 unresolved references. The highest-count remaining rows include backdrop filtering, box shadow, text color, positioning/insets, font family/style/weight/size, pointer events, alignment, transforms, cursor/filter, visibility, z-index, and motion properties.
