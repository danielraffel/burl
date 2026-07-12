# Native multiline text and accessibility feasibility protocol

The automated gate is pinned to the macOS and Xcode versions recorded by
`tools/validation/run_native_migration_text_ax_gate.sh`. It exercises only
plain native `TextEditor`; contenteditable and code-editor behavior are outside
this positive boundary.

Run a Release build with tests enabled, then:

```sh
tools/validation/run_native_migration_text_ax_gate.sh build
```

The gate combines the focused feasibility suite with the real AppKit
`NSTextInputClient` host suite and macOS `NSAccessibilityElement` suite. The
host suite verifies marked and committed text, UTF-16 replacement ranges,
candidate rectangles, focus synchronization, and teardown. The headless suite
verifies multiline composition rollback, system clipboard operations, undo
grouping, emoji/bidi deletion, semantic snapshots, stable text node IDs, and a
single bounded polite log announcement per frame.

Build and launch the persistent Computer Use/VoiceOver probe with:

```sh
cmake --build build --target pulp-native-migration-text-ax-live -j8
build/test/pulp-native-migration-text-ax-live
```

The probe is a native `WindowHost` containing one plain multiline
`TextEditor`. Its accessibility value tracks edits, so Computer Use and
VoiceOver inspect the same state that the AppKit text-input client mutates.

## Human-assisted VoiceOver and input-method pass

Automation does not claim that an installed input method or VoiceOver speaks
correctly. On the same recorded machine, build and launch the repository's
native TextEditor host, then record each step, result, retry, screenshot, and
accessibility dump:

1. With VoiceOver enabled, navigate by keyboard to the multiline editor. Record
   the spoken role, name, current value, disabled state, and focus order.
2. Enter Japanese, Korean, and Simplified Chinese using the system input menu.
   For each, confirm marked text remains visible, the candidate window follows
   the caret after wrapping and scrolling, replacement ranges replace rather
   than append, and Return commits once.
3. Enter a dead-key accent, an emoji family grapheme, mixed Hebrew/English, and
   a multiline paste. Confirm left/right movement, selection, deletion, copy,
   cut, paste, undo, and redo operate on the expected boundaries.
4. Start composition, deactivate/reactivate the window, transfer focus, then
   close the editor. Confirm composition resolves once, no text reaches the
   next control, and VoiceOver focus is not left on a destroyed element.
5. Stream at least three updates into one accessibility-log item during one
   frame and confirm VoiceOver speaks at most one bounded polite announcement;
   its stable message identity and composer focus must remain unchanged.

A positive report names the macOS build, Xcode build, keyboard layout, locale,
each input method, and VoiceOver version. Any skipped language, stale focus,
misplaced candidate window, duplicated announcement, or unrecorded retry keeps
the platform gate open.
