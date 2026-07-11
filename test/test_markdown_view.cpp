#include <catch2/catch_test_macros.hpp>

#include <pulp/canvas/canvas.hpp>
#include <pulp/platform/clipboard.hpp>
#include <pulp/view/markdown_view.hpp>

#include <chrono>

using namespace pulp::view;

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
