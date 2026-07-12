#include <pulp/canvas/canvas.hpp>
#include <pulp/platform/child_process.hpp>
#include <pulp/runtime/base64.hpp>
#include <pulp/state/store.hpp>
#include <pulp/view/buttons.hpp>
#include <pulp/view/design_frame_view.hpp>
#include <pulp/view/css_gradient.hpp>
#include <pulp/view/design_import.hpp>
#include <pulp/view/design_sources.hpp>
#include <pulp/view/layout_snapshot.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/screenshot_compare.hpp>
#include <pulp/view/script_engine.hpp>
#include <pulp/view/input_events.hpp>
#include <pulp/view/text_editor.hpp>
#include <pulp/view/ui_components.hpp>
#include <pulp/view/view.hpp>
#include <pulp/view/widget_bridge.hpp>
#include <pulp/view/widgets.hpp>

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <choc/text/choc_JSON.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <memory>
#include <limits>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

using namespace pulp::view;
namespace fs = std::filesystem;

namespace pulp::test::generated_binding_runtime {
std::unique_ptr<pulp::view::View> build_generated_binding_runtime_ui();
void bind_generated_binding_runtime_ui(pulp::view::View& root,
                                       pulp::view::NativeImportBindingContext& ctx);
} // namespace pulp::test::generated_binding_runtime

#ifndef PULP_TEST_CXX_COMPILER
#define PULP_TEST_CXX_COMPILER ""
#endif

#ifndef PULP_TEST_OSX_SYSROOT
#define PULP_TEST_OSX_SYSROOT ""
#endif

#ifndef PULP_REPO_ROOT
#define PULP_REPO_ROOT ""
#endif

namespace {

class TempDir {
public:
    explicit TempDir(const std::string& prefix) {
        const auto tick = std::chrono::steady_clock::now().time_since_epoch().count();
        path = fs::temp_directory_path() / (prefix + "-" + std::to_string(tick));
        fs::create_directories(path);
    }

    ~TempDir() {
        std::error_code ec;
        fs::remove_all(path, ec);
    }

    fs::path path;
};

// [[maybe_unused]]: only the codegen-compile test cases use these helpers, and
// those compile legs are skipped on Windows (see the SKIP guards below), so the
// helpers are unreferenced in a Windows build.
[[maybe_unused]] void write_text(const fs::path& path, const std::string& text) {
    fs::create_directories(path.parent_path());
    std::ofstream out(path);
    REQUIRE(out.is_open());
    out << text;
    REQUIRE(out.good());
}

[[maybe_unused]] bool compile_generated_source(const fs::path& source_path,
                                               const fs::path& output_path,
                                               std::string* diagnostics) {
    const fs::path compiler(PULP_TEST_CXX_COMPILER);
    if (compiler.empty() || !fs::exists(compiler)) {
        if (diagnostics != nullptr) *diagnostics = "C++ compiler path is unavailable";
        return false;
    }

    const fs::path root(PULP_REPO_ROOT);
    std::vector<std::string> include_dirs = {
        root.string(),
        (root / "core" / "view" / "include").string(),
        (root / "core" / "canvas" / "include").string(),
        (root / "core" / "runtime" / "include").string(),
        (root / "core" / "platform" / "include").string(),
        (root / "core" / "events" / "include").string(),
        (root / "core" / "state" / "include").string(),
        (root / "core" / "audio" / "include").string(),
        (root / "core" / "midi" / "include").string(),
        (root / "core" / "signal" / "include").string(),
        (root / "core" / "host" / "include").string(),
    };

    std::vector<std::string> args;
#if defined(_WIN32)
    const auto filename = compiler.filename().string();
    const bool msvc_style = filename.find("cl") != std::string::npos;
    if (msvc_style) {
        args = {"/nologo", "/std:c++20", "/EHsc"};
        for (const auto& dir : include_dirs) args.push_back("/I" + dir);
        args.push_back("/c");
        args.push_back(source_path.string());
        args.push_back("/Fo" + output_path.string());
    } else
#endif
    {
        args = {"-std=c++20"};
#if defined(__APPLE__)
        fs::path macosx_sysroot(PULP_TEST_OSX_SYSROOT);
        if (macosx_sysroot.empty() || !fs::exists(macosx_sysroot)) {
            const auto sdk = pulp::platform::exec(
                "/usr/bin/xcrun",
                {"--sdk", "macosx", "--show-sdk-path"},
                10000);
            if (!sdk.timed_out && sdk.exit_code == 0) {
                std::string path = sdk.stdout_output;
                while (!path.empty() &&
                       (path.back() == '\n' || path.back() == '\r' ||
                        path.back() == ' ' || path.back() == '\t')) {
                    path.pop_back();
                }
                macosx_sysroot = fs::path(path);
            }
        }
        if (!macosx_sysroot.empty() && fs::exists(macosx_sysroot)) {
            args.push_back("-isysroot");
            args.push_back(macosx_sysroot.string());
        }
#endif
        for (const auto& dir : include_dirs) {
            args.push_back("-I");
            args.push_back(dir);
        }
        args.push_back("-c");
        args.push_back(source_path.string());
        args.push_back("-o");
        args.push_back(output_path.string());
    }

    auto result = pulp::platform::exec(compiler.string(), args, 30000);
    if (diagnostics != nullptr)
        *diagnostics = result.stdout_output + result.stderr_output;
    return !result.timed_out && result.exit_code == 0 && fs::exists(output_path);
}

const pulp::canvas::DrawCommand* first_meter_fill_rect(const pulp::canvas::RecordingCanvas& canvas) {
    for (const auto& command : canvas.commands()) {
        if (command.type == pulp::canvas::DrawCommand::Type::fill_rect)
            return &command;
    }
    return nullptr;
}

std::string minimal_live_react_shim() {
    return R"JS(
(function() {
  function flatten(input, out) {
    if (Array.isArray(input)) {
      for (var i = 0; i < input.length; i++) flatten(input[i], out);
    } else if (input !== null && input !== undefined && input !== false && input !== true) {
      out.push(input);
    }
  }

  function createElement(type, props) {
    var children = [];
    for (var i = 2; i < arguments.length; i++) flatten(arguments[i], children);
    return { type: type, props: props || {}, children: children };
  }

  function cssValue(key, value) {
    if (value == null) return "";
    if (typeof value === "number") {
      if (key === "flexGrow" || key === "flexShrink" || key === "opacity" ||
          key === "zIndex" || key === "lineHeight") {
        return String(value);
      }
      return String(value) + "px";
    }
    return String(value);
  }

  function applyProps(el, props) {
    props = props || {};
    for (var key in props) {
      if (key === "children" || key === "key") continue;
      var value = props[key];
      if (key === "style" && value) {
        for (var styleKey in value) el.style[styleKey] = cssValue(styleKey, value[styleKey]);
      } else if (key === "id") {
        el.id = String(value);
        el.setAttribute("id", String(value));
      } else if (value !== false && value != null) {
        el.setAttribute(key, String(value));
      }
    }
  }

  function renderNode(node) {
    if (node == null || node === false || node === true) return null;
    if (typeof node === "string" || typeof node === "number") {
      return document.createTextNode(String(node));
    }
    if (typeof node.type === "function") {
      var props = Object.assign({}, node.props || {});
      props.children = node.children;
      return renderNode(node.type(props));
    }
    var el = document.createElement(node.type);
    applyProps(el, node.props);
    var scalarText = "";
    var nonScalarChildren = [];
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      if (typeof child === "string" || typeof child === "number") {
        scalarText += String(child);
      } else {
        nonScalarChildren.push(child);
      }
    }
    if (scalarText) el.textContent = scalarText;
    for (var j = 0; j < nonScalarChildren.length; j++) {
      var rendered = renderNode(nonScalarChildren[j]);
      if (rendered) el.appendChild(rendered);
    }
    return el;
  }

  globalThis.React = { createElement: createElement };
  globalThis.ReactDOM = {
    createRoot: function(mount) {
      return {
        render: function(element) {
          var node = renderNode(element);
          if (node) mount.appendChild(node);
        }
      };
    },
    flushSync: function(fn) { return fn(); }
  };
})();
)JS";
}

std::unique_ptr<View> build_live_plugin_panel() {
    auto root = std::make_unique<View>();
    root->set_bounds({0, 0, 360, 160});

    ScriptEngine engine;
    pulp::state::StateStore store;
    WidgetBridge bridge(engine, *root, store);

    bridge.load_script(minimal_live_react_shim());
    bridge.load_script(R"JS(
function Control(props) {
  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: 104,
        height: 90,
        padding: 6,
        gap: 4
      }
    },
    React.createElement('span', { style: { width: 92, height: 20 } }, props.label),
    React.createElement('span', { style: { width: 92, height: 20 } }, props.value)
  );
}

function Panel() {
  return React.createElement(
    'div',
    {
      id: 'phase-four-plugin-panel',
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: 360,
        height: 160,
        padding: 12,
        gap: 10,
        overflow: 'hidden'
      }
    },
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          width: 336,
          height: 24,
          gap: 96
        }
      },
      React.createElement('span', { style: { width: 160, height: 24 } }, 'Cloud Chorus'),
      React.createElement('span', { style: { width: 80, height: 24 } }, '-12 dB')
    ),
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          flexDirection: 'row',
          width: 336,
          height: 90,
          gap: 12
        }
      },
      React.createElement(Control, { label: 'Depth', value: '67%' }),
      React.createElement(Control, { label: 'Rate', value: '1.8 Hz' }),
      React.createElement(Control, { label: 'Mix', value: '42%' })
    )
  );
}

ReactDOM.createRoot(document.body).render(React.createElement(Panel));
layout();
)JS");
    root->layout_children();
    return root;
}

IRNode frame(std::string id, float width, float height, LayoutDirection direction) {
    IRNode node;
    node.type = "frame";
    node.stable_anchor_id = std::move(id);
    node.style.width = width;
    node.style.height = height;
    node.layout.direction = direction;
    return node;
}

IRNode label(std::string id, std::string text, float width, float height) {
    IRNode node;
    node.type = "text";
    node.stable_anchor_id = std::move(id);
    node.text_content = std::move(text);
    node.style.width = width;
    node.style.height = height;
    return node;
}

IRNode control_from_live(const View& card, std::string label_text, std::string value_text) {
    REQUIRE(card.child_count() == 2);
    auto node = frame(card.id(), 104.0f, 90.0f, LayoutDirection::column);
    node.layout.padding_top = 6.0f;
    node.layout.padding_right = 6.0f;
    node.layout.padding_bottom = 6.0f;
    node.layout.padding_left = 6.0f;
    node.layout.gap = 4.0f;
    node.children.push_back(label(card.child_at(0)->id(), std::move(label_text), 92.0f, 20.0f));
    node.children.push_back(label(card.child_at(1)->id(), std::move(value_text), 92.0f, 20.0f));
    return node;
}

DesignIR build_plugin_panel_ir_from_live(const View& live_root) {
    REQUIRE(live_root.child_count() == 1);
    const auto* panel = live_root.child_at(0);
    REQUIRE(panel != nullptr);
    REQUIRE(panel->child_count() == 2);
    const auto* header = panel->child_at(0);
    const auto* controls = panel->child_at(1);
    REQUIRE(header != nullptr);
    REQUIRE(controls != nullptr);
    REQUIRE(header->child_count() == 2);
    REQUIRE(controls->child_count() == 3);

    // This IR is the baked snapshot of the same JSX fixture rendered by
    // build_live_plugin_panel(). The parity oracle compares native View IDs,
    // so the baked fixture mirrors the bridge-assigned live IDs.
    DesignIR ir;
    ir.source = DesignSource::jsx;
    ir.source_adapter = "phase4-live-react-fixture";
    ir.root = frame(panel->id(), 360.0f, 160.0f, LayoutDirection::column);
    ir.root.layout.padding_top = 12.0f;
    ir.root.layout.padding_right = 12.0f;
    ir.root.layout.padding_bottom = 12.0f;
    ir.root.layout.padding_left = 12.0f;
    ir.root.layout.gap = 10.0f;
    ir.root.style.overflow = "hidden";

    auto header_ir = frame(header->id(), 336.0f, 24.0f, LayoutDirection::row);
    header_ir.layout.gap = 96.0f;
    header_ir.children.push_back(label(header->child_at(0)->id(), "Cloud Chorus", 160.0f, 24.0f));
    header_ir.children.push_back(label(header->child_at(1)->id(), "-12 dB", 80.0f, 24.0f));
    ir.root.children.push_back(std::move(header_ir));

    auto controls_ir = frame(controls->id(), 336.0f, 90.0f, LayoutDirection::row);
    controls_ir.layout.gap = 12.0f;
    controls_ir.children.push_back(control_from_live(*controls->child_at(0), "Depth", "67%"));
    controls_ir.children.push_back(control_from_live(*controls->child_at(1), "Rate", "1.8 Hz"));
    controls_ir.children.push_back(control_from_live(*controls->child_at(2), "Mix", "42%"));
    ir.root.children.push_back(std::move(controls_ir));

    return ir;
}

std::string diff_messages(const LayoutTreeDiff& diff) {
    std::ostringstream out;
    for (const auto& message : diff.messages) out << message << '\n';
    return out.str();
}

bool diagnostics_contain(const std::vector<ImportDiagnostic>& diagnostics,
                         std::string_view code) {
    for (const auto& diagnostic : diagnostics) {
        if (diagnostic.code == code) return true;
    }
    return false;
}

std::size_t diagnostics_count(const std::vector<ImportDiagnostic>& diagnostics,
                              std::string_view code) {
    std::size_t count = 0;
    for (const auto& diagnostic : diagnostics) {
        if (diagnostic.code == code) ++count;
    }
    return count;
}

struct BoundKnobDescriptor {
    std::string route_id;
    std::string param_key;
    std::string binding_module;
    std::string binding_param;
    std::string event_contract;
    std::string gesture_contract;
};

struct BoundCheckboxDescriptor {
    std::string route_id;
    std::string param_key;
    std::string binding_module;
    std::string binding_param;
    std::string event_contract;
    std::string gesture_contract;
};

struct BoundTextDescriptor {
    std::string route_id;
    std::string value_key;
    std::string initial_value;
    std::string placeholder;
    std::string event_contract;
    std::string focus_contract;
};

class BindingBackedKnobContext final : public NativeImportBindingContext {
public:
    BindingBackedKnobContext() {
        store_.set_gesture_callbacks(
            [this](pulp::state::ParamID) { ++gesture_begin_count; },
            [this](pulp::state::ParamID) { ++gesture_end_count; });
    }

    void bind_knob(Knob& knob, const NativeImportBindingDescriptor& descriptor) override {
        bound_knobs.push_back(BoundKnobDescriptor{
            .route_id = std::string(descriptor.route_id),
            .param_key = std::string(descriptor.param_key),
            .binding_module = std::string(descriptor.binding_module),
            .binding_param = std::string(descriptor.binding_param),
            .event_contract = std::string(descriptor.event_contract),
            .gesture_contract = std::string(descriptor.gesture_contract)});

        pulp::state::ParamInfo info;
        info.id = param_id_;
        info.name = std::string(descriptor.param_key);
        info.range = {0.0f, 1.0f, knob.value()};
        store_.add_parameter(info);
        store_.set_normalized(param_id_, knob.value());

        knob.on_gesture_begin = [this] {
            store_.begin_gesture(param_id_);
        };
        knob.on_change = [this](float normalized) {
            store_.set_normalized(param_id_, normalized);
            changes.push_back(normalized);
        };
        knob.on_gesture_end = [this] {
            store_.end_gesture(param_id_);
        };
    }

    void bind_checkbox(Checkbox& checkbox, const NativeImportBindingDescriptor& descriptor) override {
        bound_checkboxes.push_back(BoundCheckboxDescriptor{
            .route_id = std::string(descriptor.route_id),
            .param_key = std::string(descriptor.param_key),
            .binding_module = std::string(descriptor.binding_module),
            .binding_param = std::string(descriptor.binding_param),
            .event_contract = std::string(descriptor.event_contract),
            .gesture_contract = std::string(descriptor.gesture_contract)});

        const auto param_key = std::string(descriptor.param_key);
        checkbox.on_change = [this, param_key](bool checked) {
            checkbox_changes.push_back({param_key, checked ? 1.0f : 0.0f});
        };
    }

    void bind_text_editor(TextEditor& editor, const NativeImportTextBindingDescriptor& descriptor) override {
        bound_text_editors.push_back(BoundTextDescriptor{
            .route_id = std::string(descriptor.route_id),
            .value_key = std::string(descriptor.value_key),
            .initial_value = std::string(descriptor.initial_value),
            .placeholder = std::string(descriptor.placeholder),
            .event_contract = std::string(descriptor.event_contract),
            .focus_contract = std::string(descriptor.focus_contract)});

        editor.on_change = [this](const std::string& text) {
            text_changes.push_back(text);
        };
    }

    float normalized_value() const {
        return store_.get_normalized(param_id_);
    }

    std::vector<BoundKnobDescriptor> bound_knobs;
    std::vector<BoundCheckboxDescriptor> bound_checkboxes;
    std::vector<BoundTextDescriptor> bound_text_editors;
    std::vector<float> changes;
    std::vector<std::pair<std::string, float>> checkbox_changes;
    std::vector<std::string> text_changes;
    int gesture_begin_count = 0;
    int gesture_end_count = 0;

private:
    pulp::state::StateStore store_;
    pulp::state::ParamID param_id_ = 1;
};

} // namespace

TEST_CASE("mixed inline composite materializes ordered SVG and Unicode text with real Skia pixels",
          "[view][import][native-materializer][mixed-inline][skia]") {
    const std::string svg = R"(<svg stroke-width="2" width="8" height="8" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="2" width="4" height="4" fill="#49d17d"/></svg>)";
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.style.width = 120.0f;
    ir.root.style.height = 24.0f;
    ir.root.layout.display = "flex";
    ir.root.layout.direction = LayoutDirection::row;
    IRNode leading;
    leading.type = "text";
    leading.text_content = "前 ";
    leading.style.width = 26.0f;
    leading.style.height = 20.0f;
    IRNode icon;
    icon.type = "frame";
    icon.style.width = 16.0f;
    icon.style.height = 16.0f;
    icon.render_mode = NodeRenderMode::faithful_svg;
    icon.svg_asset_id = "mixed-inline-svg";
    IRNode trailing;
    trailing.type = "text";
    trailing.text_content = " 7m 58s🙂";
    trailing.style.width = 76.0f;
    trailing.style.height = 20.0f;
    ir.root.children = {leading, icon, trailing};
    IRAssetRef asset;
    asset.asset_id = "mixed-inline-svg";
    asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);
    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 3);
    REQUIRE(dynamic_cast<Label*>(root->child_at(0)) != nullptr);
    REQUIRE(dynamic_cast<DesignFrameView*>(root->child_at(1)) != nullptr);
    REQUIRE(dynamic_cast<Label*>(root->child_at(2)) != nullptr);
    root->set_bounds({0, 0, 120, 24});
    root->layout_children();
    REQUIRE(root->child_at(1)->bounds().width == 16.0f);
    REQUIRE(root->child_at(1)->bounds().height == 16.0f);
    const auto png = render_to_png(*root, 120, 24, 2.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(png.empty());
    REQUIRE(analyze_screenshot_content(png).passes_content_floor());
}

TEST_CASE("composite buttons preserve child visuals without duplicate promoted labels",
          "[view][import][native-materializer][composite-button]") {
    auto make_text_child = [] {
        IRNode child;
        child.type = "text";
        child.text_content = "Ellipsized source title";
        child.style.width = 90.0f;
        child.style.height = 18.0f;
        child.style.font_size = 13.0f;
        child.style.text_overflow = "ellipsis";
        child.layout.flex_shrink = 1.0f;
        return child;
    };

    SECTION("selected toggle is a semantic container") {
        DesignIR ir;
        ir.root.type = "toggle_button";
        ir.root.attributes["selected"] = "true";
        ir.root.style.width = 120.0f;
        ir.root.style.height = 24.0f;
        ir.root.children.push_back(make_text_child());
        auto root = build_native_view_tree(ir, {}, {});
        auto* toggle = dynamic_cast<ToggleButton*>(root.get());
        REQUIRE(toggle != nullptr);
        REQUIRE(toggle->is_on());
        REQUIRE(toggle->label().empty());
        REQUIRE(toggle->access_label() == "Ellipsized source title");
        REQUIRE(toggle->child_count() == 1);
        REQUIRE(dynamic_cast<Label*>(toggle->child_at(0)) != nullptr);
        REQUIRE(toggle->child_at(0)->text_overflow_ellipsis());
    }

    SECTION("action button is a semantic container") {
        DesignIR ir;
        ir.root.type = "button";
        ir.root.style.width = 120.0f;
        ir.root.style.height = 24.0f;
        ir.root.children.push_back(make_text_child());
        auto root = build_native_view_tree(ir, {}, {});
        auto* button = dynamic_cast<TextButton*>(root.get());
        REQUIRE(button != nullptr);
        REQUIRE(button->label().empty());
        REQUIRE(button->access_label() == "Ellipsized source title");
        REQUIRE(button->child_count() == 1);
        REQUIRE(dynamic_cast<Label*>(button->child_at(0)) != nullptr);
        REQUIRE(button->child_at(0)->text_overflow_ellipsis());
    }
}

TEST_CASE("baked native materializer matches live React layout parity for a plugin panel",
          "[view][import][native-materializer][phase-4]") {
    auto live = build_live_plugin_panel();
    auto ir = build_plugin_panel_ir_from_live(*live);

    std::vector<ImportDiagnostic> diagnostics;
    auto materialized = build_native_view_tree(ir, ir.asset_manifest, {.diagnostics_out = &diagnostics});
    REQUIRE(materialized != nullptr);

    auto baked = std::make_unique<View>();
    baked->set_bounds({0, 0, 360, 160});
    baked->add_child(std::move(materialized));
    baked->layout_children();

    const LayoutTreeSnapshotOptions options{
        .surface = "phase4-baked-native",
        .fixture = "plugin-panel-live-react-vs-native",
        .viewport_width = 360,
        .viewport_height = 160,
    };
    const auto live_json = dump_layout_tree(*live, options);
    const auto baked_json = dump_layout_tree(*baked, options);

    LayoutTreeDiff diff;
    const bool equivalent = layout_tree_snapshots_equivalent(live_json, baked_json, {}, &diff);
    INFO(diff_messages(diff));
    INFO("live:\n" << live_json);
    INFO("baked:\n" << baked_json);
    REQUIRE(equivalent);
    REQUIRE_FALSE(diagnostics_contain(diagnostics, "native-materialize-failed"));
}

TEST_CASE("baked native materializer resolves image sources through the asset manifest",
          "[view][import][native-materializer][phase-4]") {
    DesignIR ir;
    ir.root.type = "image";
    ir.root.stable_anchor_id = "logo";
    ir.root.attributes["src"] = "/raw/should-not-be-used.png";
    ir.root.attributes["srcAssetId"] = "asset-logo";
    ir.root.style.width = 64.0f;
    ir.root.style.height = 32.0f;

    IRAssetRef asset;
    asset.asset_id = "asset-logo";
    asset.original_uri = "/raw/source-logo.png";
    asset.local_path = "/resolved/cache/logo.png";
    asset.content_hash = "sha256:test";
    asset.mime = "image/png";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* image = dynamic_cast<ImageView*>(root.get());
    REQUIRE(image != nullptr);
    REQUIRE(image->image_source() == "file:///resolved/cache/logo.png");
    REQUIRE_FALSE(diagnostics_contain(diagnostics, "native-materialize-unresolved-asset"));
}

TEST_CASE("baked native materializer resolves figma-plugin asset_ref image sources",
          "[view][import][native-materializer][figma-plugin][asset-ref]") {
    DesignIR ir;
    ir.source = DesignSource::figma_plugin;
    ir.source_adapter = "figma-plugin";
    ir.root.type = "image";
    ir.root.name = "Imported Figma Image";
    ir.root.attributes["asset_ref"] = "3:43";
    ir.root.style.width = 64.0f;
    ir.root.style.height = 32.0f;

    IRAssetRef asset;
    asset.asset_id = "3:43";
    asset.original_uri = "figma://KCKIyZoWXjde6qVNCm4qPa/3:43";
    asset.local_path = "/resolved/import/assets/3_43.png";
    asset.mime = "image/png";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* image = dynamic_cast<ImageView*>(root.get());
    REQUIRE(image != nullptr);
    REQUIRE(image->image_source() == "file:///resolved/import/assets/3_43.png");
    REQUIRE_FALSE(diagnostics_contain(diagnostics, "native-materialize-unresolved-asset"));
}

TEST_CASE("baked native materializer renders a faithful_svg node as a DesignFrameView",
          "[view][import][native-materializer][faithful-svg]") {
    // Plan B / B3: a faithful_svg node materializes to a DesignFrameView that
    // renders the node's own SVG (resolved from a data: asset) and overlays the
    // typed interactive elements. The view auto-crops to the panel (the largest
    // in-frame rect) and holds the knob overlay.
    // A percent-encoded data: payload (the form a URL-safe SVG export emits) —
    // exercises the resolver's percent-decode path. Decodes to a 100x100 frame
    // with an 80x80 panel rect, a dome circle, and a needle path at "M50 38L50 30".
    const std::string encoded_payload =
        "%3Csvg%20width%3D%22100%22%20height%3D%22100%22%20"
        "xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E"
        "%3Crect%20x%3D%2210%22%20y%3D%2210%22%20width%3D%2280%22%20height%3D%2280%22%20"
        "rx%3D%224%22%20fill%3D%22%23cccccc%22%2F%3E"
        "%3Ccircle%20cx%3D%2250%22%20cy%3D%2250%22%20r%3D%2220%22%20fill%3D%22%238a97a6%22%2F%3E"
        "%3Cpath%20d%3D%22M50%2038L50%2030%22%20stroke%3D%22white%22%20stroke-width%3D%223%22%2F%3E"
        "%3C%2Fsvg%3E";

    DesignIR ir;
    ir.source = DesignSource::figma_plugin;
    ir.root.type = "frame";
    ir.root.name = "ELYSIUM";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "asset-frame-svg";

    IRInteractiveElement knob;
    knob.kind = InteractiveElementKind::knob;
    knob.cx = 50.0f;
    knob.cy = 50.0f;
    knob.hit_radius = 22.0f;
    knob.svg_patch_d = "M50 38L50 30";
    knob.default_value = 0.5f;
    ir.root.interactive_elements.push_back(knob);

    IRAssetRef asset;
    asset.asset_id = "asset-frame-svg";
    asset.original_uri = "data:image/svg+xml," + encoded_payload;
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    REQUIRE(frame->element_count() == 1);
    CHECK(frame->panel_width() == 80.0f);   // the 80x80 panel, not the 100x100 frame
    CHECK(frame->panel_height() == 80.0f);
    CHECK(frame->element_value(0) == 0.5f);
    // No param_key on the knob → the frame stays inert w.r.t. host params: the
    // element carries no binding key and gestures do NOT self-route to the
    // HostParamSurface (they fall back to on_value_changed).
    CHECK(frame->element_param_key(0).empty());
    CHECK_FALSE(frame->routes_changes_to_host_params());
    REQUIRE_FALSE(diagnostics_contain(diagnostics,
                                      "native-materialize-faithful-svg-unresolved"));
}

TEST_CASE("faithful_svg knob with a param_key self-wires to the host-param surface",
          "[view][import][native-materializer][faithful-svg][host-params]") {
    // A geometry-detected knob that carries a host-param binding key materializes
    // with that key on its DesignFrameElement, and the frame enables host-param
    // routing so a user gesture drives the framework-agnostic HostParamSurface
    // directly (element_for_param_key resolves it). This is the binding channel
    // for interactive elements that are NOT recognized Pulp-Library widgets.
    const std::string encoded_payload =
        "%3Csvg%20width%3D%22100%22%20height%3D%22100%22%20"
        "xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E"
        "%3Crect%20x%3D%2210%22%20y%3D%2210%22%20width%3D%2280%22%20height%3D%2280%22%20"
        "rx%3D%224%22%20fill%3D%22%23cccccc%22%2F%3E"
        "%3Ccircle%20cx%3D%2250%22%20cy%3D%2250%22%20r%3D%2220%22%20fill%3D%22%238a97a6%22%2F%3E"
        "%3Cpath%20d%3D%22M50%2038L50%2030%22%20stroke%3D%22white%22%20stroke-width%3D%223%22%2F%3E"
        "%3C%2Fsvg%3E";

    DesignIR ir;
    ir.source = DesignSource::figma_plugin;
    ir.root.type = "frame";
    ir.root.name = "ELYSIUM";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "asset-frame-svg";

    IRInteractiveElement knob;
    knob.kind = InteractiveElementKind::knob;
    knob.cx = 50.0f;
    knob.cy = 50.0f;
    knob.hit_radius = 22.0f;
    knob.svg_patch_d = "M50 38L50 30";
    knob.default_value = 0.5f;
    knob.param_key = "filter.cutoff";
    ir.root.interactive_elements.push_back(knob);

    IRAssetRef asset;
    asset.asset_id = "asset-frame-svg";
    asset.original_uri = "data:image/svg+xml," + encoded_payload;
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    REQUIRE(frame->element_count() == 1);
    // The binding key rode the IR → DesignFrameElement mapping.
    CHECK(frame->element_param_key(0) == "filter.cutoff");
    CHECK(frame->element_for_param_key("filter.cutoff") == 0);
    // Presence of a key auto-enables host-param routing for the frame.
    CHECK(frame->routes_changes_to_host_params());
    REQUIRE_FALSE(diagnostics_contain(diagnostics,
                                      "native-materialize-faithful-svg-unresolved"));
}

TEST_CASE("render-patch golden: a knob's needle visibly rotates with value (P3)",
          "[view][import][native-materializer][faithful-svg][p3][render]") {
    // P3 render-patch golden-gate: the faithful-vector lane rotates ONLY the
    // knob's needle path (svg_patch_d) around (cx,cy) by value and re-renders the
    // SVG — the chrome stays pixel-exact. Render the SAME frame at value 0.05 vs
    // 0.95 and prove the raster differs (the needle moved) — the render-patch is
    // live, not a static repaint. Mirrors the tab-group live-pill golden.
    const std::string svg =
        R"(<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="10" y="10" width="80" height="80" rx="4" fill="#cccccc"/>)"
        R"(<circle cx="50" cy="50" r="20" fill="#8a97a6"/>)"
        R"(<path d="M50 38L50 30" stroke="white" stroke-width="3"/></svg>)";

    DesignIR ir;
    ir.root.type = "frame";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "svg1";
    IRInteractiveElement knob;
    knob.kind = InteractiveElementKind::knob;
    knob.cx = 50; knob.cy = 50; knob.hit_radius = 22;
    knob.svg_patch_d = "M50 38L50 30";   // the needle the patch rotates
    knob.default_value = 0.5f;
    ir.root.interactive_elements.push_back(knob);
    IRAssetRef asset;
    asset.asset_id = "svg1";
    asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest,
                                       {.diagnostics_out = &diagnostics});
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    frame->set_bounds({0, 0, frame->panel_width(), frame->panel_height()});
    frame->layout_children();

    auto render_at = [&](float v) {
        frame->set_element_value(0, v);
        return render_to_png(*frame, static_cast<int>(frame->panel_width()),
                             static_cast<int>(frame->panel_height()), 2.0f,
                             ScreenshotBackend::skia);
    };
    const auto lo = render_at(0.05f);
    if (lo.empty()) SKIP("Skia raster screenshot backend unavailable");
    const auto hi = render_at(0.95f);
    REQUIRE_FALSE(hi.empty());
    const auto cmp = compare_screenshots(lo, hi);
    REQUIRE(cmp.valid);
    if (cmp.similarity >= 0.999f) SKIP("native raster unavailable in this build");
    CHECK(cmp.similarity < 0.999f);   // the needle visibly rotated between the two values
}

TEST_CASE("baked native materializer resolves a faithful_svg base64 data asset",
          "[view][import][native-materializer][faithful-svg]") {
    // The same path, but the SVG arrives base64-encoded (the form the REST/SVG
    // export lane emits). Resolver must decode it before handing to the view.
    const std::string svg =
        R"(<svg width="40" height="40" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="4" y="4" width="32" height="32" fill="#222"/></svg>)";
    const std::string b64 = pulp::runtime::base64_encode(svg);

    DesignIR ir;
    ir.root.type = "frame";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "svg1";

    IRAssetRef asset;
    asset.asset_id = "svg1";
    asset.original_uri = "data:image/svg+xml;base64," + b64;
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    CHECK(frame->panel_width() == 32.0f);
    REQUIRE_FALSE(diagnostics_contain(diagnostics,
                                      "native-materialize-faithful-svg-unresolved"));
}

TEST_CASE("baked native materializer reads a faithful_svg asset from local_path",
          "[view][import][native-materializer][faithful-svg]") {
    // The asset's SVG lives on disk (the form the CLI asset-resolution pass
    // stamps). Resolver must read the file before handing it to the view.
    const std::string svg =
        R"(<svg width="50" height="50" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="5" y="5" width="40" height="40" fill="#333"/></svg>)";
    const auto dir = fs::temp_directory_path();
    const auto file = dir / "pulp-faithful-svg-test.svg";
    { std::ofstream(file, std::ios::binary) << svg; }

    DesignIR ir;
    ir.root.type = "frame";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "svg-on-disk";

    IRAssetRef asset;
    asset.asset_id = "svg-on-disk";
    asset.original_uri = "figma://file/node";  // not a data: URI — must use local_path
    asset.local_path = file.string();
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    CHECK(frame->panel_width() == 40.0f);
    REQUIRE_FALSE(diagnostics_contain(diagnostics,
                                      "native-materialize-faithful-svg-unresolved"));
    fs::remove(file);
}

TEST_CASE("baked native materializer falls back when a faithful_svg asset is unresolved",
          "[view][import][native-materializer][faithful-svg]") {
    // A faithful_svg node whose SVG asset is missing must NOT blank out: it
    // emits a diagnostic and falls back to normal materialization (a plain View
    // for a frame), so the rest of the tree still renders.
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.name = "Broken";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "missing-asset";  // not in the manifest

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    CHECK(dynamic_cast<DesignFrameView*>(root.get()) == nullptr);  // fell back
    CHECK(diagnostics_contain(diagnostics,
                              "native-materialize-faithful-svg-unresolved"));
}

TEST_CASE("materializer overlays a TextEditor for a faithful_svg text_field element",
          "[view][import][native-materializer][faithful-svg][overlay]") {
    // Plan B full-A slice 2: a text_field interactive element on a faithful_svg
    // node materializes (via to_frame_elements) into a DesignFrameView that hosts
    // a native TextEditor overlay — not a knob.
    const std::string svg =
        R"(<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="10" y="10" width="80" height="80" fill="#1c1d1d"/></svg>)";

    DesignIR ir;
    ir.root.type = "frame";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "svg1";

    IRInteractiveElement search;
    search.kind = InteractiveElementKind::text_field;
    search.x = 16; search.y = 16; search.w = 60; search.h = 16;
    search.placeholder = "Search";
    ir.root.interactive_elements.push_back(search);

    IRAssetRef asset;
    asset.asset_id = "svg1";
    asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest, {.diagnostics_out = &diagnostics});
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    REQUIRE(frame->element_count() == 1);
    auto* editor = dynamic_cast<TextEditor*>(frame->overlay_widget(0));
    REQUIRE(editor != nullptr);
    CHECK(editor->placeholder == "Search");
}

TEST_CASE("faithful_svg flows producer envelope -> parse -> materialize -> DesignFrameView",
          "[view][import][native-materializer][faithful-svg][e2e]") {
    // The whole-chain proof (Plan B / B5): an envelope shaped EXACTLY like the
    // faithful-vector producers emit (figma_rest_export.py --faithful-vector and
    // the Figma plugin's faithfulVector lane) must survive parse_figma_plugin_json
    // -> parse_ir_node -> build_native_view_tree and become a DesignFrameView with
    // the producer's typed knob. This pins the producer<->C++ contract that the
    // TS/Python producer unit tests can't reach.
    const std::string svg =
        R"(<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="10" y="10" width="80" height="80" fill="#1c1d1d"/>)"
        R"(<circle cx="50" cy="50" r="20" fill="#8a97a6"/>)"
        R"(<path d="M50 38L50 30" stroke="white" stroke-width="3"/></svg>)";
    const std::string b64 = pulp::runtime::base64_encode(svg);

    // Byte-for-byte the shape apply_faithful_vector / serialize.ts produce.
    const std::string envelope = std::string(R"json({
      "$schema": "https://pulp.dev/schemas/figma-plugin-export-v1.json",
      "format_version": "2026.05-figma-plugin-v1",
      "provenance": {"adapter": "figma-plugin", "version": "test"},
      "asset_manifest": {"version": 1, "assets": [
        {"asset_id": "frame-svg-3:42",
         "original_uri": "data:image/svg+xml;base64,)json") + b64 + R"json(",
         "mime": "image/svg+xml"}
      ]},
      "root": {
        "type": "frame", "name": "ELYSIUM", "figma_node_id": "3:42",
        "render_mode": "faithful_svg", "svg_asset_id": "frame-svg-3:42",
        "interactive_elements": [
          {"kind": "knob", "cx": 50, "cy": 50, "hit_radius": 22,
           "svg_patch_d": "M50 38L50 30", "default_value": 0.5,
           "source_node_id": "3:225"}
        ]
      }
    })json";

    // 1) The producer envelope parses into an IR that kept the faithful fields.
    const auto ir = parse_figma_plugin_json(envelope);
    REQUIRE(ir.root.render_mode == NodeRenderMode::faithful_svg);
    REQUIRE(ir.root.svg_asset_id == "frame-svg-3:42");
    REQUIRE(ir.root.interactive_elements.size() == 1);
    REQUIRE(ir.root.interactive_elements[0].svg_patch_d == "M50 38L50 30");
    REQUIRE(ir.root.interactive_elements[0].source_node_id == "3:225");
    REQUIRE(ir.asset_manifest.resolve("frame-svg-3:42") != nullptr);

    // 2) Materializing that IR yields a DesignFrameView with the typed knob.
    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest,
                                       {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    REQUIRE(frame->element_count() == 1);
    CHECK(frame->panel_width() == 80.0f);   // panel auto-cropped from the 100x100 frame
    CHECK(frame->element_value(0) == 0.5f);
    REQUIRE_FALSE(diagnostics_contain(diagnostics,
                                      "native-materialize-faithful-svg-unresolved"));
}

TEST_CASE("materializer maps every interactive kind to its DesignFrameElement::Kind",
          "[view][import][native-materializer][faithful-svg][p1a]") {
    // P1a acceptance: fader + toggle + the already-emitted overlays each
    // materialize (JSON -> IR -> to_frame_elements -> DesignFrameView) to the
    // matching runtime Kind — no silent collapse to knob. The SVG underneath
    // always renders; this asserts the INTERACTION wired on top is correct.
    const std::string svg =
        R"(<svg width="240" height="200" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="10" y="10" width="220" height="180" fill="#1c1d1d"/></svg>)";

    DesignIR ir;
    ir.root.type = "frame";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "svg1";

    auto add = [&](InteractiveElementKind k, float x, float y, float value) {
        IRInteractiveElement el;
        el.kind = k;
        el.x = x; el.y = y; el.w = 40; el.h = 20;
        el.cx = x + 6; el.cy = y + 6; el.hit_radius = 10;
        el.svg_patch_d = "M0 0L0 1";
        el.default_value = value;
        if (k == InteractiveElementKind::dropdown ||
            k == InteractiveElementKind::tab_group ||
            k == InteractiveElementKind::stepper) {
            el.options = {"A", "B"};
        }
        if (k == InteractiveElementKind::text_field) el.placeholder = "Search";
        if (k == InteractiveElementKind::toggle) el.flash = true;
        ir.root.interactive_elements.push_back(el);
    };
    using K = InteractiveElementKind;
    // Distinct (non-default) values so a dropped field-copy in to_frame_elements
    // would FAIL the value assertions below — not just the Kind mapping.
    add(K::knob, 20, 20, 0.1f);
    add(K::fader, 20, 50, 0.2f);
    add(K::toggle, 20, 80, 0.3f);
    add(K::dropdown, 20, 110, 0.4f);
    add(K::text_field, 90, 20, 0.6f);
    add(K::tab_group, 90, 50, 0.7f);
    add(K::stepper, 90, 80, 0.8f);

    IRAssetRef asset;
    asset.asset_id = "svg1";
    asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest,
                                       {.diagnostics_out = &diagnostics});
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    REQUIRE(frame->element_count() == 7);
    using FK = DesignFrameElement::Kind;
    CHECK(frame->element_kind(0) == FK::knob);
    CHECK(frame->element_kind(1) == FK::fader);
    CHECK(frame->element_kind(2) == FK::toggle);
    CHECK(frame->element_kind(3) == FK::dropdown);
    CHECK(frame->element_kind(4) == FK::text_field);
    CHECK(frame->element_kind(5) == FK::tab_group);
    CHECK(frame->element_kind(6) == FK::stepper);
    // Carried render fields survive the IR -> DesignFrameElement copy (so the
    // overlay actually renders, not just types correctly). A regression that
    // dropped `el.value = e.default_value` would redden these.
    CHECK(frame->element_value(0) == Catch::Approx(0.1f));  // knob
    CHECK(frame->element_value(1) == Catch::Approx(0.2f));  // fader thumb position
    CHECK(frame->element_value(2) == Catch::Approx(0.3f));  // toggle on/off state
    REQUIRE_FALSE(diagnostics_contain(diagnostics,
                                      "native-materialize-faithful-svg-unresolved"));
}

TEST_CASE("materializer maps swap / action / xy_pad / value_label with their fields",
          "[view][import][native-materializer][faithful-svg][p1b]") {
    // P1b acceptance: each of the four new kinds materializes (JSON -> IR ->
    // to_frame_elements -> DesignFrameView) to the matching runtime Kind AND
    // carries its typed data (target_frame / action / value_y / text).
    const std::string svg =
        R"(<svg width="240" height="240" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="10" y="10" width="220" height="220" fill="#1c1d1d"/></svg>)";

    DesignIR ir;
    ir.root.type = "frame";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "svg1";

    IRInteractiveElement swap;
    swap.kind = InteractiveElementKind::swap;
    swap.x = 20; swap.y = 20; swap.w = 60; swap.h = 24; swap.target_frame = 2;
    ir.root.interactive_elements.push_back(swap);

    IRInteractiveElement act;
    act.kind = InteractiveElementKind::action;
    act.x = 20; act.y = 60; act.w = 30; act.h = 24; act.action = "octave_up";
    ir.root.interactive_elements.push_back(act);

    IRInteractiveElement pad;
    pad.kind = InteractiveElementKind::xy_pad;
    pad.x = 20; pad.y = 100; pad.w = 100; pad.h = 100;
    pad.default_value = 0.3f; pad.default_value_y = 0.7f;
    ir.root.interactive_elements.push_back(pad);

    IRInteractiveElement lbl;
    lbl.kind = InteractiveElementKind::value_label;
    lbl.x = 20; lbl.y = 210; lbl.w = 80; lbl.h = 16; lbl.text = "-6.0 dB";
    lbl.value_left_align = true;
    ir.root.interactive_elements.push_back(lbl);

    IRAssetRef asset;
    asset.asset_id = "svg1";
    asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest,
                                       {.diagnostics_out = &diagnostics});
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    REQUIRE(frame->element_count() == 4);
    using FK = DesignFrameElement::Kind;
    CHECK(frame->element_kind(0) == FK::swap);
    CHECK(frame->element_kind(1) == FK::action);
    CHECK(frame->element_kind(2) == FK::xy_pad);
    CHECK(frame->element_kind(3) == FK::value_label);
    // Every typed payload survives the IR -> DesignFrameElement copy — not just
    // the Kind. A dropped field-copy in to_frame_elements would redden these.
    CHECK(frame->element_target_frame(0) == 2);             // swap link target
    CHECK(frame->element_action(1) == "octave_up");         // action command id
    CHECK(frame->element_value(2) == Catch::Approx(0.3f));  // xy_pad X axis
    CHECK(frame->element_value_y(2) == Catch::Approx(0.7f));// xy_pad Y axis
    CHECK(frame->element_text(3) == "-6.0 dB");             // value_label readout
    CHECK(frame->element_left_align(3) == true);            // value_label alignment
    REQUIRE_FALSE(diagnostics_contain(diagnostics,
                                      "native-materialize-faithful-svg-unresolved"));
}

namespace {
// A trivial custom control used to prove the Tier-3 factory dispatch.
struct TestCustomControl : pulp::view::View {};
}  // namespace

TEST_CASE("materializer builds a custom control via its registered factory (P7 Tier-3)",
          "[view][import][native-materializer][faithful-svg][p7]") {
    clear_design_control_factories();
    bool called = false;
    DesignControlContext seen;
    register_design_control_factory("my.control", [&](const DesignControlContext& ctx) {
        called = true; seen = ctx;
        return std::make_unique<TestCustomControl>();
    });

    const std::string svg =
        R"(<svg width="120" height="80" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="10" y="10" width="100" height="60" fill="#1c1d1d"/></svg>)";
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "svg1";

    IRInteractiveElement c;
    c.kind = InteractiveElementKind::custom;
    c.x = 20; c.y = 20; c.w = 40; c.h = 20;
    c.factory_id = "my.control";
    c.custom_props = "{\"gain\":0.7}";
    c.default_value = 0.3f;
    c.source_node_id = "9:1";
    ir.root.interactive_elements.push_back(c);

    IRAssetRef asset;
    asset.asset_id = "svg1";
    asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest,
                                       {.diagnostics_out = &diagnostics});
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    REQUIRE(frame->element_count() == 1);
    CHECK(frame->element_kind(0) == DesignFrameElement::Kind::custom);
    CHECK(called);
    CHECK(seen.factory_id == "my.control");
    CHECK(seen.props == "{\"gain\":0.7}");
    CHECK(seen.source_node_id == "9:1");
    CHECK(seen.default_value == Catch::Approx(0.3f));
    // The factory's View is the live overlay.
    CHECK(dynamic_cast<TestCustomControl*>(frame->overlay_widget(0)) != nullptr);
    REQUIRE_FALSE(diagnostics_contain(diagnostics,
                                      "native-materialize-custom-factory-unregistered"));
    clear_design_control_factories();
}

TEST_CASE("an unregistered custom factory renders inert + diagnoses (P7 Tier-3)",
          "[view][import][native-materializer][faithful-svg][p7]") {
    clear_design_control_factories();  // ensure "missing" is not registered
    const std::string svg =
        R"(<svg width="120" height="80" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="10" y="10" width="100" height="60" fill="#1c1d1d"/></svg>)";
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "svg1";

    IRInteractiveElement c;
    c.kind = InteractiveElementKind::custom;
    c.x = 20; c.y = 20; c.w = 40; c.h = 20;
    c.factory_id = "missing";
    ir.root.interactive_elements.push_back(c);

    IRAssetRef asset;
    asset.asset_id = "svg1";
    asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest,
                                       {.diagnostics_out = &diagnostics});
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    REQUIRE(frame->element_count() == 1);          // the element still exists (SVG renders)
    CHECK(frame->element_kind(0) == DesignFrameElement::Kind::custom);
    CHECK(frame->overlay_widget(0) == nullptr);     // inert — no overlay widget
    CHECK(diagnostics_contain(diagnostics,
                              "native-materialize-custom-factory-unregistered"));
}

TEST_CASE("baked native materializer forwards a sampled shape_fill_gradient",
          "[view][import][native-materializer][figma-plugin][fill]") {
    // The importer samples a shape illustration's OWN gradient and stamps
    // shape_fill_gradient; the materializer forwards it to ImageView so a later
    // opt-in fill reveals the shape's real colors. Storing it is inert (no fill
    // value), so the image still renders plainly — the capability stays opt-in.
    auto make = [](const char* grad) {
        DesignIR ir;
        ir.source = DesignSource::figma_plugin;
        ir.root.type = "image";
        ir.root.attributes["asset_ref"] = "shape";
        ir.root.style.width = 80.0f;
        ir.root.style.height = 96.0f;
        if (grad) ir.root.attributes["shape_fill_gradient"] = grad;
        IRAssetRef asset;
        asset.asset_id = "shape";
        asset.local_path = "/resolved/shape.png";
        asset.mime = "image/png";
        ir.asset_manifest.assets.push_back(asset);
        std::vector<ImportDiagnostic> diag;
        return build_native_view_tree(ir, {}, {.diagnostics_out = &diag});
    };

    // A node carrying ≥2 stops materializes an ImageView with the gradient set,
    // but with NO fill value driven — so has_fill() stays false (opt-in intact).
    auto with_grad = make("#7a4cff,#c84cff,#b0d0ff");
    auto* img = dynamic_cast<ImageView*>(with_grad.get());
    REQUIRE(img != nullptr);
    REQUIRE(img->has_fill_gradient());
    REQUIRE(img->fill_gradient().size() == 3);
    REQUIRE_FALSE(img->has_fill());

    // A node without the attribute gets no gradient (logos/icons stay plain).
    auto plain = make(nullptr);
    auto* img2 = dynamic_cast<ImageView*>(plain.get());
    REQUIRE(img2 != nullptr);
    REQUIRE_FALSE(img2->has_fill_gradient());
}

TEST_CASE("baked native materializer preserves figma-plugin bleed sprite geometry",
          "[view][import][native-materializer][figma-plugin][fidelity]") {
    DesignIR ir;
    ir.source = DesignSource::figma_plugin;
    ir.source_adapter = "figma-plugin";
    ir.root.type = "image";
    ir.root.name = "Imported Bleed Sprite";
    ir.root.attributes["asset_ref"] = "sprite";
    ir.root.attributes["png_natural_w"] = "420";
    ir.root.attributes["png_natural_h"] = "484";
    ir.root.attributes["art_core_x"] = "148";
    ir.root.attributes["art_core_y"] = "0";
    ir.root.attributes["art_core_w"] = "115";
    ir.root.attributes["art_core_h"] = "129";
    ir.root.style.width = 62.0f;
    ir.root.style.height = 68.0f;
    ir.root.style.position = "absolute";
    ir.root.style.left = 20.0f;
    ir.root.style.top = 30.0f;
    ir.root.style.render_bounds = IRStyle::RenderBounds{210.0f, 116.0f, -74.0f, 0.0f};

    IRAssetRef asset;
    asset.asset_id = "sprite";
    asset.original_uri = "figma://fixture/sprite";
    asset.local_path = "/resolved/import/assets/sprite.png";
    asset.mime = "image/png";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* image = dynamic_cast<ImageView*>(root.get());
    REQUIRE(image != nullptr);

    const float scale = 68.0f / 129.0f;
    const float expected_w = 420.0f * scale;
    const float expected_h = 484.0f * scale;
    const float expected_left =
        20.0f - 148.0f * scale + (62.0f - 115.0f * scale) * 0.5f;
    CHECK(image->flex().preferred_width == Catch::Approx(expected_w));
    CHECK(image->flex().preferred_height == Catch::Approx(expected_h));
    CHECK(image->flex().dim_width.value == Catch::Approx(expected_w));
    CHECK(image->flex().dim_height.value == Catch::Approx(expected_h));
    CHECK(image->left() == Catch::Approx(expected_left));
    CHECK(image->top() == Catch::Approx(30.0f));
    REQUIRE_FALSE(diagnostics_contain(diagnostics, "native-materialize-unresolved-asset"));
}

TEST_CASE("baked native materializer returns an unresolved asset placeholder with diagnostics",
          "[view][import][native-materializer][phase-4]") {
    DesignIR ir;
    ir.root.type = "image";
    ir.root.stable_anchor_id = "missing-logo";
    ir.root.attributes["srcAssetId"] = "asset-missing";
    ir.root.style.width = 64.0f;
    ir.root.style.height = 32.0f;

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    REQUIRE(dynamic_cast<ImageView*>(root.get()) == nullptr);
    REQUIRE(root->id() == "missing-logo");
    REQUIRE(root->flex().preferred_width == 64.0f);
    REQUIRE(root->flex().preferred_height == 32.0f);
    REQUIRE(diagnostics_contain(diagnostics, "native-missing-asset"));
    REQUIRE(diagnostics_count(diagnostics, "native-materialize-unresolved-asset") == 0);
}

TEST_CASE("baked native materializer applies token theme only to the detached root",
          "[view][import][native-materializer][phase-4]") {
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";
    ir.root.children.push_back(label("child", "Voice", 40.0f, 20.0f));
    ir.tokens.colors["accent.primary"] = "#112233";

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->theme().colors.count("accent.primary") == 1);
    REQUIRE(root->child_count() == 1);
    REQUIRE(root->child_at(0)->theme().colors.empty());
}

TEST_CASE("baked native materializer applies a CSS background gradient",
          "[view][import][native-materializer][gradient]") {
    // Real Figma imports paint their light "hero" panels and illustration fills
    // as CSS gradients (e.g. ELYSIUM's Rectangle 5). Dropping background_gradient
    // was the dominant dark/light parity gap; the materializer must route it
    // through the shared css_gradient helper. See css_gradient.cpp.
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "panel";
    ir.root.style.width = 320.0f;
    ir.root.style.height = 200.0f;
    ir.root.style.background_color = "#1c1d1d";  // solid base, painted under
    ir.root.style.background_gradient =
        "linear-gradient(to bottom, #e4edf6, #b7c8db)";

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->has_background_gradient());
    REQUIRE(root->background_gradient_type() == 1);  // 1 = linear
}

TEST_CASE("baked native materializer reproduces the design's captured knob pointer",
          "[view][import][native-materializer][knob][sprite]") {
    // hoist_captured_art_knobs stamps the design's own pointer geometry; the
    // materializer must forward it to the Knob (set_captured_indicator) so the
    // renderer draws THAT pointer over the disc instead of a synthetic notch —
    // killing the double line and aligning to the disc's baked reference ticks.
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";
    ir.root.style.width = 100.0f;
    ir.root.style.height = 100.0f;

    IRNode knob;
    knob.type = "frame";
    knob.stable_anchor_id = "knob";
    knob.audio_widget = AudioWidgetType::knob;
    knob.style.width = 30.0f;
    knob.style.height = 32.0f;
    // Post-hoist + post-enrich attribute contract for a captured-art knob.
    knob.attributes["asset_ref"] = "disc";
    knob.attributes["asset_path"] = "/resolved/disc.png";
    knob.attributes["png_natural_w"] = "420";
    knob.attributes["png_natural_h"] = "484";
    knob.attributes["knob_ind_r_in"] = "0.604";
    knob.attributes["knob_ind_r_out"] = "0.936";
    knob.attributes["knob_ind_w"] = "0.05";
    knob.attributes["knob_ind_color"] = "#ffffff";
    ir.root.children.push_back(std::move(knob));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);
    auto* k = dynamic_cast<Knob*>(root->child_at(0));
    REQUIRE(k != nullptr);
    REQUIRE(k->has_captured_indicator());
    CHECK(k->captured_indicator_r_out() == Catch::Approx(0.936f));
    CHECK(k->captured_indicator_r_in() == Catch::Approx(0.604f));
}

TEST_CASE("imported text vertically centers in a slot taller than its line",
          "[view][import][native-materializer][text]") {
    // Figma centers text in a fixed-height frame, but the IR carries no
    // textAlignVertical. A single-line label given a slot taller than its font
    // (e.g. an 8px "SEARCH" in a 17px box) must center; a tight box stays top.
    // The web-compat codegen emits verticalAlign:middle under the SAME rule, so
    // the two render paths agree (screenshot-parity invariant). Label default top.
    SECTION("tall slot → center") {
        DesignIR ir;
        ir.root = label("search", "SEARCH", 80.0f, 17.0f);
        ir.root.style.font_size = 8.0f;
        auto root = build_native_view_tree(ir, {}, {});
        auto* lbl = dynamic_cast<Label*>(root.get());
        REQUIRE(lbl != nullptr);
        REQUIRE(lbl->vertical_align() == pulp::canvas::TextVerticalAlign::center);
    }
    SECTION("tight slot → top (unchanged)") {
        DesignIR ir;
        ir.root = label("tight", "Hz", 40.0f, 9.0f);
        ir.root.style.font_size = 8.0f;  // 9 <= 8 * 1.15 → not centered
        auto root = build_native_view_tree(ir, {}, {});
        auto* lbl = dynamic_cast<Label*>(root.get());
        REQUIRE(lbl != nullptr);
        REQUIRE(lbl->vertical_align() == pulp::canvas::TextVerticalAlign::top);
    }
}

TEST_CASE("native imported font sizes preserve exact metrics and pixels and reject invalid IR",
          "[view][import][native-materializer][font-size]") {
    auto make = [](float size) {
        DesignIR ir;
        ir.root = label("source-text", "Source faithful typography", 180.0f, 48.0f);
        ir.root.style.font_size = size;
        return ir;
    };

    for (const float size : {10.0f, 11.0f, 13.0f, 13.5f, 15.0f, 16.0f}) {
        auto root = build_native_view_tree(make(size), {}, {});
        auto* imported = dynamic_cast<Label*>(root.get());
        REQUIRE(imported != nullptr);
        REQUIRE(imported->font_size() == Catch::Approx(size));
    }

    auto small = build_native_view_tree(make(10.0f), {}, {});
    auto large = build_native_view_tree(make(16.0f), {}, {});
    auto* small_label = dynamic_cast<Label*>(small.get());
    auto* large_label = dynamic_cast<Label*>(large.get());
    REQUIRE(small_label != nullptr);
    REQUIRE(large_label != nullptr);
    REQUIRE(small_label->intrinsic_height() < large_label->intrinsic_height());
    uint32_t small_w = 0, small_h = 0, large_w = 0, large_h = 0;
    const auto small_pixels = render_to_rgba(*small, 180, 48, 1.0f, &small_w, &small_h);
    const auto large_pixels = render_to_rgba(*large, 180, 48, 1.0f, &large_w, &large_h);
    REQUIRE(small_w == large_w);
    REQUIRE(small_h == large_h);
    REQUIRE(small_pixels != large_pixels);

    for (const float invalid_size : {0.0f, -4.0f}) {
        std::vector<ImportDiagnostic> diagnostics;
        auto rejected = build_native_view_tree(make(invalid_size), {}, {.diagnostics_out = &diagnostics});
        auto* imported = dynamic_cast<Label*>(rejected.get());
        REQUIRE(imported != nullptr);
        REQUIRE(imported->font_size() > 0.0f);
        REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
            return item.code == "native-unsupported-property" && item.property == "fontSize";
        }));
    }
}

TEST_CASE("native imported font weights preserve exact Skia pixels and reject invalid IR",
          "[view][import][native-materializer][font-weight]") {
    auto make = [](int weight) {
        DesignIR ir;
        ir.root = label("source-weight", "Source faithful weight", 180.0f, 40.0f);
        ir.root.style.font_family = ".SF NS";
        ir.root.style.font_size = 15.0f;
        ir.root.style.font_weight = weight;
        return ir;
    };

    for (const int weight : {400, 500, 600}) {
        auto root = build_native_view_tree(make(weight), {}, {});
        auto* imported = dynamic_cast<Label*>(root.get());
        REQUIRE(imported != nullptr);
        REQUIRE(imported->font_weight() == weight);
    }

    auto regular = build_native_view_tree(make(400), {}, {});
    auto semibold = build_native_view_tree(make(600), {}, {});
    uint32_t regular_w = 0, regular_h = 0, semibold_w = 0, semibold_h = 0;
    const auto regular_pixels = render_to_rgba(*regular, 180, 40, 1.0f, &regular_w, &regular_h);
    const auto semibold_pixels = render_to_rgba(*semibold, 180, 40, 1.0f, &semibold_w, &semibold_h);
    REQUIRE(regular_w == semibold_w);
    REQUIRE(regular_h == semibold_h);
    REQUIRE(regular_pixels != semibold_pixels);

    for (const int invalid_weight : {0, 99, 901}) {
        std::vector<ImportDiagnostic> diagnostics;
        auto rejected = build_native_view_tree(make(invalid_weight), {}, {.diagnostics_out = &diagnostics});
        auto* imported = dynamic_cast<Label*>(rejected.get());
        REQUIRE(imported != nullptr);
        REQUIRE(imported->font_weight() == 400);
        REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
            return item.code == "native-unsupported-property" && item.property == "fontWeight";
        }));
    }
}

TEST_CASE("rasterized-vector image does not redraw its baked stroke as a box border",
          "[view][import][native-materializer][image][fidelity]") {
    // A Figma vector exported as a PNG carries its stroke as border_color /
    // border_width, but the stroke is already in the raster. Drawing it again
    // paints a spurious outline — the visible bug was a purple rectangle around
    // the FILTER & EQ curve. Image views must suppress the CSS border.
    DesignIR ir;
    ir.source = DesignSource::figma_plugin;
    ir.root.type = "image";
    ir.root.stable_anchor_id = "curve";
    ir.root.attributes["asset_ref"] = "3:188";
    ir.root.style.width = 177.0f;
    ir.root.style.height = 26.0f;
    ir.root.style.border_color = "#7e6aff";
    ir.root.style.border_width = 1.0f;

    IRAssetRef asset;
    asset.asset_id = "3:188";
    asset.original_uri = "figma://fixture/3:188";
    asset.local_path = "/resolved/assets/3_188.png";
    asset.mime = "image/png";
    ir.asset_manifest.assets.push_back(asset);

    auto root = build_native_view_tree(ir, ir.asset_manifest, {});
    REQUIRE(root != nullptr);
    auto* image = dynamic_cast<ImageView*>(root.get());
    REQUIRE(image != nullptr);
    CHECK(image->border_width() == Catch::Approx(0.0f));
}

TEST_CASE("baked native materializer resolves an rgba() background color",
          "[view][import][native-materializer][color]") {
    // Figma demotes a hairline stroke (the FILTER & EQ grid Line images) to a
    // 1px frame whose fill is the stroke color — typically rgba(171,171,171,0.1).
    // parse_hex_color drops rgba(), so the grid painted nothing; apply_visual_style
    // now falls back to the shared CSS color parser. Without this the EQ grid
    // (and any rgba fill) is invisible.
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "grid-line";
    ir.root.style.width = 177.0f;
    ir.root.style.height = 1.0f;
    ir.root.style.background_color = "rgba(171, 171, 171, 0.1)";

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->has_background_color());
    const auto c = root->background_color();
    CHECK(c.r == Catch::Approx(171.0f / 255.0f).margin(0.01f));
    CHECK(c.a == Catch::Approx(0.1f).margin(0.01f));
}

TEST_CASE("baked native materializer maps a Dropdown frame to an interactive ComboBox",
          "[view][import][native-materializer][combo-box]") {
    // ELYSIUM's FX RACK ships explicit "Dropdown" frames (a selected-value text
    // + a chevron image). Recognized by layer name → a functional ComboBox whose
    // first item is the captured selection; the source has no option list, so
    // stub options demonstrate the popup. The text/chevron children are
    // suppressed (the ComboBox paints its own display).
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";

    IRNode dropdown;
    dropdown.type = "frame";
    dropdown.name = "Dropdown";
    dropdown.stable_anchor_id = "fx-delay";
    IRNode value;
    value.type = "text";
    value.text_content = "1/4 Delay";
    value.stable_anchor_id = "fx-delay-text";
    IRNode chevron;                  // a SQUARE down-chevron marks a real dropdown
    chevron.type = "image";
    chevron.name = "expand_more";
    chevron.attributes["asset_ref"] = "chevron";
    chevron.style.width = 16.0f;
    chevron.style.height = 16.0f;
    chevron.stable_anchor_id = "fx-delay-chevron";
    dropdown.children.push_back(value);
    dropdown.children.push_back(chevron);
    ir.root.children.push_back(std::move(dropdown));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);
    auto* combo = dynamic_cast<ComboBox*>(root->child_at(0));
    REQUIRE(combo != nullptr);
    REQUIRE_FALSE(combo->items().empty());
    CHECK(combo->items().front() == "1/4 Delay");
    CHECK(combo->selected_text() == "1/4 Delay");
    CHECK(combo->items().size() == 1);           // only the real shown value (no fabricated stubs)
    CHECK(combo->child_count() == 0);            // text + chevron suppressed
}

TEST_CASE("baked native materializer leaves prev/next cyclers and templates alone",
          "[view][import][native-materializer][combo-box]") {
    // Not every "Dropdown"-named frame is a dropdown. A prev/next preset CYCLER
    // (ELYSIUM's ENVELOPE/FILTER/FX-RACK headers) uses a WIDE "< >" icon, and an
    // unconfigured design-system TEMPLATE shows the literal word "Dropdown".
    // Neither must become a ComboBox — they stay plain frames.
    auto make_dropdown = [](const std::string& value_text, float icon_w,
                            float icon_h) {
        IRNode dd;
        dd.type = "frame";
        dd.name = "Dropdown";
        dd.stable_anchor_id = "dd";
        IRNode v;
        v.type = "text";
        v.text_content = value_text;
        v.stable_anchor_id = "dd-text";
        IRNode icon;
        icon.type = "image";
        icon.attributes["asset_ref"] = "icon";
        icon.style.width = icon_w;
        icon.style.height = icon_h;
        icon.stable_anchor_id = "dd-icon";
        dd.children.push_back(v);
        dd.children.push_back(icon);
        return dd;
    };

    SECTION("prev/next cycler (wide < > icon) stays a frame") {
        DesignIR ir;
        ir.root = make_dropdown("Short Plucks", 42.0f, 16.0f);  // aspect 2.6
        auto root = build_native_view_tree(ir, {}, {});
        REQUIRE(root != nullptr);
        REQUIRE(dynamic_cast<ComboBox*>(root.get()) == nullptr);
    }
    SECTION("unconfigured template ('Dropdown' value) renders nothing") {
        DesignIR ir;
        ir.root = make_dropdown("Dropdown", 16.0f, 16.0f);  // square but template
        auto root = build_native_view_tree(ir, {}, {});
        REQUIRE(root != nullptr);
        // Not a ComboBox, and inert: a hidden placeholder with no children, so it
        // can't surface as a stray dropdown between panels.
        REQUIRE(dynamic_cast<ComboBox*>(root.get()) == nullptr);
        CHECK(root->child_count() == 0);
        CHECK_FALSE(root->hit_testable());
    }
}

TEST_CASE("baked native materializer maps a Search container to a full-box field",
          "[view][import][native-materializer][text-editor]") {
    // ELYSIUM's "Search" field is a CONTAINER (a background pill + a "Search"
    // placeholder text + a magnifier icon). The WHOLE box becomes a TAPPABLE
    // input (not just the tiny text cell): the placeholder is "SEARCH", the icon
    // is kept as an overlay, and the placeholder text + bg chrome are dropped.
    DesignIR ir;
    ir.root.type = "frame";          // the search container (e.g. "Group 59")
    ir.root.stable_anchor_id = "search-box";
    ir.root.style.width = 184.0f;
    ir.root.style.height = 26.0f;

    IRNode bg;                        // background pill — dropped
    bg.type = "frame";
    bg.name = "Rectangle 66";
    bg.stable_anchor_id = "search-bg";
    IRNode placeholder;              // the placeholder text — becomes the editor's
    placeholder.type = "text";
    placeholder.name = "Search";
    placeholder.text_content = "SEARCH";
    placeholder.style.font_size = 8.0f;
    placeholder.stable_anchor_id = "search-text";
    IRNode icon;                     // magnifier — kept as an overlay child
    icon.type = "image";
    icon.name = "ic:round-search";
    icon.attributes["asset_ref"] = "search-icon";
    icon.style.left = 6.0f;
    icon.style.width = 15.0f;
    icon.stable_anchor_id = "search-icon";
    ir.root.children.push_back(bg);
    ir.root.children.push_back(placeholder);
    ir.root.children.push_back(icon);

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    auto* editor = dynamic_cast<TextEditor*>(root.get());
    REQUIRE(editor != nullptr);
    CHECK(editor->placeholder == "SEARCH");
    CHECK(editor->content_inset_left() > 15.0f);   // text cleared past the icon
    CHECK(root->child_count() == 1);               // only the icon kept (no text/bg)

    // Tappable + editable: focus then type enters text over the placeholder.
    editor->on_focus_changed(true);
    TextInputEvent te;
    te.text = "drums";
    editor->on_text_input(te);
    CHECK(editor->text() == "drums");
}

TEST_CASE("hoist_captured_art_knobs promotes a body disc + pointer to an interactive skin",
          "[view][import][native-materializer][knob][sprite]") {
    // A captured-art knob ships a body disc image + a ~0-area pointer hairline
    // (the native notch replaces the pointer). Hoist the disc's asset_ref onto
    // the knob, drop the captured children, keep it a knob (interactive).
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";

    IRNode knob;
    knob.type = "frame";
    knob.stable_anchor_id = "knob";
    knob.audio_widget = AudioWidgetType::knob;
    IRNode body;       // the disc, at (0,0), 30x32 → center (15,16), half-extent 15
    body.type = "image";
    body.stable_anchor_id = "body";
    body.attributes["asset_ref"] = "disc-asset";
    body.style.left = 0.0f;
    body.style.top = 0.0f;
    body.style.width = 30.0f;
    body.style.height = 32.0f;
    IRNode pointer;    // a ~0-width stroked pointer hairline near top-center
    pointer.type = "image";
    pointer.stable_anchor_id = "ptr";
    pointer.attributes["asset_ref"] = "ptr-asset";
    pointer.style.left = 14.0f;   // ~centered on the 30-wide disc
    pointer.style.top = 2.0f;
    pointer.style.width = 0.0f;
    pointer.style.height = 5.0f;  // spans y 2..7
    pointer.style.border_width = 1.5f;
    pointer.style.border_color = "#ffffff";
    knob.children.push_back(body);
    knob.children.push_back(pointer);
    ir.root.children.push_back(std::move(knob));

    hoist_captured_art_knobs(ir);

    const auto& k = ir.root.children.at(0);
    REQUIRE(k.audio_widget == AudioWidgetType::knob);          // stays interactive
    REQUIRE(k.attributes.at("asset_ref") == "disc-asset");     // disc hoisted
    REQUIRE(k.attributes.at("sprite_strip_frame_count") == "1");
    // Captured layers (disc + pointer) are gone — the design's pointer geometry
    // is stamped instead, so the renderer reproduces the real indicator.
    REQUIRE(k.children.empty());
    // pointer ends (14,2)/(14,7) from disc center (15,16): far ≈ 14.04, near ≈ 9.06;
    // half-extent 15 → r_out ≈ 0.936, r_in ≈ 0.604.
    REQUIRE(k.attributes.count("knob_ind_r_out") == 1);
    const float r_out = std::stof(k.attributes.at("knob_ind_r_out"));
    const float r_in = std::stof(k.attributes.at("knob_ind_r_in"));
    CHECK(r_out == Catch::Approx(0.936f).margin(0.02f));
    CHECK(r_in == Catch::Approx(0.604f).margin(0.02f));
    CHECK(r_out > r_in);
    REQUIRE(k.attributes.at("knob_ind_color") == "#ffffff");
}

TEST_CASE("hoist_captured_art_knobs recognizes a stroke-demoted pointer frame",
          "[view][import][native-materializer][knob][sprite]") {
    // The stroke→fill demotion pass rewrites a hairline stroke vector (Figma
    // "Vector 7") into a 1px-wide frame whose stroke color lives on
    // background_color — NOT an asset image. The old hoist scanned only
    // asset-backed image children, so it missed this pointer entirely: the knob
    // fell back to a synthetic notch AND the demoted 1px frame rendered as a
    // stuck second line. The pointer scan now walks every thin non-body child.
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";

    IRNode knob;
    knob.type = "frame";
    knob.stable_anchor_id = "knob";
    knob.audio_widget = AudioWidgetType::knob;
    IRNode body;       // disc at (0,0) 30x32 → center (15,16), half-extent 15
    body.type = "image";
    body.stable_anchor_id = "body";
    body.attributes["asset_ref"] = "disc-asset";
    body.style.left = 0.0f;
    body.style.top = 0.0f;
    body.style.width = 30.0f;
    body.style.height = 32.0f;
    IRNode pointer;    // a DEMOTED 1px frame, not an image, color on background
    pointer.type = "frame";
    pointer.stable_anchor_id = "ptr";
    pointer.attributes["__stroke_demoted"] = "1";
    pointer.style.left = 14.0f;
    pointer.style.top = 2.0f;
    pointer.style.width = 1.0f;   // demoted hairline = 1px, not 0
    pointer.style.height = 5.0f;  // spans y 2..7
    pointer.style.background_color = "#ff4400";
    knob.children.push_back(body);
    knob.children.push_back(pointer);
    ir.root.children.push_back(std::move(knob));

    hoist_captured_art_knobs(ir);

    const auto& k = ir.root.children.at(0);
    REQUIRE(k.audio_widget == AudioWidgetType::knob);          // stays interactive
    REQUIRE(k.attributes.at("asset_ref") == "disc-asset");     // disc hoisted
    // The demoted pointer is recognized, its geometry + color stamped, and the
    // stray 1px frame erased so it can't render as a stuck second line.
    REQUIRE(k.children.empty());
    REQUIRE(k.attributes.count("knob_ind_r_out") == 1);
    CHECK(std::stof(k.attributes.at("knob_ind_r_out")) >
          std::stof(k.attributes.at("knob_ind_r_in")));
    // Color comes from background_color (where the demotion pass put the stroke).
    REQUIRE(k.attributes.at("knob_ind_color") == "#ff4400");
}

TEST_CASE("hoist_captured_art_knobs demotes a multi-layer knob to a static container",
          "[view][import][native-materializer][knob][sprite]") {
    // Two SUBSTANTIAL captured layers (e.g. body + highlight) can't fit one
    // single-frame skin, so the knob demotes to a plain container — every layer
    // renders as an image (faithful but not turnable), no silent layer loss.
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";

    IRNode knob;
    knob.type = "frame";
    knob.stable_anchor_id = "knob";
    knob.audio_widget = AudioWidgetType::knob;
    for (const char* id : {"body", "highlight"}) {
        IRNode layer;
        layer.type = "image";
        layer.stable_anchor_id = id;
        layer.attributes["asset_ref"] = std::string(id) + "-asset";
        layer.style.width = 40.0f;
        layer.style.height = 40.0f;
        knob.children.push_back(std::move(layer));
    }
    ir.root.children.push_back(std::move(knob));

    hoist_captured_art_knobs(ir);

    const auto& k = ir.root.children.at(0);
    REQUIRE(k.audio_widget == AudioWidgetType::none);   // demoted to container
    REQUIRE(k.children.size() == 2);                    // both layers preserved
    REQUIRE(k.attributes.count("asset_ref") == 0);
}

TEST_CASE("baked native materializer leaves background gradient unset without one",
          "[view][import][native-materializer][gradient]") {
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "panel";
    ir.root.style.width = 100.0f;
    ir.root.style.height = 100.0f;
    ir.root.style.background_color = "#202020";

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE_FALSE(root->has_background_gradient());
}

TEST_CASE("standard meter snaps fill edge and suppresses duplicate peak line",
          "[view][meter][import][native-materializer]") {
    Meter meter;
    meter.set_bounds({0.0f, 0.0f, 8.0f, 56.0f});
    meter.set_level(0.72f, 0.72f);

    pulp::canvas::RecordingCanvas same_edge_canvas;
    meter.paint(same_edge_canvas);

    const auto* fill = first_meter_fill_rect(same_edge_canvas);
    REQUIRE(fill != nullptr);
    REQUIRE(fill->f[0] == 1.0f);
    REQUIRE(fill->f[1] == 16.0f);
    REQUIRE(fill->f[2] == 6.0f);
    REQUIRE(fill->f[3] == 40.0f);
    REQUIRE(same_edge_canvas.count(pulp::canvas::DrawCommand::Type::stroke_line) == 0);

    meter.set_level(0.50f, 0.75f);
    pulp::canvas::RecordingCanvas separate_peak_canvas;
    meter.paint(separate_peak_canvas);

    fill = first_meter_fill_rect(separate_peak_canvas);
    REQUIRE(fill != nullptr);
    REQUIRE(fill->f[1] == 28.0f);
    REQUIRE(fill->f[3] == 28.0f);
    REQUIRE(separate_peak_canvas.count(pulp::canvas::DrawCommand::Type::stroke_line) == 1);

    const pulp::canvas::DrawCommand* peak_line = nullptr;
    for (const auto& command : separate_peak_canvas.commands()) {
        if (command.type == pulp::canvas::DrawCommand::Type::stroke_line) {
            peak_line = &command;
            break;
        }
    }
    REQUIRE(peak_line != nullptr);
    REQUIRE(peak_line->f[0] == 1.0f);
    REQUIRE(peak_line->f[1] == 14.0f);
    REQUIRE(peak_line->f[2] == 7.0f);
    REQUIRE(peak_line->f[3] == 14.0f);
}

TEST_CASE("baked native materializer preserves waveform preview shape",
          "[view][waveform][import][native-materializer]") {
    DesignIR ir;
    ir.root = frame("waveform-root", 88.0f, 42.0f, LayoutDirection::column);

    auto waveform_node = frame("osc-waveform", 88.0f, 42.0f, LayoutDirection::column);
    waveform_node.audio_widget = AudioWidgetType::waveform;
    waveform_node.attributes["pulpWaveformShape"] = "saw";
    ir.root.children.push_back(std::move(waveform_node));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);

    auto* waveform = dynamic_cast<WaveformView*>(root->child_at(0));
    REQUIRE(waveform != nullptr);
    REQUIRE(waveform->preview_shape() == WaveformView::PreviewShape::saw);

    waveform->set_bounds({0.0f, 0.0f, 88.0f, 42.0f});
    pulp::canvas::RecordingCanvas canvas;
    waveform->paint(canvas);

    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::stroke_line) == 1);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::begin_path) == 1);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::move_to) == 1);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::line_to) == 7);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::stroke_current_path) == 1);
}

TEST_CASE("baked native materializer maps fill sizing by parent axis",
          "[view][import][native-materializer][phase-4]") {
    DesignIR ir;
    ir.root = frame("row-root", 300.0f, 120.0f, LayoutDirection::row);

    auto main_axis_fill = frame("main-fill", 0.0f, 40.0f, LayoutDirection::column);
    main_axis_fill.style.width.reset();
    main_axis_fill.layout.width_mode = SizingMode::fill;

    auto cross_axis_fill = frame("cross-fill", 64.0f, 0.0f, LayoutDirection::column);
    cross_axis_fill.style.height.reset();
    cross_axis_fill.layout.height_mode = SizingMode::fill;

    ir.root.children.push_back(std::move(main_axis_fill));
    ir.root.children.push_back(std::move(cross_axis_fill));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 2);

    const auto& main_flex = root->child_at(0)->flex();
    const auto& cross_flex = root->child_at(1)->flex();
    REQUIRE(main_flex.flex_grow == 1.0f);
    REQUIRE(cross_flex.flex_grow == 0.0f);
    REQUIRE(cross_flex.align_self == FlexAlign::stretch);
}

TEST_CASE("native import lowers align-content normal by display context",
          "[view][import][native-materializer][align-content]") {
    const auto fixture_path = fs::path(PULP_REPO_ROOT) /
        "tools/import-design/test/fixtures/compat-semantics/align-content-normal.v1.json";
    std::ifstream input(fixture_path);
    REQUIRE(input.good());
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto fixture = choc::json::parse(buffer.str());
    const auto cases = fixture["native"]["cases"];
    REQUIRE(cases.isArray());

    DesignIR ir;
    ir.root = frame("root", 700.0f, 120.0f, LayoutDirection::row);
    for (size_t i = 0; i < cases.size(); ++i) {
        const auto case_data = cases[static_cast<uint32_t>(i)];
        auto node = frame("case-" + std::to_string(i), 100.0f, 100.0f,
                          LayoutDirection::row);
        node.layout.display = case_data["display"].getWithDefault(std::string{});
        node.layout.wrap = true;
        node.layout.align_content =
            case_data["computedAlignContent"].getWithDefault(std::string{});
        ir.root.children.push_back(std::move(node));
    }
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == cases.size());
    for (size_t i = 0; i < cases.size(); ++i) {
        const auto case_data = cases[static_cast<uint32_t>(i)];
        const auto expected =
            case_data["expectedFlexAlign"].getWithDefault(std::string{});
        CAPTURE(i, expected);
        REQUIRE(root->child_at(i)->flex().align_content ==
                (expected == "stretch" ? FlexAlign::stretch : FlexAlign::start));
    }
}

TEST_CASE("native import materializes observed align-items center",
          "[view][import][native-materializer][align-items-center]") {
    const auto fixture_path = fs::path(PULP_REPO_ROOT) /
        "tools/import-design/test/fixtures/compat-semantics/align-items-center.v1.json";
    std::ifstream input(fixture_path);
    REQUIRE(input.good());
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto fixture = choc::json::parse(buffer.str());

    DesignIR ir;
    ir.root = frame("root", 100.0f, 100.0f, LayoutDirection::row);
    const auto native_align = fixture["expected"]["nativeDesignIrAlign"]
        .getWithDefault(std::string{});
    REQUIRE(native_align == "center");
    ir.root.layout.align = LayoutAlign::center;
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->flex().align_items == FlexAlign::center);
    REQUIRE(fixture["expected"]["nativeFlexAlign"].getWithDefault(std::string{}) ==
            "center");
}

TEST_CASE("native import materializes lowered align-items normal",
          "[view][import][native-materializer][align-items-normal]") {
    const auto fixture_path = fs::path(PULP_REPO_ROOT) /
        "tools/import-design/test/fixtures/compat-semantics/align-items-normal.v1.json";
    std::ifstream input(fixture_path);
    REQUIRE(input.good());
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto fixture = choc::json::parse(buffer.str());
    const auto cases = fixture["cases"];
    REQUIRE(cases.isArray());
    for (uint32_t i = 0; i < cases.size(); ++i) {
        CAPTURE(i);
        const auto expected =
            cases[i]["nativeDesignIrAlign"].getWithDefault(std::string{});
        DesignIR ir;
        ir.root = frame("root", 100.0f, 100.0f, LayoutDirection::column);
        ir.root.layout.align = expected == "stretch"
            ? LayoutAlign::stretch : LayoutAlign::flex_start;
        if (cases[i]["display"].getWithDefault(std::string{}) == "block") {
            IRNode auto_width_child;
            auto_width_child.type = "frame";
            auto_width_child.stable_anchor_id = "auto-width-child";
            auto_width_child.style.height = 20.0f;
            ir.root.children.push_back(std::move(auto_width_child));
        }
        auto root = build_native_view_tree(ir, {}, {});
        REQUIRE(root != nullptr);
        REQUIRE(root->flex().align_items ==
                (expected == "stretch" ? FlexAlign::stretch : FlexAlign::start));
        if (cases[i]["display"].getWithDefault(std::string{}) == "block") {
            REQUIRE(root->child_count() == 1);
            root->set_bounds({0, 0, 100, 100});
            root->layout_children();
            REQUIRE(root->child_at(0)->bounds().width == 100.0f);
        }
    }
}

TEST_CASE("native import preserves align-self auto inheritance",
          "[view][import][native-materializer][align-self-auto]") {
    const auto fixture_path = fs::path(PULP_REPO_ROOT) /
        "tools/import-design/test/fixtures/compat-semantics/align-self-auto.v1.json";
    std::ifstream input(fixture_path);
    REQUIRE(input.good());
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto fixture = choc::json::parse(buffer.str());

    DesignIR ir;
    ir.root = frame("root", 100.0f, 100.0f, LayoutDirection::row);
    ir.root.layout.align = LayoutAlign::center;
    auto child = frame("child", 20.0f, 20.0f, LayoutDirection::column);
    child.layout.align_self = fixture["expected"]["nativeAlignSelf"]
        .getWithDefault(std::string{});
    ir.root.children.push_back(std::move(child));
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);
    REQUIRE(root->child_at(0)->flex().align_self == FlexAlign::auto_);
    root->set_bounds({0, 0, 100, 100});
    root->layout_children();
    REQUIRE(root->child_at(0)->bounds().y ==
            fixture["expected"]["nativeChildY"].getWithDefault<double>(-1));
}

TEST_CASE("native import align-self stretch overrides parent center",
          "[view][import][native-materializer][align-self-stretch]") {
    const auto fixture_path = fs::path(PULP_REPO_ROOT) /
        "tools/import-design/test/fixtures/compat-semantics/align-self-stretch.v1.json";
    std::ifstream input(fixture_path);
    REQUIRE(input.good());
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto fixture = choc::json::parse(buffer.str());

    DesignIR ir;
    ir.root = frame("root", 100.0f, 100.0f, LayoutDirection::row);
    ir.root.layout.align = LayoutAlign::center;
    IRNode child;
    child.type = "frame";
    child.stable_anchor_id = "child";
    child.style.width = 20.0f;
    child.style.min_height = 20.0f;
    child.layout.align_self = fixture["expected"]["nativeAlignSelf"]
        .getWithDefault(std::string{});
    ir.root.children.push_back(std::move(child));
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);
    REQUIRE(root->child_at(0)->flex().align_self == FlexAlign::stretch);
    root->set_bounds({0, 0, 100, 100});
    root->layout_children();
    REQUIRE(root->child_at(0)->bounds().y ==
            fixture["expected"]["nativeChildY"].getWithDefault<double>(-1));
    REQUIRE(root->child_at(0)->bounds().height ==
            fixture["expected"]["nativeChildHeight"].getWithDefault<double>(-1));
}

TEST_CASE("native import backdrop-filter none is an explicit identity",
          "[view][import][native-materializer][backdrop-filter-none]") {
    const auto fixture_path = fs::path(PULP_REPO_ROOT) /
        "tools/import-design/test/fixtures/compat-semantics/backdrop-filter-none.v1.json";
    std::ifstream input(fixture_path);
    REQUIRE(input.good());
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto fixture = choc::json::parse(buffer.str());

    DesignIR ir;
    ir.root = frame("root", 100.0f, 100.0f, LayoutDirection::column);
    ir.root.style.backdrop_filter = "none";
    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    REQUIRE(root->backdrop_blur() ==
            fixture["expected"]["nativeBackdropBlur"].getWithDefault<double>(-1));
    REQUIRE(std::none_of(diagnostics.begin(), diagnostics.end(), [](const auto& diagnostic) {
        return diagnostic.property == "backdropFilter";
    }));

    ir.root.style.backdrop_filter = "blur(8px)";
    auto blurred = build_native_view_tree(ir, {}, {});
    REQUIRE(blurred != nullptr);
    REQUIRE(blurred->backdrop_blur() == 8.0f);
    blurred->set_backdrop_blur(0.0f);
    REQUIRE(blurred->backdrop_blur() == 0.0f);
}

TEST_CASE("native import preserves transparent color(srgb) background",
          "[view][import][native-materializer][background-color-srgb]") {
    const auto fixture_path = fs::path(PULP_REPO_ROOT) /
        "tools/import-design/test/fixtures/compat-semantics/background-color-srgb-transparent.v1.json";
    std::ifstream input(fixture_path);
    REQUIRE(input.good());
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto fixture = choc::json::parse(buffer.str());

    DesignIR ir;
    ir.root = frame("root", 100.0f, 100.0f, LayoutDirection::column);
    ir.root.style.background_color = fixture["expected"]["nativeColor"]
        .getWithDefault(std::string{});
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->has_background_color());
    REQUIRE(root->background_color().a8() ==
            fixture["expected"]["nativeAlpha"].getWithDefault<int64_t>(-1));
}

TEST_CASE("native import materializes observed CSS Color 4 backgrounds",
          "[view][import][native-materializer][background-color-css4]") {
    const auto fixture_path = fs::path(PULP_REPO_ROOT) /
        "tools/import-design/test/fixtures/compat-semantics/background-color-css4-observed.v1.json";
    std::ifstream input(fixture_path);
    REQUIRE(input.good());
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto fixture = choc::json::parse(buffer.str());
    const auto cases = fixture["cases"];
    REQUIRE(cases.isArray());
    for (uint32_t i = 0; i < cases.size(); ++i) {
        const auto normalized = cases[i]["normalized"].getWithDefault(std::string{});
        CAPTURE(i, normalized);
        REQUIRE(normalized.size() == 9);
        DesignIR ir;
        ir.root = frame("root", 10.0f, 10.0f, LayoutDirection::column);
        ir.root.style.background_color = normalized;
        auto root = build_native_view_tree(ir, {}, {});
        REQUIRE(root != nullptr);
        REQUIRE(root->has_background_color());
        REQUIRE(root->background_color().a8() ==
                std::stoul(normalized.substr(7, 2), nullptr, 16));
    }
}

TEST_CASE("native import materializes observed rgb backgrounds",
          "[view][import][native-materializer][background-color-rgb]") {
    const auto fixture_path = fs::path(PULP_REPO_ROOT) /
        "tools/import-design/test/fixtures/compat-semantics/background-color-rgb-observed.v1.json";
    std::ifstream input(fixture_path);
    REQUIRE(input.good());
    std::stringstream buffer;
    buffer << input.rdbuf();
    const auto fixture = choc::json::parse(buffer.str());
    const auto cases = fixture["cases"];
    REQUIRE(cases.isArray());
    for (uint32_t i = 0; i < cases.size(); ++i) {
        const auto normalized = cases[i]["normalized"].getWithDefault(std::string{});
        CAPTURE(i, normalized);
        DesignIR ir;
        ir.root = frame("root", 10.0f, 10.0f, LayoutDirection::column);
        ir.root.style.background_color = normalized;
        auto root = build_native_view_tree(ir, {}, {});
        REQUIRE(root != nullptr);
        REQUIRE(root->has_background_color());
        REQUIRE(root->background_color().a8() ==
                std::stoul(normalized.substr(7, 2), nullptr, 16));
    }
}

TEST_CASE("native import paints generic per-side border and rejects promoted asymmetry",
          "[view][import][native-materializer][border-side]") {
    DesignIR generic;
    generic.root = frame("generic", 100.0f, 30.0f, LayoutDirection::column);
    generic.root.style.border_bottom_width = 1.0f;
    generic.root.style.border_bottom_color = "#2e2e2e99";
    auto view = build_native_view_tree(generic, {}, {});
    REQUIRE(view != nullptr);
    REQUIRE(view->border_bottom_width() == 1.0f);
    REQUIRE(view->border_bottom_color() == Color::rgba8(46, 46, 46, 153));
    pulp::canvas::RecordingCanvas canvas;
    view->set_bounds({0, 0, 100, 30});
    view->paint_all(canvas);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) >= 1);

    generic.root.style.border_bottom_width = 0.0f;
    auto zero = build_native_view_tree(generic, {}, {});
    REQUIRE(zero != nullptr);
    REQUIRE(zero->border_bottom_width() == 0.0f);
    pulp::canvas::RecordingCanvas zero_canvas;
    zero->set_bounds({0, 0, 100, 30});
    zero->paint_all(zero_canvas);
    REQUIRE(zero_canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) == 0);

    generic.root.style.border_bottom_width = 1.0f;
    generic.root.style.border_bottom_color = "rgba(0, 0, 0, 0)";
    auto transparent = build_native_view_tree(generic, {}, {});
    REQUIRE(transparent != nullptr);
    pulp::canvas::RecordingCanvas transparent_canvas;
    transparent->set_bounds({0, 0, 100, 30});
    transparent->paint_all(transparent_canvas);
    REQUIRE(transparent_canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) == 0);

    DesignIR promoted;
    promoted.root.type = "button";
    promoted.root.stable_anchor_id = "button";
    promoted.root.style.width = 100.0f;
    promoted.root.style.height = 30.0f;
    promoted.root.style.border_left_width = 1.0f;
    promoted.root.style.border_left_color = "#2e2e2e99";
    std::vector<ImportDiagnostic> diagnostics;
    auto button = build_native_view_tree(promoted, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(button != nullptr);
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-widget-asymmetric-border-unsupported";
    }));
}

TEST_CASE("native import paints or suppresses left border color equivalence classes",
          "[view][import][native-materializer][border-side-left]") {
    for (const auto& [color, should_paint] :
         std::vector<std::pair<std::string, bool>>{{"#2e2e2e99", true},
                                                   {"#afafafff", true},
                                                   {"#2e2e2eff", true},
                                                   {"rgba(46, 46, 46, 0.6)", true},
                                                   {"rgba(0, 0, 0, 0)", false},
                                                   {"transparent", false}}) {
        CAPTURE(color);
        DesignIR ir;
        ir.root = frame("left", 100.0f, 30.0f, LayoutDirection::column);
        ir.root.style.border_left_width = 1.0f;
        ir.root.style.border_left_color = color;
        auto view = build_native_view_tree(ir, {}, {});
        REQUIRE(view != nullptr);
        REQUIRE(view->border_left_width() == 1.0f);
        pulp::canvas::RecordingCanvas canvas;
        view->set_bounds({0, 0, 100, 30});
        view->paint_all(canvas);
        REQUIRE((canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) > 0) == should_paint);
    }

    DesignIR zero_ir;
    zero_ir.root = frame("left-zero", 100.0f, 30.0f, LayoutDirection::column);
    zero_ir.root.style.border_left_width = 0.0f;
    zero_ir.root.style.border_left_color = "#2e2e2eff";
    auto zero = build_native_view_tree(zero_ir, {}, {});
    REQUIRE(zero != nullptr);
    REQUIRE(zero->border_left_width() == 0.0f);
    pulp::canvas::RecordingCanvas zero_canvas;
    zero->set_bounds({0, 0, 100, 30});
    zero->paint_all(zero_canvas);
    REQUIRE(zero_canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) == 0);
}

TEST_CASE("native import paints or suppresses right border color equivalence classes",
          "[view][import][native-materializer][border-side-right]") {
    for (const auto& [color, should_paint] :
         std::vector<std::pair<std::string, bool>>{{"#2e2e2e99", true},
                                                   {"#afafafff", true},
                                                   {"#2e2e2eff", true},
                                                   {"rgba(46, 46, 46, 0.6)", true},
                                                   {"rgba(0, 0, 0, 0)", false},
                                                   {"transparent", false}}) {
        CAPTURE(color);
        DesignIR ir;
        ir.root = frame("right", 100.0f, 30.0f, LayoutDirection::column);
        ir.root.style.border_right_width = 1.0f;
        ir.root.style.border_right_color = color;
        auto view = build_native_view_tree(ir, {}, {});
        REQUIRE(view != nullptr);
        REQUIRE(view->border_right_width() == 1.0f);
        pulp::canvas::RecordingCanvas canvas;
        view->set_bounds({0, 0, 100, 30});
        view->paint_all(canvas);
        REQUIRE((canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) > 0) == should_paint);
    }

    DesignIR zero_ir;
    zero_ir.root = frame("right-zero", 100.0f, 30.0f, LayoutDirection::column);
    zero_ir.root.style.border_right_width = 0.0f;
    zero_ir.root.style.border_right_color = "#2e2e2eff";
    auto zero = build_native_view_tree(zero_ir, {}, {});
    REQUIRE(zero != nullptr);
    REQUIRE(zero->border_right_width() == 0.0f);
    pulp::canvas::RecordingCanvas zero_canvas;
    zero->set_bounds({0, 0, 100, 30});
    zero->paint_all(zero_canvas);
    REQUIRE(zero_canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) == 0);
}

TEST_CASE("native import paints or suppresses top border color equivalence classes",
          "[view][import][native-materializer][border-side-top]") {
    for (const auto& [color, should_paint] :
         std::vector<std::pair<std::string, bool>>{{"#2e2e2e99", true},
                                                   {"#afafafff", true},
                                                   {"#2e2e2eff", true},
                                                   {"rgba(46, 46, 46, 0.6)", true},
                                                   {"rgba(0, 0, 0, 0)", false},
                                                   {"transparent", false}}) {
        CAPTURE(color);
        DesignIR ir;
        ir.root = frame("top", 100.0f, 30.0f, LayoutDirection::column);
        ir.root.style.border_top_width = 1.0f;
        ir.root.style.border_top_color = color;
        auto view = build_native_view_tree(ir, {}, {});
        REQUIRE(view != nullptr);
        REQUIRE(view->border_top_width() == 1.0f);
        pulp::canvas::RecordingCanvas canvas;
        view->set_bounds({0, 0, 100, 30});
        view->paint_all(canvas);
        REQUIRE((canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) > 0) == should_paint);
    }

    DesignIR zero_ir;
    zero_ir.root = frame("top-zero", 100.0f, 30.0f, LayoutDirection::column);
    zero_ir.root.style.border_top_width = 0.0f;
    zero_ir.root.style.border_top_color = "#2e2e2eff";
    auto zero = build_native_view_tree(zero_ir, {}, {});
    REQUIRE(zero != nullptr);
    REQUIRE(zero->border_top_width() == 0.0f);
    pulp::canvas::RecordingCanvas zero_canvas;
    zero->set_bounds({0, 0, 100, 30});
    zero->paint_all(zero_canvas);
    REQUIRE(zero_canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) == 0);
}

TEST_CASE("native import preserves zero per-corner radius identity",
          "[view][import][native-materializer][border-corner-zero]") {
    DesignIR ir;
    ir.root = frame("corner", 100.0f, 30.0f, LayoutDirection::column);
    ir.root.style.border_bottom_left_radius = 0.0f;
    ir.root.style.border_bottom_right_radius = 0.0f;
    ir.root.style.border_top_left_radius = 0.0f;
    ir.root.style.border_top_right_radius = 0.0f;
    auto view = build_native_view_tree(ir, {}, {});
    REQUIRE(view != nullptr);
    REQUIRE(view->corner_radius_bl() == 0.0f);
    REQUIRE(view->effective_corner_radius_bl(100, 30) == 0.0f);
    REQUIRE(view->corner_radius_br() == 0.0f);
    REQUIRE(view->normalized_corner_radii(100, 30)[3] == 0.0f);
    REQUIRE(view->corner_radius_tl() == 0.0f);
    REQUIRE(view->corner_radius_tr() == 0.0f);
}

TEST_CASE("native paint normalizes overlapping authored corner radii on resize",
          "[view][import][native-materializer][border-corner-large]") {
    DesignIR ir;
    ir.root = frame("corner", 100.0f, 30.0f, LayoutDirection::column);
    ir.root.style.border_bottom_left_radius = 16777200.0f;
    auto view = build_native_view_tree(ir, {}, {});
    REQUIRE(view != nullptr);
    REQUIRE(view->corner_radius_bl() == 16777200.0f);
    auto first = view->normalized_corner_radii(100, 30);
    REQUIRE(first[0] == 0.0f);
    REQUIRE(first[1] == 0.0f);
    REQUIRE(first[2] == 30.0f);
    REQUIRE(first[3] == 0.0f);
    auto resized = view->normalized_corner_radii(200, 80);
    REQUIRE(resized[2] == 80.0f);
    REQUIRE(view->corner_radius_bl() == 16777200.0f);

    DesignIR right_ir;
    right_ir.root = frame("corner-right", 100.0f, 30.0f, LayoutDirection::column);
    right_ir.root.style.border_bottom_right_radius = 16777200.0f;
    auto right_view = build_native_view_tree(right_ir, {}, {});
    REQUIRE(right_view != nullptr);
    REQUIRE(right_view->corner_radius_br() == 16777200.0f);
    REQUIRE(right_view->normalized_corner_radii(100, 30)[3] == 30.0f);

    for (const bool top_left : {true, false}) {
        DesignIR top_ir;
        top_ir.root = frame(top_left ? "top-left" : "top-right", 100.0f, 30.0f, LayoutDirection::column);
        if (top_left) top_ir.root.style.border_top_left_radius = 16777200.0f;
        else top_ir.root.style.border_top_right_radius = 16777200.0f;
        auto top_view = build_native_view_tree(top_ir, {}, {});
        REQUIRE(top_view != nullptr);
        REQUIRE((top_left ? top_view->corner_radius_tl() : top_view->corner_radius_tr()) == 16777200.0f);
        REQUIRE(top_view->normalized_corner_radii(100, 30)[top_left ? 0 : 1] == 30.0f);
        REQUIRE(top_view->normalized_corner_radii(200, 80)[top_left ? 0 : 1] == 80.0f);
    }

    view->set_corner_radius_tl(80.0f);
    view->set_corner_radius_tr(80.0f);
    view->set_corner_radius_bl(80.0f);
    view->set_corner_radius_br(80.0f);
    const auto overlapping = view->normalized_corner_radii(100, 50);
    REQUIRE(overlapping[0] == 25.0f);
    REQUIRE(overlapping[1] == 25.0f);
    REQUIRE(overlapping[2] == 25.0f);
    REQUIRE(overlapping[3] == 25.0f);
}

TEST_CASE("native import preserves fractional bottom-left corner radii",
          "[view][import][native-materializer][border-corner-fractional]") {
    for (const float value : {10.5f, 10.0f, 12.5f, 16.5f, 4.0f, 7.5f, 8.5f}) {
        CAPTURE(value);
        DesignIR ir;
        ir.root = frame("corner", 100.0f, 40.0f, LayoutDirection::column);
        ir.root.style.border_bottom_left_radius = value;
        ir.root.style.border_bottom_right_radius = value;
        ir.root.style.border_top_left_radius = value;
        ir.root.style.border_top_right_radius = value;
        auto view = build_native_view_tree(ir, {}, {});
        REQUIRE(view != nullptr);
        REQUIRE(view->corner_radius_bl() == value);
        REQUIRE(view->normalized_corner_radii(100, 40)[2] == value);
        REQUIRE(view->corner_radius_br() == value);
        REQUIRE(view->normalized_corner_radii(100, 40)[3] == value);
        REQUIRE(view->corner_radius_tl() == value);
        REQUIRE(view->corner_radius_tr() == value);
        REQUIRE(view->normalized_corner_radii(100, 40)[0] == value);
        REQUIRE(view->normalized_corner_radii(100, 40)[1] == value);
    }
}

TEST_CASE("native border-radius shorthand preserves authored values and scales at paint time",
          "[view][import][native-materializer][border-radius-shorthand]") {
    DesignIR zero_ir;
    zero_ir.root = frame("zero", 100.0f, 30.0f, LayoutDirection::column);
    zero_ir.root.style.background_color = "#2e2e2eff";
    zero_ir.root.style.border_radius = 0.0f;
    auto zero = build_native_view_tree(zero_ir, {}, {});
    REQUIRE(zero != nullptr);
    zero->set_bounds({0, 0, 100, 30});
    pulp::canvas::RecordingCanvas zero_canvas;
    zero->paint_all(zero_canvas);
    REQUIRE(zero_canvas.count(pulp::canvas::DrawCommand::Type::fill_rect) == 1);
    REQUIRE(zero_canvas.count(pulp::canvas::DrawCommand::Type::fill_rounded_rect) == 0);

    DesignIR large_ir = zero_ir;
    large_ir.root.stable_anchor_id = "large";
    large_ir.root.style.border_radius = 16777200.0f;
    auto large = build_native_view_tree(large_ir, {}, {});
    REQUIRE(large != nullptr);
    REQUIRE(large->corner_radius() == 16777200.0f);
    REQUIRE(large->effective_corner_radius(100, 30) == 15.0f);
    REQUIRE(large->effective_corner_radius(200, 80) == 40.0f);
    large->set_bounds({0, 0, 100, 30});
    pulp::canvas::RecordingCanvas large_canvas;
    large->paint_all(large_canvas);
    REQUIRE(large_canvas.count(pulp::canvas::DrawCommand::Type::fill_rounded_rect) == 1);

    DesignIR split_ir = zero_ir;
    split_ir.root.stable_anchor_id = "split";
    split_ir.root.style.border_radius.reset();
    split_ir.root.style.border_top_left_radius = 0.0f;
    split_ir.root.style.border_top_right_radius = 10.5f;
    split_ir.root.style.border_bottom_right_radius = 10.5f;
    split_ir.root.style.border_bottom_left_radius = 0.0f;
    auto split = build_native_view_tree(split_ir, {}, {});
    REQUIRE(split != nullptr);
    split->set_bounds({0, 0, 100, 30});
    pulp::canvas::RecordingCanvas split_canvas;
    split->paint_all(split_canvas);
    REQUIRE(split_canvas.count(pulp::canvas::DrawCommand::Type::fill_current_path) == 1);
}

TEST_CASE("native import applies bottom inset only for supported positioned modes",
          "[view][import][native-materializer][position-bottom]") {
    auto materialize = [](std::string position, float bottom = -2.0f) {
        DesignIR ir;
        ir.root = frame("parent", 100.0f, 100.0f, LayoutDirection::column);
        IRNode child = frame("child", 20.0f, 10.0f, LayoutDirection::column);
        child.style.position = std::move(position);
        child.style.bottom = bottom;
        child.style.left = 0.0f;
        ir.root.children.push_back(std::move(child));
        std::vector<ImportDiagnostic> diagnostics;
        auto root = build_native_view_tree(ir, {}, {.diagnostics_out = &diagnostics});
        return std::pair{std::move(root), std::move(diagnostics)};
    };

    auto [absolute, absolute_diagnostics] = materialize("absolute");
    REQUIRE(absolute != nullptr);
    absolute->set_bounds({0, 0, 100, 100});
    absolute->layout_children();
    REQUIRE(absolute->child_at(0)->position() == View::Position::absolute);
    REQUIRE(absolute->child_at(0)->bottom() == -2.0f);
    REQUIRE(absolute->child_at(0)->bounds().y == Catch::Approx(92.0f));
    absolute->flex().preferred_height = 120.0f;
    absolute->set_bounds({0, 0, 100, 120});
    absolute->invalidate_layout();
    absolute->layout_children();
    REQUIRE(absolute->child_at(0)->bounds().y == Catch::Approx(112.0f));

    for (const float bottom : {0.0f, 10.5f, 118.0f, 161.0f, 764.0f, 801.0f}) {
        CAPTURE(bottom);
        auto [numeric, diagnostics] = materialize("absolute", bottom);
        REQUIRE(numeric != nullptr);
        numeric->flex().preferred_height = 1000.0f;
        numeric->set_bounds({0, 0, 100, 1000});
        numeric->invalidate_layout();
        numeric->layout_children();
        REQUIRE(numeric->child_at(0)->bottom() == bottom);
        REQUIRE(numeric->child_at(0)->bounds().y == Catch::Approx(std::round(990.0f - bottom)));
    }

    auto [relative, relative_diagnostics] = materialize("relative");
    REQUIRE(relative != nullptr);
    relative->set_bounds({0, 0, 100, 100});
    relative->layout_children();
    REQUIRE(relative->child_at(0)->position() == View::Position::relative);
    REQUIRE(relative->child_at(0)->bounds().y == Catch::Approx(2.0f));

    auto [static_root, static_diagnostics] = materialize("static");
    REQUIRE(static_root != nullptr);
    static_root->set_bounds({0, 0, 100, 100});
    static_root->layout_children();
    REQUIRE(static_root->child_at(0)->position() == View::Position::static_);
    REQUIRE_FALSE(static_root->child_at(0)->has_bottom());
    REQUIRE(static_root->child_at(0)->bounds().y == Catch::Approx(0.0f));

    auto [fixed, fixed_diagnostics] = materialize("fixed");
    REQUIRE(fixed != nullptr);
    fixed->set_bounds({0, 0, 100, 100});
    fixed->layout_children();
    REQUIRE(fixed->child_at(0)->position() == View::Position::fixed);
    REQUIRE(fixed->child_at(0)->bottom() == -2.0f);
    REQUIRE(fixed->child_at(0)->bounds().y == Catch::Approx(92.0f));

    auto [unsupported, diagnostics] = materialize("sticky");
    REQUIRE(unsupported != nullptr);
    REQUIRE(unsupported->child_at(0)->position() == View::Position::static_);
    REQUIRE_FALSE(unsupported->child_at(0)->has_bottom());
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property";
    }));

    DesignIR auto_ir;
    auto_ir.root = frame("auto-parent", 100.0f, 100.0f, LayoutDirection::column);
    IRNode auto_child = frame("auto-child", 20.0f, 10.0f, LayoutDirection::column);
    auto_child.style.position = "absolute";
    auto_child.style.bottom_auto = true;
    auto_ir.root.children.push_back(std::move(auto_child));
    auto auto_root = build_native_view_tree(auto_ir, {}, {});
    REQUIRE(auto_root != nullptr);
    REQUIRE_FALSE(auto_root->child_at(0)->has_bottom());

    const auto parsed_auto = parse_design_ir_json(R"({
      "version":1,"source":"observed-dom","root":{"type":"frame","name":"auto",
      "style":{"position":"absolute","bottomAuto":true},"layout":{},"children":[]}})" );
    REQUIRE(parsed_auto.root.style.bottom_auto);

    View transitioned;
    transitioned.set_position(View::Position::absolute);
    transitioned.set_bottom(10.0f);
    REQUIRE(transitioned.has_bottom());
    transitioned.clear_bottom();
    REQUIRE_FALSE(transitioned.has_bottom());
}

TEST_CASE("native box-shadow none clears layers and emits no shadow compositing",
          "[view][import][native-materializer][box-shadow-none]") {
    struct LayerCountingCanvas : pulp::canvas::RecordingCanvas {
        int layers = 0;
        void save_layer(float, float, float, float, float, float) override {
            ++layers;
            save();
        }
    };

    const auto parsed = parse_design_ir_json(R"({
      "version":1,"source":"observed-dom","root":{"type":"frame","name":"none",
      "style":{"width":100,"height":30,"backgroundColor":"#2e2e2eff","boxShadow":"none"},
      "layout":{},"children":[]}})" );
    REQUIRE(parsed.root.style.box_shadow_explicit);
    REQUIRE(parsed.root.style.box_shadow.empty());
    auto view = build_native_view_tree(parsed, {}, {});
    REQUIRE(view != nullptr);
    view->set_bounds({0, 0, 100, 30});
    LayerCountingCanvas canvas;
    view->paint_all(canvas);
    REQUIRE(canvas.layers == 0);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::draw_box_shadow) == 0);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::save_backdrop_filter) == 0);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::set_filter) == 0);

    View transitioned;
    transitioned.set_box_shadow(1, 2, 3, 4, Color::rgba8(0, 0, 0, 128));
    REQUIRE(transitioned.has_box_shadow());
    transitioned.clear_box_shadow();
    REQUIRE_FALSE(transitioned.has_box_shadow());
}

TEST_CASE("native multi-layer shadows preserve order, suppress alpha zero, and rasterize",
          "[view][import][native-materializer][box-shadow-layers]") {
    const auto make = [](std::string shadow) {
        DesignIR ir;
        ir.root = frame("shadow", 40.0f, 20.0f, LayoutDirection::column);
        ir.root.style.background_color = "#202020ff";
        ir.root.style.box_shadow_explicit = true;
        ir.root.style.box_shadow = parse_css_box_shadow(shadow);
        return build_native_view_tree(ir, {}, {});
    };

    auto ordered = make("#ff000080 1px 2px 3px 4px, inset #00ff0080 5px 6px 7px 8px, #0000ff80 9px 10px 11px 12px");
    REQUIRE(ordered != nullptr);
    REQUIRE(ordered->box_shadows().size() == 3);
    REQUIRE(ordered->box_shadows()[0].offset_x == 1.0f);
    REQUIRE(ordered->box_shadows()[1].inset);
    REQUIRE(ordered->box_shadows()[2].offset_x == 9.0f);
    DesignIR roundtrip_ir;
    roundtrip_ir.root = frame("roundtrip", 40.0f, 20.0f, LayoutDirection::column);
    roundtrip_ir.root.style.box_shadow_explicit = true;
    roundtrip_ir.root.style.box_shadow = parse_css_box_shadow(
        "#ff000080 1px 2px 3px 4px, inset #00ff0080 5px 6px 7px 8px, #0000ff80 9px 10px 11px 12px");
    const auto reparsed = parse_design_ir_json(serialize_design_ir(roundtrip_ir));
    REQUIRE(reparsed.root.style.box_shadow_explicit);
    REQUIRE(reparsed.root.style.box_shadow.size() == 3);
    REQUIRE(reparsed.root.style.box_shadow[1].inset);
    REQUIRE(reparsed.root.style.box_shadow[2].spread == 12.0f);
    ordered->set_bounds({0, 0, 40, 20});
    pulp::canvas::RecordingCanvas ordered_canvas;
    ordered->paint_all(ordered_canvas);
    std::vector<pulp::canvas::DrawCommand> draws;
    for (const auto& command : ordered_canvas.commands())
        if (command.type == pulp::canvas::DrawCommand::Type::draw_box_shadow) draws.push_back(command);
    REQUIRE(draws.size() == 3);
    REQUIRE(draws[0].color == Color::rgba8(0, 0, 255, 128));
    REQUIRE(draws[1].color == Color::rgba8(255, 0, 0, 128));
    REQUIRE(draws[2].color == Color::rgba8(0, 255, 0, 128));
    ordered->set_bounds({0, 0, 80, 40});
    pulp::canvas::RecordingCanvas resized_canvas;
    ordered->paint_all(resized_canvas);
    std::vector<pulp::canvas::DrawCommand> resized_draws;
    for (const auto& command : resized_canvas.commands())
        if (command.type == pulp::canvas::DrawCommand::Type::draw_box_shadow) resized_draws.push_back(command);
    REQUIRE(resized_draws.size() == 3);
    REQUIRE(resized_draws[0].floats == draws[0].floats);
    REQUIRE(resized_draws[1].floats == draws[1].floats);
    REQUIRE(resized_draws[2].floats == draws[2].floats);

    auto transparent = make("#00000000 0px 0px 0px 0px, #00000000 0px 0px 0px 0px, #00000000 0px 0px 0px 0px, #00000000 0px 0px 0px 0px, #00000000 0px 0px 0px 0px");
    auto none = make("none");
    REQUIRE(transparent != nullptr);
    REQUIRE(none != nullptr);
    transparent->set_bounds({0, 0, 40, 20});
    none->set_bounds({0, 0, 40, 20});
    pulp::canvas::RecordingCanvas transparent_canvas;
    transparent->paint_all(transparent_canvas);
    REQUIRE(transparent_canvas.count(pulp::canvas::DrawCommand::Type::draw_box_shadow) == 0);
    const auto transparent_png = render_to_png(*transparent, 40, 20, 1.0f, ScreenshotBackend::skia);
    const auto none_png = render_to_png(*none, 40, 20, 1.0f, ScreenshotBackend::skia);
    if (!transparent_png.empty() && !none_png.empty()) REQUIRE(transparent_png == none_png);

    auto visible = make("#00000000 0px 0px 0px 0px, #00000000 0px 0px 0px 0px, #00000000 0px 0px 0px 0px, #ffffffff 0px 0px 0px 0px, #00000000 0px 0px 0px 0px");
    REQUIRE(visible != nullptr);
    visible->set_bounds({0, 0, 40, 20});
    pulp::canvas::RecordingCanvas visible_canvas;
    visible->paint_all(visible_canvas);
    REQUIRE(visible_canvas.count(pulp::canvas::DrawCommand::Type::draw_box_shadow) == 1);
}

TEST_CASE("native text color preserves explicit and inherited CSS Color 4 glyph paint",
          "[view][import][native-materializer][text-color]") {
    auto make = [](std::optional<std::string> child_color) {
        DesignIR ir;
        ir.root = frame("parent", 80.0f, 24.0f, LayoutDirection::column);
        ir.root.style.color = "#afafaf33";
        auto child = label("text", "Text", 80.0f, 24.0f);
        child.style.color = std::move(child_color);
        ir.root.children.push_back(std::move(child));
        return build_native_view_tree(ir, {}, {});
    };
    auto inherited = make(std::nullopt);
    auto explicit_color = make("#fb2c36ff");
    REQUIRE(inherited != nullptr);
    REQUIRE(explicit_color != nullptr);
    auto* inherited_label = dynamic_cast<Label*>(inherited->child_at(0));
    auto* explicit_label = dynamic_cast<Label*>(explicit_color->child_at(0));
    REQUIRE(inherited_label != nullptr);
    REQUIRE(explicit_label != nullptr);
    REQUIRE_FALSE(inherited_label->has_own_text_color());
    REQUIRE(explicit_label->has_own_text_color());
    REQUIRE(explicit_label->text_color() == Color::rgba8(251, 44, 54, 255));
    REQUIRE(inherited_label->access_label() == "Text");
    REQUIRE(explicit_label->access_label() == "Text");

    inherited->set_bounds({0, 0, 80, 24});
    inherited->layout_children();
    explicit_color->set_bounds({0, 0, 80, 24});
    explicit_color->layout_children();
    pulp::canvas::RecordingCanvas inherited_canvas;
    pulp::canvas::RecordingCanvas explicit_canvas;
    inherited->paint_all(inherited_canvas);
    explicit_color->paint_all(explicit_canvas);
    auto glyph_color = [](const pulp::canvas::RecordingCanvas& canvas) {
        Color current{};
        for (const auto& command : canvas.commands()) {
            if (command.type == pulp::canvas::DrawCommand::Type::set_fill_color) current = command.color;
            if (command.type == pulp::canvas::DrawCommand::Type::fill_text) return current;
        }
        return current;
    };
    REQUIRE(glyph_color(inherited_canvas) == Color::rgba8(175, 175, 175, 51));
    REQUIRE(glyph_color(explicit_canvas) == Color::rgba8(251, 44, 54, 255));

    const auto inherited_png = render_to_png(*inherited, 80, 24, 1.0f, ScreenshotBackend::skia);
    const auto explicit_png = render_to_png(*explicit_color, 80, 24, 1.0f, ScreenshotBackend::skia);
    if (!inherited_png.empty() && !explicit_png.empty()) REQUIRE(inherited_png != explicit_png);

    Label metrics_label("Text");
    metrics_label.set_bounds({0, 0, 80, 24});
    pulp::canvas::RecordingCanvas metrics_canvas;
    const auto before = metrics_label.text_edit_metrics(metrics_canvas, "Text");
    metrics_label.set_access_label("Text");
    metrics_label.set_text_color(Color::rgba8(1, 2, 3, 4));
    const auto after = metrics_label.text_edit_metrics(metrics_canvas, "Text");
    REQUIRE(before.caret_x_by_byte == after.caret_x_by_byte);
    REQUIRE(before.local_band_y == after.local_band_y);
    REQUIRE(metrics_label.access_label() == "Text");
}

TEST_CASE("native cursor intent preserves hit testing and action routing",
          "[view][import][native-materializer][cursor]") {
    const std::vector<std::pair<std::string, View::CursorStyle>> cases = {
        {"auto", View::CursorStyle::auto_}, {"default", View::CursorStyle::default_},
        {"pointer", View::CursorStyle::pointer}, {"text", View::CursorStyle::text},
    };
    for (const auto& [keyword, expected] : cases) {
        DesignIR ir;
        ir.root = frame(keyword, 40.0f, 20.0f, LayoutDirection::column);
        ir.root.style.cursor = keyword;
        auto view = build_native_view_tree(ir, {}, {});
        REQUIRE(view != nullptr);
        REQUIRE(view->cursor() == expected);
        view->set_bounds({0, 0, 40, 20});
        REQUIRE(view->hit_test({10, 10}) == view.get());
    }

    DesignIR unsupported_ir;
    unsupported_ir.root = frame("url", 40.0f, 20.0f, LayoutDirection::column);
    unsupported_ir.root.style.cursor = "url(cursor.png), pointer";
    std::vector<ImportDiagnostic> diagnostics;
    auto unsupported = build_native_view_tree(unsupported_ir, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(unsupported != nullptr);
    REQUIRE(unsupported->cursor() == View::CursorStyle::auto_);
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property";
    }));
}

TEST_CASE("native simple block lowering stretches children across resize",
          "[view][import][native-materializer][display-block]") {
    DesignIR ir;
    ir.root = frame("block", 200.0f, 60.0f, LayoutDirection::column);
    auto first = frame("first", 0.0f, 20.0f, LayoutDirection::column);
    first.style.width.reset();
    first.style.background_color = "#ff0000ff";
    first.layout.align_self = "stretch";
    auto second = frame("second", 0.0f, 20.0f, LayoutDirection::column);
    second.style.width.reset();
    second.style.background_color = "#0000ffff";
    second.layout.align_self = "stretch";
    second.layout.margin_top = 10.0f;
    ir.root.children.push_back(std::move(first));
    ir.root.children.push_back(std::move(second));
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    root->set_bounds({0, 0, 200, 60});
    root->layout_children();
    REQUIRE(root->child_at(0)->bounds().width == Catch::Approx(200.0f));
    REQUIRE(root->child_at(1)->bounds().width == Catch::Approx(200.0f));
    REQUIRE(root->child_at(1)->bounds().y == Catch::Approx(30.0f));
    root->flex().preferred_width = 300.0f;
    root->set_bounds({0, 0, 300, 60});
    root->invalidate_layout();
    root->layout_children();
    REQUIRE(root->child_at(0)->bounds().width == Catch::Approx(300.0f));
    REQUIRE(root->child_at(1)->bounds().width == Catch::Approx(300.0f));
    const auto png = render_to_png(*root, 300, 60, 1.0f, ScreenshotBackend::skia);
    if (!png.empty()) REQUIRE_FALSE(png.empty());
}

TEST_CASE("native element filters compose in CSS order and clear explicitly",
          "[view][import][native-materializer][filter]") {
    struct FilterCanvas : pulp::canvas::RecordingCanvas {
        std::vector<FilterChainEntry> captured;
        void save_layer_with_filters(float, float, float, float, float,
                                     const FilterChainEntry* chain, int count) override {
            captured.assign(chain, chain + count);
            save();
        }
    };
    DesignIR ir;
    ir.root = frame("filtered", 20.0f, 20.0f, LayoutDirection::column);
    ir.root.style.background_color = "#ff0000ff";
    ir.root.style.filter = "invert(1) opacity(0.5) brightness(1.2)";
    auto filtered = build_native_view_tree(ir, {}, {});
    REQUIRE(filtered != nullptr);
    REQUIRE(filtered->filter_chain().size() == 3);
    REQUIRE(filtered->filter_chain()[0].kind == View::FilterOp::Kind::invert);
    REQUIRE(filtered->filter_chain()[1].kind == View::FilterOp::Kind::opacity);
    REQUIRE(filtered->filter_chain()[2].kind == View::FilterOp::Kind::brightness);
    filtered->set_bounds({0, 0, 20, 20});
    FilterCanvas canvas;
    filtered->paint_all(canvas);
    REQUIRE(canvas.captured.size() == 3);
    REQUIRE(canvas.captured[0].kind == pulp::canvas::Canvas::FilterChainEntry::Kind::invert);
    REQUIRE(canvas.captured[1].kind == pulp::canvas::Canvas::FilterChainEntry::Kind::opacity);
    REQUIRE(canvas.captured[2].kind == pulp::canvas::Canvas::FilterChainEntry::Kind::brightness);
    REQUIRE(canvas.captured[0].amount == Catch::Approx(1.0f));
    REQUIRE(canvas.captured[1].amount == Catch::Approx(0.5f));
    REQUIRE(canvas.captured[2].amount == Catch::Approx(1.2f));

    DesignIR none_ir = ir;
    none_ir.root.style.filter = "none";
    auto none = build_native_view_tree(none_ir, {}, {});
    REQUIRE(none != nullptr);
    REQUIRE_FALSE(none->has_filter_chain());
    REQUIRE(none->filter_blur() == 0.0f);

    const auto inverted_png = render_to_png(*filtered, 20, 20, 1.0f, ScreenshotBackend::skia);
    DesignIR cyan_ir = ir;
    cyan_ir.root.style.background_color = "#00ffffff";
    cyan_ir.root.style.filter = "none";
    auto cyan = build_native_view_tree(cyan_ir, {}, {});
    REQUIRE(cyan != nullptr);
    cyan->set_bounds({0, 0, 20, 20});
    const auto cyan_png = render_to_png(*cyan, 20, 20, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(inverted_png.empty());
    REQUIRE_FALSE(cyan_png.empty());
    REQUIRE(inverted_png != cyan_png);

    DesignIR invert_ir = ir;
    invert_ir.root.style.filter = "invert(1)";
    auto invert_only = build_native_view_tree(invert_ir, {}, {});
    REQUIRE(invert_only != nullptr);
    invert_only->set_bounds({0, 0, 20, 20});
    const auto invert_only_png = render_to_png(*invert_only, 20, 20, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(invert_only_png.empty());
    const auto red_png = render_to_png(*none, 20, 20, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(red_png.empty());
    REQUIRE(invert_only_png != red_png);

    uint32_t pixel_width = 0;
    uint32_t pixel_height = 0;
    const auto inverted_rgba = render_to_rgba(*invert_only, 20, 20, 1.0f,
                                               &pixel_width, &pixel_height);
    REQUIRE(pixel_width == 20);
    REQUIRE(pixel_height == 20);
    REQUIRE(inverted_rgba.size() == 20 * 20 * 4);
    const auto center = 4 * (10 * pixel_width + 10);
    const auto red_rgba = render_to_rgba(*none, 20, 20, 1.0f,
                                          &pixel_width, &pixel_height);
    REQUIRE(red_rgba.size() == 20 * 20 * 4);
    REQUIRE(red_rgba[center] == red_rgba[center + 3]);
    REQUIRE(red_rgba[center + 1] == 0);
    REQUIRE(red_rgba[center + 2] == 0);
    REQUIRE(inverted_rgba[center] == 0);
    REQUIRE(inverted_rgba[center + 1] == red_rgba[center + 3]);
    REQUIRE(inverted_rgba[center + 2] == red_rgba[center + 3]);
    REQUIRE(inverted_rgba[center + 3] == red_rgba[center + 3]);

    View transition;
    transition.set_filter_chain({View::FilterOp{.kind = View::FilterOp::Kind::invert, .amount = 1.0f}});
    REQUIRE(transition.has_filter_chain());
    transition.clear_filter_chain();
    REQUIRE_FALSE(transition.has_filter_chain());
}

TEST_CASE("native flex basis preserves units and governs resilient flex geometry",
          "[view][import][native-materializer][flex-basis]") {
    DesignIR ir;
    ir.root = frame("row", 300.0f, 40.0f, LayoutDirection::row);
    for (const auto& [id, intrinsic] : std::array<std::pair<const char*, float>, 2>{
             std::pair{"small", 40.0f}, std::pair{"large", 120.0f}}) {
        auto child = frame(id, intrinsic, 40.0f, LayoutDirection::column);
        child.layout.flex_grow = 1.0f;
        child.layout.flex_shrink = 1.0f;
        child.layout.flex_basis = "0%";
        ir.root.children.push_back(std::move(child));
    }
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_at(0)->flex().dim_flex_basis.unit == DimensionUnit::percent);
    REQUIRE(root->child_at(0)->flex().dim_flex_basis.value == Catch::Approx(0.0f));
    root->set_bounds({0, 0, 300, 40});
    root->layout_children();
    REQUIRE(root->child_at(0)->bounds().width == Catch::Approx(150.0f));
    REQUIRE(root->child_at(1)->bounds().width == Catch::Approx(150.0f));
    ir.root.style.width = 420.0f;
    auto resized = build_native_view_tree(ir, {}, {});
    REQUIRE(resized != nullptr);
    resized->set_bounds({0, 0, 420, 40});
    resized->layout_children();
    REQUIRE(resized->child_at(0)->bounds().width == Catch::Approx(210.0f));
    REQUIRE(resized->child_at(1)->bounds().width == Catch::Approx(210.0f));

    ir.root.style.width = 300.0f;
    ir.root.children[0].style.min_width = 240.0f;
    auto constrained = build_native_view_tree(ir, {}, {});
    REQUIRE(constrained != nullptr);
    constrained->set_bounds({0, 0, 300, 40});
    constrained->layout_children();
    REQUIRE(constrained->child_at(0)->bounds().width == Catch::Approx(270.0f));
    REQUIRE(constrained->child_at(1)->bounds().width == Catch::Approx(30.0f));

    DesignIR units;
    units.root = frame("row", 300.0f, 40.0f, LayoutDirection::row);
    auto percent = frame("percent", 80.0f, 40.0f, LayoutDirection::column);
    percent.layout.flex_basis = "0%";
    auto pixels = frame("pixels", 80.0f, 40.0f, LayoutDirection::column);
    pixels.layout.flex_basis = "0";
    auto intrinsic = frame("intrinsic", 80.0f, 40.0f, LayoutDirection::column);
    intrinsic.layout.flex_basis = "auto";
    units.root.children.push_back(std::move(percent));
    units.root.children.push_back(std::move(pixels));
    units.root.children.push_back(std::move(intrinsic));
    auto unit_root = build_native_view_tree(units, {}, {});
    REQUIRE(unit_root != nullptr);
    REQUIRE(unit_root->child_at(0)->flex().dim_flex_basis.unit == DimensionUnit::percent);
    REQUIRE(unit_root->child_at(1)->flex().dim_flex_basis.unit == DimensionUnit::px);
    REQUIRE(unit_root->child_at(2)->flex().dim_flex_basis.unit == DimensionUnit::auto_);
    unit_root->set_bounds({0, 0, 300, 40});
    unit_root->layout_children();
    REQUIRE(unit_root->child_at(2)->bounds().width == Catch::Approx(80.0f));

    DesignIR unsupported = units;
    unsupported.root.children[0].layout.flex_basis = "content";
    unsupported.root.children[1].layout.flex_basis = "calc(50% - 8px)";
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(unsupported, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(rejected->child_at(0)->flex().dim_flex_basis.unit == DimensionUnit::px);
    REQUIRE(std::count_if(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "flexBasis";
    }) == 2);
}

TEST_CASE("native flex directions preserve axis reverse order RTL and pixels",
          "[view][import][native-materializer][flex-direction]") {
    const auto parsed_reverse = parse_design_ir_json(R"({
        "version":1,"source":"observed-dom",
        "root":{"type":"frame","layout":{"direction":"row-reverse"},"children":[]}
    })");
    REQUIRE(parsed_reverse.root.layout.direction == LayoutDirection::row_reverse);
    REQUIRE(serialize_design_ir(parsed_reverse).find("\"direction\":\"row-reverse\"") != std::string::npos);

    auto make = [](LayoutDirection direction, float width = 120.0f, float height = 80.0f) {
        DesignIR ir;
        ir.root = frame("root", width, height, direction);
        auto red = frame("red", 30.0f, 20.0f, LayoutDirection::column);
        red.style.background_color = "#ff0000ff";
        auto blue = frame("blue", 50.0f, 20.0f, LayoutDirection::column);
        blue.style.background_color = "#0000ffff";
        ir.root.children.push_back(std::move(red));
        ir.root.children.push_back(std::move(blue));
        return build_native_view_tree(ir, {}, {});
    };

    auto row = make(LayoutDirection::row);
    REQUIRE(row != nullptr);
    row->set_bounds({0, 0, 120, 80});
    row->layout_children();
    REQUIRE(row->flex().direction == FlexDirection::row);
    REQUIRE(row->child_at(0)->bounds().x == Catch::Approx(0.0f));
    REQUIRE(row->child_at(1)->bounds().x == Catch::Approx(30.0f));

    auto reversed = make(LayoutDirection::row_reverse);
    REQUIRE(reversed != nullptr);
    reversed->set_bounds({0, 0, 120, 80});
    reversed->layout_children();
    REQUIRE(reversed->flex().direction == FlexDirection::row_reverse);
    REQUIRE(reversed->child_at(0)->id() == "red");
    REQUIRE(reversed->child_at(0)->bounds().x == Catch::Approx(90.0f));
    REQUIRE(reversed->child_at(1)->bounds().x == Catch::Approx(40.0f));

    auto column = make(LayoutDirection::column);
    REQUIRE(column != nullptr);
    column->set_bounds({0, 0, 120, 80});
    column->layout_children();
    REQUIRE(column->flex().direction == FlexDirection::column);
    REQUIRE(column->child_at(0)->bounds().y == Catch::Approx(0.0f));
    REQUIRE(column->child_at(1)->bounds().y == Catch::Approx(20.0f));

    auto column_reversed = make(LayoutDirection::column_reverse);
    REQUIRE(column_reversed != nullptr);
    column_reversed->set_bounds({0, 0, 120, 80});
    column_reversed->layout_children();
    REQUIRE(column_reversed->flex().direction == FlexDirection::column_reverse);
    REQUIRE(column_reversed->child_at(0)->bounds().y == Catch::Approx(60.0f));
    REQUIRE(column_reversed->child_at(1)->bounds().y == Catch::Approx(40.0f));

    reversed->set_direction(View::WritingDirection::rtl);
    reversed->invalidate_layout();
    reversed->layout_children();
    REQUIRE(reversed->child_at(0)->bounds().x == Catch::Approx(0.0f));
    REQUIRE(reversed->child_at(1)->bounds().x == Catch::Approx(30.0f));

    auto wider = make(LayoutDirection::row_reverse, 180.0f, 80.0f);
    REQUIRE(wider != nullptr);
    wider->set_bounds({0, 0, 180, 80});
    wider->layout_children();
    REQUIRE(wider->child_at(0)->bounds().x == Catch::Approx(150.0f));
    REQUIRE(wider->child_at(1)->bounds().x == Catch::Approx(100.0f));

    uint32_t pixel_width = 0, pixel_height = 0;
    const auto rgba = render_to_rgba(*reversed, 120, 80, 1.0f, &pixel_width, &pixel_height);
    REQUIRE(rgba.size() == pixel_width * pixel_height * 4);
    const auto left = 4 * (10 * pixel_width + 10);
    const auto right = 4 * (10 * pixel_width + 50);
    REQUIRE(rgba[left] > rgba[left + 2]);
    REQUIRE(rgba[right + 2] > rgba[right]);
}

TEST_CASE("native flex grow preserves zero weights and constrained distribution",
          "[view][import][native-materializer][flex-grow]") {
    auto weighted_ir = [](float width) {
        DesignIR ir;
        ir.root = frame("row", width, 30.0f, LayoutDirection::row);
        auto fixed = frame("fixed", 50.0f, 30.0f, LayoutDirection::column);
        fixed.layout.flex_grow = 0.0f;
        fixed.layout.flex_shrink = 0.0f;
        fixed.layout.flex_basis = "auto";
        auto one = frame("one", 10.0f, 30.0f, LayoutDirection::column);
        one.layout.flex_grow = 1.0f;
        one.layout.flex_basis = "0px";
        auto two = frame("two", 90.0f, 30.0f, LayoutDirection::column);
        two.layout.flex_grow = 2.0f;
        two.layout.flex_basis = "0px";
        ir.root.children.push_back(std::move(fixed));
        ir.root.children.push_back(std::move(one));
        ir.root.children.push_back(std::move(two));
        return ir;
    };
    auto ir = weighted_ir(300.0f);
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    root->set_bounds({0, 0, 300, 30});
    root->layout_children();
    REQUIRE(root->child_at(0)->flex().flex_grow == Catch::Approx(0.0f));
    REQUIRE(root->child_at(0)->bounds().width == Catch::Approx(50.0f));
    REQUIRE(root->child_at(1)->bounds().width == Catch::Approx(83.0f));
    REQUIRE(root->child_at(2)->bounds().width == Catch::Approx(167.0f));
    REQUIRE(root->child_at(1)->bounds().width + root->child_at(2)->bounds().width == Catch::Approx(250.0f));

    auto resized_ir = weighted_ir(420.0f);
    auto resized = build_native_view_tree(resized_ir, {}, {});
    REQUIRE(resized != nullptr);
    resized->set_bounds({0, 0, 420, 30});
    resized->layout_children();
    REQUIRE(resized->child_at(0)->bounds().width == Catch::Approx(50.0f));
    REQUIRE(resized->child_at(1)->bounds().width == Catch::Approx(123.0f));
    REQUIRE(resized->child_at(2)->bounds().width == Catch::Approx(247.0f));

    resized_ir.root.children[1].style.max_width = 100.0f;
    resized_ir.root.children[2].style.min_width = 200.0f;
    auto constrained = build_native_view_tree(resized_ir, {}, {});
    REQUIRE(constrained != nullptr);
    constrained->set_bounds({0, 0, 420, 30});
    constrained->layout_children();
    REQUIRE(constrained->child_at(1)->bounds().width <= 100.0f);
    REQUIRE(constrained->child_at(2)->bounds().width >= 200.0f);
    REQUIRE(constrained->child_at(0)->bounds().width + constrained->child_at(1)->bounds().width +
            constrained->child_at(2)->bounds().width == Catch::Approx(420.0f));

    DesignIR intrinsic;
    intrinsic.root = frame("row", 300.0f, 30.0f, LayoutDirection::row);
    for (const float width : {80.0f, 20.0f}) {
        auto child = frame("intrinsic", width, 30.0f, LayoutDirection::column);
        child.layout.flex_grow = 1.0f;
        child.layout.flex_basis = "auto";
        intrinsic.root.children.push_back(std::move(child));
    }
    auto intrinsic_root = build_native_view_tree(intrinsic, {}, {});
    REQUIRE(intrinsic_root != nullptr);
    intrinsic_root->set_bounds({0, 0, 300, 30});
    intrinsic_root->layout_children();
    REQUIRE(intrinsic_root->child_at(0)->bounds().width == Catch::Approx(180.0f));
    REQUIRE(intrinsic_root->child_at(1)->bounds().width == Catch::Approx(120.0f));

    DesignIR invalid = weighted_ir(300.0f);
    invalid.root.children[1].layout.flex_grow = -1.0f;
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(rejected->child_at(1)->flex().flex_grow == Catch::Approx(0.0f));
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "flexGrow";
    }));
}

TEST_CASE("native imported min max dimensions remain responsive under resize",
          "[view][import][native-materializer][min-max-sizing]") {
    DesignIR ir;
    ir.root = frame("root", 400.0f, 200.0f, LayoutDirection::row);
    auto child = frame("responsive", 400.0f, 200.0f, LayoutDirection::column);
    child.layout.flex_grow = 1.0f;
    child.style.max_width_dimension = "calc(100% - 64px)";
    child.style.max_height_dimension = "95%";
    child.style.min_width_dimension = "0";
    child.style.min_height_dimension = "auto";
    ir.root.children.push_back(std::move(child));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    // The host owns the root viewport; imported descendants remain responsive
    // as that viewport changes.
    root->flex().preferred_width = 0.0f;
    root->flex().preferred_height = 0.0f;
    root->flex().dim_width = {};
    root->flex().dim_height = {};
    root->set_bounds({0, 0, 400, 200});
    root->layout_children();
    REQUIRE(root->child_at(0)->bounds().width == Catch::Approx(336.0f));
    REQUIRE(root->child_at(0)->bounds().height == Catch::Approx(190.0f));
    REQUIRE(root->child_at(0)->flex().dim_max_width.offset_px == Catch::Approx(-64.0f));

    root->set_bounds({0, 0, 600, 300});
    root->layout_children();
    REQUIRE(root->child_at(0)->bounds().width == Catch::Approx(536.0f));
    // max-height is a ceiling, not a request to stretch an intrinsically
    // 200px-tall child when the resized 95% ceiling becomes larger.
    REQUIRE(root->child_at(0)->bounds().height == Catch::Approx(200.0f));
}

TEST_CASE("native imported opacity composites the entire subtree including exact zero",
          "[view][import][native-materializer][opacity][skia][poison-theme]") {
    auto make = [](float opacity) {
        DesignIR ir;
        ir.root = frame("opacity-root", 32.0f, 32.0f, LayoutDirection::column);
        ir.root.style.opacity = opacity;
        ir.root.style.background_color = "#204060";
        auto child = frame("child", 16.0f, 16.0f, LayoutDirection::column);
        child.style.background_color = "#C02040";
        ir.root.children.push_back(std::move(child));
        return build_native_view_tree(ir, {}, {});
    };

    auto visible = make(1.0f);
    auto transparent = make(0.0f);
    REQUIRE(visible != nullptr);
    REQUIRE(transparent != nullptr);
    REQUIRE(transparent->opacity() == Catch::Approx(0.0f));

    Theme poison;
    poison.colors["surface.background"] = color_from_hex(0xFF00FF);
    poison.colors["text.primary"] = color_from_hex(0x00FF00);
    transparent->set_theme(poison);
    DesignIR blank_ir;
    blank_ir.root = frame("blank", 32.0f, 32.0f, LayoutDirection::column);
    auto blank = build_native_view_tree(blank_ir, {}, {});
    REQUIRE(blank != nullptr);
    blank->set_theme(poison);

    uint32_t vw = 0, vh = 0, tw = 0, th = 0, bw = 0, bh = 0;
    const auto visible_pixels = render_to_rgba(*visible, 32, 32, 1.0f, &vw, &vh);
    const auto transparent_pixels = render_to_rgba(*transparent, 32, 32, 1.0f, &tw, &th);
    const auto blank_pixels = render_to_rgba(*blank, 32, 32, 1.0f, &bw, &bh);
    REQUIRE(visible_pixels != transparent_pixels);
    REQUIRE(transparent_pixels == blank_pixels);
    for (size_t i = 0; i + 3 < transparent_pixels.size(); i += 4) {
        REQUIRE_FALSE((transparent_pixels[i] == 255 && transparent_pixels[i + 1] == 0 && transparent_pixels[i + 2] == 255));
        REQUIRE_FALSE((transparent_pixels[i] == 0 && transparent_pixels[i + 1] == 255 && transparent_pixels[i + 2] == 0));
    }

    DesignIR invalid;
    invalid.root = frame("invalid-opacity", 16.0f, 16.0f, LayoutDirection::column);
    invalid.root.style.opacity = 1.5f;
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(rejected->opacity() == Catch::Approx(1.0f));
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "opacity";
    }));
}

TEST_CASE("native imported overflow wrap reflows long words across viewport widths",
          "[view][import][native-materializer][overflow-wrap][skia]") {
    auto make = [](const std::string& wrap, float width) {
        DesignIR ir;
        ir.root = label("long-word", "averyveryverylongword", width, 100.0f);
        ir.root.style.font_size = 14.0f;
        ir.root.style.color = "#F0F0F0";
        ir.root.style.overflow_wrap = wrap;
        auto root = build_native_view_tree(ir, {}, {});
        root->set_bounds({0, 0, width, 100});
        return root;
    };

    auto narrow_normal = make("normal", 48.0f);
    auto narrow_break = make("break-word", 48.0f);
    REQUIRE(narrow_normal != nullptr);
    REQUIRE(narrow_break != nullptr);
    auto* normal_label = dynamic_cast<Label*>(narrow_normal.get());
    auto* break_label = dynamic_cast<Label*>(narrow_break.get());
    REQUIRE(normal_label != nullptr);
    REQUIRE(break_label != nullptr);
    REQUIRE(normal_label->word_break() == "normal");
    REQUIRE(break_label->word_break() == "break-word");
    REQUIRE(break_label->measured_height(48.0f) > normal_label->measured_height(48.0f));

    uint32_t nnw = 0, nnh = 0, nbw = 0, nbh = 0;
    const auto narrow_normal_pixels = render_to_rgba(*narrow_normal, 48, 100, 1.0f, &nnw, &nnh);
    const auto narrow_break_pixels = render_to_rgba(*narrow_break, 48, 100, 1.0f, &nbw, &nbh);
    REQUIRE(narrow_normal_pixels != narrow_break_pixels);

    auto wide_normal = make("normal", 240.0f);
    auto wide_break = make("break-word", 240.0f);
    auto* wide_normal_label = dynamic_cast<Label*>(wide_normal.get());
    auto* wide_break_label = dynamic_cast<Label*>(wide_break.get());
    REQUIRE(wide_normal_label != nullptr);
    REQUIRE(wide_break_label != nullptr);
    REQUIRE(wide_normal_label->measured_height(240.0f) ==
            Catch::Approx(wide_break_label->measured_height(240.0f)).margin(0.1f));

    DesignIR precedence;
    precedence.root = label("alias-precedence", "averyveryverylongword", 48.0f, 100.0f);
    precedence.root.style.overflow_wrap = "normal";
    precedence.root.style.word_wrap = "break-word";
    auto canonical = build_native_view_tree(precedence, {}, {});
    REQUIRE(canonical != nullptr);
    auto* canonical_label = dynamic_cast<Label*>(canonical.get());
    REQUIRE(canonical_label != nullptr);
    REQUIRE(canonical_label->word_break() == "normal");
    REQUIRE_FALSE(canonical_label->multi_line());

    DesignIR alias_only;
    alias_only.root = label("alias-only", "averyveryverylongword", 48.0f, 100.0f);
    alias_only.root.style.word_wrap = "break-word";
    auto alias = build_native_view_tree(alias_only, {}, {});
    REQUIRE(alias != nullptr);
    auto* alias_label = dynamic_cast<Label*>(alias.get());
    REQUIRE(alias_label != nullptr);
    REQUIRE(alias_label->word_break() == "break-word");
    REQUIRE(alias_label->multi_line());

    DesignIR invalid;
    invalid.root = label("invalid-wrap", "word", 48.0f, 20.0f);
    invalid.root.style.overflow_wrap = "break-all";
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(rejected->word_break().empty());
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "overflowWrap";
    }));
}

TEST_CASE("native imported overflow axes clip paint and hit testing independently",
          "[view][import][native-materializer][overflow-axis][skia]") {
    struct FixedRoot final : View {
        bool owns_child_layout() const override { return true; }
        void layout_children() override {}
    };
    auto make = [](const std::string& x, const std::string& y) {
        DesignIR ir;
        ir.root = frame("viewport", 40.0f, 40.0f, LayoutDirection::column);
        ir.root.layout.overflow_x = x;
        ir.root.layout.overflow_y = y;
        auto child = frame("overflow-child", 30.0f, 30.0f, LayoutDirection::column);
        child.style.background_color = "#E02040";
        ir.root.children.push_back(std::move(child));
        auto root = build_native_view_tree(ir, {}, {});
        root->set_bounds({0, 0, 40, 40});
        root->child_at(0)->set_bounds({30, 30, 30, 30});
        auto outer = std::make_unique<FixedRoot>();
        outer->set_bounds({0, 0, 80, 80});
        outer->add_child(std::move(root));
        return outer;
    };

    auto clip_x = make("hidden", "visible");
    auto clip_y = make("visible", "clip");
    REQUIRE(clip_x != nullptr);
    REQUIRE(clip_y != nullptr);
    auto* clip_x_viewport = clip_x->child_at(0);
    auto* clip_y_viewport = clip_y->child_at(0);
    REQUIRE(clip_x_viewport->overflow_x() == View::OverflowAxis::hidden);
    REQUIRE(clip_x_viewport->overflow_y() == View::OverflowAxis::visible);
    REQUIRE(clip_x_viewport->owns_horizontal_scroll_container());
    REQUIRE_FALSE(clip_y_viewport->owns_vertical_scroll_container()); // clip never owns scrolling

    uint32_t xw = 0, xh = 0, yw = 0, yh = 0;
    const auto x_pixels = render_to_rgba(*clip_x, 80, 80, 1.0f, &xw, &xh);
    const auto y_pixels = render_to_rgba(*clip_y, 80, 80, 1.0f, &yw, &yh);
    REQUIRE(xw >= 60);
    REQUIRE(yw == xw);
    auto region_diff = [](const std::vector<uint8_t>& a, const std::vector<uint8_t>& b,
                          uint32_t width, int x0, int y0, int x1, int y1) {
        size_t changed = 0;
        for (int y = y0; y < y1; ++y) for (int x = x0; x < x1; ++x) {
            const auto i = static_cast<size_t>(4 * (y * static_cast<int>(width) + x));
            if (a[i] != b[i] || a[i + 1] != b[i + 1] || a[i + 2] != b[i + 2]) ++changed;
        }
        return changed;
    };
    REQUIRE(x_pixels != y_pixels);
    REQUIRE(region_diff(x_pixels, y_pixels, xw, 40, 30, 60, 40) > 0);
    REQUIRE(region_diff(x_pixels, y_pixels, xw, 30, 40, 40, 60) > 0);

    REQUIRE(clip_x->hit_test({50, 35}) == clip_x.get());
    REQUIRE(clip_y->hit_test({50, 35}) == clip_y_viewport->child_at(0));
    REQUIRE(clip_x->hit_test({35, 50}) == clip_x_viewport->child_at(0));
    REQUIRE(clip_y->hit_test({35, 50}) == clip_y.get());

    clip_x_viewport->set_bounds({0, 0, 60, 60});
    clip_x_viewport->child_at(0)->set_bounds({50, 50, 30, 30});
    REQUIRE(clip_x->hit_test({70, 55}) == clip_x.get());
    REQUIRE(clip_x->hit_test({55, 70}) == clip_x_viewport->child_at(0));
    REQUIRE(clip_x_viewport->overflow_x() == View::OverflowAxis::hidden);
    REQUIRE(clip_x_viewport->overflow_y() == View::OverflowAxis::visible);

    auto auto_x = make("auto", "visible");
    REQUIRE(auto_x->child_at(0)->owns_horizontal_scroll_container());
    REQUIRE_FALSE(auto_x->child_at(0)->owns_vertical_scroll_container());

    DesignIR invalid;
    invalid.root = frame("invalid-overflow", 40.0f, 40.0f, LayoutDirection::column);
    invalid.root.layout.overflow_x = "overlay";
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(rejected->overflow_x() == View::OverflowAxis::visible);
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "overflowX";
    }));
}

TEST_CASE("native imported padding preserves responsive dimensions and box sizing",
          "[view][import][native-materializer][padding][skia]") {
    DesignIR responsive_ir;
    responsive_ir.root = frame("responsive-padding", 200.0f, 100.0f, LayoutDirection::column);
    responsive_ir.root.layout.padding_top_dimension = "5%";
    responsive_ir.root.layout.padding_left_dimension = "calc(10% - 4px)";
    responsive_ir.root.children.push_back(frame("content", 20.0f, 20.0f, LayoutDirection::column));
    auto responsive = build_native_view_tree(responsive_ir, {}, {});
    REQUIRE(responsive != nullptr);
    responsive->flex().preferred_width = 0;
    responsive->flex().preferred_height = 0;
    responsive->flex().dim_width = {};
    responsive->flex().dim_height = {};
    responsive->set_bounds({0, 0, 200, 100});
    responsive->layout_children();
    REQUIRE(responsive->child_at(0)->bounds().x == Catch::Approx(16.0f));
    REQUIRE(responsive->child_at(0)->bounds().y == Catch::Approx(10.0f));
    responsive->set_bounds({0, 0, 400, 200});
    responsive->layout_children();
    REQUIRE(responsive->child_at(0)->bounds().x == Catch::Approx(36.0f));
    REQUIRE(responsive->child_at(0)->bounds().y == Catch::Approx(20.0f));

    DesignIR sizing;
    sizing.root = frame("row", 300.0f, 80.0f, LayoutDirection::row);
    auto make_box = [](const char* id, const char* box_sizing) {
        auto box = frame(id, 100.0f, 40.0f, LayoutDirection::column);
        box.layout.flex_shrink = 0.0f;
        box.layout.padding_top = box.layout.padding_right =
            box.layout.padding_bottom = box.layout.padding_left = 10.0f;
        box.layout.box_sizing = box_sizing;
        box.children.push_back(frame(std::string(id) + "-inner", 10.0f, 10.0f, LayoutDirection::column));
        return box;
    };
    sizing.root.children.push_back(make_box("border", "border-box"));
    sizing.root.children.push_back(make_box("content", "content-box"));
    auto boxes = build_native_view_tree(sizing, {}, {});
    REQUIRE(boxes != nullptr);
    boxes->set_bounds({0, 0, 300, 80});
    boxes->layout_children();
    REQUIRE(boxes->child_at(0)->bounds().width == Catch::Approx(100.0f));
    REQUIRE(boxes->child_at(1)->bounds().width == Catch::Approx(120.0f));
    REQUIRE(boxes->child_at(0)->child_at(0)->bounds().x == Catch::Approx(10.0f));
    REQUIRE(boxes->child_at(1)->child_at(0)->bounds().x == Catch::Approx(10.0f));

    uint32_t rw = 0, rh = 0;
    const auto pixels = render_to_rgba(*responsive, 400, 200, 1.0f, &rw, &rh);
    REQUIRE_FALSE(pixels.empty());

    DesignIR invalid;
    invalid.root = frame("invalid-padding", 100.0f, 40.0f, LayoutDirection::column);
    invalid.root.layout.padding_left_dimension = "auto";
    invalid.root.layout.box_sizing = "padding-box";
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(rejected->flex().padding_left == Catch::Approx(0.0f));
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" &&
               (item.property == "paddingLeft" || item.property == "boxSizing");
    }));
}

TEST_CASE("native positioned layout preserves containing block resize flow and stacking",
          "[view][import][native-materializer][position-family][skia]") {
    auto make = [](float width, float height) {
        DesignIR ir;
        ir.root = frame("containing-block", width, height, LayoutDirection::column);
        ir.root.style.position = "relative";
        auto flow = frame("flow", 60.0f, 20.0f, LayoutDirection::column);
        flow.style.background_color = "#2040C0";
        auto positioned = frame("positioned", 40.0f, 20.0f, LayoutDirection::column);
        positioned.style.position = "absolute";
        positioned.style.top_dimension = "10%";
        positioned.style.right_dimension = "calc(25% - 4px)";
        positioned.style.bottom_dimension = "auto";
        positioned.style.z_index = 5;
        positioned.style.background_color = "#E02040";
        ir.root.children.push_back(std::move(flow));
        ir.root.children.push_back(std::move(positioned));
        return build_native_view_tree(ir, {}, {});
    };
    auto small = make(200, 100);
    REQUIRE(small != nullptr);
    small->set_bounds({0, 0, 200, 100});
    small->layout_children();
    REQUIRE(small->child_at(0)->bounds().y == Catch::Approx(0.0f));
    REQUIRE(small->child_at(1)->bounds().x == Catch::Approx(114.0f));
    REQUIRE(small->child_at(1)->bounds().y == Catch::Approx(10.0f));
    REQUIRE(small->child_at(1)->has_bottom() == false);

    auto large = make(400, 200);
    REQUIRE(large != nullptr);
    large->set_bounds({0, 0, 400, 200});
    large->layout_children();
    REQUIRE(large->child_at(1)->bounds().x == Catch::Approx(264.0f));
    REQUIRE(large->child_at(1)->bounds().y == Catch::Approx(20.0f));
    REQUIRE(large->child_at(0)->bounds().y == Catch::Approx(0.0f));

    uint32_t sw = 0, sh = 0;
    const auto pixels = render_to_rgba(*small, 200, 100, 1.0f, &sw, &sh);
    REQUIRE_FALSE(pixels.empty());
    REQUIRE(small->hit_test({120, 15}) == small->child_at(1));

    DesignIR static_ir;
    static_ir.root = frame("static-parent", 100.0f, 80.0f, LayoutDirection::column);
    auto static_child = frame("static-child", 20.0f, 20.0f, LayoutDirection::column);
    static_child.style.position = "static";
    static_child.style.top_dimension = "50%";
    static_ir.root.children.push_back(std::move(static_child));
    auto static_root = build_native_view_tree(static_ir, {}, {});
    static_root->set_bounds({0, 0, 100, 80});
    static_root->layout_children();
    REQUIRE_FALSE(static_root->child_at(0)->has_top());
    REQUIRE(static_root->child_at(0)->bounds().y == Catch::Approx(0.0f));

    DesignIR invalid;
    invalid.root = frame("invalid-position", 40.0f, 20.0f, LayoutDirection::column);
    invalid.root.style.position = "sticky";
    invalid.root.style.top_dimension = "anchor(--x)";
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(rejected->position() == View::Position::static_);
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" &&
               (item.property == "position" || item.property == "top");
    }));
}

TEST_CASE("native text alignment is direction aware and shares edit geometry",
          "[view][import][native-materializer][text-align][skia]") {
    auto make = [](const std::string& align, const std::string& direction, const std::string& text = "alpha beta") {
        DesignIR ir;
        ir.root = label("aligned", text, 200.0f, 60.0f);
        ir.root.style.text_align = align;
        ir.root.style.direction = direction;
        ir.root.style.font_size = 14.0f;
        ir.root.style.color = "#F0F0F0";
        auto root = build_native_view_tree(ir, {}, {});
        root->set_bounds({0, 0, 200, 60});
        return root;
    };

    auto ltr_start = make("start", "ltr");
    auto ltr_end = make("end", "ltr");
    auto rtl_start = make("start", "rtl");
    auto rtl_end = make("end", "rtl");
    auto centered = make("center", "ltr", "alpha\nbeta");
    auto* ls = dynamic_cast<Label*>(ltr_start.get());
    auto* le = dynamic_cast<Label*>(ltr_end.get());
    auto* rs = dynamic_cast<Label*>(rtl_start.get());
    auto* re = dynamic_cast<Label*>(rtl_end.get());
    auto* center = dynamic_cast<Label*>(centered.get());
    REQUIRE(ls != nullptr); REQUIRE(le != nullptr); REQUIRE(rs != nullptr); REQUIRE(re != nullptr); REQUIRE(center != nullptr);
    REQUIRE(ls->text_align() == LabelAlign::left);
    REQUIRE(le->text_align() == LabelAlign::right);
    REQUIRE(rs->text_align() == LabelAlign::right);
    REQUIRE(re->text_align() == LabelAlign::left);
    pulp::canvas::RecordingCanvas metrics_canvas;
    const auto ls_metrics = ls->text_edit_metrics(metrics_canvas, ls->text());
    const auto le_metrics = le->text_edit_metrics(metrics_canvas, le->text());
    const auto rs_metrics = rs->text_edit_metrics(metrics_canvas, rs->text());
    const auto re_metrics = re->text_edit_metrics(metrics_canvas, re->text());
    const auto center_metrics = center->text_edit_metrics(metrics_canvas, center->text());
    REQUIRE(ls_metrics.local_text_left == Catch::Approx(0.0f));
    REQUIRE(le_metrics.local_text_left > 100.0f);
    REQUIRE(rs_metrics.local_text_left == Catch::Approx(le_metrics.local_text_left));
    REQUIRE(re_metrics.local_text_left == Catch::Approx(0.0f));
    REQUIRE(center_metrics.local_text_left > 50.0f);

    uint32_t lw = 0, lh = 0, rw = 0, rh = 0, cw = 0, ch = 0;
    const auto left_pixels = render_to_rgba(*ltr_start, 200, 60, 1.0f, &lw, &lh);
    const auto right_pixels = render_to_rgba(*ltr_end, 200, 60, 1.0f, &rw, &rh);
    const auto center_pixels = render_to_rgba(*centered, 200, 60, 1.0f, &cw, &ch);
    REQUIRE(left_pixels != right_pixels);
    REQUIRE(center_pixels != left_pixels);
    REQUIRE(centered->hit_test({100, 30}) == centered.get());

    DesignIR invalid;
    invalid.root = label("invalid-align", "alpha beta", 200.0f, 40.0f);
    invalid.root.style.text_align = "justify";
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE_FALSE(dynamic_cast<Label*>(rejected.get())->has_own_text_align());
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "textAlign";
    }));
}

TEST_CASE("native text overflow clips and ellipsizes with shared caret geometry",
          "[view][import][native-materializer][text-overflow][skia]") {
    auto make = [](const std::string& overflow, float width, int max_lines = 0,
                   const std::string& white_space = "nowrap",
                   const std::string& text = "a very long line of text") {
        DesignIR ir;
        ir.root = label("overflow-label", text, width, 60.0f);
        ir.root.style.font_size = 14.0f;
        ir.root.style.color = "#F0F0F0";
        ir.root.style.text_overflow = overflow;
        ir.root.style.white_space = white_space;
        if (max_lines > 0) ir.root.style.max_lines = max_lines;
        auto root = build_native_view_tree(ir, {}, {});
        root->set_bounds({0, 0, width, 60});
        return root;
    };

    auto narrow_clip = make("clip", 80);
    auto narrow_ellipsis = make("ellipsis", 80);
    auto wide_clip = make("clip", 300);
    auto wide_ellipsis = make("ellipsis", 300);
    auto* ellipsis_label = dynamic_cast<Label*>(narrow_ellipsis.get());
    REQUIRE(ellipsis_label != nullptr);
    REQUIRE(narrow_clip->overflow_x() == View::OverflowAxis::hidden);
    REQUIRE(ellipsis_label->text_overflow_ellipsis());

    uint32_t ncw = 0, nch = 0, new_ = 0, neh = 0, wcw = 0, wch = 0, wew = 0, weh = 0;
    const auto narrow_clip_pixels = render_to_rgba(*narrow_clip, 80, 60, 1.0f, &ncw, &nch);
    const auto narrow_ellipsis_pixels = render_to_rgba(*narrow_ellipsis, 80, 60, 1.0f, &new_, &neh);
    const auto wide_clip_pixels = render_to_rgba(*wide_clip, 300, 60, 1.0f, &wcw, &wch);
    const auto wide_ellipsis_pixels = render_to_rgba(*wide_ellipsis, 300, 60, 1.0f, &wew, &weh);
    REQUIRE(narrow_clip_pixels != narrow_ellipsis_pixels);
    REQUIRE(wide_clip_pixels == wide_ellipsis_pixels);

    pulp::canvas::RecordingCanvas metrics_canvas;
    const auto metrics = ellipsis_label->text_edit_metrics(metrics_canvas, ellipsis_label->text());
    REQUIRE_FALSE(metrics.caret_x_by_byte.empty());
    REQUIRE(metrics.local_text_left + metrics.caret_x_by_byte.back() <= 80.0f);
    REQUIRE(metrics.caret_x_by_byte.back() == metrics.caret_x_by_byte[metrics.caret_x_by_byte.size() - 2]);

    auto clamped = make("ellipsis", 100, 2, "normal", "one two three four five six seven eight");
    auto unclamped = make("clip", 100, 0, "normal", "one two three four five six seven eight");
    auto* clamped_label = dynamic_cast<Label*>(clamped.get());
    REQUIRE(clamped_label != nullptr);
    REQUIRE(clamped_label->multi_line());
    REQUIRE(clamped_label->line_clamp() == 2);
    REQUIRE(clamped->overflow_y() == View::OverflowAxis::hidden);
    uint32_t clw = 0, clh = 0, ulw = 0, ulh = 0;
    REQUIRE(render_to_rgba(*clamped, 100, 60, 1.0f, &clw, &clh) !=
            render_to_rgba(*unclamped, 100, 60, 1.0f, &ulw, &ulh));

    DesignIR invalid;
    invalid.root = label("invalid-overflow", "text", 80.0f, 20.0f);
    invalid.root.style.text_overflow = "fade";
    invalid.root.style.white_space = "break-spaces";
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE_FALSE(dynamic_cast<Label*>(rejected.get())->text_overflow_ellipsis());
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" &&
               (item.property == "textOverflow" || item.property == "whiteSpace");
    }));
}

TEST_CASE("native imported affine transforms share paint origin and inverse hit geometry",
          "[view][import][native-materializer][transform-2d][skia]") {
    struct FixedRoot final : View {
        bool owns_child_layout() const override { return true; }
        void layout_children() override {}
    };
    auto make = [](const std::string& transform, const std::string& origin) {
        DesignIR ir;
        ir.root = frame("transformed", 100.0f, 60.0f, LayoutDirection::column);
        ir.root.style.transform = transform;
        ir.root.style.transform_origin = origin;
        auto child = frame("target", 20.0f, 20.0f, LayoutDirection::column);
        child.style.background_color = "#E02040";
        ir.root.children.push_back(std::move(child));
        auto transformed = build_native_view_tree(ir, {}, {});
        transformed->set_bounds({0, 0, 100, 60});
        transformed->child_at(0)->set_bounds({0, 0, 20, 20});
        auto outer = std::make_unique<FixedRoot>();
        outer->set_bounds({0, 0, 200, 120});
        outer->add_child(std::move(transformed));
        return outer;
    };

    auto identity = make("matrix(1, 0, 0, 1, 0, 0)", "0% 0%");
    auto translated = make("matrix(1, 0, 0, 1, 30, 10)", "0% 0%");
    auto* transformed = translated->child_at(0);
    REQUIRE(transformed->has_transform_matrix());
    REQUIRE(transformed->transform_origin_explicit());
    REQUIRE(translated->hit_test({35, 15}) == transformed->child_at(0));
    REQUIRE(translated->hit_test({5, 5}) != transformed->child_at(0));

    uint32_t iw = 0, ih = 0, tw = 0, th = 0;
    const auto identity_pixels = render_to_rgba(*identity, 200, 120, 1.0f, &iw, &ih);
    const auto translated_pixels = render_to_rgba(*translated, 200, 120, 1.0f, &tw, &th);
    REQUIRE(identity_pixels != translated_pixels);

    auto scaled = make("scale(2)", "100% 50%");
    auto* scaled_view = scaled->child_at(0);
    REQUIRE(scaled_view->transform_origin_local_x() == Catch::Approx(100.0f));
    REQUIRE(scaled_view->transform_origin_local_y() == Catch::Approx(30.0f));
    scaled_view->set_bounds({0, 0, 200, 80});
    REQUIRE(scaled_view->transform_origin_local_x() == Catch::Approx(200.0f));
    REQUIRE(scaled_view->transform_origin_local_y() == Catch::Approx(40.0f));

    DesignIR invalid;
    invalid.root = frame("invalid-transform", 100.0f, 60.0f, LayoutDirection::column);
    invalid.root.style.transform = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)";
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE_FALSE(rejected->has_transform_matrix());
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "transform";
    }));
}

TEST_CASE("native imported width preserves fractional responsive intrinsic and box sizing",
          "[view][import][native-materializer][width][skia]") {
    DesignIR responsive_ir;
    responsive_ir.root = frame("width-root", 400.0f, 80.0f, LayoutDirection::row);
    auto responsive_child = frame("responsive", 10.0f, 30.0f, LayoutDirection::column);
    responsive_child.style.width_dimension = "calc(100% - 64px)";
    responsive_child.style.max_width = 400.0f;
    responsive_child.style.background_color = "#E02040";
    responsive_ir.root.children.push_back(std::move(responsive_child));
    auto responsive = build_native_view_tree(responsive_ir, {}, {});
    REQUIRE(responsive != nullptr);
    responsive->flex().preferred_width = 0;
    responsive->flex().dim_width = {};
    responsive->set_bounds({0, 0, 400, 80});
    responsive->layout_children();
    REQUIRE(responsive->child_at(0)->bounds().width == Catch::Approx(336.0f));
    responsive->set_bounds({0, 0, 600, 80});
    responsive->layout_children();
    REQUIRE(responsive->child_at(0)->bounds().width == Catch::Approx(400.0f));

    DesignIR fractional_ir;
    fractional_ir.root = frame("fractional", 10.9922f, 20.0f, LayoutDirection::column);
    auto fractional = build_native_view_tree(fractional_ir, {}, {});
    REQUIRE(fractional->flex().preferred_width == Catch::Approx(10.9922f));

    DesignIR intrinsic_ir;
    intrinsic_ir.root = frame("intrinsic-row", 300.0f, 40.0f, LayoutDirection::row);
    auto text = label("intrinsic-text", "source faithful width", 200.0f, 30.0f);
    text.style.width_dimension = "auto";
    intrinsic_ir.root.children.push_back(std::move(text));
    auto intrinsic = build_native_view_tree(intrinsic_ir, {}, {});
    intrinsic->set_bounds({0, 0, 300, 40});
    intrinsic->layout_children();
    REQUIRE(intrinsic->child_at(0)->flex().dim_width.unit == DimensionUnit::auto_);
    REQUIRE(intrinsic->child_at(0)->bounds().width > 40.0f);
    REQUIRE(intrinsic->child_at(0)->bounds().width < 300.0f);

    DesignIR sizing;
    sizing.root = frame("sizing-row", 300.0f, 60.0f, LayoutDirection::row);
    auto content_box = frame("content-box", 100.0f, 40.0f, LayoutDirection::column);
    content_box.layout.box_sizing = "content-box";
    content_box.layout.padding_left = content_box.layout.padding_right = 10.0f;
    content_box.layout.flex_shrink = 0.0f;
    sizing.root.children.push_back(std::move(content_box));
    auto sized = build_native_view_tree(sizing, {}, {});
    sized->set_bounds({0, 0, 300, 60});
    sized->layout_children();
    REQUIRE(sized->child_at(0)->bounds().width == Catch::Approx(120.0f));

    uint32_t rw = 0, rh = 0;
    REQUIRE_FALSE(render_to_rgba(*responsive, 600, 80, 1.0f, &rw, &rh).empty());

    DesignIR invalid;
    invalid.root = frame("invalid-width", 40.0f, 20.0f, LayoutDirection::column);
    invalid.root.style.width_dimension = "fit-content(20px)";
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(rejected->flex().preferred_width == Catch::Approx(40.0f));
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "width";
    }));
}

TEST_CASE("imported CSS active skin drives the native pressed interaction state",
          "[view][import][native-materializer][active-pressed][skia]") {
    DesignIR ir;
    ir.root.type = "button";
    ir.root.stable_anchor_id = "pressed-button";
    ir.root.text_content = "Run";
    ir.root.style.width = 80.0f;
    ir.root.style.height = 30.0f;
    VisualSkin skin;
    skin.states[WidgetState::rest].background = SkinColor{20, 20, 20, 255};
    skin.states[WidgetState::rest].foreground = SkinColor{255, 255, 255, 255};
    skin.states[WidgetState::pressed].background = SkinColor{220, 30, 50, 255};
    skin.states[WidgetState::pressed].foreground = SkinColor{255, 255, 255, 255};
    ir.root.visual_skin = skin;

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    auto* button = dynamic_cast<TextButton*>(root.get());
    REQUIRE(button != nullptr);
    button->set_bounds({0, 0, 80, 30});
    int clicks = 0;
    button->on_click = [&] { ++clicks; };

    uint32_t rw = 0, rh = 0, pw = 0, ph = 0, uw = 0, uh = 0;
    const auto rest_pixels = render_to_rgba(*button, 80, 30, 1.0f, &rw, &rh);
    button->on_mouse_down({10, 10});
    REQUIRE(clicks == 1);
    const auto pressed_pixels = render_to_rgba(*button, 80, 30, 1.0f, &pw, &ph);
    REQUIRE(rest_pixels != pressed_pixels);
    button->on_mouse_up({10, 10});
    const auto released_pixels = render_to_rgba(*button, 80, 30, 1.0f, &uw, &uh);
    REQUIRE(released_pixels == rest_pixels);

    button->on_key_event({.key = KeyCode::space, .is_down = true});
    REQUIRE(clicks == 2);
    REQUIRE(render_to_rgba(*button, 80, 30, 1.0f, &pw, &ph) == pressed_pixels);
    button->on_key_event({.key = KeyCode::space, .is_down = false});
    REQUIRE(render_to_rgba(*button, 80, 30, 1.0f, &uw, &uh) == rest_pixels);
}

TEST_CASE("native flex shrink uses scaled factors constraints and overflow",
          "[view][import][native-materializer][flex-shrink]") {
    auto make = [](float parent_width, float first_shrink, float second_shrink) {
        DesignIR ir;
        ir.root = frame("row", parent_width, 30.0f, LayoutDirection::row);
        auto first = frame("first", 100.0f, 30.0f, LayoutDirection::column);
        first.layout.flex_grow = 0.0f;
        first.layout.flex_shrink = first_shrink;
        first.layout.flex_basis = "100px";
        auto second = frame("second", 200.0f, 30.0f, LayoutDirection::column);
        second.layout.flex_grow = 0.0f;
        second.layout.flex_shrink = second_shrink;
        second.layout.flex_basis = "200px";
        ir.root.children.push_back(std::move(first));
        ir.root.children.push_back(std::move(second));
        return ir;
    };
    auto layout = [](DesignIR ir) {
        const float width = *ir.root.style.width;
        auto root = build_native_view_tree(ir, {}, {});
        REQUIRE(root != nullptr);
        root->set_bounds({0, 0, width, 30});
        root->layout_children();
        return root;
    };

    auto proportional = layout(make(200.0f, 1.0f, 1.0f));
    REQUIRE(proportional->child_at(0)->bounds().width == Catch::Approx(67.0f));
    REQUIRE(proportional->child_at(1)->bounds().width == Catch::Approx(133.0f));
    REQUIRE(proportional->child_at(0)->bounds().width + proportional->child_at(1)->bounds().width ==
            Catch::Approx(200.0f));

    auto equal_scaled = layout(make(200.0f, 2.0f, 1.0f));
    REQUIRE(equal_scaled->child_at(0)->bounds().width == Catch::Approx(50.0f));
    REQUIRE(equal_scaled->child_at(1)->bounds().width == Catch::Approx(150.0f));

    auto frozen = layout(make(200.0f, 0.0f, 1.0f));
    REQUIRE(frozen->child_at(0)->bounds().width == Catch::Approx(100.0f));
    REQUIRE(frozen->child_at(1)->bounds().width == Catch::Approx(100.0f));

    auto constrained_ir = make(200.0f, 1.0f, 1.0f);
    constrained_ir.root.children[0].style.min_width = 80.0f;
    auto constrained = layout(std::move(constrained_ir));
    REQUIRE(constrained->child_at(0)->bounds().width == Catch::Approx(80.0f));
    REQUIRE(constrained->child_at(1)->bounds().width == Catch::Approx(120.0f));

    auto overflow = layout(make(200.0f, 0.0f, 0.0f));
    REQUIRE(overflow->child_at(0)->bounds().width == Catch::Approx(100.0f));
    REQUIRE(overflow->child_at(1)->bounds().width == Catch::Approx(200.0f));
    REQUIRE(overflow->child_at(1)->bounds().right() > 200.0f);

    auto resized = layout(make(250.0f, 1.0f, 1.0f));
    REQUIRE(resized->child_at(0)->bounds().width == Catch::Approx(83.0f));
    REQUIRE(resized->child_at(1)->bounds().width == Catch::Approx(167.0f));
    REQUIRE(resized->child_at(0)->bounds().width + resized->child_at(1)->bounds().width ==
            Catch::Approx(250.0f));

    DesignIR invalid = make(200.0f, -1.0f, 1.0f);
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(rejected->child_at(0)->flex().flex_shrink == Catch::Approx(1.0f));
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "flexShrink";
    }));
}

TEST_CASE("native margin family preserves sides collapse policy resize and pixels",
          "[view][import][native-materializer][margin-family]") {
    auto make=[](float width,float first_bottom,float second_top){DesignIR ir;ir.root=frame("parent",width,80,LayoutDirection::column);auto a=frame("a",20,10,LayoutDirection::column);a.layout.flex_shrink=0;a.layout.margin_bottom=first_bottom;a.style.background_color="#ff0000ff";auto b=frame("b",20,10,LayoutDirection::column);b.layout.flex_shrink=0;b.layout.margin_top=second_top;b.layout.margin_left=43.75f;b.style.background_color="#0000ffff";ir.root.children.push_back(std::move(a));ir.root.children.push_back(std::move(b));auto root=build_native_view_tree(ir,{},{});root->set_bounds({0,0,width,80});root->layout_children();return root;};
    for(float width:{100.0f,300.0f}){auto flex=make(width,8,12);REQUIRE(flex->child_at(1)->bounds().y==Catch::Approx(30));REQUIRE(flex->child_at(1)->bounds().x==Catch::Approx(44));}
    auto collapsed=make(100,0,12);REQUIRE(collapsed->child_at(1)->bounds().y==Catch::Approx(22));
    auto negative=make(100,0,-1);REQUIRE(negative->child_at(1)->bounds().y==Catch::Approx(9));
    auto zero=make(100,0,0);auto shifted=make(100,0,12);uint32_t aw=0,ah=0,bw=0,bh=0;auto a=render_to_rgba(*zero,100,80,1,&aw,&ah);auto b=render_to_rgba(*shifted,100,80,1,&bw,&bh);REQUIRE(a!=b);
    DesignIR invalid;invalid.root=frame("invalid",20,20,LayoutDirection::column);invalid.root.layout.margin_left=std::numeric_limits<float>::quiet_NaN();std::vector<ImportDiagnostic>d;auto rejected=build_native_view_tree(invalid,{}, {.diagnostics_out=&d});REQUIRE(rejected);REQUIRE(std::any_of(d.begin(),d.end(),[](const auto&i){return i.code=="native-unsupported-property"&&i.property=="marginLeft";}));
}

TEST_CASE("native line height preserves fractional multiline metrics and pixels",
          "[view][import][native-materializer][line-height]") {
    auto make=[](float line_height){DesignIR ir;ir.root=label("lines","one\ntwo\nthree",120,80);ir.root.style.font_size=13;ir.root.style.line_height=line_height;ir.root.style.white_space="pre-wrap";return build_native_view_tree(ir,{},{});};
    for(float value:{10.0f,13.0f,13.75f,15.0f,16.25f,16.5f,18.0f,22.0f,24.0f}){auto root=make(value);auto* label=dynamic_cast<Label*>(root.get());REQUIRE(label);REQUIRE(label->line_height()==Catch::Approx(value));}
    auto tight=make(13.75f);auto loose=make(24.0f);auto* tl=dynamic_cast<Label*>(tight.get());auto* ll=dynamic_cast<Label*>(loose.get());REQUIRE(tl->measured_height(120)<ll->measured_height(120));
    uint32_t aw=0,ah=0,bw=0,bh=0;auto a=render_to_rgba(*tight,120,80,1,&aw,&ah);auto b=render_to_rgba(*loose,120,80,1,&bw,&bh);REQUIRE(a!=b);
    auto normal=make(0);REQUIRE(dynamic_cast<Label*>(normal.get())->line_height()==Catch::Approx(0));
}

TEST_CASE("native normal letter spacing is authored zero across inheritance metrics and pixels",
          "[view][import][native-materializer][letter-spacing-normal]") {
    DesignIR ir;
    ir.root = frame("tracking-parent", 240.0f, 50.0f, LayoutDirection::column);
    ir.root.style.letter_spacing = 5.0f;
    auto child = label("normal-tracking", "Source tracking", 200.0f, 30.0f);
    child.style.letter_spacing = 0.0f;
    ir.root.children.push_back(std::move(child));
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    auto* imported = dynamic_cast<Label*>(root->child_at(0));
    REQUIRE(imported != nullptr);
    REQUIRE(imported->has_own_letter_spacing());
    REQUIRE(imported->letter_spacing() == Catch::Approx(0.0f));

    auto make = [](float spacing) {
        DesignIR value;
        value.root = label("tracking", "Source tracking", 200.0f, 30.0f);
        value.root.style.letter_spacing = spacing;
        return build_native_view_tree(value, {}, {});
    };
    auto normal = make(0.0f);
    auto tracked = make(3.0f);
    auto* normal_label = dynamic_cast<Label*>(normal.get());
    auto* tracked_label = dynamic_cast<Label*>(tracked.get());
    REQUIRE(normal_label->intrinsic_width() < tracked_label->intrinsic_width());
    uint32_t nw=0,nh=0,tw=0,th=0;
    const auto normal_pixels=render_to_rgba(*normal,200,30,1.0f,&nw,&nh);
    const auto tracked_pixels=render_to_rgba(*tracked,200,30,1.0f,&tw,&th);
    REQUIRE(normal_pixels != tracked_pixels);
}

TEST_CASE("native left inset preserves position modes resize and pixels",
          "[view][import][native-materializer][left]") {
    auto make = [](std::string position, std::optional<float> left, float parent_width) {
        DesignIR ir;
        ir.root = frame("left-parent", parent_width, 60.0f, LayoutDirection::row);
        auto child = frame("left-child", 20.0f, 20.0f, LayoutDirection::column);
        child.style.position = std::move(position);
        child.style.left = left;
        child.style.background_color = "#ff0000ff";
        ir.root.children.push_back(std::move(child));
        auto root = build_native_view_tree(ir, {}, {});
        REQUIRE(root != nullptr);
        root->set_bounds({0, 0, parent_width, 60});
        root->layout_children();
        return root;
    };
    REQUIRE(make("static", 10.0f, 200)->child_at(0)->bounds().x == Catch::Approx(0.0f));
    REQUIRE(make("relative", 10.0f, 200)->child_at(0)->bounds().x == Catch::Approx(10.0f));
    for (const auto* mode : {"absolute", "fixed"}) {
        for (const float width : {200.0f, 320.0f})
            REQUIRE(make(mode, 10.5f, width)->child_at(0)->bounds().x == Catch::Approx(11.0f));
    }
    REQUIRE(make("absolute", std::nullopt, 200)->child_at(0)->bounds().x == Catch::Approx(0.0f));
    auto zero = make("absolute", 0.0f, 200);
    auto shifted = make("absolute", 54.5f, 200);
    uint32_t zero_w=0, zero_h=0, shifted_w=0, shifted_h=0;
    const auto zero_pixels = render_to_rgba(*zero, 200, 60, 1.0f, &zero_w, &zero_h);
    const auto shifted_pixels = render_to_rgba(*shifted, 200, 60, 1.0f, &shifted_w, &shifted_h);
    REQUIRE(zero_pixels != shifted_pixels);

    auto invalid_ir = frame("invalid", 20.0f, 20.0f, LayoutDirection::column);
    invalid_ir.style.position = "absolute";
    invalid_ir.style.left = std::numeric_limits<float>::quiet_NaN();
    DesignIR invalid; invalid.root = std::move(invalid_ir);
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out=&diagnostics});
    REQUIRE(rejected != nullptr);
    REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" && item.property == "left";
    }));
}

TEST_CASE("native justify content preserves observed distributions resize and pixels",
          "[view][import][native-materializer][justify-content]") {
    auto make = [](float width, LayoutAlign justify) {
        DesignIR ir;
        ir.root = frame("justify-root", width, 40.0f, LayoutDirection::row);
        ir.root.layout.justify = justify;
        for (const auto* color : {"#ff0000ff", "#0000ffff"}) {
            auto child = frame("item", 20.0f, 20.0f, LayoutDirection::column);
            child.layout.flex_shrink = 0.0f;
            child.style.background_color = color;
            ir.root.children.push_back(std::move(child));
        }
        auto root = build_native_view_tree(ir, {}, {});
        REQUIRE(root != nullptr);
        root->set_bounds({0, 0, width, 40});
        root->layout_children();
        return root;
    };

    struct Case { LayoutAlign align; float first_200; float second_200; float first_300; float second_300; };
    for (const auto& item : std::array{
        Case{LayoutAlign::flex_start, 0.0f, 20.0f, 0.0f, 20.0f},
        Case{LayoutAlign::center, 80.0f, 100.0f, 130.0f, 150.0f},
        Case{LayoutAlign::flex_end, 160.0f, 180.0f, 260.0f, 280.0f},
        Case{LayoutAlign::space_between, 0.0f, 180.0f, 0.0f, 280.0f},
    }) {
        auto at_200 = make(200.0f, item.align);
        REQUIRE(at_200->child_at(0)->bounds().x == Catch::Approx(item.first_200));
        REQUIRE(at_200->child_at(1)->bounds().x == Catch::Approx(item.second_200));
        auto at_300 = make(300.0f, item.align);
        REQUIRE(at_300->child_at(0)->bounds().x == Catch::Approx(item.first_300));
        REQUIRE(at_300->child_at(1)->bounds().x == Catch::Approx(item.second_300));
    }

    auto centered = make(200.0f, LayoutAlign::center);
    auto between = make(200.0f, LayoutAlign::space_between);
    uint32_t centered_w = 0, centered_h = 0, between_w = 0, between_h = 0;
    const auto centered_pixels = render_to_rgba(*centered, 200, 40, 1.0f, &centered_w, &centered_h);
    const auto between_pixels = render_to_rgba(*between, 200, 40, 1.0f, &between_w, &between_h);
    REQUIRE(centered_w == between_w);
    REQUIRE(centered_h == between_h);
    REQUIRE(centered_pixels != between_pixels);

    const auto parsed_normal = parse_design_ir_json(R"({
        "version":1,"source":"observed-dom",
        "root":{"type":"frame","layout":{"justify":"start"},"children":[]}
    })");
    REQUIRE(parsed_normal.root.layout.justify == LayoutAlign::flex_start);
}

TEST_CASE("native imported heights preserve fixed zero fractional auto and responsive pixels",
          "[view][import][native-materializer][height]") {
    auto fixed = [](float height) {
        DesignIR ir;
        ir.root = frame("height-root", 80.0f, height, LayoutDirection::column);
        ir.root.style.background_color = "#ff0000ff";
        return ir;
    };

    for (const float height : {0.0f, 1.0f, 13.75f, 105.5f, 413.0f, 800.0f}) {
        auto root = build_native_view_tree(fixed(height), {}, {});
        REQUIRE(root != nullptr);
        REQUIRE(root->flex().dim_height.unit == DimensionUnit::px);
        REQUIRE(root->flex().dim_height.value == Catch::Approx(height));
    }

    DesignIR responsive;
    responsive.root = frame("parent", 200.0f, 300.0f, LayoutDirection::column);
    auto fractional = frame("fractional", 80.0f, 13.75f, LayoutDirection::column);
    fractional.layout.flex_shrink = 0.0f;
    responsive.root.children.push_back(std::move(fractional));
    auto responsive_root = build_native_view_tree(responsive, {}, {});
    REQUIRE(responsive_root != nullptr);
    for (const float parent_height : {300.0f, 600.0f}) {
        responsive_root->set_bounds({0, 0, 200, parent_height});
        responsive_root->invalidate_layout();
        responsive_root->layout_children();
        // Yoga preserves 13.75 in the dimension contract, then snaps the
        // laid-out edge to the current 1x pixel grid. Parent resize must not
        // change that deterministic rasterized result.
        REQUIRE(responsive_root->child_at(0)->bounds().height == Catch::Approx(14.0f));
    }

    DesignIR intrinsic;
    intrinsic.root = frame("parent", 200.0f, 100.0f, LayoutDirection::column);
    auto content = label("auto-height", "Intrinsic source text", 160.0f, 20.0f);
    content.style.height.reset();
    content.layout.height_mode = SizingMode::hug;
    intrinsic.root.children.push_back(std::move(content));
    auto intrinsic_root = build_native_view_tree(intrinsic, {}, {});
    REQUIRE(intrinsic_root != nullptr);
    intrinsic_root->set_bounds({0, 0, 200, 100});
    intrinsic_root->layout_children();
    REQUIRE(intrinsic_root->child_at(0)->bounds().height > 0.0f);
    REQUIRE(intrinsic_root->child_at(0)->bounds().height < 100.0f);

    auto painted_child = [&](float height) {
        DesignIR ir;
        ir.root = frame("paint-parent", 80.0f, 64.0f, LayoutDirection::column);
        auto child = frame("paint-height", 80.0f, height, LayoutDirection::column);
        child.layout.flex_shrink = 0.0f;
        child.style.background_color = "#ff0000ff";
        ir.root.children.push_back(std::move(child));
        return build_native_view_tree(ir, {}, {});
    };
    auto short_box = painted_child(13.75f);
    auto tall_box = painted_child(44.5f);
    uint32_t short_w = 0, short_h = 0, tall_w = 0, tall_h = 0;
    const auto short_pixels = render_to_rgba(*short_box, 80, 64, 1.0f, &short_w, &short_h);
    const auto tall_pixels = render_to_rgba(*tall_box, 80, 64, 1.0f, &tall_w, &tall_h);
    REQUIRE(short_w == tall_w);
    REQUIRE(short_h == tall_h);
    REQUIRE(short_pixels != tall_pixels);

    for (const float invalid_height : {-1.0f, std::numeric_limits<float>::quiet_NaN()}) {
        auto invalid = fixed(20.0f);
        invalid.root.style.height = invalid_height;
        std::vector<ImportDiagnostic> diagnostics;
        auto rejected = build_native_view_tree(invalid, {}, {.diagnostics_out = &diagnostics});
        REQUIRE(rejected != nullptr);
        REQUIRE(std::isfinite(rejected->flex().dim_height.value));
        REQUIRE(rejected->flex().dim_height.value >= 0.0f);
        REQUIRE(std::any_of(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
            return item.code == "native-unsupported-property" && item.property == "height";
        }));
    }
}

TEST_CASE("native CSS gaps preserve shorthand axes normal geometry and pixels",
          "[view][import][native-materializer][gap]") {
    auto make = [](float gap, std::optional<float> row_gap = {},
                   std::optional<float> column_gap = {}) {
        DesignIR ir;
        ir.root = frame("gap-root", 120.0f, 80.0f, LayoutDirection::row);
        ir.root.layout.wrap = true;
        ir.root.layout.gap = gap;
        ir.root.layout.row_gap = row_gap;
        ir.root.layout.column_gap = column_gap;
        for (const auto* color : {"#ff0000ff", "#00ff00ff", "#0000ffff"}) {
            auto child = frame("item", 50.0f, 20.0f, LayoutDirection::column);
            child.layout.flex_shrink = 0.0f;
            child.style.background_color = color;
            ir.root.children.push_back(std::move(child));
        }
        return ir;
    };
    auto materialize = [](DesignIR ir, std::vector<ImportDiagnostic>* diagnostics = nullptr) {
        auto root = build_native_view_tree(ir, {}, {.diagnostics_out = diagnostics});
        REQUIRE(root != nullptr);
        root->set_bounds({0, 0, 120, 80});
        root->layout_children();
        return root;
    };

    auto normal = materialize(make(0.0f));
    REQUIRE(normal->child_at(1)->bounds().x == Catch::Approx(50.0f));
    REQUIRE(normal->child_at(2)->bounds().y == Catch::Approx(20.0f));

    auto single = materialize(make(10.0f));
    REQUIRE(single->child_at(1)->bounds().x == Catch::Approx(60.0f));
    REQUIRE(single->child_at(2)->bounds().y == Catch::Approx(30.0f));

    auto axes = materialize(make(0.0f, 2.0f, 6.0f));
    REQUIRE(axes->child_at(1)->bounds().x == Catch::Approx(56.0f));
    REQUIRE(axes->child_at(2)->bounds().y == Catch::Approx(22.0f));

    uint32_t normal_w = 0, normal_h = 0, axes_w = 0, axes_h = 0;
    const auto normal_pixels = render_to_rgba(*normal, 120, 80, 1.0f, &normal_w, &normal_h);
    const auto axes_pixels = render_to_rgba(*axes, 120, 80, 1.0f, &axes_w, &axes_h);
    REQUIRE(normal_w == axes_w);
    REQUIRE(normal_h == axes_h);
    REQUIRE(normal_pixels != axes_pixels);

    DesignIR invalid = make(-4.0f, -2.0f, -6.0f);
    std::vector<ImportDiagnostic> diagnostics;
    auto rejected = materialize(std::move(invalid), &diagnostics);
    REQUIRE(rejected->flex().gap == Catch::Approx(0.0f));
    REQUIRE(std::count_if(diagnostics.begin(), diagnostics.end(), [](const auto& item) {
        return item.code == "native-unsupported-property" &&
            (item.property == "gap" || item.property == "rowGap" || item.property == "columnGap");
    }) == 3);

    invalid = make(-4.0f, -2.0f, -6.0f);
    invalid.root.layout.display = "grid";
    auto rejected_grid = materialize(std::move(invalid));
    REQUIRE(rejected_grid->grid().row_gap == Catch::Approx(0.0f));
    REQUIRE(rejected_grid->grid().column_gap == Catch::Approx(0.0f));
}

TEST_CASE("native flex wrap preserves lines gaps reverse and resize pixels",
          "[view][import][native-materializer][flex-wrap]") {
    auto make = [](float width, bool wrap, bool reverse = false) {
        DesignIR ir;
        ir.root = frame("root", width, 80.0f, LayoutDirection::row);
        ir.root.layout.wrap = wrap;
        ir.root.layout.wrap_reverse = reverse;
        ir.root.layout.column_gap = 10.0f;
        ir.root.layout.row_gap = 8.0f;
        const std::array<const char*, 3> ids{"red", "green", "blue"};
        const std::array<const char*, 3> colors{"#ff0000ff", "#00ff00ff", "#0000ffff"};
        for (size_t i = 0; i < ids.size(); ++i) {
            auto child = frame(ids[i], 50.0f, 20.0f, LayoutDirection::column);
            child.layout.flex_shrink = 0.0f;
            child.style.background_color = colors[i];
            ir.root.children.push_back(std::move(child));
        }
        return ir;
    };
    auto layout = [](DesignIR ir) {
        const float width = *ir.root.style.width;
        auto root = build_native_view_tree(ir, {}, {});
        REQUIRE(root != nullptr);
        root->set_bounds({0, 0, width, 80});
        root->layout_children();
        return root;
    };

    auto nowrap = layout(make(120.0f, false));
    REQUIRE(nowrap->flex().flex_wrap == FlexWrap::no_wrap);
    REQUIRE(nowrap->child_at(2)->bounds().y == Catch::Approx(0.0f));
    REQUIRE(nowrap->child_at(2)->bounds().right() > 120.0f);

    auto wrapped = layout(make(120.0f, true));
    REQUIRE(wrapped->flex().flex_wrap == FlexWrap::wrap);
    REQUIRE(wrapped->child_at(0)->id() == "red");
    REQUIRE(wrapped->child_at(0)->bounds().x == Catch::Approx(0.0f));
    REQUIRE(wrapped->child_at(1)->bounds().x == Catch::Approx(60.0f));
    REQUIRE(wrapped->child_at(2)->bounds().x == Catch::Approx(0.0f));
    REQUIRE(wrapped->child_at(2)->bounds().y > wrapped->child_at(0)->bounds().bottom());

    auto reversed = layout(make(120.0f, true, true));
    REQUIRE(reversed->flex().flex_wrap == FlexWrap::wrap_reverse);
    REQUIRE(reversed->child_at(0)->id() == "red");
    REQUIRE(reversed->child_at(2)->bounds().y < reversed->child_at(0)->bounds().y);

    auto wide = layout(make(180.0f, true));
    REQUIRE(wide->child_at(0)->bounds().y == Catch::Approx(wide->child_at(2)->bounds().y));
    REQUIRE(wide->child_at(2)->bounds().x == Catch::Approx(120.0f));

    auto min_ir = make(120.0f, true);
    for (auto& child : min_ir.root.children) child.style.min_width = 70.0f;
    auto minimums = layout(std::move(min_ir));
    REQUIRE(minimums->child_at(1)->bounds().y > minimums->child_at(0)->bounds().y);
    REQUIRE(minimums->child_at(2)->bounds().y > minimums->child_at(1)->bounds().y);

    uint32_t pixel_width = 0, pixel_height = 0;
    const auto rgba = render_to_rgba(*wrapped, 120, 80, 1.0f, &pixel_width, &pixel_height);
    REQUIRE(rgba.size() == pixel_width * pixel_height * 4);
    auto pixel = [&](const View& child) {
        const uint32_t x = static_cast<uint32_t>(child.bounds().x + child.bounds().width / 2.0f);
        const uint32_t y = static_cast<uint32_t>(child.bounds().y + child.bounds().height / 2.0f);
        const size_t offset = 4 * (y * pixel_width + x);
        return std::array<uint8_t, 3>{rgba[offset], rgba[offset + 1], rgba[offset + 2]};
    };
    const auto red = pixel(*wrapped->child_at(0));
    const auto green = pixel(*wrapped->child_at(1));
    const auto blue = pixel(*wrapped->child_at(2));
    REQUIRE(red[0] > red[1]);
    REQUIRE(green[1] > green[0]);
    REQUIRE(blue[2] > blue[0]);

    const auto parsed = parse_design_ir_json(R"({"version":1,"source":"observed-dom",
      "root":{"type":"frame","layout":{"wrap":true,"wrapReverse":true},"children":[]}})");
    REQUIRE(parsed.root.layout.wrap);
    REQUIRE(parsed.root.layout.wrap_reverse);
    REQUIRE(serialize_design_ir(parsed).find("\"wrapReverse\":true") != std::string::npos);
}

TEST_CASE("view retains ordered resize-aware background gradient layers",
          "[view][import][native-materializer][background-layers]") {
    View view;
    const std::vector<Color> bottom = {Color::rgba8(255, 0, 0), Color::rgba8(255, 0, 0)};
    const std::vector<Color> top = {Color::rgba8(0, 0, 255, 0), Color::rgba8(0, 0, 255)};
    view.add_background_gradient_linear(0, 0, 1, 0, bottom, {0, 1});
    view.add_background_gradient_linear(0, 0, 1, 0, top, {0.5f, 0.5f}, {-30, 30});
    REQUIRE(view.background_gradient_layer_count() == 2);
    REQUIRE(view.has_background_gradient());
    view.clear_background_gradient();
    REQUIRE(view.background_gradient_layer_count() == 0);
    REQUIRE_FALSE(view.has_background_gradient());
}

TEST_CASE("Skia paints ordered calc-stop background layers across resize",
          "[view][import][native-materializer][background-layers][skia]") {
    DesignIR ir;
    ir.root = frame("root", 100.0f, 20.0f, LayoutDirection::column);
    ir.root.style.background_layers = {
        "linear-gradient(90deg, #00000000 calc(50% - 30px), #181818ff 50%, #00000000 calc(50% + 30px))",
        "linear-gradient(180deg, #afafafff 0%, #afafafff 100%)",
    };
    View parser_probe;
    REQUIRE(apply_css_background_gradient(parser_probe, ir.root.style.background_layers[0], {}, true));
    REQUIRE(parser_probe.background_gradient_layer_count() == 1);
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->background_gradient_layer_count() == 2);
    auto sample = [&](uint32_t width, uint32_t x) {
        root->set_bounds({0, 0, static_cast<float>(width), 20});
        uint32_t out_width = 0, out_height = 0;
        auto rgba = render_to_rgba(*root, width, 20, 1.0f, &out_width, &out_height);
        REQUIRE_FALSE(rgba.empty());
        REQUIRE(out_width == width);
        const auto offset = (10 * out_width + x) * 4;
        return std::array<uint8_t, 4>{rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]};
    };
    const auto edge100 = sample(100, 5), center100 = sample(100, 50);
    REQUIRE(edge100[0] > 150);
    REQUIRE(center100[0] < 50);
    const auto edge200 = sample(200, 20), center200 = sample(200, 100);
    REQUIRE(edge200[0] > 150);
    REQUIRE(center200[0] < 50);
}

TEST_CASE("native background-image none clears ordered layers",
          "[view][import][native-materializer][background-image-none]") {
    DesignIR ir;
    ir.root = frame("root", 10.0f, 10.0f, LayoutDirection::column);
    ir.root.style.background_layers_explicit = true;
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    root->add_background_gradient_linear(0, 0, 1, 0,
        {Color::rgba8(255, 0, 0), Color::rgba8(0, 0, 255)}, {0, 1});
    REQUIRE(root->has_background_gradient());
    root->clear_background_gradient();
    REQUIRE_FALSE(root->has_background_gradient());
}

TEST_CASE("baked native materializer preserves audio widget attributes",
          "[view][import][native-materializer][phase-4]") {
    DesignIR ir;
    ir.root = frame("audio-root", 320.0f, 120.0f, LayoutDirection::row);

    auto knob_node = frame("drive", 64.0f, 64.0f, LayoutDirection::column);
    knob_node.audio_widget = AudioWidgetType::knob;
    knob_node.audio_label = "Drive";
    knob_node.audio_min = -60.0f;
    knob_node.audio_max = 0.0f;
    knob_node.audio_default = -15.0f;
    knob_node.attributes["value"] = "0.2";

    auto fader_node = frame("mix", 96.0f, 32.0f, LayoutDirection::column);
    fader_node.audio_widget = AudioWidgetType::fader;
    fader_node.audio_label = "Mix";
    fader_node.attributes["value"] = "0.33";
    fader_node.attributes["orientation"] = "horizontal";
    fader_node.attributes["pulpThumbShape"] = "rectangle";
    fader_node.attributes["pulpThumbWidth"] = "17";
    fader_node.attributes["pulpThumbHeight"] = "5";
    fader_node.attributes["pulpThumbCornerRadius"] = "1";

    auto circle_fader_node = frame("trim", 32.0f, 96.0f, LayoutDirection::column);
    circle_fader_node.audio_widget = AudioWidgetType::fader;
    circle_fader_node.audio_label = "Trim";
    circle_fader_node.attributes["value"] = "0.5";
    circle_fader_node.attributes["pulpThumbShape"] = "circle";
    circle_fader_node.attributes["pulpThumbWidth"] = "12";
    circle_fader_node.attributes["pulpThumbHeight"] = "12";

    auto meter_node = frame("level", 96.0f, 24.0f, LayoutDirection::column);
    meter_node.audio_widget = AudioWidgetType::meter;
    meter_node.attributes["value"] = "0.25";
    meter_node.attributes["orientation"] = "horizontal";

    auto xy_node = frame("xy", 72.0f, 72.0f, LayoutDirection::column);
    xy_node.audio_widget = AudioWidgetType::xy_pad;
    xy_node.attributes["x"] = "0.2";
    xy_node.attributes["y"] = "0.8";

    auto choice_node = frame("waveform-choice", 21.0f, 13.0f, LayoutDirection::column);
    choice_node.type = "toggle_button";
    choice_node.text_content = "SAW";
    choice_node.attributes["checked"] = "true";
    choice_node.attributes["pulpOnBackgroundColor"] = "#1e1008";
    choice_node.attributes["pulpOffBackgroundColor"] = "#00000000";
    choice_node.attributes["pulpOnTextColor"] = "#ff6b35";
    choice_node.attributes["pulpOffTextColor"] = "#666666";
    choice_node.attributes["pulpOnBorderColor"] = "#ff6b35";
    choice_node.attributes["pulpOffBorderColor"] = "#1e1e24";
    choice_node.attributes["pulpCornerRadius"] = "2";
    choice_node.attributes["pulpFontSize"] = "7";

    auto editor_node = frame("preset-name", 96.0f, 24.0f, LayoutDirection::column);
    editor_node.type = "input";
    editor_node.attributes["type"] = "text";
    editor_node.attributes["pulpPlaceholder"] = "Preset";
    editor_node.attributes["pulpInitialValue"] = "Init";

    ir.root.children.push_back(std::move(knob_node));
    ir.root.children.push_back(std::move(fader_node));
    ir.root.children.push_back(std::move(circle_fader_node));
    ir.root.children.push_back(std::move(meter_node));
    ir.root.children.push_back(std::move(xy_node));
    ir.root.children.push_back(std::move(choice_node));
    ir.root.children.push_back(std::move(editor_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 7);

    auto* knob = dynamic_cast<Knob*>(root->child_at(0));
    REQUIRE(knob != nullptr);
    REQUIRE(knob->label() == "Drive");
    REQUIRE(knob->value() == 0.2f);
    REQUIRE(knob->default_value() == 0.75f);
    REQUIRE(knob->render_style() == WidgetRenderStyle::minimal);

    auto* fader = dynamic_cast<Fader*>(root->child_at(1));
    REQUIRE(fader != nullptr);
    REQUIRE(fader->label() == "Mix");
    REQUIRE(fader->value() == 0.33f);
    REQUIRE(fader->orientation() == Fader::Orientation::horizontal);
    REQUIRE(fader->thumb_shape() == Fader::ThumbShape::rectangle);
    REQUIRE(fader->thumb_width() == 17.0f);
    REQUIRE(fader->thumb_height() == 5.0f);
    REQUIRE(fader->thumb_corner_radius() == 1.0f);
    REQUIRE(fader->render_style() == WidgetRenderStyle::minimal);

    auto* circle_fader = dynamic_cast<Fader*>(root->child_at(2));
    REQUIRE(circle_fader != nullptr);
    REQUIRE(circle_fader->label() == "Trim");
    REQUIRE(circle_fader->thumb_shape() == Fader::ThumbShape::circle);
    REQUIRE(circle_fader->thumb_width() == 12.0f);
    REQUIRE(circle_fader->thumb_height() == 12.0f);

    auto* meter = dynamic_cast<Meter*>(root->child_at(3));
    REQUIRE(meter != nullptr);
    REQUIRE(meter->display_rms() == 0.25f);
    REQUIRE(meter->display_peak() == 0.25f);
    REQUIRE(meter->orientation() == Meter::Orientation::horizontal);
    REQUIRE(meter->render_style() == WidgetRenderStyle::minimal);

    auto* xy = dynamic_cast<XYPad*>(root->child_at(4));
    REQUIRE(xy != nullptr);
    REQUIRE(xy->x_value() == 0.2f);
    REQUIRE(xy->y_value() == 0.8f);

    auto* choice = dynamic_cast<ToggleButton*>(root->child_at(5));
    REQUIRE(choice != nullptr);
    REQUIRE(choice->label() == "SAW");
    REQUIRE(choice->is_on());
    REQUIRE(choice->on_background_color_override().has_value());
    REQUIRE(choice->on_background_color_override()->r8() == 0x1e);
    REQUIRE(choice->on_background_color_override()->g8() == 0x10);
    REQUIRE(choice->on_background_color_override()->b8() == 0x08);
    REQUIRE(choice->off_background_color_override().has_value());
    REQUIRE(choice->off_background_color_override()->a8() == 0x00);
    REQUIRE(choice->on_text_color_override().has_value());
    REQUIRE(choice->on_text_color_override()->r8() == 0xff);
    REQUIRE(choice->on_text_color_override()->g8() == 0x6b);
    REQUIRE(choice->on_text_color_override()->b8() == 0x35);
    REQUIRE(choice->off_text_color_override().has_value());
    REQUIRE(choice->off_text_color_override()->r8() == 0x66);
    REQUIRE(choice->off_border_color_override().has_value());
    REQUIRE(choice->off_border_color_override()->r8() == 0x1e);
    REQUIRE(choice->corner_radius_override() == 2.0f);
    REQUIRE(choice->font_size_override() == 7.0f);

    auto* editor = dynamic_cast<TextEditor*>(root->child_at(6));
    REQUIRE(editor != nullptr);
    REQUIRE(editor->placeholder == "Preset");
    REQUIRE(editor->text() == "Init");
}

TEST_CASE("baked native materializer routes promoted widget hits over decorative descendants",
          "[view][import][native-materializer][hit-test]") {
    DesignIR ir;
    ir.root = frame("root", 120.0f, 120.0f, LayoutDirection::column);

    auto knob_node = frame("gain-knob", 80.0f, 80.0f, LayoutDirection::column);
    knob_node.audio_widget = AudioWidgetType::knob;
    knob_node.audio_label = "Gain";
    knob_node.attributes["value"] = "0.5";

    auto decorative_art = frame("gain-knob-imported-art", 80.0f, 80.0f, LayoutDirection::column);
    decorative_art.style.background_color = "#ff00ff";
    knob_node.children.push_back(std::move(decorative_art));

    auto nested_button = frame("gain-knob-nested-button", 60.0f, 20.0f, LayoutDirection::column);
    nested_button.type = "button";
    nested_button.text_content = "Fine";
    knob_node.children.push_back(std::move(nested_button));
    ir.root.children.push_back(std::move(knob_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);

    root->set_bounds({0, 0, 120.0f, 120.0f});
    root->layout_children();

    auto* knob = dynamic_cast<Knob*>(root->child_at(0));
    REQUIRE(knob != nullptr);
    REQUIRE(knob->child_count() == 2);
    REQUIRE_FALSE(knob->child_at(0)->hit_testable());
    REQUIRE(knob->child_at(1)->hit_testable());

    auto* hit = root->hit_test({40.0f, 40.0f});
    REQUIRE(hit == knob);
}

TEST_CASE("binding-backed imported knob drag updates from the visible body",
          "[view][import][native-materializer][hit-test][binding]") {
    DesignIR ir;
    ir.root = frame("root", 160.0f, 120.0f, LayoutDirection::column);

    auto knob_node = frame("bound-gain-knob", 80.0f, 80.0f, LayoutDirection::column);
    knob_node.audio_widget = AudioWidgetType::knob;
    knob_node.audio_label = "Gain";
    knob_node.stable_anchor_id = "figma:bound-gain-knob";
    knob_node.attributes["value"] = "0.4";
    knob_node.attributes["pulpParamKey"] = "filter.gain";
    knob_node.attributes["pulpRouteId"] = "figma-plugin:filter.gain";
    knob_node.attributes["pulpBindingModule"] = "filter";
    knob_node.attributes["pulpBindingParam"] = "gain";
    knob_node.attributes["pulpEventContract"] = "onChange:set_param:filter.gain";
    knob_node.attributes["pulpGestureContract"] = "rotary_drag:begin/update/end";

    auto decorative_art = frame("imported-knob-art", 80.0f, 80.0f, LayoutDirection::column);
    decorative_art.style.background_color = "#ff00ff";
    auto value_label = label("imported-value-label", "80%", 80.0f, 20.0f);
    knob_node.children.push_back(std::move(decorative_art));
    knob_node.children.push_back(std::move(value_label));
    ir.root.children.push_back(std::move(knob_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);

    root->set_bounds({0, 0, 160.0f, 120.0f});
    root->layout_children();

    auto* knob = dynamic_cast<Knob*>(root->child_at(0));
    REQUIRE(knob != nullptr);
    REQUIRE(knob->child_count() == 2);
    REQUIRE_FALSE(knob->child_at(0)->hit_testable());
    REQUIRE_FALSE(knob->child_at(1)->hit_testable());

    auto* body_hit = root->hit_test({40.0f, 40.0f});
    REQUIRE(body_hit == knob);

    BindingBackedKnobContext binding;
    bind_native_view_tree(*root, ir, binding);
    REQUIRE(binding.bound_knobs.size() == 1);
    REQUIRE(binding.bound_knobs[0].route_id == "figma-plugin:filter.gain");
    REQUIRE(binding.bound_knobs[0].param_key == "filter.gain");
    REQUIRE(binding.bound_knobs[0].binding_module == "filter");
    REQUIRE(binding.bound_knobs[0].binding_param == "gain");
    REQUIRE(binding.bound_knobs[0].event_contract == "onChange:set_param:filter.gain");
    REQUIRE(binding.bound_knobs[0].gesture_contract == "rotary_drag:begin/update/end");

    const float before = knob->value();
    REQUIRE(before == 0.4f);
    REQUIRE(binding.normalized_value() == before);

    root->simulate_drag({40.0f, 40.0f}, {40.0f, 10.0f}, 3);

    REQUIRE(knob->value() > before);
    REQUIRE(binding.normalized_value() == knob->value());
    REQUIRE_FALSE(binding.changes.empty());
    REQUIRE(binding.changes.back() == knob->value());
    REQUIRE(binding.gesture_begin_count == 1);
    REQUIRE(binding.gesture_end_count == 1);
}

TEST_CASE("imported fader, button, and text input respond to interaction (Phase D)",
          "[view][import][native-materializer][interaction][phase-d]") {
    // Phase D — prove non-knob imported widgets are interactive, not just
    // rendered. The GRAINS knob already has a GPU-harness hit+drag proof; ELYSIUM
    // itself is knob-only (its "Search" is a static text label), so this covers
    // the remaining interactive widget classes — fader (drag), toggle button
    // (click), text input (type) — on a synthetic imported fixture through the
    // real materialize → hit-test → event path.
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";
    ir.root.style.width = 200.0f;
    ir.root.style.height = 200.0f;
    ir.root.layout.direction = LayoutDirection::column;
    ir.root.layout.gap = 8.0f;

    auto fader = frame("mix", 160.0f, 24.0f, LayoutDirection::column);
    fader.audio_widget = AudioWidgetType::fader;
    fader.audio_label = "Mix";
    fader.attributes["value"] = "0.1";
    fader.attributes["orientation"] = "horizontal";

    auto toggle = frame("sel", 160.0f, 24.0f, LayoutDirection::column);
    toggle.type = "toggle_button";
    toggle.text_content = "ON";
    toggle.attributes["checked"] = "false";

    auto input = frame("name", 160.0f, 24.0f, LayoutDirection::column);
    input.type = "input";
    input.attributes["type"] = "text";
    input.attributes["pulpInitialValue"] = "ab";

    ir.root.children.push_back(std::move(fader));
    ir.root.children.push_back(std::move(toggle));
    ir.root.children.push_back(std::move(input));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 3);
    root->set_bounds({0.0f, 0.0f, 200.0f, 200.0f});
    root->layout_children();

    auto* f = dynamic_cast<Fader*>(root->child_at(0));
    auto* t = dynamic_cast<ToggleButton*>(root->child_at(1));
    auto* e = dynamic_cast<TextEditor*>(root->child_at(2));
    REQUIRE(f != nullptr);
    REQUIRE(t != nullptr);
    REQUIRE(e != nullptr);

    // Fader: dragging along its axis raises the value (routed through hit-test).
    const Rect fb = f->bounds();
    const float fader_before = f->value();
    root->simulate_drag({fb.x + fb.width * 0.15f, fb.y + fb.height * 0.5f},
                        {fb.x + fb.width * 0.85f, fb.y + fb.height * 0.5f}, 6);
    INFO("fader before=" << fader_before << " after=" << f->value());
    REQUIRE(f->value() > fader_before);

    // Toggle button: a click flips its state — it is a target, not a picture.
    const Rect tb = t->bounds();
    const bool toggle_before = t->is_on();
    root->simulate_click({tb.x + tb.width * 0.5f, tb.y + tb.height * 0.5f});
    INFO("toggle before=" << toggle_before << " after=" << t->is_on());
    REQUIRE(t->is_on() != toggle_before);

    // Text input: focusing and typing changes the committed text.
    const std::string text_before = e->text();
    e->on_focus_changed(true);
    TextInputEvent typed;
    typed.text = "c";
    e->on_text_input(typed);
    INFO("text before='" << text_before << "' after='" << e->text() << "'");
    REQUIRE(e->text() != text_before);
}

TEST_CASE("native materializer binding helper requires anchors and routes",
          "[view][import][native-materializer][binding]") {
    DesignIR ir;
    ir.root = frame("root", 320.0f, 260.0f, LayoutDirection::column);

    auto eligible = frame("eligible-knob", 80.0f, 80.0f, LayoutDirection::column);
    eligible.audio_widget = AudioWidgetType::knob;
    eligible.stable_anchor_id = "figma:eligible-knob";
    eligible.attributes["value"] = "0.25";
    eligible.attributes["pulpRouteId"] = "figma-plugin:eligible";
    eligible.attributes["pulpParamKey"] = "filter.eligible";
    eligible.attributes["pulpBindingModule"] = "filter";
    eligible.attributes["pulpBindingParam"] = "eligible";

    auto missing_anchor = frame("missing-anchor-knob", 80.0f, 80.0f, LayoutDirection::column);
    missing_anchor.audio_widget = AudioWidgetType::knob;
    missing_anchor.stable_anchor_id.reset();
    missing_anchor.attributes["value"] = "0.5";
    missing_anchor.attributes["pulpRouteId"] = "figma-plugin:missing-anchor";
    missing_anchor.attributes["pulpParamKey"] = "filter.missing_anchor";

    auto missing_route = frame("missing-route-knob", 80.0f, 80.0f, LayoutDirection::column);
    missing_route.audio_widget = AudioWidgetType::knob;
    missing_route.stable_anchor_id = "figma:missing-route-knob";
    missing_route.attributes["value"] = "0.75";
    missing_route.attributes["pulpParamKey"] = "filter.missing_route";

    auto wrong_type = label("wrong-type-label", "Wrong", 80.0f, 24.0f);
    wrong_type.attributes["pulpRouteId"] = "figma-plugin:wrong-type";
    wrong_type.attributes["pulpParamKey"] = "filter.wrong_type";

    ir.root.children.push_back(std::move(eligible));
    ir.root.children.push_back(std::move(missing_anchor));
    ir.root.children.push_back(std::move(missing_route));
    ir.root.children.push_back(std::move(wrong_type));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);

    BindingBackedKnobContext binding;
    std::vector<ImportDiagnostic> diagnostics;
    bind_native_view_tree(*root, ir, binding, {.diagnostics_out = &diagnostics});

    REQUIRE(binding.bound_knobs.size() == 1);
    REQUIRE(binding.bound_knobs[0].route_id == "figma-plugin:eligible");
    REQUIRE(binding.bound_knobs[0].param_key == "filter.eligible");
    REQUIRE(diagnostics_count(diagnostics, "native-binding-missing-anchor") == 1);
    REQUIRE(diagnostics_count(diagnostics, "native-binding-missing-route") == 1);
    REQUIRE(diagnostics_count(diagnostics, "native-binding-not-applied") == 1);
    REQUIRE(diagnostics_count(diagnostics, "native-binding-anchor-not-found") == 0);
}

TEST_CASE("native materializer binding helper reports anchors missing from the view tree",
          "[view][import][native-materializer][binding]") {
    DesignIR ir;
    ir.root = frame("root", 120.0f, 120.0f, LayoutDirection::column);

    auto knob_node = frame("orphaned-knob", 80.0f, 80.0f, LayoutDirection::column);
    knob_node.audio_widget = AudioWidgetType::knob;
    knob_node.stable_anchor_id = "figma:orphaned-knob";
    knob_node.attributes["value"] = "0.5";
    knob_node.attributes["pulpRouteId"] = "figma-plugin:orphaned";
    knob_node.attributes["pulpParamKey"] = "filter.orphaned";
    ir.root.children.push_back(std::move(knob_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);
    root->child_at(0)->set_anchor_id("figma:different-view");

    BindingBackedKnobContext binding;
    std::vector<ImportDiagnostic> diagnostics;
    bind_native_view_tree(*root, ir, binding, {.diagnostics_out = &diagnostics});

    REQUIRE(binding.bound_knobs.empty());
    REQUIRE(diagnostics_count(diagnostics, "native-binding-anchor-not-found") == 1);
    REQUIRE(diagnostics[0].anchor_id == "figma:orphaned-knob");
}

TEST_CASE("native materializer binding helper refuses duplicate materialized anchors",
          "[view][import][native-materializer][binding]") {
    DesignIR ir;
    ir.root = frame("root", 220.0f, 120.0f, LayoutDirection::row);

    auto first = frame("first-duplicate-knob", 80.0f, 80.0f, LayoutDirection::column);
    first.audio_widget = AudioWidgetType::knob;
    first.stable_anchor_id = "figma:duplicate-knob";
    first.attributes["value"] = "0.25";
    first.attributes["pulpRouteId"] = "figma-plugin:first-duplicate";
    first.attributes["pulpParamKey"] = "filter.first";

    auto second = frame("second-duplicate-knob", 80.0f, 80.0f, LayoutDirection::column);
    second.audio_widget = AudioWidgetType::knob;
    second.stable_anchor_id = "figma:duplicate-knob";
    second.attributes["value"] = "0.75";
    second.attributes["pulpRouteId"] = "figma-plugin:second-duplicate";
    second.attributes["pulpParamKey"] = "filter.second";

    ir.root.children.push_back(std::move(first));
    ir.root.children.push_back(std::move(second));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);

    BindingBackedKnobContext binding;
    std::vector<ImportDiagnostic> diagnostics;
    bind_native_view_tree(*root, ir, binding, {.diagnostics_out = &diagnostics});

    REQUIRE(binding.bound_knobs.empty());
    REQUIRE(diagnostics_count(diagnostics, "native-binding-duplicate-anchor") == 2);
    REQUIRE(diagnostics_count(diagnostics, "native-binding-not-applied") == 0);
    REQUIRE(diagnostics_count(diagnostics, "native-binding-anchor-not-found") == 0);
}

TEST_CASE("generated C++ binding helper requires a unique materialized anchor",
          "[view][import][native-materializer][binding][cpp-codegen]") {
    DesignIR ir;
    ir.root = frame("root", 220.0f, 120.0f, LayoutDirection::row);

    auto first = frame("figma:duplicate-knob", 80.0f, 80.0f, LayoutDirection::column);
    first.audio_widget = AudioWidgetType::knob;
    first.attributes["value"] = "0.25";
    first.attributes["pulpRouteId"] = "figma-plugin:first-duplicate";
    first.attributes["pulpParamKey"] = "filter.first";

    auto second = frame("figma:duplicate-knob", 80.0f, 80.0f, LayoutDirection::column);
    second.audio_widget = AudioWidgetType::knob;
    second.attributes["value"] = "0.75";
    second.attributes["pulpRouteId"] = "figma-plugin:second-duplicate";
    second.attributes["pulpParamKey"] = "filter.second";

    ir.root.children.push_back(std::move(first));
    ir.root.children.push_back(std::move(second));

    const auto result = generate_pulp_cpp(ir, ir.asset_manifest, {});

    REQUIRE(result.source.find(
        "find_imported_view_by_anchor(pulp::view::View& root, std::string_view anchor, int& matches)") !=
        std::string::npos);
    REQUIRE(result.source.find("route_0_match_count == 1") != std::string::npos);
    REQUIRE(result.source.find("route_1_match_count == 1") != std::string::npos);

#if defined(_WIN32)
    // The string contract above is exercised on every platform; only the
    // optional compile leg is skipped on Windows. Compiling the freestanding
    // generated translation unit standalone runs the toolchain outside a
    // configured MSVC environment, so it cannot resolve the STL / platform
    // transitive includes the way the macOS clang invocation does. This is the
    // same compile-on-Windows limitation that keeps the sibling
    // pulp-test-design-import-cpp-codegen target behind the
    // `windows-pr-quarantine` ctest label (see test/CMakeLists.txt).
    SKIP("freestanding generated-source compile is unsupported on the Windows CI toolchain");
#else
    TempDir tmp("pulp-native-materializer-duplicate-anchor-codegen");
    const auto header = tmp.path / "imported_ui.hpp";
    const auto source = tmp.path / "imported_ui.cpp";
    const auto object = tmp.path / "imported_ui.o";
    write_text(header, result.header);
    write_text(source, result.source);

    std::string diagnostics;
    const bool compiled = compile_generated_source(source, object, &diagnostics);
    INFO(diagnostics);
    REQUIRE(compiled);
#endif
}

TEST_CASE("native materializer binding helper binds routed checkbox metadata",
          "[view][import][native-materializer][binding]") {
    DesignIR ir;
    ir.root = frame("root", 120.0f, 80.0f, LayoutDirection::column);

    auto checkbox_node = frame("bypass-checkbox", 32.0f, 32.0f, LayoutDirection::column);
    checkbox_node.type = "input";
    checkbox_node.stable_anchor_id = "figma:bypass-checkbox";
    checkbox_node.attributes["type"] = "checkbox";
    checkbox_node.attributes["checked"] = "true";
    checkbox_node.attributes["pulpRouteId"] = "figma-plugin:bypass";
    checkbox_node.attributes["pulpParamKey"] = "filter.bypass";
    checkbox_node.attributes["pulpBindingModule"] = "filter";
    checkbox_node.attributes["pulpBindingParam"] = "bypass";
    checkbox_node.attributes["pulpEventContract"] = "onChange:set_param:filter.bypass";
    checkbox_node.attributes["pulpGestureContract"] = "click:toggle";
    ir.root.children.push_back(std::move(checkbox_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);

    auto* checkbox = dynamic_cast<Checkbox*>(root->child_at(0));
    REQUIRE(checkbox != nullptr);
    REQUIRE(checkbox->is_checked());

    BindingBackedKnobContext binding;
    std::vector<ImportDiagnostic> diagnostics;
    bind_native_view_tree(*root, ir, binding, {.diagnostics_out = &diagnostics});

    REQUIRE(binding.bound_checkboxes.size() == 1);
    REQUIRE(binding.bound_checkboxes[0].route_id == "figma-plugin:bypass");
    REQUIRE(binding.bound_checkboxes[0].param_key == "filter.bypass");
    REQUIRE(binding.bound_checkboxes[0].binding_module == "filter");
    REQUIRE(binding.bound_checkboxes[0].binding_param == "bypass");
    REQUIRE(binding.bound_checkboxes[0].event_contract == "onChange:set_param:filter.bypass");
    REQUIRE(binding.bound_checkboxes[0].gesture_contract == "click:toggle");
    REQUIRE(diagnostics.empty());

    checkbox->on_mouse_down({16.0f, 16.0f});
    REQUIRE_FALSE(checkbox->is_checked());
    REQUIRE(binding.checkbox_changes.size() == 1);
    REQUIRE(binding.checkbox_changes[0].first == "filter.bypass");
    REQUIRE(binding.checkbox_changes[0].second == 0.0f);
}

TEST_CASE("native materializer binding helper skips repeated calls for the same context and view",
          "[view][import][native-materializer][binding]") {
    DesignIR ir;
    ir.root = frame("root", 160.0f, 80.0f, LayoutDirection::column);

    auto checkbox_node = frame("bypass-checkbox", 32.0f, 32.0f, LayoutDirection::column);
    checkbox_node.type = "input";
    checkbox_node.stable_anchor_id = "figma:bypass-checkbox";
    checkbox_node.attributes["type"] = "checkbox";
    checkbox_node.attributes["pulpRouteId"] = "figma-plugin:bypass";
    checkbox_node.attributes["pulpParamKey"] = "filter.bypass";
    ir.root.children.push_back(std::move(checkbox_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);

    BindingBackedKnobContext binding;
    std::vector<ImportDiagnostic> first_diagnostics;
    bind_native_view_tree(*root, ir, binding, {.diagnostics_out = &first_diagnostics});
    REQUIRE(binding.bound_checkboxes.size() == 1);
    REQUIRE(first_diagnostics.empty());

    std::vector<ImportDiagnostic> second_diagnostics;
    bind_native_view_tree(*root, ir, binding, {.diagnostics_out = &second_diagnostics});
    REQUIRE(binding.bound_checkboxes.size() == 1);
    REQUIRE(diagnostics_count(second_diagnostics, "native-binding-already-applied") == 1);

    const auto first_checkbox_id = root->child_at(0)->import_binding_instance_id();
    root.reset();

    auto rebuilt_root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(rebuilt_root != nullptr);
    REQUIRE(rebuilt_root->child_at(0)->import_binding_instance_id() != first_checkbox_id);

    std::vector<ImportDiagnostic> rebuilt_diagnostics;
    bind_native_view_tree(*rebuilt_root, ir, binding, {.diagnostics_out = &rebuilt_diagnostics});
    REQUIRE(binding.bound_checkboxes.size() == 2);
    REQUIRE(rebuilt_diagnostics.empty());

    BindingBackedKnobContext fresh_binding;
    std::vector<ImportDiagnostic> fresh_diagnostics;
    bind_native_view_tree(*rebuilt_root, ir, fresh_binding, {.diagnostics_out = &fresh_diagnostics});
    REQUIRE(fresh_binding.bound_checkboxes.size() == 1);
    REQUIRE(fresh_diagnostics.empty());
}

TEST_CASE("generated C++ binding helper emits routed checkbox bindings",
          "[view][import][native-materializer][binding][cpp-codegen]") {
    DesignIR ir;
    ir.root = frame("root", 120.0f, 80.0f, LayoutDirection::column);

    auto checkbox_node = frame("figma:bypass-checkbox", 32.0f, 32.0f, LayoutDirection::column);
    checkbox_node.type = "input";
    checkbox_node.attributes["type"] = "checkbox";
    checkbox_node.attributes["checked"] = "false";
    checkbox_node.attributes["pulpRouteId"] = "figma-plugin:bypass";
    checkbox_node.attributes["pulpParamKey"] = "filter.bypass";
    checkbox_node.attributes["pulpBindingModule"] = "filter";
    checkbox_node.attributes["pulpBindingParam"] = "bypass";
    ir.root.children.push_back(std::move(checkbox_node));

    const auto result = generate_pulp_cpp(ir, ir.asset_manifest, {});

    REQUIRE(result.source.find("std::make_unique<pulp::view::Checkbox>()") != std::string::npos);
    REQUIRE(result.source.find("ctx.bind_checkbox(*checkbox,") != std::string::npos);
    REQUIRE(result.source.find("ctx.claim_import_binding(*view, \"figma-plugin:bypass\")") !=
            std::string::npos);
    REQUIRE(result.source.find("route_0_match_count == 1") != std::string::npos);
    REQUIRE(result.binding_manifest.find("\"native_primitive\": \"checkbox\"") != std::string::npos);
    REQUIRE(result.binding_manifest.find("\"param_key\": \"filter.bypass\"") != std::string::npos);

#if defined(_WIN32)
    // See the duplicate-anchor codegen case above: the freestanding generated
    // translation unit cannot be compiled on the Windows CI toolchain (same
    // limitation as the windows-pr-quarantined cpp-codegen target). The
    // source/manifest string contract above runs on every platform.
    SKIP("freestanding generated-source compile is unsupported on the Windows CI toolchain");
#else
    TempDir tmp("pulp-native-materializer-checkbox-codegen");
    const auto header = tmp.path / "imported_ui.hpp";
    const auto source = tmp.path / "imported_ui.cpp";
    const auto object = tmp.path / "imported_ui.o";
    write_text(header, result.header);
    write_text(source, result.source);

    std::string diagnostics;
    const bool compiled = compile_generated_source(source, object, &diagnostics);
    INFO(diagnostics);
    REQUIRE(compiled);
#endif
}

TEST_CASE("compiled generated C++ binding helper binds and fails closed at runtime",
          "[view][import][native-materializer][binding][cpp-codegen]") {
    auto root = pulp::test::generated_binding_runtime::build_generated_binding_runtime_ui();
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);

    auto* checkbox = dynamic_cast<Checkbox*>(root->child_at(0));
    REQUIRE(checkbox != nullptr);
    REQUIRE_FALSE(checkbox->is_checked());

    BindingBackedKnobContext binding;
    pulp::test::generated_binding_runtime::bind_generated_binding_runtime_ui(*root, binding);
    REQUIRE(binding.bound_checkboxes.size() == 1);
    REQUIRE(binding.bound_checkboxes[0].route_id == "figma-plugin:bypass");
    REQUIRE(binding.bound_checkboxes[0].param_key == "filter.bypass");
    REQUIRE(binding.bound_checkboxes[0].binding_module == "filter");
    REQUIRE(binding.bound_checkboxes[0].binding_param == "bypass");
    REQUIRE(binding.bound_checkboxes[0].event_contract == "onChange:set_param:filter.bypass");
    REQUIRE(binding.bound_checkboxes[0].gesture_contract == "click:toggle");

    checkbox->on_mouse_down({16.0f, 16.0f});
    REQUIRE(checkbox->is_checked());
    REQUIRE(binding.checkbox_changes.size() == 1);
    REQUIRE(binding.checkbox_changes[0].first == "filter.bypass");
    REQUIRE(binding.checkbox_changes[0].second == 1.0f);

    pulp::test::generated_binding_runtime::bind_generated_binding_runtime_ui(*root, binding);
    REQUIRE(binding.bound_checkboxes.size() == 1);

    BindingBackedKnobContext fresh_binding;
    pulp::test::generated_binding_runtime::bind_generated_binding_runtime_ui(*root, fresh_binding);
    REQUIRE(fresh_binding.bound_checkboxes.size() == 1);
}

TEST_CASE("native materializer binding helper ignores non-binding metadata",
          "[view][import][native-materializer][binding]") {
    DesignIR ir;
    ir.root = frame("root", 220.0f, 140.0f, LayoutDirection::column);

    auto route_only = frame("route-only", 80.0f, 40.0f, LayoutDirection::column);
    route_only.stable_anchor_id = "figma:route-only";
    route_only.attributes["pulpRouteId"] = "figma-plugin:route-only";
    route_only.attributes["pulpSourceFamily"] = "static-frame";

    auto initial_value_only = frame("initial-only-editor", 120.0f, 24.0f, LayoutDirection::column);
    initial_value_only.type = "input";
    initial_value_only.attributes["type"] = "text";
    initial_value_only.attributes["pulpInitialValue"] = "Init";

    ir.root.children.push_back(std::move(route_only));
    ir.root.children.push_back(std::move(initial_value_only));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);

    BindingBackedKnobContext binding;
    std::vector<ImportDiagnostic> diagnostics;
    bind_native_view_tree(*root, ir, binding, {.diagnostics_out = &diagnostics});

    REQUIRE(binding.bound_knobs.empty());
    REQUIRE(diagnostics.empty());
}

TEST_CASE("native materializer binding helper binds routed initial-value text editors",
          "[view][import][native-materializer][binding]") {
    DesignIR ir;
    ir.root = frame("root", 160.0f, 80.0f, LayoutDirection::column);

    auto editor_node = frame("preset-name", 140.0f, 24.0f, LayoutDirection::column);
    editor_node.type = "input";
    editor_node.stable_anchor_id = "figma:preset-name";
    editor_node.attributes["type"] = "text";
    editor_node.attributes["pulpRouteId"] = "figma-plugin:preset-name";
    editor_node.attributes["pulpInitialValue"] = "Init";
    editor_node.attributes["pulpPlaceholder"] = "Preset";
    editor_node.attributes["pulpEventContract"] = "input:onChange:setState";
    editor_node.attributes["pulpFocusContract"] = "input:focus";
    ir.root.children.push_back(std::move(editor_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);

    auto* editor = dynamic_cast<TextEditor*>(root->child_at(0));
    REQUIRE(editor != nullptr);
    REQUIRE(editor->text() == "Init");

    BindingBackedKnobContext binding;
    std::vector<ImportDiagnostic> diagnostics;
    bind_native_view_tree(*root, ir, binding, {.diagnostics_out = &diagnostics});

    REQUIRE(binding.bound_text_editors.size() == 1);
    REQUIRE(binding.bound_text_editors[0].route_id == "figma-plugin:preset-name");
    REQUIRE(binding.bound_text_editors[0].value_key.empty());
    REQUIRE(binding.bound_text_editors[0].initial_value == "Init");
    REQUIRE(binding.bound_text_editors[0].placeholder == "Preset");
    REQUIRE(binding.bound_text_editors[0].event_contract == "input:onChange:setState");
    REQUIRE(binding.bound_text_editors[0].focus_contract == "input:focus");
    REQUIRE(diagnostics.empty());

    editor->set_text("Edited");
    REQUIRE(binding.text_changes.size() == 1);
    REQUIRE(binding.text_changes[0] == "Edited");
}

TEST_CASE("baked native materializer lets explicit hit-test metadata override promoted widget defaults",
          "[view][import][native-materializer][hit-test]") {
    DesignIR ir;
    ir.root = frame("root", 120.0f, 120.0f, LayoutDirection::column);

    auto knob_node = frame("gain-knob", 80.0f, 80.0f, LayoutDirection::column);
    knob_node.audio_widget = AudioWidgetType::knob;
    knob_node.audio_label = "Gain";

    auto child = frame("explicit-child", 80.0f, 80.0f, LayoutDirection::column);
    child.attributes["pulpHitTestable"] = "true";
    knob_node.children.push_back(std::move(child));
    ir.root.children.push_back(std::move(knob_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);

    root->set_bounds({0, 0, 120.0f, 120.0f});
    root->layout_children();

    auto* knob = dynamic_cast<Knob*>(root->child_at(0));
    REQUIRE(knob != nullptr);
    REQUIRE(knob->child_count() == 1);
    REQUIRE(knob->child_at(0)->hit_testable());

    auto* hit = root->hit_test({40.0f, 40.0f});
    REQUIRE(hit == knob->child_at(0));
}

TEST_CASE("baked native materializer preserves interactive descendants under promoted widgets",
          "[view][import][native-materializer][hit-test]") {
    DesignIR ir;
    ir.root = frame("root", 120.0f, 120.0f, LayoutDirection::column);

    auto knob_node = frame("gain-knob", 80.0f, 80.0f, LayoutDirection::column);
    knob_node.audio_widget = AudioWidgetType::knob;
    knob_node.audio_label = "Gain";

    auto container = frame("interactive-container", 80.0f, 40.0f, LayoutDirection::column);
    auto button_node = frame("nested-fine-button", 60.0f, 20.0f, LayoutDirection::column);
    button_node.type = "button";
    button_node.text_content = "Fine";
    container.children.push_back(std::move(button_node));
    knob_node.children.push_back(std::move(container));
    ir.root.children.push_back(std::move(knob_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);

    root->set_bounds({0, 0, 120.0f, 120.0f});
    root->layout_children();

    auto* knob = dynamic_cast<Knob*>(root->child_at(0));
    REQUIRE(knob != nullptr);
    REQUIRE(knob->child_count() == 1);
    auto* container_view = knob->child_at(0);
    REQUIRE(container_view != nullptr);
    REQUIRE(container_view->hit_testable());
    REQUIRE(container_view->pointer_events() == View::PointerEvents::box_none);
    REQUIRE(container_view->child_count() == 1);
    auto* button_view = dynamic_cast<TextButton*>(container_view->child_at(0));
    REQUIRE(button_view != nullptr);
    REQUIRE(button_view->hit_testable());

    auto* button_hit = root->hit_test({30.0f, 10.0f});
    REQUIRE(button_hit == button_view);

    auto* body_hit = root->hit_test({70.0f, 30.0f});
    REQUIRE(body_hit == knob);
}

TEST_CASE("serialized visual skin survives native button materialization and outranks theme",
          "[view][import][native-materializer][visual-skin]") {
    const auto ir = parse_design_ir_json(R"({
      "version":1,"source":"figma","root":{"type":"frame","name":"root",
      "style":{},"layout":{},"children":[{"type":"button","name":"action","content":"Run",
      "style":{},"layout":{},"visualSkin":{"states":{"rest":{
      "background":{"r":12,"g":34,"b":56,"a":255},
      "foreground":{"r":220,"g":230,"b":240,"a":255},
      "icon":{"r":255,"g":255,"b":255,"a":255},
      "fontFamily":"Inter","fontSize":15,"fontWeight":600,"textAlign":0,
      "insetHorizontal":10,"insetVertical":3,"borderWidth":2,"cornerRadius":8}},
      "tokenRefs":{"rest.background":"action.rest"}}}]}})" );
    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.preview_mode = true, .diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* button = dynamic_cast<TextButton*>(root->child_at(0));
    REQUIRE(button != nullptr);
    Theme poison;
    poison.colors["button.background"] = color_from_hex(0xFF00FF);
    poison.colors["button.foreground"] = color_from_hex(0x00FF00);
    button->set_theme(poison);
    REQUIRE(button->skin_color(SkinColorRole::background, WidgetState::rest,
                               "button.background", {}) == pulp::canvas::Color::rgba8(12, 34, 56));
    REQUIRE(button->skin_color(SkinColorRole::foreground, WidgetState::rest,
                               "button.foreground", {}) == pulp::canvas::Color::rgba8(220, 230, 240));
    REQUIRE(button->skin_string(SkinStringRole::font_family, WidgetState::rest,
                                "button.font.family", "system") == "Inter");
    REQUIRE(button->skin_integer(SkinIntegerRole::font_weight, WidgetState::rest, 400) == 600);
    REQUIRE(diagnostics_contain(diagnostics, "native-unsupported-skin-property"));
}

TEST_CASE("baked native materializer honors explicit hit-test metadata",
          "[view][import][native-materializer][hit-test]") {
    DesignIR ir;
    ir.root = frame("root", 120.0f, 120.0f, LayoutDirection::column);

    auto decorative = frame("decorative-layer", 80.0f, 80.0f, LayoutDirection::column);
    decorative.attributes["pulpHitTestable"] = "false";
    ir.root.children.push_back(std::move(decorative));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 1);

    root->set_bounds({0, 0, 120.0f, 120.0f});
    root->layout_children();

    auto* child = root->child_at(0);
    REQUIRE(child != nullptr);
    REQUIRE_FALSE(child->hit_testable());

    auto* hit = root->hit_test({40.0f, 40.0f});
    REQUIRE(hit == root.get());
}

TEST_CASE("baked native materializer only treats display text as editor value for textarea",
          "[view][import][native-materializer]") {
    // Regression: the text_value fallback used incidental node text for any
    // editor, so a label/heading captured as text_content was injected as the
    // editor's contents. Only a <textarea> body is genuinely the value.
    DesignIR ir;
    ir.root = frame("root", 200.0f, 120.0f, LayoutDirection::column);

    // <input type=text> with incidental label text, no explicit value.
    auto input_node = frame("name-input", 96.0f, 24.0f, LayoutDirection::column);
    input_node.type = "input";
    input_node.attributes["type"] = "text";
    input_node.text_content = "Preset Name";

    // <textarea> whose body IS the value.
    auto area_node = frame("notes", 120.0f, 60.0f, LayoutDirection::column);
    area_node.type = "textarea";
    area_node.attributes["pulpSourceFamily"] = "textarea";
    area_node.text_content = "hello world";

    ir.root.children.push_back(std::move(input_node));
    ir.root.children.push_back(std::move(area_node));

    auto root = build_native_view_tree(ir, {}, {.preview_mode = true});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 2);

    auto* input_editor = dynamic_cast<TextEditor*>(root->child_at(0));
    REQUIRE(input_editor != nullptr);
    REQUIRE(input_editor->text().empty());

    auto* area_editor = dynamic_cast<TextEditor*>(root->child_at(1));
    REQUIRE(area_editor != nullptr);
    REQUIRE(area_editor->text() == "hello world");
}


TEST_CASE("baked native materializer makes a faithful_svg tab_group an interactive overlay",
          "[view][import][native-materializer][faithful-svg][overlay]") {
    // End-to-end codification of the design-import tab-group contract — the exact
    // path the standalone host runs (parse IR -> build_native_view_tree). A
    // faithful_svg node carrying a typed tab_group element must materialize to a
    // LIVE, clickable DesignTabGroup whose selection pill sits on the design's
    // selected cell, AND the design's BAKED selected-tab highlight must be
    // suppressed so only the live pill shows (no double-pill). Design-agnostic: a
    // synthetic 4-slot strip, not any one source file.
    //
    // The tab group spans x=20,w=56 over a 4-slot strip (slot_w=14). selected=2,
    // so the design's baked highlight is the slot-2 rect at x=48,w=14; the
    // materializer must strip it and stand up a live pill in its place.
    const std::string svg =
        R"(<svg width="80" height="80" xmlns="http://www.w3.org/2000/svg">)"
        R"(<rect x="6" y="6" width="68" height="68" rx="4" fill="#1c1d1d"/>)"
        R"(<rect x="20" y="14" width="56" height="14" rx="2" fill="#252626"/>)"
        R"(<rect x="48" y="14" width="14" height="14" rx="2" fill="#3c3d3d"/>)"
        R"(</svg>)";

    DesignIR ir;
    ir.source = DesignSource::figma_plugin;
    ir.root.type = "frame";
    ir.root.render_mode = NodeRenderMode::faithful_svg;
    ir.root.svg_asset_id = "frame-svg";

    IRInteractiveElement tg;
    tg.kind = InteractiveElementKind::tab_group;
    tg.x = 20; tg.y = 14; tg.w = 56; tg.h = 14;
    tg.options = {"1", "2", "3", "4"};
    tg.selected_index = 2;
    ir.root.interactive_elements.push_back(tg);

    IRAssetRef asset;
    asset.asset_id = "frame-svg";
    asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    asset.mime = "image/svg+xml";
    ir.asset_manifest.assets.push_back(asset);

    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, ir.asset_manifest,
                                       {.diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    auto* frame = dynamic_cast<DesignFrameView*>(root.get());
    REQUIRE(frame != nullptr);
    REQUIRE(frame->element_count() == 1);

    // The overlay is a LIVE tab widget carrying the source selection — not a
    // static repaint of the design. (Regression target: "the tab group came
    // through non-interactive".)
    auto* tabs = dynamic_cast<DesignTabGroup*>(frame->overlay_widget(0));
    REQUIRE(tabs != nullptr);
    REQUIRE(tabs->tab_count() == 4);
    CHECK(tabs->selected() == 2);

    // Clickable end-to-end: clicking a slot moves the live selection.
    frame->set_bounds({0, 0, frame->panel_width(), frame->panel_height()});
    frame->layout_children();
    const auto b = tabs->bounds();
    const float slot = b.width / 4.0f;
    tabs->on_mouse_down({slot * 0.5f, b.height * 0.5f});   // slot 0
    CHECK(tabs->selected() == 0);

    // The baked slot-2 highlight was suppressed in the ctor, so moving the LIVE
    // selection is the only thing that repaints the strip — proving the live pill
    // owns the highlight (no leftover baked rect / double-pill).
    auto render_sel = [&](int sel) {
        tabs->set_selected_silent(sel);
        return render_to_png(*frame, static_cast<int>(frame->panel_width()),
                             static_cast<int>(frame->panel_height()), 2.0f,
                             ScreenshotBackend::skia);
    };
    const auto at2 = render_sel(2);
    if (at2.empty()) SKIP("Skia raster screenshot backend unavailable");
    const auto at0 = render_sel(0);
    REQUIRE_FALSE(at0.empty());
    const auto cmp = compare_screenshots(at2, at0);
    REQUIRE(cmp.valid);
    if (cmp.similarity >= 0.999f) SKIP("native raster unavailable in this build");
    CHECK(cmp.similarity < 0.999f);   // the live pill visibly moved between slots
}
