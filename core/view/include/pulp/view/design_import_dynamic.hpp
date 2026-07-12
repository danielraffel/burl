#pragma once

#include <pulp/view/design_import.hpp>
#include <pulp/view/virtual_list.hpp>

#include <string>
#include <unordered_map>
#include <vector>

namespace pulp::view {

struct ImportedListItem {
    std::string key;
    std::string template_id;
    std::unordered_map<std::string, std::string> values;
};

/// Keyed, virtualized list whose row visuals are materialized from imported IR
/// templates. Consumers provide data only; source styling remains in DesignIR.
class ImportedRepeatedList final : public View {
public:
    ImportedRepeatedList(std::unordered_map<std::string, IRNode> templates,
                         IRAssetManifest assets);

    void set_items(std::vector<ImportedListItem> items);
    void set_auto_follow(bool enabled);
    bool auto_follow() const;
    bool is_following_tail() const;
    void set_scroll_y(float y);
    float scroll_y() const;
    float content_height() const;
    void layout_children() override;

    [[nodiscard]] const std::vector<ImportedListItem>& items() const { return items_; }
    [[nodiscard]] std::size_t materialization_count() const { return materialization_count_; }

private:
    class RowHost;
    float source_height(const ImportedListItem& item);

    std::unordered_map<std::string, IRNode> templates_;
    IRAssetManifest assets_;
    std::vector<ImportedListItem> items_;
    VirtualList* list_ = nullptr;
    std::size_t materialization_count_ = 0;
    std::unordered_map<std::string, float> measurement_cache_;
};

} // namespace pulp::view
