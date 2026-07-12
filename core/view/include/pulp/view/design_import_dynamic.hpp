#pragma once

#include <pulp/view/design_import.hpp>
#include <pulp/view/virtual_list.hpp>
#include <pulp/view/markdown_view.hpp>

#include <string>
#include <cstdint>
#include <unordered_map>
#include <vector>

namespace pulp::view {

struct ImportedListItem {
    std::string key;
    std::string template_id;
    std::unordered_map<std::string, std::string> values;
};

struct ImportedMarkdownSkin {
    canvas::Color background = canvas::Color::rgba(0, 0, 0, 0);
    canvas::Color foreground = canvas::Color::rgba(1, 1, 1, 1);
    canvas::Color border = canvas::Color::rgba(0, 0, 0, 0);
    std::string font_family = "system";
    float font_size = 14.0f;
    int font_weight = 400;
    float border_width = 0.0f;
    float border_radius = 0.0f;
    float padding_top = 0.0f, padding_right = 0.0f;
    float padding_bottom = 0.0f, padding_left = 0.0f;
};

class FrameUpdateCoalescer {
public:
    bool request() {
        ++request_count_;
        if (pending_) return false;
        pending_ = true;
        return true;
    }
    bool flush() {
        if (!pending_) return false;
        pending_ = false;
        ++flush_count_;
        return true;
    }
    bool pending() const { return pending_; }
    std::uint64_t request_count() const { return request_count_; }
    std::uint64_t flush_count() const { return flush_count_; }
private:
    bool pending_ = false;
    std::uint64_t request_count_ = 0;
    std::uint64_t flush_count_ = 0;
};

class ImportedMarkdownRow final : public View {
public:
    ImportedMarkdownRow(std::string markdown, ImportedMarkdownSkin skin);
    void set_markdown(std::string markdown);
    float measured_height(float width);
    MarkdownView& markdown_view() { return *markdown_; }
    const MarkdownView& markdown_view() const { return *markdown_; }
    void layout_children() override;
    bool owns_child_layout() const override { return true; }
    float intrinsic_height() const override { return measured_height_; }

private:
    ImportedMarkdownSkin skin_;
    MarkdownView* markdown_ = nullptr;
    float measured_height_ = 0.0f;
};

/// Keyed, virtualized list whose row visuals are materialized from imported IR
/// templates. Consumers provide data only; source styling remains in DesignIR.
class ImportedRepeatedList final : public View {
public:
    ImportedRepeatedList(std::unordered_map<std::string, IRNode> templates,
                         IRAssetManifest assets,
                         NativeImportBindingContext* binding_context = nullptr);

    void set_items(std::vector<ImportedListItem> items);
    void set_auto_follow(bool enabled);
    bool auto_follow() const;
    bool is_following_tail() const;
    void set_scroll_y(float y);
    float scroll_y() const;
    float content_height() const;
    void layout_children() override;
    bool owns_child_layout() const override { return true; }

    [[nodiscard]] const std::vector<ImportedListItem>& items() const { return items_; }
    [[nodiscard]] std::size_t materialization_count() const { return materialization_count_; }

private:
    class RowHost;
    float source_height(const ImportedListItem& item);

    std::unordered_map<std::string, IRNode> templates_;
    IRAssetManifest assets_;
    std::vector<ImportedListItem> items_;
    std::vector<float> row_heights_;
    VirtualList* list_ = nullptr;
    std::size_t materialization_count_ = 0;
    NativeImportBindingContext* binding_context_ = nullptr;
    std::unordered_map<std::string, float> measurement_cache_;
};

} // namespace pulp::view
