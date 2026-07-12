#include <catch2/catch_test_macros.hpp>

#include <pulp/canvas/canvas.hpp>
#include <pulp/platform/clipboard.hpp>
#include <pulp/view/markdown_view.hpp>
#include <pulp/view/screenshot.hpp>

#include <chrono>
#include <algorithm>
#include <vector>

using namespace pulp::view;
namespace canvas = pulp::canvas;

TEST_CASE("MarkdownDocument parses rich transcript blocks", "[markdown][parser]") {
    const auto document = MarkdownDocument::parse(
        "# Heading\nA **bold** and *italic* [link](https://example.com) with `code`.\n"
        "- first\n1. second\n```cpp\nint value = 3;\n```");

    REQUIRE(document.blocks().size() == 5);
    REQUIRE(document.blocks()[0].kind == MarkdownBlockKind::heading);
    REQUIRE(document.blocks()[1].attributed_text.spans().size() >= 7);
    REQUIRE(document.blocks()[1].links.size() == 1);
    REQUIRE(document.blocks()[1].links[0].destination == "https://example.com");
    REQUIRE(document.blocks()[2].plain_text == "• first");
    REQUIRE(document.blocks()[3].kind == MarkdownBlockKind::ordered_list_item);
    REQUIRE(document.blocks()[4].kind == MarkdownBlockKind::code);
    REQUIRE(document.blocks()[4].plain_text == "int value = 3;");
}

TEST_CASE("MarkdownView lays out native labels and exposes accessible selection",
          "[markdown][layout][a11y][clipboard]") {
    MarkdownView view("## Result\nHello **native** world");
    view.set_bounds({0, 0, 320, 500});
    view.layout_children();

    REQUIRE(view.child_count() == 2);
    REQUIRE(view.content_height() > 0.0f);
    REQUIRE(view.get_text() == "Result\nHello native world");
    REQUIRE(view.access_value() == view.get_text());

    pulp::canvas::RecordingCanvas canvas;
    view.paint_all(canvas);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::fill_text) >= 4);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::set_font_full) >= 4);

    view.set_selection(7, 19);
    REQUIRE(view.get_selection() == std::pair{7, 19});
    REQUIRE(view.get_text_range(7, 19) == "Hello native");
    if (view.copy_selection()) {
        REQUIRE(pulp::platform::Clipboard::get_text() == "Hello native");
    }

    KeyEvent select_all{};
    select_all.key = KeyCode::a;
    select_all.modifiers = kModCmd | kModCtrl;
    select_all.is_down = true;
    REQUIRE(view.on_key_event(select_all));
    REQUIRE(view.get_selection() == std::pair{0, static_cast<int>(view.get_text().size())});
}

TEST_CASE("MarkdownView activates parsed links through the consumer callback", "[markdown][links]") {
    MarkdownView view("Read [the guide](https://example.com/guide).");
    std::string opened;
    view.on_link = [&](const std::string& destination) { opened = destination; };

    REQUIRE(view.activate_link(0, 0));
    REQUIRE(opened == "https://example.com/guide");
    REQUIRE_FALSE(view.activate_link(0, 1));
}

TEST_CASE("MarkdownView body style controls neutral transcript typography",
          "[markdown][style]") {
    MarkdownView view("A long paragraph that wraps across several lines in a narrow transcript.");
    view.set_bounds({0, 0, 150, 500});
    view.layout_children();
    const auto default_height = view.content_height();

    view.set_body_style("Inter", 11.0f, 300, pulp::canvas::Color::rgba8(237, 237, 237));
    view.layout_children();
    REQUIRE(view.content_height() < default_height);

    pulp::canvas::RecordingCanvas canvas;
    view.paint_all(canvas);
    REQUIRE(canvas.count(pulp::canvas::DrawCommand::Type::set_font_full) > 0);
}

TEST_CASE("Markdown inline code keeps native semantic style, baseline, and poison-theme paint",
          "[markdown][inline-code][visual-skin]") {
    MarkdownView view("Set `gain_db` before rendering the next native frame.");
    view.set_bounds({0, 0, 150, 160});
    Theme poison_theme;
    poison_theme.colors["text.primary"] = canvas::Color::rgba8(255, 0, 255);
    poison_theme.colors["bg.surface"] = canvas::Color::rgba8(255, 0, 255);
    view.set_theme(poison_theme);
    view.set_body_style("Inter", 14.0f, 400, canvas::Color::rgba8(210, 215, 220));

    VisualSkin skin;
    auto& rest = skin.states[WidgetState::rest];
    rest.inline_code_background = SkinColor{24, 30, 38, 255};
    rest.inline_code_foreground = SkinColor{226, 232, 240, 255};
    rest.inline_code_border = SkinColor{70, 82, 96, 255};
    rest.border_width = 1.0f;
    rest.corner_radius = 3.0f;
    rest.inset_horizontal = 3.0f;
    rest.inset_vertical = 1.0f;
    view.set_visual_skin(skin);
    view.layout_children();

    REQUIRE(view.document().blocks().size() == 1);
    const auto& block = view.document().blocks().front();
    REQUIRE(block.plain_text == "Set gain_db before rendering the next native frame.");
    REQUIRE(block.attributed_text.spans().size() >= 3);
    bool found_inline_code = false;
    for (const auto& span : block.attributed_text.spans()) {
        if (span.text != "gain_db") continue;
        REQUIRE(span.kind == canvas::TextSpanKind::inline_code);
        REQUIRE(span.font_family == "monospace");
        found_inline_code = true;
    }
    REQUIRE(found_inline_code);
    REQUIRE(view.get_text() == block.plain_text);

    canvas::RecordingCanvas recording;
    view.paint_all(recording);
    bool saw_background = false, saw_foreground = false, saw_border = false;
    std::vector<float> baselines;
    for (const auto& command : recording.commands()) {
        if (command.type == canvas::DrawCommand::Type::set_fill_color &&
            command.color == canvas::Color::rgba8(24, 30, 38)) saw_background = true;
        if (command.type == canvas::DrawCommand::Type::set_fill_color &&
            command.color == canvas::Color::rgba8(226, 232, 240)) saw_foreground = true;
        if (command.type == canvas::DrawCommand::Type::set_stroke_color &&
            command.color == canvas::Color::rgba8(70, 82, 96)) saw_border = true;
        if (command.type == canvas::DrawCommand::Type::fill_text)
            baselines.push_back(command.f[1]);
    }
    REQUIRE(saw_background);
    REQUIRE(saw_foreground);
    REQUIRE(saw_border);
    REQUIRE(baselines.size() >= 4);
    REQUIRE(*std::max_element(baselines.begin(), baselines.end()) >
            *std::min_element(baselines.begin(), baselines.end()));
    REQUIRE(view.content_height() > 21.0f);

    const auto png = render_to_png(view, 150, 160, 1.0f, ScreenshotBackend::coregraphics);
    REQUIRE_FALSE(png.empty());
}

TEST_CASE("Markdown parser transcript benchmark", "[markdown][benchmark]") {
    std::string fixture;
    for (int i = 0; i < 1000; ++i) {
        fixture += "## Message\nParagraph with **bold**, *emphasis*, `code`, and [link](https://example.com).\n";
    }
    const auto start = std::chrono::steady_clock::now();
    const auto document = MarkdownDocument::parse(fixture);
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now() - start);
    INFO("parsed_blocks=" << document.blocks().size() << " elapsed_ms=" << elapsed.count());
    REQUIRE(document.blocks().size() == 2000);
    REQUIRE(elapsed < std::chrono::seconds(2));
}
