# Collection model contract evidence

The neutral collection model is header-only and can be tested without a window,
renderer, network service, JavaScript runtime, or product fixture.

```sh
c++ -std=c++20 -O2 -Icore/view/include test/test_collection_model_contract.cpp \
  -o /tmp/collection-model-contract
/tmp/collection-model-contract
```

Expected output:

```text
collection-model-contract C1-C12 PASS
```

The twelve sections cover randomized patches and prefix sums, prepend anchoring,
stale lifecycle tokens, measurement epochs, stable logical focus and AX identity,
pinned-row bounds, conditional bottom-follow, deterministic anchor fallback,
atomic rejection/reset, 100k-row resource bounds, pinned reset revisions, and
replay under reversed measurement completion.
