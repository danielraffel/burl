#include <pulp/view/design_import_dynamic.hpp>
#include <pulp/view/widgets.hpp>

#include <algorithm>
#include <stdexcept>
#include <vector>
#include <cstdlib>

namespace pulp::view {
namespace {

void apply_values(IRNode& node, const std::unordered_map<std::string, std::string>& values) {
    if (const auto key = node.attributes.find("pulpValueKey"); key != node.attributes.end()) {
        if (const auto value = values.find(key->second); value != values.end()) {
            node.text_content = value->second;
            if (!node.text_runs.empty()) {
                node.text_runs.resize(1);
                node.text_runs.front().start = 0;
                node.text_runs.front().end = value->second.size();
            }
        }
    }
    if (const auto source = node.attributes.find("pulpPayloadSource");
        source != node.attributes.end() && source->second == "collection-item-field") {
        const auto field = node.attributes.find("pulpPayloadField");
        const auto provenance = node.attributes.find("pulpPayloadProvenance");
        const auto schema = node.attributes.find("pulpPayloadSchema");
        if (field == node.attributes.end() || provenance == node.attributes.end() ||
            provenance->second.empty() || schema == node.attributes.end() || schema->second.empty())
            throw std::invalid_argument("collection action payload metadata is incomplete");
        const auto value = values.find(field->second);
        if (value == values.end() || value->second.empty())
            throw std::invalid_argument("collection action payload field is missing");
        node.attributes["pulpPayloadContract"] = value->second;
    }
    for (auto& child : node.children) apply_values(child, values);
}

const IRNode* markdown_value_node(const IRNode& node) {
    if (const auto kind = node.attributes.find("pulpValueKind");
        kind != node.attributes.end() && kind->second == "markdown") return &node;
    for (const auto& child : node.children)
        if (const auto* found = markdown_value_node(child)) return found;
    return nullptr;
}

bool contains_action(const IRNode& node) {
    if (node.attributes.contains("pulpHostAction") || node.attributes.contains("pulpRouteId"))
        return true;
    return std::ranges::any_of(node.children, [](const auto& child) { return contains_action(child); });
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

ImportedMarkdownSkin markdown_skin(const IRNode& root, const IRNode& value) {
    ImportedMarkdownSkin skin;
    if (const auto color = imported_hex_color(root.style.background_color)) skin.background = *color;
    if (const auto color = imported_hex_color(value.style.color)) skin.foreground = *color;
    if (const auto color = imported_hex_color(root.style.border_color)) skin.border = *color;
    skin.font_family = value.style.font_family.value_or("system");
    skin.font_size = value.style.font_size.value_or(14.0f);
    skin.font_weight = value.style.font_weight.value_or(400);
    skin.border_width = root.style.border_width.value_or(0.0f);
    skin.border_radius = root.style.border_radius.value_or(0.0f);
    skin.padding_top = root.layout.padding_top;
    skin.padding_right = root.layout.padding_right;
    skin.padding_bottom = root.layout.padding_bottom;
    skin.padding_left = root.layout.padding_left;
    return skin;
}

float shaped_content_height(View& view, float available_width) {
    if (auto* label = dynamic_cast<Label*>(&view))
        return label->measured_height(std::max(1.0f, available_width));
    float bottom = view.intrinsic_height();
    for (std::size_t index = 0; index < view.child_count(); ++index) {
        auto* child = view.child_at(index);
        if (!child->visible()) continue;
        const auto child_width = child->bounds().width > 0.0f ? child->bounds().width : available_width;
        bottom = std::max(bottom, child->bounds().y + shaped_content_height(*child, child_width));
    }
    return bottom;
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

bool prune_template(IRNode& node) {
    const bool retained = node.attributes.contains("pulpValueKey") ||
                          node.attributes.contains("pulpHostAction");
    auto out = node.children.begin();
    for (auto it = node.children.begin(); it != node.children.end(); ++it) {
        if (!prune_template(*it)) continue;
        if (out != it) *out = std::move(*it);
        ++out;
    }
    node.children.erase(out, node.children.end());
    return retained || !node.children.empty();
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

void collect_templates(
    const IRNode& node,
    std::vector<std::vector<IRNode::ResponsiveVisibility>> inherited,
    std::unordered_map<std::string, IRNode>& templates) {
    if (const auto it = node.attributes.find("pulpCollectionTemplate");
        it != node.attributes.end()) {
        auto copy = node;
        prune_template(copy);
        remove_inherited_visibility(copy, inherited);
        copy.attributes.erase("pulpCollectionTemplate");
        templates.emplace(it->second, std::move(copy));
    }
    if (node.responsive && !node.responsive->visibility.empty())
        inherited.push_back(node.responsive->visibility);
    for (const auto& child : node.children) collect_templates(child, inherited, templates);
}

} // namespace

std::unordered_map<std::string, IRNode> extract_imported_collection_templates(
    const IRNode& root) {
    std::unordered_map<std::string, IRNode> templates;
    collect_templates(root, {}, templates);
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
    explicit RowHost(ImportedRepeatedList& owner) : owner_(owner) {}
    ~RowHost() override { release_binding(); }

    void bind(const ImportedListItem& item) {
        if (key_ == item.key && template_id_ == item.template_id && values_ == item.values) return;
        const auto found = owner_.templates_.find(item.template_id);
        if (found == owner_.templates_.end()) throw std::invalid_argument("unknown imported row template");
        DesignIR row_ir;
        row_ir.root = found->second;
        row_ir.asset_manifest = owner_.assets_;
        apply_values(row_ir.root, item.values);
        std::unique_ptr<View> row;
        if (const auto* markdown_node = markdown_value_node(found->second)) {
            const auto value_key = markdown_node->attributes.find("pulpValueKey");
            const auto value = value_key == markdown_node->attributes.end()
                ? item.values.end() : item.values.find(value_key->second);
            row = std::make_unique<ImportedMarkdownRow>(
                value == item.values.end() ? std::string{} : value->second,
                markdown_skin(found->second, *markdown_node));
        } else {
            row = build_native_view_tree(row_ir, owner_.assets_);
        }
        if (!row) throw std::runtime_error("imported row template did not materialize");
        if (owner_.binding_context_)
            bind_native_view_tree(*row, row_ir, *owner_.binding_context_);
        release_binding();
        while (child_count()) remove_child(child_at(0));
        add_child(std::move(row));
        key_ = item.key;
        template_id_ = item.template_id;
        values_ = item.values;
        ++owner_.materialization_count_;
        layout_children();
    }

    void layout_children() override {
        if (child_count()) {
            child_at(0)->set_bounds(local_bounds());
            child_at(0)->layout_children();
        }
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
};

ImportedRepeatedList::ImportedRepeatedList(std::unordered_map<std::string, IRNode> templates,
                                           IRAssetManifest assets,
                                           NativeImportBindingContext* binding_context)
    : templates_(std::move(templates)), assets_(std::move(assets)), binding_context_(binding_context) {
    if (templates_.empty()) throw std::invalid_argument("imported repeated list needs templates");
    auto list = std::make_unique<VirtualList>();
    list->set_auto_follow(true);
    list->set_overscan(3);
    list->set_row_factory([this](std::size_t) { return std::make_unique<RowHost>(*this); });
    list->set_row_binder([this](View& row, std::size_t index) {
        static_cast<RowHost&>(row).bind(items_.at(index));
    });
    list_ = list.get();
    add_child(std::move(list));
}

float ImportedRepeatedList::source_height(const ImportedListItem& item, float width) {
    const auto found = templates_.find(item.template_id);
    if (found == templates_.end()) throw std::invalid_argument("unknown imported row template");
    if (width <= 0.0f) throw std::logic_error("imported row measurement requires a positive width");
    std::vector<std::pair<std::string, std::string>> sorted_values(item.values.begin(), item.values.end());
    std::ranges::sort(sorted_values);
    std::string cache_key = item.key + "\n" + item.template_id + "\n" + std::to_string(width);
    for (const auto& [key, value] : sorted_values) cache_key += "\n" + key + "=" + value;
    if (const auto cached = measurement_cache_.find(cache_key); cached != measurement_cache_.end())
        return cached->second;

    if (const auto* markdown_node = markdown_value_node(found->second)) {
        const auto value_key = markdown_node->attributes.find("pulpValueKey");
        const auto value = value_key == markdown_node->attributes.end()
            ? item.values.end() : item.values.find(value_key->second);
        ImportedMarkdownRow row(value == item.values.end() ? std::string{} : value->second,
                                markdown_skin(found->second, *markdown_node));
        const auto height = row.measured_height(width);
        measurement_cache_[std::move(cache_key)] = height;
        return height;
    }

    auto row_node = found->second;
    apply_values(row_node, item.values);
    // A captured fixed height describes the observed sample, not future bound
    // content. Dynamic rows retain source width/style but size their block axis
    // from the materialized, shaped descendants.
    if (!contains_action(row_node)) {
        row_node.style.height.reset();
        row_node.layout.height_mode = SizingMode::hug;
    }
    const auto authored_height = row_node.style.height.value_or(0.0f);
    DesignIR row_ir;
    row_ir.root = std::move(row_node);
    row_ir.asset_manifest = assets_;
    auto row = build_native_view_tree(row_ir, assets_);
    if (!row) throw std::runtime_error("imported row template did not materialize for measurement");
    row->set_bounds({0, 0, width, 1.0f});
    row->layout_children();
    auto measured = shaped_content_height(*row, width);
    if (measured <= 0.0f && authored_height > 0.0f) measured = authored_height;
    if (measured <= 0.0f)
        throw std::runtime_error("imported dynamic row has no measurable intrinsic height");
    const auto height = measured;
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
        row_heights_[i] = source_height(items_[i], width);
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

void ImportedRepeatedList::set_auto_follow(bool enabled) { list_->set_auto_follow(enabled); }
bool ImportedRepeatedList::auto_follow() const { return list_->auto_follow(); }
bool ImportedRepeatedList::is_following_tail() const { return list_->is_following_tail(); }
void ImportedRepeatedList::set_scroll_y(float y) { list_->set_scroll_y(y); }
float ImportedRepeatedList::scroll_y() const { return list_->scroll_y(); }
float ImportedRepeatedList::content_height() const { return list_->content_height(); }

void ImportedRepeatedList::layout_children() {
    if (bounds().width > 0.0f && std::abs(bounds().width - measured_width_) > 0.01f)
        measure_rows(bounds().width);
    list_->set_bounds(local_bounds());
    list_->layout_children();
}

} // namespace pulp::view
