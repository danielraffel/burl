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
    responsive.vertical = {.kind = "fill", .offset = 0.0f};
    IRNode::ResponsiveVisibility collapsed;
    collapsed.visible = false;
    collapsed.structural = true;
    collapsed.transition_to_next = IRNode::ResponsiveBreakpoint{599.0f, 600.0f, "measured"};
    responsive.visibility = {collapsed, {.visible = true, .structural = false}};
    sidebar.responsive = responsive;
    ir.root.children.push_back(std::move(sidebar));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    REQUIRE(root->child_count() == 1);
    auto* sidebar_view = root->child_at(0);

    root->set_bounds({0, 0, 599, 800});
    CHECK_FALSE(sidebar_view->visible());
    root->set_bounds({0, 0, 600, 800});
    CHECK(sidebar_view->visible());
    CHECK(sidebar_view->flex().dim_width.unit == DimensionUnit::px);
    CHECK(sidebar_view->flex().dim_width.value == 240.0f);
    CHECK(sidebar_view->flex().dim_height.unit == DimensionUnit::percent);
    CHECK(sidebar_view->flex().dim_height.value == 100.0f);
}
