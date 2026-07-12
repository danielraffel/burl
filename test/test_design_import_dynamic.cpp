#include <catch2/catch_test_macros.hpp>
#include <pulp/view/design_import_dynamic.hpp>
#include <pulp/view/accessibility_tree.hpp>
#include <pulp/view/buttons.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/widgets.hpp>

#include <cstdlib>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <functional>
#include <unordered_map>
#include <unordered_set>

using namespace pulp::view;

namespace {
class CollectionBindingContext final : public NativeImportBindingContext {
public:
    void bind_imported_collection(View& host,
                                  const NativeImportCollectionDescriptor& descriptor) override {
        ++calls;
        bound_host = &host;
        key = descriptor.collection_key;
    }
    int calls = 0;
    View* bound_host = nullptr;
    std::string key;
};
class PayloadBindingContext final : public NativeImportBindingContext {
public:
    void bind_host_action(TextButton&, const NativeImportHostActionDescriptor& descriptor) override {
        payload = descriptor.payload_contract;
        ++calls;
    }
    void unbind_imported_view(View& view) override {
        if (dynamic_cast<TextButton*>(&view)) ++unbind_calls;
    }
    int calls = 0;
    int unbind_calls = 0;
    std::string payload;
};
}

TEST_CASE("native binding routes a source-anchored collection host generically") {
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.name = "transcript";
    ir.root.stable_anchor_id = "source:transcript";
    ir.root.attributes["pulpRouteId"] = "chat.transcript";
    ir.root.attributes["pulpCollectionKey"] = "messages";
    auto root = build_native_view_tree(ir, {});
    REQUIRE(root);
    CollectionBindingContext context;
    bind_native_view_tree(*root, ir, context);
    REQUIRE(context.calls == 1);
    REQUIRE(context.bound_host == root.get());
    REQUIRE(context.key == "messages");
}

TEST_CASE("collection template extraction removes inherited structural visibility") {
    IRNode root;
    IRNode::ResponsiveConstraints inherited;
    inherited.visibility = {
        {.visible = false, .structural = true,
         .transition_to_next = IRNode::ResponsiveBreakpoint{767.0f, 768.0f, "measured"}},
        {.visible = true, .structural = false},
    };
    root.responsive = inherited;
    IRNode row;
    row.attributes["pulpCollectionTemplate"] = "project";
    row.attributes["pulpHostAction"] = "project.open";
    row.responsive = inherited;
    IRNode independent;
    independent.attributes["pulpValueKey"] = "project.name";
    IRNode::ResponsiveConstraints independent_constraints;
    independent_constraints.visibility = {{.visible = true, .structural = false}};
    independent.responsive = independent_constraints;
    row.children.push_back(independent);
    root.children.push_back(row);

    const auto templates = extract_imported_collection_templates(root);
    REQUIRE(templates.contains("project"));
    REQUIRE(templates.at("project").responsive.has_value());
    REQUIRE(templates.at("project").responsive->visibility.empty());
    REQUIRE(templates.at("project").children.size() == 1);
    REQUIRE(templates.at("project").children.front().responsive->visibility.size() == 1);
}

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

TEST_CASE("collection templates retain static control chrome around bound fields") {
    IRNode root;
    root.type = "frame";
    IRNode row;
    row.type = "frame";
    row.attributes["pulpCollectionTemplate"] = "tool";
    row.layout.width_mode = SizingMode::fill;
    row.layout.height_mode = SizingMode::hug;

    IRNode trigger;
    trigger.type = "button";
    trigger.layout.direction = LayoutDirection::row;
    trigger.layout.height_mode = SizingMode::hug;
    IRNode icon;
    icon.type = "svg_rect";
    icon.stable_anchor_id = "captured-tool-icon";
    icon.style.width = 12.0f;
    icon.style.height = 12.0f;
    trigger.children.push_back(icon);
    for (const auto& [key, sample] : {
             std::pair{"tool.label", "Read"},
             std::pair{"tool.subject", "components/settings.tsx"},
             std::pair{"tool.duration", "3s"},
         }) {
        IRNode field;
        field.type = "text";
        field.text_content = sample;
        field.style.font_size = 13.0f;
        field.style.line_height = 16.0f;
        field.layout.height_mode = SizingMode::hug;
        field.attributes["pulpValueKey"] = key;
        trigger.children.push_back(std::move(field));
    }
    row.children.push_back(std::move(trigger));
    IRNode unrelated_sample;
    unrelated_sample.type = "text";
    unrelated_sample.text_content = "unrelated captured row";
    row.children.push_back(std::move(unrelated_sample));
    root.children.push_back(std::move(row));

    const auto templates = extract_imported_collection_templates(root);
    REQUIRE(templates.contains("tool"));
    const auto& extracted = templates.at("tool");
    REQUIRE(extracted.children.size() == 1);
    REQUIRE(extracted.children.front().type == "button");
    REQUIRE(extracted.children.front().children.size() == 4);
    REQUIRE(extracted.children.front().children.front().stable_anchor_id == "captured-tool-icon");

    ImportedRepeatedList list({{"tool", extracted}}, {});
    list.set_bounds({0, 0, 600, 120});
    list.set_items({{"part-1", "tool", {{"tool.label", "Edit"},
                                           {"tool.subject", "lib/theme.ts"},
                                           {"tool.duration", "running"}}}});
    list.layout_children();
    REQUIRE(list.materialization_count() == 1);
    list.set_items({{"part-1", "tool", {{"tool.label", "Edit"},
                                           {"tool.subject", "lib/theme.ts"},
                                           {"tool.duration", "4s"}}}});
    list.layout_children();
    REQUIRE(list.items().size() == 1);
    REQUIRE(list.materialization_count() == 2);

    pulp::canvas::RecordingCanvas canvas;
    list.paint_all(canvas);
    std::unordered_set<std::string> painted;
    for (const auto& command : canvas.commands())
        if (command.type == pulp::canvas::DrawCommand::Type::fill_text)
            painted.insert(command.text);
    REQUIRE(painted.contains("Edit"));
    REQUIRE(painted.contains("lib/theme.ts"));
    REQUIRE(painted.contains("4s"));
    REQUIRE_FALSE(painted.contains("unrelated captured row"));
}

TEST_CASE("imported collection action resolves a provenance-backed item payload") {
    IRNode row;
    row.type = "button";
    row.stable_anchor_id = "project-row";
    row.attributes["pulpRouteId"] = "project.open";
    row.attributes["pulpHostAction"] = "project.open";
    row.attributes["pulpPayloadSource"] = "collection-item-field";
    row.attributes["pulpPayloadField"] = "directory";
    row.attributes["pulpPayloadSchema"] = "directory";
    row.attributes["pulpPayloadProvenance"] = "trace://project.open/directory";
    PayloadBindingContext context;
    ImportedRepeatedList list({{"project", row}}, {}, &context);
    list.set_bounds({0, 0, 300, 100});
    list.set_items({{"p1", "project", {{"directory", "/tmp/project"}}}});
    list.layout_children();
    REQUIRE(context.calls == 1);
    REQUIRE(context.payload == "/tmp/project");
    list.set_items({{"p1", "project", {{"directory", "/tmp/project-two"}}}});
    list.layout_children();
    REQUIRE(context.calls == 2);
    REQUIRE(context.unbind_calls == 1);
}

TEST_CASE("imported repeated list measurement excludes collapsed descendants") {
    IRNode row;
    row.type = "button";
    row.stable_anchor_id = "expandable-row";
    row.style.height = 32.0f;
    row.layout.height_mode = SizingMode::fixed;
    row.attributes["pulpHostAction"] = "row.open";

    IRNode collapsed;
    collapsed.type = "frame";
    collapsed.stable_anchor_id = "collapsed-content";
    collapsed.style.height = 500.0f;
    collapsed.layout.height_mode = SizingMode::fixed;
    IRNode::ResponsiveConstraints responsive;
    responsive.visibility = {{.visible = false, .structural = false}};
    collapsed.responsive = responsive;
    row.children.push_back(std::move(collapsed));

    ImportedRepeatedList list({{"row", row}}, {});
    list.set_bounds({0, 0, 280, 200});
    list.set_items({{"a", "row", {}}, {"b", "row", {}}, {"c", "row", {}}});
    list.layout_children();
    REQUIRE(list.content_height() >= 96.0f);
    REQUIRE(list.content_height() < 150.0f);
}

TEST_CASE("imported repeated list mutation after initial layout is immediately paint ready") {
    IRNode row;
    row.type = "text";
    row.text_content = "placeholder";
    row.style.font_size = 15.0f;
    row.style.color = "#FFFFFFFF";
    row.attributes["pulpValueKey"] = "label";
    ImportedRepeatedList list({{"item", row}}, {});
    list.set_bounds({0, 0, 280, 120});
    list.layout_children();
    list.set_items({{"a", "item", {{"label", "alpha"}}},
                    {"b", "item", {{"label", "beta"}}},
                    {"c", "item", {{"label", "gamma"}}}});
    pulp::canvas::RecordingCanvas canvas;
    list.paint_all(canvas);
    std::unordered_set<std::string> painted;
    for (const auto& command : canvas.commands())
        if (command.type == pulp::canvas::DrawCommand::Type::fill_text)
            painted.insert(command.text);
    REQUIRE(painted.contains("alpha"));
    REQUIRE(painted.contains("beta"));
    REQUIRE(painted.contains("gamma"));
}

TEST_CASE("dynamic inline text measures each replacement value") {
    IRNode row;
    row.type = "button";
    row.style.width = 264.0f;
    row.style.height = 32.0f;
    row.layout.width_mode = SizingMode::fixed;
    row.layout.direction = LayoutDirection::row;
    row.layout.align = LayoutAlign::center;
    row.layout.gap = 8.0f;
    row.layout.padding_left = 8.0f;
    row.layout.padding_right = 8.0f;
    IRNode label;
    label.type = "text";
    label.text_content = "palot";
    label.style.width = 35.0f;
    label.style.font_size = 15.0f;
    label.style.white_space = "nowrap";
    label.style.text_overflow = "ellipsis";
    label.layout.overflow_x = "hidden";
    label.layout.width_mode = SizingMode::fixed;
    label.layout.flex_shrink = 1.0f;
    IRNode::ResponsiveConstraints responsive;
    responsive.horizontal = IRNode::ResponsiveAxis{.kind = "fixed", .value = 35.0f};
    label.responsive = responsive;
    label.attributes["pulpValueKey"] = "project.name";
    row.children.push_back(label);

    ImportedRepeatedList list({{"project", row}}, {});
    list.set_bounds({0, 0, 280, 120});
    list.set_items({{"p1", "project", {{"project.name", "palot"}}},
                    {"p2", "project", {{"project.name", "acme-api"}}},
                    {"p3", "project", {{"project.name", "landing-page"}}}});
    list.layout_children();

    std::unordered_map<std::string, float> label_widths;
    std::function<void(View&)> collect_labels = [&](View& view) {
        if (auto* dynamic_label = dynamic_cast<Label*>(&view))
            label_widths[dynamic_label->text()] = dynamic_label->bounds().width;
        for (std::size_t index = 0; index < view.child_count(); ++index)
            collect_labels(*view.child_at(index));
    };
    collect_labels(list);
    CHECK(label_widths.contains("palot"));
    CHECK(label_widths.at("acme-api") > 35.0f);
    CHECK(label_widths.at("landing-page") > 35.0f);

    pulp::canvas::RecordingCanvas canvas;
    list.paint_all(canvas);
    std::unordered_set<std::string> painted;
    for (const auto& command : canvas.commands())
        if (command.type == pulp::canvas::DrawCommand::Type::fill_text)
            painted.insert(command.text);
    CHECK(painted.contains("acme-api"));
    CHECK(painted.contains("landing-page"));
}

TEST_CASE("imported repeated lists do not invent persistent scrollbar chrome") {
    IRNode row;
    row.type = "text";
    row.text_content = "source";
    row.style.height = 32.0f;
    row.layout.height_mode = SizingMode::fixed;
    row.attributes["pulpValueKey"] = "label";
    ImportedRepeatedList list({{"item", row}}, {});
    list.set_bounds({0, 0, 120, 40});
    list.set_items({{"a", "item", {{"label", "alpha"}}},
                    {"b", "item", {{"label", "beta"}}},
                    {"c", "item", {{"label", "gamma"}}}});
    list.layout_children();
    REQUIRE(list.content_height() > list.bounds().height);
    pulp::canvas::RecordingCanvas canvas;
    list.paint_all(canvas);
    REQUIRE(std::ranges::none_of(canvas.commands(), [](const auto& command) {
        return command.type == pulp::canvas::DrawCommand::Type::fill_rounded_rect;
    }));
}

TEST_CASE("dynamic repeated-list labels remeasure bound text before ellipsis") {
    IRNode row;
    row.type = "button";
    row.style.height = 32.0f;
    row.layout.height_mode = SizingMode::fixed;
    row.layout.width_mode = SizingMode::fill;
    row.attributes["pulpHostAction"] = "open";
    IRNode label;
    label.type = "text";
    label.text_content = "sample";
    label.style.font_size = 15.0f;
    label.style.font_weight = 500;
    label.style.white_space = "nowrap";
    label.style.text_overflow = "ellipsis";
    label.style.width = 35.3516f;
    label.layout.width_mode = SizingMode::fixed;
    label.attributes["pulpValueKey"] = "name";
    row.children.push_back(std::move(label));
    ImportedRepeatedList list({{"item", row}}, {});
    list.set_bounds({0, 0, 212, 104});
    list.set_items({{"a", "item", {{"name", "palot"}}},
                    {"b", "item", {{"name", "acme-api"}}},
                    {"c", "item", {{"name", "landing-page"}}}});
    list.layout_children();
    pulp::canvas::RecordingCanvas canvas;
    list.paint_all(canvas);
    std::unordered_set<std::string> painted;
    for (const auto& command : canvas.commands())
        if (command.type == pulp::canvas::DrawCommand::Type::fill_text) painted.insert(command.text);
    REQUIRE(painted.contains("palot"));
    REQUIRE(painted.contains("acme-api"));
    REQUIRE(painted.contains("landing-page"));
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

TEST_CASE("imported repeated list preserves captured row height as a dynamic minimum") {
    IRNode row;
    row.type = "frame";
    row.style.height = 68.0f;
    IRNode text;
    text.type = "text";
    text.attributes["pulpValueKey"] = "message.text";
    text.style.font_size = 15.0f;
    row.children.push_back(text);
    ImportedRepeatedList list({{"user", row}}, {});
    list.set_bounds({0, 0, 400, 160});
    list.set_items({{"u1", "user", {{"message.text", "short"}}}});
    REQUIRE(list.content_height() >= 68.0f);
}

TEST_CASE("imported repeated list defers measurement until layout supplies width") {
    IRNode row;
    row.type = "frame";
    IRNode text;
    text.type = "text";
    text.attributes["pulpValueKey"] = "message.markdown";
    text.attributes["pulpValueKind"] = "markdown";
    row.children.push_back(text);
    const std::string markdown = "**Created** a source-faithful row with enough text to wrap at narrow widths.";
    ImportedRepeatedList list({{"assistant", row}}, {});
    list.set_items({{"m1", "assistant", {{"message.markdown", markdown}}}});
    list.set_bounds({0, 0, 700, 300});
    list.layout_children();
    ImportedMarkdownRow direct(markdown, {});
    REQUIRE(std::abs(list.content_height() - direct.measured_height(700.0f)) < 1.1f);
}

TEST_CASE("dynamic Markdown row does not retain discarded template height") {
    IRNode row;
    row.type = "frame";
    row.style.height = 380.0f;
    IRNode text;
    text.type = "text";
    text.attributes["pulpValueKey"] = "message.markdown";
    text.attributes["pulpValueKind"] = "markdown";
    row.children.push_back(text);
    ImportedRepeatedList list({{"assistant", row}}, {});
    list.set_bounds({0, 0, 700, 500});
    list.set_items({{"m1", "assistant", {{"message.markdown", "A short response."}}}});
    ImportedMarkdownRow direct("A short response.", {});
    CHECK(std::abs(list.content_height() - direct.measured_height(700.0f)) < 1.0f);
    CHECK(list.content_height() < 380.0f);
}

TEST_CASE("imported repeated list remeasures on layout-only width changes") {
    IRNode row;
    row.type = "frame";
    IRNode text;
    text.type = "text";
    text.attributes["pulpValueKey"] = "message.markdown";
    text.attributes["pulpValueKind"] = "markdown";
    row.children.push_back(text);
    ImportedRepeatedList list({{"assistant", row}}, {});
    list.set_items({{"m1", "assistant", {{"message.markdown",
        "A long source row that wraps repeatedly at a narrow width but not at a wide width."}}}});
    list.set_bounds({0, 0, 80, 300});
    list.layout_children();
    const auto narrow = list.content_height();
    list.set_bounds({0, 0, 700, 300});
    list.layout_children();
    REQUIRE(list.content_height() < narrow);
}

TEST_CASE("actionable dynamic view paints one bound value target") {
    IRNode row;
    row.type = "view";
    row.attributes["pulpHostAction"] = "project.open";
    row.attributes["pulpValueKey"] = "project.name";
    row.style.height = 32.0f;
    row.layout.height_mode = SizingMode::fixed;
    row.layout.width_mode = SizingMode::fill;
    ImportedRepeatedList list({{"project", row}}, {});
    list.set_items({{"p1", "project", {{"project.name", "acme-api"}}}});
    list.set_bounds({0, 0, 240, 60});
    list.layout_children();
    const auto nodes = snapshot_accessibility_tree(list);
    REQUIRE(std::ranges::count_if(nodes, [](const auto& node) {
        return node.label.find("acme-api") != std::string::npos ||
               node.value.find("acme-api") != std::string::npos;
    }) == 1);
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

TEST_CASE("imported repeated list preserves keyed scroll anchor across width reflow") {
    IRNode row;
    row.type = "frame";
    IRNode text;
    text.type = "text";
    text.attributes["pulpValueKey"] = "message.markdown";
    text.attributes["pulpValueKind"] = "markdown";
    row.children.push_back(text);
    ImportedRepeatedList list({{"message", row}}, {});
    list.set_bounds({0, 0, 140, 60});
    list.set_items({{"a", "message", {{"message.markdown", "alpha alpha alpha alpha alpha"}}},
                    {"b", "message", {{"message.markdown", "bravo bravo bravo bravo bravo"}}},
                    {"c", "message", {{"message.markdown", "charlie charlie charlie"}}}});
    list.layout_children();
    list.set_auto_follow(false);
    list.set_scroll_y(list.content_height() * 0.45f);
    list.set_bounds({0, 0, 360, 60});
    list.layout_children();
    REQUIRE(list.scroll_y() > 0.0f);
    REQUIRE(list.scroll_y() < list.content_height());
}

TEST_CASE("parent Yoga layout invokes imported repeated list custom layout") {
    IRNode row;
    row.type = "frame";
    IRNode text;
    text.type = "text";
    text.style.white_space = "normal";
    text.layout.width_mode = SizingMode::fill;
    text.layout.height_mode = SizingMode::hug;
    text.attributes["pulpValueKey"] = "message.text";
    row.children.push_back(text);

    View parent;
    parent.set_bounds({0, 0, 420, 180});
    auto list = std::make_unique<ImportedRepeatedList>(
        std::unordered_map<std::string, IRNode>{{"message", row}}, IRAssetManifest{});
    auto* list_ptr = list.get();
    list_ptr->flex().flex_grow = 1.0f;
    parent.add_child(std::move(list));
    list_ptr->set_items({{"one", "message", {{"message.text", "visible row"}}}});
    parent.layout_children();

    REQUIRE(list_ptr->bounds().width > 0.0f);
    REQUIRE(list_ptr->bounds().height > 0.0f);
    REQUIRE(list_ptr->materialization_count() == 1);
}

TEST_CASE("imported markdown row measures, reflows, selects, and exposes plain accessibility text") {
    ImportedMarkdownSkin skin;
    skin.font_size = 15.0f;
    skin.padding_top = skin.padding_bottom = 12.0f;
    skin.padding_left = skin.padding_right = 16.0f;
    skin.border_radius = 12.0f;
    ImportedMarkdownRow row(
        "**Created `src/lib/theme.ts`** with a long explanation that wraps at narrow widths.\n\n"
        "- preserves **bold** text\n- preserves `inline code`", skin);

    const auto narrow = row.measured_height(260.0f);
    const auto wide = row.measured_height(720.0f);
    REQUIRE(narrow > 0.0f);
    REQUIRE(wide > 0.0f);
    REQUIRE(narrow >= wide);
    REQUIRE(narrow < 100000.0f);
    REQUIRE(row.markdown_view().get_text().find("**") == std::string::npos);
    REQUIRE(row.markdown_view().get_text().find("src/lib/theme.ts") != std::string::npos);
    bool saw_inline_code = false;
    for (const auto& block : row.markdown_view().document().blocks()) {
        for (const auto& span : block.attributed_text.spans()) {
            REQUIRE(span.text.find('`') == std::string::npos);
            if (span.kind == pulp::canvas::TextSpanKind::inline_code) saw_inline_code = true;
        }
    }
    REQUIRE(saw_inline_code);
    row.markdown_view().set_selection(0, 7);
    REQUIRE(row.markdown_view().get_selection() == std::pair{0, 7});

    if (const auto* proof_dir = std::getenv("BURL_MARKDOWN_PROOF_DIR")) {
        std::filesystem::create_directories(proof_dir);
        for (const auto [name, width] : {std::pair{"narrow", 260}, std::pair{"wide", 720}}) {
            row.set_bounds({0, 0, static_cast<float>(width), row.measured_height(static_cast<float>(width))});
            row.layout_children();
            const auto png = render_to_png(row, width, static_cast<int>(row.intrinsic_height()), 2.0f,
                                           ScreenshotBackend::skia);
            std::ofstream out(std::filesystem::path(proof_dir) / (std::string(name) + ".png"),
                              std::ios::binary);
            out.write(reinterpret_cast<const char*>(png.data()), static_cast<std::streamsize>(png.size()));
        }
    }
}

TEST_CASE("frame update coalescer bounds chunk work to display cadence") {
    FrameUpdateCoalescer coalescer;
    std::size_t scheduled = 0;
    for (int chunk = 0; chunk < 1000; ++chunk)
        if (coalescer.request()) ++scheduled;
    REQUIRE(scheduled == 1);
    REQUIRE(coalescer.request_count() == 1000);
    REQUIRE(coalescer.flush());
    REQUIRE(coalescer.flush_count() == 1);

    for (int frame = 0; frame < 120; ++frame) {
        for (int chunk = 0; chunk < 20; ++chunk) coalescer.request();
        REQUIRE(coalescer.flush());
    }
    REQUIRE(coalescer.flush_count() == 121);
    REQUIRE(coalescer.request_count() == 3400);
}
