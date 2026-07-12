#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
binary=${TMPDIR:-/tmp}/pulp-async-reducer-trace-test

${CXX:-c++} -std=c++20 -O2 -Wall -Wextra -Werror \
    -I"$root/core/state/include" \
    "$root/core/state/tests/async_reducer_trace_test.cpp" \
    -o "$binary"
"$binary"
