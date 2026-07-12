#pragma once

#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <limits>
#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace pulp::state {

struct AsyncTaskKey {
    std::uint64_t channel = 0;
    std::uint64_t generation = 0;
    friend bool operator==(const AsyncTaskKey&, const AsyncTaskKey&) = default;
};

enum class AsyncEventKind {
    accepted, delta, progress, snapshot, cancel_accepted,
    completed, failed, rolled_back, disposed
};

struct AsyncEvent {
    AsyncTaskKey key;
    std::uint64_t seq_first = 0;
    std::uint64_t seq_last = 0;
    std::uint64_t command_id = 0;
    AsyncEventKind kind = AsyncEventKind::delta;
    std::string logical_id;
    std::string payload;
};

struct AsyncTraceEntry {
    std::string action;
    AsyncTaskKey key;
    std::uint64_t seq_first = 0;
    std::uint64_t seq_last = 0;
    std::uint64_t state_hash = 0;
};

class AsyncReducer {
public:
    struct Limits {
        std::size_t max_events = 128;
        std::size_t max_bytes = 1024 * 1024;
        std::size_t max_reorder_events = 128;
    };

    enum class Phase { idle, running, cancelling, completed, failed, rolled_back, disposed };

    explicit AsyncReducer(std::uint64_t channel = 1) : AsyncReducer(channel, Limits{}) {}
    AsyncReducer(std::uint64_t channel, Limits limits) : channel_(channel), limits_(limits) {}

    AsyncTaskKey start(std::string checkpoint = {}) {
        if (generation_ == std::numeric_limits<std::uint64_t>::max()) {
            epoch_restart_ = true;
            generation_ = 0;
        }
        ++generation_;
        ++command_id_;
        expected_seq_ = 0;
        phase_ = Phase::running;
        state_ = std::move(checkpoint);
        checkpoint_ = state_;
        queue_.clear();
        reorder_.clear();
        queued_bytes_ = 0;
        ingress_closed_ = false;
        overload_emitted_ = false;
        cancellation_requested_ = false;
        cancel_accepted_ = false;
        retry_of_.reset();
        trace("start", key(), 0, 0);
        return key();
    }

    AsyncTaskKey retry() {
        const auto old = key();
        const auto checkpoint = checkpoint_;
        auto result = start(checkpoint);
        retry_of_ = old;
        trace("retry", result, 0, 0);
        return result;
    }

    AsyncTaskKey key() const { return {channel_, generation_}; }
    std::uint64_t command_id() const { return command_id_; }
    Phase phase() const { return phase_; }
    const std::string& state() const { return state_; }
    const std::vector<AsyncTraceEntry>& trace_log() const { return trace_; }
    std::size_t queued_events() const { return queue_.size(); }
    std::size_t queued_bytes() const { return queued_bytes_; }
    std::size_t stale_drops() const { return stale_drops_; }
    std::size_t duplicate_drops() const { return duplicate_drops_; }
    std::size_t terminal_callbacks() const { return terminal_callbacks_; }
    bool cancellation_requested() const { return cancellation_requested_; }
    bool epoch_restarted() const { return epoch_restart_; }
    std::optional<AsyncTaskKey> retry_of() const { return retry_of_; }

    bool enqueue(AsyncEvent event) {
        if (event.key != key()) {
            ++stale_drops_;
            trace("stale_drop", event.key, event.seq_first, event.seq_last);
            return false;
        }
        if (ingress_closed_ || terminal()) return false;
        if (event.seq_last < event.seq_first) return false;

        if (event.kind == AsyncEventKind::delta && !queue_.empty()) {
            auto& tail = queue_.back();
            if (tail.kind == AsyncEventKind::delta && tail.logical_id == event.logical_id &&
                tail.seq_last + 1 == event.seq_first) {
                if (queued_bytes_ + event.payload.size() > limits_.max_bytes)
                    return overload();
                tail.seq_last = event.seq_last;
                tail.payload += event.payload;
                queued_bytes_ += event.payload.size();
                trace("coalesce_delta", event.key, event.seq_first, event.seq_last);
                return true;
            }
        }
        if (event.kind == AsyncEventKind::progress) {
            // Progress may replace only an adjacent progress range. Replacing
            // an older entry across an intervening lossless event would make
            // the new sequence range cover that event and silently discard it
            // as a duplicate during reduction.
            if (!queue_.empty()) {
                auto& tail = queue_.back();
                if (tail.kind == AsyncEventKind::progress &&
                    tail.logical_id == event.logical_id &&
                    tail.seq_last + 1 == event.seq_first) {
                    queued_bytes_ -= tail.payload.size();
                    if (queued_bytes_ + event.payload.size() > limits_.max_bytes)
                        return overload();
                    event.seq_first = tail.seq_first;
                    tail = std::move(event);
                    queued_bytes_ += tail.payload.size();
                    trace("replace_progress", tail.key, tail.seq_first, tail.seq_last);
                    return true;
                }
            }
        }
        if (queue_.size() >= limits_.max_events ||
            queued_bytes_ + event.payload.size() > limits_.max_bytes)
            return overload();
        queued_bytes_ += event.payload.size();
        queue_.push_back(std::move(event));
        return true;
    }

    std::size_t drain(std::size_t event_budget = std::numeric_limits<std::size_t>::max(),
                      std::size_t byte_budget = std::numeric_limits<std::size_t>::max()) {
        std::size_t events = 0;
        std::size_t bytes = 0;
        while (!queue_.empty() && events < event_budget) {
            const auto next_bytes = queue_.front().payload.size();
            if (events != 0 && bytes + next_bytes > byte_budget) break;
            AsyncEvent event = std::move(queue_.front());
            queue_.pop_front();
            queued_bytes_ -= next_bytes;
            bytes += next_bytes;
            ++events;
            accept_or_reorder(std::move(event));
            if (terminal()) break;
        }
        return events;
    }

    void request_cancel() {
        if (phase_ != Phase::running) return;
        phase_ = Phase::cancelling;
        cancellation_requested_ = true;
        trace("cancel_request", key(), expected_seq_, expected_seq_);
    }

    void gap_timeout() {
        if (!reorder_.empty() && !terminal()) fail_protocol("protocol_gap");
    }

    void dispose() {
        if (phase_ == Phase::disposed) return;
        ++generation_;
        ingress_closed_ = true;
        cancellation_requested_ = true;
        queue_.clear();
        reorder_.clear();
        queued_bytes_ = 0;
        phase_ = Phase::disposed;
        trace("dispose", key(), expected_seq_, expected_seq_);
    }

    static std::vector<std::uint64_t> replay_hashes(std::uint64_t channel,
                                                     Limits limits,
                                                     const std::vector<AsyncEvent>& events) {
        AsyncReducer reducer(channel, limits);
        reducer.start();
        for (const auto& event : events) reducer.enqueue(event);
        reducer.drain();
        std::vector<std::uint64_t> hashes;
        for (const auto& entry : reducer.trace_log())
            if (entry.action == "start" || entry.action == "reduce")
                hashes.push_back(entry.state_hash);
        return hashes;
    }

private:
    bool terminal() const {
        return phase_ == Phase::completed || phase_ == Phase::failed ||
               phase_ == Phase::rolled_back || phase_ == Phase::disposed;
    }

    static bool is_terminal(AsyncEventKind kind) {
        return kind == AsyncEventKind::completed || kind == AsyncEventKind::failed ||
               kind == AsyncEventKind::rolled_back || kind == AsyncEventKind::disposed;
    }

    bool overload() {
        if (overload_emitted_) return false;
        overload_emitted_ = true;
        ingress_closed_ = true;
        queue_.clear();
        reorder_.clear();
        queued_bytes_ = 0;
        AsyncEvent failure{key(), expected_seq_, expected_seq_, command_id_,
                           AsyncEventKind::failed, {}, "overload"};
        queue_.push_back(std::move(failure));
        queued_bytes_ = queue_.front().payload.size();
        trace("overload_reserved", key(), expected_seq_, expected_seq_);
        return false;
    }

    void accept_or_reorder(AsyncEvent event) {
        if (event.key != key()) {
            ++stale_drops_;
            trace("stale_drop", event.key, event.seq_first, event.seq_last);
            return;
        }
        if (event.seq_last < expected_seq_) {
            ++duplicate_drops_;
            trace("duplicate_drop", event.key, event.seq_first, event.seq_last);
            return;
        }
        if (event.seq_first > expected_seq_) {
            if (reorder_.size() >= limits_.max_reorder_events) {
                fail_protocol("protocol_gap");
                return;
            }
            reorder_.emplace(event.seq_first, std::move(event));
            return;
        }
        if (event.seq_first < expected_seq_) {
            fail_protocol("overlapping_seq_range");
            return;
        }
        reduce(event);
        while (!terminal()) {
            auto found = reorder_.find(expected_seq_);
            if (found == reorder_.end()) break;
            auto ready = std::move(found->second);
            reorder_.erase(found);
            reduce(ready);
        }
    }

    void reduce(const AsyncEvent& event) {
        if (terminal()) return;
        if (phase_ == Phase::cancelling && cancel_accepted_ &&
            !is_terminal(event.kind)) {
            fail_protocol("event_after_cancel_accepted");
            return;
        }
        switch (event.kind) {
            case AsyncEventKind::accepted:
                break;
            case AsyncEventKind::delta:
                state_ += event.payload;
                break;
            case AsyncEventKind::progress:
                progress_ = event.payload;
                break;
            case AsyncEventKind::snapshot:
                state_ = event.payload;
                checkpoint_ = state_;
                ++revision_;
                break;
            case AsyncEventKind::cancel_accepted:
                cancel_accepted_ = true;
                break;
            case AsyncEventKind::completed:
                if (!event.payload.empty()) state_ = event.payload;
                phase_ = Phase::completed;
                finish_terminal();
                break;
            case AsyncEventKind::failed:
                state_ = checkpoint_;
                phase_ = Phase::failed;
                finish_terminal();
                break;
            case AsyncEventKind::rolled_back:
                state_ = checkpoint_;
                phase_ = Phase::rolled_back;
                finish_terminal();
                break;
            case AsyncEventKind::disposed:
                phase_ = Phase::disposed;
                finish_terminal();
                break;
        }
        expected_seq_ = event.seq_last + 1;
        trace("reduce", event.key, event.seq_first, event.seq_last);
    }

    void finish_terminal() {
        ingress_closed_ = true;
        queue_.clear();
        reorder_.clear();
        queued_bytes_ = 0;
        ++terminal_callbacks_;
    }

    void fail_protocol(std::string_view reason) {
        state_ = checkpoint_;
        phase_ = Phase::failed;
        ingress_closed_ = true;
        ++terminal_callbacks_;
        trace(std::string(reason), key(), expected_seq_, expected_seq_);
    }

    std::uint64_t state_hash() const {
        std::uint64_t hash = 1469598103934665603ull;
        for (unsigned char byte : state_) {
            hash ^= byte;
            hash *= 1099511628211ull;
        }
        hash ^= static_cast<std::uint64_t>(phase_);
        hash *= 1099511628211ull;
        return hash;
    }

    void trace(std::string action, AsyncTaskKey task, std::uint64_t first, std::uint64_t last) {
        trace_.push_back({std::move(action), task, first, last, state_hash()});
    }

    std::uint64_t channel_ = 1;
    Limits limits_;
    std::uint64_t generation_ = 0;
    std::uint64_t command_id_ = 0;
    std::uint64_t expected_seq_ = 0;
    std::uint64_t revision_ = 0;
    Phase phase_ = Phase::idle;
    std::string state_;
    std::string checkpoint_;
    std::string progress_;
    std::deque<AsyncEvent> queue_;
    std::map<std::uint64_t, AsyncEvent> reorder_;
    std::size_t queued_bytes_ = 0;
    std::size_t stale_drops_ = 0;
    std::size_t duplicate_drops_ = 0;
    std::size_t terminal_callbacks_ = 0;
    bool ingress_closed_ = false;
    bool overload_emitted_ = false;
    bool cancellation_requested_ = false;
    bool cancel_accepted_ = false;
    bool epoch_restart_ = false;
    std::optional<AsyncTaskKey> retry_of_;
    std::vector<AsyncTraceEntry> trace_;
};

} // namespace pulp::state
