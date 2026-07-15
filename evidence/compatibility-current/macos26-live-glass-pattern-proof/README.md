# macOS 26 live Liquid Glass backdrop proof

Date: 2026-07-15

## Verdict

Pass. A visible production Burl `NSWindow` using Skia/Dawn and the portable
`WindowBackdropEffect::liquid_glass` contract responds to pixels from a separate
AppKit window ordered behind it. An opaque Burl root blocks the same influence.

This proof also found and corrected two false-positive paths in the prior
harness:

1. `screencapture -l<window>` captures an isolated window surface and cannot
   prove behind-window composition. System capture now records the actual
   on-screen window rectangle.
2. A full-window `NSGlassEffectView` wrapping the CAMetalLayer resolves to a
   covering neutral material. The portable macOS material stack now uses a
   behind-window `NSVisualEffectView`, a clear Tahoe `NSGlassEffectView`, and
   the Burl CAMetalLayer as ordered siblings. Imported content remains topmost
   and fully opaque where it paints; transparent pixels expose native material.

No consumer product styles or Palot import artifacts were changed.

## Mechanical evidence

The test `macOS liquid glass system capture responds to a live behind-window
pattern` constructs a separate borderless AppKit checkerboard and swaps between
two high-contrast palettes without changing Burl pixels or window geometry.
It captures four WindowServer-composited images:

- `transparent-pattern-a.png`
- `transparent-pattern-b.png`
- `opaque-pattern-a.png`
- `opaque-pattern-b.png`

The interior region comparison recorded in `live-glass-receipt.json` is:

- transparent A/B similarity: `0.0` at tolerance 8;
- transparent A/B mean error: `12.5641`;
- opaque A/B similarity: `1.0`;
- opaque A/B mean error: `0.0`.

The native hierarchy receipt additionally proves:

- `NSWindow.isOpaque == false`;
- an `NSGlassEffectView` exists in the production hierarchy;
- the glass and Burl content share one material container;
- the hosted AppKit view and CAMetalLayer are nonopaque;
- CAMetalLayer background alpha is zero; and
- left, top, right, and bottom hosted-content insets are all zero.

The source-window frame remains rounded in all captures. The changing pattern
is visible outside the rounded window mask; inside the mask it affects the
transparent glass capture while the opaque root remains stable. This is the
negative control that distinguishes real backdrop influence from a static tint.

## Screenshot hashes

```text
c9d2b9f1bc61a78d99e338b89b1bd977b7039b428e933ae1ee26c7599fd2f2ea  transparent-pattern-a.png
cede3b19b251ab6635ff10358a7c420213e842c820f767a416547a8bc5175752  transparent-pattern-b.png
306385a8c66243ed90fe11402bc7e847f24b9a5a84ecd9d00fd5f29739f7b58a  opaque-pattern-a.png
93d5dcbf353a44847a4ad44ca06ddc766ab0cb4a0398ac4b2c0077d216b6464a  opaque-pattern-b.png
```

The full opaque PNG hashes differ only because the checkerboard remains visible
outside the rounded window mask. The asserted interior crop is pixel-identical,
which is the relevant covering-root negative control.

## Commands and results

```sh
cmake --build build --target pulp-test-mac-platform-harness -j4
PULP_MAC_GLASS_CAPTURE_DIR="$PWD/evidence/compatibility-current/macos26-live-glass-pattern-proof" \
  ./build/test/pulp-test-mac-platform-harness '[live-backdrop]' \
  --reporter console --durations yes
./build/test/pulp-test-mac-platform-harness '[window-chrome]' \
  --reporter console --durations yes
```

Results:

- live-backdrop proof: 71 assertions, 1 test case, pass;
- complete window-chrome cohort: 133 assertions, 8 test cases, pass;
- complete mac platform harness: 320 assertions pass across 21 test cases,
  with 2 ELYSIUM cases skipped because their optional fixtures are absent.

The screenshots were inspected through the image harness after a successful
vision probe using `test/fixtures/import-fidelity/assets/knob_ref.png`.
