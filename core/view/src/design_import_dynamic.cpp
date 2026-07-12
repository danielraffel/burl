#include <pulp/view/design_import_dynamic.hpp>

#include <algorithm>
#include <cmath>
#include <stdexcept>

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

} // namespace

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
        auto row = build_native_view_tree(row_ir, owner_.assets_);
        if (!row) throw std::runtime_error("imported row template did not materialize");
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
                                           IRAssetManifest assets)
    : templates_(std::move(templates)), assets_(std::move(assets)) {
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

float ImportedRepeatedList::estimate_height(const ImportedListItem& item) const {
    std::size_t characters = 0;
    for (const auto& [_, value] : item.values) characters += value.size();
    return std::clamp(52.0f + std::ceil(static_cast<float>(characters) / 72.0f) * 22.0f,
                      68.0f, 640.0f);
}

void ImportedRepeatedList::set_items(std::vector<ImportedListItem> items) {
    items_ = std::move(items);
    list_->set_row_count(items_.size());
    for (std::size_t i = 0; i < items_.size(); ++i) list_->set_row_height(i, estimate_height(items_[i]));
    list_->refresh_rows();
}

void ImportedRepeatedList::set_auto_follow(bool enabled) { list_->set_auto_follow(enabled); }
bool ImportedRepeatedList::auto_follow() const { return list_->auto_follow(); }
bool ImportedRepeatedList::is_following_tail() const { return list_->is_following_tail(); }
void ImportedRepeatedList::set_scroll_y(float y) { list_->set_scroll_y(y); }
float ImportedRepeatedList::scroll_y() const { return list_->scroll_y(); }

void ImportedRepeatedList::layout_children() {
    list_->set_bounds(local_bounds());
    list_->layout_children();
}

} // namespace pulp::view
