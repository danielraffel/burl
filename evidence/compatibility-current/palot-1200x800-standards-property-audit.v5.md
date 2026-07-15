# Palot 1200x800 standards/property audit v5

This audit is grounded in the clean source checkout at
`/Users/danielraffel/Code/palot` and the deterministic observed-DOM capture at
`/private/tmp/palot-canonical-height/1200x800-deterministic/source.json`.
The complete per-semantic inventory is
`palot-1200x800-standards-property-audit.v5.json` (SHA-256
`d129572896ead3c6327cfe790e16fe83bc70089f015514c7b05f999df6641c13`).

## Classification contract

- **captured** means the semantic was found in source or in the canonical
  observed capture. Every one of the 1,982 JSON rows is captured.
- **partial/supported claim** means `compat.json` names a concrete route. A
  catalog route is not validation evidence by itself.
- **validated** means a typed evidence ID resolves to an owned Burl path, exact
  route, endpoint, and runnable command.
- **missing** means a reusable capability would be required but no real native
  implementation currently exists.
- **unsupported** means the native architecture explicitly rejects the source
  semantic; it is not silently treated as working.
- **captured-only** means no implementation route is registered. It must not be
  reported as lowered, materialized, or validated.

The JSON keeps capture, conformance, strategy, route, and evidence independent.
It does not infer materialization from a property or API name and does not
upgrade a catalog claim to proof.

## Current census

| Domain | Captured | Supported | Partial | Validated | Missing | Unsupported | Unknown/captured-only |
|---|---:|---:|---:|---:|---:|---:|---:|
| CSS | 95 | 89 | 1 | 3 | 0 | 2 | 3 |
| Electron platform | 163 | 0 | 11 | 1 | 2 | 9 | 141 |
| HTML | 953 | 0 | 0 | 0 | 0 | 0 | 953 |
| React | 697 | 0 | 0 | 0 | 0 | 0 | 697 |
| Browser API | 39 | 0 | 0 | 0 | 0 | 0 | 39 |
| ARIA | 31 | 0 | 0 | 0 | 0 | 0 | 31 |
| Pseudo-state | 4 | 0 | 0 | 0 | 0 | 0 | 4 |

The audit remains honestly red: 86 supported CSS claims lack resolved typed
evidence and 134 CSS evidence references are unresolved. The Electron dialog
route added here is resolved; no other reusable Electron route is described as
validated.

## Electron platform-service classification

Electron source observations are split into reusable platform semantics and
product protocol. Burl does not execute the `electron` module, ship Chromium,
or add a generic string-channel IPC emulator.

### Reusable API and module observations

| Source semantic | Count | Classification | Portable/native disposition |
|---|---:|---|---|
| `BrowserWindow` | 9 | partial | `WindowHost`/`WindowOptions` and native window host; no `webContents` |
| `BrowserWindowConstructorOptions` | 1 | partial | reviewed window-size, minimum-size, transparency, resize, and title subset |
| `Menu` | 2 | partial | portable popup/context menu to native `NSMenu`; not full app-menu parity |
| `Notification` | 1 | partial | portable notifications to macOS UserNotifications subset |
| `Tray` | 1 | missing | `SystemTrayIcon` has no native `NSStatusItem` backend |
| `app` | 9 | partial | standalone entry and window lifecycle subset |
| `contextBridge` | 1 | unsupported | no Chromium isolated world; use typed application actions |
| `dialog` | 2 | partial, validated subset | explicit action binding to `WidgetBridge` and portable `FileDialog` |
| `ipcMain` | 1 | unsupported | product protocol boundary, not a framework string bus |
| `ipcRenderer` | 1 | unsupported | typed actions/services replace renderer IPC |
| `nativeImage` | 1 | partial | asset manifest to native image/SVG decode and Skia paint |
| `nativeTheme` | 1 | partial | portable appearance tracker and native macOS appearance |
| `net` | 3 | partial | portable HTTP stream subset; no Chromium session semantics |
| `safeStorage` | 1 | missing | no portable credential store/Keychain service yet |
| `session` | 1 | unsupported | no Chromium browser session in the native architecture |
| `shell` | 2 | partial | portable external-open/reveal to macOS `NSWorkspace` |
| `systemPreferences` | 1 | partial | appearance and reduced-motion subsets only |
| `electron` module | 16 | unsupported | source marker only; native applications do not load Electron |
| `ipcMain.handle` member | 66 | unsupported | typed product handlers required |
| `ipcRenderer.invoke` member | 67 | unsupported | typed product actions/services required |
| `ipcRenderer.on` member | 9 | unsupported | typed state subscriptions required |
| `ipcRenderer.removeListener` member | 9 | unsupported | explicit typed subscription lifetime required |

The API/member observation counts above are source occurrence counts, not
unique product-channel counts.

### Product IPC stays consumer-owned

The source contains 141 unique literal product-protocol observations: 66
`ipcMain.handle` request channels, 66 matching `ipcRenderer.invoke` request
channels, and 9 renderer notification channels. They remain captured-only by
design. Their unique request/notification families are `app` (2),
`automation` (11), `chrome-tier` (1), `cli` (3), `credential` (3), `dialog`
(1), `fetch` (1), `git` (13), `mdns` (1), `model-state` (2), `notification`
(2), `onboarding` (7), `open-in` (3), `opencode` (4), `prefs` (2), `server`
(1), `settings` (2), `theme` (2), and `updater` (5), plus 9 notifications.

Those names describe Palot's application protocol. Import review must bind each
required behavior to a typed consumer action or a reusable portable service.
Neither a matching label nor a channel-name heuristic may promote one into
framework support.

## Closed generic lane: Electron dialog to portable FileDialog

The highest-impact existing mapping is project/directory selection:

1. a reviewed Electron open-file/save-file/open-directory intent binds to an
   explicit application capability;
2. that capability calls `WidgetBridge` `showOpenDialog`, `showSaveDialog`, or
   `chooseFolder`;
3. the bridge calls portable `pulp::platform::FileDialog`;
4. an installed host backend may intercept deterministically, otherwise macOS
   uses `NSOpenPanel`/`NSSavePanel`; and
5. selection returns a filesystem path while cancellation remains explicit.

The macOS seam now honors an explicitly installed backend for all four dialog
operations (`open_file`, `open_files`, `save_file`, and `choose_folder`). The
callback is copied under the registry mutex and invoked after releasing it, so
host code is never called while the registry lock is held. This supports real
host overrides and test automation without opening a blocking native panel.

Typed evidence `platform:electron-dialog-file-dialog` points at the exact
portable bridge route and focused commands. This is deliberately only partial
Electron `dialog` coverage: message boxes, error boxes, certificate trust,
bookmarks, full Electron option objects, and automatic rewriting of arbitrary
product IPC remain outside the claim.

