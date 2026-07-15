#pragma once

#include <array>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <unordered_map>

namespace pulp::view {

enum class WidgetState { rest, hover, pressed, focused, selected, disabled, active, validation };

enum class SkinColorRole { background, foreground, icon, border, placeholder,
                           selection, selection_text, caret, focus_ring,
                           scrollbar_track, scrollbar_thumb, inline_code_background,
                           inline_code_foreground, inline_code_border };
enum class SkinDimensionRole { border_width, corner_radius, font_size, letter_spacing, line_height,
                               inset_horizontal, inset_vertical };
enum class SkinStringRole { font_family };
enum class SkinIntegerRole { font_weight, text_align };
enum class SkinBorderCurve { circular, continuous };

struct SkinColor {
    std::uint8_t r = 0, g = 0, b = 0, a = 255;
    bool operator==(const SkinColor&) const = default;
};

struct StateStyle {
    std::optional<SkinColor> background;
    std::optional<SkinColor> foreground;
    std::optional<SkinColor> icon;
    std::optional<SkinColor> border;
    std::optional<SkinColor> placeholder;
    std::optional<SkinColor> selection;
    std::optional<SkinColor> selection_text;
    std::optional<SkinColor> caret;
    std::optional<SkinColor> focus_ring;
    std::optional<SkinColor> scrollbar_track;
    std::optional<SkinColor> scrollbar_thumb;
    std::optional<SkinColor> inline_code_background;
    std::optional<SkinColor> inline_code_foreground;
    std::optional<SkinColor> inline_code_border;
    std::optional<float> border_width;
    std::optional<float> corner_radius;
    std::optional<float> corner_radius_percent;
    std::optional<float> border_top_left_radius;
    std::optional<float> border_top_right_radius;
    std::optional<float> border_bottom_right_radius;
    std::optional<float> border_bottom_left_radius;
    std::optional<float> border_top_left_radius_percent;
    std::optional<float> border_top_right_radius_percent;
    std::optional<float> border_bottom_right_radius_percent;
    std::optional<float> border_bottom_left_radius_percent;
    std::optional<SkinBorderCurve> border_curve;
    std::optional<float> font_size;
    std::optional<float> letter_spacing;
    std::optional<float> line_height;
    std::optional<float> inset_horizontal;
    std::optional<float> inset_vertical;
    std::optional<std::string> font_family;
    std::optional<int> font_weight;
    std::optional<int> text_align;
};

struct VisualSkin {
    std::map<WidgetState, StateStyle> states;
    std::unordered_map<std::string, std::string> token_refs;

    const StateStyle* state(WidgetState requested) const;
    std::optional<SkinColor> color(SkinColorRole role, WidgetState requested) const;
    std::optional<float> dimension(SkinDimensionRole role, WidgetState requested) const;
    std::optional<float> resolved_corner_radius(WidgetState requested,
                                                float width,
                                                float height) const;
    /// Resolve state-aware CSS corner longhands in TL, TR, BL, BR order.
    /// Returns nullopt when the state chain uses only the uniform radius slot,
    /// allowing controls to retain their optimized rounded-rect paint path.
    std::optional<std::array<float, 4>> resolved_corner_radii(
        WidgetState requested, float width, float height) const;
    std::optional<SkinBorderCurve> border_curve(WidgetState requested) const;
    std::optional<std::string> string(SkinStringRole role, WidgetState requested) const;
    std::optional<int> integer(SkinIntegerRole role, WidgetState requested) const;
};

} // namespace pulp::view
