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

# CTest exits successfully when a regex matches zero tests. That is not a
# passing platform gate: require at least one started test and the success
# summary before accepting the evidence bundle.
grep -Eq 'Start[[:space:]]+[0-9]+:' "$out/ctest.txt"
grep -Eq '100% tests passed' "$out/ctest.txt"

test -s "$out/xcode.txt"
test -s "$out/macos.txt"
test -s "$out/ctest.txt"
echo "$out"
