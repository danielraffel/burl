# Palot 1200x800 standards/property audit v10

v10 supersedes v9 after replacing stale free-form references for nine high-use CSS properties with exact importer-to-native evidence routes. This remains an intermediate compatibility ledger, not a whole-app parity claim.

JSON SHA-256: `dd71d58fb46950a5424338ef252fa2c759021abd072365340a25cc145fbd9e37`

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v10.json \
  --no-fail
```

## Evidence delta

| Metric | v9 | v10 |
|---|---:|---:|
| Resolved typed evidence references | 55 | 64 |
| Unresolved evidence references | 68 | 53 |
| Supported observed rows without resolved evidence | 35 | 26 |

Implementation conformance remains 88 supported, 13 partial, 2 missing, 11 unsupported, and 1,868 unknown observations.

## Newly resolved rows

- `color`: CSS Color 4 normalization, inherited/explicit foreground identity, shared native glyph paint, and Skia pixels.
- `cursor`: portable cursor intent through native macOS cursor dispatch, with URL/fallback lists rejected.
- `filter`: ordered typed filter chains through native canvas/Skia composition, distinct from backdrop filtering.
- `font-size` and `font-weight`: captured used values through shared shaping/typeface resolution and native pixels.
- `justify-content`: contextual normal-flow lowering and Yoga redistribution under resize.
- `overflow-wrap`: canonical/legacy aliases through width-dependent native shaping.
- `text-align`: direction-aware logical alignment shared by paint and editing metrics.
- `z-index`: integer/auto semantics through stable paint and reverse hit order.

These are generic property routes. No Palot selector, product constant, or captured coordinate was introduced.

## Proof run

```sh
bun --cwd=packages/pulp-import-ir test \
  text-color-observed cursor-observed filter-observed font-size-observed \
  font-weight-observed justify-content-observed overflow-wrap-observed \
  text-align-observed z-index-observed
# 37 pass, 0 fail, 159 expectations

./build/test/pulp-test-design-import-native-materializer \
  '[text-color],[cursor],[filter],[font-size],[font-weight],\
[justify-content],[overflow-wrap],[text-align]'
# 8 cases, 184 assertions, pass

./build/test/pulp-test-view-zindex-overflow '[z-index]'
# 10 cases, 24 assertions, pass

python3 tools/import-design/test/test_compat_audit.py
# 9 tests, pass
```

The immediately preceding full regression remains green: importer 553/553 with 2,489 expectations and native materializer 139/139 with 3,748 assertions. v10 changes only compatibility route metadata and generated evidence.

## Remaining red gates

Twenty-six supported observed rows still lack resolved typed evidence, and 53 references remain unresolved. High-use remaining cohorts include backdrop filtering, box shadow, background image, font style/family, pointer events, alignment/self-alignment, letter spacing, visibility, and motion properties.
