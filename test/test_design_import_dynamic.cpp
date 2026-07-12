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
}
