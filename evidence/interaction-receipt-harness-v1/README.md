# Generic imported-control execution receipt

This evidence is intentionally product-neutral. It proves the reusable macOS
test harness can join every control activation into one machine-readable
record instead of treating a successful callback counter as sufficient.

Each `burl-imported-control-execution-receipt-v1` record contains:

1. the stable imported identity and Burl accessibility-tree role/name/state;
2. an optional external accessibility observation (for example a Computer Use
   AX element index, role, and label) without making the ephemeral index the
   stable key;
3. the root-space test point, press/release hit identities, and actionable
   ancestor;
4. native AppKit pointer-down and pointer-up delivery receipts;
5. callback count, observed action identifier, and exact payload before/after;
6. named application-state values and changed-key requirements;
7. optional settled Skia/Dawn screenshots, stable byte digests, and pixel-diff
   metrics; and
8. an exact `brokenLinks` list and aggregate green/red verdict.

The green fixture changes an accessible toggle through the production AppKit
route and requires both the named `checked` state and visible pixels to change.
The red fixture deliberately leaves AX metadata, callback dispatch, and state
transition unproved. Its red report is important negative-control evidence that
the gate can fail for the intended reasons.

Generated and validated with:

```sh
cmake --build build --target pulp-test-mac-platform-harness -j4
PULP_INTERACTION_RECEIPT_DIR="$PWD/evidence/interaction-receipt-harness-v1" \
  ./build/test/pulp-test-mac-platform-harness \
  '[interaction-receipt]' --reporter compact
python3 -m json.tool \
  evidence/interaction-receipt-harness-v1/green-report.json >/dev/null
python3 -m json.tool \
  evidence/interaction-receipt-harness-v1/red-report.json >/dev/null
```

Result: 29 assertions in 2 test cases passed. The generated summaries are one
green control with zero failures and one intentional red control with one
failure.

Consumer integration should enumerate controls from imported binding metadata,
reset to an isolated baseline before each activation, supply application action
and state observers, and serialize the resulting vector with
`make_execution_report_json`. Product-specific action names remain in the
consumer inventory; this framework harness contains none.
