# Palot 1200x800 standards/property audit v13

v13 supersedes v12 after closing the complete `align-self` value set observed in the canonical capture. This remains an intermediate compatibility ledger, not a whole-app parity claim.

JSON SHA-256: `a1ca49d8706f000cf3068b59a8017a129e11c50a020efc94a0ede97174d4be6c`

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v13.json \
  --no-fail
```

## Evidence delta

| Metric | v12 | v13 |
|---|---:|---:|
| Resolved typed evidence references | 69 | 70 |
| Unresolved evidence references | 48 | 45 |

The three stale references on `align-self` were replaced by one exact family route. Computed `auto` retains parent alignment inheritance, while computed `stretch` overrides a centered parent and recomputes cross-axis geometry in Yoga. Both survive typed/native IR and native materialization.

`align-items` remains deliberately unresolved: the observed audit also reports baseline syntax, and center/normal fixtures alone are insufficient evidence for baseline geometry. It stays red rather than being cleared by enum admission.

## Proof run

```sh
bun --cwd=packages/pulp-import-ir test \
  align-self-auto-semantics align-self-stretch-semantics
# 2 pass, 0 fail, 4 expectations

./build/test/pulp-test-design-import-native-materializer \
  '[align-self-auto],[align-self-stretch]'
# 2 cases, 11 assertions, pass

python3 tools/import-design/test/test_compat_audit.py
# 9 tests, pass
```

No Palot selector, product constant, captured coordinate, consumer source, or canonical artifact was changed.
