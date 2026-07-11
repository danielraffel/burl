# Burl

Burl is an experimental, MIT-licensed native application framework built in
C++20. Its UI stack combines Yoga layout, Skia rendering, Dawn/WebGPU, and an
embedded JavaScript runtime without requiring Chromium or a WebView.

This repository is the framework source. Product-specific applications belong
in separate consumer repositories and depend on immutable Burl revisions.

## Status

Burl is being extracted from the Pulp framework and is not yet a stable SDK.
The inherited source still contains Pulp naming and audio/plugin facilities
while framework boundaries are separated. See [UPSTREAM.md](UPSTREAM.md) for
the exact seed revision and provenance.

No compatibility or release-stability guarantees are made during extraction.

## Build

Burl currently retains the seed repository's CMake build while the standalone
application surface is isolated:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel 4
ctest --test-dir build --output-on-failure
```

Platform prerequisites and dependency pins remain documented in
[DEPENDENCIES.md](DEPENDENCIES.md). Third-party attributions are in
[NOTICE.md](NOTICE.md).

## Repository boundary

- Burl owns portable application, layout, rendering, input, accessibility, and
  runtime infrastructure.
- Consumer repositories own product identity, workflows, service integrations,
  and product UI.
- Private planning material and consumer product code are not part of this
  public repository.

## License

Burl is available under the [MIT License](LICENSE.md). Existing third-party
components retain their respective licenses.
