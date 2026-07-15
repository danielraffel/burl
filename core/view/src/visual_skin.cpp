#include <pulp/view/visual_skin.hpp>

#include <algorithm>
#include <array>

namespace pulp::view {
namespace {

template <typename Value, typename Getter>
std::optional<Value> resolve(const VisualSkin& skin, WidgetState requested, Getter getter) {
    std::array<WidgetState, 3> chain{requested, WidgetState::rest, WidgetState::rest};
    std::size_t count = requested == WidgetState::rest ? 1 : 2;
    if (requested == WidgetState::pressed) {
        chain = {WidgetState::pressed, WidgetState::hover, WidgetState::rest};
        count = 3;
    } else if (requested == WidgetState::active) {
        chain = {WidgetState::active, WidgetState::selected, WidgetState::rest};
        count = 3;
    }
    for (std::size_t i = 0; i < count; ++i) {
        const auto found = skin.states.find(chain[i]);
        if (found == skin.states.end()) continue;
        if (auto value = getter(found->second)) return value;
    }
    return std::nullopt;
}

} // namespace

const StateStyle* VisualSkin::state(WidgetState requested) const {
    auto found = states.find(requested);
    if (found != states.end()) return &found->second;
    found = states.find(WidgetState::rest);
    return found == states.end() ? nullptr : &found->second;
}

std::optional<SkinColor> VisualSkin::color(SkinColorRole role, WidgetState requested) const {
    return resolve<SkinColor>(*this, requested, [role](const StateStyle& style) {
        switch (role) {
            case SkinColorRole::background: return style.background;
            case SkinColorRole::foreground: return style.foreground;
            case SkinColorRole::icon: return style.icon;
            case SkinColorRole::border: return style.border;
            case SkinColorRole::placeholder: return style.placeholder;
            case SkinColorRole::selection: return style.selection;
            case SkinColorRole::selection_text: return style.selection_text;
            case SkinColorRole::caret: return style.caret;
            case SkinColorRole::focus_ring: return style.focus_ring;
            case SkinColorRole::scrollbar_track: return style.scrollbar_track;
            case SkinColorRole::scrollbar_thumb: return style.scrollbar_thumb;
            case SkinColorRole::inline_code_background: return style.inline_code_background;
            case SkinColorRole::inline_code_foreground: return style.inline_code_foreground;
            case SkinColorRole::inline_code_border: return style.inline_code_border;
        }
        return std::optional<SkinColor>{};
    });
}

std::optional<float> VisualSkin::dimension(SkinDimensionRole role, WidgetState requested) const {
    return resolve<float>(*this, requested, [role](const StateStyle& style) {
        switch (role) {
            case SkinDimensionRole::border_width: return style.border_width;
            case SkinDimensionRole::corner_radius: return style.corner_radius;
            case SkinDimensionRole::font_size: return style.font_size;
            case SkinDimensionRole::letter_spacing: return style.letter_spacing;
            case SkinDimensionRole::line_height: return style.line_height;
            case SkinDimensionRole::inset_horizontal: return style.inset_horizontal;
            case SkinDimensionRole::inset_vertical: return style.inset_vertical;
        }
        return std::optional<float>{};
    });
}

std::optional<float> VisualSkin::resolved_corner_radius(
    WidgetState requested, float width, float height) const {
    return resolve<float>(*this, requested, [width, height](const StateStyle& style) {
        if (style.corner_radius_percent)
            return std::optional<float>{std::min(width, height) *
                                        std::max(0.0f, *style.corner_radius_percent) / 100.0f};
        return style.corner_radius;
    });
}

std::optional<std::array<float, 4>> VisualSkin::resolved_corner_radii(
    WidgetState requested, float width, float height) const {
    const auto has_per_corner = resolve<int>(*this, requested, [](const StateStyle& style) {
        return style.border_top_left_radius || style.border_top_right_radius ||
                       style.border_bottom_left_radius || style.border_bottom_right_radius ||
                       style.border_top_left_radius_percent || style.border_top_right_radius_percent ||
                       style.border_bottom_left_radius_percent || style.border_bottom_right_radius_percent
            ? std::optional<int>{1} : std::nullopt;
    });
    if (!has_per_corner) return std::nullopt;

    struct RadiusValue { float value = 0.0f; bool percent = false; };
    const float basis = std::min(width, height);
    auto resolve_corner = [&](auto percent_member, auto pixel_member) {
        const auto value = resolve<RadiusValue>(*this, requested,
            [&](const StateStyle& style) -> std::optional<RadiusValue> {
                if (const auto percent = style.*percent_member)
                    return RadiusValue{*percent, true};
                if (const auto pixels = style.*pixel_member)
                    return RadiusValue{*pixels, false};
                if (style.corner_radius_percent)
                    return RadiusValue{*style.corner_radius_percent, true};
                if (style.corner_radius)
                    return RadiusValue{*style.corner_radius, false};
                return std::nullopt;
            }).value_or(RadiusValue{});
        return std::max(0.0f, value.percent ? basis * value.value / 100.0f : value.value);
    };

    std::array<float, 4> radii = {
        resolve_corner(&StateStyle::border_top_left_radius_percent,
                       &StateStyle::border_top_left_radius),
        resolve_corner(&StateStyle::border_top_right_radius_percent,
                       &StateStyle::border_top_right_radius),
        resolve_corner(&StateStyle::border_bottom_left_radius_percent,
                       &StateStyle::border_bottom_left_radius),
        resolve_corner(&StateStyle::border_bottom_right_radius_percent,
                       &StateStyle::border_bottom_right_radius),
    };
    float scale = 1.0f;
    auto constrain = [&](float available, float required) {
        if (required > 0.0f) scale = std::min(scale, available / required);
    };
    constrain(width, radii[0] + radii[1]);
    constrain(width, radii[2] + radii[3]);
    constrain(height, radii[0] + radii[2]);
    constrain(height, radii[1] + radii[3]);
    scale = std::clamp(scale, 0.0f, 1.0f);
    for (auto& radius : radii) radius *= scale;
    return radii;
}

std::optional<SkinBorderCurve> VisualSkin::border_curve(WidgetState requested) const {
    return resolve<SkinBorderCurve>(*this, requested,
        [](const StateStyle& style) { return style.border_curve; });
}

std::optional<std::string> VisualSkin::string(SkinStringRole role, WidgetState requested) const {
    return resolve<std::string>(*this, requested, [role](const StateStyle& style) {
        switch (role) { case SkinStringRole::font_family: return style.font_family; }
        return std::optional<std::string>{};
    });
}

std::optional<int> VisualSkin::integer(SkinIntegerRole role, WidgetState requested) const {
    return resolve<int>(*this, requested, [role](const StateStyle& style) {
        switch (role) {
            case SkinIntegerRole::font_weight: return style.font_weight;
            case SkinIntegerRole::text_align: return style.text_align;
        }
        return std::optional<int>{};
    });
}

} // namespace pulp::view
