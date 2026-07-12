#!/bin/sh
set -eu

build=${1:-build}
out=${2:-"$build/native-migration-text-ax"}
mkdir -p "$out"

test "$(uname -s)" = Darwin
xcodebuild -version >"$out/xcode.txt"
sw_vers >"$out/macos.txt"

ctest --test-dir "$build" --output-on-failure -R \
  'native migration|PluginViewHost \(mac CPU\)|macOS text-a11y' \
  | tee "$out/ctest.txt"

test -s "$out/xcode.txt"
test -s "$out/macos.txt"
test -s "$out/ctest.txt"
echo "$out"
