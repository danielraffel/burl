# Palot 1200x800 standards/property audit v7

v7 supersedes v6 after closing the generic observed-DOM `white-space` route. It is still an intermediate compatibility ledger, not a claim of whole-app parity.

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v7.json \
  --no-fail
```

JSON SHA-256: `25ee3737578662da411a37628c535a45a9d6d8e4a14a6683e7e1106878b8aa40`

## Delta

| Metric | v5 | v6 | v7 |
|---|---:|---:|---:|
| Resolved typed evidence references | 4 | 37 | 38 |
| Unresolved evidence references | 134 | 87 | 85 |
| Supported observed rows without resolved evidence | 86 | 53 | 52 |

Implementation conformance remains unchanged: 89 supported, 12 partial, 2 missing, 11 unsupported, and 1,868 unknown observations.

## White-space route now proved

The route supports all six cataloged modes without consumer-specific logic:

- `normal`: collapses whitespace and soft-wraps.
- `nowrap`: collapses whitespace without soft wrapping.
- `pre`: preserves spaces and segment breaks without soft wrapping.
- `pre-wrap`: preserves spaces and segment breaks with normal whitespace wrapping.
- `pre-line`: collapses spaces while preserving segment breaks.
- `break-spaces`: preserves every space and places the soft-wrap opportunity after each preserved space, retaining its measured advance.

The implementation crosses all relevant boundaries: observed text normalization, typed text IR, NativeDesignIR serialization, native validation, `View::WhiteSpaceMode`, Label multiline state, width-aware measurement, cached TextShaper reflow, Skia paint, responsive computed-style literals, and generated C++.

Unknown syntax remains fail-closed with a named `css-white-space-unsupported` or `native-unsupported-property` diagnostic.

## Proof run

```sh
bun --cwd=packages/pulp-import-ir test \
  text-overflow-observed observed-dom attributed-text native-design-ir-v1 line-height-observed
# 56 pass, 0 fail, 185 expectations

bun --cwd=packages/pulp-import-ir test
# 552 pass, 0 fail, 2,056 expectations across 93 files

cmake --build build --target \
  pulp-test-text-shaper pulp-test-design-import-native-materializer -j6

./build/test/pulp-test-text-shaper '[white-space]'
# 1 case, 7 assertions, pass

./build/test/pulp-test-text-shaper
# 38 cases, 223 assertions, pass

./build/test/pulp-test-design-import-native-materializer '[white-space]'
# 1 case, 38 assertions, pass

./build/test/pulp-test-design-import-native-materializer
# 139 cases, 3,748 assertions, pass

python3 tools/import-design/test/test_compat_audit.py
# 9 tests, pass
```

## Remaining red gates

The audit still reports 52 supported observed rows without resolved typed evidence and 85 unresolved references. High-count remaining debt includes backdrop filtering, per-corner and per-side border longhands, box shadow, text color, positioning/insets, font family/style/weight/size, pointer events, alignment, transforms, cursor/filter, visibility, z-index, and motion properties.

No canonical Palot source, consumer IR, selectors, or product-specific constants were modified.
