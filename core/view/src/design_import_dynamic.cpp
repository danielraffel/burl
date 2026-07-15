#include <pulp/view/design_import_dynamic.hpp>
#include <pulp/view/css_gradient.hpp>
#include <pulp/view/widgets.hpp>

#include <choc/text/choc_JSON.h>

#include <algorithm>
#include <cctype>
#include <limits>
#include <stdexcept>
#include <unordered_set>
#include <vector>
#include <cstdlib>
#include <cstdio>

namespace pulp::view {
namespace {

constexpr std::string_view kRuntimeContextFields = "runtime-context-fields";

void disable_unresolved_payload_action(IRNode& node, std::string reason) {
    node.attributes.erase("pulpHostAction");
    node.attributes.erase("pulpRouteId");
    node.attributes.erase("pulpEventContract");
    node.attributes.erase("pulpPayloadContract");
    node.attributes["pulpActionDisabledReason"] = std::move(reason);
}

std::optional<std::string> resolve_imported_action_payload_impl(
    std::string_view payload_contract,
    const NativeImportRuntimeContextLookup& runtime_context_lookup) {
    if (payload_contract.empty()) return std::string{};

    choc::value::Value contract;
    try {
        contract = choc::json::parse(std::string(payload_contract));
    } catch (...) {
        // Scalar payload contracts are intentionally valid. An attempted
        // runtime envelope, however, must never degrade to a literal string.
        if (payload_contract.find(kRuntimeContextFields) != std::string_view::npos)
            return std::nullopt;
        return std::string(payload_contract);
    }

    if (!contract.isObject() || !contract.hasObjectMember("$source"))
        return std::string(payload_contract);
    if (!contract["$source"].isString()) return std::nullopt;
    if (contract["$source"].getString() != kRuntimeContextFields)
        return std::string(payload_contract);
    const auto has_fields = contract.hasObjectMember("fields");
    const auto has_captured_fields = contract.hasObjectMember("capturedFields");
    if (!has_fields && !has_captured_fields) return std::nullopt;

    std::vector<std::pair<std::string, std::string>> mappings;
    if (has_fields) {
        const auto fields = contract["fields"];
        if (!fields.isObject()) return std::nullopt;
        if (fields.size() != 0 && !runtime_context_lookup) return std::nullopt;
        mappings.reserve(fields.size());
        for (uint32_t index = 0; index < fields.size(); ++index) {
            const auto member = fields.getObjectMemberAt(index);
            if (!member.value.isString()) return std::nullopt;
            mappings.emplace_back(std::string(member.name), std::string(member.value.getString()));
        }
    }
    std::ranges::sort(mappings);

    std::vector<std::pair<std::string, std::string>> captured;
    if (has_captured_fields) {
        const auto values = contract["capturedFields"];
        if (!values.isObject()) return std::nullopt;
        captured.reserve(values.size());
        for (uint32_t index = 0; index < values.size(); ++index) {
            const auto member = values.getObjectMemberAt(index);
            const bool supported = member.value.isBool() || member.value.isInt32() ||
                member.value.isInt64() || member.value.isFloat32() ||
                member.value.isFloat64() || member.value.isString();
            if (!supported || (member.value.isString() && member.value.getString().empty()))
                return std::nullopt;
            captured.emplace_back(std::string(member.name),
                                  choc::json::toString(member.value, false));
        }
    }
    std::ranges::sort(captured);
    if (mappings.empty() && captured.empty()) return std::nullopt;
    for (const auto& entry : captured) {
        if (entry.first.empty() || std::ranges::any_of(mappings, [&](const auto& mapping) {
                return mapping.first == entry.first;
            }))
            return std::nullopt;
    }

    std::string payload{"{"};
    for (const auto& [payload_field, context_field] : mappings) {
        if (payload_field.empty() || context_field.empty()) return std::nullopt;
        const auto value = runtime_context_lookup(context_field);
        if (!value || value->empty()) return std::nullopt;
        if (payload.size() != 1) payload += ',';
        payload += choc::json::toString(choc::value::createString(payload_field), false);
        payload += ':';
        payload += choc::json::toString(choc::value::createString(*value), false);
    }
    for (const auto& [payload_field, value_json] : captured) {
        if (payload.size() != 1) payload += ',';
        payload += choc::json::toString(choc::value::createString(payload_field), false);
        payload += ':';
        payload += value_json;
    }
    payload += '}';
    return payload;
}

bool payload_contract_covers_fields_impl(
    std::string_view payload_contract,
    std::span<const std::string_view> required_fields) {
    if (required_fields.empty()) return true;
    if (payload_contract.empty()) return false;

    choc::value::Value contract;
    try {
        contract = choc::json::parse(std::string(payload_contract));
    } catch (...) {
        return required_fields.size() == 1 &&
            payload_contract.find(kRuntimeContextFields) == std::string_view::npos;
    }

    if (!contract.isObject()) return required_fields.size() == 1;
    const bool runtime_envelope = contract.hasObjectMember("$source") &&
        contract["$source"].isString() &&
        contract["$source"].getString() == kRuntimeContextFields;
    if (contract.hasObjectMember("$source") && !runtime_envelope) return false;

    const auto contains_field = [&](std::string_view field) {
        const auto name = std::string(field);
        if (!runtime_envelope) return contract.hasObjectMember(name);
        const bool mapped = contract.hasObjectMember("fields") &&
            contract["fields"].isObject() &&
            contract["fields"].hasObjectMember(name) &&
            contract["fields"][name].isString() &&
            !contract["fields"][name].getString().empty();
        const bool captured = contract.hasObjectMember("capturedFields") &&
            contract["capturedFields"].isObject() &&
            contract["capturedFields"].hasObjectMember(name);
        return mapped || captured;
    };
    return std::ranges::all_of(required_fields, contains_field);
}

std::optional<std::string> collection_fields_payload(
    std::string_view fields_json,
    const std::unordered_map<std::string, std::string>& values) {
    choc::value::Value fields;
    try {
        fields = choc::json::parse(std::string(fields_json));
    } catch (...) {
        return std::nullopt;
    }
    if (!fields.isObject() || fields.size() == 0) return std::nullopt;

    std::vector<std::pair<std::string, std::string>> mappings;
    mappings.reserve(fields.size());
    for (uint32_t index = 0; index < fields.size(); ++index) {
        const auto member = fields.getObjectMemberAt(index);
        if (!member.value.isString()) return std::nullopt;
        mappings.emplace_back(std::string(member.name), std::string(member.value.getString()));
    }
    std::ranges::sort(mappings);

    std::string payload{"{"};
    for (const auto& [payload_field, value_key] : mappings) {
        const auto value = values.find(value_key);
        if (payload_field.empty() || value_key.empty() || value == values.end() ||
            value->second.empty())
            return std::nullopt;
        if (payload.size() != 1) payload += ',';
        payload += choc::json::toString(choc::value::createString(payload_field), false);
        payload += ':';
        payload += choc::json::toString(choc::value::createString(value->second), false);
    }
    payload += '}';
    return payload;
}

void apply_values(IRNode& node,
                  const std::unordered_map<std::string, std::string>& values,
                  std::string_view item_key) {
    if (const auto key = node.attributes.find("pulpValueKey"); key != node.attributes.end()) {
        if (const auto value = values.find(key->second); value != values.end()) {
            const auto captured_text_size = node.text_content.size();
            node.text_content = value->second;
            // A runtime-bound text node's captured width describes the sample
            // string, not an authored constraint. Measure replacement content
            // while retaining explicit min/max bounds for truncation.
            if (node.type == "text" && node.layout.width_mode == SizingMode::fixed) {
                node.style.width.reset();
                node.style.width_dimension.reset();
                node.layout.width_mode = SizingMode::hug;
                node.layout.flex_basis.reset();
            }
            if (node.type == "text" && node.layout.width_mode != SizingMode::fill &&
                node.responsive) {
                // Responsive reconciliation observes the used width of the
                // source sample string. None of its fitted axis forms (fixed,
                // proportional, clamp, min, or max) is an authored constraint
                // on replacement content. Let the bound text measure itself;
                // explicit style min/max widths remain available to truncate
                // it within its real container.
                node.responsive->horizontal.reset();
                node.responsive->horizontal_variants.clear();
            }
            if (const auto kind = node.attributes.find("pulpValueKind");
                kind != node.attributes.end() && kind->second == "markdown") {
                node.style.width.reset();
                node.style.width_dimension.reset();
                node.style.height.reset();
                node.layout.width_mode = SizingMode::fill;
                node.layout.height_mode = SizingMode::hug;
            }
            if (!node.text_runs.empty()) {
                // Runtime collection data replaces the complete sample text;
                // partial range offsets from that sample have no defensible
                // mapping onto the new value. Preserve only a single run that
                // covered the entire captured value (uniform authored style),
                // extending it over the replacement. Mixed/partial evidence
                // is discarded so a sample's first bold/code fragment cannot
                // accidentally style all runtime content.
                const bool uniform_full_range = node.text_runs.size() == 1 &&
                    node.text_runs.front().start == 0 &&
                    node.text_runs.front().end ==
                        static_cast<int>(captured_text_size);
                if (uniform_full_range) {
                    node.text_runs.front().end =
                        static_cast<int>(value->second.size());
                } else {
                    node.text_runs.clear();
                }
            }
        }
    }
    if (const auto source = node.attributes.find("pulpPayloadSource");
        source != node.attributes.end() &&
        (source->second == "collection-item-field" || source->second == "collection-item-fields" ||
         source->second == "collection-item-key")) {
        const auto provenance = node.attributes.find("pulpPayloadProvenance");
        const auto schema = node.attributes.find("pulpPayloadSchema");
        const bool evidence_complete = provenance != node.attributes.end() &&
            !provenance->second.empty() && schema != node.attributes.end() &&
            !schema->second.empty();
        if (!evidence_complete) {
            disable_unresolved_payload_action(node, "collection-payload-evidence-incomplete");
        } else if (source->second == "collection-item-key") {
            if (item_key.empty()) disable_unresolved_payload_action(node, "collection-item-key-missing");
            else node.attributes["pulpPayloadContract"] = std::string(item_key);
        } else if (source->second == "collection-item-fields") {
            const auto fields = node.attributes.find("pulpPayloadFields");
            if (fields == node.attributes.end() || fields->second.empty()) {
                disable_unresolved_payload_action(node, "collection-item-fields-metadata-missing");
            } else if (const auto payload = collection_fields_payload(fields->second, values)) {
                node.attributes["pulpPayloadContract"] = *payload;
            } else {
                disable_unresolved_payload_action(node, "collection-item-fields-unresolved");
            }
        } else {
            const auto field = node.attributes.find("pulpPayloadField");
            if (field == node.attributes.end() || field->second.empty()) {
                disable_unresolved_payload_action(node, "collection-item-field-metadata-missing");
            } else if (const auto value = values.find(field->second);
                       value == values.end() || value->second.empty()) {
                disable_unresolved_payload_action(node, "collection-item-field-missing:" + field->second);
            } else {
                node.attributes["pulpPayloadContract"] = value->second;
            }
        }
        if (std::getenv("PULP_DUMP_BOUNDS")) {
            const auto action = node.attributes.find("pulpHostAction");
            const auto payload = node.attributes.find("pulpPayloadContract");
            const auto disabled = node.attributes.find("pulpActionDisabledReason");
            std::fprintf(stderr, "[dynamic-action] action=%s payload=%s disabled=%s\n",
                action == node.attributes.end() ? "<none>" : action->second.c_str(),
                payload == node.attributes.end() ? "<none>" : payload->second.c_str(),
                disabled == node.attributes.end() ? "<none>" : disabled->second.c_str());
        }
    }
    for (auto& child : node.children) apply_values(child, values, item_key);
}

const IRNode* markdown_value_node(const IRNode& node) {
    if (const auto kind = node.attributes.find("pulpValueKind");
        kind != node.attributes.end() && kind->second == "markdown") return &node;
    for (const auto& child : node.children)
        if (const auto* found = markdown_value_node(child)) return found;
    return nullptr;
}

IRNode* markdown_value_node(IRNode& node) {
    if (const auto kind = node.attributes.find("pulpValueKind");
        kind != node.attributes.end() && kind->second == "markdown") return &node;
    for (auto& child : node.children)
        if (auto* found = markdown_value_node(child)) return found;
    return nullptr;
}

bool contains_action(const IRNode& node) {
    if (node.attributes.contains("pulpHostAction") || node.attributes.contains("pulpRouteId"))
        return true;
    return std::ranges::any_of(node.children, [](const auto& child) { return contains_action(child); });
}

void replace_identity_prefix(std::string& value,
                             std::string_view source_prefix,
                             std::string_view replacement_prefix) {
    if (!value.starts_with(source_prefix)) return;
    value.replace(0, source_prefix.size(), replacement_prefix);
}

void rebase_dynamic_row_identity(IRNode& node,
                                 std::string_view source_prefix,
                                 std::string_view replacement_source_prefix,
                                 std::string_view anchor_prefix,
                                 std::string_view replacement_anchor_prefix) {
    if (node.source_node_id)
        replace_identity_prefix(*node.source_node_id, source_prefix, replacement_source_prefix);
    if (node.stable_anchor_id)
        replace_identity_prefix(*node.stable_anchor_id, anchor_prefix, replacement_anchor_prefix);
    replace_identity_prefix(node.name, source_prefix, replacement_source_prefix);
    for (auto& [_, value] : node.attributes) {
        replace_identity_prefix(value, source_prefix, replacement_source_prefix);
        replace_identity_prefix(value, anchor_prefix, replacement_anchor_prefix);
    }
    for (auto& element : node.interactive_elements)
        if (element.source_node_id)
            replace_identity_prefix(*element.source_node_id, source_prefix, replacement_source_prefix);
    if (node.responsive) {
        for (auto& variant : node.responsive->layout_variants)
            for (auto& child : variant.child_order) {
                replace_identity_prefix(child, source_prefix, replacement_source_prefix);
                replace_identity_prefix(child, anchor_prefix, replacement_anchor_prefix);
            }
    }
    for (auto& child : node.children)
        rebase_dynamic_row_identity(child, source_prefix, replacement_source_prefix,
                                    anchor_prefix, replacement_anchor_prefix);
}

std::string runtime_identity_suffix(std::string_view item_key) {
    // Runtime data can exceed the finite source sample cohort. Preserve the
    // source provenance prefix while making that distinction explicit and
    // keeping every materialized row addressable by its stable item key.
    std::string suffix = "::runtime-item:";
    suffix.reserve(suffix.size() + item_key.size());
    for (const unsigned char c : item_key) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.') suffix.push_back(c);
        else suffix.push_back('_');
    }
    return suffix;
}

IRNode prepare_dynamic_row_node(
    const IRNode& source,
    const std::unordered_map<std::string, std::string>& values,
    std::string_view item_key,
    std::size_t item_index) {
    auto row = source;
    const auto original_source = row.source_node_id.value_or("");
    const auto original_anchor = row.stable_anchor_id.value_or("");
    const auto sample_source = row.attributes.find(
        "pulpCollectionSampleSourceId:" + std::to_string(item_index));
    const auto sample_anchor = row.attributes.find(
        "pulpCollectionSampleAnchorId:" + std::to_string(item_index));
    if (!original_source.empty() && !original_anchor.empty()) {
        const auto source_replacement = sample_source != row.attributes.end()
            ? sample_source->second : original_source + runtime_identity_suffix(item_key);
        const auto anchor_replacement = sample_anchor != row.attributes.end()
            ? sample_anchor->second : original_anchor + runtime_identity_suffix(item_key);
        rebase_dynamic_row_identity(row, original_source, source_replacement,
                                    original_anchor, anchor_replacement);
    }
    apply_values(row, values, item_key);
    // A captured fixed height describes the observed sample, not future bound
    // content. Both measurement and runtime materialization must use the same
    // hug-height root or the virtual row and its painted child can disagree.
    const bool sample_height_invalidated =
        row.attributes.contains("pulpDynamicSampleHeightInvalidated");
    if (!contains_action(row) || sample_height_invalidated) {
        row.style.height.reset();
        row.layout.height_mode = SizingMode::hug;
    }
    return row;
}

std::optional<canvas::Color> imported_hex_color(const std::optional<std::string>& value) {
    if (!value || (value->size() != 7 && value->size() != 9) || (*value)[0] != '#') return std::nullopt;
    char* end = nullptr;
    const auto bits = std::strtoul(value->c_str() + 1, &end, 16);
    if (!end || *end != '\0') return std::nullopt;
    const auto component = [bits](int shift) { return static_cast<float>((bits >> shift) & 0xffu) / 255.0f; };
    if (value->size() == 7) return canvas::Color::rgba(component(16), component(8), component(0), 1.0f);
    return canvas::Color::rgba(component(24), component(16), component(8), component(0));
}

std::string source_tag(const IRNode& node) {
    if (const auto tag = node.attributes.find("sourceTagName"); tag != node.attributes.end())
        return tag->second;
    const auto slash = node.name.rfind('/');
    const auto start = slash == std::string::npos ? 0 : slash + 1;
    const auto dash = node.name.find('-', start);
    return dash == std::string::npos ? std::string{} : node.name.substr(start, dash - start);
}

const IRNode* first_semantic_node(const IRNode& node, std::string_view tag) {
    if (source_tag(node) == tag) return &node;
    for (const auto& child : node.children)
        if (const auto* found = first_semantic_node(child, tag)) return found;
    return nullptr;
}

MarkdownRoleStyle imported_role_style(const IRNode* node) {
    MarkdownRoleStyle style;
    if (!node) return style;
    style.font_family = node->style.font_family;
    style.font_size = node->style.font_size;
    style.font_weight = node->style.font_weight;
    style.color = imported_hex_color(node->style.color);
    return style;
}

MarkdownRoleStyle imported_role_attributes(const IRNode& node, std::string_view prefix) {
    MarkdownRoleStyle style;
    const auto value = [&](std::string_view suffix) -> const std::string* {
        const auto found = node.attributes.find(std::string(prefix) + std::string(suffix));
        return found == node.attributes.end() ? nullptr : &found->second;
    };
    if (const auto* family = value("FontFamily")) style.font_family = *family;
    if (const auto* size = value("FontSize")) {
        char* end = nullptr;
        const auto parsed = std::strtof(size->c_str(), &end);
        if (end != size->c_str() && (std::string_view(end) == "px" || *end == '\0') && parsed > 0.0f)
            style.font_size = parsed;
    }
    if (const auto* weight = value("FontWeight")) {
        char* end = nullptr;
        const auto parsed = std::strtol(weight->c_str(), &end, 10);
        if (end != weight->c_str() && *end == '\0' && parsed >= 100 && parsed <= 900)
            style.font_weight = static_cast<int>(parsed);
    }
    if (const auto* color = value("Color")) style.color = parse_css_color(*color);
    return style;
}

const std::string* imported_attribute(const IRNode& node, std::string_view key) {
    const auto found = node.attributes.find(std::string(key));
    return found == node.attributes.end() ? nullptr : &found->second;
}

std::optional<float> imported_css_pixels(const IRNode& node, std::string_view key) {
    const auto* value = imported_attribute(node, key);
    if (!value) return std::nullopt;
    char* end = nullptr;
    const auto parsed = std::strtof(value->c_str(), &end);
    if (end == value->c_str() || parsed < 0.0f ||
        (*end != '\0' && std::string_view(end) != "px")) return std::nullopt;
    return parsed;
}

std::string imported_color_string(canvas::Color color) {
    const auto byte = [](float value) {
        return static_cast<unsigned>(std::clamp(value, 0.0f, 1.0f) * 255.0f + 0.5f);
    };
    char encoded[10]{};
    std::snprintf(encoded, sizeof(encoded), "#%02x%02x%02x%02x",
                  byte(color.r), byte(color.g), byte(color.b), byte(color.a));
    return encoded;
}

void overlay_role_style(MarkdownRoleStyle& target, const MarkdownRoleStyle& selected) {
    if (selected.font_family) target.font_family = selected.font_family;
    if (selected.font_size) target.font_size = selected.font_size;
    if (selected.font_weight) target.font_weight = selected.font_weight;
    if (selected.color) target.color = selected.color;
}

ImportedMarkdownSkin markdown_skin(const IRNode& root, const IRNode& value) {
    ImportedMarkdownSkin skin;
    if (const auto color = imported_hex_color(root.style.background_color)) skin.background = *color;
    if (const auto color = imported_hex_color(value.style.color)) skin.foreground = *color;
    if (const auto color = imported_hex_color(root.style.border_color)) skin.border = *color;
    skin.font_family = value.style.font_family.value_or("system");
    skin.font_size = value.style.font_size.value_or(14.0f);
    skin.font_weight = value.style.font_weight.value_or(400);
    skin.strong_style = imported_role_style(first_semantic_node(root, "strong"));
    skin.inline_code_style = imported_role_style(first_semantic_node(root, "code"));
    overlay_role_style(skin.strong_style,
                       imported_role_attributes(value, "pulpMarkdownStrong"));
    overlay_role_style(skin.inline_code_style,
                       imported_role_attributes(value, "pulpMarkdownInlineCode"));
    if (skin.inline_code_style.color)
        skin.inline_code_foreground = *skin.inline_code_style.color;
    if (const auto* color = imported_attribute(value, "pulpMarkdownInlineCodeBackground"))
        skin.inline_code_background = parse_css_color(*color);
    if (const auto* color = imported_attribute(value, "pulpMarkdownInlineCodeBorderColor"))
        skin.inline_code_border = parse_css_color(*color);
    skin.inline_code_border_width = imported_css_pixels(
        value, "pulpMarkdownInlineCodeBorderWidth").value_or(skin.inline_code_border_width);
    skin.inline_code_radius = imported_css_pixels(
        value, "pulpMarkdownInlineCodeRadius").value_or(skin.inline_code_radius);
    skin.inline_code_padding_x = imported_css_pixels(
        value, "pulpMarkdownInlineCodePaddingX").value_or(skin.inline_code_padding_x);
    skin.inline_code_padding_y = imported_css_pixels(
        value, "pulpMarkdownInlineCodePaddingY").value_or(skin.inline_code_padding_y);
    skin.border_width = root.style.border_width.value_or(0.0f);
    skin.border_radius = root.style.border_radius.value_or(0.0f);
    skin.padding_top = root.layout.padding_top;
    skin.padding_right = root.layout.padding_right;
    skin.padding_bottom = root.layout.padding_bottom;
    skin.padding_left = root.layout.padding_left;
    return skin;
}

void preserve_markdown_role_metadata(IRNode& root) {
    auto* value = markdown_value_node(root);
    if (!value) return;
    const auto skin = markdown_skin(root, *value);
    const auto stamp = [&](std::string_view prefix, const MarkdownRoleStyle& style) {
        if (style.font_family) value->attributes.try_emplace(
            std::string(prefix) + "FontFamily", *style.font_family);
        if (style.font_size) value->attributes.try_emplace(
            std::string(prefix) + "FontSize", std::to_string(*style.font_size));
        if (style.font_weight) value->attributes.try_emplace(
            std::string(prefix) + "FontWeight", std::to_string(*style.font_weight));
        if (style.color) value->attributes.try_emplace(
            std::string(prefix) + "Color", imported_color_string(*style.color));
    };
    stamp("pulpMarkdownStrong", skin.strong_style);
    stamp("pulpMarkdownInlineCode", skin.inline_code_style);
    float block_gap = 0.0f;
    bool observed_block_spacing = false;
    const auto collect_gap = [&](const auto& self, const IRNode& node) -> void {
        const auto tag = source_tag(node);
        if (tag == "p" || tag == "ol" || tag == "ul" || tag == "pre" ||
            tag == "blockquote") {
            observed_block_spacing = true;
            block_gap = std::max(block_gap, node.layout.margin_top.value_or(0.0f));
        }
        for (const auto& child : node.children) self(self, child);
    };
    collect_gap(collect_gap, root);
    if (observed_block_spacing)
        value->attributes.try_emplace("pulpMarkdownBlockGap", std::to_string(block_gap));
}

float shaped_content_height(View& view, float available_width) {
    if (auto* label = dynamic_cast<Label*>(&view))
        return label->measured_height(std::max(1.0f, available_width));
    if (auto* markdown = dynamic_cast<MarkdownView*>(&view)) {
        const float authored_height = view.flex().dim_height.unit == DimensionUnit::px
            ? view.flex().dim_height.value : view.flex().preferred_height;
        return std::max({markdown->measured_height(std::max(1.0f, available_width)),
                         view.bounds().height, authored_height});
    }

    const float authored_height = view.flex().dim_height.unit == DimensionUnit::px
        ? view.flex().dim_height.value : view.flex().preferred_height;

    const auto padding_top = view.flex().padding_top >= 0.0f
        ? view.flex().padding_top : std::max(0.0f, view.flex().padding);
    const auto padding_bottom = view.flex().padding_bottom >= 0.0f
        ? view.flex().padding_bottom : std::max(0.0f, view.flex().padding);
    const auto direction = view.flex().direction;
    const auto column = direction == FlexDirection::column ||
        direction == FlexDirection::column_reverse;
    float flow_height = 0.0f;
    std::size_t flow_children = 0;
    for (std::size_t index = 0; index < view.child_count(); ++index) {
        auto* child = view.child_at(index);
        if (!child->visible() || child->position() == View::Position::absolute ||
            child->position() == View::Position::fixed) continue;
        const auto child_width = child->bounds().width > 0.0f ? child->bounds().width : available_width;
        const auto child_height = shaped_content_height(*child, child_width) +
            child->flex().margin_t() + child->flex().margin_b();
        if (column) flow_height += child_height;
        else flow_height = std::max(flow_height, child_height);
        ++flow_children;
    }
    if (column && flow_children > 1)
        flow_height += view.flex().effective_gap(direction) *
            static_cast<float>(flow_children - 1);
    if (flow_children > 0)
        return std::max({view.bounds().height, authored_height,
                         padding_top + flow_height + padding_bottom});
    return std::max({view.bounds().height, authored_height, view.intrinsic_height()});
}

bool same_breakpoint(const std::optional<IRNode::ResponsiveBreakpoint>& a,
                     const std::optional<IRNode::ResponsiveBreakpoint>& b) {
    if (a.has_value() != b.has_value()) return false;
    return !a || (a->lower_bound == b->lower_bound && a->upper_bound == b->upper_bound &&
                  a->confidence == b->confidence);
}

bool same_visibility(const std::vector<IRNode::ResponsiveVisibility>& a,
                     const std::vector<IRNode::ResponsiveVisibility>& b) {
    return a.size() == b.size() && std::ranges::equal(a, b, [](const auto& left, const auto& right) {
        return left.visible == right.visible && left.structural == right.structural &&
               same_breakpoint(left.transition_to_next, right.transition_to_next);
    });
}

bool contains_template_binding(const IRNode& node) {
    if (node.attributes.contains("pulpValueKey") ||
        node.attributes.contains("pulpHostAction"))
        return true;
    return std::ranges::any_of(node.children, contains_template_binding);
}

bool contains_collection_value_binding(const IRNode& node) {
    if (node.attributes.contains("pulpValueKey")) return true;
    return std::ranges::any_of(node.children, contains_collection_value_binding);
}

std::string_view collection_value_domain(std::string_view key) {
    const auto separator = key.find('.');
    return key.substr(0, separator);
}

void collect_collection_value_domains(const IRNode& node,
                                      std::unordered_set<std::string>& domains) {
    if (const auto value = node.attributes.find("pulpValueKey");
        value != node.attributes.end())
        domains.emplace(collection_value_domain(value->second));
    for (const auto& child : node.children)
        collect_collection_value_domains(child, domains);
}

bool contains_foreign_collection_value_binding(
    const IRNode& node, const std::unordered_set<std::string>& owned_domains) {
    if (const auto value = node.attributes.find("pulpValueKey");
        value != node.attributes.end() &&
        !owned_domains.contains(std::string(collection_value_domain(value->second))))
        return true;
    return std::ranges::any_of(node.children, [&](const auto& child) {
        return contains_foreign_collection_value_binding(child, owned_domains);
    });
}

bool has_application_state_binding(const IRNode& node) {
    if (!node.responsive) return false;
    return node.responsive->application_state_key.has_value() ||
           !node.responsive->application_state_when.empty() ||
           !node.responsive->application_state_variants.empty();
}

bool is_interactive_composite(const IRNode& node) {
    const auto type = node.type;
    return type == "button" || type == "toggle_button" || type == "togglebutton" ||
           type == "checkbox" || type == "combo_box" || type == "combobox" ||
           type == "text_editor" || type == "texteditor" ||
           node.attributes.contains("pulpHostAction");
}

bool prune_template(IRNode& node) {
    const bool retained = node.attributes.contains("pulpValueKey") ||
                          node.attributes.contains("pulpHostAction") ||
                          has_application_state_binding(node);
    // State-owned content is also one semantic unit. Its descendants are often
    // entirely static because the state contract lives on the enclosing panel;
    // pruning below that boundary would preserve an empty disclosure/popover.
    if (has_application_state_binding(node)) return true;
    // A source control is one visual unit. Once any descendant is data-bound,
    // its unbound icon, chevron, separators, and other static chrome remain
    // part of the reusable row. Ancestors still prune unrelated sample
    // branches until they reach that control boundary.
    if (is_interactive_composite(node) && contains_template_binding(node))
        return true;
    auto out = node.children.begin();
    for (auto it = node.children.begin(); it != node.children.end(); ++it) {
        if (!prune_template(*it)) continue;
        if (out != it) *out = std::move(*it);
        ++out;
    }
    node.children.erase(out, node.children.end());
    return retained || !node.children.empty();
}

std::string repeated_sample_signature(const IRNode& node) {
    const auto slash = node.name.rfind('/');
    const auto start = slash == std::string::npos ? 0 : slash + 1;
    const auto colon = node.name.rfind(':');
    if (colon == std::string::npos || colon < start || colon + 1 == node.name.size())
        return {};
    if (!std::ranges::all_of(std::string_view(node.name).substr(colon + 1),
                             [](unsigned char c) { return std::isdigit(c) != 0; }))
        return {};
    return node.name.substr(start, colon - start);
}

void remove_descendant_collection_templates(IRNode& node) {
    std::unordered_set<std::string> repeated_samples;
    for (const auto& child : node.children) {
        if (!child.attributes.contains("pulpCollectionTemplate")) continue;
        if (auto signature = repeated_sample_signature(child); !signature.empty())
            repeated_samples.insert(std::move(signature));
    }
    std::erase_if(node.children, [&](const IRNode& child) {
        if (child.attributes.contains("pulpCollectionTemplate")) return true;
        const auto signature = repeated_sample_signature(child);
        return !signature.empty() && repeated_samples.contains(signature);
    });
    for (auto& child : node.children) remove_descendant_collection_templates(child);
}

bool contains_descendant_collection_template(const IRNode& node);

bool collection_template_subtree(const IRNode& node) {
    return node.attributes.contains("pulpCollectionTemplate") ||
           contains_descendant_collection_template(node);
}

bool markdown_semantic_sample(const IRNode& node) {
    const auto tag = source_tag(node);
    return tag == "p" || tag == "ol" || tag == "ul" || tag == "pre" ||
           tag == "blockquote";
}

void append_trailing_template_context(IRNode& copy, const IRNode& source,
                                      const std::vector<const IRNode*>& ancestors) {
    const bool markdown = markdown_value_node(source) != nullptr;
    // Trailing static ownership is currently evidenced only for rich-message
    // composites, where metadata and hover actions follow the Markdown body.
    // Applying the same ancestor walk to ordinary list rows lets the last
    // project/tool sample absorb unrelated following sections.
    if (!markdown) return;
    std::unordered_set<std::string> owned_value_domains;
    collect_collection_value_domains(source, owned_value_domains);
    const IRNode* branch = &source;
    for (auto it = ancestors.rbegin(); it != ancestors.rend(); ++it) {
        const auto* ancestor = *it;
        const auto child = std::ranges::find_if(ancestor->children, [&](const IRNode& candidate) {
            return &candidate == branch;
        });
        if (child == ancestor->children.end()) {
            branch = ancestor;
            continue;
        }
        std::vector<IRNode> trailing;
        bool reached_collection_boundary = false;
        bool contains_action_companion = false;
        for (auto sibling = std::next(child); sibling != ancestor->children.end(); ++sibling) {
            if (collection_template_subtree(*sibling) ||
                (contains_collection_value_binding(*sibling) &&
                 contains_foreign_collection_value_binding(*sibling, owned_value_domains))) {
                reached_collection_boundary = true;
                break;
            }
            if (markdown && markdown_semantic_sample(*sibling)) continue;
            contains_action_companion = contains_action_companion || contains_action(*sibling);
            trailing.push_back(*sibling);
        }
        if (!trailing.empty()) {
            copy.children.insert(copy.children.end(),
                                 std::make_move_iterator(trailing.begin()),
                                 std::make_move_iterator(trailing.end()));
        }
        // Rich-message bodies can be nested beneath source-only wrapper chrome.
        // Continue through such wrappers until the enclosing row contributes its
        // action companion, while a following collection remains a hard ownership
        // boundary even when static context precedes it.
        if (reached_collection_boundary || contains_action_companion ||
            ancestor->attributes.contains("pulpCollectionSampleRoot")) return;
        branch = ancestor;
    }
}

void remove_inherited_visibility(
    IRNode& node,
    const std::vector<std::vector<IRNode::ResponsiveVisibility>>& inherited) {
    if (node.responsive && std::ranges::any_of(inherited, [&](const auto& visibility) {
            return same_visibility(node.responsive->visibility, visibility);
        })) {
        node.responsive->visibility.clear();
    }
    for (auto& child : node.children) remove_inherited_visibility(child, inherited);
}

bool contains_descendant_collection_template(const IRNode& node) {
    return std::ranges::any_of(node.children, [](const auto& child) {
        return child.attributes.contains("pulpCollectionTemplate") ||
               contains_descendant_collection_template(child);
    });
}

void apply_own_template_width_semantics(IRNode& node) {
    const bool has_explicit_width = node.style.width.has_value() ||
                                    node.style.width_dimension.has_value();
    const bool has_percentage_ceiling = node.style.max_width_dimension &&
                                        node.style.max_width_dimension->ends_with('%');
    if (!has_explicit_width && has_percentage_ceiling &&
        node.layout.align_self == "stretch") {
        node.layout.width_mode = SizingMode::fill;
        node.style.width_dimension = "100%";
    }
}

bool same_layout_variant_breakpoints(
    const std::vector<IRNode::ResponsiveConstraints::LayoutVariant>& left,
    const std::vector<IRNode::ResponsiveConstraints::LayoutVariant>& right) {
    return left.size() == right.size() &&
        std::ranges::equal(left, right, [](const auto& a, const auto& b) {
            return same_breakpoint(a.transition_to_next, b.transition_to_next);
        });
}

std::optional<float> pixel_literal(
    const std::map<std::string, std::string>& literals, std::string_view property) {
    const auto found = literals.find(std::string(property));
    if (found == literals.end()) return std::nullopt;
    char* end = nullptr;
    const auto value = std::strtof(found->second.c_str(), &end);
    if (end == found->second.c_str() ||
        (*end != '\0' && std::string_view(end) != "px")) return std::nullopt;
    return value;
}

std::string pixel_literal(float value) {
    auto text = std::to_string(value);
    while (text.size() > 1 && text.back() == '0') text.pop_back();
    if (!text.empty() && text.back() == '.') text.pop_back();
    return text + "px";
}

void project_responsive_horizontal_context(
    IRNode& copy, const IRNode& context, float base_left, float base_right) {
    if (!context.responsive || context.responsive->layout_variants.empty()) return;
    const auto& source = context.responsive->layout_variants;
    if (!copy.responsive) copy.responsive.emplace();
    auto& target = copy.responsive->layout_variants;
    if (target.empty()) {
        target.resize(source.size());
        for (std::size_t index = 0; index < source.size(); ++index)
            target[index].transition_to_next = source[index].transition_to_next;
    } else if (!same_layout_variant_breakpoints(target, source)) {
        return;
    }
    const auto copied_left = copy.layout.margin_left.value_or(0.0f);
    const auto copied_right = copy.layout.margin_right.value_or(0.0f);
    for (std::size_t index = 0; index < source.size(); ++index) {
        const auto& literals = source[index].computed_style_literals;
        const auto variant_left = pixel_literal(literals, "marginLeft").value_or(
            context.layout.margin_left.value_or(0.0f)) +
            pixel_literal(literals, "paddingLeft").value_or(context.layout.padding_left);
        const auto variant_right = pixel_literal(literals, "marginRight").value_or(
            context.layout.margin_right.value_or(0.0f)) +
            pixel_literal(literals, "paddingRight").value_or(context.layout.padding_right);
        target[index].computed_style_literals["marginLeft"] =
            pixel_literal(copied_left + variant_left - base_left);
        target[index].computed_style_literals["marginRight"] =
            pixel_literal(copied_right + variant_right - base_right);
    }
}

void apply_flattened_template_context(
    IRNode& copy,
    const std::vector<const IRNode*>& ancestors,
    std::unordered_set<const IRNode*>& claimed_vertical_context) {
    apply_own_template_width_semantics(copy);
    if (copy.attributes.contains("pulpCollectionSampleRoot") ||
        contains_descendant_collection_template(copy)) return;

    const auto add = [](std::optional<float>& target, float value) {
        if (value != 0.0f) target = target.value_or(0.0f) + value;
    };
    for (auto it = ancestors.rbegin(); it != ancestors.rend(); ++it) {
        const auto& context = **it;
        const auto context_left =
            context.layout.margin_left.value_or(0.0f) + context.layout.padding_left;
        const auto context_right =
            context.layout.margin_right.value_or(0.0f) + context.layout.padding_right;
        add(copy.layout.margin_left, context_left);
        add(copy.layout.margin_right, context_right);
        project_responsive_horizontal_context(copy, context, context_left, context_right);
        const bool owns_max_width = copy.style.max_width.has_value() ||
                                    copy.style.max_width_dimension.has_value();
        if (!owns_max_width) {
            if (context.style.max_width_dimension)
                copy.style.max_width_dimension = context.style.max_width_dimension;
            else if (context.style.max_width)
                copy.style.max_width = context.style.max_width;
        }
        if (!copy.layout.align_self && context.layout.align_self)
            copy.layout.align_self = context.layout.align_self;

        if (claimed_vertical_context.insert(*it).second) {
            add(copy.layout.margin_top,
                context.layout.margin_top.value_or(0.0f) + context.layout.padding_top);
        }
        if (context.attributes.contains("pulpCollectionSampleRoot")) break;
    }
    // Percentage width plus horizontal margins over-constrains Yoga to the
    // containing width and then adds the margins outside it. Fill sizing keeps
    // the same stretch behavior while subtracting the captured content gutter.
    if (copy.style.width_dimension == "100%" &&
        (copy.layout.margin_left.value_or(0.0f) != 0.0f ||
         copy.layout.margin_right.value_or(0.0f) != 0.0f))
        copy.style.width_dimension.reset();
}

void retain_repeated_sample_identities(
    IRNode& copy, const IRNode& source, const std::vector<const IRNode*>& ancestors) {
    if (ancestors.empty()) return;
    const auto signature = repeated_sample_signature(source);
    if (signature.empty()) return;
    std::size_t sample_index = 0;
    for (const auto& sibling : ancestors.back()->children) {
        if (!sibling.attributes.contains("pulpCollectionSampleRoot") ||
            repeated_sample_signature(sibling) != signature) continue;
        if (sibling.source_node_id)
            copy.attributes["pulpCollectionSampleSourceId:" + std::to_string(sample_index)] =
                *sibling.source_node_id;
        if (sibling.stable_anchor_id)
            copy.attributes["pulpCollectionSampleAnchorId:" + std::to_string(sample_index)] =
                *sibling.stable_anchor_id;
        ++sample_index;
    }
}

void collect_templates(
    const IRNode& node,
    std::vector<std::vector<IRNode::ResponsiveVisibility>> inherited,
    std::vector<const IRNode*> ancestors,
    std::unordered_set<const IRNode*>& claimed_vertical_context,
    std::unordered_map<std::string, IRNode>& templates) {
    if (const auto it = node.attributes.find("pulpCollectionTemplate");
        it != node.attributes.end()) {
        auto copy = node;
        // A repeated template is extracted from one concrete source sibling,
        // but the source may have captured several same-shape samples. Retain
        // that ordered identity cohort before pruning so runtime rows can map
        // back to the exact source siblings instead of cloning sample zero's
        // anchor onto every materialized item.
        retain_repeated_sample_identities(copy, node, ancestors);
        const bool had_descendant_templates = contains_descendant_collection_template(copy);
        // Each collection template owns an independent runtime row identity.
        // Nested sample templates are evidence for their own collection, not
        // static children of the enclosing row.
        remove_descendant_collection_templates(copy);
        preserve_markdown_role_metadata(copy);
        prune_template(copy);
        append_trailing_template_context(copy, node, ancestors);
        remove_inherited_visibility(copy, inherited);
        if (had_descendant_templates) {
            // The captured height includes nested collection samples that are
            // deliberately removed from this runtime template. Descendant
            // actions may remain as static row chrome, but they do not make
            // that now-stale sample height valid.
            copy.attributes["pulpDynamicSampleHeightInvalidated"] = "true";
            apply_own_template_width_semantics(copy);
        } else
            apply_flattened_template_context(copy, ancestors, claimed_vertical_context);
        copy.attributes.erase("pulpCollectionTemplate");
        templates.emplace(it->second, std::move(copy));
    }
    if (node.responsive && !node.responsive->visibility.empty())
        inherited.push_back(node.responsive->visibility);
    ancestors.push_back(&node);
    for (const auto& child : node.children)
        collect_templates(child, inherited, ancestors, claimed_vertical_context, templates);
}

} // namespace

std::optional<std::string> resolve_imported_action_payload(
    std::string_view payload_contract,
    const NativeImportRuntimeContextLookup& runtime_context_lookup) {
    return resolve_imported_action_payload_impl(payload_contract, runtime_context_lookup);
}

bool imported_action_payload_contract_covers_fields(
    std::string_view payload_contract,
    std::span<const std::string_view> required_fields) {
    return payload_contract_covers_fields_impl(payload_contract, required_fields);
}

std::unordered_map<std::string, IRNode> extract_imported_collection_templates(
    const IRNode& root) {
    std::unordered_map<std::string, IRNode> templates;
    std::unordered_set<const IRNode*> claimed_vertical_context;
    collect_templates(root, {}, {}, claimed_vertical_context, templates);
    if (std::getenv("PULP_DUMP_BOUNDS")) {
        for (const auto& [id, node] : templates) {
            std::vector<std::string_view> actions;
            const auto collect_actions = [&](const auto& self, const IRNode& candidate) -> void {
                if (const auto action = candidate.attributes.find("pulpHostAction");
                    action != candidate.attributes.end()) actions.push_back(action->second);
                for (const auto& child : candidate.children) self(self, child);
            };
            collect_actions(collect_actions, node);
            std::fprintf(stderr,
                "[dynamic-template] id=%s margin-top=%.1f padding-top=%.1f height-mode=%d actions=%zu",
                id.c_str(), node.layout.margin_top.value_or(0.0f), node.layout.padding_top,
                static_cast<int>(node.layout.height_mode), actions.size());
            for (const auto action : actions) std::fprintf(stderr, " %.*s",
                static_cast<int>(action.size()), action.data());
            std::fprintf(stderr, "\n");
        }
    }
    return templates;
}

ImportedMarkdownRow::ImportedMarkdownRow(std::string markdown, ImportedMarkdownSkin skin)
    : skin_(std::move(skin)) {
    set_background_color(skin_.background);
    if (skin_.border_width > 0.0f)
        set_border(skin_.border, skin_.border_width, skin_.border_radius);
    else if (skin_.border_radius > 0.0f)
        set_border_radius(skin_.border_radius);
    auto view = std::make_unique<MarkdownView>(std::move(markdown));
    view->set_body_style(skin_.font_family, skin_.font_size, skin_.font_weight, skin_.foreground);
    view->set_strong_style(skin_.strong_style);
    view->set_inline_code_style(skin_.inline_code_style);
    auto to_skin = [](canvas::Color color) {
        return SkinColor{static_cast<std::uint8_t>(std::clamp(color.r, 0.0f, 1.0f) * 255.0f),
                         static_cast<std::uint8_t>(std::clamp(color.g, 0.0f, 1.0f) * 255.0f),
                         static_cast<std::uint8_t>(std::clamp(color.b, 0.0f, 1.0f) * 255.0f),
                         static_cast<std::uint8_t>(std::clamp(color.a, 0.0f, 1.0f) * 255.0f)};
    };
    auto& state = markdown_skin_.states[WidgetState::rest];
    state.inline_code_background = to_skin(skin_.inline_code_background);
    state.inline_code_foreground = to_skin(skin_.inline_code_foreground);
    state.inline_code_border = to_skin(skin_.inline_code_border);
    state.border_width = skin_.inline_code_border_width;
    state.corner_radius = skin_.inline_code_radius;
    state.inset_horizontal = skin_.inline_code_padding_x;
    state.inset_vertical = skin_.inline_code_padding_y;
    view->set_visual_skin(markdown_skin_);
    markdown_ = view.get();
    add_child(std::move(view));
}

void ImportedMarkdownRow::set_markdown(std::string markdown) {
    markdown_->set_markdown(std::move(markdown));
    measured_height_ = 0.0f;
    invalidate_layout();
}

float ImportedMarkdownRow::measured_height(float width) {
    const auto content_width = std::max(1.0f, width - skin_.padding_left - skin_.padding_right);
    markdown_->set_bounds({skin_.padding_left, skin_.padding_top, content_width, 100000.0f});
    markdown_->layout_children();
    measured_height_ = skin_.padding_top + markdown_->content_height() + skin_.padding_bottom;
    return measured_height_;
}

void ImportedMarkdownRow::layout_children() {
    const auto bounds = local_bounds();
    measured_height(bounds.width);
    markdown_->set_bounds({skin_.padding_left, skin_.padding_top,
                           std::max(1.0f, bounds.width - skin_.padding_left - skin_.padding_right),
                           std::max(1.0f, measured_height_ - skin_.padding_top - skin_.padding_bottom)});
    markdown_->layout_children();
}

class ImportedRepeatedList::RowHost final : public View {
public:
    explicit RowHost(ImportedRepeatedList& owner) : owner_(owner) {
        // A virtual slot is a block-flow containing box. Imported row roots
        // without an authored width rely on cross-axis stretch, which only
        // resolves horizontally when the containing flex direction is column.
        flex().direction = FlexDirection::column;
    }
    ~RowHost() override { release_binding(); }

    void bind(const ImportedListItem& item, std::size_t item_index) {
        if (key_ == item.key && template_id_ == item.template_id && values_ == item.values &&
            item_index_ == item_index) return;
        const auto found = owner_.templates_.find(item.template_id);
        if (found == owner_.templates_.end()) throw std::invalid_argument("unknown imported row template");
        DesignIR row_ir;
        row_ir.root = prepare_dynamic_row_node(found->second, item.values, item.key, item_index);
        row_ir.asset_manifest = owner_.assets_;
        std::unique_ptr<View> row;
        NativeMaterializeOptions options;
        options.responsive_viewport_provider = [this] { return owner_.responsive_viewport(); };
        row = build_native_view_tree(row_ir, owner_.assets_, options);
        if (!row) throw std::runtime_error("imported row template did not materialize");
        if (owner_.binding_context_)
            bind_native_view_tree(*row, row_ir, *owner_.binding_context_);
        release_binding();
        while (child_count()) remove_child(child_at(0));
        add_child(std::move(row));
        key_ = item.key;
        template_id_ = item.template_id;
        values_ = item.values;
        item_index_ = item_index;
        ++owner_.materialization_count_;
        layout_children();
    }

    void layout_children() override {
        // The materialized template root is an ordinary flex item. Let Yoga
        // resolve its authored width, max-width, margins and align-self inside
        // the virtual row instead of replacing that box with the row bounds.
        View::layout_children();
    }

    void on_resized() override {
        // VirtualList binds a fresh slot before assigning its final row box.
        // Re-run nested flex layout when that box arrives so intrinsic text,
        // min-width:0 and ellipsis resolve against the real width rather than
        // the factory's initial zero-sized bounds.
        layout_children();
    }

private:
    void release_binding() {
        if (owner_.binding_context_ && child_count())
            unbind_native_view_tree(*child_at(0), *owner_.binding_context_);
    }

    ImportedRepeatedList& owner_;
    std::string key_;
    std::string template_id_;
    std::unordered_map<std::string, std::string> values_;
    std::size_t item_index_ = std::numeric_limits<std::size_t>::max();
};

ImportedRepeatedList::ImportedRepeatedList(std::unordered_map<std::string, IRNode> templates,
                                           IRAssetManifest assets,
                                           NativeImportBindingContext* binding_context)
    : templates_(std::move(templates)), assets_(std::move(assets)), binding_context_(binding_context) {
    if (templates_.empty()) throw std::invalid_argument("imported repeated list needs templates");
    flex().flex_shrink = 1.0f;
    flex().min_height = 0.0f;
    flex().dim_min_height = {0.0f, DimensionUnit::px};
    auto list = std::make_unique<VirtualList>();
    // Imported web lists retain wheel/keyboard scrolling, but do not invent a
    // permanently painted native scrollbar when the observed source supplied
    // no scrollbar visual primitive. Source-owned scrollbar chrome can be
    // imported as ordinary child nodes when present.
    list->set_scrollbar_indicators_visible(false);
    list->set_auto_follow(true);
    list->set_overscan(3);
    list->set_row_factory([this](std::size_t) { return std::make_unique<RowHost>(*this); });
    list->set_row_binder([this](View& row, std::size_t index) {
        static_cast<RowHost&>(row).bind(items_.at(index), index);
    });
    list_ = list.get();
    add_child(std::move(list));
}

float ImportedRepeatedList::source_height(
    const ImportedListItem& item, float width, std::size_t item_index) {
    const auto found = templates_.find(item.template_id);
    if (found == templates_.end()) throw std::invalid_argument("unknown imported row template");
    if (width <= 0.0f) throw std::logic_error("imported row measurement requires a positive width");
    std::vector<std::pair<std::string, std::string>> sorted_values(item.values.begin(), item.values.end());
    std::ranges::sort(sorted_values);
    std::string cache_key = item.key + "\n" + item.template_id + "\n" + std::to_string(width);
    for (const auto& [key, value] : sorted_values) cache_key += "\n" + key + "=" + value;
    if (const auto cached = measurement_cache_.find(cache_key); cached != measurement_cache_.end())
        return cached->second;

    const auto authored_height = markdown_value_node(found->second)
        ? 0.0f : found->second.style.height.value_or(0.0f);
    auto row_node = prepare_dynamic_row_node(found->second, item.values, item.key, item_index);
    DesignIR row_ir;
    row_ir.root = std::move(row_node);
    row_ir.asset_manifest = assets_;
    NativeMaterializeOptions options;
    options.responsive_viewport_provider = [this] { return responsive_viewport(); };
    auto row = build_native_view_tree(row_ir, assets_, options);
    if (!row) throw std::runtime_error("imported row template did not materialize for measurement");
    // Measure through the same parent-child Yoga relationship used by
    // RowHost. Setting the template root's bounds directly would discard its
    // percentage/max width, margins and align-self before text wrapping.
    View measurement_host;
    measurement_host.flex().direction = FlexDirection::column;
    measurement_host.set_bounds({0, 0, width, 0.0f});
    auto* row_view = row.get();
    // The zero-height wrapper asks Yoga for the row's natural block extent;
    // prevent main-axis flex shrinking from collapsing that intrinsic result.
    row_view->flex().flex_shrink = 0.0f;
    measurement_host.add_child(std::move(row));
    measurement_host.layout_children();
    const auto content_height = shaped_content_height(*row_view, row_view->bounds().width);
    auto measured = row_view->bounds().y +
        std::max(row_view->bounds().height, content_height) + row_view->flex().margin_b();
    if (std::getenv("PULP_DUMP_BOUNDS")) {
        std::fprintf(stderr,
            "[dynamic-row-measure] template=%s row=(%.1f,%.1f %.1fx%.1f) content=%.1f margin-bottom=%.1f measured=%.1f\n",
            item.template_id.c_str(), row_view->bounds().x, row_view->bounds().y,
            row_view->bounds().width, row_view->bounds().height, content_height,
            row_view->flex().margin_b(), measured);
    }
    if (measured <= 0.0f && authored_height > 0.0f) measured = authored_height;
    if (measured <= 0.0f)
        throw std::runtime_error("imported dynamic row has no measurable intrinsic height");
    const auto height = std::max(measured, authored_height);
    measurement_cache_[std::move(cache_key)] = height;
    return height;
}

void ImportedRepeatedList::set_items(std::vector<ImportedListItem> items) {
    std::string anchor_key;
    float anchor_offset = 0.0f;
    const bool follow_tail = list_->is_following_tail();
    if (!follow_tail && !items_.empty() && row_heights_.size() == items_.size()) {
        float top = 0.0f;
        for (std::size_t index = 0; index < items_.size(); ++index) {
            if (top + row_heights_[index] > list_->scroll_y()) {
                anchor_key = items_[index].key;
                anchor_offset = list_->scroll_y() - top;
                break;
            }
            top += row_heights_[index];
        }
    }
    items_ = std::move(items);
    list_->set_row_count(items_.size());
    row_heights_.assign(items_.size(), 1.0f);
    measured_width_ = -1.0f;
    if (bounds().width > 0.0f) measure_rows(bounds().width);
    else for (std::size_t i = 0; i < items_.size(); ++i) list_->set_row_height(i, 1.0f);
    list_->refresh_rows();
    if (!anchor_key.empty()) {
        float top = 0.0f;
        for (std::size_t index = 0; index < items_.size(); ++index) {
            if (items_[index].key == anchor_key) {
                list_->set_scroll_y(top + anchor_offset);
                break;
            }
            top += row_heights_[index];
        }
    }
    if (bounds().width > 0.0f && bounds().height > 0.0f) layout_children();
    invalidate_layout();
    request_repaint();
}

void ImportedRepeatedList::measure_rows(float width) {
    if (width <= 0.0f) return;
    std::string anchor_key;
    float anchor_offset = 0.0f;
    if (measured_width_ > 0.0f && !list_->is_following_tail() &&
        row_heights_.size() == items_.size()) {
        float top = 0.0f;
        for (std::size_t index = 0; index < items_.size(); ++index) {
            if (top + row_heights_[index] > list_->scroll_y()) {
                anchor_key = items_[index].key;
                anchor_offset = list_->scroll_y() - top;
                break;
            }
            top += row_heights_[index];
        }
    }
    row_heights_.resize(items_.size());
    for (std::size_t i = 0; i < items_.size(); ++i) {
        row_heights_[i] = source_height(items_[i], width, i);
        list_->set_row_height(i, row_heights_[i]);
    }
    measured_width_ = width;
    list_->refresh_rows();
    if (!anchor_key.empty()) {
        float top = 0.0f;
        for (std::size_t index = 0; index < items_.size(); ++index) {
            if (items_[index].key == anchor_key) {
                list_->set_scroll_y(top + anchor_offset);
                break;
            }
            top += row_heights_[index];
        }
    }
}

std::pair<float, float> ImportedRepeatedList::responsive_viewport() const {
    const View* root = this;
    while (root->parent()) root = root->parent();
    return {root->bounds().width, root->bounds().height};
}

void ImportedRepeatedList::set_auto_follow(bool enabled) { list_->set_auto_follow(enabled); }
bool ImportedRepeatedList::auto_follow() const { return list_->auto_follow(); }
bool ImportedRepeatedList::is_following_tail() const { return list_->is_following_tail(); }
void ImportedRepeatedList::set_scroll_y(float y) { list_->set_scroll_y(y); }
bool ImportedRepeatedList::scroll_to_item(std::string_view key) {
    for (std::size_t index = 0; index < items_.size(); ++index) {
        if (items_[index].key != key) continue;
        list_->scroll_to_row(index);
        return true;
    }
    return false;
}
float ImportedRepeatedList::scroll_y() const { return list_->scroll_y(); }
float ImportedRepeatedList::content_height() const { return list_->content_height(); }

void ImportedRepeatedList::set_scrollbar_width_policy(ScrollbarWidthPolicy policy) {
    list_->set_scrollbar_width_policy(policy);
    list_->set_scrollbar_indicators_visible(policy != ScrollbarWidthPolicy::none);
}

ScrollbarWidthPolicy ImportedRepeatedList::scrollbar_width_policy() const {
    return list_->scrollbar_width_policy();
}

void ImportedRepeatedList::set_scrollbar_visual_skin(VisualSkin skin) {
    list_->set_visual_skin(std::move(skin));
}

void ImportedRepeatedList::refresh_state_dependent_row(View& descendant) {
    for (std::size_t slot = 0; slot < list_->realized_row_count(); ++slot) {
        auto* row_host = list_->realized_row_at_slot(slot);
        const auto index = list_->bound_index_for_slot(slot);
        if (!row_host || !index || *index >= row_heights_.size()) continue;
        bool contains = false;
        for (auto* cursor = &descendant; cursor; cursor = cursor->parent()) {
            if (cursor == row_host) { contains = true; break; }
            if (cursor == this) break;
        }
        if (!contains || row_host->child_count() == 0) continue;

        // State can reveal content after the row's capture-derived height was
        // measured. Reconcile the live materialized subtree before updating
        // the virtual-list extent so the new content is neither clipped nor
        // omitted from the scroll range.
        row_host->layout_children();
        auto* content = row_host->child_at(0);
        const float content_height = shaped_content_height(
            *content, std::max(1.0f, content->bounds().width));
        const float measured = content->bounds().y +
            std::max(content->bounds().height, content_height) +
            content->flex().margin_b();
        if (measured <= 0.0f || std::abs(measured - row_heights_[*index]) <= 0.01f)
            return;
        row_heights_[*index] = measured;
        list_->set_row_height(*index, measured);
        list_->layout_children();
        invalidate_layout();
        request_repaint();
        return;
    }
}

float ImportedRepeatedList::clipped_viewport_height() const {
    float local_top = 0.0f;
    for (const View* child = this, *ancestor = parent(); ancestor;
         child = ancestor, ancestor = ancestor->parent()) {
        local_top += child->bounds().y;
        if (!ancestor->clips_overflow_y()) continue;
        return std::max(0.0f, std::min(bounds().height,
            ancestor->bounds().height - local_top));
    }
    return bounds().height;
}

void ImportedRepeatedList::layout_children() {
    const float viewport_height = clipped_viewport_height();
    if (bounds().width > 0.0f && std::abs(bounds().width - measured_width_) > 0.01f)
        measure_rows(bounds().width);
    const bool follow_tail = list_->auto_follow() && list_->is_following_tail();
    const auto local = local_bounds();
    list_->set_bounds({local.x, local.y, local.width,
        viewport_height > 0.0f ? viewport_height : local.height});
    if (follow_tail) list_->set_scroll_y(std::numeric_limits<float>::max());
    list_->layout_children();
}

} // namespace pulp::view
