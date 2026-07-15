#include "scripted_interaction_matrix.hpp"

#include <catch2/catch_test_macros.hpp>
#include <pulp/view/input_events.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/script_engine.hpp>
#include <pulp/view/view.hpp>
#include <pulp/view/widget_bridge.hpp>
#include <pulp/state/store.hpp>

#include <choc/text/choc_JSON.h>

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iterator>
#include <optional>
#include <string>

using namespace pulp::view;
namespace interaction = pulp::test::interaction;
namespace fs = std::filesystem;

namespace {

std::string read_file(const fs::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) return {};
    return {std::istreambuf_iterator<char>(input),
            std::istreambuf_iterator<char>()};
}

Point center_in_root(const View& view, const View& root) {
    Point point{view.bounds().x + view.bounds().width * 0.5f,
                view.bounds().y + view.bounds().height * 0.5f};
    for (auto* parent = view.parent(); parent && parent != &root; parent = parent->parent()) {
        point.x += parent->bounds().x;
        point.y += parent->bounds().y;
    }
    return point;
}

std::optional<int> portable_key_code(std::string_view key) {
    if (key == "Escape") return static_cast<int>(KeyCode::escape);
    if (key == "ArrowUp") return static_cast<int>(KeyCode::up);
    if (key == "ArrowDown") return static_cast<int>(KeyCode::down);
    if (key == "ArrowLeft") return static_cast<int>(KeyCode::left);
    if (key == "ArrowRight") return static_cast<int>(KeyCode::right);
    if (key == "Enter") return static_cast<int>(KeyCode::enter);
    if (key == "Space") return static_cast<int>(KeyCode::space);
    if (key == "Tab") return static_cast<int>(KeyCode::tab);
    return std::nullopt;
}

interaction::StateSnapshot react_state(ScriptEngine& engine) {
    interaction::StateSnapshot state;
    const auto json = engine.evaluate(
        "JSON.stringify(globalThis.__burlMatrixState || {})")
        .getWithDefault<std::string>("{}");
    const auto object = choc::json::parse(json);
    if (!object.isObject()) return state;
    for (std::uint32_t index = 0; index < object.size(); ++index) {
        const auto member = object.getObjectMemberAt(index);
        if (member.value.isString())
            state.emplace(std::string(member.name),
                          member.value.getWithDefault<std::string>(""));
    }
    return state;
}

}  // namespace

TEST_CASE("checked interaction matrix executes through real React Fiber and WidgetBridge",
          "[view][widget-bridge][interaction-matrix][live-react]") {
    const char* bundle_path = std::getenv("PULP_LIVE_REACT_MATRIX_BUNDLE");
    if (!bundle_path || !*bundle_path) {
        SKIP("set PULP_LIVE_REACT_MATRIX_BUNDLE to the esbuild fixture output");
    }
    const fs::path matrix_path = fs::path(PULP_SOURCE_DIR) /
        "evidence/interaction-matrix-harness-v1/generic-menu.matrix.v1.json";
    REQUIRE(matrix_path.filename() == "generic-menu.matrix.v1.json");
    const auto matrix_json = read_file(matrix_path);
    REQUIRE_FALSE(matrix_json.empty());
    std::string parse_error;
    const auto matrix = interaction::parse_scripted_matrix_json(matrix_json, &parse_error);
    CAPTURE(parse_error);
    REQUIRE(matrix.has_value());
    // The checked artifact is the execution source of truth. Re-serialization
    // must be byte-for-byte stable before any backend adapter is allowed to run.
    REQUIRE(interaction::make_scripted_matrix_json(*matrix) == matrix_json.substr(
        0, matrix_json.find_last_not_of("\r\n") + 1));

    View root;
    root.set_bounds({0, 0, 320, 180});
    ScriptEngine engine;
    pulp::state::StateStore store;
    WidgetBridge bridge(engine, root, store);
    const auto bundle = read_file(bundle_path);
    REQUIRE(bundle.size() > 100000);
    // The npm React development/production switch reads process.env even in
    // an IIFE. Pulp's embedded JS engines intentionally do not expose Node;
    // provide only the immutable build-mode capability the browser bundle
    // would receive from its bundler define.
    bridge.load_script(
        "globalThis.process = Object.freeze({env:Object.freeze({NODE_ENV:'production'})});");
    REQUIRE_NOTHROW(bridge.load_script(bundle));
    root.layout_children();

    const auto runtime_json = engine.evaluate(
        "JSON.stringify(globalThis.__burlMatrixRuntime || {})")
        .getWithDefault<std::string>("{}");
    const auto runtime = choc::json::parse(runtime_json);
    CAPTURE(runtime_json);
    REQUIRE(runtime["reactVersion"].isString());
    REQUIRE(runtime["renderer"].getWithDefault<std::string>("") ==
            "@pulp/react-react-reconciler");
    REQUIRE(runtime["hooks"].isArray());
    REQUIRE(runtime["hooks"].size() == 3);
    REQUIRE(runtime["hooks"][0].getWithDefault<std::string>("") == "useState");
    REQUIRE(runtime["hooks"][1].getWithDefault<std::string>("") == "useLayoutEffect");
    REQUIRE(runtime["hooks"][2].getWithDefault<std::string>("") == "useRef");
    REQUIRE(bridge.widget("fixture-menu-trigger") != nullptr);

    interaction::InteractionDriver driver;
    driver.backend = "live-react-widget-bridge";
    driver.resolve = [&](const interaction::ControlSelector& selector)
        -> std::optional<std::string> {
        if (bridge.widget(selector.fixture_id)) return selector.fixture_id;
        return std::nullopt;
    };
    driver.dispatch = [&](const interaction::ScriptedStep& step,
                          const std::optional<std::string>& resolved) {
        if (step.target && !resolved) return false;
        switch (step.operation) {
            case interaction::ScriptedOperation::hover: {
                auto* target = bridge.widget(*resolved);
                if (!target) return false;
                target->set_hovered(true);
                return true;
            }
            case interaction::ScriptedOperation::click: {
                auto* target = bridge.widget(*resolved);
                if (!target) return false;
                root.simulate_click(center_in_root(*target, root));
                return true;
            }
            case interaction::ScriptedOperation::key_down:
            case interaction::ScriptedOperation::key_up: {
                if (!step.key) return false;
                const auto code = portable_key_code(*step.key);
                if (!code) return false;
                WidgetBridge::dispatch_global_key(
                    *code, 0,
                    step.operation == interaction::ScriptedOperation::key_down);
                return true;
            }
            case interaction::ScriptedOperation::outside_click:
                WidgetBridge::dispatch_document_event(
                    "mousedown", "{clientX:-1,clientY:-1,target:null}");
                return true;
        }
        return false;
    };
    driver.settle = [&] {
        bridge.poll_async_results();
        root.layout_children();
        root.request_repaint();
    };
    driver.observe_state = [&] { return react_state(engine); };
    std::size_t capture_index = 0;
    driver.capture_png = [&] {
        auto png = render_to_png(root, 320, 180, 1.0f, ScreenshotBackend::skia);
        if (const char* screenshot_dir =
                std::getenv("PULP_LIVE_REACT_MATRIX_SCREENSHOT_DIR")) {
            fs::create_directories(screenshot_dir);
            std::ostringstream filename;
            filename << "live-react-widget-bridge.capture-"
                     << std::setw(2) << std::setfill('0') << capture_index
                     << ".png";
            std::ofstream output(fs::path(screenshot_dir) / filename.str(),
                                 std::ios::binary);
            output.write(reinterpret_cast<const char*>(png.data()),
                         static_cast<std::streamsize>(png.size()));
            REQUIRE(output.good());
        }
        ++capture_index;
        return png;
    };

    const auto receipt = interaction::run_scripted_matrix(*matrix, driver);
    CAPTURE(interaction::make_scripted_run_json(receipt));
    REQUIRE(receipt.passed);
    REQUIRE(receipt.steps.size() == matrix->steps.size());
    CHECK(capture_index == 9);
    CHECK(receipt.backend == "live-react-widget-bridge");
    CHECK(receipt.steps.front().after.at("callback.count") == "1");
    CHECK(receipt.steps.back().after.at("callback.count") == "8");
    CHECK(receipt.steps.back().before_digest != receipt.steps.back().after_digest);

    if (const char* receipt_path = std::getenv("PULP_LIVE_REACT_MATRIX_RECEIPT")) {
        std::ofstream output(receipt_path);
        output << interaction::make_scripted_run_json(receipt) << '\n';
        REQUIRE(output.good());
    }
    if (const char* runtime_path =
            std::getenv("PULP_LIVE_REACT_MATRIX_RUNTIME_RECEIPT")) {
        const std::vector<std::uint8_t> bundle_bytes(bundle.begin(), bundle.end());
        std::ofstream output(runtime_path);
        output
            << "{\"schema\":\"burl-live-react-runtime-receipt-v1\""
            << ",\"matrixPath\":\"evidence/interaction-matrix-harness-v1/"
               "generic-menu.matrix.v1.json\""
            << ",\"fixturePath\":\"test/fixtures/interaction-matrix/"
               "live-react-widget-bridge.jsx\""
            << ",\"bundleDigest\":"
            << interaction::json_string(interaction::byte_digest(bundle_bytes))
            << ",\"reactVersion\":"
            << interaction::json_string(
                   runtime["reactVersion"].getWithDefault<std::string>(""))
            << ",\"renderer\":\"@pulp/react-react-reconciler\""
            << ",\"hooks\":[\"useState\",\"useLayoutEffect\",\"useRef\"]"
            << ",\"matrixRoundTripStable\":true}"
            << '\n';
        REQUIRE(output.good());
    }
}
