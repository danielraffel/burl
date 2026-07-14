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

std::unordered_map<std::string, IRNode> extract_imported_collection_templates(
    const IRNode& root);

struct ImportedMarkdownSkin {
    canvas::Color background = canvas::Color::rgba(0, 0, 0, 0);
    canvas::Color foreground = canvas::Color::rgba(1, 1, 1, 1);
    canvas::Color border = canvas::Color::rgba(0, 0, 0, 0);
    canvas::Color inline_code_background = canvas::Color::rgba(0.16f, 0.16f, 0.16f, 1.0f);
    canvas::Color inline_code_foreground = canvas::Color::rgba(0.95f, 0.95f, 0.95f, 1.0f);
    canvas::Color inline_code_border = canvas::Color::rgba(0.28f, 0.28f, 0.28f, 1.0f);
    std::string font_family = "system";
    float font_size = 14.0f;
    int font_weight = 400;
    MarkdownRoleStyle strong_style;
    MarkdownRoleStyle inline_code_style;
    float border_width = 0.0f;
    float border_radius = 0.0f;
    float inline_code_border_width = 0.0f;
    float inline_code_radius = 3.0f;
    float inline_code_padding_x = 3.0f;
    float inline_code_padding_y = 1.0f;
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
    VisualSkin markdown_skin_;
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
    bool scroll_to_item(std::string_view key);
    float scroll_y() const;
    float content_height() const;
    void refresh_state_dependent_row(View& descendant);
    void layout_children() override;
    bool owns_child_layout() const override { return true; }

    [[nodiscard]] const std::vector<ImportedListItem>& items() const { return items_; }
    [[nodiscard]] std::size_t materialization_count() const { return materialization_count_; }

private:
    class RowHost;
    float source_height(const ImportedListItem& item, float width);
    void measure_rows(float width);
    float clipped_viewport_height() const;
    std::pair<float, float> responsive_viewport() const;

    std::unordered_map<std::string, IRNode> templates_;
    IRAssetManifest assets_;
    std::vector<ImportedListItem> items_;
    std::vector<float> row_heights_;
    VirtualList* list_ = nullptr;
    std::size_t materialization_count_ = 0;
    NativeImportBindingContext* binding_context_ = nullptr;
    std::unordered_map<std::string, float> measurement_cache_;
    float measured_width_ = -1.0f;
};

} // namespace pulp::view
