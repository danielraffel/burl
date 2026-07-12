#include <catch2/catch_test_macros.hpp>
#include <pulp/view/design_import_dynamic.hpp>

using namespace pulp::view;

TEST_CASE("imported repeated list updates keyed rows incrementally") {
    IRNode row;
    row.type = "frame";
    row.layout.width_mode = SizingMode::fill;
    row.layout.height_mode = SizingMode::fill;
    IRNode text;
    text.type = "text";
    text.text_content = "source placeholder";
    text.style.font_size = 16.0f;
    text.style.line_height = 22.0f;
    text.style.white_space = "normal";
    text.layout.width_mode = SizingMode::fill;
    text.layout.height_mode = SizingMode::hug;
    text.attributes["pulpValueKey"] = "message.text";
    row.children.push_back(text);

    ImportedRepeatedList list({{"assistant", row}}, {});
    list.set_bounds({0, 0, 600, 300});
    list.layout_children();
    list.set_items({{"m1", "assistant", {{"message.text", "hello"}}}});
    const auto first = list.materialization_count();
    REQUIRE(first == 1);

    list.set_items({{"m1", "assistant", {{"message.text", "hello"}}}});
    REQUIRE(list.materialization_count() == first);

    list.set_items({{"m1", "assistant", {{"message.text", "hello world"}}},
                    {"m2", "assistant", {{"message.text", "tool result"}}}});
    REQUIRE(list.materialization_count() > first);
    REQUIRE(list.items().size() == 2);
    REQUIRE(list.auto_follow());
    REQUIRE(list.content_height() < 100000.0f);
}

TEST_CASE("imported repeated list measures wrapped Markdown-shaped text at current width") {
    IRNode row;
    row.type = "frame";
    row.style.height = 68.0f; // observed sample height must not cap dynamic content
    row.layout.width_mode = SizingMode::fill;
    IRNode text;
    text.type = "text";
    text.text_content = "placeholder";
    text.style.font_size = 15.0f;
    text.style.line_height = 22.0f;
    text.style.white_space = "normal";
    text.layout.width_mode = SizingMode::fill;
    text.layout.height_mode = SizingMode::hug;
    text.attributes["pulpValueKey"] = "message.markdown";
    row.children.push_back(text);

    ImportedRepeatedList list({{"assistant", row}}, {});
    list.set_bounds({0, 0, 260, 160});
    list.layout_children();
    list.set_items({{"m1", "assistant", {{"message.markdown", "short"}}}});
    const auto short_height = list.content_height();
    list.set_items({{"m1", "assistant", {{"message.markdown",
        "**Created `src/lib/theme.ts`**\n\n- resolves the theme\n- persists the theme\n- follows the system preference"}}}});
    const auto long_height = list.content_height();
    REQUIRE(short_height > 0.0f);
    REQUIRE(long_height > short_height);
    REQUIRE(long_height < 100000.0f);

    list.set_bounds({0, 0, 620, 160});
    list.layout_children();
    list.set_items({{"m1", "assistant", {{"message.markdown",
        "**Created `src/lib/theme.ts`**\n\n- resolves the theme\n- persists the theme\n- follows the system preference"}}}});
    REQUIRE(list.content_height() <= long_height);
}

TEST_CASE("imported repeated list preserves a keyed scroll anchor across updates") {
    IRNode row;
    row.type = "frame";
    IRNode text;
    text.type = "text";
    text.style.font_size = 15.0f;
    text.style.line_height = 22.0f;
    text.style.white_space = "normal";
    text.layout.width_mode = SizingMode::fill;
    text.layout.height_mode = SizingMode::hug;
    text.attributes["pulpValueKey"] = "message.text";
    row.children.push_back(text);
    ImportedRepeatedList list({{"message", row}}, {});
    list.set_bounds({0, 0, 300, 44});
    list.layout_children();
    list.set_items({{"a", "message", {{"message.text", "a\na\na"}}},
                    {"b", "message", {{"message.text", "b\nb\nb"}}},
                    {"c", "message", {{"message.text", "c\nc\nc"}}}});
    list.set_auto_follow(false);
    list.set_scroll_y(75.0f);
    list.set_items({{"a", "message", {{"message.text", "a\na\na\na\na"}}},
                    {"b", "message", {{"message.text", "b changed\nb\nb"}}},
                    {"c", "message", {{"message.text", "c\nc\nc"}}}});
    REQUIRE(list.scroll_y() > 75.0f);
    REQUIRE(list.scroll_y() < list.content_height());
}
