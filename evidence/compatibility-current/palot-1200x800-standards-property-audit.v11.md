# Palot 1200x800 standards/property audit v11

v11 supersedes v10 after adding exact evidence and honest end-to-end coverage boundaries for font style, pointer events, and visibility. This remains an intermediate compatibility ledger, not a whole-app parity claim.

JSON SHA-256: `ed8d6a3b18015886934b65baa887279c8c80bda0a876e8a2f2f0d5d42f44252c`

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v11.json \
  --no-fail
```

## Evidence and conformance delta

| Metric | v10 | v11 |
|---|---:|---:|
| Resolved typed evidence references | 64 | 67 |
| Unresolved evidence references | 53 | 50 |
| Supported conformance rows | 88 | 85 |
| Partial conformance rows | 13 | 16 |

The supported-to-partial changes remove three false whole-property claims:

- `font-style`: normal and italic materialize faithfully; bare oblique remains visible in IR but is rejected by native materialization, while angled oblique is rejected during lowering until native `slnt`-axis semantics exist.
- `pointer-events`: HTML auto/none reaches native hit testing; SVG painted-region keywords and React Native box-only/box-none are not silently treated as CSS parity.
- `visibility`: visible/hidden preserve layout and remove hidden content from paint, hit testing, and accessibility; observed-DOM collapse is not claimed.

## Proof run

```sh
bun --cwd=packages/pulp-import-ir test \
  observed-font-style-visibility pointer-events-observed
# 7 pass, 0 fail, 17 expectations

./build/test/pulp-test-design-import-native-materializer \
  '[font-style],[visibility],[hit-test]'
# 7 cases, 66 assertions, pass

python3 tools/import-design/test/test_compat_audit.py
# 9 tests, pass
```

These changes are generic importer/runtime contracts and evidence metadata. No Palot selector, product constant, captured coordinate, consumer source, or canonical artifact was changed.

## Remaining red gates

The audit reports 67 resolved and 50 unresolved references. Remaining supported-without-proof rows are now narrower because unsupported browser semantics are represented as partial coverage rather than hidden behind enum admission or fallback behavior.
