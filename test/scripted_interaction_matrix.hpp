#pragma once

// Backend-neutral scripted interaction contract for import A/B validation.
//
// A matrix describes user intent and observable postconditions.  It does not
// describe AppKit events, DOM APIs, or product-specific behavior.  Adapters
// resolve the fixture selectors and translate each operation for either the
// current materialized DesignIR tree or a live source application.  This keeps
// source and candidate runs on one sequence instead of maintaining two subtly
// different test scripts.

#include "imported_control_execution_report.hpp"

#include <choc/text/choc_JSON.h>

#include <algorithm>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace pulp::test::interaction {

enum class ScriptedOperation {
    click,
    hover,
    key_down,
    key_up,
    outside_click,
};

struct ControlSelector {
    // Stable fixture identity. Native adapters normally resolve this against
    // an imported anchor/id; source adapters normally resolve it against a
    // data attribute or DOM id supplied by the same fixture manifest.
    std::string fixture_id;
    std::optional<std::string> role;
    std::optional<std::string> label;
};

struct ScriptedStep {
    std::string id;
    ScriptedOperation operation = ScriptedOperation::click;
    std::optional<ControlSelector> target;
    // Portable key vocabulary: Escape, ArrowUp, ArrowDown, ArrowLeft,
    // ArrowRight, Enter, Space, Tab. Adapters fail closed on unknown keys.
    std::optional<std::string> key;
    StateSnapshot expected_state;
    bool capture_before = false;
    bool capture_after = true;
};

struct ScriptedMatrix {
    std::string schema = "burl-scripted-interaction-matrix-v1";
    std::string id;
    std::vector<ScriptedStep> steps;
};

struct InteractionDriver {
    std::string backend;
    // Returns the backend's resolved stable identity. Missing/ambiguous
    // selectors return nullopt; the runner never guesses by geometry.
    std::function<std::optional<std::string>(const ControlSelector&)> resolve;
    std::function<bool(const ScriptedStep&, const std::optional<std::string>&)> dispatch;
    std::function<void()> settle;
    std::function<StateSnapshot()> observe_state;
    std::function<std::vector<std::uint8_t>()> capture_png;
};

struct ScriptedStepReceipt {
    std::string id;
    std::string operation;
    std::optional<ControlSelector> selector;
    std::optional<std::string> resolved_identity;
    StateSnapshot before;
    StateSnapshot after;
    StateSnapshot expected;
    std::string before_digest;
    std::string after_digest;
    bool dispatch_succeeded = false;
    bool state_matched = false;
    bool capture_succeeded = false;
    std::vector<std::string> failures;
    bool passed = false;
};

struct ScriptedRunReceipt {
    std::string schema = "burl-scripted-interaction-run-receipt-v1";
    std::string matrix_id;
    std::string backend;
    std::vector<ScriptedStepReceipt> steps;
    bool passed = false;
};

inline std::string operation_name(ScriptedOperation operation) {
    switch (operation) {
        case ScriptedOperation::click: return "click";
        case ScriptedOperation::hover: return "hover";
        case ScriptedOperation::key_down: return "key-down";
        case ScriptedOperation::key_up: return "key-up";
        case ScriptedOperation::outside_click: return "outside-click";
    }
    return "unknown";
}

inline std::optional<ScriptedOperation> parse_operation(std::string_view operation) {
    if (operation == "click") return ScriptedOperation::click;
    if (operation == "hover") return ScriptedOperation::hover;
    if (operation == "key-down") return ScriptedOperation::key_down;
    if (operation == "key-up") return ScriptedOperation::key_up;
    if (operation == "outside-click") return ScriptedOperation::outside_click;
    return std::nullopt;
}

inline std::optional<ScriptedMatrix> parse_scripted_matrix_json(
    std::string_view json, std::string* error = nullptr) {
    const auto fail = [&](std::string message) -> std::optional<ScriptedMatrix> {
        if (error) *error = std::move(message);
        return std::nullopt;
    };
    try {
        const auto value = choc::json::parse(json);
        if (!value.isObject()) return fail("matrix root must be an object");
        ScriptedMatrix matrix;
        matrix.schema = value["schema"].getWithDefault<std::string>("");
        matrix.id = value["id"].getWithDefault<std::string>("");
        if (matrix.schema != "burl-scripted-interaction-matrix-v1" || matrix.id.empty())
            return fail("matrix schema/id is invalid");
        const auto steps = value["steps"];
        if (!steps.isArray() || steps.size() == 0)
            return fail("matrix steps must be a non-empty array");
        for (std::uint32_t index = 0; index < steps.size(); ++index) {
            if (!steps[index].isObject()) return fail("matrix step must be an object");
            ScriptedStep step;
            step.id = steps[index]["id"].getWithDefault<std::string>("");
            const auto operation_text =
                steps[index]["operation"].getWithDefault<std::string>("");
            const auto operation = parse_operation(operation_text);
            if (step.id.empty() || !operation)
                return fail("matrix step id/operation is invalid");
            step.operation = *operation;
            const auto target = steps[index]["target"];
            if (target.isObject()) {
                ControlSelector selector;
                selector.fixture_id =
                    target["fixtureId"].getWithDefault<std::string>("");
                if (selector.fixture_id.empty())
                    return fail("matrix target fixtureId is required");
                if (target["role"].isString())
                    selector.role = target["role"].getWithDefault<std::string>("");
                if (target["label"].isString())
                    selector.label = target["label"].getWithDefault<std::string>("");
                step.target = std::move(selector);
            }
            if (steps[index]["key"].isString())
                step.key = steps[index]["key"].getWithDefault<std::string>("");
            const auto expected = steps[index]["expectedState"];
            if (!expected.isObject()) return fail("matrix expectedState must be an object");
            for (std::uint32_t member_index = 0; member_index < expected.size(); ++member_index) {
                const auto member = expected.getObjectMemberAt(member_index);
                if (!member.value.isString())
                    return fail("matrix expectedState values must be strings");
                step.expected_state.emplace(
                    std::string(member.name),
                    member.value.getWithDefault<std::string>(""));
            }
            step.capture_before =
                steps[index]["captureBefore"].getWithDefault<bool>(false);
            step.capture_after =
                steps[index]["captureAfter"].getWithDefault<bool>(true);
            matrix.steps.push_back(std::move(step));
        }
        return matrix;
    } catch (const std::exception& exception) {
        return fail(std::string("matrix JSON parse failed: ") + exception.what());
    }
}

inline bool state_contains(const StateSnapshot& actual,
                           const StateSnapshot& expected) {
    return std::ranges::all_of(expected, [&](const auto& entry) {
        const auto found = actual.find(entry.first);
        return found != actual.end() && found->second == entry.second;
    });
}

inline ScriptedRunReceipt run_scripted_matrix(const ScriptedMatrix& matrix,
                                              const InteractionDriver& driver) {
    ScriptedRunReceipt run;
    run.matrix_id = matrix.id;
    run.backend = driver.backend;
    for (const auto& step : matrix.steps) {
        ScriptedStepReceipt receipt;
        receipt.id = step.id;
        receipt.operation = operation_name(step.operation);
        receipt.selector = step.target;
        receipt.expected = step.expected_state;
        receipt.before = driver.observe_state ? driver.observe_state() : StateSnapshot{};
        if (step.target) {
            if (driver.resolve) receipt.resolved_identity = driver.resolve(*step.target);
            if (!receipt.resolved_identity) receipt.failures.push_back("selector-unresolved");
        }
        if (step.capture_before) {
            const auto bytes = driver.capture_png
                ? driver.capture_png() : std::vector<std::uint8_t>{};
            if (!bytes.empty()) receipt.before_digest = byte_digest(bytes);
            else receipt.failures.push_back("before-capture-missing");
        }
        receipt.dispatch_succeeded = driver.dispatch &&
            driver.dispatch(step, receipt.resolved_identity);
        if (!receipt.dispatch_succeeded) receipt.failures.push_back("dispatch-failed");
        if (driver.settle) driver.settle();
        receipt.after = driver.observe_state ? driver.observe_state() : StateSnapshot{};
        receipt.state_matched = state_contains(receipt.after, receipt.expected);
        if (!receipt.state_matched) receipt.failures.push_back("state-mismatch");
        if (step.capture_after) {
            const auto bytes = driver.capture_png
                ? driver.capture_png() : std::vector<std::uint8_t>{};
            if (!bytes.empty()) receipt.after_digest = byte_digest(bytes);
            else receipt.failures.push_back("after-capture-missing");
        }
        receipt.capture_succeeded =
            (!step.capture_before || !receipt.before_digest.empty()) &&
            (!step.capture_after || !receipt.after_digest.empty());
        receipt.passed = receipt.failures.empty();
        run.steps.push_back(std::move(receipt));
    }
    run.passed = std::ranges::all_of(run.steps,
        [](const auto& step) { return step.passed; });
    return run;
}

inline void write_selector_json(std::ostream& out, const ControlSelector& selector) {
    out << "{\"fixtureId\":" << json_string(selector.fixture_id) << ",\"role\":";
    if (selector.role) out << json_string(*selector.role); else out << "null";
    out << ",\"label\":";
    if (selector.label) out << json_string(*selector.label); else out << "null";
    out << '}';
}

inline std::string make_scripted_matrix_json(const ScriptedMatrix& matrix) {
    std::ostringstream out;
    out << "{\"schema\":" << json_string(matrix.schema)
        << ",\"id\":" << json_string(matrix.id) << ",\"steps\":[";
    for (std::size_t index = 0; index < matrix.steps.size(); ++index) {
        if (index) out << ',';
        const auto& step = matrix.steps[index];
        out << "{\"id\":" << json_string(step.id)
            << ",\"operation\":" << json_string(operation_name(step.operation))
            << ",\"target\":";
        if (step.target) write_selector_json(out, *step.target); else out << "null";
        out << ",\"key\":";
        if (step.key) out << json_string(*step.key); else out << "null";
        out << ",\"expectedState\":";
        write_string_map(out, step.expected_state);
        out << ",\"captureBefore\":" << json_bool(step.capture_before)
            << ",\"captureAfter\":" << json_bool(step.capture_after) << '}';
    }
    out << "]}";
    return out.str();
}

inline std::string make_scripted_run_json(const ScriptedRunReceipt& run) {
    std::ostringstream out;
    out << "{\"schema\":" << json_string(run.schema)
        << ",\"matrixId\":" << json_string(run.matrix_id)
        << ",\"backend\":" << json_string(run.backend)
        << ",\"passed\":" << json_bool(run.passed) << ",\"steps\":[";
    for (std::size_t index = 0; index < run.steps.size(); ++index) {
        if (index) out << ',';
        const auto& step = run.steps[index];
        out << "{\"id\":" << json_string(step.id)
            << ",\"operation\":" << json_string(step.operation)
            << ",\"selector\":";
        if (step.selector) write_selector_json(out, *step.selector); else out << "null";
        out << ",\"resolvedIdentity\":";
        if (step.resolved_identity) out << json_string(*step.resolved_identity);
        else out << "null";
        out << ",\"before\":"; write_string_map(out, step.before);
        out << ",\"after\":"; write_string_map(out, step.after);
        out << ",\"expected\":"; write_string_map(out, step.expected);
        out << ",\"beforeDigest\":" << json_string(step.before_digest)
            << ",\"afterDigest\":" << json_string(step.after_digest)
            << ",\"dispatchSucceeded\":" << json_bool(step.dispatch_succeeded)
            << ",\"stateMatched\":" << json_bool(step.state_matched)
            << ",\"captureSucceeded\":" << json_bool(step.capture_succeeded)
            << ",\"failures\":";
        write_string_array(out, step.failures);
        out << ",\"passed\":" << json_bool(step.passed) << '}';
    }
    out << "]}";
    return out.str();
}

}  // namespace pulp::test::interaction
