// Mac-only Catch2 smoke for the platform-test harness — issue #2001.
//
// Exercises the hidden GPU-backed NSWindow + CAMetalLayer host without
// ever calling orderFront / makeKey. Covers back-buffer PNG capture via
// the production render_frame() path and synthetic AppKit mouse events
// against the real content view.
//
// Tag [issue-2001] so coverage can attribute these tests to the
// platform-harness work.

#include "mac_window_harness.hpp"
#include "imported_control_execution_report.hpp"
#include "scripted_interaction_matrix.hpp"

#include <catch2/catch_test_macros.hpp>
#include <pulp/view/input_events.hpp>
#include <pulp/view/design_import.hpp>
#include <pulp/view/design_sources.hpp>
#include <pulp/view/screenshot_compare.hpp>
#include <pulp/view/theme.hpp>
#include <pulp/view/view.hpp>
#include <pulp/view/widgets.hpp>
#include <pulp/view/window_host.hpp>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include <miniz.h>
#include <unistd.h>

using pulp::view::MouseButton;
using pulp::view::MouseEvent;
using pulp::view::Point;
using pulp::view::Rect;
using pulp::view::View;
using pulp::view::WindowHost;
using pulp::view::WindowOptions;

namespace pt = pulp::test::mac;
namespace interaction = pulp::test::interaction;

TEST_CASE("one scripted interaction matrix drives source and native adapters",
          "[mac][platform-harness][interaction-matrix][ab]") {
    using Operation = interaction::ScriptedOperation;
    const interaction::ControlSelector trigger{
        .fixture_id = "fixture-menu-trigger", .role = "button", .label = "Fixture menu"};
    const interaction::ControlSelector option{
        .fixture_id = "fixture-menu-option", .role = "option", .label = "Second option"};
    const interaction::ScriptedMatrix matrix{
        .id = "generic-menu-keyboard-pointer-v1",
        .steps = {
            {.id = "hover-trigger", .operation = Operation::hover, .target = trigger,
             .expected_state = {{"hovered", "true"}}},
            {.id = "open-menu", .operation = Operation::click, .target = trigger,
             .expected_state = {{"menu.open", "true"}}},
            {.id = "move-down", .operation = Operation::key_down,
             .key = "ArrowDown", .expected_state = {{"active.index", "1"}}},
            {.id = "select", .operation = Operation::key_down, .target = option,
             .key = "Enter", .expected_state = {{"selected", "second"}}},
            {.id = "reopen", .operation = Operation::click, .target = trigger,
             .expected_state = {{"menu.open", "true"}}},
            {.id = "escape", .operation = Operation::key_down, .key = "Escape",
             .expected_state = {{"menu.open", "false"}}},
            {.id = "open-for-outside", .operation = Operation::click, .target = trigger,
             .expected_state = {{"menu.open", "true"}}},
            {.id = "outside-dismiss", .operation = Operation::outside_click,
             .expected_state = {{"menu.open", "false"}}, .capture_before = true},
        }};

    struct FixtureBackend {
        interaction::StateSnapshot state{
            {"hovered", "false"}, {"menu.open", "false"},
            {"active.index", "0"}, {"selected", "none"}};
        std::vector<std::string> operations;
    };
    const auto make_driver = [&](std::string name, FixtureBackend& fixture) {
        interaction::InteractionDriver driver;
        driver.backend = std::move(name);
        driver.resolve = [](const interaction::ControlSelector& selector)
            -> std::optional<std::string> {
            if (selector.fixture_id == "fixture-menu-trigger" ||
                selector.fixture_id == "fixture-menu-option")
                return selector.fixture_id;
            return std::nullopt;
        };
        driver.dispatch = [&fixture](const interaction::ScriptedStep& step,
                                     const std::optional<std::string>& resolved) {
            fixture.operations.push_back(interaction::operation_name(step.operation));
            if (step.target && !resolved) return false;
            if (step.operation == Operation::hover) fixture.state["hovered"] = "true";
            else if (step.operation == Operation::click)
                fixture.state["menu.open"] = "true";
            else if (step.operation == Operation::outside_click)
                fixture.state["menu.open"] = "false";
            else if (step.operation == Operation::key_down && step.key == "ArrowDown")
                fixture.state["active.index"] = "1";
            else if (step.operation == Operation::key_down && step.key == "Enter") {
                fixture.state["selected"] = "second";
                fixture.state["menu.open"] = "false";
            } else if (step.operation == Operation::key_down && step.key == "Escape") {
                fixture.state["menu.open"] = "false";
            } else return false;
            return true;
        };
        driver.settle = [] {};
        driver.observe_state = [&fixture] { return fixture.state; };
        driver.capture_png = [&fixture] {
            std::vector<std::uint8_t> bytes;
            for (const auto& [key, value] : fixture.state) {
                bytes.insert(bytes.end(), key.begin(), key.end());
                bytes.insert(bytes.end(), value.begin(), value.end());
            }
            return bytes;
        };
        return driver;
    };

    FixtureBackend native_fixture, source_fixture;
    const auto native = interaction::run_scripted_matrix(
        matrix, make_driver("designir-native", native_fixture));
    const auto source = interaction::run_scripted_matrix(
        matrix, make_driver("live-react-adapter-fixture", source_fixture));
    CAPTURE(interaction::make_scripted_run_json(native));
    CAPTURE(interaction::make_scripted_run_json(source));
    REQUIRE(native.passed);
    REQUIRE(source.passed);
    CHECK(native.steps.size() == matrix.steps.size());
    CHECK(source.steps.size() == matrix.steps.size());
    CHECK(native_fixture.operations == source_fixture.operations);
    CHECK(native_fixture.state == source_fixture.state);
    CHECK(native.steps.back().before_digest != native.steps.back().after_digest);
    CHECK(source.steps.back().before_digest != source.steps.back().after_digest);

    const auto manifest = interaction::make_scripted_matrix_json(matrix);
    CHECK(manifest.find("\"operation\":\"hover\"") != std::string::npos);
    CHECK(manifest.find("\"key\":\"ArrowDown\"") != std::string::npos);
    CHECK(manifest.find("\"key\":\"Enter\"") != std::string::npos);
    CHECK(manifest.find("\"key\":\"Escape\"") != std::string::npos);
    CHECK(manifest.find("\"operation\":\"outside-click\"") != std::string::npos);
    std::string parse_error;
    const auto parsed = interaction::parse_scripted_matrix_json(manifest, &parse_error);
    CAPTURE(parse_error);
    REQUIRE(parsed.has_value());
    CHECK(parsed->id == matrix.id);
    CHECK(parsed->steps.size() == matrix.steps.size());
    CHECK(interaction::make_scripted_matrix_json(*parsed) == manifest);

    if (const char* directory = std::getenv("PULP_INTERACTION_MATRIX_DIR")) {
        std::filesystem::create_directories(directory);
        std::ofstream manifest_output(
            std::filesystem::path(directory) / "generic-menu.matrix.v1.json");
        manifest_output << manifest << '\n';
        REQUIRE(manifest_output.good());
        std::ofstream native_output(
            std::filesystem::path(directory) / "designir-native.run.v1.json");
        native_output << interaction::make_scripted_run_json(native) << '\n';
        REQUIRE(native_output.good());
        std::ofstream source_output(
            std::filesystem::path(directory) / "live-react-adapter-fixture.run.v1.json");
        source_output << interaction::make_scripted_run_json(source) << '\n';
        REQUIRE(source_output.good());
    }
}

TEST_CASE("scripted interaction matrix fails closed for an unresolved fixture selector",
          "[mac][platform-harness][interaction-matrix][negative]") {
    interaction::ScriptedMatrix matrix{
        .id = "unresolved-selector-v1",
        .steps = {{.id = "missing", .operation = interaction::ScriptedOperation::click,
                   .target = interaction::ControlSelector{.fixture_id = "missing"},
                   .expected_state = {{"open", "true"}}}}};
    interaction::InteractionDriver driver;
    driver.backend = "fixture";
    driver.resolve = [](const auto&) -> std::optional<std::string> { return std::nullopt; };
    driver.dispatch = [](const auto&, const auto&) { return false; };
    driver.observe_state = [] { return interaction::StateSnapshot{{"open", "false"}}; };
    driver.capture_png = [] { return std::vector<std::uint8_t>{1}; };
    const auto receipt = interaction::run_scripted_matrix(matrix, driver);
    REQUIRE_FALSE(receipt.passed);
    REQUIRE(receipt.steps.size() == 1);
    CHECK(receipt.steps[0].failures == std::vector<std::string>{
        "selector-unresolved", "dispatch-failed", "state-mismatch"});
}

TEST_CASE("imported control execution receipt joins AX hit dispatch state and pixels",
          "[mac][platform-harness][interaction-receipt]") {
    View root;
    root.set_bounds({0, 0, 320, 180});
    root.set_background_color(pulp::view::Color::rgba8(18, 18, 18, 255));

    auto control = std::make_unique<View>();
    auto* control_ptr = control.get();
    control_ptr->set_bounds({40, 40, 160, 64});
    control_ptr->set_position(View::Position::absolute);
    control_ptr->set_left(40);
    control_ptr->set_top(40);
    control_ptr->flex().preferred_width = 160;
    control_ptr->flex().preferred_height = 64;
    control_ptr->set_anchor_id("fixture-toggle");
    control_ptr->set_background_color(pulp::view::Color::rgba8(42, 52, 62, 255));
    control_ptr->set_access_role(View::AccessRole::toggle);
    control_ptr->set_access_label("Fixture toggle");
    control_ptr->set_access_checked("false");

    interaction::DispatchObservation dispatch;
    bool toggled = false;
    control_ptr->on_click = [&] {
        ++dispatch.callback_count;
        dispatch.action_id = "fixture.toggle";
        dispatch.payload = R"({"checked":true})";
        toggled = true;
        control_ptr->set_access_checked("true");
        control_ptr->set_background_color(pulp::view::Color::rgba8(32, 190, 112, 255));
        control_ptr->request_repaint();
    };
    root.add_child(std::move(control));

    WindowOptions options;
    options.width = 320;
    options.height = 180;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);

    interaction::ControlExecutionSpec spec;
    spec.expected_action_id = "fixture.toggle";
    spec.expected_payload = R"({"checked":true})";
    spec.postcondition = interaction::PostconditionMode::named_state_and_visual_change;
    spec.required_state_keys = {"checked"};
    spec.observe_dispatch = [&] { return dispatch; };
    spec.observe_state = [&] {
        return interaction::StateSnapshot{{"checked", toggled ? "true" : "false"}};
    };
    spec.external_accessibility = interaction::ExternalAccessibilityObservation{
        .source = "computer-use", .element_index = 17, .role = "AXCheckBox",
        .label = "Fixture toggle", .actionable = true};

    const auto receipt = interaction::execute_control(
        *host, root, *control_ptr, {120, 72}, spec);
    CAPTURE(receipt.broken_links,
            receipt.hit.press_target,
            receipt.hit.actionable_ancestor,
            receipt.dispatch.before.callback_count,
            receipt.dispatch.after.callback_count,
            receipt.state.changed_keys,
            receipt.visual.comparison_valid,
            receipt.visual.diff_pixels);
    REQUIRE(receipt.passed);
    CHECK(receipt.accessibility.exposed);
    CHECK(receipt.accessibility.external_matched);
    CHECK(receipt.accessibility.external->element_index == 17);
    CHECK(receipt.hit.press_target == "fixture-toggle");
    CHECK(receipt.pointer_down_dispatched);
    CHECK(receipt.pointer_up_dispatched);
    CHECK(receipt.dispatch.callback_advanced_once);
    CHECK(receipt.dispatch.action_matched);
    CHECK(receipt.dispatch.payload_matched);
    CHECK(receipt.state.changed_keys == std::vector<std::string>{"checked"});
    CHECK(receipt.visual.before_captured);
    CHECK(receipt.visual.after_captured);
    CHECK(receipt.visual.changed);
    CHECK(receipt.broken_links.empty());

    const auto report = interaction::make_execution_report_json(
        {receipt}, {{"app", "generic-fixture"}, {"viewport", "320x180"}});
    if (const char* directory = std::getenv("PULP_INTERACTION_RECEIPT_DIR")) {
        std::filesystem::create_directories(directory);
        std::ofstream output(std::filesystem::path(directory) / "green-report.json");
        output << report << '\n';
        REQUIRE(output.good());
    }
    CHECK(report.find("\"verdict\":\"green\"") != std::string::npos);
    CHECK(report.find("\"actionId\":\"fixture.toggle\"") != std::string::npos);
    CHECK(report.find("\"elementIndex\":17") != std::string::npos);
}

TEST_CASE("imported control receipt names every missing proof link",
          "[mac][platform-harness][interaction-receipt]") {
    View root;
    root.set_bounds({0, 0, 240, 140});
    auto control = std::make_unique<View>();
    auto* control_ptr = control.get();
    control_ptr->set_bounds({20, 20, 120, 52});
    control_ptr->set_position(View::Position::absolute);
    control_ptr->set_left(20);
    control_ptr->set_top(20);
    control_ptr->flex().preferred_width = 120;
    control_ptr->flex().preferred_height = 52;
    control_ptr->set_anchor_id("unproved-control");
    control_ptr->on_click = [] {};
    root.add_child(std::move(control));

    WindowOptions options;
    options.width = 240;
    options.height = 140;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);

    interaction::ControlExecutionSpec spec;
    spec.expected_action_id = "missing.endpoint";
    spec.postcondition = interaction::PostconditionMode::named_state_change;
    spec.required_state_keys = {"open"};
    spec.observe_dispatch = [] { return interaction::DispatchObservation{}; };
    spec.observe_state = [] {
        return interaction::StateSnapshot{{"open", "false"}};
    };

    const auto receipt = interaction::execute_control(
        *host, root, *control_ptr, {80, 46}, spec);
    CHECK_FALSE(receipt.passed);
    CHECK(std::ranges::find(receipt.broken_links, "accessibility") !=
          receipt.broken_links.end());
    CHECK(std::ranges::find(receipt.broken_links, "callback") !=
          receipt.broken_links.end());
    CHECK(std::ranges::find(receipt.broken_links, "action-dispatch") !=
          receipt.broken_links.end());
    CHECK(std::ranges::find(receipt.broken_links, "postcondition") !=
          receipt.broken_links.end());
    const auto report = interaction::make_execution_report_json({receipt});
    if (const char* directory = std::getenv("PULP_INTERACTION_RECEIPT_DIR")) {
        std::filesystem::create_directories(directory);
        std::ofstream output(std::filesystem::path(directory) / "red-report.json");
        output << report << '\n';
        REQUIRE(output.good());
    }
    CHECK(report.find("\"verdict\":\"red\"") != std::string::npos);
    CHECK(report.find("\"failed\":1") != std::string::npos);
}

TEST_CASE("AppKit harness maps transformed descendant points into root space",
          "[mac][platform-harness][transform]") {
    View root;
    root.set_bounds({0, 0, 1200, 800});

    auto portal = std::make_unique<View>();
    auto* portal_ptr = portal.get();
    portal_ptr->set_bounds({0, -800, 0, 0});
    portal_ptr->set_overflow(View::Overflow::visible);
    portal_ptr->set_transform_matrix(1, 0, 0, 1, 766, 36.5f);

    auto control = std::make_unique<View>();
    auto* control_ptr = control.get();
    control_ptr->set_bounds({10, 900, 100, 40});
    portal_ptr->add_child(std::move(control));
    root.add_child(std::move(portal));

    const auto mapped = pt::visual_point_in_root(
        *control_ptr, root, {50, 20});
    REQUIRE(mapped.has_value());
    CHECK(std::abs(mapped->x - 826.0f) < 0.001f);
    CHECK(std::abs(mapped->y - 156.5f) < 0.001f);
    CHECK(root.hit_test(*mapped) == control_ptr);

    View unrelated;
    CHECK_FALSE(pt::visual_point_in_root(*control_ptr, unrelated, {50, 20}).has_value());
}

namespace {

namespace fs = std::filesystem;

struct ScopedTempDir {
    fs::path path;

    explicit ScopedTempDir(std::string prefix) {
        const auto base = fs::temp_directory_path();
        for (int i = 0; i < 100; ++i) {
            auto candidate = base / (prefix + "-" + std::to_string(::getpid()) + "-" + std::to_string(i));
            std::error_code ec;
            if (fs::create_directory(candidate, ec)) {
                path = std::move(candidate);
                return;
            }
        }
    }

    ~ScopedTempDir() {
        if (!path.empty()) {
            std::error_code ec;
            fs::remove_all(path, ec);
        }
    }
};

struct RoiSpec {
    const char* id;
    uint32_t x;
    uint32_t y;
    uint32_t width;
    uint32_t height;
    uint32_t min_unique_colors;
    double min_luminance_stddev;
    double min_non_background_coverage;
    double min_opaque_coverage;
};

struct RoiShapeExpectation {
    const char* id;
    float min_similarity;
    double max_diff_coverage;
};

const std::vector<RoiSpec>& elysium_roi_specs() {
    static const std::vector<RoiSpec> specs = {
        {"top_decor_search", 0, 0, 1000, 155, 128, 10.0, 0.10, 0.95},
        {"color_dot_row", 805, 78, 170, 18, 32, 4.0, 0.05, 0.95},
        {"position_cylinder", 330, 150, 150, 125, 128, 8.0, 0.10, 0.95},
        {"range_prism", 540, 150, 170, 125, 128, 8.0, 0.10, 0.95},
        {"bottom_filter_eq_chart", 410, 455, 260, 95, 48, 4.0, 0.05, 0.95},
        {"bottom_envelope_graph", 135, 455, 200, 100, 48, 4.0, 0.05, 0.95},
        {"grains_knob_cap", 125, 305, 90, 85, 128, 8.0, 0.05, 0.95},
    };
    return specs;
}

const RoiShapeExpectation* elysium_shape_expectation_for_roi(const char* id) {
    // ELYSIUM remains a content/regression fixture. The committed reference and
    // native render have known source-vs-native shape deltas, so this test keeps
    // ROI content floors without claiming strict shape parity.
    // The shape-expectation block below is intentionally inert until strict
    // per-ROI expectations are populated.
    static const std::vector<RoiShapeExpectation> expectations = {};
    for (const auto& expectation : expectations) {
        if (std::string(expectation.id) == id) return &expectation;
    }
    return nullptr;
}

fs::path source_root() {
#ifdef PULP_SOURCE_DIR
    return fs::path(PULP_SOURCE_DIR);
#else
    return fs::current_path();
#endif
}

std::vector<uint8_t> read_binary_file(const fs::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input.is_open()) return {};
    return {std::istreambuf_iterator<char>(input), {}};
}

bool write_binary_file(const fs::path& path, const std::vector<uint8_t>& bytes) {
    std::error_code ec;
    fs::create_directories(path.parent_path(), ec);
    std::ofstream output(path, std::ios::binary);
    if (!output.is_open()) return false;
    output.write(reinterpret_cast<const char*>(bytes.data()),
                 static_cast<std::streamsize>(bytes.size()));
    return output.good();
}

std::string read_text_file(const fs::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input.is_open()) return {};
    return {std::istreambuf_iterator<char>(input), {}};
}

bool is_safe_zip_entry(const std::string& name) {
    if (name.empty()) return false;
    fs::path path(name);
    if (path.is_absolute()) return false;
    for (const auto& part : path) {
        if (part == "..") return false;
    }
    return true;
}

bool extract_zip_to_dir(const fs::path& zip_path, const fs::path& dest_dir, std::string& error) {
    mz_zip_archive zip{};
    if (!mz_zip_reader_init_file(&zip, zip_path.string().c_str(), 0)) {
        error = "could not open ZIP " + zip_path.string();
        return false;
    }

    const mz_uint count = mz_zip_reader_get_num_files(&zip);
    for (mz_uint i = 0; i < count; ++i) {
        const mz_uint name_size = mz_zip_reader_get_filename(&zip, i, nullptr, 0);
        if (name_size == 0 || name_size > 4096) {
            error = "unsafe ZIP filename size";
            mz_zip_reader_end(&zip);
            return false;
        }

        std::vector<char> name_buf(name_size);
        mz_zip_reader_get_filename(&zip, i, name_buf.data(), name_buf.size());
        const std::string entry_name(name_buf.data());
        if (!is_safe_zip_entry(entry_name)) {
            error = "unsafe ZIP entry " + entry_name;
            mz_zip_reader_end(&zip);
            return false;
        }

        const auto out_path = dest_dir / fs::path(entry_name);
        if (mz_zip_reader_is_file_a_directory(&zip, i)) {
            std::error_code ec;
            fs::create_directories(out_path, ec);
            if (ec) {
                error = "could not create directory " + out_path.string();
                mz_zip_reader_end(&zip);
                return false;
            }
            continue;
        }

        std::error_code ec;
        fs::create_directories(out_path.parent_path(), ec);
        if (ec) {
            error = "could not create directory " + out_path.parent_path().string();
            mz_zip_reader_end(&zip);
            return false;
        }
        if (!mz_zip_reader_extract_to_file(&zip, i, out_path.string().c_str(), 0)) {
            error = "could not extract ZIP entry " + entry_name;
            mz_zip_reader_end(&zip);
            return false;
        }
    }

    mz_zip_reader_end(&zip);
    return true;
}

void absolutize_asset_paths(pulp::view::IRAssetManifest& manifest, const fs::path& base_dir) {
    for (auto& asset : manifest.assets) {
        if (!asset.local_path || asset.local_path->empty()) continue;
        fs::path path(*asset.local_path);
        if (path.is_relative()) path = base_dir / path;
        asset.local_path = path.lexically_normal().string();
    }
}

uint32_t count_ir_nodes(const pulp::view::IRNode& node) {
    uint32_t count = 1;
    for (const auto& child : node.children) count += count_ir_nodes(child);
    return count;
}

uint32_t count_nodes_with_attr(const pulp::view::IRNode& node, const char* key) {
    uint32_t count = node.attributes.count(key) ? 1u : 0u;
    for (const auto& child : node.children)
        count += count_nodes_with_attr(child, key);
    return count;
}

std::unique_ptr<View> load_elysium_default_cpp_view(const fs::path& fixture_zip,
                                                    ScopedTempDir& extracted,
                                                    pulp::view::DesignIR& ir,
                                                    std::vector<pulp::view::ImportDiagnostic>& diagnostics) {
    REQUIRE_FALSE(extracted.path.empty());

    std::string extract_error;
    const bool extracted_ok = extract_zip_to_dir(fixture_zip, extracted.path, extract_error);
    INFO(extract_error);
    REQUIRE(extracted_ok);

    const auto scene_path = extracted.path / "scene.pulp.json";
    REQUIRE(fs::exists(scene_path));
    auto scene_json = read_text_file(scene_path);
    REQUIRE_FALSE(scene_json.empty());

    ir = pulp::view::parse_figma_plugin_json(scene_json);
    absolutize_asset_paths(ir.asset_manifest, extracted.path);
    REQUIRE(ir.root.name == "VST Style");
    REQUIRE(count_ir_nodes(ir.root) == 187);  // rasterized: 3 vector frames -> image leaves
    REQUIRE(ir.asset_manifest.assets.size() == 75);  // +3 rasterized illustration PNGs

    // Promote captured-art knobs (hoist body disc + drop pointer hairlines)
    // BEFORE enrich so the hoisted asset_ref receives its absolute asset_path +
    // opaque-core metadata; the materializer then skins the knob and keeps it
    // interactive via the native notch overlay. Runs after the structural
    // assertions above, which pin the raw parsed scene.
    pulp::view::hoist_captured_art_knobs(ir);
    pulp::view::enrich_imported_image_asset_metadata(ir, ir.asset_manifest);

    // Per-shape gradient sampling: the four illustration shapes (DEPTH /
    // POSITION / OFFSET / SHIMMER) are colorful, so enrich samples each one's
    // OWN gradient into shape_fill_gradient; the grey chrome/logos stay below
    // the saturation gate and get none. Pins the sampling end-to-end (the
    // materializer forwards these to ImageView::set_fill_gradient so an opt-in
    // fill reveals the shape's real colors).
    REQUIRE(count_nodes_with_attr(ir.root, "shape_fill_gradient") >= 4);

    auto view = pulp::view::build_native_view_tree(
        ir,
        ir.asset_manifest,
        {.diagnostics_out = &diagnostics});
    REQUIRE(view != nullptr);
    view->set_bounds({0, 0, 1000.0f, 600.0f});

    bool has_error_diagnostic = false;
    bool has_unresolved_asset_diagnostic = false;
    std::ostringstream diagnostic_report;
    for (const auto& diagnostic : diagnostics) {
        diagnostic_report << diagnostic.code << " " << diagnostic.path << " "
                          << diagnostic.message << "\n";
        if (diagnostic.severity == pulp::view::ImportDiagnosticSeverity::error)
            has_error_diagnostic = true;
        if (diagnostic.kind == pulp::view::ImportDiagnosticKind::unresolved_asset)
            has_unresolved_asset_diagnostic = true;
    }
    INFO(diagnostic_report.str());
    REQUIRE_FALSE(has_error_diagnostic);
    REQUIRE_FALSE(has_unresolved_asset_diagnostic);

    return view;
}

Rect absolute_bounds(const View& view) {
    Rect bounds = view.bounds();
    for (auto* parent = view.parent(); parent != nullptr; parent = parent->parent()) {
        bounds.x += parent->bounds().x;
        bounds.y += parent->bounds().y;
    }
    return bounds;
}

std::string describe_hit(const View* hit) {
    if (!hit) return "null";
    const auto bounds = absolute_bounds(*hit);
    std::ostringstream out;
    out << hit;
    if (!hit->id().empty()) out << " id=" << hit->id();
    if (!hit->anchor_id().empty()) out << " anchor=" << hit->anchor_id();
    out << " abs=(" << bounds.x << "," << bounds.y << ","
        << bounds.width << "," << bounds.height << ")";
    return out.str();
}

pulp::view::Knob* require_knob_hit(View& root, Point point, const char* label) {
    auto* hit = root.hit_test(point);
    INFO(label << " hit point=(" << point.x << "," << point.y << ")"
               << " hit=" << describe_hit(hit));
    REQUIRE(hit != nullptr);
    auto* knob = dynamic_cast<pulp::view::Knob*>(hit);
    REQUIRE(knob != nullptr);
    return knob;
}

void require_same_knob_hit(View& root,
                           pulp::view::Knob& expected,
                           Point point,
                           const char* label) {
    auto* hit = root.hit_test(point);
    std::cout << "elysium_knob_hit_probe"
              << " name=" << label
              << " point=" << point.x << "," << point.y
              << " hit=" << describe_hit(hit)
              << "\n";
    INFO(label << " point=(" << point.x << "," << point.y << ")"
               << " expected=" << &expected
               << " hit=" << describe_hit(hit));
    REQUIRE(hit == &expected);
    REQUIRE(dynamic_cast<pulp::view::Knob*>(hit) == &expected);
}

void require_not_same_knob_hit(View& root,
                               pulp::view::Knob& excluded,
                               Point point,
                               const char* label) {
    auto* hit = root.hit_test(point);
    std::cout << "elysium_knob_hit_probe"
              << " name=" << label
              << " point=" << point.x << "," << point.y
              << " hit=" << describe_hit(hit)
              << "\n";
    INFO(label << " point=(" << point.x << "," << point.y << ")"
               << " excluded=" << &excluded
               << " hit=" << describe_hit(hit));
    REQUIRE(hit != &excluded);
}

void require_relative_drag_increases_knob(pulp::view::WindowHost& host,
                                          pulp::view::Knob& knob,
                                          Point point,
                                          const char* label) {
    knob.set_value(0.5f);
    const float before = knob.value();
    REQUIRE(pt::simulate_mouse(host, {.phase = pt::SimulatedMouse::Phase::down,
                                     .x = point.x,
                                     .y = point.y}));
    REQUIRE(pt::simulate_mouse(host, {.phase = pt::SimulatedMouse::Phase::drag,
                                     .x = point.x,
                                     .y = point.y,
                                     .mouse_delta_y = -30.0f}));
    REQUIRE(pt::simulate_mouse(host, {.phase = pt::SimulatedMouse::Phase::up,
                                     .x = point.x,
                                     .y = point.y}));

    std::cout << "elysium_knob_drag_probe"
              << " name=" << label
              << " point=" << point.x << "," << point.y
              << " before=" << before
              << " after=" << knob.value()
              << "\n";
    INFO(label << " knob value before=" << before << " after=" << knob.value());
    REQUIRE(knob.value() > before);
}

std::vector<uint8_t> crop_logical_roi(const std::vector<uint8_t>& png,
                                      uint32_t image_width,
                                      uint32_t image_height,
                                      uint32_t logical_width,
                                      uint32_t logical_height,
                                      const RoiSpec& roi) {
    const double x_scale = static_cast<double>(image_width) / static_cast<double>(logical_width);
    const double y_scale = static_cast<double>(image_height) / static_cast<double>(logical_height);
    const auto x = static_cast<uint32_t>(std::round(static_cast<double>(roi.x) * x_scale));
    const auto y = static_cast<uint32_t>(std::round(static_cast<double>(roi.y) * y_scale));
    auto width = static_cast<uint32_t>(std::round(static_cast<double>(roi.width) * x_scale));
    auto height = static_cast<uint32_t>(std::round(static_cast<double>(roi.height) * y_scale));
    if (x >= image_width || y >= image_height) return {};
    width = std::min(width, image_width - x);
    height = std::min(height, image_height - y);
    return pulp::view::crop_png(png, x, y, width, height);
}

void require_content_floor(const char* label,
                           const std::vector<uint8_t>& png,
                           uint32_t min_unique_colors = 16,
                           double min_luminance_stddev = 1.0,
                           double min_non_background_coverage = 0.05,
                           double min_opaque_coverage = 0.95) {
    auto stats = pulp::view::analyze_screenshot_content(png);
    INFO(label << " content stats: valid=" << stats.valid
               << " size=" << stats.width << "x" << stats.height
               << " unique_colors=" << stats.unique_colors
               << " unique_colors_capped=" << stats.unique_colors_capped
               << " luminance_stddev=" << stats.luminance_stddev
               << " opaque_coverage=" << stats.opaque_coverage
               << " non_background_coverage=" << stats.non_background_coverage
               << " error=" << stats.error);
    REQUIRE(stats.valid);
    REQUIRE(stats.unique_colors >= min_unique_colors);
    REQUIRE(stats.luminance_stddev >= min_luminance_stddev);
    REQUIRE(stats.non_background_coverage >= min_non_background_coverage);
    REQUIRE(stats.opaque_coverage >= min_opaque_coverage);
}

bool roi_passes_floor(const pulp::view::ScreenshotContentStats& stats, const RoiSpec& roi) {
    return stats.valid &&
           stats.unique_colors >= roi.min_unique_colors &&
           stats.luminance_stddev >= roi.min_luminance_stddev &&
           stats.non_background_coverage >= roi.min_non_background_coverage &&
           stats.opaque_coverage >= roi.min_opaque_coverage;
}

std::optional<fs::path> elysium_gpu_dump_dir() {
    if (const char* value = std::getenv("PULP_DESIGN_GPU_DUMP_DIR"); value && *value)
        return fs::path(value);
    return std::nullopt;
}

std::vector<uint8_t> require_roi(const char* label,
                                 const std::vector<uint8_t>& png,
                                 uint32_t x,
                                 uint32_t y,
                                 uint32_t width,
                                 uint32_t height) {
    auto crop = pulp::view::crop_png(png, x, y, width, height);
    INFO(label << " roi=(" << x << "," << y << " " << width << "x" << height
               << ") bytes=" << crop.size());
    REQUIRE_FALSE(crop.empty());
    return crop;
}

void configure_gpu_capture_fixture(View& root) {
    root.set_theme(pulp::view::Theme::dark());
    root.set_background_color(pulp::view::Color::rgba8(16, 19, 29, 255));
    root.flex().direction = pulp::view::FlexDirection::column;
    root.flex().padding = 12;
    root.flex().gap = 8;

    auto label = std::make_unique<pulp::view::Label>("GPU CAPTURE");
    label->set_font_size(18.0f);
    label->flex().preferred_height = 28.0f;
    root.add_child(std::move(label));

    auto panel = std::make_unique<View>();
    panel->set_background_color(pulp::view::Color::rgba8(74, 126, 255, 255));
    panel->flex().preferred_height = 48.0f;
    root.add_child(std::move(panel));
}

View* find_anchor(View& root, std::string_view anchor) {
    if (root.anchor_id() == anchor) return &root;
    for (std::size_t i = 0; i < root.child_count(); ++i)
        if (auto* found = find_anchor(*root.child_at(i), anchor)) return found;
    return nullptr;
}

void dump_overlay_frame(std::string_view name, const std::vector<uint8_t>& png) {
    const char* directory = std::getenv("BURL_OVERLAY_APPKIT_DUMP_DIR");
    if (!directory || !*directory || png.empty()) return;
    if (!write_binary_file(fs::path(directory) / (std::string(name) + ".png"), png))
        throw std::runtime_error("could not write AppKit overlay screenshot receipt");
}

pulp::view::DesignIR overlay_appkit_fixture(bool tooltip, bool outside_dismiss = false) {
    pulp::view::DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";
    ir.root.source_node_id = "root-source";
    ir.root.style.width = tooltip ? 320.0f : 400.0f;
    ir.root.style.height = tooltip ? 180.0f : 300.0f;
    ir.root.style.background_color = "#181818";

    pulp::view::IRNode trigger;
    trigger.type = "button";
    trigger.text_content = tooltip ? "Search" : "Usage";
    trigger.stable_anchor_id = "trigger";
    trigger.source_node_id = "trigger-source";
    trigger.style.position = "absolute";
    trigger.style.left = tooltip ? 20.0f : 100.0f;
    trigger.style.top = tooltip ? 20.0f : 40.0f;
    trigger.style.width = tooltip ? 40.0f : 60.0f;
    trigger.style.height = 24.0f;
    trigger.attributes = {
        {"focusable", "true"},
        {"pulpOverlayKind", tooltip ? "tooltip" : "popover"},
        {"pulpOverlayActivation", tooltip ? "hover" : "click"},
        {"pulpOverlayContentSourceId", "content-source"},
        {"pulpOverlaySide", "bottom"},
        {"pulpOverlayAlign", tooltip ? "center" : "end"},
        {"pulpOverlayDismissEscape", tooltip ? "false" : "true"},
        {"pulpOverlayDismissOutsidePointer", outside_dismiss ? "true" : "false"},
        {"pulpOverlayDismissTriggerToggle", tooltip ? "false" : "true"},
        {"pulpOverlayRestoreFocus", tooltip ? "false" : "true"},
    };

    pulp::view::IRNode content;
    content.type = tooltip ? "text" : "frame";
    content.text_content = tooltip ? "Search projects" : "";
    content.stable_anchor_id = "content";
    content.source_node_id = "content-source";
    content.style.position = "absolute";
    content.style.width = tooltip ? 100.0f : 120.0f;
    content.style.height = tooltip ? 28.0f : 80.0f;
    content.style.background_color = "#eeeeee";
    content.attributes = {
        {"pulpOverlayContent", "true"},
        {"pulpOverlayTriggerSourceId", "trigger-source"},
        {"pulpOverlayHostFor", "trigger-source"},
    };
    if (!tooltip) {
        pulp::view::IRNode editor;
        editor.type = "input";
        editor.stable_anchor_id = "content-editor";
        editor.source_node_id = "content-editor-source";
        editor.style.width = 100.0f;
        editor.style.height = 30.0f;
        editor.attributes["focusable"] = "true";
        content.children.push_back(std::move(editor));
    }
    ir.root.children = {std::move(trigger), std::move(content)};
    return ir;
}

pulp::view::DesignIR context_menu_appkit_fixture() {
    pulp::view::DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";
    ir.root.source_node_id = "root-source";
    ir.root.style.width = 400.0f;
    ir.root.style.height = 300.0f;
    ir.root.style.background_color = "#181818";

    pulp::view::IRNode trigger;
    trigger.type = "button";
    trigger.text_content = "Add dark mode toggle to settings";
    trigger.stable_anchor_id = "context-trigger";
    trigger.source_node_id = "context-trigger-source";
    trigger.style.position = "absolute";
    trigger.style.left = 30.0f;
    trigger.style.top = 36.0f;
    trigger.style.width = 220.0f;
    trigger.style.height = 28.0f;
    trigger.attributes = {
        {"focusable", "true"},
        {"pulpOverlayKind", "menu"},
        {"pulpOverlayActivation", "context-menu"},
        {"pulpOverlayAnchor", "pointer"},
        {"pulpOverlayContentSourceId", "context-content-source"},
        {"pulpOverlaySide", "bottom"},
        {"pulpOverlayAlign", "start"},
        {"pulpOverlayDismissEscape", "true"},
        {"pulpOverlayDismissOutsidePointer", "false"},
        {"pulpOverlayDismissTriggerToggle", "false"},
        {"pulpOverlayRestoreFocus", "false"},
    };

    pulp::view::IRNode content;
    content.type = "frame";
    content.stable_anchor_id = "context-content";
    content.source_node_id = "context-content-source";
    content.style.position = "absolute";
    content.style.width = 144.0f;
    content.style.height = 119.0f;
    content.style.background_color = "#272727";
    content.style.border_radius = 6.0f;
    content.attributes = {
        {"pulpOverlayContent", "true"},
        {"pulpOverlayTriggerSourceId", "context-trigger-source"},
        {"pulpOverlayHostFor", "context-trigger-source"},
    };

    const std::array<std::string_view, 3> labels = {"Rename", "Fork", "Delete"};
    for (std::size_t index = 0; index < labels.size(); ++index) {
        pulp::view::IRNode item;
        item.type = "button";
        item.text_content = std::string(labels[index]);
        item.stable_anchor_id = "context-item-" + std::to_string(index);
        item.source_node_id = "context-item-source-" + std::to_string(index);
        item.style.position = "absolute";
        item.style.left = 4.0f;
        item.style.top = 4.0f + static_cast<float>(index) * 37.0f;
        item.style.width = 136.0f;
        item.style.height = 37.0f;
        item.attributes["focusable"] = "true";
        content.children.push_back(std::move(item));
    }

    ir.root.children = {std::move(trigger), std::move(content)};
    return ir;
}

} // namespace

TEST_CASE("mac harness constructs a hidden GPU-backed window",
          "[mac][platform-harness][issue-2001]") {
    View root;
    auto host = pt::make_test_window(root);

    REQUIRE(host != nullptr);
    REQUIRE(host->is_visible() == false);
    REQUIRE(host->native_window_handle() != nullptr);
    REQUIRE(host->native_content_view_handle() != nullptr);
    REQUIRE(host->gpu_surface() != nullptr);
}

TEST_CASE("AppKit coordinates execute an imported hover tooltip contract",
          "[mac][platform-harness][overlay-contract]") {
    auto ir = overlay_appkit_fixture(true);
    auto root = pulp::view::build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    root->set_bounds({0, 0, 320, 180});
    root->layout_children();
    auto* trigger = find_anchor(*root, "trigger");
    auto* content = find_anchor(*root, "content");
    REQUIRE(trigger != nullptr);
    REQUIRE(content != nullptr);
    REQUIRE_FALSE(content->visible());

    WindowOptions options;
    options.width = 320;
    options.height = 180;
    auto host = pt::make_test_window(*root, options);
    REQUIRE(host != nullptr);
    const auto closed = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(closed.empty());

    REQUIRE(pt::simulate_mouse(*host, {
        .phase = pt::SimulatedMouse::Phase::move, .x = 40, .y = 32}));
    REQUIRE(trigger->is_hovered());
    REQUIRE(content->visible());
    REQUIRE(View::active_overlay_ == content);
    CHECK(std::abs(content->bounds().x - 8.0f) <= 0.01f);
    CHECK(std::abs(content->bounds().y - 48.0f) <= 0.01f);
    const auto open = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(open.empty());

    REQUIRE(pt::simulate_mouse(*host, {
        .phase = pt::SimulatedMouse::Phase::move, .x = 300, .y = 160}));
    REQUIRE_FALSE(content->visible());
    REQUIRE(View::active_overlay_ == nullptr);
    const auto closed_after_leave = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(closed_after_leave.empty());

    const auto state_delta = pulp::view::compare_screenshots(closed, open, 0);
    REQUIRE(state_delta.valid);
    CHECK(state_delta.similarity < 0.999f);
    const auto restored = pulp::view::compare_screenshots(closed, closed_after_leave, 0);
    REQUIRE(restored.valid);
    CHECK(restored.similarity >= 0.99f);
    dump_overlay_frame("tooltip-closed-320x180", closed);
    dump_overlay_frame("tooltip-open-320x180", open);
    dump_overlay_frame("tooltip-closed-after-leave-320x180", closed_after_leave);
}

TEST_CASE("AppKit click and keys execute an imported popover contract",
          "[mac][platform-harness][overlay-contract]") {
    auto ir = overlay_appkit_fixture(false, true);
    auto root = pulp::view::build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    root->set_bounds({0, 0, 400, 300});
    root->layout_children();
    auto* trigger = find_anchor(*root, "trigger");
    auto* content = find_anchor(*root, "content");
    auto* editor = find_anchor(*root, "content-editor");
    REQUIRE(trigger != nullptr);
    REQUIRE(content != nullptr);
    REQUIRE(editor != nullptr);

    WindowOptions options;
    options.width = 400;
    options.height = 300;
    auto host = pt::make_test_window(*root, options);
    REQUIRE(host != nullptr);
    REQUIRE(pt::simulate_key(*host, {
        .phase = pt::SimulatedKey::Phase::down, .key = pulp::view::KeyCode::tab}));
    REQUIRE(View::focused_input_ == trigger);
    const auto closed = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(closed.empty());

    const auto trace = pt::simulate_click_traced(*host, *root, 130, 52,
        [&] { return content->visible() ? 1u : 0u; });
    REQUIRE(trace.down_dispatched);
    REQUIRE(trace.up_dispatched);
    REQUIRE(trace.action_fired);
    REQUIRE(content->visible());
    REQUIRE(View::active_overlay_ == content);
    REQUIRE(View::focused_input_ == editor);
    CHECK(std::abs(content->bounds().x - 40.0f) <= 0.01f);
    CHECK(std::abs(content->bounds().y - 68.0f) <= 0.01f);
    const auto open = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(open.empty());

    // The imported source contract explicitly records trusted outside-pointer
    // dismissal, so the production AppKit route must honor it and restore the
    // trigger focus before any subsequent activation.
    REQUIRE(pt::simulate_mouse(*host, {
        .phase = pt::SimulatedMouse::Phase::down, .x = 350, .y = 260}));
    REQUIRE(pt::simulate_mouse(*host, {
        .phase = pt::SimulatedMouse::Phase::up, .x = 350, .y = 260}));
    REQUIRE_FALSE(content->visible());
    REQUIRE(View::active_overlay_ == nullptr);
    REQUIRE(View::focused_input_ == trigger);
    const auto outside_closed = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(outside_closed.empty());

    REQUIRE(pt::simulate_click_traced(*host, *root, 130, 52).up_dispatched);
    REQUIRE(content->visible());
    REQUIRE(View::focused_input_ == editor);

    REQUIRE(pt::simulate_key(*host, {
        .phase = pt::SimulatedKey::Phase::down, .key = pulp::view::KeyCode::escape}));
    REQUIRE(pt::simulate_key(*host, {
        .phase = pt::SimulatedKey::Phase::up, .key = pulp::view::KeyCode::escape}));
    REQUIRE_FALSE(content->visible());
    REQUIRE(View::active_overlay_ == nullptr);
    REQUIRE(View::focused_input_ == trigger);
    const auto escape_closed = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(escape_closed.empty());

    const auto state_delta = pulp::view::compare_screenshots(closed, open, 0);
    REQUIRE(state_delta.valid);
    CHECK(state_delta.similarity < 0.999f);
    const auto outside_restored = pulp::view::compare_screenshots(closed, outside_closed, 0);
    REQUIRE(outside_restored.valid);
    CHECK(outside_restored.similarity >= 0.99f);
    const auto restored = pulp::view::compare_screenshots(closed, escape_closed, 0);
    REQUIRE(restored.valid);
    CHECK(restored.similarity >= 0.99f);
    dump_overlay_frame("popover-closed-400x300", closed);
    dump_overlay_frame("popover-open-400x300", open);
    dump_overlay_frame("popover-outside-closed-400x300", outside_closed);
    dump_overlay_frame("popover-escape-closed-400x300", escape_closed);
}

TEST_CASE("AppKit outside click requires an explicitly captured dismissal gate",
          "[mac][platform-harness][overlay-contract]") {
    auto ir = overlay_appkit_fixture(false, false);
    auto root = pulp::view::build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    root->set_bounds({0, 0, 400, 300});
    root->layout_children();
    auto* content = find_anchor(*root, "content");
    REQUIRE(content != nullptr);

    WindowOptions options;
    options.width = 400;
    options.height = 300;
    auto host = pt::make_test_window(*root, options);
    REQUIRE(host != nullptr);
    REQUIRE(pt::simulate_click_traced(*host, *root, 130, 52).up_dispatched);
    REQUIRE(content->visible());
    REQUIRE(pt::simulate_mouse(*host, {
        .phase = pt::SimulatedMouse::Phase::down, .x = 350, .y = 260}));
    REQUIRE(content->visible());
    REQUIRE(View::active_overlay_ == content);
    const auto retained = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(retained.empty());
    dump_overlay_frame("popover-outside-retained-without-gate-400x300", retained);
}

TEST_CASE("AppKit right-click and Escape execute an imported context-menu contract",
          "[mac][platform-harness][overlay-contract][context-menu]") {
    auto ir = context_menu_appkit_fixture();
    auto root = pulp::view::build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    root->set_bounds({0, 0, 400, 300});
    root->layout_children();
    auto* trigger = find_anchor(*root, "context-trigger");
    auto* content = find_anchor(*root, "context-content");
    auto* first_item = find_anchor(*root, "context-item-0");
    REQUIRE(trigger != nullptr);
    REQUIRE(content != nullptr);
    REQUIRE(first_item != nullptr);
    REQUIRE_FALSE(content->visible());

    WindowOptions options;
    options.width = 400;
    options.height = 300;
    auto host = pt::make_test_window(*root, options);
    REQUIRE(host != nullptr);
    const auto closed = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(closed.empty());

    REQUIRE(pt::simulate_mouse(*host, {
        .phase = pt::SimulatedMouse::Phase::down,
        .button = pulp::view::MouseButton::right,
        .x = 150,
        .y = 50}));
    REQUIRE(pt::simulate_mouse(*host, {
        .phase = pt::SimulatedMouse::Phase::up,
        .button = pulp::view::MouseButton::right,
        .x = 150,
        .y = 50}));
    REQUIRE(content->visible());
    REQUIRE(View::active_overlay_ == content);
    REQUIRE(View::focused_input_ == first_item);
    CHECK(std::abs(content->bounds().x - 150.0f) <= 0.01f);
    CHECK(std::abs(content->bounds().y - 54.0f) <= 0.01f);
    const auto open = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(open.empty());

    REQUIRE(pt::simulate_key(*host, {
        .phase = pt::SimulatedKey::Phase::down, .key = pulp::view::KeyCode::escape}));
    REQUIRE(pt::simulate_key(*host, {
        .phase = pt::SimulatedKey::Phase::up, .key = pulp::view::KeyCode::escape}));
    REQUIRE_FALSE(content->visible());
    REQUIRE(View::active_overlay_ == nullptr);
    const auto escape_closed = pt::capture_back_buffer_png(*host);
    REQUIRE_FALSE(escape_closed.empty());

    const auto state_delta = pulp::view::compare_screenshots(closed, open, 0);
    REQUIRE(state_delta.valid);
    CHECK(state_delta.similarity < 0.999f);
    const auto restored = pulp::view::compare_screenshots(closed, escape_closed, 0);
    REQUIRE(restored.valid);
    CHECK(restored.similarity >= 0.99f);
    dump_overlay_frame("context-menu-closed-400x300", closed);
    dump_overlay_frame("context-menu-open-400x300", open);
    dump_overlay_frame("context-menu-escape-closed-400x300", escape_closed);
}

TEST_CASE("mac harness back-buffer capture returns non-empty PNG bytes",
          "[mac][platform-harness][issue-2001]") {
    View root;
    configure_gpu_capture_fixture(root);
    auto host = pt::make_test_window(root);
    REQUIRE(host != nullptr);

    auto png = pt::capture_back_buffer_png(*host);

    // The harness's contract is "deterministic host-managed pixels".
    // For the GPU host that means render_frame() succeeded and
    // encode_rgba_to_png() produced a real PNG. An empty result here
    // would indicate the back-buffer path is broken on hidden windows.
    INFO("png byte count: " << png.size());
    REQUIRE_FALSE(png.empty());

    // PNG signature sanity-check (8-byte magic). Catches the case where
    // the back-buffer readback returns raw RGBA without the encode step.
    REQUIRE(png.size() >= 8);
    REQUIRE(png[0] == 0x89);
    REQUIRE(png[1] == 0x50);  // 'P'
    REQUIRE(png[2] == 0x4E);  // 'N'
    REQUIRE(png[3] == 0x47);  // 'G'

    require_content_floor("single-frame gpu capture", png);
}

TEST_CASE("mac harness settled GPU capture is stable and checks expected ROIs",
          "[mac][platform-harness][issue-2001][content-oracle]") {
    View root;
    configure_gpu_capture_fixture(root);
    auto host = pt::make_test_window(root);
    REQUIRE(host != nullptr);

    auto frames = pt::capture_settled_back_buffer_png(*host, 3);
    REQUIRE(frames.size() == 3);

    std::ostringstream report;
    report << "settled frames:";
    for (const auto& frame : frames) {
        report << " #" << frame.frame_index
               << " t=" << frame.elapsed_ms << "ms"
               << " bytes=" << frame.png.size();
        REQUIRE_FALSE(frame.png.empty());
        require_content_floor("settled gpu frame", frame.png);
    }
    INFO(report.str());

    for (size_t i = 1; i < frames.size(); ++i) {
        auto result = pulp::view::compare_screenshots(frames.front().png,
                                                      frames[i].png,
                                                      2);
        INFO("settled frame similarity frame0->frame" << i
                                                      << " similarity=" << result.similarity
                                                      << " diff_pixels=" << result.diff_pixels
                                                      << " error=" << result.error);
        REQUIRE(result.valid);
        REQUIRE(result.similarity >= 0.99f);
    }

    auto full = pulp::view::analyze_screenshot_content(frames.back().png);
    REQUIRE(full.valid);

    const uint32_t roi_w = std::max<uint32_t>(16, full.width / 4);
    const uint32_t roi_h = std::max<uint32_t>(8, full.height / 12);
    // These fractions intentionally target the `make_test_window` default
    // fixture layout (320x240): label y=12..40, blue panel y=48..96, dark
    // background below. If the fixture geometry changes, the ROI
    // similarity/content assertions should fail loud.
    auto panel = require_roi("blue panel",
                             frames.back().png,
                             full.width / 8,
                             full.height / 4,
                             roi_w,
                             roi_h);
    auto background = require_roi("lower background",
                                  frames.back().png,
                                  full.width / 8,
                                  (full.height * 3) / 4,
                                  roi_w,
                                  roi_h);
    auto panel_vs_background = pulp::view::compare_screenshots(panel, background, 8);
    INFO("panel/background similarity=" << panel_vs_background.similarity
                                        << " diff_pixels=" << panel_vs_background.diff_pixels
                                        << " error=" << panel_vs_background.error);
    REQUIRE(panel_vs_background.valid);
    REQUIRE(panel_vs_background.similarity < 0.25f);

    auto label = require_roi("label text",
                             frames.back().png,
                             full.width / 18,
                             full.height / 20,
                             full.width / 3,
                             std::max<uint32_t>(8, full.height / 10));
    require_content_floor("label text roi", label, 4, 4.0, 0.005, 0.95);
}

TEST_CASE("mac harness captures ELYSIUM default C++ import through GPU path",
          "[mac][platform-harness][issue-2001][elysium][gpu-report]") {
    const auto repo = source_root();
    const auto fixture_zip =
        repo / "planning/fixtures/figma-plugin/real-designs/elysium.pulp.zip";
    const auto reference_png_path =
        repo / "planning/fixtures/figma-plugin/real-designs/reference/elysium-figma-rest-absolute-scale2.png";

    if (!fs::exists(fixture_zip) || !fs::exists(reference_png_path)) {
        SKIP("ELYSIUM source/reference fixtures are not present in this checkout");
    }

    ScopedTempDir extracted("pulp-design-gpu-fixture");
    REQUIRE_FALSE(extracted.path.empty());

    std::string extract_error;
    const bool extracted_ok = extract_zip_to_dir(fixture_zip, extracted.path, extract_error);
    INFO(extract_error);
    REQUIRE(extracted_ok);

    const auto scene_path = extracted.path / "scene.pulp.json";
    REQUIRE(fs::exists(scene_path));
    auto scene_json = read_text_file(scene_path);
    REQUIRE_FALSE(scene_json.empty());

    auto ir = pulp::view::parse_figma_plugin_json(scene_json);
    absolutize_asset_paths(ir.asset_manifest, extracted.path);
    REQUIRE(ir.root.name == "VST Style");
    REQUIRE(count_ir_nodes(ir.root) == 187);  // rasterized: 3 vector frames -> image leaves
    REQUIRE(ir.asset_manifest.assets.size() == 75);  // +3 rasterized illustration PNGs

    // Promote captured-art knobs (hoist body disc + drop pointer hairlines)
    // BEFORE enrich so the hoisted asset_ref receives its absolute asset_path +
    // opaque-core metadata; the materializer then skins the knob and keeps it
    // interactive via the native notch overlay. Runs after the structural
    // assertions above, which pin the raw parsed scene.
    pulp::view::hoist_captured_art_knobs(ir);
    pulp::view::enrich_imported_image_asset_metadata(ir, ir.asset_manifest);

    std::vector<pulp::view::ImportDiagnostic> diagnostics;
    auto view = pulp::view::build_native_view_tree(
        ir,
        ir.asset_manifest,
        {.diagnostics_out = &diagnostics});
    REQUIRE(view != nullptr);
    view->set_bounds({0, 0, 1000.0f, 600.0f});

    bool has_error_diagnostic = false;
    bool has_unresolved_asset_diagnostic = false;
    std::ostringstream diagnostic_report;
    for (const auto& diagnostic : diagnostics) {
        diagnostic_report << diagnostic.code << " " << diagnostic.path << " "
                          << diagnostic.message << "\n";
        if (diagnostic.severity == pulp::view::ImportDiagnosticSeverity::error)
            has_error_diagnostic = true;
        if (diagnostic.kind == pulp::view::ImportDiagnosticKind::unresolved_asset)
            has_unresolved_asset_diagnostic = true;
    }
    INFO(diagnostic_report.str());
    REQUIRE_FALSE(has_error_diagnostic);
    REQUIRE_FALSE(has_unresolved_asset_diagnostic);

    WindowOptions opts;
    opts.width = 1000;
    opts.height = 600;
    auto host = pt::make_test_window(*view, opts);
    REQUIRE(host != nullptr);
    REQUIRE(host->gpu_surface() != nullptr);

    auto frames = pt::capture_settled_back_buffer_png(*host, 3);
    REQUIRE(frames.size() == 3);
    for (const auto& frame : frames) {
        REQUIRE_FALSE(frame.png.empty());
        require_content_floor("ELYSIUM default C++ GPU frame",
                              frame.png,
                              128,
                              8.0,
                              0.05,
                              0.95);
    }

    for (size_t i = 1; i < frames.size(); ++i) {
        auto result = pulp::view::compare_screenshots(frames.front().png,
                                                      frames[i].png,
                                                      2);
        INFO("ELYSIUM settled frame similarity frame0->frame" << i
             << " similarity=" << result.similarity
             << " diff_pixels=" << result.diff_pixels
             << " error=" << result.error);
        REQUIRE(result.valid);
        REQUIRE(result.similarity >= 0.99f);
    }

    auto reference_png = read_binary_file(reference_png_path);
    REQUIRE_FALSE(reference_png.empty());
    const auto reference_stats = pulp::view::analyze_screenshot_content(reference_png);
    const auto rendered_stats = pulp::view::analyze_screenshot_content(frames.back().png);
    REQUIRE(reference_stats.valid);
    REQUIRE(rendered_stats.valid);

    const auto dump_dir = elysium_gpu_dump_dir();
    if (dump_dir) {
        write_binary_file(*dump_dir / "elysium-reference-full.png", reference_png);
        write_binary_file(*dump_dir / "elysium-rendered-full.png", frames.back().png);
    }

    std::cout << "elysium_gpu_report"
              << " reference_size=" << reference_stats.width << "x" << reference_stats.height
              << " rendered_size=" << rendered_stats.width << "x" << rendered_stats.height
              << " rendered_unique_colors=" << rendered_stats.unique_colors
              << " rendered_luminance_stddev=" << rendered_stats.luminance_stddev
              << " rendered_non_background_coverage=" << rendered_stats.non_background_coverage
              << "\n";

    for (const auto& roi : elysium_roi_specs()) {
        auto reference_roi = crop_logical_roi(reference_png,
                                             reference_stats.width,
                                             reference_stats.height,
                                             1000,
                                             600,
                                             roi);
        auto rendered_roi = crop_logical_roi(frames.back().png,
                                            rendered_stats.width,
                                            rendered_stats.height,
                                            1000,
                                            600,
                                            roi);
        REQUIRE_FALSE(reference_roi.empty());
        REQUIRE_FALSE(rendered_roi.empty());

        auto reference_roi_stats = pulp::view::analyze_screenshot_content(reference_roi);
        auto rendered_roi_stats = pulp::view::analyze_screenshot_content(rendered_roi);
        REQUIRE(roi_passes_floor(reference_roi_stats, roi));
        REQUIRE(rendered_roi_stats.valid);
        REQUIRE(roi_passes_floor(rendered_roi_stats, roi));

        auto similarity = pulp::view::compare_screenshots(reference_roi, rendered_roi, 24);
        REQUIRE(similarity.valid);
        REQUIRE(similarity.total_pixels > 0);
        const double diff_coverage =
            static_cast<double>(similarity.diff_pixels) /
            static_cast<double>(similarity.total_pixels);

        if (dump_dir) {
            const std::string roi_id(roi.id);
            write_binary_file(*dump_dir / ("elysium-" + roi_id + "-reference.png"), reference_roi);
            write_binary_file(*dump_dir / ("elysium-" + roi_id + "-rendered.png"), rendered_roi);
            auto diff = pulp::view::generate_diff_image(reference_roi, rendered_roi, 24);
            if (!diff.empty())
                write_binary_file(*dump_dir / ("elysium-" + roi_id + "-diff.png"), diff);
        }

        const bool rendered_content_pass = roi_passes_floor(rendered_roi_stats, roi);
        std::cout << "elysium_gpu_roi"
                  << " id=" << roi.id
                  << " rendered_content_pass=" << (rendered_content_pass ? "true" : "false")
                  << " similarity=" << similarity.similarity
                  << " diff_pixels=" << similarity.diff_pixels
                  << " diff_coverage=" << diff_coverage
                  << " rendered_unique_colors=" << rendered_roi_stats.unique_colors
                  << " rendered_luminance_stddev=" << rendered_roi_stats.luminance_stddev
                  << " rendered_non_background_coverage=" << rendered_roi_stats.non_background_coverage
                  << "\n";

        if (const auto* shape = elysium_shape_expectation_for_roi(roi.id)) {
            const bool shape_passes =
                similarity.similarity >= shape->min_similarity &&
                diff_coverage <= shape->max_diff_coverage;
            std::cout << "elysium_gpu_shape_roi"
                      << " id=" << roi.id
                      << " shape_pass=" << (shape_passes ? "true" : "false")
                      << " similarity=" << similarity.similarity
                      << " min_similarity=" << shape->min_similarity
                      << " diff_coverage=" << diff_coverage
                      << " max_diff_coverage=" << shape->max_diff_coverage
                      << "\n";
            INFO("shape ROI " << roi.id
                               << " similarity=" << similarity.similarity
                               << " min_similarity=" << shape->min_similarity
                               << " diff_coverage=" << diff_coverage
                               << " max_diff_coverage=" << shape->max_diff_coverage);
            REQUIRE(similarity.similarity >= shape->min_similarity);
            REQUIRE(diff_coverage <= shape->max_diff_coverage);
        }
    }
}

TEST_CASE("mac harness drives ELYSIUM imported knob body through hidden GPU host",
          "[mac][platform-harness][issue-2001][elysium][interaction][hit-test]") {
    const auto repo = source_root();
    const auto fixture_zip =
        repo / "planning/fixtures/figma-plugin/real-designs/elysium.pulp.zip";

    if (!fs::exists(fixture_zip)) {
        SKIP("ELYSIUM source fixture is not present in this checkout");
    }

    ScopedTempDir extracted("pulp-design-gpu-interaction-fixture");
    pulp::view::DesignIR ir;
    std::vector<pulp::view::ImportDiagnostic> diagnostics;
    auto view = load_elysium_default_cpp_view(fixture_zip, extracted, ir, diagnostics);
    REQUIRE(view != nullptr);

    WindowOptions opts;
    opts.width = 1000;
    opts.height = 600;
    auto host = pt::make_test_window(*view, opts);
    REQUIRE(host != nullptr);
    REQUIRE(host->gpu_surface() != nullptr);

    auto frames = pt::capture_settled_back_buffer_png(*host, 3);
    REQUIRE(frames.size() == 3);
    REQUIRE_FALSE(frames.back().png.empty());
    require_content_floor("ELYSIUM interaction preflight GPU frame",
                          frames.back().png,
                          128,
                          8.0,
                          0.05,
                          0.95);

    const Point grains_knob_body{162.0f, 356.0f};
    auto* knob = require_knob_hit(*view, grains_knob_body, "ELYSIUM grains knob body");
    const auto knob_abs = absolute_bounds(*knob);
    INFO("ELYSIUM grains knob absolute bounds=(" << knob_abs.x << "," << knob_abs.y
                                                 << "," << knob_abs.width << ","
                                                 << knob_abs.height << ")");
    auto knob_point = [knob_abs](float x, float y) {
        return Point{knob_abs.x + knob_abs.width * x,
                     knob_abs.y + knob_abs.height * y};
    };

    const Point body_center = knob_point(0.50f, 0.42f);
    const Point arc_left = knob_point(0.25f, 0.43f);
    const Point arc_right = knob_point(0.75f, 0.43f);
    const Point halo_top = knob_point(0.50f, 0.15f);
    const Point label_text = knob_point(0.50f, 0.72f);
    const Point value_text = knob_point(0.50f, 0.90f);

    require_same_knob_hit(*view, *knob, body_center, "body_center");
    require_same_knob_hit(*view, *knob, arc_left, "arc_left");
    require_same_knob_hit(*view, *knob, arc_right, "arc_right");
    require_same_knob_hit(*view, *knob, halo_top, "halo_top");
    require_same_knob_hit(*view, *knob, label_text, "label_text");
    require_same_knob_hit(*view, *knob, value_text, "value_text");

    require_not_same_knob_hit(*view,
                              *knob,
                              {knob_abs.x - 8.0f, knob_abs.y + knob_abs.height * 0.43f},
                              "outside_left");
    require_not_same_knob_hit(*view,
                              *knob,
                              {knob_abs.x + knob_abs.width + 8.0f,
                               knob_abs.y + knob_abs.height * 0.43f},
                              "outside_right");
    require_not_same_knob_hit(*view,
                              *knob,
                              {knob_abs.x + knob_abs.width * 0.50f, knob_abs.y - 8.0f},
                              "outside_top");
    require_not_same_knob_hit(*view,
                              *knob,
                              {knob_abs.x + knob_abs.width * 0.50f,
                               knob_abs.y + knob_abs.height + 8.0f},
                              "outside_bottom");

    // The knob enters relative mouse mode on down; keep the absolute drag
    // location stable so each value change is attributable to NSEvent.deltaY.
    require_relative_drag_increases_knob(*host, *knob, body_center, "body_center");
    require_relative_drag_increases_knob(*host, *knob, arc_left, "arc_left");
    require_relative_drag_increases_knob(*host, *knob, arc_right, "arc_right");
    require_relative_drag_increases_knob(*host, *knob, halo_top, "halo_top");
}

TEST_CASE("mac harness honors caller-provided window options size",
          "[mac][platform-harness][issue-2001]") {
    View root;
    WindowOptions opts;
    opts.width = 640;
    opts.height = 480;

    auto host = pt::make_test_window(root, opts);
    REQUIRE(host != nullptr);

    const auto content = host->get_content_size();
    // CAMetalLayer drawableSize is the logical size scaled by
    // contentsScale on Retina, so don't assert byte-equal — just
    // assert the host rounded the request up to something plausible.
    REQUIRE(content.width  >= 600);
    REQUIRE(content.height >= 400);
}

// ── Regression contract: scroll deltas + button routing ──────────────────
//
TEST_CASE("runtime window appearance updates native backdrop without recreation",
          "[mac][platform-harness][appearance]") {
    View root;
    root.set_bounds({0, 0, 480, 320});

    WindowOptions options;
    options.width = 480;
    options.height = 320;
    options.transparent = true;
    options.backdrop_effect = pulp::view::WindowBackdropEffect::vibrancy_menu;
    options.appearance = pulp::view::WindowAppearance::dark;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);

    const auto dark = pt::inspect_native_appearance(*host);
    REQUIRE(dark.window_identity != 0);
    REQUIRE(dark.effect_identity != 0);
    CHECK(dark.has_explicit_window_appearance);
    CHECK(dark.window_best_match == "NSAppearanceNameDarkAqua");
    CHECK(dark.effect_best_match == "NSAppearanceNameDarkAqua");

    host->set_appearance(pulp::view::WindowAppearance::light);
    const auto light = pt::inspect_native_appearance(*host);
    CHECK(light.window_identity == dark.window_identity);
    CHECK(light.effect_identity == dark.effect_identity);
    CHECK(light.has_explicit_window_appearance);
    CHECK(light.window_best_match == "NSAppearanceNameAqua");
    CHECK(light.effect_best_match == "NSAppearanceNameAqua");

    host->set_appearance(pulp::view::WindowAppearance::system);
    const auto system = pt::inspect_native_appearance(*host);
    CHECK(system.window_identity == dark.window_identity);
    CHECK(system.effect_identity == dark.effect_identity);
    CHECK_FALSE(system.has_explicit_window_appearance);
    CHECK_FALSE(system.window_best_match.empty());
    CHECK(system.effect_best_match == system.window_best_match);
}

// These tests pin two platform-harness contracts:
//   1. `build_event` must construct scroll wheel events that carry
//      `scrollingDeltaX/Y`, because `PulpView::scrollWheel:` reads those
//      fields and the synthetic event must exercise real scroll math.
//   2. `simulate_mouse` must route right-click phases through
//      `rightMouseDown:` rather than the left-click selectors, which is what
//      triggers the context-menu path.
//
// They build a hidden GPU window, install a child view with a known hit-test
// rect, and assert the production selectors actually fired.

TEST_CASE("mac harness scroll event carries non-zero deltas through PulpView",
          "[mac][platform-harness][issue-2001]") {
    View root;
    root.set_bounds({0, 0, 320, 240});

    // Child fills the window. on_pointer_event is the callback
    // `PulpView::scrollWheel:` invokes once it has walked ancestors to
    // dispatch a wheel-flagged MouseEvent.
    auto child = std::make_unique<View>();
    child->flex().preferred_width = 320.0f;
    child->flex().preferred_height = 240.0f;

    int wheel_calls = 0;
    float captured_dx = 0.0f;
    float captured_dy = 0.0f;
    child->on_pointer_event = [&](const MouseEvent& me) {
        if (!me.is_wheel) return;
        ++wheel_calls;
        captured_dx = me.scroll_delta_x;
        captured_dy = me.scroll_delta_y;
    };
    root.add_child(std::move(child));
    root.layout_children();

    auto host = pt::make_test_window(root);
    REQUIRE(host != nullptr);

    pt::SimulatedMouse ev;
    ev.phase = pt::SimulatedMouse::Phase::scroll;
    ev.x = 100.0f;
    ev.y = 100.0f;
    ev.scroll_delta_y = 10.0f;
    ev.scroll_delta_x = 0.0f;
    REQUIRE(pt::simulate_mouse(*host, ev));

    REQUIRE(wheel_calls >= 1);
    // PulpView::scrollWheel: negates the Y axis (Cocoa wheel deltas are
    // bottom-up; the View MouseEvent is top-down). The harness builds the
    // NSEvent from the caller's raw scroll_delta_y, so the View callback
    // observes |delta| > 0 with the production sign.
    REQUIRE(captured_dy != 0.0f);
    REQUIRE(captured_dx == 0.0f);
}

TEST_CASE("mac harness right-click reaches PulpView::rightMouseDown: not mouseDown:",
          "[mac][platform-harness][issue-2001]") {
    View root;
    root.set_bounds({0, 0, 320, 240});

    auto child = std::make_unique<View>();
    child->flex().preferred_width = 320.0f;
    child->flex().preferred_height = 240.0f;

    // `on_click` is the left-click signal: PulpView::mouseUp: posts it
    // via dispatch_async. `on_context_menu` is the right-click signal:
    // PulpView::rightMouseDown: invokes it synchronously. Wiring both
    // here lets us prove the synthetic right-click did NOT fall into
    // the left-click path.
    int left_clicks = 0;
    int context_menus = 0;
    child->on_click = [&] { ++left_clicks; };
    child->on_context_menu = [&](pulp::view::Point) { ++context_menus; };
    root.add_child(std::move(child));
    root.layout_children();

    auto host = pt::make_test_window(root);
    REQUIRE(host != nullptr);

    pt::SimulatedMouse down;
    down.phase = pt::SimulatedMouse::Phase::down;
    down.button = MouseButton::right;
    down.x = 50.0f;
    down.y = 50.0f;
    REQUIRE(pt::simulate_mouse(*host, down));

    // Right-click only fires on rightMouseDown:; the matching up event
    // is exercised here mainly to keep the gesture symmetrical and to
    // confirm `simulate_mouse` does not crash when routing to
    // `rightMouseUp:` (which PulpView does not override).
    pt::SimulatedMouse up = down;
    up.phase = pt::SimulatedMouse::Phase::up;
    REQUIRE(pt::simulate_mouse(*host, up));

    REQUIRE(context_menus == 1);
    REQUIRE(left_clicks == 0);
}

TEST_CASE("transparent vibrancy chrome keeps Skia content click-hit-testable",
          "[mac][platform-harness][window-chrome][interaction]") {
    View root;
    root.set_bounds({0, 0, 320, 240});
    auto child = std::make_unique<View>();
    child->flex().preferred_width = 320.0f;
    child->flex().preferred_height = 240.0f;
    int clicks = 0;
    child->on_click = [&] { ++clicks; };
    root.add_child(std::move(child));
    root.layout_children();

    WindowOptions options;
    options.use_gpu = true;
    options.initially_hidden = true;
    options.transparent = true;
    options.title_bar_style = pulp::view::WindowTitleBarStyle::hidden_inset;
    options.backdrop_effect = pulp::view::WindowBackdropEffect::vibrancy_menu;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);
    pt::SimulatedMouse down{.phase = pt::SimulatedMouse::Phase::down, .x = 80.0f, .y = 80.0f};
    pt::SimulatedMouse up = down;
    up.phase = pt::SimulatedMouse::Phase::up;
    REQUIRE(pt::simulate_mouse(*host, down));
    REQUIRE(pt::simulate_mouse(*host, up));
    // Exercise two independent gestures so the chrome stack cannot pass only
    // an activation edge while dropping normal content clicks.
    REQUIRE(pt::simulate_mouse(*host, down));
    REQUIRE(pt::simulate_mouse(*host, up));
    REQUIRE(clicks == 2);
}

TEST_CASE("mac harness records click targets and observable action outcome",
          "[mac][platform-harness][interaction-trace]") {
    View root;
    root.set_bounds({0, 0, 160, 80});
    auto control = std::make_unique<View>();
    control->set_anchor_id("control");
    control->flex().preferred_width = 120.0f;
    control->flex().preferred_height = 48.0f;
    int clicks = 0;
    control->on_click = [&] { ++clicks; };
    auto label = std::make_unique<View>();
    label->set_anchor_id("control-label");
    label->flex().preferred_width = 120.0f;
    label->flex().preferred_height = 48.0f;
    control->add_child(std::move(label));
    root.add_child(std::move(control));
    root.layout_children();

    auto host = pt::make_test_window(root);
    REQUIRE(host != nullptr);
    const auto trace = pt::simulate_click_traced(
        *host, root, 40.0f, 24.0f,
        [&] { return static_cast<uint64_t>(clicks); });
    CHECK(trace.press_target == "control-label");
    CHECK(trace.release_target == "control-label");
    CHECK(trace.actionable_ancestor == "control");
    CHECK(trace.down_dispatched);
    CHECK(trace.up_dispatched);
    CHECK(trace.outcome_before == 0);
    CHECK(trace.outcome_after == 1);
    CHECK(trace.action_fired);
}

TEST_CASE("liquid glass chrome keeps Skia content click-hit-testable",
          "[mac][platform-harness][window-chrome][interaction]") {
    View root;
    root.set_bounds({0, 0, 320, 240});
    auto child = std::make_unique<View>();
    child->flex().preferred_width = 320.0f;
    child->flex().preferred_height = 240.0f;
    int clicks = 0;
    child->on_click = [&] { ++clicks; };
    root.add_child(std::move(child));
    root.layout_children();

    WindowOptions options;
    options.use_gpu = true;
    options.initially_hidden = true;
    options.transparent = true;
    options.title_bar_style = pulp::view::WindowTitleBarStyle::hidden_inset;
    options.backdrop_effect = pulp::view::WindowBackdropEffect::liquid_glass;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);
    pt::SimulatedMouse down{.phase = pt::SimulatedMouse::Phase::down, .x = 80.0f, .y = 80.0f};
    pt::SimulatedMouse up = down;
    up.phase = pt::SimulatedMouse::Phase::up;
    REQUIRE(pt::simulate_mouse(*host, down));
    REQUIRE(pt::simulate_mouse(*host, up));
    REQUIRE(clicks == 1);
}

TEST_CASE("liquid glass chrome resizes the hosted Metal content on both axes",
          "[mac][platform-harness][window-chrome][resize]") {
    View root;
    root.set_bounds({0, 0, 320, 240});
    WindowOptions options;
    options.width = 320;
    options.height = 240;
    options.resizable = true;
    options.use_gpu = true;
    options.initially_hidden = true;
    options.transparent = true;
    options.backdrop_effect = pulp::view::WindowBackdropEffect::liquid_glass;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);

    const auto grown = pt::resize_and_measure_native_content(*host, 560.0f, 410.0f);
    CHECK(std::abs(grown.window_width - 560.0f) <= 1.0f);
    CHECK(std::abs(grown.window_height - 410.0f) <= 1.0f);
    CHECK(std::abs(grown.hosted_width - grown.window_width) <= 1.0f);
    CHECK(std::abs(grown.hosted_height - grown.window_height) <= 1.0f);
    CHECK(std::abs(root.bounds().width - grown.window_width) <= 1.0f);
    CHECK(std::abs(root.bounds().height - grown.window_height) <= 1.0f);

    const auto shrunk = pt::resize_and_measure_native_content(*host, 360.0f, 270.0f);
    CHECK(std::abs(shrunk.hosted_width - shrunk.window_width) <= 1.0f);
    CHECK(std::abs(shrunk.hosted_height - shrunk.window_height) <= 1.0f);
    CHECK(std::abs(root.bounds().width - shrunk.window_width) <= 1.0f);
    CHECK(std::abs(root.bounds().height - shrunk.window_height) <= 1.0f);
}

TEST_CASE("liquid glass host receipt distinguishes transparent Burl paint from an opaque covering root",
          "[mac][platform-harness][window-chrome][liquid-glass][coverage]") {
    View root;
    root.set_bounds({0, 0, 320, 240});
    WindowOptions options;
    options.width = 320;
    options.height = 240;
    options.use_gpu = true;
    options.initially_hidden = true;
    options.transparent = true;
    options.backdrop_effect = pulp::view::WindowBackdropEffect::liquid_glass;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);

    const auto native = pt::inspect_native_backdrop(*host);
    CHECK_FALSE(native.window_opaque);
    CHECK_FALSE(native.hosted_view_opaque);
    CHECK_FALSE(native.hosted_layer_opaque);
    CHECK(std::abs(native.hosted_layer_background_alpha) <= 0.001);
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (__builtin_available(macOS 26.0, *)) {
        CHECK(native.has_glass_effect_view);
        CHECK(native.glass_and_content_share_container);
    }
#endif

    host->repaint();
    const auto transparent_png = pt::capture_settled_back_buffer_png(*host, 3).back().png;
    const auto transparent = pulp::view::analyze_screenshot_content(transparent_png);
    REQUIRE(transparent.valid);
    CAPTURE(transparent.opaque_coverage);
    CHECK(transparent.opaque_coverage < 0.01);

    // Keep the exact same transparent NSWindow, NSGlassEffectView, and
    // CAMetalLayer hierarchy, then reproduce the import failure: one opaque
    // root-sized background is sufficient to hide the platform backdrop.
    root.set_background_color(pulp::view::Color::rgba8(24, 24, 24, 255));
    root.request_repaint();
    host->mark_dirty();
    host->repaint();
    const auto opaque_png = pt::capture_settled_back_buffer_png(*host, 3).back().png;
    const auto opaque = pulp::view::analyze_screenshot_content(opaque_png);
    REQUIRE(opaque.valid);
    CAPTURE(opaque.opaque_coverage);
    CHECK(opaque.opaque_coverage > 0.99);

    const auto unchanged_native = pt::inspect_native_backdrop(*host);
    CHECK(unchanged_native.has_glass_effect_view == native.has_glass_effect_view);
    CHECK(unchanged_native.glass_and_content_share_container ==
          native.glass_and_content_share_container);
    CHECK_FALSE(unchanged_native.window_opaque);
    CHECK_FALSE(unchanged_native.hosted_layer_opaque);
}

TEST_CASE("native content resize honors the source window minimum",
          "[mac][platform-harness][window-chrome][resize][minimum]") {
    View root;
    root.set_bounds({0, 0, 280, 420});
    WindowOptions options;
    options.width = 280;
    options.height = 420;
    options.min_width = 280;
    options.min_height = 420;
    options.resizable = true;
    options.initially_hidden = true;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);

    const auto constrained = pt::resize_and_measure_native_content(*host, 200.0f, 248.0f);
    CHECK(std::abs(constrained.window_width - 280.0f) <= 1.0f);
    CHECK(std::abs(constrained.window_height - 420.0f) <= 1.0f);
    CHECK(std::abs(constrained.hosted_width - 280.0f) <= 1.0f);
    CHECK(std::abs(constrained.hosted_height - 420.0f) <= 1.0f);
    CHECK(std::abs(root.bounds().width - 280.0f) <= 1.0f);
    CHECK(std::abs(root.bounds().height - 420.0f) <= 1.0f);
}

TEST_CASE("synthetic backdrop capture is deterministic and spatially nonuniform",
          "[mac][platform-harness][window-chrome][screenshot]") {
    View root;
    root.set_bounds({0, 0, 320, 240});
    // Semi-transparent content must remain semi-transparent after Graphite
    // records into Dawn's presentable texture. If the swapchain silently uses
    // opaque composite alpha, this red surface hides the checkerboard and the
    // adjacent-region assertion below fails.
    root.set_background_color(pulp::view::Color::rgba8(255, 0, 0, 128));
    WindowOptions options;
    options.use_gpu = true;
    options.initially_hidden = true;
    options.transparent = true;
    options.backdrop_capture_mode = pulp::view::WindowBackdropCaptureMode::synthetic;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);
    const auto presented = pt::capture_settled_back_buffer_png(*host, 3);
    REQUIRE(presented.size() == 3);
    REQUIRE(std::any_of(presented.begin(), presented.end(), [](const auto& frame) {
        return !frame.png.empty();
    }));
    const auto first = pt::capture_composited_content(*host);
    const auto second = pt::capture_composited_content(*host);
    REQUIRE(first.surface == pulp::view::WindowCaptureSurface::framework_synthetic_composited);
    REQUIRE(first.requested_backdrop_mode ==
            pulp::view::WindowBackdropCaptureMode::synthetic);
    REQUIRE(first.includes_host_pixels);
    REQUIRE_FALSE(first.includes_behind_window_backdrop);
    REQUIRE(first.framework_owns_backdrop);
    REQUIRE(first.deterministic);
    REQUIRE_FALSE(first.used_fallback);
    REQUIRE_FALSE(first.png.empty());
    REQUIRE(first.png == second.png);
    if (const char* output_dir = std::getenv("PULP_MAC_COMPOSITED_CAPTURE_DIR")) {
        const fs::path directory(output_dir);
        fs::create_directories(directory);
        REQUIRE(write_binary_file(directory / "synthetic-composited.png", first.png));
        std::ofstream receipt_file(directory / "capture-receipt.json");
        REQUIRE(receipt_file.good());
        receipt_file
            << "{\n"
            << "  \"schemaVersion\": 1,\n"
            << "  \"surface\": \"framework_synthetic_composited\",\n"
            << "  \"requestedBackdropMode\": \"synthetic\",\n"
            << "  \"includesHostPixels\": true,\n"
            << "  \"includesBehindWindowBackdrop\": false,\n"
            << "  \"frameworkOwnsBackdrop\": true,\n"
            << "  \"deterministic\": true,\n"
            << "  \"usedFallback\": false,\n"
            << "  \"repeatByteIdentical\": true,\n"
            << "  \"diagnostic\": \"Dawn/Skia backbuffer composited over framework-owned synthetic backdrop\"\n"
            << "}\n";
    }
    root.set_background_color(pulp::view::Color::rgba8(0, 0, 255, 128));
    host->repaint();
    const auto changed_host_pixels = pt::capture_composited_content(*host);
    REQUIRE(changed_host_pixels.surface ==
            pulp::view::WindowCaptureSurface::framework_synthetic_composited);
    REQUIRE(changed_host_pixels.png != first.png);
    const auto stats = pulp::view::analyze_screenshot_content(first.png);
    REQUIRE(stats.valid);
    REQUIRE(stats.unique_colors >= 2);
    const auto scale = std::max(1u, stats.width / 320u);
    const auto left = pulp::view::crop_png(first.png, 2 * scale, 2 * scale, 16 * scale, 16 * scale);
    const auto adjacent = pulp::view::crop_png(first.png, 26 * scale, 2 * scale, 16 * scale, 16 * scale);
    const auto regions = pulp::view::compare_screenshots(left, adjacent, 0);
    REQUIRE(regions.valid);
    REQUIRE(regions.similarity < 0.1f);
}

TEST_CASE("system backdrop capture never disguises a fallback as composited",
          "[mac][platform-harness][window-chrome][screenshot]") {
    View root;
    root.set_bounds({0, 0, 240, 180});
    root.set_background_color(pulp::view::Color::rgba8(24, 72, 120, 192));
    WindowOptions options;
    options.width = 240;
    options.height = 180;
    options.use_gpu = true;
    options.initially_hidden = true;
    options.transparent = true;
    options.backdrop_capture_mode = pulp::view::WindowBackdropCaptureMode::system;
    auto host = pt::make_test_window(root, options);
    REQUIRE(host != nullptr);

    const auto receipt = pt::capture_composited_content(*host);
    REQUIRE_FALSE(receipt.png.empty());
    REQUIRE(receipt.requested_backdrop_mode ==
            pulp::view::WindowBackdropCaptureMode::system);
    REQUIRE(receipt.includes_host_pixels);
    REQUIRE_FALSE(receipt.framework_owns_backdrop);
    if (receipt.surface == pulp::view::WindowCaptureSurface::system_composited) {
        REQUIRE(receipt.includes_behind_window_backdrop);
        REQUIRE_FALSE(receipt.deterministic);
        REQUIRE_FALSE(receipt.used_fallback);
    } else {
        REQUIRE(receipt.surface == pulp::view::WindowCaptureSurface::host_back_buffer);
        REQUIRE_FALSE(receipt.includes_behind_window_backdrop);
        REQUIRE(receipt.deterministic);
        REQUIRE(receipt.used_fallback);
    }
}

TEST_CASE("macOS liquid glass system capture responds to a live behind-window pattern",
          "[mac][platform-harness][window-chrome][liquid-glass][live-backdrop]") {
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
    if (!__builtin_available(macOS 26.0, *)) {
        SUCCEED("NSGlassEffectView live-backdrop proof requires macOS 26");
        return;
    }
#else
    SUCCEED("SDK does not expose NSGlassEffectView");
    return;
#endif

    struct Pair {
        pulp::view::WindowCaptureReceipt first;
        pulp::view::WindowCaptureReceipt second;
        pt::NativeBackdropSnapshot native;
    };

    const auto capture_pair = [](bool covering_root) {
        View root;
        root.set_bounds({0, 0, 360, 280});
        if (covering_root)
            root.set_background_color(pulp::view::Color::rgba8(24, 24, 24, 255));

        WindowOptions options;
        options.width = 360;
        options.height = 280;
        options.min_width = 360;
        options.min_height = 280;
        options.use_gpu = true;
        options.initially_hidden = true;
        options.transparent = true;
        options.title_bar_style = pulp::view::WindowTitleBarStyle::hidden_inset;
        options.backdrop_effect = pulp::view::WindowBackdropEffect::liquid_glass;
        options.backdrop_state = pulp::view::WindowBackdropState::active;
        options.backdrop_capture_mode = pulp::view::WindowBackdropCaptureMode::system;
        auto host = pt::make_test_window(root, options);
        REQUIRE(host != nullptr);
        auto backdrop = pt::show_live_pattern_backdrop(*host);
        REQUIRE(backdrop != nullptr);

        host->mark_dirty();
        host->repaint();
        const auto settled = pt::capture_settled_back_buffer_png(*host, 3);
        REQUIRE_FALSE(settled.empty());
        REQUIRE_FALSE(settled.back().png.empty());

        Pair pair;
        pair.native = pt::inspect_native_backdrop(*host);
        REQUIRE(backdrop->set_variant(0));
        pair.first = pt::capture_composited_content(*host);
        REQUIRE(backdrop->set_variant(1));
        pair.second = pt::capture_composited_content(*host);
        return pair;
    };

    const Pair transparent = capture_pair(false);
    const Pair opaque = capture_pair(true);
    const auto assert_system_receipt = [](const auto& receipt) {
        REQUIRE(receipt.surface == pulp::view::WindowCaptureSurface::system_composited);
        REQUIRE(receipt.requested_backdrop_mode ==
                pulp::view::WindowBackdropCaptureMode::system);
        REQUIRE(receipt.includes_host_pixels);
        REQUIRE(receipt.includes_behind_window_backdrop);
        REQUIRE_FALSE(receipt.framework_owns_backdrop);
        REQUIRE_FALSE(receipt.deterministic);
        REQUIRE_FALSE(receipt.used_fallback);
        REQUIRE_FALSE(receipt.png.empty());
    };
    assert_system_receipt(transparent.first);
    assert_system_receipt(transparent.second);
    assert_system_receipt(opaque.first);
    assert_system_receipt(opaque.second);

    CHECK_FALSE(transparent.native.window_opaque);
    CHECK(transparent.native.has_glass_effect_view);
    CHECK(transparent.native.glass_and_content_share_container);
    CHECK_FALSE(transparent.native.hosted_view_opaque);
    CHECK_FALSE(transparent.native.hosted_layer_opaque);
    CHECK(std::abs(transparent.native.hosted_layer_background_alpha) <= 0.001);
    CHECK(std::abs(transparent.native.hosted_inset_left) <= 0.5);
    CHECK(std::abs(transparent.native.hosted_inset_top) <= 0.5);
    CHECK(std::abs(transparent.native.hosted_inset_right) <= 0.5);
    CHECK(std::abs(transparent.native.hosted_inset_bottom) <= 0.5);

    const auto stats = pulp::view::analyze_screenshot_content(transparent.first.png);
    REQUIRE(stats.valid);
    REQUIRE(stats.width > 120);
    REQUIRE(stats.height > 120);
    const uint32_t inset_x = stats.width / 6;
    const uint32_t inset_y = stats.height / 5;
    const uint32_t crop_width = stats.width - 2 * inset_x;
    const uint32_t crop_height = stats.height - 2 * inset_y;
    const auto transparent_a = pulp::view::crop_png(
        transparent.first.png, inset_x, inset_y, crop_width, crop_height);
    const auto transparent_b = pulp::view::crop_png(
        transparent.second.png, inset_x, inset_y, crop_width, crop_height);
    const auto opaque_a = pulp::view::crop_png(
        opaque.first.png, inset_x, inset_y, crop_width, crop_height);
    const auto opaque_b = pulp::view::crop_png(
        opaque.second.png, inset_x, inset_y, crop_width, crop_height);
    const auto transparent_delta = pulp::view::compare_screenshots(
        transparent_a, transparent_b, 8);
    const auto opaque_delta = pulp::view::compare_screenshots(opaque_a, opaque_b, 8);
    REQUIRE(transparent_delta.valid);
    REQUIRE(opaque_delta.valid);
    CAPTURE(transparent_delta.similarity,
            transparent_delta.mean_error,
            transparent_delta.diff_pixels,
            opaque_delta.similarity,
            opaque_delta.mean_error,
            opaque_delta.diff_pixels);
    CHECK(transparent_delta.similarity < 0.95f);
    CHECK(transparent_delta.mean_error > 2.0f);
    CHECK(opaque_delta.similarity > 0.995f);
    CHECK(opaque_delta.mean_error < 0.5f);
    CHECK(transparent_delta.diff_pixels > opaque_delta.diff_pixels * 10u);

    if (const char* output_dir = std::getenv("PULP_MAC_GLASS_CAPTURE_DIR")) {
        const fs::path directory(output_dir);
        fs::create_directories(directory);
        REQUIRE(write_binary_file(directory / "transparent-pattern-a.png",
                                  transparent.first.png));
        REQUIRE(write_binary_file(directory / "transparent-pattern-b.png",
                                  transparent.second.png));
        REQUIRE(write_binary_file(directory / "opaque-pattern-a.png", opaque.first.png));
        REQUIRE(write_binary_file(directory / "opaque-pattern-b.png", opaque.second.png));
        REQUIRE(write_binary_file(directory / "transparent-pattern-diff.png",
            pulp::view::generate_diff_image(transparent.first.png,
                                            transparent.second.png, 8)));
        REQUIRE(write_binary_file(directory / "opaque-pattern-diff.png",
            pulp::view::generate_diff_image(opaque.first.png, opaque.second.png, 8)));
        std::ofstream receipt(directory / "live-glass-receipt.json");
        REQUIRE(receipt.good());
        receipt
            << "{\n"
            << "  \"schemaVersion\": 1,\n"
            << "  \"surface\": \"system_composited\",\n"
            << "  \"includesBehindWindowBackdrop\": true,\n"
            << "  \"nativeGlassEffectView\": true,\n"
            << "  \"glassAndBurlContentShareContainer\": true,\n"
            << "  \"hostedInsets\": ["
            << transparent.native.hosted_inset_left << ", "
            << transparent.native.hosted_inset_top << ", "
            << transparent.native.hosted_inset_right << ", "
            << transparent.native.hosted_inset_bottom << "],\n"
            << "  \"transparentPatternSimilarity\": "
            << transparent_delta.similarity << ",\n"
            << "  \"transparentPatternMeanError\": "
            << transparent_delta.mean_error << ",\n"
            << "  \"opaquePatternSimilarity\": "
            << opaque_delta.similarity << ",\n"
            << "  \"opaquePatternMeanError\": "
            << opaque_delta.mean_error << "\n"
            << "}\n";
    }
}
