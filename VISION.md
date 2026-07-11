# Burl vision

Burl aims to make polished cross-platform desktop applications possible with
a compact native runtime rather than a bundled browser.

The framework's primary path is C++20 application code, Yoga layout, Skia 2D
graphics, Dawn/WebGPU acceleration, and a small embedded JavaScript environment
for rapid UI iteration. Native windows, text input, selection, clipboard, IME,
scrolling, and accessibility remain platform services exposed through portable
Burl interfaces.

## Principles

1. **Native application, native lifecycle.** A Burl application is a normal
   platform application and does not require Chromium or a WebView.
2. **Portable core, narrow platform seams.** Layout, rendering, state, and
   application primitives stay portable; unavoidable OS behavior lives behind
   explicit interfaces.
3. **Product-neutral framework.** Burl provides reusable capabilities. Product
   policy, branding, backend integrations, and workflows live in consumer
   repositories.
4. **Inspectable performance.** Rendering, layout, input latency, memory, and
   startup behavior must be measurable with reproducible traces and benchmarks.
5. **Immutable consumption.** Applications consume reviewed Burl revisions,
   allowing framework and product development to move independently.
6. **Permissive public foundation.** Source, dependency inventory, provenance,
   and third-party notices remain auditable in the public repository.

## Extraction status

Burl began from the Pulp source tree recorded in [UPSTREAM.md](UPSTREAM.md).
During extraction, inherited Pulp names and audio/plugin subsystems may remain
until their boundaries can be changed with tests. That transitional state is
documented openly; it is not the intended long-term public API.

The first proof point is a standalone macOS consumer application whose primary
UI runs through Burl's Yoga/Skia/Dawn path and exercises real application
workflows. That consumer remains separate from Burl itself.
