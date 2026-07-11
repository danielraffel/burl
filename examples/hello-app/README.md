# Burl native hello application

This is the smallest standalone consumer of `burl_add_app`. It creates a native
macOS application bundle and asks `WindowHost` for the GPU path (`use_gpu =
true`), which selects the Skia Graphite/Dawn host when the SDK contains Skia.
It does not create an audio processor or use a plugin runtime manifest.

Build it against an installed SDK:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DPulp_DIR=/path/to/sdk/lib/cmake/Pulp
cmake --build build --target BurlHello --parallel 4
```

Launch the bundle on macOS:

```sh
open -W "build/Burl Hello.app"
```

Capture the actual hidden GPU host back-buffer deterministically:

```sh
"build/Burl Hello.app/Contents/MacOS/Burl Hello" --capture /tmp/burl-hello.png
```

The capture command exits nonzero if a GPU back-buffer cannot be rendered or
encoded. This differs from an offscreen/raster screenshot and therefore proves
the same host used by the visible application.
