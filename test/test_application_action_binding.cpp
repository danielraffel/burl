#include <pulp/runtime/base64.hpp>
#include <pulp/view/application_binding_manifest.hpp>
#include <pulp/view/buttons.hpp>
#include <pulp/view/design_frame_view.hpp>
#include <pulp/view/design_import.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/screenshot_compare.hpp>
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

class ManifestActionContext final : public NativeImportBindingContext {
public:
    explicit ManifestActionContext(const ApplicationBindingManifest& manifest)
        : manifest_(manifest) {}

    void bind_application_action(View& view,
                                 const NativeImportHostActionDescriptor& descriptor) override {
        const std::string id(descriptor.action);
        if (!find_application_action(manifest_, id))
            throw std::runtime_error("unknown required application action: " + id);
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

private:
    const ApplicationBindingManifest& manifest_;
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
    IRNode button_icon;
    button_icon.type = "frame";
    button_icon.stable_anchor_id = "button-icon";
    button_icon.render_mode = NodeRenderMode::faithful_svg;
    button_icon.svg_asset_id = "fixture-svg";
    button.children.push_back(button_icon);
    ir.root.children.push_back(button);
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

    auto* materialized_button = dynamic_cast<TextButton*>(find_anchor(*root, "button"));
    auto* combo = dynamic_cast<ComboBox*>(find_anchor(*root, "choice"));
    auto* editor = dynamic_cast<TextEditor*>(find_anchor(*root, "editor"));
    auto* frame = dynamic_cast<DesignFrameView*>(find_anchor(*root, "vector"));
    auto* button_icon_view = dynamic_cast<DesignFrameView*>(find_anchor(*root, "button-icon"));
    auto* selected_row = dynamic_cast<ToggleButton*>(find_anchor(*root, "selected-row"));
    auto* disabled_button = dynamic_cast<TextButton*>(find_anchor(*root, "disabled-button"));
    REQUIRE(materialized_button);
    REQUIRE(combo);
    REQUIRE(editor);
    REQUIRE(frame);
    REQUIRE(button_icon_view);
    REQUIRE(selected_row);
    REQUIRE(selected_row->is_on());
    REQUIRE(disabled_button);
    REQUIRE_FALSE(disabled_button->enabled());
    REQUIRE_FALSE(disabled_button->is_enabled());
    REQUIRE(materialized_button->focusable());
    REQUIRE(materialized_button->tab_index() == 0);

    materialized_button->set_bounds({0, 0, 80, 28});
    button_icon_view->set_bounds({4, 2, 40, 24});
    REQUIRE(materialized_button->child_count() == 1);
    const auto png = render_to_png(*button_icon_view, 40, 24, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(png.empty());
    uint32_t rgba_width = 0, rgba_height = 0;
    if (!render_to_rgba(*button_icon_view, 40, 24, 1.0f, &rgba_width, &rgba_height).empty())
        REQUIRE(count_png_pixels(png, 52, 86, 120, 255, 4) > 16);
    materialized_button->simulate_click({40, 14});
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
