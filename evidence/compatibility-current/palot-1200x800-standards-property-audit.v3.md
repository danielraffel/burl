# Palot 1200x800 standards/property audit

This audit is grounded in the clean source checkout at
`/Users/danielraffel/Code/palot` and the deterministic observed-DOM capture at
`/private/tmp/palot-canonical-height/1200x800-deterministic/source.json`.
The complete per-semantic inventory is
`palot-1200x800-standards-property-audit.v3.json` (SHA-256
`f2d5a50276bafad366dca888cf493d1efcd9c145590348009a5629802e718857`).

## Classification contract

- **captured** means the semantic was found in source or in the canonical
  observed capture. Every one of the 1,982 JSON rows is captured.
- **lowered/materialized claimed** means `compat.json` names a concrete route.
  A catalog route is not validation evidence by itself.
- **validated** means a typed evidence ID resolves to an owned Burl path, exact
  route, endpoint, and runnable command. Only three rows currently meet this
  bar: `align-content`, `corner-shape`, and `stroke-dasharray`.
- **unsupported** means the catalog explicitly rejects the observed semantic.
  `contain: strict` and `content-visibility: auto` are the two current rows.
- **captured-only** means no implementation route is registered. It must not be
  reported as lowered, materialized, or validated.

The JSON intentionally keeps capture, conformance, strategy, route, and
evidence separate. It does not infer materialization from a property name or
upgrade a catalog claim to proof.

## Current census

| Domain | Captured | Supported claim | Validated end-to-end | Unsupported | Unknown/captured-only |
|---|---:|---:|---:|---:|---:|
| CSS | 95 | 89 | 3 | 2 | 3 |
| Electron platform | 163 | 0 | 0 | 0 | 163 |
| HTML | 953 | 0 | 0 | 0 | 953 |
| React | 697 | 0 | 0 | 0 | 697 |
| Browser API | 39 | 0 | 0 | 0 | 39 |
| ARIA | 31 | 0 | 0 | 0 | 31 |
| Pseudo-state | 4 | 0 | 0 | 0 | 4 |

There are 86 supported CSS claims without resolved evidence and 134 unresolved
evidence references. Those are red audit findings, not implied parity.

## Highest-impact generic gaps

The remaining CSS captured-only set is `contain-intrinsic-size`,
`scrollbar-color`, and `scrollbar-width`. Of these, scrollbar styling is the
highest visible A/B concern because the user explicitly requires preserved chat
gutters and scrollbar clearance. It should be completed as a generic captured
computed-style to native scroll-container lane, not a Palot painter constant.

Electron is a separate platform-service inventory, not a renderer-property
list. All 163 Electron observations remain captured-only in this audit,
including 19 API types/objects and the literal IPC channels. Each must be mapped
to a portable Burl service, a macOS implementation, or an explicit unsupported
decision; CSS compatibility cannot honestly close those rows.

## Closed generic lane: SVG `stroke-dasharray`

The clean source uses `stroke-dasharray: "5, 5"` in
`packages/ui/src/components/ai-elements/edge.tsx`. Before this work the audit
classified it as captured-only even though the faithful SVG path already
allowlisted the presentation property. The lane now has:

1. exact authored dash and dash-offset preservation in canonical inline SVG;
2. a typed compatibility route through the data-backed `faithful_svg` asset,
   `DesignFrameView`, `Canvas::draw_svg`, and Skia `SkSVGDOM`;
3. a native Skia pixel test that proves both an opaque dash pixel and a
   transparent gap pixel; and
4. a resolved typed evidence record with the exact focused commands.

Focused results: 21 TypeScript inline-SVG tests passed (46 expectations), the
Skia dash pixel test passed (7 assertions), and all 9 compatibility-audit unit
tests passed. The full import package also passed 544 tests with 2,027
expectations, and the complete Skia SVG suite passed 22 assertions across four
test cases.
