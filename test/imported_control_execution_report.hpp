#pragma once

// Generic imported-control execution receipts.
//
// This test-harness layer joins the five independently fallible links in an
// imported UI interaction: accessibility exposure, coordinate hit routing,
// native pointer delivery, application callback dispatch, and an observable
// state/visual postcondition.  The caller supplies application observations;
// no product action names or product state are embedded here.

#include "mac_window_harness.hpp"

#include <pulp/view/accessibility_tree.hpp>
#include <pulp/view/screenshot_compare.hpp>

#include <algorithm>
#include <cstdint>
#include <functional>
#include <iomanip>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace pulp::test::interaction {

struct DispatchObservation {
    std::uint64_t callback_count = 0;
    std::string action_id;
    std::string payload;
};

using StateSnapshot = std::map<std::string, std::string>;

enum class PostconditionMode {
    callback_only,
    named_state_change,
    visual_change,
    named_state_and_visual_change,
};

struct ExternalAccessibilityObservation {
    std::string source;
    std::optional<std::uint64_t> element_index;
    std::string role;
    std::string label;
    bool actionable = false;
};

struct ControlExecutionSpec {
    std::string expected_action_id;
    std::optional<std::string> expected_payload;
    PostconditionMode postcondition = PostconditionMode::callback_only;
    std::vector<std::string> required_state_keys;
    std::function<DispatchObservation()> observe_dispatch;
    std::function<StateSnapshot()> observe_state;
    std::optional<ExternalAccessibilityObservation> external_accessibility;
    std::uint32_t settled_frame_count = 4;
    std::uint32_t minimum_visual_diff_pixels = 1;
    std::uint8_t visual_tolerance = 8;
    bool require_accessibility = true;
};

struct AccessibilityReceipt {
    bool exposed = false;
    bool external_matched = false;
    bool passed = false;
    std::string stable_identity;
    std::string role;
    std::string label;
    std::string value;
    std::string pressed;
    std::string checked;
    std::string disabled;
    std::string hidden;
    std::optional<ExternalAccessibilityObservation> external;
};

struct HitReceipt {
    float x = 0.0f;
    float y = 0.0f;
    std::string expected_control;
    std::string press_target;
    std::string release_target;
    std::string actionable_ancestor;
    bool press_descends_from_control = false;
    bool actionable_descends_from_control = false;
    bool passed = false;
};

struct DispatchReceipt {
    DispatchObservation before;
    DispatchObservation after;
    std::string expected_action_id;
    std::optional<std::string> expected_payload;
    bool callback_advanced_once = false;
    bool action_matched = false;
    bool payload_matched = false;
    bool passed = false;
};

struct StateReceipt {
    StateSnapshot before;
    StateSnapshot after;
    std::vector<std::string> changed_keys;
    std::vector<std::string> required_keys;
    bool required_change_observed = false;
};

struct VisualReceipt {
    bool requested = false;
    bool before_captured = false;
    bool after_captured = false;
    std::string before_digest;
    std::string after_digest;
    bool comparison_valid = false;
    float similarity = 1.0f;
    float mean_error = 0.0f;
    std::uint32_t diff_pixels = 0;
    bool changed = false;
};

struct ControlExecutionReceipt {
    std::string schema = "burl-imported-control-execution-receipt-v1";
    AccessibilityReceipt accessibility;
    HitReceipt hit;
    bool pointer_down_dispatched = false;
    bool pointer_up_dispatched = false;
    DispatchReceipt dispatch;
    StateReceipt state;
    VisualReceipt visual;
    std::string postcondition_mode;
    bool postcondition_passed = false;
    std::vector<std::string> broken_links;
    bool passed = false;
};

inline std::string stable_identity(const pulp::view::View* view) {
    if (!view) return "<none>";
    if (!view->anchor_id().empty()) return view->anchor_id();
    if (!view->id().empty()) return view->id();
    return "<anonymous>";
}

inline std::string access_role_name(pulp::view::View::AccessRole role) {
    using Role = pulp::view::View::AccessRole;
    switch (role) {
        case Role::none: return "none";
        case Role::slider: return "slider";
        case Role::toggle: return "toggle";
        case Role::label: return "label";
        case Role::group: return "group";
        case Role::meter: return "meter";
        case Role::image: return "image";
    }
    return "unknown";
}

inline std::string postcondition_mode_name(PostconditionMode mode) {
    switch (mode) {
        case PostconditionMode::callback_only: return "callback-only";
        case PostconditionMode::named_state_change: return "named-state-change";
        case PostconditionMode::visual_change: return "visual-change";
        case PostconditionMode::named_state_and_visual_change:
            return "named-state-and-visual-change";
    }
    return "unknown";
}

inline bool descends_from(const pulp::view::View* candidate,
                          const pulp::view::View* ancestor) {
    for (auto* current = candidate; current; current = current->parent())
        if (current == ancestor) return true;
    return false;
}

inline const pulp::view::View* actionable_ancestor(pulp::view::View* candidate) {
    while (candidate && !candidate->on_click && !candidate->wants_mouse_input() &&
           !candidate->focusable())
        candidate = candidate->parent();
    return candidate;
}

inline std::string byte_digest(const std::vector<std::uint8_t>& bytes) {
    // Stable, cheap content identity for joining report artifacts. This is not
    // a security checksum; callers that publish artifacts may add SHA-256.
    std::uint64_t hash = 1469598103934665603ULL;
    for (const auto byte : bytes) {
        hash ^= byte;
        hash *= 1099511628211ULL;
    }
    std::ostringstream out;
    out << "fnv1a64:" << std::hex << std::setw(16) << std::setfill('0') << hash;
    return out.str();
}

inline bool mode_requests_state(PostconditionMode mode) {
    return mode == PostconditionMode::named_state_change ||
           mode == PostconditionMode::named_state_and_visual_change;
}

inline bool mode_requests_visual(PostconditionMode mode) {
    return mode == PostconditionMode::visual_change ||
           mode == PostconditionMode::named_state_and_visual_change;
}

inline StateReceipt compare_state(StateSnapshot before,
                                  StateSnapshot after,
                                  const std::vector<std::string>& required_keys) {
    StateReceipt receipt;
    receipt.before = std::move(before);
    receipt.after = std::move(after);
    receipt.required_keys = required_keys;
    for (const auto& [key, before_value] : receipt.before) {
        const auto found = receipt.after.find(key);
        if (found == receipt.after.end() || found->second != before_value)
            receipt.changed_keys.push_back(key);
    }
    for (const auto& [key, _] : receipt.after)
        if (!receipt.before.contains(key)) receipt.changed_keys.push_back(key);
    std::ranges::sort(receipt.changed_keys);
    receipt.changed_keys.erase(
        std::unique(receipt.changed_keys.begin(), receipt.changed_keys.end()),
        receipt.changed_keys.end());
    if (required_keys.empty()) {
        receipt.required_change_observed = !receipt.changed_keys.empty();
    } else {
        receipt.required_change_observed = std::ranges::all_of(
            required_keys, [&](const auto& key) {
                return std::ranges::find(receipt.changed_keys, key) != receipt.changed_keys.end();
            });
    }
    return receipt;
}

inline ControlExecutionReceipt execute_control(
    pulp::view::WindowHost& host,
    pulp::view::View& root,
    pulp::view::View& control,
    pulp::view::Point point,
    const ControlExecutionSpec& spec) {
    ControlExecutionReceipt receipt;
    receipt.postcondition_mode = postcondition_mode_name(spec.postcondition);

    receipt.accessibility.stable_identity = stable_identity(&control);
    for (const auto& node : pulp::view::snapshot_accessibility_tree(root)) {
        if (node.view != &control) continue;
        receipt.accessibility.exposed = true;
        receipt.accessibility.role = access_role_name(node.role);
        receipt.accessibility.label = node.label;
        receipt.accessibility.value = node.value;
        receipt.accessibility.pressed = node.pressed;
        receipt.accessibility.checked = node.checked;
        receipt.accessibility.disabled = node.disabled;
        receipt.accessibility.hidden = node.hidden;
        break;
    }
    receipt.accessibility.external = spec.external_accessibility;
    receipt.accessibility.external_matched = !spec.external_accessibility ||
        (spec.external_accessibility->actionable &&
         !spec.external_accessibility->role.empty() &&
         spec.external_accessibility->label == receipt.accessibility.label);
    receipt.accessibility.passed = !spec.require_accessibility ||
        (receipt.accessibility.exposed && receipt.accessibility.role != "none" &&
         !receipt.accessibility.label.empty() &&
         receipt.accessibility.external_matched);

    receipt.hit.x = point.x;
    receipt.hit.y = point.y;
    receipt.hit.expected_control = stable_identity(&control);
    auto* initial_hit = root.hit_test(point);
    const auto* initial_actionable = actionable_ancestor(initial_hit);
    receipt.hit.press_descends_from_control = descends_from(initial_hit, &control);
    receipt.hit.actionable_descends_from_control =
        descends_from(initial_actionable, &control);

    const auto dispatch_before = spec.observe_dispatch
        ? spec.observe_dispatch() : DispatchObservation{};
    const auto state_before = spec.observe_state
        ? spec.observe_state() : StateSnapshot{};

    std::vector<std::uint8_t> before_png;
    if (mode_requests_visual(spec.postcondition)) {
        root.layout_children();
        root.request_repaint();
        const auto frames = pulp::test::mac::capture_settled_back_buffer_png(
            host, std::max(1u, spec.settled_frame_count));
        if (!frames.empty()) before_png = frames.back().png;
    }

    const auto trace = pulp::test::mac::simulate_click_traced(
        host, root, point.x, point.y,
        spec.observe_dispatch
            ? std::function<std::uint64_t()>([&spec] {
                  return spec.observe_dispatch().callback_count;
              })
            : std::function<std::uint64_t()>{});
    receipt.hit.press_target = trace.press_target;
    receipt.hit.release_target = trace.release_target;
    receipt.hit.actionable_ancestor = trace.actionable_ancestor;
    receipt.hit.passed = receipt.hit.press_descends_from_control &&
                         receipt.hit.actionable_descends_from_control;
    receipt.pointer_down_dispatched = trace.down_dispatched;
    receipt.pointer_up_dispatched = trace.up_dispatched;

    receipt.dispatch.before = dispatch_before;
    receipt.dispatch.after = spec.observe_dispatch
        ? spec.observe_dispatch() : DispatchObservation{};
    receipt.dispatch.expected_action_id = spec.expected_action_id;
    receipt.dispatch.expected_payload = spec.expected_payload;
    receipt.dispatch.callback_advanced_once = spec.observe_dispatch &&
        receipt.dispatch.after.callback_count == receipt.dispatch.before.callback_count + 1;
    receipt.dispatch.action_matched =
        receipt.dispatch.after.action_id == spec.expected_action_id;
    receipt.dispatch.payload_matched = !spec.expected_payload ||
        receipt.dispatch.after.payload == *spec.expected_payload;
    receipt.dispatch.passed = receipt.dispatch.callback_advanced_once &&
                              receipt.dispatch.action_matched &&
                              receipt.dispatch.payload_matched;

    const auto state_after = spec.observe_state
        ? spec.observe_state() : StateSnapshot{};
    receipt.state = compare_state(state_before, state_after, spec.required_state_keys);

    receipt.visual.requested = mode_requests_visual(spec.postcondition);
    if (receipt.visual.requested) {
        root.layout_children();
        root.request_repaint();
        const auto frames = pulp::test::mac::capture_settled_back_buffer_png(
            host, std::max(1u, spec.settled_frame_count));
        std::vector<std::uint8_t> after_png;
        if (!frames.empty()) after_png = frames.back().png;
        receipt.visual.before_captured = !before_png.empty();
        receipt.visual.after_captured = !after_png.empty();
        if (!before_png.empty()) receipt.visual.before_digest = byte_digest(before_png);
        if (!after_png.empty()) receipt.visual.after_digest = byte_digest(after_png);
        if (!before_png.empty() && !after_png.empty()) {
            const auto comparison = pulp::view::compare_screenshots(
                before_png, after_png, spec.visual_tolerance);
            receipt.visual.comparison_valid = comparison.valid;
            receipt.visual.similarity = comparison.similarity;
            receipt.visual.mean_error = comparison.mean_error;
            receipt.visual.diff_pixels = comparison.diff_pixels;
            receipt.visual.changed = comparison.valid &&
                comparison.diff_pixels >= spec.minimum_visual_diff_pixels;
        }
    }

    switch (spec.postcondition) {
        case PostconditionMode::callback_only:
            receipt.postcondition_passed = true;
            break;
        case PostconditionMode::named_state_change:
            receipt.postcondition_passed = receipt.state.required_change_observed;
            break;
        case PostconditionMode::visual_change:
            receipt.postcondition_passed = receipt.visual.changed;
            break;
        case PostconditionMode::named_state_and_visual_change:
            receipt.postcondition_passed = receipt.state.required_change_observed &&
                                           receipt.visual.changed;
            break;
    }

    if (!receipt.accessibility.passed) receipt.broken_links.push_back("accessibility");
    if (!receipt.hit.passed) receipt.broken_links.push_back("hit-target");
    if (!receipt.pointer_down_dispatched) receipt.broken_links.push_back("pointer-down");
    if (!receipt.pointer_up_dispatched) receipt.broken_links.push_back("pointer-up");
    if (!receipt.dispatch.callback_advanced_once) receipt.broken_links.push_back("callback");
    if (!receipt.dispatch.action_matched) receipt.broken_links.push_back("action-dispatch");
    if (!receipt.dispatch.payload_matched) receipt.broken_links.push_back("action-payload");
    if (!receipt.postcondition_passed) receipt.broken_links.push_back("postcondition");
    receipt.passed = receipt.broken_links.empty();
    return receipt;
}

inline std::string json_string(std::string_view value) {
    std::ostringstream out;
    out << '"';
    for (const unsigned char character : value) {
        switch (character) {
            case '"': out << "\\\""; break;
            case '\\': out << "\\\\"; break;
            case '\b': out << "\\b"; break;
            case '\f': out << "\\f"; break;
            case '\n': out << "\\n"; break;
            case '\r': out << "\\r"; break;
            case '\t': out << "\\t"; break;
            default:
                if (character < 0x20) {
                    out << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                        << static_cast<unsigned int>(character) << std::dec;
                } else {
                    out << static_cast<char>(character);
                }
        }
    }
    out << '"';
    return out.str();
}

inline const char* json_bool(bool value) { return value ? "true" : "false"; }

inline void write_string_map(std::ostream& out, const StateSnapshot& values) {
    out << '{';
    bool first = true;
    for (const auto& [key, value] : values) {
        if (!first) out << ',';
        first = false;
        out << json_string(key) << ':' << json_string(value);
    }
    out << '}';
}

inline void write_string_array(std::ostream& out,
                               const std::vector<std::string>& values) {
    out << '[';
    for (std::size_t index = 0; index < values.size(); ++index) {
        if (index) out << ',';
        out << json_string(values[index]);
    }
    out << ']';
}

inline void write_dispatch_observation(std::ostream& out,
                                       const DispatchObservation& value) {
    out << "{\"callbackCount\":" << value.callback_count
        << ",\"actionId\":" << json_string(value.action_id)
        << ",\"payload\":" << json_string(value.payload) << '}';
}

inline void write_receipt_json(std::ostream& out,
                               const ControlExecutionReceipt& value) {
    out << "{\"schema\":" << json_string(value.schema)
        << ",\"accessibility\":{\"exposed\":" << json_bool(value.accessibility.exposed)
        << ",\"externalMatched\":" << json_bool(value.accessibility.external_matched)
        << ",\"passed\":" << json_bool(value.accessibility.passed)
        << ",\"stableIdentity\":" << json_string(value.accessibility.stable_identity)
        << ",\"role\":" << json_string(value.accessibility.role)
        << ",\"label\":" << json_string(value.accessibility.label)
        << ",\"value\":" << json_string(value.accessibility.value)
        << ",\"pressed\":" << json_string(value.accessibility.pressed)
        << ",\"checked\":" << json_string(value.accessibility.checked)
        << ",\"disabled\":" << json_string(value.accessibility.disabled)
        << ",\"hidden\":" << json_string(value.accessibility.hidden)
        << ",\"external\":";
    if (value.accessibility.external) {
        const auto& external = *value.accessibility.external;
        out << "{\"source\":" << json_string(external.source)
            << ",\"elementIndex\":";
        if (external.element_index) out << *external.element_index;
        else out << "null";
        out << ",\"role\":" << json_string(external.role)
            << ",\"label\":" << json_string(external.label)
            << ",\"actionable\":" << json_bool(external.actionable) << '}';
    } else {
        out << "null";
    }
    out << "},\"hit\":{\"point\":{\"x\":" << value.hit.x
        << ",\"y\":" << value.hit.y << "},\"expectedControl\":"
        << json_string(value.hit.expected_control)
        << ",\"pressTarget\":" << json_string(value.hit.press_target)
        << ",\"releaseTarget\":" << json_string(value.hit.release_target)
        << ",\"actionableAncestor\":" << json_string(value.hit.actionable_ancestor)
        << ",\"pressDescendsFromControl\":"
        << json_bool(value.hit.press_descends_from_control)
        << ",\"actionableDescendsFromControl\":"
        << json_bool(value.hit.actionable_descends_from_control)
        << ",\"passed\":" << json_bool(value.hit.passed)
        << "},\"pointer\":{\"downDispatched\":"
        << json_bool(value.pointer_down_dispatched)
        << ",\"upDispatched\":" << json_bool(value.pointer_up_dispatched)
        << "},\"dispatch\":{\"before\":";
    write_dispatch_observation(out, value.dispatch.before);
    out << ",\"after\":";
    write_dispatch_observation(out, value.dispatch.after);
    out << ",\"expectedActionId\":" << json_string(value.dispatch.expected_action_id)
        << ",\"expectedPayload\":";
    if (value.dispatch.expected_payload) out << json_string(*value.dispatch.expected_payload);
    else out << "null";
    out << ",\"callbackAdvancedOnce\":" << json_bool(value.dispatch.callback_advanced_once)
        << ",\"actionMatched\":" << json_bool(value.dispatch.action_matched)
        << ",\"payloadMatched\":" << json_bool(value.dispatch.payload_matched)
        << ",\"passed\":" << json_bool(value.dispatch.passed)
        << "},\"state\":{\"before\":";
    write_string_map(out, value.state.before);
    out << ",\"after\":";
    write_string_map(out, value.state.after);
    out << ",\"changedKeys\":";
    write_string_array(out, value.state.changed_keys);
    out << ",\"requiredKeys\":";
    write_string_array(out, value.state.required_keys);
    out << ",\"requiredChangeObserved\":"
        << json_bool(value.state.required_change_observed)
        << "},\"visual\":{\"requested\":" << json_bool(value.visual.requested)
        << ",\"beforeCaptured\":" << json_bool(value.visual.before_captured)
        << ",\"afterCaptured\":" << json_bool(value.visual.after_captured)
        << ",\"beforeDigest\":" << json_string(value.visual.before_digest)
        << ",\"afterDigest\":" << json_string(value.visual.after_digest)
        << ",\"comparisonValid\":" << json_bool(value.visual.comparison_valid)
        << ",\"similarity\":" << value.visual.similarity
        << ",\"meanError\":" << value.visual.mean_error
        << ",\"diffPixels\":" << value.visual.diff_pixels
        << ",\"changed\":" << json_bool(value.visual.changed)
        << "},\"postconditionMode\":" << json_string(value.postcondition_mode)
        << ",\"postconditionPassed\":" << json_bool(value.postcondition_passed)
        << ",\"brokenLinks\":";
    write_string_array(out, value.broken_links);
    out << ",\"passed\":" << json_bool(value.passed) << '}';
}

inline std::string make_execution_report_json(
    const std::vector<ControlExecutionReceipt>& receipts,
    const StateSnapshot& run_metadata = {}) {
    const auto passed = static_cast<std::size_t>(std::ranges::count_if(
        receipts, [](const auto& receipt) { return receipt.passed; }));
    std::ostringstream out;
    out << "{\"schema\":\"burl-imported-control-execution-report-v1\",\"run\":";
    write_string_map(out, run_metadata);
    out << ",\"summary\":{\"controls\":" << receipts.size()
        << ",\"passed\":" << passed
        << ",\"failed\":" << receipts.size() - passed
        << ",\"verdict\":" << json_string(passed == receipts.size() ? "green" : "red")
        << "},\"records\":[";
    for (std::size_t index = 0; index < receipts.size(); ++index) {
        if (index) out << ',';
        write_receipt_json(out, receipts[index]);
    }
    out << "]}";
    return out.str();
}

}  // namespace pulp::test::interaction
