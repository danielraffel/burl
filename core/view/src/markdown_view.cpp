#include <pulp/view/markdown_view.hpp>

#include <pulp/platform/clipboard.hpp>

#include <algorithm>
#include <cctype>
#include <memory>

namespace pulp::view {
namespace {

class RichBlockView final : public View {
public:
    RichBlockView(canvas::AttributedString text, bool code)
        : text_(std::move(text)), code_(code) {
        set_access_role(AccessRole::label);
        set_access_label((code_ ? "Code: " : "") + text_.plain_text());
    }

    float measured_height(float width) const {
        if (width <= 0.0f) return 0.0f;
        float lines = 1.0f;
        float used = 0.0f;
        float tallest = 21.0f;
        for (const auto& span : text_.spans()) {
            const float size = span.font_size;
            tallest = std::max(tallest, size * 1.5f);
            for (const char c : span.text) {
                if (c == '\n') {
                    ++lines;
                    used = 0.0f;
                } else {
                    used += size * 0.6f;
                    if (used > width) {
                        ++lines;
                        used = size * 0.6f;
                    }
                }
            }
        }
        return lines * tallest;
    }

    void paint(canvas::Canvas& canvas) override {
        canvas.set_text_align(canvas::TextAlign::left);
        float x = 0.0f;
        float baseline = 0.0f;
        float line_height = 21.0f;
        for (const auto& span : text_.spans()) {
            const auto family = span.font_family.empty() ? std::string("Inter") : span.font_family;
            canvas.set_font_full(family, span.font_size, span.font_weight,
                                 span.italic ? 1 : 0, span.letter_spacing);
            canvas.set_fill_color(span.color);
            line_height = std::max(line_height, span.font_size * 1.5f);
            if (baseline == 0.0f) baseline = span.font_size;
            std::size_t position = 0;
            while (position < span.text.size()) {
                const auto separator = span.text.find_first_of(" \n\t", position);
                const auto word_end = separator == std::string::npos ? span.text.size() : separator;
                const auto word = span.text.substr(position, word_end - position);
                const float word_width = canvas.measure_text(word);
                if (x > 0.0f && x + word_width > bounds().width) {
                    x = 0.0f;
                    baseline += line_height;
                }
                if (!word.empty()) {
                    canvas.fill_text(word, x, baseline);
                    x += word_width;
                }
                if (separator == std::string::npos) break;
                const char delimiter = span.text[separator];
                if (delimiter == '\n') {
                    x = 0.0f;
                    baseline += line_height;
                } else {
                    const float space = canvas.measure_text(" ");
                    if (x + space > bounds().width) {
                        x = 0.0f;
                        baseline += line_height;
                    } else {
                        x += space;
                    }
                }
                position = separator + 1;
            }
        }
    }

private:
    canvas::AttributedString text_;
    bool code_ = false;
};

struct InlineResult {
    std::string plain;
    canvas::AttributedString attributed;
    std::vector<MarkdownLink> links;
};

void append_span(InlineResult& out, std::string text, int weight = 400,
                 bool italic = false, bool code = false, bool link = false) {
    canvas::TextSpan span;
    span.text = text;
    span.font_weight = weight;
    span.italic = italic;
    if (code) span.font_family = "monospace";
    if (link) {
        span.color = canvas::Color::rgba(90, 170, 255);
        span.decoration = canvas::TextDecoration::underline;
    }
    out.plain += text;
    out.attributed.append(std::move(span));
}

InlineResult parse_inline(std::string_view input) {
    InlineResult out;
    std::size_t i = 0;
    while (i < input.size()) {
        if (input[i] == '`') {
            const auto end = input.find('`', i + 1);
            if (end != std::string_view::npos) {
                append_span(out, std::string(input.substr(i + 1, end - i - 1)), 400, false, true);
                i = end + 1;
                continue;
            }
        }
        if (input[i] == '[') {
            const auto close = input.find(']', i + 1);
            if (close != std::string_view::npos && close + 1 < input.size() && input[close + 1] == '(') {
                const auto end = input.find(')', close + 2);
                if (end != std::string_view::npos) {
                    MarkdownLink link;
                    link.text_start = out.plain.size();
                    const auto label = std::string(input.substr(i + 1, close - i - 1));
                    append_span(out, label, 400, false, false, true);
                    link.text_end = out.plain.size();
                    link.destination = std::string(input.substr(close + 2, end - close - 2));
                    out.links.push_back(std::move(link));
                    i = end + 1;
                    continue;
                }
            }
        }
        bool strong = false;
        std::size_t marker = 0;
        if (input.substr(i, 2) == "**" || input.substr(i, 2) == "__") {
            strong = true;
            marker = 2;
        } else if (input[i] == '*' || input[i] == '_') {
            marker = 1;
        }
        if (marker != 0) {
            const auto token = input.substr(i, marker);
            const auto end = input.find(token, i + marker);
            if (end != std::string_view::npos) {
                append_span(out, std::string(input.substr(i + marker, end - i - marker)),
                            strong ? 700 : 400, !strong);
                i = end + marker;
                continue;
            }
        }
        const auto next = input.find_first_of("`[*_", i + 1);
        const auto end = next == std::string_view::npos ? input.size() : next;
        append_span(out, std::string(input.substr(i, end - i)));
        i = end;
    }
    return out;
}

bool ordered_prefix(std::string_view line, std::size_t& content_start) {
    std::size_t i = 0;
    while (i < line.size() && std::isdigit(static_cast<unsigned char>(line[i]))) ++i;
    if (i == 0 || i + 1 >= line.size() || line[i] != '.' || line[i + 1] != ' ') return false;
    content_start = i + 2;
    return true;
}

}  // namespace

MarkdownDocument MarkdownDocument::parse(std::string_view markdown) {
    MarkdownDocument result;
    bool fenced = false;
    std::string code;
    std::size_t position = 0;
    while (position <= markdown.size()) {
        const auto newline = markdown.find('\n', position);
        const auto end = newline == std::string_view::npos ? markdown.size() : newline;
        auto line = markdown.substr(position, end - position);
        if (line.substr(0, 3) == "```") {
            if (fenced) {
                MarkdownBlock block;
                block.kind = MarkdownBlockKind::code;
                block.plain_text = code;
                canvas::TextSpan span;
                span.text = code;
                span.font_family = "monospace";
                block.attributed_text.append(std::move(span));
                result.blocks_.push_back(std::move(block));
                code.clear();
            }
            fenced = !fenced;
        } else if (fenced) {
            if (!code.empty()) code += '\n';
            code.append(line);
        } else if (!line.empty()) {
            MarkdownBlock block;
            std::string prefix;
            std::size_t content_start = 0;
            while (content_start < line.size() && content_start < 6 && line[content_start] == '#') ++content_start;
            if (content_start > 0 && content_start < line.size() && line[content_start] == ' ') {
                block.kind = MarkdownBlockKind::heading;
                block.level = static_cast<int>(content_start);
                ++content_start;
            } else if (line.substr(0, 2) == "- " || line.substr(0, 2) == "* ") {
                block.kind = MarkdownBlockKind::unordered_list_item;
                content_start = 2;
                prefix = "• ";
            } else if (ordered_prefix(line, content_start)) {
                block.kind = MarkdownBlockKind::ordered_list_item;
                prefix = std::string(line.substr(0, content_start));
            } else {
                block.kind = MarkdownBlockKind::paragraph;
            }
            auto inline_result = parse_inline(line.substr(content_start));
            block.plain_text = prefix + inline_result.plain;
            if (!prefix.empty()) block.attributed_text.append(prefix);
            for (const auto& span : inline_result.attributed.spans()) block.attributed_text.append(span);
            block.links = std::move(inline_result.links);
            for (auto& link : block.links) {
                link.text_start += prefix.size();
                link.text_end += prefix.size();
            }
            result.blocks_.push_back(std::move(block));
        }
        if (newline == std::string_view::npos) break;
        position = newline + 1;
    }
    if (fenced && !code.empty()) {
        MarkdownBlock block;
        block.kind = MarkdownBlockKind::code;
        block.plain_text = code;
        canvas::TextSpan span;
        span.text = code;
        span.font_family = "monospace";
        block.attributed_text.append(std::move(span));
        result.blocks_.push_back(std::move(block));
    }
    for (std::size_t i = 0; i < result.blocks_.size(); ++i) {
        if (i != 0) result.plain_text_ += '\n';
        result.plain_text_ += result.blocks_[i].plain_text;
    }
    return result;
}

MarkdownView::MarkdownView() {
    set_access_role(AccessRole::group);
    set_access_label("Markdown document");
    set_focusable(true);
}

MarkdownView::MarkdownView(std::string markdown) : MarkdownView() {
    set_markdown(std::move(markdown));
}

void MarkdownView::set_markdown(std::string markdown) {
    markdown_ = std::move(markdown);
    document_ = MarkdownDocument::parse(markdown_);
    selection_start_ = selection_end_ = 0;
    set_access_value(document_.plain_text());
    rebuild_children();
    invalidate_layout();
}

void MarkdownView::set_body_style(std::string font_family, float font_size,
                                  int font_weight, canvas::Color color) {
    body_font_family_ = std::move(font_family);
    body_font_size_ = std::max(1.0f, font_size);
    body_font_weight_ = std::clamp(font_weight, 100, 900);
    body_color_ = color;
    rebuild_children();
    invalidate_layout();
}

void MarkdownView::rebuild_children() {
    while (child_count() != 0) remove_child(child_at(child_count() - 1));
    for (const auto& block : document_.blocks()) {
        auto attributed = block.attributed_text;
        if (block.kind != MarkdownBlockKind::heading) {
            canvas::AttributedString styled;
            for (auto span : attributed.spans()) {
                span.font_size = body_font_size_;
                span.color = body_color_;
                if (span.font_weight == 400) span.font_weight = body_font_weight_;
                if (span.font_family == "system") span.font_family = body_font_family_;
                styled.append(std::move(span));
            }
            attributed = std::move(styled);
        }
        if (block.kind == MarkdownBlockKind::heading) {
            canvas::AttributedString styled;
            for (auto span : attributed.spans()) {
                span.font_size = std::max(18.0f, 30.0f - 2.0f * static_cast<float>(block.level));
                span.font_weight = 700;
                styled.append(std::move(span));
            }
            attributed = std::move(styled);
        } else if (block.kind == MarkdownBlockKind::code) {
            canvas::AttributedString styled;
            for (auto span : attributed.spans()) {
                span.font_family = "monospace";
                styled.append(std::move(span));
            }
            attributed = std::move(styled);
        }
        add_child(std::make_unique<RichBlockView>(std::move(attributed),
                                                  block.kind == MarkdownBlockKind::code));
    }
}

void MarkdownView::layout_children() {
    float y = 0.0f;
    constexpr float gap = 8.0f;
    for (std::size_t i = 0; i < child_count(); ++i) {
        auto* block = static_cast<RichBlockView*>(child_at(i));
        const float height = block->measured_height(bounds().width);
        block->set_bounds({0.0f, y, bounds().width, height});
        y += height + (i + 1 < child_count() ? gap : 0.0f);
    }
    content_height_ = y;
}

bool MarkdownView::on_key_event(const KeyEvent& event) {
    if (!event.is_down || !event.isMainModifier()) return false;
    if (event.key == KeyCode::a) {
        set_selection(0, static_cast<int>(document_.plain_text().size()));
        return true;
    }
    if (event.key == KeyCode::c) return copy_selection();
    return false;
}

std::string MarkdownView::get_text() const { return document_.plain_text(); }

void MarkdownView::set_text(std::string_view text) { set_markdown(std::string(text)); }

std::pair<int, int> MarkdownView::get_selection() const { return {selection_start_, selection_end_}; }

void MarkdownView::set_selection(int start, int end) {
    const int size = static_cast<int>(document_.plain_text().size());
    selection_start_ = std::clamp(start, 0, size);
    selection_end_ = std::clamp(end, 0, size);
    if (selection_start_ > selection_end_) std::swap(selection_start_, selection_end_);
}

bool MarkdownView::copy_selection() const {
    if (selection_start_ == selection_end_) return false;
    return platform::Clipboard::set_text(document_.plain_text().substr(
        static_cast<std::size_t>(selection_start_),
        static_cast<std::size_t>(selection_end_ - selection_start_)));
}

bool MarkdownView::activate_link(std::size_t block_index, std::size_t link_index) {
    if (block_index >= document_.blocks().size()) return false;
    const auto& links = document_.blocks()[block_index].links;
    if (link_index >= links.size()) return false;
    if (on_link) on_link(links[link_index].destination);
    return true;
}

}  // namespace pulp::view
