#include <pulp/view/buttons.hpp>
#include <pulp/view/design_import.hpp>
#include <pulp/view/design_sources.hpp>
#include <pulp/view/markdown_view.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/screenshot_compare.hpp>
#include <pulp/view/svg_path_widget.hpp>
#include <pulp/view/text_editor.hpp>
#include <pulp/view/theme_resolution_audit.hpp>
#include <pulp/view/ui_components.hpp>
#include <pulp/view/widgets.hpp>
#include <pulp/runtime/base64.hpp>
#include <pulp/runtime/crypto.hpp>

#include <catch2/catch_test_macros.hpp>

#include <array>
#include <functional>
#include <memory>
#include <string>
#include <vector>

using namespace pulp::view;

namespace {

constexpr std::uint8_t kPoisonRed = 255;
constexpr std::uint8_t kPoisonGreen = 0;
constexpr std::uint8_t kPoisonBlue = 255;

Theme poison_theme() {
    Theme theme;
    const auto poison = pulp::canvas::Color::rgba8(kPoisonRed, kPoisonGreen, kPoisonBlue);
    for (const auto* name : {
        "accent.primary", "accent.text", "bg.elevated", "text.primary", "text.disabled",
        "control.border", "button.background", "button.foreground", "scroll.background",
        "scroll.border", "scrollbar.track", "scrollbar.thumb", "text.secondary"})
        theme.colors[name] = poison;
    for (const auto* name : {"button.radius", "button.border.width", "button.font.size",
             "button.letter-spacing", "button.inset.horizontal", "button.inset.vertical",
             "button.line-height", "editor.letter-spacing"})
        theme.dimensions[name] = 31337.0f;
    theme.strings["button.font.family"] = "Poison Theme Font";
    theme.strings["editor.font.family"] = "Poison Theme Font";
    return theme;
}

VisualSkin button_skin(bool transparent = false) {
    VisualSkin skin;
    const std::array states{WidgetState::rest, WidgetState::hover, WidgetState::pressed,
                            WidgetState::focused, WidgetState::selected, WidgetState::disabled};
    for (std::size_t index = 0; index < states.size(); ++index) {
        auto& style = skin.states[states[index]];
        style.background = SkinColor{static_cast<std::uint8_t>(30 + index * 4),
                                     static_cast<std::uint8_t>(38 + index * 4),
                                     static_cast<std::uint8_t>(48 + index * 4),
                                     static_cast<std::uint8_t>(transparent ? 0 : 255)};
        style.foreground = SkinColor{225, 232, 240, 255};
        style.border = SkinColor{74, 88, 104, static_cast<std::uint8_t>(transparent ? 0 : 255)};
        style.corner_radius = 9.0f;
        style.border_width = 1.0f;
        style.font_size = 14.0f;
        style.letter_spacing = 0.0f;
        style.line_height = 14.0f;
        style.inset_horizontal = 8.0f;
        style.inset_vertical = 0.0f;
        style.font_family = "system";
        style.font_weight = 400;
        style.text_align = 1;
    }
    return skin;
}

VisualSkin editor_skin() {
    VisualSkin skin;
    for (const auto state : {WidgetState::rest, WidgetState::focused, WidgetState::disabled}) {
        auto& style = skin.states[state];
        style.background = SkinColor{24, 31, 40, 255};
        style.foreground = SkinColor{230, 236, 244, 255};
        style.placeholder = SkinColor{135, 147, 161, 255};
        style.selection = SkinColor{42, 104, 132, 255};
        style.selection_text = SkinColor{245, 248, 252, 255};
        style.caret = SkinColor{95, 211, 190, 255};
        style.focus_ring = SkinColor{68, 176, 158, 255};
        style.border = SkinColor{72, 88, 104, 255};
        style.border_width = state == WidgetState::focused ? 2.0f : 1.0f;
        style.corner_radius = 10.0f;
        style.font_size = 14.0f;
        style.letter_spacing = 0.0f;
        style.font_family = "system";
        style.font_weight = 400;
    }
    return skin;
}

std::vector<std::uint8_t> require_capture(View& view, std::string_view component,
                                         std::string_view state,
                                         uint32_t width, uint32_t height) {
    CAPTURE(component, state);
    view.set_bounds({0, 0, static_cast<float>(width), static_cast<float>(height)});
    view.set_theme(poison_theme());
    ScopedThemeResolutionAudit audit;
    uint32_t rgba_width = 0, rgba_height = 0;
    const auto rgba = render_to_rgba(view, width, height, 1.0f, &rgba_width, &rgba_height);
    REQUIRE_FALSE(rgba.empty());
    REQUIRE(rgba_width == width);
    REQUIRE(rgba_height == height);
    const auto png = render_to_png(view, width, height, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(png.empty());
    const auto content = analyze_screenshot_content(png);
    REQUIRE(content.valid);
    REQUIRE(content.passes_content_floor());
    REQUIRE(count_png_pixels(png, kPoisonRed, kPoisonGreen, kPoisonBlue) == 0);
    const auto resolutions = ThemeResolutionAudit::snapshot();
    for (const auto& resolution : resolutions) {
        CAPTURE(resolution.property, resolution.token,
                static_cast<int>(resolution.kind), static_cast<int>(resolution.source));
        REQUIRE(resolution.source != ThemeResolutionSource::theme);
        REQUIRE(resolution.source != ThemeResolutionSource::literal_fallback);
    }
    REQUIRE(view.access_role() != View::AccessRole::none);
    REQUIRE_FALSE(view.access_label().empty());
    return png;
}

TEST_CASE("theme provenance catches blended poison that sentinel pixels miss",
          "[view][import][component-matrix][poison-provenance]") {
    TextButton button("Blended leak");
    button.set_bounds({0, 0, 150, 38});
    Theme blended;
    blended.colors["bg.elevated"] = pulp::canvas::Color::rgba8(255, 0, 255, 31);
    blended.colors["text.primary"] = pulp::canvas::Color::rgba8(230, 230, 230);
    button.set_theme(blended);
    ScopedThemeResolutionAudit audit;
    const auto png = render_to_png(button, 150, 38, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(png.empty());
    REQUIRE(count_png_pixels(png, kPoisonRed, kPoisonGreen, kPoisonBlue) == 0);
    const auto records = ThemeResolutionAudit::snapshot();
    REQUIRE(std::any_of(records.begin(), records.end(), [](const auto& record) {
        return record.source == ThemeResolutionSource::theme && record.token == "bg.elevated";
    }));
    REQUIRE(std::any_of(records.begin(), records.end(), [](const auto& record) {
        return record.source == ThemeResolutionSource::literal_fallback;
    }));

    ThemeResolutionAudit::record(ThemeResolutionValueKind::color,
                                 ThemeResolutionSource::explicit_value,
                                 "explicit.background");
    REQUIRE(ThemeResolutionAudit::snapshot().back().source ==
            ThemeResolutionSource::explicit_value);
}

}  // namespace

TEST_CASE("native component matrix rejects poison-theme leakage",
          "[view][import][component-matrix]") {
    TextButton poison_probe("Poison probe");
    poison_probe.set_bounds({0, 0, 160, 38});
    poison_probe.set_theme(poison_theme());
    const auto poison_png = render_to_png(poison_probe, 160, 38, 1.0f, ScreenshotBackend::skia);
    REQUIRE(count_png_pixels(poison_png, kPoisonRed, kPoisonGreen, kPoisonBlue) > 100);

    TextButton ghost("Ghost action");
    ghost.set_style(TextButton::Style::ghost);
    ghost.set_visual_skin(button_skin(true));
    int ghost_clicks = 0;
    ghost.on_click = [&] { ++ghost_clicks; };
    require_capture(ghost, "transparent ghost button", "rest", 160, 38);
    ghost.on_mouse_enter();
    require_capture(ghost, "transparent ghost button", "hover", 160, 38);
    ghost.on_mouse_down({8, 8});
    REQUIRE(ghost_clicks == 1);
    require_capture(ghost, "transparent ghost button", "pressed", 160, 38);
    ghost.on_mouse_up({8, 8});
    ghost.set_enabled(false);
    require_capture(ghost, "transparent ghost button", "disabled", 160, 38);

    ToggleButton selected;
    selected.set_label("Selected item");
    selected.set_access_label("Selected item");
    VisualSkin selected_skin;
    selected_skin.states[WidgetState::rest].background = SkinColor{28, 35, 44, 255};
    selected_skin.states[WidgetState::rest].foreground = SkinColor{210, 219, 229, 255};
    selected_skin.states[WidgetState::rest].border = SkinColor{66, 78, 91, 255};
    selected_skin.states[WidgetState::selected].background = SkinColor{38, 70, 76, 255};
    selected_skin.states[WidgetState::selected].foreground = SkinColor{236, 246, 244, 255};
    selected_skin.states[WidgetState::selected].border = SkinColor{83, 176, 157, 255};
    selected_skin.states[WidgetState::rest].corner_radius = 8.0f;
    selected_skin.states[WidgetState::rest].border_width = 1.0f;
    selected_skin.states[WidgetState::rest].font_size = 13.0f;
    selected_skin.states[WidgetState::rest].letter_spacing = 0.0f;
    selected_skin.states[WidgetState::rest].font_family = "Inter";
    selected_skin.states[WidgetState::rest].font_weight = 400;
    selected.set_visual_skin(selected_skin);
    require_capture(selected, "selected row", "rest", 180, 38);
    selected.on_mouse_down({8, 8});
    REQUIRE(selected.is_on());
    require_capture(selected, "selected row", "selected", 180, 38);

    TextEditor composer;
    composer.set_access_role(View::AccessRole::group);
    composer.set_access_label("Composer");
    composer.placeholder = "Write a message";
    composer.set_visual_skin(editor_skin());
    require_capture(composer, "composer", "rest", 260, 54);
    composer.set_focus(true);
    composer.on_text_input(TextInputEvent{"hello"});
    REQUIRE(composer.text() == "hello");
    require_capture(composer, "composer", "focused", 260, 54);
    composer.set_enabled(false);
    require_capture(composer, "composer", "disabled", 260, 54);

    const std::string svg =
        R"(<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="6" fill="#202a34"/><path d="M5 12 L10 17 L19 7" fill="none" stroke="#65d6bf" stroke-width="2"/></svg>)";
    DesignIR icon_ir;
    icon_ir.root.type = "frame";
    icon_ir.root.render_mode = NodeRenderMode::faithful_svg;
    icon_ir.root.svg_asset_id = "sha256-" + pulp::runtime::sha256_hex(svg);
    IRAssetRef icon_asset;
    icon_asset.asset_id = *icon_ir.root.svg_asset_id;
    icon_asset.original_uri = "data:image/svg+xml;base64," + pulp::runtime::base64_encode(svg);
    icon_asset.content_hash = "sha256:" + pulp::runtime::sha256_hex(svg);
    icon_asset.mime = "image/svg+xml";
    icon_ir.asset_manifest.assets.push_back(icon_asset);
    std::vector<ImportDiagnostic> icon_diagnostics;
    auto icon = build_native_view_tree(icon_ir, {}, {.diagnostics_out = &icon_diagnostics});
    REQUIRE(icon_diagnostics.empty());
    icon->set_access_role(View::AccessRole::toggle);
    icon->set_access_label("Vector action");
    require_capture(*icon, "exact SVG icon button", "rest", 42, 42);

    MarkdownView markdown("Use `neutral_value()` here.");
    markdown.set_access_label("Inline code sample");
    markdown.set_body_style("system", 14, 400, pulp::canvas::Color::rgba8(222, 230, 239));
    VisualSkin markdown_skin;
    markdown_skin.states[WidgetState::rest].inline_code_background = SkinColor{39, 48, 59, 255};
    markdown_skin.states[WidgetState::rest].inline_code_foreground = SkinColor{149, 225, 209, 255};
    markdown_skin.states[WidgetState::rest].inline_code_border = SkinColor{70, 88, 103, 255};
    markdown.set_visual_skin(markdown_skin);
    const auto markdown_png = require_capture(markdown, "inline-code Markdown span", "rest", 260, 46);
    REQUIRE(count_png_pixels(markdown_png, 39, 48, 59) > 0);
    REQUIRE(count_png_pixels(markdown_png, 149, 225, 209) > 0);
    REQUIRE(markdown.get_text().find("neutral_value") != std::string::npos);

    TextButton stop("Stop");
    stop.set_style(TextButton::Style::primary);
    stop.set_visual_skin(button_skin());
    bool stopped = false;
    stop.on_click = [&] { stopped = true; };
    require_capture(stop, "stop cancel pill", "rest", 100, 38);
    stop.on_mouse_down({8, 8});
    REQUIRE(stopped);
    require_capture(stop, "stop cancel pill", "pressed", 100, 38);

    TextEditor focus;
    focus.set_access_role(View::AccessRole::group);
    focus.set_access_label("Keyboard focus target");
    focus.placeholder = "Focus target";
    focus.set_visual_skin(editor_skin());
    focus.set_focus(true);
    REQUIRE(focus.has_focus());
    const auto focus_png = require_capture(focus, "keyboard focus ring", "focused", 220, 44);
    REQUIRE(count_png_pixels(focus_png, 68, 176, 158) > 0);

    ScrollView scroll;
    scroll.set_access_role(View::AccessRole::group);
    scroll.set_access_label("Styled scroll region");
    scroll.set_content_size({180, 360});
    VisualSkin scroll_skin;
    for (const auto state : {WidgetState::rest, WidgetState::hover,
                             WidgetState::active, WidgetState::disabled}) {
        auto& style = scroll_skin.states[state];
        style.background = SkinColor{22, 29, 37, 255};
        style.border = SkinColor{67, 82, 96, 255};
        style.scrollbar_track = SkinColor{39, 50, 61, 255};
        style.scrollbar_thumb = SkinColor{96, 184, 166, 255};
        style.border_width = 1.0f;
        style.corner_radius = 8.0f;
    }
    scroll.set_visual_skin(scroll_skin);
    scroll.on_mouse_enter();
    scroll.advance_animations(0.2f);
    const auto scroll_png = require_capture(scroll, "styled ScrollView", "hover", 180, 120);
    REQUIRE(count_png_pixels(scroll_png, 39, 50, 61) > 0);
    REQUIRE(count_png_pixels(scroll_png, 96, 184, 166) > 0);
    scroll.scroll_by(0, 42, false);
    REQUIRE(scroll.scroll_y() > 0);
    require_capture(scroll, "styled ScrollView", "scrolled", 180, 120);
    scroll.set_enabled(false);
    require_capture(scroll, "styled ScrollView", "disabled", 180, 120);
}

TEST_CASE("scrollbar skin colors round-trip through canonical DesignIR JSON",
          "[view][import][component-matrix][skin]") {
    DesignIR ir;
    ir.root.type = "frame";
    VisualSkin skin;
    skin.states[WidgetState::rest].scrollbar_track = SkinColor{1, 2, 3, 4};
    skin.states[WidgetState::rest].scrollbar_thumb = SkinColor{5, 6, 7, 8};
    skin.states[WidgetState::rest].inline_code_background = SkinColor{9, 10, 11, 12};
    skin.states[WidgetState::rest].inline_code_foreground = SkinColor{13, 14, 15, 16};
    skin.states[WidgetState::rest].inline_code_border = SkinColor{17, 18, 19, 20};
    ir.root.visual_skin = skin;
    const auto parsed = parse_design_ir_json(serialize_design_ir(ir));
    const auto* rest = parsed.root.visual_skin->state(WidgetState::rest);
    REQUIRE(rest != nullptr);
    REQUIRE(rest->scrollbar_track == skin.states[WidgetState::rest].scrollbar_track);
    REQUIRE(rest->scrollbar_thumb == skin.states[WidgetState::rest].scrollbar_thumb);
    REQUIRE(rest->inline_code_background == skin.states[WidgetState::rest].inline_code_background);
    REQUIRE(rest->inline_code_foreground == skin.states[WidgetState::rest].inline_code_foreground);
    REQUIRE(rest->inline_code_border == skin.states[WidgetState::rest].inline_code_border);
}

TEST_CASE("observed widget visual skins survive JSON materialization and Skia paint",
          "[view][import][component-matrix][observed-visual-skin]") {
    const auto ir = parse_design_ir_json(R"JSON({
      "version":1,"source":"jsx","root":{"type":"frame","name":"root","style":{},"layout":{},"children":[
        {"type":"button","name":"ghost","content":"Ghost","style":{"backgroundColor":"#00000000"},"layout":{},
         "visualSkin":{"states":{"rest":{"background":{"r":0,"g":0,"b":0,"a":0},"foreground":{"r":230,"g":235,"b":240,"a":255},"border":{"r":61,"g":72,"b":84,"a":255},"borderWidth":1,"cornerRadius":8,"fontSize":13,"letterSpacing":0,"lineHeight":16,"insetHorizontal":10,"insetVertical":4,"fontFamily":"system-ui","fontWeight":600,"textAlign":1}},"tokenRefs":{}}},
        {"type":"toggle_button","name":"selected","content":"Selected","style":{"backgroundColor":"#1c4e48ff"},"layout":{},
         "visualSkin":{"states":{"rest":{"background":{"r":28,"g":78,"b":72,"a":255},"foreground":{"r":240,"g":245,"b":247,"a":255},"border":{"r":76,"g":128,"b":119,"a":255},"borderWidth":1,"cornerRadius":8,"fontSize":13,"letterSpacing":0,"lineHeight":16,"insetHorizontal":10,"insetVertical":4,"fontFamily":"system-ui","fontWeight":600,"textAlign":1}},"tokenRefs":{}}}
      ]}}
    )JSON");
    std::vector<ImportDiagnostic> diagnostics;
    auto root = build_native_view_tree(ir, {}, {.preview_mode = true, .diagnostics_out = &diagnostics});
    REQUIRE(root != nullptr);
    REQUIRE(root->child_count() == 2);

    auto* ghost = dynamic_cast<TextButton*>(root->child_at(0));
    REQUIRE(ghost != nullptr);
    ghost->set_access_role(View::AccessRole::group);
    ghost->set_access_label("Observed transparent ghost");
    const auto ghost_png = require_capture(*ghost, "observed transparent ghost", "rest", 140, 32);
    REQUIRE_FALSE(ghost_png.empty());
    REQUIRE(ghost->visual_skin()->state(WidgetState::rest)->background->a == 0);

    auto* selected = dynamic_cast<ToggleButton*>(root->child_at(1));
    REQUIRE(selected != nullptr);
    selected->set_on(true);
    selected->set_access_role(View::AccessRole::toggle);
    selected->set_access_label("Observed selected control");
    const auto selected_png = require_capture(*selected, "observed selected control", "selected", 140, 32);
    REQUIRE_FALSE(selected_png.empty());
    REQUIRE(count_png_pixels(selected_png, 28, 78, 72) > 100);
}
