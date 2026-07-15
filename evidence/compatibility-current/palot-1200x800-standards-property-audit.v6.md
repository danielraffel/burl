# Palot 1200x800 standards/property audit v6

This report is the route-matched evidence refresh for the high-use layout and paint properties exercised by the canonical Palot capture. It does not claim whole-app parity and it does not treat a legacy test filename as proof. A row resolves only when its `compat.json` implementation route exactly matches a typed evidence record whose owned artifact exists and whose command was run.

## Reproduction

```sh
python3 tools/import-design/compat_audit.py \
  --source /Users/danielraffel/Code/palot \
  --observed /private/tmp/palot-canonical-height/1200x800-deterministic/source.json \
  --repo . \
  --compat compat.json \
  --evidence-index tools/import-design/catalogs/compat-evidence-index.json \
  --output evidence/compatibility-current/palot-1200x800-standards-property-audit.v6.json \
  --no-fail
```

JSON SHA-256: `928c9d97b2d8f94d712280dceca6c8db8cd815cd1dec21696b8569971f26ea53`

## Evidence delta from v5

| Metric | v5 | v6 | Delta |
|---|---:|---:|---:|
| Resolved typed evidence references | 4 | 37 | +33 |
| Unresolved evidence references | 134 | 87 | -47 |
| Supported observed rows without resolved evidence | 86 | 53 | -33 |

The reduction is mechanical: legacy or route-mismatched references were replaced only on rows covered by the focused capture-to-paint tests below. Implementation conformance counts are unchanged: 89 supported, 12 partial, 2 missing, 11 unsupported, and 1,868 unknown observations.

## Newly route-matched high-use rows

The following observed rows now have one exact typed reference and zero unresolved references:

- Layout classification: `display`.
- Flex sizing and flow: `flex-basis`, `flex-direction`, `flex-grow`, `flex-shrink`, `flex-wrap`, and `gap`.
- Responsive dimensions: `width`, `height`, `min-width`, `max-width`, `min-height`, and `max-height`.
- Box geometry: `padding-{top,right,bottom,left}`, `margin`, and `margin-{top,right,bottom,left}`.
- Text geometry: `line-height` and `text-overflow`.
- Paint/compositing: `background`, `background-color`, `border`, `border-color`, `border-radius`, and `opacity`.
- Clipping: `overflow`, `overflow-x`, and `overflow-y`.

These rows cover thousands of runtime observations in the canonical tree. The evidence routes end in Yoga layout and/or Skia pixels rather than stopping at parsing or IR serialization.

## Commands run

```sh
bun --cwd=packages/pulp-import-ir test \
  layout-capability flex-basis-observed flex-direction-observed flex-grow-observed \
  flex-shrink-observed flex-wrap-observed gap-observed width-observed height-observed \
  padding-observed margin-observed line-height-observed text-overflow-observed \
  opacity-observed overflow-axis-observed background-color-srgb-transparent \
  background-color-css4-observed background-color-rgb-observed border-no-stroke \
  border-opaque-observed border-side-observed border-corner-zero border-corner-large \
  border-corner-fractional border-radius-shorthand
# 110 pass, 0 fail, 695 expectations across 25 files

cmake --build build --target \
  pulp-test-design-import-native-materializer pulp-test-buttons -j6
# both targets built

./build/test/pulp-test-design-import-native-materializer \
  '[display-block],[flex-basis],[flex-direction],[flex-grow],[flex-shrink],\
[flex-wrap],[gap],[width],[height],[padding],[margin-family],[line-height],\
[text-overflow],[opacity],[overflow-axis],[background-color-srgb],\
[background-color-css4],[background-color-rgb],[border-side],[border-side-left],\
[border-side-right],[border-side-top],[border-corner-zero],[border-corner-large],\
[border-corner-fractional],[border-radius-shorthand],[background-layers]'
# 28 cases, 2,583 assertions, all pass

./build/test/pulp-test-buttons \
  '[border-identity],[border-opaque],[border-curve]'
# 3 cases, 18 assertions, all pass
```

## Honest remaining gap

`white-space` remains unresolved. The current observed-DOM test proves `normal` and `nowrap` as part of the text-overflow route, but the catalog's supported-value claim also includes `pre`, `pre-wrap`, `pre-line`, and `break-spaces`. The existing importer deliberately rejects `break-spaces`; therefore v6 does not reuse the narrower text-overflow evidence to manufacture a full `white-space` parity claim.

The remaining 53 supported rows without resolved evidence are still red. High-count examples include backdrop filtering, per-corner and per-side border longhands, box shadow, color, positioning/insets, typography families, pointer events, alignment, transforms, cursor/filter, visibility, and z-index. They require the same exact route-matched treatment before whole-surface compatibility can be claimed.

## Scope and interpretation

- No Palot-specific constants, selectors, geometry, or consumer IR were added.
- The source and observed capture are inputs to the audit only; the implementation/evidence changes live in Burl.
- A resolved row proves the registered route and command, not universal browser conformance for unlisted syntax.
- v6 is an intermediate ledger, not a completion gate for the standalone application goal.
