# macOS composited window capture

`WindowHost::capture_composited_png()` returns pixels and a
`WindowCaptureReceipt`. Consumers must gate visual claims on the receipt; a
non-empty PNG is not sufficient evidence that a CAMetalLayer or a
behind-window material was captured.

## Capture surfaces

- `framework_synthetic_composited` is the deterministic CI oracle. Burl reads
  the actual Dawn/Skia backbuffer and source-over composites it onto a
  framework-owned checkerboard. It is stable across desktop wallpaper, window
  focus, screen-recording permission, and whether the window is visible. It
  proves renderer alpha and in-window composition, but does not claim to
  reproduce the live desktop behind a window.
- `opaque_host_surface` is a deterministic renderer/AppKit oracle for windows
  that do not request translucency.
- `system_composited` is the user-view oracle. On macOS it is a WindowServer
  window capture and can include vibrancy, Liquid Glass, and the desktop behind
  the window. It is intentionally marked non-deterministic because wallpaper,
  focus, display profile, OS material implementation, and screen-recording
  authorization affect the pixels.
- `host_back_buffer` and `appkit_view_cache` are explicit fallbacks. They can
  prove that host pixels exist, but they do not include the behind-window
  backdrop. A parity gate must not relabel either fallback as a system
  composite.
- `backend_defined` means a platform backend returned pixels without enough
  provenance to make a composition claim.

## Required gates

CI and import validation use `WindowBackdropCaptureMode::synthetic`, require
`framework_owns_backdrop`, `deterministic`, and `includes_host_pixels`, and
compare two captures byte-for-byte before doing image metrics. The focused
macOS harness also changes renderer content and requires the composited PNG to
change, preventing an AppKit-cache-only checkerboard from passing.

Live visual review uses `WindowBackdropCaptureMode::system` on a visible window
and requires `surface == system_composited` plus
`includes_behind_window_backdrop`. If WindowServer capture is unavailable, the
receipt remains executable evidence of the limitation and identifies the
fallback; it is not a parity pass.

This separation is portable: other native backends can supply a deterministic
framework-owned backdrop, a platform compositor capture, or an honest
unavailable/fallback receipt without emulating macOS APIs.
