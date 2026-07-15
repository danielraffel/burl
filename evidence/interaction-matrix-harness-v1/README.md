# Scripted interaction matrix harness v1

This evidence pins a backend-neutral control script for source/native A/B runs.
The same `generic-menu.matrix.v1.json` sequence contains hover, click, ArrowDown,
Enter, Escape, outside-click, expected state, and screenshot requirements.

The DesignIR-native and source-adapter runs are adapter contract fixtures. The
`live-react-widget-bridge.run.v1.json` run is different: it is produced by the
generic default-export fixture in
`test/fixtures/interaction-matrix/live-react-widget-bridge.jsx`, bundled with
real React 19 and the real `@pulp/react` reconciler, loaded into WidgetBridge,
and painted to PNG through Skia after every step. Its companion runtime receipt
pins the React version, reconciler identity, hooks, fixture path, exact matrix
path, and bundle digest. This is deliberately not Palot product behavior.

Run:

```sh
cmake --build build --target pulp-test-mac-platform-harness -j6
PULP_INTERACTION_MATRIX_DIR=evidence/interaction-matrix-harness-v1 \
  ./build/test/pulp-test-mac-platform-harness \
  '[interaction-matrix][ab]' --reporter compact
```

Negative coverage (`[interaction-matrix][negative]`) proves missing or ambiguous
fixture selectors fail closed and name `selector-unresolved`, `dispatch-failed`,
and `state-mismatch` instead of clicking a guessed coordinate.

Build and execute the real React/WidgetBridge adapter against the exact same
checked matrix:

```sh
npm --prefix packages/pulp-react install --ignore-scripts --no-audit --no-fund
NODE_PATH=packages/pulp-react/node_modules \
  packages/pulp-react/node_modules/.bin/esbuild \
  test/fixtures/interaction-matrix/live-react-widget-bridge.jsx \
  --bundle --format=iife --platform=neutral \
  --alias:@pulp/react=./packages/pulp-react/src/index.ts \
  --outfile=/private/tmp/burl-live-react-interaction-matrix.js
cmake --build build --target pulp-test-live-react-interaction-matrix -j6
PULP_LIVE_REACT_MATRIX_BUNDLE=/private/tmp/burl-live-react-interaction-matrix.js \
PULP_LIVE_REACT_MATRIX_RECEIPT=evidence/interaction-matrix-harness-v1/live-react-widget-bridge.run.v1.json \
PULP_LIVE_REACT_MATRIX_RUNTIME_RECEIPT=evidence/interaction-matrix-harness-v1/live-react-widget-bridge.runtime.v1.json \
PULP_LIVE_REACT_MATRIX_SCREENSHOT_DIR=evidence/interaction-matrix-harness-v1/screenshots \
  ./build/test/pulp-test-live-react-interaction-matrix --reporter compact
```

The fixture uses actual `useState`, `useLayoutEffect`, and `useRef` state plus
pointer, global-keyboard, and document outside-click callbacks. The final state
receipt proves eight callbacks committed synchronously; it would fail on the
historic deferred-global-event behavior rather than being flushed by a later
click.

The nine PNGs are ordered by capture invocation: after hover, open, ArrowDown,
Enter, reopen, Escape, reopen-for-outside, immediately before outside-dismiss,
and immediately after outside-dismiss. The before/after outside captures are
both retained so the terminal overlay transition is visually auditable.
