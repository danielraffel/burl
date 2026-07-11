# Neutral profile verification

`BURL_BUILD_AUDIO=OFF` is verified at three boundaries: audio dependency and
subdirectory setup must be positively guarded in CMake source, the generated
CMake File API codemodel must contain no audio or plugin targets, and the
installed manifest must contain no audio/plugin headers, libraries, helpers, or
templates.

After configuring and installing a neutral build, run:

```sh
python3 tools/scripts/check_neutral_profile.py \
  --source . \
  --codemodel build/.cmake/api/v1/reply/codemodel-v2-INDEX.json \
  --install-manifest build/install_manifest.txt
```

The codemodel argument may be the normal File API codemodel reply; referenced
target JSON files are followed when present. The guard uses only the Python
standard library and deliberately fails closed on unreadable inputs.
