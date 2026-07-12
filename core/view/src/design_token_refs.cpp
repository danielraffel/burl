#include <pulp/view/design_import.hpp>
#include <pulp/view/authored_token_document.hpp>

#include <algorithm>
#include <cmath>
#include <iomanip>
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
