#include <catch2/catch_test_macros.hpp>
#include <pulp/canvas/canvas.hpp>
#include <pulp/view/buttons.hpp>
#include <pulp/view/theme.hpp>

#include <vector>

using namespace pulp::view;
using pulp::canvas::Color;
using pulp::canvas::RecordingCanvas;
using pulp::canvas::DrawCommand;

namespace {

// Paint `v` into a RecordingCanvas and return every colour passed to
// set_fill_color, in order.
std::vector<Color> fill_colors(View& v) {
    RecordingCanvas rc;
    v.paint(rc);
    std::vector<Color> out;
    for (const auto& c : rc.commands())
        if (c.type == DrawCommand::Type::set_fill_color) out.push_back(c.color);
    return out;
}

bool is_white(Color c) { return c.r8() == 255 && c.g8() == 255 && c.b8() == 255; }

}  // namespace

// Reskinnability regression: the button widgets used to hardcode their
// colours — and HyperlinkButton/ArrowButton passed 0–255 ints to
// Color::rgba() (which takes 0–1 floats and clamps), so they rendered
// solid white. These guard the bug fix + token wiring.

TEST_CASE("HyperlinkButton renders its link colour, not clamped white",
          "[view][buttons][reskin]") {
    HyperlinkButton b("docs", "https://example.com");
    b.set_bounds({0, 0, 120, 20});

    auto fills = fill_colors(b);
    REQUIRE_FALSE(fills.empty());
    REQUIRE_FALSE(is_white(fills.front()));     // regression: was clamped white
    REQUIRE(fills.front().b8() > fills.front().r8());  // blue-dominant link
}

TEST_CASE("HyperlinkButton link colour follows the theme token",
          "[view][buttons][reskin]") {
    HyperlinkButton b("docs", "https://example.com");
    b.set_bounds({0, 0, 120, 20});

    Theme t;
    t.colors["text.link"] = color_from_hex(0x16DAC2);  // Ink & Signal teal
    b.set_theme(t);

    auto fills = fill_colors(b);
    REQUIRE_FALSE(fills.empty());
    REQUIRE(fills.front() == color_from_hex(0x16DAC2));
}

TEST_CASE("ArrowButton glyph is a real colour, not clamped white",
          "[view][buttons][reskin]") {
    ArrowButton b(ArrowDirection::right);
    b.set_bounds({0, 0, 24, 24});

    auto fills = fill_colors(b);
    REQUIRE_FALSE(fills.empty());
    REQUIRE_FALSE(is_white(fills.front()));
}

TEST_CASE("TextButton paints a theme-driven face and label",
          "[view][buttons][reskin]") {
    TextButton b("OK");
    b.set_bounds({0, 0, 80, 28});

    Theme t;
    t.colors["bg.elevated"]  = color_from_hex(0x1E2530);
    t.colors["text.primary"] = color_from_hex(0xF3F6F9);
    b.set_theme(t);

    auto fills = fill_colors(b);
    REQUIRE(fills.size() >= 2);  // face + label

    bool saw_face = false, saw_label = false;
    for (const auto& c : fills) {
        if (c == color_from_hex(0x1E2530)) saw_face = true;
        if (c == color_from_hex(0xF3F6F9)) saw_label = true;
    }
    REQUIRE(saw_face);
    REQUIRE(saw_label);
}

TEST_CASE("TextButton visual skin outranks poison theme and resolves state fallbacks",
          "[view][buttons][visual-skin]") {
    TextButton b("Native");
    b.set_bounds({0, 0, 100, 30});
    Theme poison;
    poison.colors["bg.elevated"] = color_from_hex(0xFF00FF);
    poison.colors["text.primary"] = color_from_hex(0x00FF00);
    b.set_theme(poison);

    VisualSkin skin;
    skin.states[WidgetState::rest].background = SkinColor{18, 28, 38, 255};
    skin.states[WidgetState::rest].foreground = SkinColor{220, 225, 230, 255};
    skin.states[WidgetState::rest].corner_radius = 9.0f;
    skin.states[WidgetState::hover].background = SkinColor{30, 50, 70, 255};
    skin.states[WidgetState::pressed].background = SkinColor{40, 60, 80, 255};
    b.set_visual_skin(skin);

    b.on_mouse_enter();
    auto hover = fill_colors(b);
    REQUIRE(hover[0] == Color::rgba8(30, 50, 70));
    REQUIRE(hover.back() == Color::rgba8(220, 225, 230));

    b.on_mouse_down({1, 1});
    auto pressed = fill_colors(b);
    REQUIRE(pressed[0] == Color::rgba8(40, 60, 80));
    REQUIRE(pressed.back() == Color::rgba8(220, 225, 230));
    REQUIRE_FALSE(pressed[0] == color_from_hex(0xFF00FF));
    REQUIRE_FALSE(pressed.back() == color_from_hex(0x00FF00));
}

TEST_CASE("TextButton resolves imported pixel and percentage corner radii by state",
          "[view][buttons][visual-skin][corner-radius]") {
    auto painted_radius = [](TextButton& button) {
        RecordingCanvas canvas;
        button.paint(canvas);
        const auto found = std::find_if(canvas.commands().begin(), canvas.commands().end(),
            [](const DrawCommand& command) {
                return command.type == DrawCommand::Type::fill_rounded_rect;
            });
        REQUIRE(found != canvas.commands().end());
        return found->f[4];
    };

    TextButton button("7m 58s");
    button.set_bounds({0, 0, 80, 30});
    VisualSkin skin;
    skin.states[WidgetState::rest].corner_radius_percent = 50.0f;
    skin.states[WidgetState::hover].corner_radius_percent = 40.0f;
    skin.states[WidgetState::disabled].corner_radius_percent = 25.0f;
    button.set_visual_skin(skin);

    REQUIRE(painted_radius(button) == 15.0f);
    button.on_mouse_enter();
    REQUIRE(painted_radius(button) == 12.0f);
    button.on_mouse_down({1, 1});
    REQUIRE(painted_radius(button) == 12.0f);
    button.on_mouse_up({1, 1});
    button.set_enabled(false);
    REQUIRE(painted_radius(button) == 7.5f);

    VisualSkin high_radius;
    high_radius.states[WidgetState::rest].corner_radius = 9999.0f;
    button.set_enabled(true);
    button.set_visual_skin(high_radius);
    REQUIRE(painted_radius(button) == 9999.0f);
}

TEST_CASE("TextButton paints state skin per-corner percent radii and continuous curves",
          "[view][buttons][visual-skin][corner-radius][border-curve]") {
    TextButton button("Segment");
    button.set_bounds({0, 0, 100, 40});
    VisualSkin skin;
    auto& rest = skin.states[WidgetState::rest];
    rest.background = SkinColor{32, 36, 40, 255};
    rest.border = SkinColor{80, 84, 88, 255};
    rest.border_width = 1.0f;
    rest.border_top_left_radius_percent = 50.0f;
    rest.border_top_right_radius_percent = 25.0f;
    rest.border_bottom_right_radius_percent = 5.0f;
    rest.border_bottom_left_radius_percent = 10.0f;
    rest.border_curve = SkinBorderCurve::continuous;
    button.set_visual_skin(skin);

    const auto radii = skin.resolved_corner_radii(WidgetState::rest, 100.0f, 40.0f);
    REQUIRE(radii.has_value());
    REQUIRE((*radii)[0] == 20.0f);
    REQUIRE((*radii)[1] == 10.0f);
    REQUIRE((*radii)[2] == 4.0f);
    REQUIRE((*radii)[3] == 2.0f);

    RecordingCanvas canvas;
    button.paint(canvas);
    REQUIRE(canvas.count(DrawCommand::Type::fill_rounded_rect) == 0);
    REQUIRE(canvas.count(DrawCommand::Type::stroke_rounded_rect) == 0);
    REQUIRE(canvas.count(DrawCommand::Type::begin_path) == 2);
    REQUIRE(canvas.count(DrawCommand::Type::fill_current_path) == 1);
    REQUIRE(canvas.count(DrawCommand::Type::stroke_current_path) == 1);
    REQUIRE(canvas.count(DrawCommand::Type::cubic_to) == 8);
}

TEST_CASE("TextButton primary and ghost variants paint skin-provided face and border",
          "[view][buttons][visual-skin][precedence]") {
    for (const auto style : {TextButton::Style::primary, TextButton::Style::ghost}) {
        TextButton button("Skinned");
        button.set_bounds({0, 0, 100, 30});
        button.set_style(style);

        Theme poison;
        poison.colors["accent.primary"] = Color::rgba8(255, 0, 255);
        poison.colors["control.border"] = Color::rgba8(255, 0, 255);
        button.set_theme(poison);

        VisualSkin skin;
        auto& rest = skin.states[WidgetState::rest];
        rest.background = SkinColor{12, 34, 56, 255};
        rest.border = SkinColor{78, 90, 102, 255};
        rest.border_width = 3.0f;
        button.set_visual_skin(skin);

        RecordingCanvas canvas;
        button.paint(canvas);
        REQUIRE(canvas.count(DrawCommand::Type::fill_rounded_rect) == 1);
        REQUIRE(canvas.count(DrawCommand::Type::stroke_rounded_rect) == 1);

        bool saw_face = false;
        bool saw_border = false;
        bool saw_width = false;
        for (const auto& cmd : canvas.commands()) {
            if (cmd.type == DrawCommand::Type::set_fill_color && cmd.color == Color::rgba8(12, 34, 56))
                saw_face = true;
            if (cmd.type == DrawCommand::Type::set_stroke_color && cmd.color == Color::rgba8(78, 90, 102))
                saw_border = true;
            if (cmd.type == DrawCommand::Type::set_line_width && cmd.f[0] == 3.0f)
                saw_width = true;
        }
        REQUIRE(saw_face);
        REQUIRE(saw_border);
        REQUIRE(saw_width);
    }
}

TEST_CASE("TextButton suppresses zero-width and transparent imported skin borders",
          "[view][buttons][visual-skin][border-identity]") {
    for (const auto transparent : {false, true}) {
        TextButton button("No outline");
        button.set_bounds({0, 0, 100, 30});
        VisualSkin skin;
        auto& rest = skin.states[WidgetState::rest];
        rest.background = SkinColor{24, 24, 24, 255};
        rest.border = SkinColor{46, 46, 46, transparent ? uint8_t{0} : uint8_t{255}};
        rest.border_width = transparent ? 1.0f : 0.0f;
        button.set_visual_skin(skin);
        RecordingCanvas canvas;
        button.paint(canvas);
        REQUIRE(canvas.count(DrawCommand::Type::stroke_rounded_rect) == 0);
        REQUIRE(canvas.count(DrawCommand::Type::set_line_width) == 0);
    }
}

TEST_CASE("TextButton paints exact one-pixel imported CSS Color 4 border",
          "[view][buttons][visual-skin][border-opaque]") {
    TextButton button("Outlined");
    button.set_bounds({0, 0, 100, 30});
    VisualSkin skin;
    auto& rest = skin.states[WidgetState::rest];
    rest.background = SkinColor{24, 24, 24, 255};
    rest.border = SkinColor{46, 46, 46, 153};
    rest.border_width = 1.0f;
    button.set_visual_skin(skin);
    RecordingCanvas canvas;
    button.paint(canvas);
    REQUIRE(canvas.count(DrawCommand::Type::stroke_rounded_rect) == 1);
    bool color = false, width = false;
    for (const auto& command : canvas.commands()) {
        if (command.type == DrawCommand::Type::set_stroke_color &&
            command.color == Color::rgba8(46, 46, 46, 153)) color = true;
        if (command.type == DrawCommand::Type::set_line_width && command.f[0] == 1.0f) width = true;
    }
    REQUIRE(color);
    REQUIRE(width);
}

TEST_CASE("TextButton keyboard focus uses focused skin without poison theme leakage",
          "[view][buttons][visual-skin][focus][precedence]") {
    TextButton button("Stop");
    button.set_bounds({0, 0, 100, 30});
    button.set_style(TextButton::Style::primary);

    Theme poison;
    for (const auto* token : {"accent.primary", "accent.text", "button.background",
                              "button.foreground", "button.focus_ring", "control.border",
                              "text.disabled"})
        poison.colors[token] = Color::rgba8(255, 0, 255);
    poison.dimensions["button.focus_ring.width"] = 9.0f;
    button.set_theme(poison);

    VisualSkin skin;
    auto& rest = skin.states[WidgetState::rest];
    rest.background = SkinColor{10, 20, 30, 255};
    rest.foreground = SkinColor{220, 221, 222, 255};
    auto& focused = skin.states[WidgetState::focused];
    focused.background = SkinColor{11, 21, 31, 255};
    focused.foreground = SkinColor{223, 224, 225, 255};
    focused.focus_ring = SkinColor{70, 80, 90, 255};
    focused.border_width = 2.0f;
    auto& disabled = skin.states[WidgetState::disabled];
    disabled.background = SkinColor{40, 41, 42, 255};
    disabled.foreground = SkinColor{100, 101, 102, 255};
    button.set_visual_skin(skin);

    int clicks = 0;
    button.on_click = [&] { ++clicks; };
    button.on_focus_changed(true);
    RecordingCanvas focused_canvas;
    button.paint(focused_canvas);
    bool saw_focus = false;
    for (const auto& cmd : focused_canvas.commands()) {
        if (cmd.type == DrawCommand::Type::set_stroke_color &&
            cmd.color == Color::rgba8(70, 80, 90))
            saw_focus = true;
        if (cmd.type == DrawCommand::Type::set_fill_color)
            REQUIRE_FALSE(cmd.color == Color::rgba8(255, 0, 255));
    }
    REQUIRE(saw_focus);

    REQUIRE(button.on_key_event({KeyCode::space, 0, true, false}));
    REQUIRE(clicks == 1);
    REQUIRE(button.on_key_event({KeyCode::space, 0, false, false}));

    button.set_enabled(false);
    RecordingCanvas disabled_canvas;
    button.paint(disabled_canvas);
    REQUIRE(disabled_canvas.count(DrawCommand::Type::stroke_rounded_rect) == 0);
    auto disabled_fills = fill_colors(button);
    REQUIRE(disabled_fills.front() == Color::rgba8(40, 41, 42));
    REQUIRE(disabled_fills.back() == Color::rgba8(100, 101, 102));
    REQUIRE_FALSE(button.on_key_event({KeyCode::enter, 0, true, false}));
    REQUIRE(clicks == 1);
}
