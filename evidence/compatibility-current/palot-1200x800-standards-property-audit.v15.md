# Palot 1200x800 standards/property audit v15

v15 supersedes the v14 integrity correction after closing layered box shadows and honest 2D transform coverage. This remains an intermediate compatibility ledger, not a whole-app parity claim.

JSON SHA-256: `f86ceccc2a3cd33d0164dc4ac5e6ef21dca4a6a80005c2cb7356a3fe43a451f4`

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v15.json \
  --no-fail
```

## Evidence and conformance delta

| Metric | v14 | v15 |
|---|---:|---:|
| Resolved typed evidence references | 70 | 72 |
| Unresolved evidence references | 45 | 41 |
| Supported conformance rows | 85 | 84 |
| Partial conformance rows | 16 | 17 |

## Newly resolved rows

- `box-shadow`: explicit none identity and ordered multi-layer inset/outset geometry survive CSS Color 4 normalization, typed/native IR, reverse CSS paint order, alpha-zero suppression, and Skia shadow paint.
- `transform`: invertible 2D matrices and canonical translate/scale/rotate forms share the same affine geometry for paint and inverse hit testing. The catalog is now partial rather than falsely claiming 3D/perspective parity; singular, unsupported percentage translation, perspective, and 3D forms fail closed.

## Proof run

```sh
bun --cwd=packages/pulp-import-ir test box-shadow-none transform-observed
# 10 pass, 0 fail, 34 expectations

./build/test/pulp-test-design-import-native-materializer \
  '[box-shadow-none],[box-shadow-layers],[transform-2d]'
# 3 cases, 44 assertions, pass

python3 tools/import-design/test/test_compat_audit.py
# 9 tests, pass
```

No Palot selector, product constant, captured coordinate, consumer source, or canonical artifact was changed.
