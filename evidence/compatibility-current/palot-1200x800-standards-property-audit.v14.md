# Palot 1200x800 standards/property audit v14

v14 supersedes v13 with a ledger-integrity correction. It restores legacy unresolved references on `row-gap`, `text-decoration`, and `text-indent` after a broad metadata edit accidentally attached the position-family evidence ID to those unrelated rows. No compatibility claim is gained or lost.

JSON SHA-256: `88af5e10b6b30c9cb842f90b6182678dd3c88c267064377a5e944841dea9a813`

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v14.json \
  --no-fail
```

## Integrity result

- `semantic:observed-dom-position-family` is now referenced only by `position`, `top`, `right`, `bottom`, and `left`.
- The resolved/unresolved totals remain 70/45.
- Implementation conformance remains 85 supported, 16 partial, 2 missing, 11 unsupported, and 1,868 unknown observations.
- Remaining route mismatches are pre-existing real work: align-items, backdrop-filter, font-feature-settings, and text-rendering.

The correction was found by enumerating every property that referenced the position-family evidence and every audit row with `route-mismatch`; this is stronger than relying on an unchanged summary count.

No Palot selector, product constant, captured coordinate, consumer source, or canonical artifact was changed.
