#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_string.hpp>

#include <pulp/view/design_import.hpp>
#include <pulp/view/design_ir.hpp>
#include <pulp/view/view.hpp>
#include <pulp/view/widgets.hpp>

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
    CHECK(sidebar_view->flex().dim_height.unit == DimensionUnit::percent);
    CHECK(sidebar_view->flex().dim_height.resolve(800.0f, 600.0f, 800.0f) == 760.0f);

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

TEST_CASE("responsive compact toolbars wrap controls without horizontal overflow",
          "[view][import][responsive][wrap]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;

    IRNode toolbar;
    toolbar.type = "view";
    toolbar.stable_anchor_id = "toolbar";
    toolbar.layout.direction = LayoutDirection::row;
    toolbar.layout.wrap = false;
    toolbar.layout.gap = 8.0f;
    toolbar.layout.padding_left = 12.0f;
    toolbar.layout.padding_right = 12.0f;
    toolbar.layout.width_mode = SizingMode::fill;
    toolbar.layout.height_mode = SizingMode::hug;
    toolbar.responsive.emplace();
    IRNode::ResponsiveConstraints::LayoutVariant compact;
    compact.flex_direction = "row";
    compact.flex_wrap = "wrap";
    compact.reflowed = true;
    compact.transition_to_next = IRNode::ResponsiveBreakpoint{599.0f, 600.0f, "measured"};
    IRNode::ResponsiveConstraints::LayoutVariant regular;
    regular.flex_direction = "row";
    regular.flex_wrap = "nowrap";
    toolbar.responsive->layout_variants = {compact, regular};
    for (const auto [name, width] : {
             std::pair{"add", 32.0f}, {"mode", 72.0f},
             {"model", 126.0f}, {"variant", 112.0f}, {"status", 88.0f}}) {
        IRNode control;
        control.type = "view";
        control.stable_anchor_id = name;
        control.style.width = width;
        control.style.height = 28.0f;
        control.layout.width_mode = SizingMode::fixed;
        control.layout.height_mode = SizingMode::fixed;
        control.layout.flex_shrink = 0.0f;
        toolbar.children.push_back(std::move(control));
    }
    ir.root.children.push_back(std::move(toolbar));

    auto root = build_native_view_tree(ir, {}, {});
    root->set_bounds({0, 0, 280, 180});
    root->layout_children();
    auto* toolbar_view = root->child_at(0);
    CHECK(toolbar_view->flex().flex_wrap == FlexWrap::wrap);
    bool wrapped = false;
    for (std::size_t index = 0; index < toolbar_view->child_count(); ++index) {
        const auto bounds = toolbar_view->child_at(index)->bounds();
        CHECK(bounds.x >= 12.0f);
        CHECK(bounds.x + bounds.width <= 268.0f);
        wrapped = wrapped || bounds.y > 0.0f;
    }
    CHECK(wrapped);

    root->set_bounds({0, 0, 600, 180});
    root->layout_children();
    CHECK(toolbar_view->flex().flex_wrap == FlexWrap::no_wrap);
    for (std::size_t index = 0; index < toolbar_view->child_count(); ++index) {
        const auto bounds = toolbar_view->child_at(index)->bounds();
        CHECK(bounds.y == 0.0f);
        CHECK(bounds.x + bounds.width <= 588.0f);
    }
}

TEST_CASE("responsive content grid keeps transcript and composer inside shared gutters",
          "[view][import][responsive][grid]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::column;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;

    IRNode main;
    main.type = "view";
    main.stable_anchor_id = "main";
    main.layout.direction = LayoutDirection::column;
    main.layout.margin_left = 12.0f;
    main.layout.margin_right = 12.0f;
    main.layout.width_mode = SizingMode::fill;
    main.layout.height_mode = SizingMode::fill;
    main.responsive.emplace();
    main.responsive->horizontal = {.kind = "fill", .offset = -24.0f};
    main.responsive->vertical = {.kind = "fill", .offset = -12.0f};

    IRNode app_bar;
    app_bar.type = "view";
    app_bar.stable_anchor_id = "app-bar";
    app_bar.style.height = 46.0f;
    app_bar.layout.width_mode = SizingMode::fill;
    app_bar.layout.height_mode = SizingMode::fixed;

    IRNode content;
    content.type = "view";
    content.stable_anchor_id = "content";
    content.layout.direction = LayoutDirection::column;
    content.layout.width_mode = SizingMode::fill;
    content.layout.height_mode = SizingMode::fill;
    content.layout.flex_grow = 1.0f;
    content.layout.flex_shrink = 1.0f;

    IRNode transcript;
    transcript.type = "view";
    transcript.stable_anchor_id = "transcript";
    transcript.layout.width_mode = SizingMode::fill;
    transcript.layout.height_mode = SizingMode::fill;
    transcript.layout.flex_grow = 1.0f;
    transcript.layout.flex_shrink = 1.0f;
    transcript.style.min_height = 0.0f;
    transcript.layout.overflow_y = "hidden";

    IRNode composer;
    composer.type = "view";
    composer.stable_anchor_id = "composer";
    composer.style.height = 186.0f;
    composer.layout.width_mode = SizingMode::fill;
    composer.layout.height_mode = SizingMode::fixed;

    IRNode footer;
    footer.type = "view";
    footer.stable_anchor_id = "footer";
    footer.style.height = 24.0f;
    footer.layout.width_mode = SizingMode::fill;
    footer.layout.height_mode = SizingMode::fixed;

    content.children = {std::move(transcript), std::move(composer), std::move(footer)};
    main.children = {std::move(app_bar), std::move(content)};
    ir.root.children.push_back(std::move(main));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    auto* main_view = root->child_at(0);
    auto* content_view = main_view->child_at(1);
    auto* transcript_view = content_view->child_at(0);
    auto* composer_view = content_view->child_at(1);
    auto* footer_view = content_view->child_at(2);

    const auto verify = [&](float width, float height) {
        root->set_bounds({0, 0, width, height});
        root->layout_children();
        CHECK(std::abs(main_view->bounds().x - 12.0f) < 0.01f);
        CHECK(std::abs(main_view->bounds().right() - (width - 12.0f)) < 0.01f);
        CHECK(std::abs(composer_view->bounds().x) < 0.01f);
        CHECK(std::abs(composer_view->bounds().right() - main_view->bounds().width) < 0.01f);
        CHECK(std::abs(transcript_view->bounds().bottom() - composer_view->bounds().y) < 0.01f);
        CHECK(std::abs(composer_view->bounds().bottom() - footer_view->bounds().y) < 0.01f);
        CHECK(std::abs(footer_view->bounds().bottom() - content_view->bounds().height) < 0.01f);
        CHECK(std::abs(main_view->bounds().bottom() - (height - 12.0f)) < 0.01f);
    };
    verify(280.0f, 420.0f);
    verify(600.0f, 420.0f);
    verify(1200.0f, 800.0f);
    verify(1440.0f, 800.0f);
    const float main_height_at_800 = main_view->bounds().height;
    verify(1440.0f, 900.0f);
    CHECK(std::abs(main_view->bounds().height - main_height_at_800 - 100.0f) < 0.01f);
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
    CHECK(root->child_at(1)->bounds().width == 0.0f);
    CHECK(root->child_at(1)->bounds().height == 0.0f);
    CHECK(root->hit_test({450.0f, 400.0f}) != root->child_at(1));
    root->set_bounds({0, 0, 600, 800});
    root->layout_children();
    CHECK_FALSE(root->child_at(0)->visible());
    CHECK(root->child_at(1)->visible());
    CHECK(root->child_at(0)->bounds().width == 0.0f);
    CHECK(root->child_at(0)->bounds().height == 0.0f);
    CHECK(root->child_at(1)->bounds().width == 600.0f);
    CHECK(root->child_at(1)->bounds().x == 0.0f);
    CHECK(root->hit_test({450.0f, 400.0f}) != root->child_at(0));
    root->set_bounds({0, 0, 599, 800});
    root->layout_children();
    CHECK(root->child_at(0)->visible());
    CHECK(root->child_at(0)->bounds().width == 599.0f);
    CHECK(root->child_at(0)->bounds().height == 800.0f);
}

TEST_CASE("collection slots fill their containing viewport without duplicated geometry",
          "[view][import][responsive][collection]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::column;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode slot;
    slot.type = "view";
    slot.stable_anchor_id = "messages-slot";
    slot.attributes["pulpCollectionKey"] = "messages";
    slot.layout.flex_grow = 1.0f;
    slot.style.width = 180.0f;
    slot.style.height = 100.0f;
    IRNode::ResponsiveConstraints constraints;
    constraints.horizontal = {.kind = "fixed", .value = 180.0f};
    constraints.vertical = {.kind = "fixed", .value = 100.0f};
    slot.responsive = constraints;
    ir.root.children.push_back(std::move(slot));

    auto root = build_native_view_tree(ir, {}, {});
    root->set_bounds({0, 0, 240, 300});
    root->layout_children();
    CHECK(root->child_at(0)->bounds().width == 240.0f);
    CHECK(root->child_at(0)->bounds().height == 300.0f);
}

TEST_CASE("fixed collection slots preserve their captured viewport",
          "[view][import][responsive][collection]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::column;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode slot;
    slot.type = "view";
    slot.stable_anchor_id = "projects-slot";
    slot.attributes["pulpCollectionKey"] = "projects";
    slot.style.height = 104.0f;
    slot.layout.flex_grow = 0.0f;
    slot.layout.height_mode = SizingMode::fixed;
    ir.root.children.push_back(std::move(slot));
    auto root = build_native_view_tree(ir, {}, {});
    root->set_bounds({0, 0, 240, 500});
    root->layout_children();
    CHECK(root->child_at(0)->bounds().height == 104.0f);
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
    CHECK(root->child_at(0)->flex().dim_width.resolve(599.0f, 599.0f, 800.0f) == 575.0f);
    root->set_bounds({0, 0, 768, 800});
    CHECK(root->child_at(0)->flex().dim_width.resolve(768.0f, 768.0f, 800.0f) == 476.0f);
    root->set_bounds({0, 0, 767, 800});
    CHECK(root->child_at(0)->flex().dim_width.resolve(767.0f, 767.0f, 800.0f) == 743.0f);
    const auto roundtrip = parse_design_ir_json(serialize_design_ir(ir, {.include_source_metadata = true}));
    REQUIRE(roundtrip.root.children[0].responsive);
    CHECK(roundtrip.root.children[0].responsive->horizontal_variants.size() == 2);
}

TEST_CASE("responsive axis variants select against their declared viewport axis",
          "[view][import][responsive][axis-variants]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode content;
    content.type = "view";
    content.stable_anchor_id = "content";
    IRNode::ResponsiveConstraints responsive;
    IRNode::ResponsiveConstraints::AxisVariant short_viewport{
        .constraint = {.kind = "fill", .offset = -100.0f}};
    short_viewport.transition_to_next = IRNode::ResponsiveBreakpoint{
        .lower_bound = 499.0f, .upper_bound = 500.0f,
        .confidence = "measured", .axis = "height"};
    IRNode::ResponsiveConstraints::AxisVariant tall_viewport{
        .constraint = {.kind = "fill", .offset = -200.0f}};
    responsive.vertical_variants = {short_viewport, tall_viewport};
    content.responsive = responsive;
    ir.root.children.push_back(std::move(content));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    root->set_bounds({0, 0, 1200, 400});
    CHECK(root->child_at(0)->flex().dim_height.resolve(400.0f, 1200.0f, 400.0f) == 300.0f);
    root->set_bounds({0, 0, 280, 600});
    CHECK(root->child_at(0)->flex().dim_height.resolve(600.0f, 280.0f, 600.0f) == 400.0f);
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
    CHECK(content_view->flex().dim_width.resolve(767.0f, 767.0f, 600.0f) == 747.0f);
    CHECK(content_view->bounds().x == 4.0f);
    CHECK(content_view->bounds().width == 747.0f);
    root->set_bounds({0, 0, 768, 600});
    root->layout_children();
    CHECK(content_view->flex().margin_left == 12.0f);
    CHECK(content_view->flex().dim_width.resolve(768.0f, 768.0f, 600.0f) == 748.0f);
    CHECK(content_view->bounds().x == 12.0f);
    CHECK(content_view->bounds().width == 748.0f);
    root->set_bounds({0, 0, 767, 600});
    root->layout_children();
    CHECK(content_view->flex().margin_left == 4.0f);
    CHECK(content_view->flex().dim_width.resolve(767.0f, 767.0f, 600.0f) == 747.0f);
    CHECK(content_view->bounds().x == 4.0f);
    CHECK(content_view->bounds().width == 747.0f);
}

TEST_CASE("min-only responsive axes replace sampled fixed extents with intrinsic floors",
          "[view][import][responsive][axis][intrinsic]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::column;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;

    IRNode content;
    content.type = "view";
    content.stable_anchor_id = "content";
    // These are capture-time used values, not an authored fixed-size contract.
    content.style.width = 320.0f;
    content.style.height = 160.5f;
    content.layout.width_mode = SizingMode::fixed;
    content.layout.height_mode = SizingMode::fixed;
    content.responsive = IRNode::ResponsiveConstraints{
        .horizontal = IRNode::ResponsiveAxis{.kind = "min", .min = 232.0f},
        .vertical = IRNode::ResponsiveAxis{.kind = "min", .min = 140.5f},
    };
    ir.root.children.push_back(std::move(content));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    auto* content_view = root->child_at(0);
    root->set_bounds({0, 0, 599, 420});
    root->layout_children();
    CHECK(content_view->flex().dim_width.unit == DimensionUnit::auto_);
    CHECK(content_view->flex().dim_height.unit == DimensionUnit::auto_);
    CHECK(content_view->flex().dim_min_width.value == 232.0f);
    CHECK(content_view->flex().dim_min_height.value == 140.5f);
    CHECK(content_view->flex().preferred_width == 0.0f);
    CHECK(content_view->flex().preferred_height == 0.0f);

    // A genuinely fixed responsive axis remains fixed; only min-only intrinsic
    // contracts clear the capture-time preferred extent.
    ir.root.children[0].responsive->horizontal =
        IRNode::ResponsiveAxis{.kind = "fixed", .value = 280.0f};
    ir.root.children[0].responsive->vertical =
        IRNode::ResponsiveAxis{.kind = "fixed", .value = 150.0f};
    root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    content_view = root->child_at(0);
    root->set_bounds({0, 0, 599, 420});
    root->layout_children();
    CHECK(content_view->flex().dim_width.unit == DimensionUnit::px);
    CHECK(content_view->flex().dim_width.value == 280.0f);
    CHECK(content_view->flex().dim_height.unit == DimensionUnit::px);
    CHECK(content_view->flex().dim_height.value == 150.0f);
}

TEST_CASE("responsive text layout literals switch at the exact width boundary",
          "[view][import][responsive][style][text]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;
    IRNode label;
    label.type = "text";
    label.name = "model-label";
    label.stable_anchor_id = "model-label";
    label.text_content = "Claude Opus 4.6";
    label.style.white_space = "nowrap";
    label.style.text_overflow = "ellipsis";
    IRNode::ResponsiveConstraints responsive;
    IRNode::ResponsiveConstraints::LayoutVariant narrow;
    narrow.computed_style_literals = {{"whiteSpace", "normal"}, {"textOverflow", "clip"}};
    narrow.transition_to_next = IRNode::ResponsiveBreakpoint{599.0f, 600.0f, "measured"};
    IRNode::ResponsiveConstraints::LayoutVariant wide;
    wide.computed_style_literals = {{"whiteSpace", "nowrap"}, {"textOverflow", "ellipsis"}};
    responsive.layout_variants = {narrow, wide};
    responsive.visibility = {{true, false, std::nullopt}};
    label.responsive = responsive;
    ir.root.children.push_back(std::move(label));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    auto* imported_label = dynamic_cast<Label*>(root->child_at(0));
    REQUIRE(imported_label);
    root->set_bounds({0, 0, 599, 100});
    root->layout_children();
    CHECK(imported_label->multi_line());
    CHECK_FALSE(imported_label->text_overflow_ellipsis());
    root->set_bounds({0, 0, 600, 100});
    root->layout_children();
    CHECK_FALSE(imported_label->multi_line());
    CHECK(imported_label->text_overflow_ellipsis());
    root->set_bounds({0, 0, 599, 100});
    root->layout_children();
    CHECK(imported_label->multi_line());
    CHECK_FALSE(imported_label->text_overflow_ellipsis());
}

TEST_CASE("authored fluid width and auto margin outrank sampled responsive pixels",
          "[view][import][responsive][cascade]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::column;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;

    IRNode content;
    content.type = "view";
    content.name = "content";
    content.stable_anchor_id = "content";
    content.style.width_dimension = "100%";
    content.style.max_width_dimension = "95%";
    content.layout.margin_left_dimension = "auto";
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = {.kind = "fixed", .value = 713.0f};
    IRNode::ResponsiveConstraints::LayoutVariant observed;
    observed.computed_style_literals = {{"marginLeft", "22px"}};
    responsive.layout_variants = {observed};
    content.responsive = responsive;
    ir.root.children.push_back(std::move(content));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    auto* content_view = root->child_at(0);
    root->set_bounds({0, 0, 875, 200});
    root->layout_children();
    CHECK(content_view->flex().dim_width.unit == DimensionUnit::percent);
    CHECK(content_view->flex().dim_width.value == 100.0f);
    CHECK(content_view->flex().dim_margin_left.unit == DimensionUnit::auto_);
    CHECK(std::abs(content_view->bounds().width - 831.25f) < 0.5f);
    CHECK(std::abs(content_view->bounds().right() - 875.0f) < 0.1f);
}

TEST_CASE("observed block stretch preserves fill for authored auto width",
          "[view][import][responsive][cascade]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::column;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;

    IRNode wrapper;
    wrapper.type = "view";
    wrapper.name = "wrapper";
    wrapper.stable_anchor_id = "wrapper";
    wrapper.layout.direction = LayoutDirection::column;
    wrapper.layout.width_mode = SizingMode::fill;
    wrapper.layout.align_self = "stretch";
    wrapper.layout.height_mode = SizingMode::hug;
    wrapper.style.max_width = 896.0f;

    IRNode status_row;
    status_row.type = "view";
    status_row.name = "status-row";
    status_row.stable_anchor_id = "status-row";
    // Captures retain a sampled preferred extent for diagnostics and
    // round-tripping. The live relative axis must supersede it.
    status_row.style.width = 887.0f;
    status_row.style.width_dimension = "auto";
    status_row.layout.align_self = "stretch";
    status_row.style.height = 24.0f;
    status_row.layout.height_mode = SizingMode::fixed;
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = {.kind = "fill", .offset = 0.0f};
    responsive.vertical = {.kind = "fixed", .value = 24.0f};
    status_row.responsive = responsive;
    wrapper.children.push_back(std::move(status_row));
    ir.root.children.push_back(std::move(wrapper));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    auto* wrapper_view = root->child_at(0);
    auto* row = wrapper_view->child_at(0);
    root->set_bounds({0, 0, 599, 200});
    root->layout_children();
    CAPTURE(wrapper_view->bounds().x, wrapper_view->bounds().width,
            row->flex().dim_width.value, static_cast<int>(row->flex().dim_width.unit));
    CHECK(row->bounds().x == 0.0f);
    CHECK(row->bounds().width == 599.0f);
    root->set_bounds({0, 0, 280, 200});
    root->layout_children();
    CHECK(row->bounds().x == 0.0f);
    CHECK(row->bounds().width == 280.0f);
}

TEST_CASE("inferred block stretch does not escape an auto max width containing block",
          "[view][import][responsive][cascade]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::column;
    ir.root.layout.width_mode = SizingMode::fill;
    ir.root.layout.height_mode = SizingMode::fill;

    IRNode wrapper;
    wrapper.type = "view";
    wrapper.name = "auto-wrapper";
    wrapper.stable_anchor_id = "auto-wrapper";
    wrapper.layout.direction = LayoutDirection::column;
    wrapper.layout.align_self = "stretch";
    wrapper.style.max_width = 896.0f;

    IRNode row;
    row.type = "view";
    row.name = "captured-block-row";
    row.stable_anchor_id = "captured-block-row";
    row.layout.display = "block";
    row.layout.align_self = "stretch";
    row.style.height = 24.0f;
    row.layout.height_mode = SizingMode::fixed;
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = {.kind = "min", .ratio = 1.0f, .offset = 0.0f,
                             .min = 0.0f};
    responsive.vertical = {.kind = "fixed", .value = 24.0f};
    row.responsive = responsive;
    wrapper.children.push_back(std::move(row));
    ir.root.children.push_back(std::move(wrapper));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    auto* wrapper_view = root->child_at(0);
    auto* row_view = wrapper_view->child_at(0);
    root->set_bounds({0, 0, 1200, 200});
    root->layout_children();
    CHECK(wrapper_view->bounds().width == 896.0f);
    CHECK(row_view->bounds().x == 0.0f);
    CHECK(row_view->bounds().width == wrapper_view->bounds().width);
    CHECK(row_view->bounds().right() <= wrapper_view->bounds().width);
}

TEST_CASE("responsive imported subtree root resolves against its external containing block",
          "[view][import][responsive][cascade]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "fluid-row";
    ir.root.stable_anchor_id = "fluid-row";
    ir.root.style.width_dimension = "100%";
    ir.root.style.max_width_dimension = "95%";
    ir.root.layout.margin_left_dimension = "auto";
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = {.kind = "proportional", .ratio = 0.95f};
    ir.root.responsive = responsive;

    auto imported = build_native_view_tree(ir, {}, {});
    REQUIRE(imported);
    auto* row = imported.get();
    View host;
    host.flex().direction = FlexDirection::column;
    host.set_bounds({0, 0, 875, 200});
    host.add_child(std::move(imported));
    host.layout_children();
    CHECK(std::abs(row->bounds().width - 831.25f) < 0.5f);
    CHECK(std::abs(row->bounds().right() - 875.0f) < 0.5f);
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
    CHECK(region_view->flex().dim_width.resolve(280.0f, 280.0f, 248.0f) == 256.0f);
    root->set_bounds({0, 0, 280, 800});
    root->layout_children();
    CHECK(region_view->visible());
    CHECK(region_view->flex().margin_top == 12.0f);
    CHECK(region_view->flex().dim_width.resolve(280.0f, 280.0f, 800.0f) == 256.0f);
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
    responsive.application_state_default_value = "collapsed";
    responsive.visibility_by_application_state = {{"expanded", true}, {"collapsed", false}};
    panel.responsive = responsive;
    ir.root.children.push_back(std::move(panel));

    const auto roundtrip = parse_design_ir_json(
        serialize_design_ir(ir, {.include_source_metadata = true}));
    REQUIRE(roundtrip.root.children[0].responsive);
    CHECK(roundtrip.root.children[0].responsive->application_state_key == "panel.presentation");
    CHECK(roundtrip.root.children[0].responsive->application_state_default_value == "collapsed");
    auto root = build_native_view_tree(roundtrip, {}, {});
    REQUIRE(root);
    auto* panel_view = root->child_at(0);
    root->set_bounds({0, 0, 600, 500});
    CHECK_FALSE(panel_view->visible());
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

TEST_CASE("imported application state selects an explicit default branch on first layout",
          "[view][import][responsive][state]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.name = "root";
    ir.root.stable_anchor_id = "root";
    for (const auto& [name, default_visible, open_visible] :
         {std::tuple{"closed", true, false}, std::tuple{"open", false, true}}) {
        IRNode branch;
        branch.type = "view";
        branch.name = name;
        branch.stable_anchor_id = name;
        IRNode::ResponsiveConstraints responsive;
        responsive.visibility = {{.visible = true, .structural = true}};
        responsive.application_state_key = "panel.presentation";
        responsive.visibility_by_application_state = {
            {"default", default_visible}, {"open", open_visible}};
        branch.responsive = responsive;
        ir.root.children.push_back(std::move(branch));
    }
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    root->set_bounds({0, 0, 600, 500});
    CHECK(root->child_at(0)->visible());
    CHECK_FALSE(root->child_at(1)->visible());
    CHECK(set_imported_application_state(*root, "panel.presentation", "open"));
    CHECK_FALSE(root->child_at(0)->visible());
    CHECK(root->child_at(1)->visible());
}

TEST_CASE("application state predicates guard variants without selecting their state",
          "[view][import][responsive][state]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";

    IRNode chat;
    chat.type = "view";
    chat.stable_anchor_id = "chat";
    IRNode::ResponsiveConstraints chat_responsive;
    chat_responsive.visibility = {{.visible = true, .structural = true}};
    chat_responsive.application_state_key = "navigation.route";
    chat_responsive.visibility_by_application_state = {{"chat", true}, {"settings", false}};
    chat.responsive = chat_responsive;

    IRNode settings_overlay;
    settings_overlay.type = "view";
    settings_overlay.stable_anchor_id = "settings-overlay";
    IRNode::ResponsiveConstraints overlay_responsive;
    overlay_responsive.visibility = {{.visible = false, .structural = true}};
    overlay_responsive.application_state_key = "settings.menu.open";
    overlay_responsive.visibility_by_application_state = {{"closed", false}, {"open", true}};
    overlay_responsive.application_state_when.push_back(
        {.key = "navigation.route", .value = "settings"});
    settings_overlay.responsive = overlay_responsive;

    ir.root.children.push_back(std::move(chat));
    ir.root.children.push_back(std::move(settings_overlay));
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    root->set_bounds({0, 0, 600, 500});
    CHECK(root->child_at(0)->visible());
    CHECK_FALSE(root->child_at(1)->visible());
    CHECK(set_imported_application_state(*root, "navigation.route", "settings"));
    CHECK_FALSE(root->child_at(0)->visible());
}

TEST_CASE("hidden captured branches do not infer an active application state",
          "[view][import][responsive][state]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";

    IRNode portal;
    portal.type = "view";
    portal.stable_anchor_id = "dismissed-portal";
    IRNode::ResponsiveConstraints portal_responsive;
    portal_responsive.visibility = {{.visible = false, .structural = true}};
    portal_responsive.application_state_key = "menu.open";
    portal_responsive.visibility_by_application_state = {
        {"closed", true}, {"open", false}};
    portal.responsive = portal_responsive;

    IRNode content;
    content.type = "view";
    content.stable_anchor_id = "content";
    IRNode::ResponsiveConstraints content_responsive;
    content_responsive.application_state_base.layout = {{"paddingLeft", "4px"}};
    IRNode::ResponsiveConstraints::ApplicationStateVariant open;
    open.key = "menu.open";
    open.value = "open";
    open.layout = {{"paddingLeft", "20px"}};
    content_responsive.application_state_variants = {open};
    content.responsive = content_responsive;

    ir.root.children.push_back(std::move(portal));
    ir.root.children.push_back(std::move(content));
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    root->set_bounds({0, 0, 600, 500});
    CHECK_FALSE(root->child_at(0)->visible());
    CHECK(root->child_at(1)->flex().padding_left == 4.0f);
    REQUIRE(set_imported_application_state(*root, "menu.open", "open"));
    CHECK(root->child_at(1)->flex().padding_left == 20.0f);
}

TEST_CASE("imported application state transitions are deterministic and fail closed",
          "[view][import][responsive][state]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    IRNode branch;
    branch.type = "view";
    branch.stable_anchor_id = "branch";
    IRNode::ResponsiveConstraints responsive;
    responsive.visibility = {{.visible = true, .structural = true}};
    responsive.application_state_key = "panel.open";
    responsive.visibility_by_application_state = {{"false", false}, {"true", true}};
    branch.responsive = responsive;
    ir.root.children.push_back(std::move(branch));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    root->set_bounds({0, 0, 600, 500});
    REQUIRE(apply_imported_application_state_transition(*root, "panel.open", "toggle"));
    CHECK(root->child_at(0)->visible());
    REQUIRE(apply_imported_application_state_transition(*root, "panel.open", "toggle"));
    CHECK_FALSE(root->child_at(0)->visible());
    CHECK_FALSE(apply_imported_application_state_transition(*root, "panel.open", "toggle:open,closed"));
    CHECK_FALSE(root->child_at(0)->visible());
    REQUIRE(apply_imported_application_state_transition(*root, "panel.open", "set:true"));
    CHECK(root->child_at(0)->visible());
    REQUIRE(apply_imported_application_state_transition(*root, "panel.open", "set:default"));
    REQUIRE(apply_imported_application_state_transition(*root, "panel.open", "cycle:default,verbose"));
    REQUIRE(apply_imported_application_state_transition(*root, "panel.open", "cycle:default,verbose"));
    CHECK_FALSE(apply_imported_application_state_transition(*root, "panel.open", "cycle:only"));
    CHECK(root->child_at(0)->visible());
}

TEST_CASE("nested imported runtimes inherit containing application state predicates",
          "[view][import][responsive][state]") {
    DesignIR outer_ir;
    outer_ir.root.type = "view";
    outer_ir.root.stable_anchor_id = "outer-root";
    IRNode route_probe;
    route_probe.type = "view";
    route_probe.stable_anchor_id = "route-probe";
    IRNode::ResponsiveConstraints route_responsive;
    route_responsive.visibility = {{.visible = true, .structural = true}};
    route_responsive.application_state_key = "navigation.route";
    route_responsive.visibility_by_application_state = {
        {"chat", false}, {"settings", true}};
    route_probe.responsive = route_responsive;
    outer_ir.root.children.push_back(std::move(route_probe));
    auto outer = build_native_view_tree(outer_ir, {}, {});
    REQUIRE(outer);
    outer->set_bounds({0, 0, 600, 500});
    REQUIRE(set_imported_application_state(*outer, "navigation.route", "settings"));

    DesignIR row_ir;
    row_ir.root.type = "view";
    row_ir.root.stable_anchor_id = "dynamic-row";
    IRNode disclosure;
    disclosure.type = "view";
    disclosure.stable_anchor_id = "disclosure-content";
    IRNode::ResponsiveConstraints disclosure_responsive;
    disclosure_responsive.visibility = {{.visible = false, .structural = true}};
    disclosure_responsive.application_state_key = "disclosure.open";
    disclosure_responsive.visibility_by_application_state = {
        {"closed", false}, {"open", true}};
    disclosure_responsive.application_state_when.push_back(
        {.key = "navigation.route", .value = "settings"});
    disclosure.responsive = disclosure_responsive;
    row_ir.root.children.push_back(std::move(disclosure));
    auto row = build_native_view_tree(row_ir, {}, {});
    REQUIRE(row);
    auto* row_root = row.get();
    outer->add_child(std::move(row));
    outer->layout_children();
    CHECK_FALSE(row_root->child_at(0)->visible());
    REQUIRE(apply_imported_application_state_transition(
        *row_root, "disclosure.open", "set:open"));
    CHECK(row_root->child_at(0)->visible());
}

TEST_CASE("ordered application state variants compose orthogonal runtime patches and round-trip",
          "[view][import][responsive][state-variants]") {
    DesignIR ir;
    ir.root.type = "view"; ir.root.stable_anchor_id = "root";
    IRNode panel; panel.type = "view"; panel.stable_anchor_id = "panel";
    IRNode::ResponsiveConstraints responsive;
    responsive.application_state_base.layout = {{"paddingLeft", "4px"}};
    responsive.application_state_base.layout["paddingRight"] = "2px";
    responsive.application_state_base.layout["width"] = "100px";
    responsive.application_state_base.paint = {{"backgroundColor", "#000000ff"}};
    IRNode::ResponsiveConstraints::ApplicationStateVariant spacing;
    spacing.key = "sidebar.open"; spacing.value = "open";
    spacing.layout = {{"paddingLeft", "12px"}, {"width", "200px"}};
    IRNode::ResponsiveConstraints::ApplicationStateVariant color;
    color.key = "theme"; color.value = "light"; color.layout = {{"paddingRight", "20px"}};
    color.paint = {{"backgroundColor", "#ffffffff"}};
    color.when = {{"navigation.route", "settings"}};
    responsive.application_state_variants = {spacing, color};
    IRNode::ResponsiveConstraints::LayoutVariant viewport;
    viewport.computed_style_literals = {{"paddingLeft", "6px"}};
    responsive.layout_variants = {viewport}; panel.responsive = responsive;
    ir.root.children.push_back(std::move(panel));

    const auto roundtrip = parse_design_ir_json(serialize_design_ir(ir, {.include_source_metadata = true}));
    REQUIRE(roundtrip.root.children[0].responsive);
    CHECK(roundtrip.root.children[0].responsive->application_state_variants.size() == 2);
    REQUIRE(roundtrip.root.children[0].responsive->application_state_variants[1].when.size() == 1);
    CHECK(roundtrip.root.children[0].responsive->application_state_variants[1].when[0].key == "navigation.route");
    auto root = build_native_view_tree(roundtrip, {}, {}); REQUIRE(root);
    root->set_bounds({0, 0, 600, 500});
    CHECK(root->child_at(0)->flex().padding_left == 6.0f);
    CHECK(root->child_at(0)->flex().preferred_width == 100.0f);
    CHECK(set_imported_application_state(*root, "sidebar.open", "open"));
    CHECK(root->child_at(0)->flex().padding_left == 12.0f);
    CHECK(root->child_at(0)->flex().preferred_width == 200.0f);
    CHECK(set_imported_application_state(*root, "theme", "dark"));
    CHECK(root->child_at(0)->flex().padding_left == 12.0f);
    CHECK(set_imported_application_state(*root, "sidebar.open", "closed"));
    CHECK(root->child_at(0)->flex().padding_left == 6.0f);
    CHECK(root->child_at(0)->flex().preferred_width == 100.0f);
    CHECK(set_imported_application_state(*root, "theme", "light"));
    CHECK(set_imported_application_state(*root, "navigation.route", "chat"));
    CHECK(root->child_at(0)->flex().padding_right == 2.0f);
    CHECK(set_imported_application_state(*root, "navigation.route", "settings"));
    CHECK(root->child_at(0)->flex().padding_right == 20.0f);
}

TEST_CASE("ordered application state variants reject conflicting active fields",
          "[view][import][responsive][state-variants]") {
    DesignIR ir; ir.root.type = "view"; ir.root.stable_anchor_id = "root";
    IRNode panel; panel.type = "view"; panel.stable_anchor_id = "panel";
    IRNode::ResponsiveConstraints responsive;
    responsive.application_state_base.layout = {{"paddingLeft", "4px"}};
    IRNode::ResponsiveConstraints::ApplicationStateVariant first;
    first.key = "a"; first.value = "on"; first.layout = {{"paddingLeft", "8px"}};
    IRNode::ResponsiveConstraints::ApplicationStateVariant second;
    second.key = "b"; second.value = "off"; second.layout = {{"paddingLeft", "8px"}};
    IRNode::ResponsiveConstraints::ApplicationStateVariant conflict = second;
    conflict.value = "on"; conflict.layout = {{"paddingLeft", "16px"}};
    responsive.application_state_variants = {first, second, conflict}; panel.responsive = responsive;
    ir.root.children.push_back(std::move(panel));
    auto root = build_native_view_tree(ir, {}, {}); REQUIRE(root);
    root->set_bounds({0, 0, 600, 500});
    CHECK_NOTHROW(set_imported_application_state(*root, "a", "on"));
    CHECK_NOTHROW(set_imported_application_state(*root, "b", "off"));
    CHECK_THROWS_WITH(set_imported_application_state(*root, "b", "on"),
                      Catch::Matchers::ContainsSubstring("conflicting active field layout.paddingLeft"));
}

TEST_CASE("application state dimensions outrank inferred responsive axes",
          "[view][import][responsive][state-variants]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::row;
    IRNode panel;
    panel.type = "view";
    panel.stable_anchor_id = "panel";
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = IRNode::ResponsiveAxis{
        .kind = "fixed", .value = 1.0f};
    IRNode::ResponsiveConstraints::ApplicationStateVariant closed;
    closed.key = "review.panel.open";
    closed.value = "closed";
    closed.layout = {{"width", "1"}};
    IRNode::ResponsiveConstraints::ApplicationStateVariant open;
    open.key = "review.panel.open";
    open.value = "open";
    open.layout = {{"width", "475"}};
    responsive.application_state_variants = {closed, open};
    panel.responsive = responsive;
    ir.root.children.push_back(std::move(panel));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    root->set_bounds({0, 0, 1200, 800});
    root->layout_children();
    CHECK(root->child_at(0)->bounds().width == 1.0f);
    REQUIRE(set_imported_application_state(*root, "review.panel.open", "open"));
    root->layout_children();
    CHECK(root->child_at(0)->bounds().width == 475.0f);
    REQUIRE(set_imported_application_state(*root, "review.panel.open", "closed"));
    root->layout_children();
    CHECK(root->child_at(0)->bounds().width == 1.0f);
    root->set_bounds({0, 0, 300, 800});
    REQUIRE(set_imported_application_state(*root, "review.panel.open", "open"));
    root->layout_children();
    CHECK(root->child_at(0)->bounds().width == 300.0f);
}

TEST_CASE("application state layout rebases from authored constraints on A B A",
          "[view][import][responsive][state-variants][geometry]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::row;

    IRNode panel;
    panel.type = "view";
    panel.stable_anchor_id = "panel";
    panel.style.width = 920.0f;
    panel.style.height = 600.0f;
    panel.layout.padding_left = 16.0f;
    IRNode::ResponsiveConstraints panel_responsive;
    panel_responsive.application_state_key = "sidebar.open";
    panel_responsive.application_state_default_value = "open";
    IRNode::ResponsiveConstraints::ApplicationStateVariant panel_closed;
    panel_closed.key = "sidebar.open";
    panel_closed.value = "closed";
    panel_closed.layout = {{"width", "1188px"}, {"paddingLeft", "160px"}};
    panel_responsive.application_state_variants = {panel_closed};
    panel.responsive = panel_responsive;

    IRNode conversation;
    conversation.type = "view";
    conversation.stable_anchor_id = "conversation";
    conversation.style.width = 400.0f;
    conversation.style.height = 300.0f;
    conversation.layout.margin_left = 16.0f;
    IRNode::ResponsiveConstraints conversation_responsive;
    IRNode::ResponsiveConstraints::ApplicationStateVariant conversation_closed;
    conversation_closed.key = "sidebar.open";
    conversation_closed.value = "closed";
    conversation_closed.layout = {{"marginLeft", "129.5px"},
                                  {"marginRight", "129.5px"}};
    conversation_responsive.application_state_variants = {conversation_closed};
    conversation.responsive = conversation_responsive;
    panel.children.push_back(std::move(conversation));
    ir.root.children.push_back(std::move(panel));

    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    root->set_bounds({0, 0, 1200, 800});
    root->layout_children();
    const auto panel_a = root->child_at(0)->bounds();
    const auto conversation_a = root->child_at(0)->child_at(0)->bounds();

    REQUIRE(set_imported_application_state(*root, "sidebar.open", "closed"));
    root->layout_children();
    CHECK(root->child_at(0)->bounds().width == 1188.0f);
    CHECK(root->child_at(0)->child_at(0)->flex().margin_left == 129.5f);

    REQUIRE(set_imported_application_state(*root, "sidebar.open", "open"));
    root->layout_children();
    const auto panel_a_again = root->child_at(0)->bounds();
    const auto conversation_a_again = root->child_at(0)->child_at(0)->bounds();
    CHECK(panel_a_again.x == panel_a.x);
    CHECK(panel_a_again.y == panel_a.y);
    CHECK(panel_a_again.width == panel_a.width);
    CHECK(panel_a_again.height == panel_a.height);
    CHECK(conversation_a_again.x == conversation_a.x);
    CHECK(conversation_a_again.y == conversation_a.y);
    CHECK(conversation_a_again.width == conversation_a.width);
    CHECK(conversation_a_again.height == conversation_a.height);
    CHECK(root->child_at(0)->child_at(0)->flex().margin_left == 16.0f);
    CHECK(root->child_at(0)->child_at(0)->flex().margin_right == -1.0f);
}

TEST_CASE("application state panel remains inside its row across reopen cycles",
          "[view][import][responsive][state-variants][geometry]") {
    DesignIR ir;
    ir.root.type = "view";
    ir.root.stable_anchor_id = "root";
    ir.root.layout.direction = LayoutDirection::row;

    IRNode content;
    content.type = "view";
    content.stable_anchor_id = "content";
    content.layout.width_mode = SizingMode::fill;
    content.style.height = 800.0f;
    IRNode::ResponsiveConstraints content_responsive;
    content_responsive.horizontal = {
        .kind = "fill", .offset = -1.0f};
    content.responsive = content_responsive;

    IRNode panel;
    panel.type = "view";
    panel.stable_anchor_id = "panel";
    panel.style.width = 1.0f;
    panel.style.height = 800.0f;
    IRNode::ResponsiveConstraints responsive;
    responsive.application_state_key = "review.panel.open";
    responsive.application_state_default_value = "closed";
    IRNode::ResponsiveConstraints::ApplicationStateVariant open;
    open.key = "review.panel.open";
    open.value = "open";
    open.layout = {{"width", "475px"}};
    responsive.application_state_variants = {open};
    panel.responsive = responsive;

    ir.root.children.push_back(std::move(content));
    ir.root.children.push_back(std::move(panel));
    auto root = build_native_view_tree(ir, {}, {});
    REQUIRE(root);
    root->set_bounds({0, 0, 1200, 800});
    root->layout_children();
    CHECK(root->child_at(0)->bounds().width == 1199.0f);
    CHECK(root->child_at(1)->bounds().width == 1.0f);

    const auto assert_open_panel_is_contained = [&] {
        const auto bounds = root->child_at(1)->bounds();
        CHECK(bounds.width == 475.0f);
        CHECK(bounds.x >= 0.0f);
        CHECK(bounds.x + bounds.width <= root->bounds().width);
        CHECK(root->child_at(0)->bounds().width == 725.0f);
    };
    REQUIRE(set_imported_application_state(*root, "review.panel.open", "open"));
    root->layout_children();
    assert_open_panel_is_contained();
    REQUIRE(set_imported_application_state(*root, "review.panel.open", "closed"));
    root->layout_children();
    CHECK(root->child_at(1)->bounds().width == 1.0f);
    REQUIRE(set_imported_application_state(*root, "review.panel.open", "open"));
    root->layout_children();
    assert_open_panel_is_contained();
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
        CHECK(content_view->flex().dim_width.resolve(width, width, 800.0f) == width - 24.0f);
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
    CHECK(replacement_ptr->flex().dim_width.resolve(600.0f, 600.0f, 800.0f) == 580.0f);
    root->set_bounds({0, 0, 599, 800});
    root->layout_children();
    CHECK(replacement_ptr->flex().dim_width.resolve(599.0f, 599.0f, 800.0f) == 579.0f);
}
