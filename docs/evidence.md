# Demo evidence manifests

Each standalone demo validation run publishes one JSON manifest conforming to
`tests/evidence/schema/evidence-manifest.schema.json`. The manifest is an index,
not the evidence itself: every artifact has a repository-relative or
bundle-relative POSIX path and a SHA-256 digest. Absolute paths and parent
directory traversal are rejected so manifests remain portable and safe to
publish.

A complete run records build and live-launch results, screenshots, traces,
benchmarks, accessibility and security checks, a real OpenCode integration
transcript, and both architecture and adversarial reviews. `status` records the
observed outcome; producers must not omit failed evidence. Benchmark numbers
belong in the numeric `metrics` object, while detailed protocols and environment
metadata belong in the referenced artifact.

Validate structure during development:

```sh
python3 tests/evidence/validate_manifest.py path/to/evidence-manifest.json
```

For a finalized bundle, also prove every referenced file exists and matches its
digest:

```sh
python3 tests/evidence/validate_manifest.py --verify-files path/to/evidence-manifest.json
```

The validator intentionally uses only the Python standard library. The JSON
Schema remains the canonical interchange contract; the validator enforces its
security- and demo-gate-relevant subset without requiring package installation.
