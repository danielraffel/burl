#pragma once

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <unordered_map>

namespace pulp::view {

enum class WidgetState { rest, hover, pressed, focused, selected, disabled, active, validation };

enum class SkinColorRole { background, foreground, icon, border };
enum class SkinDimensionRole { border_width, corner_radius, font_size, letter_spacing, line_height };

struct SkinColor {
    std::uint8_t r = 0, g = 0, b = 0, a = 255;
    bool operator==(const SkinColor&) const = default;
};

struct StateStyle {
    std::optional<SkinColor> background;
    std::optional<SkinColor> foreground;
    std::optional<SkinColor> icon;
    std::optional<SkinColor> border;
    std::optional<float> border_width;
    std::optional<float> corner_radius;
    std::optional<float> font_size;
    std::optional<float> letter_spacing;
    std::optional<float> line_height;
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
};

} // namespace pulp::view
