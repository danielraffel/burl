#include <pulp/view/design_import.hpp>
#include <pulp/view/authored_token_document.hpp>

#include <algorithm>
#include <cmath>
#include <iomanip>
#include <limits>
#include <sstream>

namespace pulp::view {
namespace {

std::string token_name(std::string value) {
    if (value.size() >= 3 && value.front() == '{' && value.back() == '}')
        return value.substr(1, value.size() - 2);
    return value;
}

std::string color_literal(const Color& color) {
    auto byte = [](float value) {
        return static_cast<int>(std::lround(std::clamp(value, 0.0f, 1.0f) * 255.0f));
    };
    std::ostringstream out;
    out << '#' << std::hex << std::setfill('0')
        << std::setw(2) << byte(color.r) << std::setw(2) << byte(color.g)
        << std::setw(2) << byte(color.b) << std::setw(2) << byte(color.a);
    return out.str();
}

ImportDiagnostic diagnostic(const IRNode& node, std::string path, std::string message) {
    return {ImportDiagnosticSeverity::error, "token-ref-unresolved", std::move(path),
            std::move(message), ImportDiagnosticKind::unsupported_property,
            node.stable_anchor_id, std::nullopt};
}

ImportDiagnostic skin_diagnostic(const IRNode& node, std::string path,
                                 std::string code, std::string message) {
    return {ImportDiagnosticSeverity::error, std::move(code), std::move(path),
            std::move(message), ImportDiagnosticKind::unsupported_property,
            node.stable_anchor_id, std::string("visual_skin.token_refs")};
}

std::optional<WidgetState> skin_state(std::string_view name) {
    if (name == "rest") return WidgetState::rest;
    if (name == "hover") return WidgetState::hover;
    if (name == "pressed") return WidgetState::pressed;
    if (name == "focused") return WidgetState::focused;
    if (name == "selected") return WidgetState::selected;
    if (name == "disabled") return WidgetState::disabled;
    if (name == "active") return WidgetState::active;
    if (name == "validation") return WidgetState::validation;
    return std::nullopt;
}

SkinColor skin_color(const Color& color) {
    auto byte = [](float value) {
        return static_cast<std::uint8_t>(std::lround(
            std::clamp(value, 0.0f, 1.0f) * 255.0f));
    };
    return {byte(color.r), byte(color.g), byte(color.b), byte(color.a)};
}

enum class SkinValueKind { color, dimension, string, integer };

std::optional<SkinValueKind> skin_role_kind(std::string_view role) {
    if (role == "background" || role == "foreground" || role == "icon" ||
        role == "border" || role == "placeholder" || role == "selection" ||
        role == "selection_text" || role == "caret" || role == "focus_ring" ||
        role == "scrollbar_track" || role == "scrollbar_thumb" ||
        role == "inline_code_background" || role == "inline_code_foreground" ||
        role == "inline_code_border") return SkinValueKind::color;
    if (role == "border_width" || role == "corner_radius" ||
        role == "border_top_left_radius" || role == "border_top_right_radius" ||
        role == "border_bottom_right_radius" || role == "border_bottom_left_radius" ||
        role == "font_size" ||
        role == "letter_spacing" || role == "line_height" ||
        role == "inset_horizontal" || role == "inset_vertical") return SkinValueKind::dimension;
    if (role == "font_family") return SkinValueKind::string;
    if (role == "font_weight" || role == "text_align") return SkinValueKind::integer;
    return std::nullopt;
}

void set_skin_color(StateStyle& style, std::string_view role, SkinColor value) {
    if (role == "background") style.background = value;
    else if (role == "foreground") style.foreground = value;
    else if (role == "icon") style.icon = value;
    else if (role == "border") style.border = value;
    else if (role == "placeholder") style.placeholder = value;
    else if (role == "selection") style.selection = value;
    else if (role == "selection_text") style.selection_text = value;
    else if (role == "caret") style.caret = value;
    else if (role == "focus_ring") style.focus_ring = value;
    else if (role == "scrollbar_track") style.scrollbar_track = value;
    else if (role == "scrollbar_thumb") style.scrollbar_thumb = value;
    else if (role == "inline_code_background") style.inline_code_background = value;
    else if (role == "inline_code_foreground") style.inline_code_foreground = value;
    else if (role == "inline_code_border") style.inline_code_border = value;
}

void set_skin_dimension(StateStyle& style, std::string_view role, float value) {
    if (role == "border_width") style.border_width = value;
    else if (role == "corner_radius") style.corner_radius = value;
    else if (role == "border_top_left_radius") style.border_top_left_radius = value;
    else if (role == "border_top_right_radius") style.border_top_right_radius = value;
    else if (role == "border_bottom_right_radius") style.border_bottom_right_radius = value;
    else if (role == "border_bottom_left_radius") style.border_bottom_left_radius = value;
    else if (role == "font_size") style.font_size = value;
    else if (role == "letter_spacing") style.letter_spacing = value;
    else if (role == "line_height") style.line_height = value;
    else if (role == "inset_horizontal") style.inset_horizontal = value;
    else if (role == "inset_vertical") style.inset_vertical = value;
}

std::string actual_token_kind(const Theme& theme, const std::string& name) {
    if (theme.color(name)) return "color";
    if (theme.dimension(name)) return "dimension";
    if (theme.string_token(name)) return "string";
    return "missing";
}

void resolve_skin_tokens(IRNode& node, const Theme& theme,
                         std::vector<ImportDiagnostic>& diagnostics) {
    if (!node.visual_skin) return;
    auto& skin = *node.visual_skin;
    std::vector<std::string> resolved_paths;
    for (const auto& [path, ref] : skin.token_refs) {
        const auto separator = path.find('.');
        if (separator == std::string::npos || path.find('.', separator + 1) != std::string::npos) {
            diagnostics.push_back(skin_diagnostic(node, path, "skin-token-path-invalid",
                "visual skin token path must be <state>.<role>: " + path));
            continue;
        }
        const auto state_name = path.substr(0, separator);
        const auto role = path.substr(separator + 1);
        const auto state = skin_state(state_name);
        const auto kind = skin_role_kind(role);
        if (!state || !kind) {
            diagnostics.push_back(skin_diagnostic(node, path, "skin-token-path-unsupported",
                "unsupported visual skin state or role at " + path));
            continue;
        }
        const auto name = token_name(ref);
        auto& style = skin.states[*state];
        bool resolved = false;
        switch (*kind) {
            case SkinValueKind::color:
                if (auto value = theme.color(name)) {
                    set_skin_color(style, role, skin_color(*value));
                    resolved = true;
                }
                break;
            case SkinValueKind::dimension:
                if (auto value = theme.dimension(name)) {
                    set_skin_dimension(style, role, *value);
                    resolved = true;
                }
                break;
            case SkinValueKind::string:
                if (auto value = theme.string_token(name)) {
                    style.font_family = *value;
                    resolved = true;
                }
                break;
            case SkinValueKind::integer:
                if (auto value = theme.dimension(name); value && std::isfinite(*value) &&
                    std::floor(*value) == *value && *value >= static_cast<float>(std::numeric_limits<int>::min()) &&
                    *value <= static_cast<float>(std::numeric_limits<int>::max())) {
                    const auto integer = static_cast<int>(*value);
                    if (role == "font_weight") style.font_weight = integer;
                    else style.text_align = integer;
                    resolved = true;
                }
                break;
        }
        if (resolved) {
            resolved_paths.push_back(path);
        } else {
            const char* expected = *kind == SkinValueKind::color ? "color" :
                *kind == SkinValueKind::dimension ? "dimension" :
                *kind == SkinValueKind::string ? "string" : "integer dimension";
            diagnostics.push_back(skin_diagnostic(node, path, "skin-token-ref-unresolved",
                "cannot resolve " + ref + " at visual_skin." + path + " as " + expected +
                " (actual: " + actual_token_kind(theme, name) + ")"));
        }
    }
    for (const auto& path : resolved_paths) skin.token_refs.erase(path);
}

bool set_color(IRNode& node, std::string_view path, const Color& value) {
    const auto literal = color_literal(value);
    if (path == "paint.backgroundColor") node.style.background_color = literal;
    else if (path == "paint.color") node.style.color = literal;
    else if (path == "paint.borderColor") node.style.border_color = literal;
    else if (path == "paint.borderTopColor") node.style.border_top_color = literal;
    else if (path == "paint.borderRightColor") node.style.border_right_color = literal;
    else if (path == "paint.borderBottomColor") node.style.border_bottom_color = literal;
    else if (path == "paint.borderLeftColor") node.style.border_left_color = literal;
    else return false;
    return true;
}

bool set_dimension(IRNode& node, std::string_view path, float value) {
    if (path == "paint.borderRadius") node.style.border_radius = value;
    else if (path == "paint.borderWidth") node.style.border_width = value;
    else if (path == "paint.borderTopWidth") node.style.border_top_width = value;
    else if (path == "paint.borderRightWidth") node.style.border_right_width = value;
    else if (path == "paint.borderBottomWidth") node.style.border_bottom_width = value;
    else if (path == "paint.borderLeftWidth") node.style.border_left_width = value;
    else if (path == "layout.gap") node.layout.gap = value;
    else if (path == "layout.rowGap") node.layout.row_gap = value;
    else if (path == "layout.columnGap") node.layout.column_gap = value;
    else if (path == "layout.paddingTop") node.layout.padding_top = value;
    else if (path == "layout.paddingRight") node.layout.padding_right = value;
    else if (path == "layout.paddingBottom") node.layout.padding_bottom = value;
    else if (path == "layout.paddingLeft") node.layout.padding_left = value;
    else if (path == "layout.marginTop") node.layout.margin_top = value;
    else if (path == "layout.marginRight") node.layout.margin_right = value;
    else if (path == "layout.marginBottom") node.layout.margin_bottom = value;
    else if (path == "layout.marginLeft") node.layout.margin_left = value;
    else return false;
    return true;
}

bool set_typography(IRNode& node, const Theme& theme, const std::string& name) {
    bool resolved = false;
    if (auto value = theme.string_token(name + ".fontFamily")) {
        node.style.font_family = *value;
        resolved = true;
    }
    if (auto value = theme.dimension(name + ".fontSize")) {
        node.style.font_size = *value;
        resolved = true;
    }
    if (auto value = theme.dimension(name + ".fontWeight")) {
        node.style.font_weight = static_cast<int>(std::lround(*value));
        resolved = true;
    }
    if (auto value = theme.dimension(name + ".lineHeight")) {
        node.style.line_height = *value;
        resolved = true;
    }
    if (auto value = theme.dimension(name + ".letterSpacing")) {
        node.style.letter_spacing = *value;
        resolved = true;
    }
    return resolved;
}

void resolve_node_tokens(IRNode& node, const Theme& theme,
                         std::vector<ImportDiagnostic>& diagnostics) {
    resolve_skin_tokens(node, theme, diagnostics);
    std::vector<std::string> resolved_paths;
    for (const auto& [path, ref] : node.token_refs) {
        const auto name = token_name(ref);
        bool resolved = false;
        if (path == "text.typography") resolved = set_typography(node, theme, name);
        else if (auto value = theme.color(name)) resolved = set_color(node, path, *value);
        else if (auto value = theme.dimension(name)) resolved = set_dimension(node, path, *value);
        if (!resolved)
            diagnostics.push_back(diagnostic(node, path, "cannot resolve " + ref + " at " + path));
        else
            resolved_paths.push_back(path);
    }
    for (const auto& path : resolved_paths) node.token_refs.erase(path);
    for (auto& child : node.children) resolve_node_tokens(child, theme, diagnostics);
}

}  // namespace

DesignIR resolve_design_ir_token_refs(const DesignIR& ir,
                                      const AuthoredTokenDocument& authored_tokens,
                                      std::vector<ImportDiagnostic>* diagnostics_out) {
    DesignIR resolved = ir;
    std::vector<ImportDiagnostic> diagnostics;
    resolve_node_tokens(resolved.root, authored_tokens.resolved_theme, diagnostics);
    if (diagnostics_out)
        diagnostics_out->insert(diagnostics_out->end(), diagnostics.begin(), diagnostics.end());
    resolved.diagnostics.insert(resolved.diagnostics.end(), diagnostics.begin(), diagnostics.end());
    return resolved;
}

}  // namespace pulp::view
