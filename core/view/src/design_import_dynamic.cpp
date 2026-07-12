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
    for (auto& child : node.children) apply_values(child, values);
}

const IRNode* markdown_value_node(const IRNode& node) {
    if (const auto kind = node.attributes.find("pulpValueKind");
        kind != node.attributes.end() && kind->second == "markdown") return &node;
    for (const auto& child : node.children)
        if (const auto* found = markdown_value_node(child)) return found;
    return nullptr;
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
        const auto child_width = child->bounds().width > 0.0f ? child->bounds().width : available_width;
        bottom = std::max(bottom, child->bounds().y + shaped_content_height(*child, child_width));
    }
    return bottom;
}

} // namespace

ImportedMarkdownRow::ImportedMarkdownRow(std::string markdown, ImportedMarkdownSkin skin)
    : skin_(std::move(skin)) {
    set_background_color(skin_.background);
    if (skin_.border_width > 0.0f)
        set_border(skin_.border, skin_.border_width, skin_.border_radius);
    else if (skin_.border_radius > 0.0f)
        set_border_radius(skin_.border_radius);
    auto view = std::make_unique<MarkdownView>(std::move(markdown));
    view->set_body_style(skin_.font_family, skin_.font_size, skin_.font_weight, skin_.foreground);
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

float ImportedRepeatedList::source_height(const ImportedListItem& item) {
    const auto found = templates_.find(item.template_id);
    if (found == templates_.end()) throw std::invalid_argument("unknown imported row template");
    const auto width = std::max(1.0f, bounds().width);
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
    row_node.style.height.reset();
    row_node.layout.height_mode = SizingMode::hug;
    DesignIR row_ir;
    row_ir.root = std::move(row_node);
    row_ir.asset_manifest = assets_;
    auto row = build_native_view_tree(row_ir, assets_);
    if (!row) throw std::runtime_error("imported row template did not materialize for measurement");
    row->set_bounds({0, 0, width, 1.0f});
    row->layout_children();
    const auto measured = shaped_content_height(*row, width);
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
    row_heights_.resize(items_.size());
    for (std::size_t i = 0; i < items_.size(); ++i) {
        row_heights_[i] = source_height(items_[i]);
        list_->set_row_height(i, row_heights_[i]);
    }
    list_->refresh_rows();
	for (std::size_t slot = 0; slot < list_->realized_row_count(); ++slot) {
		const auto index = list_->bound_index_for_slot(slot);
		if (!index || *index >= items_.size()) continue;
		const auto* row = list_->realized_row_at_slot(slot);
		if (!row || row->child_count() == 0) continue;
		auto measured = row->child_at(0)->intrinsic_height();
		if (measured <= 0.0f) measured = row->child_at(0)->bounds().height;
		if (measured > 0.0f) {
			row_heights_[*index] = measured;
			list_->set_row_height(*index, measured);
		}
	}
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
    list_->set_bounds(local_bounds());
    list_->layout_children();
}

} // namespace pulp::view
