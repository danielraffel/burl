#include <pulp/view/visual_skin.hpp>

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
