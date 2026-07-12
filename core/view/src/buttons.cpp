#include <pulp/view/buttons.hpp>
#include <pulp/canvas/canvas.hpp>
#include <pulp/view/text_overflow.hpp>
#include <pulp/view/theme_contrast.hpp>
#include <algorithm>

namespace pulp::view {

// ── TextButton ──────────────────────────────────────────────────────────

void TextButton::paint(canvas::Canvas& canvas) {
    float w = bounds().width, h = bounds().height;
    const auto state = !enabled_ ? WidgetState::disabled
        : pressed_ ? WidgetState::pressed
        : has_focus() ? WidgetState::focused
        : hovered_ ? WidgetState::hover : WidgetState::rest;
    auto skin_color_only = [&](SkinColorRole role) -> std::optional<canvas::Color> {
        if (const auto* skin = visual_skin()) {
            if (auto color = skin->color(role, state))
                return canvas::Color::rgba8(color->r, color->g, color->b, color->a);
        }
        return std::nullopt;
    };
    auto skin_dimension_only = [&](SkinDimensionRole role) -> std::optional<float> {
        if (const auto* skin = visual_skin())
            return skin->dimension(role, state);
        return std::nullopt;
    };
    float r = skin_dimension(SkinDimensionRole::corner_radius, state, "button.radius", 6.0f);

    // Background. NOTE: Color::rgba() takes 0–1 floats; these are 0–255 channel values and
    // must use rgba8() — rgba() clamps every channel to 1.0 and paints the button solid
    // white (the standalone Settings/Done buttons regressed to white because of this).
    // Theme-driven button face. The literal fallbacks reproduce the legacy
    // neutral appearance when no theme tokens are present; hover/pressed/
    // disabled are derived from the resolved base so state feedback tracks the
    // active theme instead of being frozen to hardcoded greys (#3.3 reskin gap).
    // Base face per variant. `primary` is accent-filled; `secondary` is the
    // neutral elevated face + border; `ghost` is transparent.
    const auto skin_background = skin_color_only(SkinColorRole::background);
    const bool has_skin_background = skin_background.has_value();
    bool filled = style_ != Style::ghost || has_skin_background;
    canvas::Color bg;
    if (skin_background) {
        bg = *skin_background;
    } else {
        auto base = (style_ == Style::primary)
            ? resolve_color("accent.primary", canvas::Color::rgba8(20, 184, 166))
            : resolve_color("bg.elevated", canvas::Color::rgba8(60, 60, 70));
        auto fallback_bg = base;
        if (hovered_) fallback_bg = adjust_lightness(base, 0.06f);
        if (pressed_) fallback_bg = adjust_lightness(base, 0.12f);
        if (!enabled_) fallback_bg = adjust_lightness(base, -0.04f);
        bg = resolve_color("button.background", fallback_bg);
    }
    if (filled) {
        canvas.set_fill_color(bg);
        canvas.fill_rounded_rect(0, 0, w, h, r);
    }

    // Variants choose legacy fallbacks. A skin-provided border is authoritative
    // for every variant, including otherwise-borderless primary and ghost.
    const auto skin_border = skin_color_only(SkinColorRole::border);
    const bool has_skin_border = skin_border.has_value();
    if (style_ == Style::secondary || has_skin_border) {
        canvas.set_stroke_color(skin_border ? *skin_border
            : resolve_color("control.border", canvas::Color::rgba8(100, 100, 110)));
        canvas.set_line_width(skin_dimension(SkinDimensionRole::border_width, state, "button.border.width", 1.0f));
        canvas.stroke_rounded_rect(0, 0, w, h, r);
    }

    // Label colour per variant: primary uses on-accent (ink) text; ghost uses
    // accent text; secondary uses the standard primary text.
    const auto skin_foreground = skin_color_only(SkinColorRole::foreground);
    canvas::Color text_color;
    if (skin_foreground) {
        text_color = *skin_foreground;
    } else {
        const auto variant_text =
            !enabled_ ? resolve_color("text.disabled", canvas::Color::rgba8(120, 120, 130))
            : style_ == Style::primary ? resolve_color("accent.text", canvas::Color::rgba8(18, 22, 28))
            : style_ == Style::ghost ? resolve_color("accent.primary", canvas::Color::rgba8(20, 184, 166))
            : resolve_color("text.primary", canvas::Color::rgba8(220, 220, 230));
        text_color = resolve_color("button.foreground", variant_text);
    }
    canvas.set_fill_color(text_color);
    const auto font_size = skin_dimension(SkinDimensionRole::font_size, state, "button.font.size", 14.0f);
    const auto letter_spacing = skin_dimension(SkinDimensionRole::letter_spacing, state, "button.letter-spacing", 0.0f);
    const auto family = skin_string(SkinStringRole::font_family, state, "button.font.family", "system");
    const auto weight = skin_integer(SkinIntegerRole::font_weight, state, 400);
    canvas.set_font_full(family, font_size, weight, 0, letter_spacing);
    const float hpad = skin_dimension(SkinDimensionRole::inset_horizontal, state, "button.inset.horizontal", 8.0f);
    const float vpad = skin_dimension(SkinDimensionRole::inset_vertical, state, "button.inset.vertical", 0.0f);
    std::string draw_label = text_overflow_ellipsis()
        ? truncate_to_width(canvas, label_, std::max(0.0f, w - hpad * 2.0f))
        : label_;
    float text_w = canvas.measure_text(draw_label);
    const int align = skin_integer(SkinIntegerRole::text_align, state, 1);
    const float x = align == 0 ? hpad : align == 2 ? w - hpad - text_w : (w - text_w) / 2.0f;
    const float line_height = skin_dimension(SkinDimensionRole::line_height, state, "button.line-height", font_size);
    const float content_h = std::max(0.0f, h - vpad * 2.0f);
    canvas.fill_text(draw_label, x, vpad + (content_h - line_height) * 0.5f + line_height * 0.8f);

    if (has_focus() && enabled_) {
        const auto skin_focus = skin_color_only(SkinColorRole::focus_ring);
        const auto skin_focus_width = skin_dimension_only(SkinDimensionRole::border_width);
        const bool has_explicit_outline = outline_width() > 0.0f;
        const auto focus_color = skin_focus ? *skin_focus
            : has_explicit_outline ? outline_color()
            : resolve_color("button.focus_ring",
                            resolve_color("accent.primary", canvas::Color::rgba8(20, 184, 166)));
        const float focus_width = skin_focus_width ? *skin_focus_width
            : has_explicit_outline ? outline_width()
            : resolve_dimension("button.focus_ring.width", 2.0f);
        if (focus_width > 0.0f) {
            const float inset = focus_width * 0.5f;
            canvas.set_stroke_color(focus_color);
            canvas.set_line_width(focus_width);
            canvas.stroke_rounded_rect(inset, inset,
                                       std::max(0.0f, w - focus_width),
                                       std::max(0.0f, h - focus_width),
                                       std::max(0.0f, r - inset));
        }
    }
}

void TextButton::on_mouse_down(Point) {
    if (!enabled_) return;
    pressed_ = true;
    request_repaint();
    if (on_click) on_click();
}

void TextButton::on_mouse_up(Point) { pressed_ = false; request_repaint(); }

void TextButton::on_mouse_enter() { hovered_ = true; request_repaint(); }
void TextButton::on_mouse_leave() { hovered_ = false; pressed_ = false; request_repaint(); }

bool TextButton::on_key_event(const KeyEvent& event) {
    if (!enabled_ || (event.key != KeyCode::enter && event.key != KeyCode::space))
        return false;
    if (event.is_down) {
        pressed_ = true;
        request_repaint();
        if (!event.is_repeat && on_click) on_click();
    } else {
        pressed_ = false;
        request_repaint();
    }
    return true;
}

void TextButton::on_focus_changed(bool gained) {
    View::on_focus_changed(gained);
    if (!gained) pressed_ = false;
    request_repaint();
}

// ── HyperlinkButton ─────────────────────────────────────────────────────

void HyperlinkButton::paint(canvas::Canvas& canvas) {
    float w = bounds().width, h = bounds().height;
    // Bug fix: the previous literals passed 0–255 ints to Color::rgba(), which
    // takes 0–1 floats and clamps — so the link rendered solid white. Resolve
    // from the theme's link token with the intended blue as an rgba8 fallback.
    auto link = resolve_color("text.link", canvas::Color::rgba8(80, 130, 230));
    auto color = hovered_ ? adjust_lightness(link, 0.12f) : link;
    canvas.set_fill_color(color);
    canvas.set_font("system", 14.0f);
    canvas.fill_text(text_, 0, h * 0.7f);

    if (hovered_) {
        float text_w = canvas.measure_text(text_);
        canvas.set_stroke_color(color);
        canvas.set_line_width(1.0f);
        canvas.stroke_line(0, h * 0.75f, text_w, h * 0.75f);
    }
}

void HyperlinkButton::on_mouse_down(Point) {
    // URL opening is platform-specific — delegate to platform::open_url if available
}

void HyperlinkButton::on_mouse_enter() { hovered_ = true; }
void HyperlinkButton::on_mouse_leave() { hovered_ = false; }

// ── ArrowButton ─────────────────────────────────────────────────────────

void ArrowButton::paint(canvas::Canvas& canvas) {
    float w = bounds().width, h = bounds().height;
    float cx = w / 2.0f, cy = h / 2.0f;
    float s = std::min(w, h) * 0.3f;

    // Bug fix (same rgba() 0–1-float clamp as HyperlinkButton): use rgba8 and
    // resolve from the theme so the glyph isn't a clamped solid white.
    canvas.set_fill_color(resolve_color("text.secondary", canvas::Color::rgba8(180, 180, 190)));

    canvas::Canvas::Point2D pts[3];
    switch (direction_) {
        case ArrowDirection::up:
            pts[0] = {cx, cy - s}; pts[1] = {cx + s, cy + s}; pts[2] = {cx - s, cy + s};
            break;
        case ArrowDirection::down:
            pts[0] = {cx, cy + s}; pts[1] = {cx + s, cy - s}; pts[2] = {cx - s, cy - s};
            break;
        case ArrowDirection::left:
            pts[0] = {cx - s, cy}; pts[1] = {cx + s, cy - s}; pts[2] = {cx + s, cy + s};
            break;
        case ArrowDirection::right:
            pts[0] = {cx + s, cy}; pts[1] = {cx - s, cy - s}; pts[2] = {cx - s, cy + s};
            break;
    }
    canvas.fill_path(pts, 3);
}

void ArrowButton::on_mouse_down(Point) {
    if (on_click) on_click();
}

// ── ShapeButton ─────────────────────────────────────────────────────────

void ShapeButton::paint(canvas::Canvas& canvas) {
    float w = bounds().width, h = bounds().height;
    if (draw_fn_)
        draw_fn_(canvas, w, h, hovered_, pressed_);
}

void ShapeButton::on_mouse_down(Point) {
    pressed_ = true;
    if (on_click) on_click();
}
void ShapeButton::on_mouse_enter() { hovered_ = true; }
void ShapeButton::on_mouse_leave() { hovered_ = false; pressed_ = false; }

// ── ImageButton ─────────────────────────────────────────────────────────

void ImageButton::paint(canvas::Canvas& canvas) {
    float w = bounds().width, h = bounds().height;
    const auto& path = pressed_ ? (pressed_path_.empty() ? normal_path_ : pressed_path_)
                     : hovered_ ? (hover_path_.empty() ? normal_path_ : hover_path_)
                     : normal_path_;

    if (!path.empty())
        canvas.draw_image_from_file(path, 0, 0, w, h);
}

void ImageButton::on_mouse_down(Point) {
    pressed_ = true;
    if (on_click) on_click();
}
void ImageButton::on_mouse_enter() { hovered_ = true; }
void ImageButton::on_mouse_leave() { hovered_ = false; pressed_ = false; }

// ── ResizableCorner ─────────────────────────────────────────────────────

void ResizableCorner::paint(canvas::Canvas& canvas) {
    float w = bounds().width, h = bounds().height;
    // Bug fix (rgba() 0–1-float clamp): use rgba8 + theme token so the grip
    // lines aren't a clamped solid white.
    canvas.set_stroke_color(resolve_color("control.border", canvas::Color::rgba8(120, 120, 130)));
    canvas.set_line_width(1.0f);

    // Draw resize grip lines (diagonal)
    for (int i = 0; i < 3; ++i) {
        float offset = static_cast<float>(i) * 4.0f;
        canvas.stroke_line(w - 2.0f - offset, h, w, h - 2.0f - offset);
    }
}

void ResizableCorner::on_mouse_down(Point pos) {
    drag_start_x_ = pos.x;
    drag_start_y_ = pos.y;
}

void ResizableCorner::on_mouse_drag(Point pos) {
    if (on_resize)
        on_resize(pos.x - drag_start_x_, pos.y - drag_start_y_);
}

}  // namespace pulp::view
