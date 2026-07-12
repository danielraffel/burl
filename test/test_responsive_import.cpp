#include <catch2/catch_test_macros.hpp>

#include <pulp/view/design_import.hpp>
#include <pulp/view/design_ir.hpp>
#include <pulp/view/view.hpp>

using namespace pulp::view;

TEST_CASE("native imported responsive constraints apply on root resize",
          "[view][import][responsive]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;

    IRNode sidebar;
    sidebar.type = "view";
    sidebar.name = "sidebar";
    sidebar.stable_anchor_id = "sidebar";
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = {.kind = "fixed", .value = 240.0f};
    responsive.vertical = {.kind = "fill", .offset = -40.0f};
    IRNode::ResponsiveVisibility collapsed;
    collapsed.visible = false;
    collapsed.structural = true;
    collapsed.transition_to_next = IRNode::ResponsiveBreakpoint{599.0f, 600.0f, "measured"};
    responsive.visibility = {collapsed, {.visible = true, .structural = false}};
    IRNode::ResponsiveConstraints::LayoutVariant narrow;
    narrow.flex_direction = "column";
    narrow.flex_wrap = "wrap";
    narrow.reflowed = true;
    narrow.transition_to_next = IRNode::ResponsiveBreakpoint{599.0f, 600.0f, "measured"};
    IRNode::ResponsiveConstraints::LayoutVariant wide;
    wide.flex_direction = "row";
    wide.flex_wrap = "nowrap";
    responsive.layout_variants = {narrow, wide};
    sidebar.responsive = responsive;
    ir.root.children.push_back(std::move(sidebar));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    REQUIRE(root->child_count() == 1);
    auto* sidebar_view = root->child_at(0);

    bool additional_listener_called = false;
    root->add_resize_listener([&](Rect) { additional_listener_called = true; });
    root->set_bounds({0, 0, 601, 800});
    CHECK(sidebar_view->visible());
    root->set_bounds({0, 0, 599, 800});
    CHECK_FALSE(sidebar_view->visible());
    CHECK(sidebar_view->flex().direction == FlexDirection::column);
    CHECK(sidebar_view->flex().flex_wrap == FlexWrap::wrap);
    root->set_bounds({0, 0, 600, 800});
    CHECK(sidebar_view->visible());
    CHECK(sidebar_view->flex().direction == FlexDirection::row);
    CHECK(sidebar_view->flex().flex_wrap == FlexWrap::no_wrap);
    CHECK(additional_listener_called);
    CHECK(sidebar_view->flex().dim_width.unit == DimensionUnit::px);
    CHECK(sidebar_view->flex().dim_width.value == 240.0f);
    CHECK(sidebar_view->flex().dim_height.unit == DimensionUnit::px);
    CHECK(sidebar_view->flex().dim_height.value == 760.0f);

    const auto serialized = serialize_design_ir(ir, {.include_source_metadata = true});
    const auto roundtrip = parse_design_ir_json(serialized);
    REQUIRE(roundtrip.root.children[0].responsive);
    CHECK(roundtrip.root.children[0].responsive->vertical.offset == -40.0f);
    CHECK(roundtrip.root.children[0].responsive->layout_variants.size() == 2);

    auto reverse_root = build_native_view_tree(ir, {}, {});
    auto* reverse_sidebar = reverse_root->child_at(0);
    reverse_root->set_bounds({0, 0, 599, 800});
    reverse_root->set_bounds({0, 0, 601, 800});
    reverse_root->set_bounds({0, 0, 600, 800});
    CHECK(reverse_sidebar->visible() == sidebar_view->visible());
    CHECK(reverse_sidebar->flex().dim_height.value == sidebar_view->flex().dim_height.value);
    CHECK(reverse_sidebar->flex().direction == sidebar_view->flex().direction);
}
