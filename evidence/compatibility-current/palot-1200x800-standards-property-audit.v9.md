# Palot 1200x800 standards/property audit v9

v9 supersedes v8 after route-matching the observed positioning and physical inset family. This remains an intermediate compatibility ledger, not a whole-app parity claim.

JSON SHA-256: `d16ea19c0221f242c855bcad9ecf900e8c222dfee06ba4777d0792c40abf0839`

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v9.json \
  --no-fail
```

## Cumulative evidence delta

| Metric | v8 | v9 |
|---|---:|---:|
| Resolved typed evidence references | 50 | 55 |
| Unresolved evidence references | 73 | 68 |
| Supported observed rows without resolved evidence | 40 | 35 |

Implementation conformance is now 88 supported, 13 partial, 2 missing, 11 unsupported, and 1,868 unknown observations. The one supported-to-partial change is deliberate: the old catalog described enum admission for `position: sticky` and `fixed` as behavioral support. Sticky actually fails closed, and fixed is admitted only for the observed viewport-equivalent capture lane.

## Newly resolved rows

The `position`, `top`, `right`, `bottom`, and `left` observations now share one exact typed route:

- computed position and physical inset values become validated TypedLayout values;
- pixel, percentage, linear `calc()`, and explicit `auto` identity survive NativeDesignIR;
- native materialization produces View position and per-edge Dimension terms;
- Yoga recomputes containing-block geometry when the parent resizes;
- z-sorted native hit testing and Skia pixels use the resulting geometry;
- sticky, unknown position keywords, unsupported inset syntax, and non-finite native values fail closed with named diagnostics.

This cohort is reusable importer/runtime support. It does not add Palot selectors, product constants, or captured coordinates.

## Proof run

```sh
bun --cwd=packages/pulp-import-ir test position-observed position-bottom
# 8 pass, 0 fail, 131 expectations

./build/test/pulp-test-design-import-native-materializer \
  '[position-family],[position-bottom],[left]'
# 3 cases, 78 assertions, pass

python3 tools/import-design/test/test_compat_audit.py
# 9 tests, pass
```

The full importer suite (553/553; 2,489 expectations) and full native materializer suite (139/139; 3,748 assertions) are green. No canonical Palot source, consumer IR, selectors, or product constants were modified.

## Remaining red gates

The audit still reports 35 supported observed rows without resolved typed evidence and 68 unresolved references. The compatibility ledger also continues to distinguish captured-app support from whole-browser behavior: fixed positioning outside the viewport-equivalent capture lane and sticky positioning remain explicit red capabilities rather than silent approximations.
