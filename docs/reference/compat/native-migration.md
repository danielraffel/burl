# Native migration CSS capability gate

`compat/yoga-native-migration-v1.json` is the fail-closed intersection between
authored CSS semantics and Burl/Yoga realizations. It references the canonical
`compat/yoga.json` catalog while adding migration-specific outcomes, platform
versions, tolerances, behavioral invariants, and evidence fixture IDs.

Every reachable source semantic must have a row. `unsupported` rows and absent
rows reject before generation; runtime geometry never promotes an unsupported
authored feature. `approximate` is allowed only when the row names a realization,
quantitative tolerance, invariants, and fixture evidence.

Run the positive held-out probe:

```sh
python3 tools/import-design/validate_native_migration.py \
  test/fixtures/native-migration/responsive-sidebar-chat-v1.json
```

The expected-negative fixture demonstrates the import gate:

```sh
python3 tools/import-design/validate_native_migration.py \
  test/fixtures/native-migration/unsupported-container-query-v1.json
# exits 1: reachable semantic is unsupported
```

The responsive fixture samples both sides of the authored 600 px breakpoint,
two font metric profiles, and DPR 1/2. Its evidence contract requires geometry
and paint tolerances plus semantic-tree, focus-order, hit-target, and AX-order
invariants. Measurements are fixture inputs so the validator remains independent
of any specific UI implementation.
