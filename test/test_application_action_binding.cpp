#include <pulp/runtime/base64.hpp>
#include <pulp/view/application_binding_manifest.hpp>
#include <pulp/view/buttons.hpp>
#include <pulp/view/design_frame_view.hpp>
#include <pulp/view/design_import.hpp>
#include <pulp/view/imported_action_runtime.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/screenshot_compare.hpp>
#include <pulp/view/script_engine.hpp>
#include <pulp/view/text_editor.hpp>
#include <pulp/view/ui_components.hpp>
#include <pulp/view/widgets.hpp>

#include <catch2/catch_test_macros.hpp>

#include <map>
#include <stdexcept>

using namespace pulp::view;

namespace {

struct ReceivedAction {
    std::string id;
    std::map<std::string, std::string> payload;
};

struct ReceivedBinding {
    std::string id;
    std::string state_key;
    std::string state_transition;
};

class ManifestActionContext final : public NativeImportBindingContext {
public:
    explicit ManifestActionContext(const ApplicationBindingManifest& manifest)
        : manifest_(manifest) {}

    void bind_application_action(View& view,
                                 const NativeImportHostActionDescriptor& descriptor) override {
        const std::string id(descriptor.action);
        if (!find_application_action(manifest_, id))
            throw std::runtime_error("unknown required application action: " + id);
        bindings.push_back({id,
                            std::string(descriptor.application_state_key),
                            std::string(descriptor.application_state_transition)});
        if (auto* button = dynamic_cast<TextButton*>(&view)) {
            button->on_click = [this, id] { received.push_back({id, {}}); };
        } else if (auto* combo = dynamic_cast<ComboBox*>(&view)) {
            combo->on_change = [this, id, combo](int index) {
                received.push_back({id, {{"index", std::to_string(index)},
                                         {"value", combo->selected_text()}}});
            };
        } else if (auto* editor = dynamic_cast<TextEditor*>(&view)) {
            editor->on_change = [this, id](const std::string& text) {
                received.push_back({id, {{"text", text}}});
            };
        } else if (auto* frame = dynamic_cast<DesignFrameView*>(&view)) {
            frame->on_action = [this, id](const std::string& overlay_action) {
                received.push_back({id, {{"overlayAction", overlay_action}}});
            };
        }
    }

    std::vector<ReceivedAction> received;
    std::vector<ReceivedBinding> bindings;

private:
    const ApplicationBindingManifest& manifest_;
};

class RuntimeActionContext final : public NativeImportBindingContext {
public:
    explicit RuntimeActionContext(ImportedActionEndpoint endpoint)
        : endpoint_(std::move(endpoint)) {}

    void bind_application_action(View& view,
                                 const NativeImportHostActionDescriptor&) override {
        auto* button = dynamic_cast<TextButton*>(&view);
        if (!button) throw std::runtime_error("fixture action was not a text button");
        button->on_click = [endpoint = endpoint_] { endpoint(R"({"source":"fixture"})"); };
    }

private:
    ImportedActionEndpoint endpoint_;
};

IRNode action_node(std::string type, std::string anchor, std::string action) {
    IRNode node;
    node.type = std::move(type);
    node.stable_anchor_id = std::move(anchor);
    node.attributes["pulpRouteId"] = *node.stable_anchor_id;
    node.attributes["pulpHostAction"] = std::move(action);
    node.attributes["pulpEventContract"] = "typed";
    node.attributes["pulpPayloadContract"] = "fixture.payload";
    node.attributes["focusable"] = "true";
    node.attributes["tabIndex"] = "0";
    return node;
}

View* find_anchor(View& view, std::string_view anchor) {
    if (view.anchor_id() == anchor) return &view;
    for (std::size_t index = 0; index < view.child_count(); ++index)
        if (auto* found = find_anchor(*view.child_at(index), anchor)) return found;
    return nullptr;
}

} // namespace

TEST_CASE("imported action runtime dispatch preserves source IR click composition",
          "[view][import][application-action][script]") {
    ScriptEngine engine;
    engine.evaluate(R"(
        globalThis.importedCalls = [];
        globalThis.routeImportedAction = function(action, payload) {
            importedCalls.push({ action: action, payload: payload });
        };
    )");
    ImportedActionRuntime runtime(engine, "routeImportedAction");

    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";
    auto button = action_node("button", "runtime-button", "fixture.dispatch");
    button.text_content = "Dispatch";
    button.attributes["pulpStateKey"] = "fixture.runtime.open";
    button.attributes["pulpStateTransition"] = "toggle";
    ir.root.children.push_back(std::move(button));

    IRNode panel;
    panel.type = "frame";
    panel.stable_anchor_id = "runtime-panel";
    IRNode::ResponsiveConstraints responsive;
    responsive.visibility = {{.visible = true, .structural = true}};
    responsive.application_state_key = "fixture.runtime.open";
    responsive.visibility_by_application_state = {{"false", false}, {"true", true}};
    panel.responsive = std::move(responsive);
    ir.root.children.push_back(std::move(panel));

    auto root = build_native_view_tree(ir, ir.asset_manifest);
    REQUIRE(root);
    RuntimeActionContext context(runtime.endpoint("fixture.dispatch"));
    bind_native_view_tree(*root, ir, context);

    auto* materialized_button = dynamic_cast<TextButton*>(find_anchor(*root, "runtime-button"));
    auto* materialized_panel = find_anchor(*root, "runtime-panel");
    REQUIRE(materialized_button);
    REQUIRE(materialized_panel);
    REQUIRE(set_imported_application_state(*root, "fixture.runtime.open", "true"));
    REQUIRE(materialized_panel->visible());

    materialized_button->set_bounds({0, 0, 100, 28});
    materialized_button->simulate_click({50, 14});

    CHECK(engine.evaluate("importedCalls.length").getWithDefault<double>(-1.0) == 1.0);
    CHECK(engine.evaluate("importedCalls[0].action").toString() == "fixture.dispatch");
    CHECK(engine.evaluate("importedCalls[0].payload").toString()
          == R"({"source":"fixture"})");
    CHECK_FALSE(materialized_panel->visible());
}

TEST_CASE("manifest-owned actions materialize and deliver exact typed payloads",
          "[view][import][application-action]") {
    ApplicationBindingManifest manifest;
    manifest.application_id = "neutral-fixture";
    manifest.actions = {
        {"fixture.click", "typed", "fixture", true, {}, "void"},
        {"fixture.choose", "typed", "fixture", true,
         {{"index", "integer", true}, {"value", "string", true}}, "void"},
        {"fixture.text", "typed", "fixture", true, {{"text", "string", true}}, "void"},
        {"fixture.vector", "typed", "fixture", true,
         {{"overlayAction", "string", true}}, "void"},
    };

    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "root";
    auto button = action_node("button", "button", "fixture.click");
    button.text_content = "Activate";
    button.attributes["pulpStateKey"] = "fixture.panel.open";
    button.attributes["pulpStateTransition"] = "toggle";
    IRNode button_icon;
    button_icon.type = "frame";
    button_icon.stable_anchor_id = "button-icon";
    button_icon.render_mode = NodeRenderMode::faithful_svg;
    button_icon.svg_asset_id = "fixture-svg";
    button.children.push_back(button_icon);
    ir.root.children.push_back(button);
    IRNode action_state_panel;
    action_state_panel.type = "frame";
    action_state_panel.stable_anchor_id = "action-state-panel";
    IRNode::ResponsiveConstraints action_state_responsive;
    action_state_responsive.visibility = {{.visible = true, .structural = true}};
    action_state_responsive.application_state_key = "fixture.panel.open";
    action_state_responsive.visibility_by_application_state = {{"closed", false}, {"open", true}};
    action_state_panel.responsive = action_state_responsive;
    ir.root.children.push_back(action_state_panel);
    ir.root.children.push_back(action_node("combobox", "choice", "fixture.choose"));
    ir.root.children.push_back(action_node("input", "editor", "fixture.text"));
    IRNode selected;
    selected.type = "toggle_button";
    selected.stable_anchor_id = "selected-row";
    selected.attributes["selected"] = "true";
    ir.root.children.push_back(selected);
    IRNode disabled;
    disabled.type = "button";
    disabled.stable_anchor_id = "disabled-button";
    disabled.attributes["disabled"] = "true";
    ir.root.children.push_back(disabled);

    IRNode local_state_button;
    local_state_button.type = "button";
    local_state_button.stable_anchor_id = "local-state-button";
    local_state_button.text_content = "Toggle local panel";
    local_state_button.attributes["pulpStateKey"] = "fixture.local-panel.open";
    local_state_button.attributes["pulpStateTransition"] = "toggle";
    ir.root.children.push_back(local_state_button);
    IRNode local_state_panel;
    local_state_panel.type = "frame";
    local_state_panel.stable_anchor_id = "local-state-panel";
    IRNode::ResponsiveConstraints local_state_responsive;
    local_state_responsive.visibility = {{.visible = true, .structural = true}};
    local_state_responsive.application_state_key = "fixture.local-panel.open";
    local_state_responsive.visibility_by_application_state = {{"false", false}, {"true", true}};
    local_state_panel.responsive = local_state_responsive;
    ir.root.children.push_back(local_state_panel);

    IRNode disclosure_button;
    disclosure_button.type = "button";
    disclosure_button.stable_anchor_id = "captured-disclosure-trigger";
    disclosure_button.text_content = "Toggle captured disclosure";
    disclosure_button.attributes["pulpStateKey"] = "source.disclosure:fixture";
    disclosure_button.attributes["pulpStateTransition"] = "cycle:closed,open";
    ir.root.children.push_back(disclosure_button);
    IRNode disclosure_content;
    disclosure_content.type = "frame";
    disclosure_content.stable_anchor_id = "captured-disclosure-content";
    IRNode::ResponsiveConstraints disclosure_responsive;
    disclosure_responsive.visibility = {{.visible = false, .structural = true}};
    disclosure_responsive.application_state_key = "source.disclosure:fixture";
    disclosure_responsive.visibility_by_application_state = {{"closed", false}, {"open", true}};
    disclosure_content.responsive = disclosure_responsive;
    ir.root.children.push_back(disclosure_content);

    auto vector = action_node("frame", "vector", "fixture.vector");
    vector.render_mode = NodeRenderMode::faithful_svg;
    vector.svg_asset_id = "fixture-svg";
    IRInteractiveElement overlay;
    overlay.kind = InteractiveElementKind::action;
    overlay.x = 0; overlay.y = 0; overlay.w = 40; overlay.h = 24;
    overlay.action = "fixture.vector";
    vector.interactive_elements.push_back(overlay);
    ir.root.children.push_back(vector);

    IRAssetRef asset;
    asset.asset_id = "fixture-svg";
    const std::string svg = R"(<svg viewBox="0 0 40 24"><rect width="40" height="24" fill="#345678"/></svg>)";
    asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    ir.asset_manifest.assets.push_back(asset);

    auto root = build_native_view_tree(ir, ir.asset_manifest);
    REQUIRE(root);
    ManifestActionContext context(manifest);
    bind_native_view_tree(*root, ir, context);

    REQUIRE(context.bindings.size() == 4);
    CHECK(context.bindings[0].id == "fixture.click");
    CHECK(context.bindings[0].state_key == "fixture.panel.open");
    CHECK(context.bindings[0].state_transition == "toggle");
    CHECK(context.bindings[1].state_key.empty());
    CHECK(context.bindings[1].state_transition.empty());

    auto* materialized_button = dynamic_cast<TextButton*>(find_anchor(*root, "button"));
    auto* combo = dynamic_cast<ComboBox*>(find_anchor(*root, "choice"));
    auto* editor = dynamic_cast<TextEditor*>(find_anchor(*root, "editor"));
    auto* frame = dynamic_cast<DesignFrameView*>(find_anchor(*root, "vector"));
    auto* button_icon_view = dynamic_cast<DesignFrameView*>(find_anchor(*root, "button-icon"));
    auto* action_state_panel_view = find_anchor(*root, "action-state-panel");
    auto* selected_row = dynamic_cast<ToggleButton*>(find_anchor(*root, "selected-row"));
    auto* disabled_button = dynamic_cast<TextButton*>(find_anchor(*root, "disabled-button"));
    auto* local_state_button_view = dynamic_cast<TextButton*>(find_anchor(*root, "local-state-button"));
    auto* local_state_panel_view = find_anchor(*root, "local-state-panel");
    auto* disclosure_button_view = dynamic_cast<TextButton*>(
        find_anchor(*root, "captured-disclosure-trigger"));
    auto* disclosure_content_view = find_anchor(*root, "captured-disclosure-content");
    REQUIRE(materialized_button);
    REQUIRE(combo);
    REQUIRE(editor);
    REQUIRE(frame);
    REQUIRE(button_icon_view);
    REQUIRE(action_state_panel_view);
    REQUIRE(selected_row);
    REQUIRE(selected_row->is_on());
    REQUIRE(disabled_button);
    REQUIRE(local_state_button_view);
    REQUIRE(local_state_panel_view);
    REQUIRE(disclosure_button_view);
    REQUIRE(disclosure_content_view);
    REQUIRE_FALSE(disabled_button->enabled());
    REQUIRE_FALSE(disabled_button->is_enabled());
    REQUIRE(materialized_button->focusable());
    REQUIRE(materialized_button->tab_index() == 0);

    REQUIRE(action_state_panel_view->visible());

    REQUIRE(set_imported_application_state(*root, "fixture.local-panel.open", "false"));
    REQUIRE_FALSE(local_state_panel_view->visible());
    local_state_button_view->set_bounds({0, 0, 80, 28});
    local_state_button_view->simulate_click({1, 1});
    REQUIRE(local_state_panel_view->visible());

    REQUIRE_FALSE(disclosure_content_view->visible());
    disclosure_button_view->set_bounds({0, 0, 160, 28});
    disclosure_button_view->simulate_click({1, 1});
    REQUIRE(disclosure_content_view->visible());
    disclosure_button_view->simulate_click({1, 1});
    REQUIRE_FALSE(disclosure_content_view->visible());

    materialized_button->set_bounds({0, 0, 80, 28});
    button_icon_view->set_bounds({4, 2, 40, 24});
    REQUIRE(materialized_button->child_count() == 1);
    const auto png = render_to_png(*button_icon_view, 40, 24, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(png.empty());
    uint32_t rgba_width = 0, rgba_height = 0;
    if (!render_to_rgba(*button_icon_view, 40, 24, 1.0f, &rgba_width, &rgba_height).empty())
        REQUIRE(count_png_pixels(png, 52, 86, 120, 255, 4) > 16);
    materialized_button->simulate_click({40, 14});
    REQUIRE_FALSE(action_state_panel_view->visible());
    combo->set_items({"First", "Second"});
    combo->set_selected_silent(0);
    KeyEvent down; down.key = KeyCode::down; down.is_down = true;
    combo->on_key_event(down);
    editor->on_text_input(TextInputEvent{"hello"});
    frame->set_bounds({0, 0, 40, 24});
    pulp::canvas::RecordingCanvas canvas;
    frame->paint(canvas);
    frame->on_mouse_down({20, 12});

    std::string received_ids;
    for (const auto& received : context.received) received_ids += received.id + ",";
    CAPTURE(received_ids);
    REQUIRE(context.received.size() == 4);
    CHECK(context.received[0].id == "fixture.click");
    CHECK(context.received[0].payload.empty());
    CHECK(context.received[1].id == "fixture.choose");
    CHECK(context.received[1].payload == std::map<std::string, std::string>{{"index", "1"}, {"value", "Second"}});
    CHECK(context.received[2].id == "fixture.text");
    CHECK(context.received[2].payload == std::map<std::string, std::string>{{"text", "hello"}});
    CHECK(context.received[3].id == "fixture.vector");
    CHECK(context.received[3].payload == std::map<std::string, std::string>{{"overlayAction", "fixture.vector"}});
}

TEST_CASE("application state transitions reach nested imported runtimes",
          "[view][import][application-action][application-state]") {
    DesignIR outer_ir;
    outer_ir.root.type = "frame";
    outer_ir.root.stable_anchor_id = "outer-root";
    auto outer = build_native_view_tree(outer_ir, outer_ir.asset_manifest);
    REQUIRE(outer);

    DesignIR nested_ir;
    nested_ir.root.type = "frame";
    nested_ir.root.stable_anchor_id = "nested-root";
    IRNode detail;
    detail.type = "frame";
    detail.stable_anchor_id = "nested-detail";
    IRNode::ResponsiveConstraints responsive;
    responsive.visibility = {{.visible = false, .structural = true}};
    responsive.application_state_key = "nested.disclosure.open";
    responsive.visibility_by_application_state = {{"closed", false}, {"open", true}};
    detail.responsive = responsive;
    nested_ir.root.children.push_back(detail);

    auto nested = build_native_view_tree(nested_ir, nested_ir.asset_manifest);
    REQUIRE(nested);
    auto* nested_detail = find_anchor(*nested, "nested-detail");
    REQUIRE(nested_detail);
    REQUIRE(set_imported_application_state(*nested, "nested.disclosure.open", "closed"));
    REQUIRE_FALSE(nested_detail->visible());
    outer->add_child(std::move(nested));

    REQUIRE(apply_imported_application_state_transition(
        *outer, "nested.disclosure.open", "cycle:closed,open"));
    REQUIRE(nested_detail->visible());
    REQUIRE(apply_imported_application_state_transition(
        *outer, "nested.disclosure.open", "cycle:closed,open"));
    REQUIRE_FALSE(nested_detail->visible());
}

TEST_CASE("manifest action registry rejects unknown required bindings",
          "[view][import][application-action]") {
    ApplicationBindingManifest manifest;
    manifest.application_id = "neutral-fixture";
    ManifestActionContext context(manifest);
    TextButton button("Unknown");
    std::string error;
    try {
        context.bind_application_action(
            button, NativeImportHostActionDescriptor{.action = "fixture.missing"});
    } catch (const std::runtime_error& exception) {
        error = exception.what();
    }
    REQUIRE(error == "unknown required application action: fixture.missing");
}
