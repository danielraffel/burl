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
    REQUIRE(roundtrip.root.children[0].responsive->vertical);
    CHECK(roundtrip.root.children[0].responsive->vertical->offset == -40.0f);
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

TEST_CASE("inactive structural siblings do not consume Yoga layout",
          "[view][import][responsive]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::row;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    for (const auto [name, narrow] : {std::pair{"compact", true}, {"expanded", false}}) {
        IRNode branch;
        branch.type = "view";
        branch.name = name;
        branch.stable_anchor_id = name;
        branch.layout.flex_grow = 1.0f;
        IRNode::ResponsiveConstraints constraints;
        constraints.horizontal = {.kind = "fill", .offset = 0.0f};
        constraints.vertical = {.kind = "fill", .offset = 0.0f};
        IRNode::ResponsiveVisibility first{.visible = narrow, .structural = !narrow};
        first.transition_to_next = IRNode::ResponsiveBreakpoint{599.0f, 600.0f, "measured"};
        constraints.visibility = {first, {.visible = !narrow, .structural = narrow}};
        branch.responsive = constraints;
        ir.root.children.push_back(std::move(branch));
    }
    auto root = build_native_view_tree(ir, {}, {});
    root->set_bounds({0, 0, 599, 800});
    root->layout_children();
    CHECK(root->child_at(0)->visible());
    CHECK_FALSE(root->child_at(1)->visible());
    CHECK(root->child_at(0)->bounds().width == 599.0f);
    CHECK(root->child_at(0)->bounds().x == 0.0f);
    root->set_bounds({0, 0, 600, 800});
    root->layout_children();
    CHECK_FALSE(root->child_at(0)->visible());
    CHECK(root->child_at(1)->visible());
    CHECK(root->child_at(1)->bounds().width == 600.0f);
    CHECK(root->child_at(1)->bounds().x == 0.0f);
}

TEST_CASE("responsive structural child order restores in either resize direction",
          "[view][import][responsive][order]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::row;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode::ResponsiveConstraints root_constraints;
    root_constraints.horizontal = {.kind = "fill", .offset = 0.0f};
    root_constraints.vertical = {.kind = "fill", .offset = 0.0f};
    IRNode::ResponsiveConstraints::LayoutVariant narrow;
    narrow.child_order = {"main", "toggle"};
    narrow.transition_to_next = IRNode::ResponsiveBreakpoint{599.0f, 600.0f, "measured"};
    IRNode::ResponsiveConstraints::LayoutVariant wide;
    wide.child_order = {"sidebar", "main", "toggle"};
    root_constraints.layout_variants = {narrow, wide};
    ir.root.responsive = root_constraints;
    for (const auto* name : {"main", "toggle", "sidebar"}) {
        IRNode child;
        child.type = "view";
        child.name = name;
        child.stable_anchor_id = name;
        child.layout.width_mode = SizingMode::fixed;
        child.style.width = 100.0f;
        child.layout.height_mode = SizingMode::fill;
        ir.root.children.push_back(std::move(child));
    }
    auto root = build_native_view_tree(ir, {}, {});
    root->set_bounds({0, 0, 600, 100});
    root->layout_children();
    CHECK(root->child_at(2)->bounds().x == 0.0f); // sidebar
    CHECK(root->child_at(0)->bounds().x == 100.0f); // main
    root->set_bounds({0, 0, 599, 100});
    root->layout_children();
    CHECK(root->child_at(0)->bounds().x == 0.0f); // main
    CHECK(root->child_at(1)->bounds().x == 100.0f); // toggle
    root->set_bounds({0, 0, 600, 100});
    root->layout_children();
    CHECK(root->child_at(2)->bounds().x == 0.0f);
    CHECK(root->child_at(0)->bounds().x == 100.0f);

    const auto roundtrip = parse_design_ir_json(serialize_design_ir(ir, {.include_source_metadata = true}));
    REQUIRE(roundtrip.root.responsive);
    CHECK(roundtrip.root.responsive->layout_variants[1].child_order ==
          std::vector<std::string>{"sidebar", "main", "toggle"});
}

TEST_CASE("responsive piecewise axis restores across an exact structural breakpoint",
          "[view][import][responsive][axis-variants]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode main;
    main.type = "view";
    main.name = "main";
    main.stable_anchor_id = "main";
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = {.kind = "fill", .offset = -24.0f};
    responsive.vertical = {.kind = "fill", .offset = 0.0f};
    IRNode::ResponsiveConstraints::AxisVariant narrow{.constraint = *responsive.horizontal};
    narrow.transition_to_next = IRNode::ResponsiveBreakpoint{767.0f, 768.0f, "measured"};
    IRNode::ResponsiveConstraints::AxisVariant wide{
        .constraint = {.kind = "fill", .offset = -292.0f}};
    responsive.horizontal_variants = {narrow, wide};
    main.responsive = responsive;
    ir.root.children.push_back(std::move(main));
    auto root = build_native_view_tree(ir, {}, {});
    root->set_bounds({0, 0, 599, 800});
    CHECK(root->child_at(0)->flex().dim_width.value == 575.0f);
    root->set_bounds({0, 0, 768, 800});
    CHECK(root->child_at(0)->flex().dim_width.value == 476.0f);
    root->set_bounds({0, 0, 767, 800});
    CHECK(root->child_at(0)->flex().dim_width.value == 743.0f);
    const auto roundtrip = parse_design_ir_json(serialize_design_ir(ir, {.include_source_metadata = true}));
    REQUIRE(roundtrip.root.children[0].responsive);
    CHECK(roundtrip.root.children[0].responsive->horizontal_variants.size() == 2);
}

TEST_CASE("responsive computed layout literals switch at the exact width boundary",
          "[view][import][responsive][style]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::row;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode content;
    content.type = "view";
    content.name = "content";
    content.stable_anchor_id = "content";
    content.layout.flex_grow = 1.0f;
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = {.kind = "fill", .offset = -20.0f};
    responsive.vertical = {.kind = "fill", .offset = 0.0f};
    IRNode::ResponsiveConstraints::LayoutVariant narrow;
    narrow.computed_style_literals = {{"marginLeft", "4px"}};
    narrow.transition_to_next = IRNode::ResponsiveBreakpoint{767.0f, 768.0f, "measured"};
    IRNode::ResponsiveConstraints::LayoutVariant wide;
    wide.computed_style_literals = {{"marginLeft", "12px"}};
    responsive.layout_variants = {narrow, wide};
    content.responsive = responsive;
    ir.root.children.push_back(std::move(content));

    const auto roundtrip = parse_design_ir_json(
        serialize_design_ir(ir, {.include_source_metadata = true}));
    REQUIRE(roundtrip.root.children[0].responsive);
    CHECK(roundtrip.root.children[0].responsive->layout_variants[0]
              .computed_style_literals.at("marginLeft") == "4px");
    auto root = build_native_view_tree(roundtrip, {}, {});
    REQUIRE(root);
    auto* content_view = root->child_at(0);
    root->set_bounds({0, 0, 767, 600});
    root->layout_children();
    CHECK(content_view->flex().margin_left == 4.0f);
    CHECK(content_view->flex().dim_width.value == 747.0f);
    CHECK(content_view->bounds().x == 4.0f);
    CHECK(content_view->bounds().width == 747.0f);
    root->set_bounds({0, 0, 768, 600});
    root->layout_children();
    CHECK(content_view->flex().margin_left == 12.0f);
    CHECK(content_view->flex().dim_width.value == 748.0f);
    CHECK(content_view->bounds().x == 12.0f);
    CHECK(content_view->bounds().width == 748.0f);
    root->set_bounds({0, 0, 767, 600});
    root->layout_children();
    CHECK(content_view->flex().margin_left == 4.0f);
    CHECK(content_view->flex().dim_width.value == 747.0f);
    CHECK(content_view->bounds().x == 4.0f);
    CHECK(content_view->bounds().width == 747.0f);
}

TEST_CASE("responsive visibility and style variants can use viewport height",
          "[view][import][responsive][style]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode region;
    region.type = "view";
    region.name = "region";
    region.stable_anchor_id = "region";
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = {.kind = "fill", .offset = -24.0f};
    responsive.vertical = {.kind = "fill", .offset = -12.0f};
    IRNode::ResponsiveVisibility short_viewport{.visible = false, .structural = false};
    short_viewport.transition_to_next =
        IRNode::ResponsiveBreakpoint{248.0f, 800.0f, "bounded", "height"};
    responsive.visibility = {short_viewport, {.visible = true, .structural = false}};
    IRNode::ResponsiveConstraints::LayoutVariant short_layout;
    short_layout.computed_style_literals = {{"marginTop", "0px"}};
    short_layout.transition_to_next =
        IRNode::ResponsiveBreakpoint{248.0f, 800.0f, "bounded", "height"};
    IRNode::ResponsiveConstraints::LayoutVariant tall_layout;
    tall_layout.computed_style_literals = {{"marginTop", "12px"}};
    responsive.layout_variants = {short_layout, tall_layout};
    region.responsive = responsive;
    ir.root.children.push_back(std::move(region));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    auto* region_view = root->child_at(0);
    root->set_bounds({0, 0, 280, 248});
    root->layout_children();
    CHECK_FALSE(region_view->visible());
    CHECK(region_view->flex().margin_top == 0.0f);
    CHECK(region_view->flex().dim_width.value == 256.0f);
    root->set_bounds({0, 0, 280, 800});
    root->layout_children();
    CHECK(region_view->visible());
    CHECK(region_view->flex().margin_top == 12.0f);
    CHECK(region_view->flex().dim_width.value == 256.0f);
    root->set_bounds({0, 0, 280, 248});
    root->layout_children();
    CHECK_FALSE(region_view->visible());
}

TEST_CASE("imported application state overrides visible responsive baseline but not forced hiding",
          "[view][import][responsive][state]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode panel;
    panel.type = "view";
    panel.name = "panel";
    panel.stable_anchor_id = "panel";
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = {.kind = "fixed", .value = 160.0f};
    responsive.vertical = {.kind = "fill", .offset = 0.0f};
    IRNode::ResponsiveVisibility narrow{.visible = false, .structural = false};
    narrow.transition_to_next = IRNode::ResponsiveBreakpoint{399.0f, 400.0f, "measured"};
    responsive.visibility = {narrow, {.visible = true, .structural = false}};
    responsive.application_state_key = "panel.presentation";
    responsive.visibility_by_application_state = {{"expanded", true}, {"collapsed", false}};
    panel.responsive = responsive;
    ir.root.children.push_back(std::move(panel));

    const auto roundtrip = parse_design_ir_json(
        serialize_design_ir(ir, {.include_source_metadata = true}));
    REQUIRE(roundtrip.root.children[0].responsive);
    CHECK(roundtrip.root.children[0].responsive->application_state_key == "panel.presentation");
    auto root = build_native_view_tree(roundtrip, {}, {});
    REQUIRE(root);
    auto* panel_view = root->child_at(0);
    root->set_bounds({0, 0, 600, 500});
    CHECK(panel_view->visible());
    CHECK(set_imported_application_state(*root, "panel.presentation", "collapsed"));
    CHECK_FALSE(panel_view->visible());
    root->set_bounds({0, 0, 320, 500});
    CHECK_FALSE(panel_view->visible());
    root->set_bounds({0, 0, 600, 500});
    CHECK_FALSE(panel_view->visible());
    CHECK(set_imported_application_state(*root, "panel.presentation", "expanded"));
    CHECK(panel_view->visible());
    root->set_bounds({0, 0, 320, 500});
    CHECK_FALSE(panel_view->visible());
    root->set_bounds({0, 0, 600, 500});
    CHECK(panel_view->visible());
    CHECK(clear_imported_application_state(*root, "panel.presentation"));
    CHECK(panel_view->visible());
}

TEST_CASE("responsive partial axis survives JSON and resize order",
          "[view][import][responsive][partial-axis]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode content;
    content.type = "view";
    content.name = "content";
    content.stable_anchor_id = "content";
    content.layout.width_mode = SizingMode::fixed;
    content.style.width = 907.0f;
    content.layout.height_mode = SizingMode::fixed;
    content.style.height = 180.0f;
    IRNode::ResponsiveConstraints constraints;
    constraints.horizontal = {.kind = "fill", .offset = -24.0f};
    constraints.visibility = {{.visible = true, .structural = false}};
    content.responsive = constraints;
    ir.root.children.push_back(std::move(content));

    const auto roundtrip = parse_design_ir_json(serialize_design_ir(ir, {.include_source_metadata = true}));
    REQUIRE(roundtrip.root.children[0].responsive);
    REQUIRE(roundtrip.root.children[0].responsive->horizontal);
    CHECK_FALSE(roundtrip.root.children[0].responsive->vertical);
    CHECK(roundtrip.root.children[0].responsive->horizontal->kind == "fill");

    auto root = build_native_view_tree(roundtrip, {}, {});
    auto* content_view = root->child_at(0);
    for (const float width : {599.0f, 1200.0f, 768.0f, 599.0f}) {
        root->set_bounds({0, 0, width, 800});
        root->layout_children();
        CHECK(content_view->flex().dim_width.value == width - 24.0f);
        CHECK(content_view->bounds().x >= 0.0f);
        CHECK(content_view->bounds().x + content_view->bounds().width <= width);
        CHECK(content_view->flex().dim_height.value == 180.0f);
    }
}

TEST_CASE("responsive resize re-resolves anchors after subtree replacement",
          "[view][import][responsive][lifetime]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    IRNode child;
    child.type = "view";
    child.name = "replaceable";
    child.stable_anchor_id = "replaceable";
    IRNode::ResponsiveConstraints constraints;
    constraints.horizontal = {.kind = "fill", .offset = -20.0f};
    constraints.vertical = {.kind = "fixed", .value = 40.0f};
    constraints.visibility = {{.visible = true, .structural = false}};
    child.responsive = constraints;
    ir.root.children.push_back(std::move(child));
    auto root = build_native_view_tree(ir, {}, {});
    auto* original = root->child_at(0);
    auto removed = root->remove_child(original);
    removed.reset();
    auto replacement = std::make_unique<View>();
    replacement->set_anchor_id("replaceable");
    auto* replacement_ptr = replacement.get();
    root->add_child(std::move(replacement));
    root->set_bounds({0, 0, 600, 800});
    root->layout_children();
    CHECK(replacement_ptr->flex().dim_width.value == 580.0f);
    root->set_bounds({0, 0, 599, 800});
    root->layout_children();
    CHECK(replacement_ptr->flex().dim_width.value == 579.0f);
}
