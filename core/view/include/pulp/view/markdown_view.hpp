#pragma once

#include <pulp/canvas/attributed_string.hpp>
#include <pulp/view/accessibility.hpp>
#include <pulp/view/view.hpp>

#include <cstddef>
#include <functional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace pulp::view {

enum class MarkdownBlockKind { paragraph, heading, unordered_list_item, ordered_list_item, code };

struct MarkdownLink {
    std::size_t text_start = 0;
    std::size_t text_end = 0;
    std::string destination;
};

struct MarkdownBlock {
    MarkdownBlockKind kind = MarkdownBlockKind::paragraph;
    int level = 0;
    std::string plain_text;
    canvas::AttributedString attributed_text;
    std::vector<MarkdownLink> links;
};

class MarkdownDocument {
public:
    static MarkdownDocument parse(std::string_view markdown);

    const std::vector<MarkdownBlock>& blocks() const { return blocks_; }
    const std::string& plain_text() const { return plain_text_; }

private:
    std::vector<MarkdownBlock> blocks_;
    std::string plain_text_;
};

/// Native rich-text surface for message transcripts and documentation panes.
class MarkdownView : public View, public AccessibilityTextInterface {
public:
    MarkdownView();
    explicit MarkdownView(std::string markdown);

    void set_markdown(std::string markdown);
    const std::string& markdown() const { return markdown_; }
    const MarkdownDocument& document() const { return document_; }

    void layout_children() override;
    bool on_key_event(const KeyEvent& event) override;
    float content_height() const { return content_height_; }

    std::string get_text() const override;
    void set_text(std::string_view text) override;
    std::pair<int, int> get_selection() const override;
    void set_selection(int start, int end) override;
    bool copy_selection() const;

    bool activate_link(std::size_t block_index, std::size_t link_index);
    std::function<void(const std::string&)> on_link;

private:
    void rebuild_children();

    std::string markdown_;
    MarkdownDocument document_;
    int selection_start_ = 0;
    int selection_end_ = 0;
    float content_height_ = 0.0f;
};

}  // namespace pulp::view
