# Palot 1200x800 standards/property audit v16

v16 supersedes v15 after closing the first-line typographic baseline gap in the shared layout IR and native materializer. This remains an intermediate compatibility ledger, not a whole-app parity claim.

JSON SHA-256: `f6aa7578220d9be57d8a1a9104a78fcfbc812f9b4a1e76bbe8eb4de79b061fed`

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v16.json \
  --no-fail
```

## Evidence and conformance delta

| Metric | v15 | v16 |
|---|---:|---:|
| Resolved typed evidence references | 72 | 73 |
| Unresolved evidence references | 41 | 37 |
| Supported conformance rows | 84 | 83 |
| Partial conformance rows | 17 | 18 |

## Newly resolved row

- `align-items`: computed `center`, contextual `normal`, `baseline`, and `first baseline` now survive the typed importer, NativeDesignIR, C++ parse/serialize and code-generation boundaries, and native Yoga materialization. Mixed-size labels prove equal first-line typographic baseline geometry and nonempty Skia pixels. `last baseline` remains explicitly unsupported because Yoga does not expose last-baseline tracking, so the row is honestly partial rather than overclaimed.

## Proof run

```sh
bun --cwd=packages/pulp-import-ir test \
  align-items-center-semantics align-items-normal-semantics
# 3 pass, 0 fail, 14 expectations

./build/test/pulp-test-design-import-native-materializer \
  '[align-items-center],[align-items-normal],[align-items-baseline]'
# 3 cases, 29 assertions, pass

./build/test/pulp-test-design-import
# 376 cases, 2650 assertions, pass

./build/test/pulp-test-design-swift-codegen
# 35 cases, 187 assertions, pass

bun --cwd=packages/pulp-import-ir test
# 556 pass, 0 fail, 2500 expectations

./build/test/pulp-test-design-import-native-materializer
# 140 cases, 3760 assertions, pass

python3 tools/import-design/test/test_compat_audit.py
# 9 tests, pass

cmake --build build -j4
# full Release build, pass
```

The build cache reports `CMAKE_BUILD_TYPE=Release`; the materializer target uses `-O3 -DNDEBUG`. No Palot selector, product constant, captured coordinate, consumer source, or canonical artifact was changed.
