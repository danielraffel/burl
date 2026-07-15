# Palot 1200x800 standards/property audit v12

v12 supersedes v11 after closing the computed letter-spacing and exact runtime font-family routes. This remains an intermediate compatibility ledger, not a whole-app parity claim.

JSON SHA-256: `f18cd6c147a56a7ffd015b008e015e9b3b80531541f47711df1e4324786416d1`

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v12.json \
  --no-fail
```

## Evidence delta

| Metric | v11 | v12 |
|---|---:|---:|
| Resolved typed evidence references | 67 | 69 |
| Unresolved evidence references | 50 | 48 |

Implementation conformance remains 85 supported, 16 partial, 2 missing, 11 unsupported, and 1,868 unknown observations.

## Newly resolved rows

- `letter-spacing`: computed `normal` and signed/fractional used pixel values survive typed and native IR, override inheritance explicitly, and alter shared text-shaping metrics and Skia pixels. Unresolved authored units/expressions fail closed rather than being approximated during import.
- `font-family`: the ordered CSS stack is joined to per-node CDP used-font receipts, licensed bundled faces, or explicit CoreText platform contracts. Exact face provenance reaches FontResolver, per-codepoint fallback, shared shaping, and Skia paint; substitution remains a parity-blocking diagnostic.

## Proof run

```sh
bun --cwd=packages/pulp-import-ir test letter-spacing-normal imported-fonts
# 20 pass, 0 fail, 62 expectations

./build/test/pulp-test-design-import-native-materializer '[letter-spacing-normal]'
# 1 case, 6 assertions, pass

./build/test/pulp-test-canvas-fonts '[runtime-receipt]'
# 2 cases, 14 assertions, pass

./build/test/pulp-test-widgets-label '[label-cache]'
# 6 cases, 14 assertions, pass

python3 tools/import-design/test/test_compat_audit.py
# 9 tests, pass
```

These changes are reusable importer/font-runtime contracts. No Palot selector, product constant, captured coordinate, consumer source, or canonical artifact was changed.

## Remaining red gates

The audit reports 69 resolved and 48 unresolved references. Remaining high-use gaps include backdrop effects, shadows/gradients, alignment variants, and motion properties.
