#include <pulp/state/async_reducer.hpp>

#include <algorithm>
#include <cassert>
#include <iostream>
#include <random>
#include <string>
#include <vector>

using namespace pulp::state;

static AsyncEvent event(AsyncTaskKey key, std::uint64_t seq, AsyncEventKind kind,
                        std::string payload = {}, std::string logical = "part") {
    return {key, seq, seq, 1, kind, std::move(logical), std::move(payload)};
}

static void stale_generation_after_restart() {
    AsyncReducer reducer;
    auto old = reducer.start();
    reducer.enqueue(event(old, 0, AsyncEventKind::delta, "old"));
    auto current = reducer.start();
    reducer.enqueue(event(old, 1, AsyncEventKind::completed, "stale"));
    reducer.enqueue(event(current, 0, AsyncEventKind::delta, "new"));
    reducer.enqueue(event(current, 1, AsyncEventKind::completed));
    reducer.drain();
    assert(reducer.state() == "new");
    assert(reducer.stale_drops() == 1);
}

static void gap_recovery_and_timeout() {
    AsyncReducer reducer;
    auto key = reducer.start();
    reducer.enqueue(event(key, 0, AsyncEventKind::delta, "a"));
    reducer.enqueue(event(key, 2, AsyncEventKind::delta, "c"));
    reducer.enqueue(event(key, 1, AsyncEventKind::delta, "b"));
    reducer.drain();
    assert(reducer.state() == "abc");

    key = reducer.start("checkpoint");
    reducer.enqueue(event(key, 1, AsyncEventKind::delta, "never"));
    reducer.drain();
    reducer.gap_timeout();
    assert(reducer.phase() == AsyncReducer::Phase::failed);
    assert(reducer.state() == "checkpoint");
}

static void cancel_rolls_back() {
    AsyncReducer reducer;
    auto key = reducer.start("base");
    reducer.enqueue(event(key, 0, AsyncEventKind::delta, " transient"));
    reducer.request_cancel();
    reducer.enqueue(event(key, 1, AsyncEventKind::cancel_accepted));
    reducer.enqueue(event(key, 2, AsyncEventKind::rolled_back));
    reducer.drain();
    assert(reducer.cancellation_requested());
    assert(reducer.phase() == AsyncReducer::Phase::rolled_back);
    assert(reducer.state() == "base");
}

static void completion_cancel_linearizes_once() {
    AsyncReducer completed_first;
    auto key = completed_first.start();
    completed_first.enqueue(event(key, 0, AsyncEventKind::completed, "done"));
    completed_first.drain();
    completed_first.request_cancel();
    assert(completed_first.phase() == AsyncReducer::Phase::completed);
    assert(completed_first.terminal_callbacks() == 1);

    AsyncReducer cancelled_first;
    key = cancelled_first.start("base");
    cancelled_first.request_cancel();
    cancelled_first.enqueue(event(key, 0, AsyncEventKind::cancel_accepted));
    cancelled_first.enqueue(event(key, 1, AsyncEventKind::rolled_back));
    cancelled_first.enqueue(event(key, 2, AsyncEventKind::completed, "late"));
    cancelled_first.drain();
    assert(cancelled_first.phase() == AsyncReducer::Phase::rolled_back);
    assert(cancelled_first.state() == "base");
    assert(cancelled_first.terminal_callbacks() == 1);
}

static void coalescing_is_bounded_and_lossless() {
    AsyncReducer reducer(1, {.max_events = 128, .max_bytes = 200000});
    auto key = reducer.start();
    std::string expected;
    expected.reserve(100000);
    for (std::uint64_t seq = 0; seq < 100000; ++seq) {
        expected.push_back(static_cast<char>('a' + seq % 26));
        assert(reducer.enqueue(event(key, seq, AsyncEventKind::delta,
                                     std::string(1, expected.back()))));
        assert(reducer.queued_events() <= 128);
        assert(reducer.queued_bytes() <= 200000);
    }
    reducer.drain();
    assert(reducer.state() == expected);
}

static void overload_has_reserved_terminal() {
    AsyncReducer reducer(1, {.max_events = 2, .max_bytes = 4});
    auto key = reducer.start("base");
    reducer.enqueue(event(key, 0, AsyncEventKind::snapshot, "1234"));
    assert(!reducer.enqueue(event(key, 1, AsyncEventKind::snapshot, "x")));
    assert(reducer.queued_events() == 1);
    reducer.drain();
    assert(reducer.phase() == AsyncReducer::Phase::failed);
    assert(reducer.state() == "base");
    assert(reducer.terminal_callbacks() == 1);
}

static void dispose_invalidates_queued_work() {
    AsyncReducer reducer(1, {.max_events = 20000, .max_bytes = 20000});
    auto key = reducer.start();
    for (std::uint64_t seq = 0; seq < 10000; ++seq)
        reducer.enqueue(event(key, seq, AsyncEventKind::progress, "x", std::to_string(seq)));
    reducer.dispose();
    assert(reducer.queued_events() == 0);
    assert(reducer.phase() == AsyncReducer::Phase::disposed);
    assert(!reducer.enqueue(event(key, 10000, AsyncEventKind::completed)));
    assert(reducer.stale_drops() == 1);
}

static void deterministic_replay_ignores_producer_schedule() {
    std::vector<AsyncEvent> canonical;
    AsyncTaskKey key{7, 1};
    for (std::uint64_t seq = 0; seq < 64; ++seq)
        canonical.push_back(event(key, seq, AsyncEventKind::delta,
                                  std::to_string(seq) + ",", std::to_string(seq)));
    auto expected = AsyncReducer::replay_hashes(7, {}, canonical);
    std::mt19937 random(42);
    for (int run = 0; run < 100; ++run) {
        auto shuffled = canonical;
        std::shuffle(shuffled.begin(), shuffled.end(), random);
        auto actual = AsyncReducer::replay_hashes(7, {}, shuffled);
        assert(actual == expected);
    }
}

int main() {
    stale_generation_after_restart();
    gap_recovery_and_timeout();
    cancel_rolls_back();
    completion_cancel_linearizes_once();
    coalescing_is_bounded_and_lossless();
    overload_has_reserved_terminal();
    dispose_invalidates_queued_work();
    deterministic_replay_ignores_producer_schedule();
    std::cout << "async reducer traces A1-A8: PASS\n";
}
