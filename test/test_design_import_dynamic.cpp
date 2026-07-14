#include <catch2/catch_test_macros.hpp>
#include <catch2/catch_approx.hpp>
#include <pulp/view/design_import_dynamic.hpp>
#include <pulp/view/accessibility_tree.hpp>
#include <pulp/view/buttons.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/text_overflow.hpp>
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
class MountingCollectionBindingContext final : public NativeImportBindingContext {
public:
    void bind_imported_collection(View& host,
                                  const NativeImportCollectionDescriptor& descriptor) override {
        bound_host = &host;
        items_parent = descriptor.items_parent;
        template_count = descriptor.template_items.size();
        auto replacement = std::make_unique<View>();
        replacement->set_id("live-collection");
        mounted = mount_imported_collection_items(descriptor, std::move(replacement));
    }
    View* bound_host = nullptr;
    View* items_parent = nullptr;
    View* mounted = nullptr;
    std::size_t template_count = 0;
};
class PayloadBindingContext final : public NativeImportBindingContext {
public:
    void bind_host_action(TextButton&, const NativeImportHostActionDescriptor& descriptor) override {
        action = descriptor.action;
        payload = descriptor.payload_contract;
        ++calls;
    }
    void unbind_imported_view(View& view) override {
        if (dynamic_cast<TextButton*>(&view)) ++unbind_calls;
    }
    int calls = 0;
    int unbind_calls = 0;
    std::string action;
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

TEST_CASE("imported collection mounts at the repeated-item parent and preserves static chrome") {
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "collection-host";
    ir.root.attributes["pulpRouteId"] = "chat.transcript";
    ir.root.attributes["pulpCollectionKey"] = "messages";

    IRNode header;
    header.type = "text";
    header.text_content = "Static header";
    header.stable_anchor_id = "static-header";
    ir.root.children.push_back(header);

    IRNode shell;
    shell.type = "frame";
    shell.stable_anchor_id = "items-shell";
    shell.layout.padding_left = 16.0f;
    shell.layout.padding_right = 16.0f;

    IRNode leading_fade;
    leading_fade.type = "frame";
    leading_fade.stable_anchor_id = "leading-fade";
    shell.children.push_back(leading_fade);
    for (const auto* id : {"assistant", "user"}) {
        IRNode sample;
        sample.type = "frame";
        sample.stable_anchor_id = std::string("sample-") + id;
        sample.attributes["pulpCollectionTemplate"] = id;
        shell.children.push_back(std::move(sample));
    }
    IRNode trailing_fade;
    trailing_fade.type = "frame";
    trailing_fade.stable_anchor_id = "trailing-fade";
    shell.children.push_back(trailing_fade);
    ir.root.children.push_back(shell);

    auto root = build_native_view_tree(ir, {});
    REQUIRE(root);
    MountingCollectionBindingContext context;
    bind_native_view_tree(*root, ir, context);

    REQUIRE(context.bound_host == root.get());
    REQUIRE(context.items_parent != nullptr);
    REQUIRE(context.items_parent->anchor_id() == "items-shell");
    REQUIRE(context.template_count == 2);
    REQUIRE(context.mounted != nullptr);
    REQUIRE(root->child_count() == 2);
    REQUIRE(root->child_at(0)->anchor_id() == "static-header");
    REQUIRE(context.items_parent->flex().padding_left == 16.0f);
    REQUIRE(context.items_parent->child_count() == 3);
    REQUIRE(context.items_parent->child_at(0)->anchor_id() == "leading-fade");
    REQUIRE(context.items_parent->child_at(1) == context.mounted);
    REQUIRE(context.items_parent->child_at(2)->anchor_id() == "trailing-fade");
}

TEST_CASE("imported virtual collection fills its captured vertical scrollport") {
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "scrollport";
    ir.root.layout.height_mode = SizingMode::fill;
    ir.root.layout.overflow_y = "auto";

    IRNode host;
    host.type = "frame";
    host.stable_anchor_id = "collection-host";
    host.attributes["pulpRouteId"] = "chat.transcript";
    host.attributes["pulpCollectionKey"] = "messages";
    host.layout.padding_top = 24.0f;
    host.layout.padding_bottom = 24.0f;
    IRNode sample;
    sample.type = "frame";
    sample.stable_anchor_id = "sample-message";
    sample.attributes["pulpCollectionSampleRoot"] = "true";
    sample.attributes["pulpCollectionTemplate"] = "message";
    host.children.push_back(std::move(sample));
    ir.root.children.push_back(std::move(host));

    auto root = build_native_view_tree(ir, {});
    REQUIRE(root);
    root->set_bounds({0, 0, 640, 420});
    MountingCollectionBindingContext context;
    bind_native_view_tree(*root, ir, context);
    REQUIRE(context.items_parent != nullptr);
    REQUIRE(context.mounted != nullptr);
    root->layout_children();

    CHECK(context.items_parent->flex().flex_grow == 1.0f);
    CHECK(context.mounted->flex().flex_grow == 1.0f);
    CHECK(context.items_parent->bounds().height == 420.0f);
    CHECK(context.mounted->bounds().height == 372.0f);
}

TEST_CASE("nested collection variants replace their composite sample at the common parent") {
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "collection-host";
    ir.root.attributes["pulpRouteId"] = "chat.transcript";
    ir.root.attributes["pulpCollectionKey"] = "messages";

    IRNode shell;
    shell.type = "frame";
    shell.stable_anchor_id = "max-width-shell";
    shell.layout.padding_left = 16.0f;
    IRNode fade;
    fade.type = "frame";
    fade.stable_anchor_id = "scroll-fade";
    shell.children.push_back(fade);

    IRNode sample_turn;
    sample_turn.type = "frame";
    sample_turn.stable_anchor_id = "sample-turn";
    IRNode user;
    user.type = "frame";
    user.stable_anchor_id = "sample-user";
    user.attributes["pulpCollectionTemplate"] = "user";
    sample_turn.children.push_back(user);
    IRNode assistant;
    assistant.type = "frame";
    assistant.stable_anchor_id = "sample-assistant-shell";
    IRNode answer;
    answer.type = "frame";
    answer.stable_anchor_id = "sample-assistant";
    answer.attributes["pulpCollectionTemplate"] = "assistant";
    assistant.children.push_back(answer);
    IRNode tool;
    tool.type = "frame";
    tool.stable_anchor_id = "sample-tool";
    tool.attributes["pulpCollectionTemplate"] = "tool";
    assistant.children.push_back(tool);
    sample_turn.children.push_back(assistant);
    shell.children.push_back(sample_turn);
    ir.root.children.push_back(shell);

    auto root = build_native_view_tree(ir, {});
    REQUIRE(root);
    MountingCollectionBindingContext context;
    bind_native_view_tree(*root, ir, context);

    REQUIRE(context.items_parent != nullptr);
    REQUIRE(context.items_parent->anchor_id() == "max-width-shell");
    REQUIRE(context.template_count == 1);
    REQUIRE(context.items_parent->child_count() == 2);
    REQUIRE(context.items_parent->child_at(0)->anchor_id() == "scroll-fade");
    REQUIRE(context.items_parent->child_at(1) == context.mounted);
}

TEST_CASE("explicit collection sample range replaces unmarked sibling exemplars") {
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "collection-slot";
    ir.root.attributes["pulpRouteId"] = "app.projects";
    ir.root.attributes["pulpCollectionKey"] = "projects";
    for (int index = 0; index < 3; ++index) {
        IRNode sample;
        sample.type = "frame";
        sample.stable_anchor_id = "project-sample-" + std::to_string(index);
        sample.attributes["pulpCollectionSampleRoot"] = "true";
        if (index == 0) sample.attributes["pulpCollectionTemplate"] = "project";
        ir.root.children.push_back(std::move(sample));
    }

    auto root = build_native_view_tree(ir, {});
    REQUIRE(root);
    MountingCollectionBindingContext context;
    bind_native_view_tree(*root, ir, context);

    REQUIRE(context.items_parent == root.get());
    REQUIRE(context.template_count == 3);
    REQUIRE(root->child_count() == 1);
    REQUIRE(root->child_at(0) == context.mounted);
}

TEST_CASE("collection binding falls back to its routed host when template parents are ambiguous") {
    DesignIR ir;
    ir.root.type = "frame";
    ir.root.stable_anchor_id = "collection-host";
    ir.root.attributes["pulpRouteId"] = "chat.transcript";
    ir.root.attributes["pulpCollectionKey"] = "messages";
    for (const auto* parent_id : {"left-shell", "right-shell"}) {
        IRNode shell;
        shell.type = "frame";
        shell.stable_anchor_id = parent_id;
        IRNode sample;
        sample.type = "frame";
        sample.stable_anchor_id = std::string(parent_id) + "-sample";
        sample.attributes["pulpCollectionTemplate"] = parent_id;
        shell.children.push_back(std::move(sample));
        ir.root.children.push_back(std::move(shell));
    }

    auto root = build_native_view_tree(ir, {});
    REQUIRE(root);
    CollectionBindingContext context;
    std::vector<ImportDiagnostic> diagnostics;
    bind_native_view_tree(*root, ir, context, {.diagnostics_out = &diagnostics});
    REQUIRE(context.calls == 1);
    REQUIRE(context.bound_host == root.get());
    REQUIRE(std::ranges::any_of(diagnostics, [](const auto& diagnostic) {
        return diagnostic.code == "native-collection-mount-unresolved";
    }));
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

TEST_CASE("collection template extraction preserves flattened wrapper spacing and width context") {
    IRNode root;
    root.type = "frame";
    IRNode sample;
    sample.type = "frame";
    sample.attributes["pulpCollectionSampleRoot"] = "true";
    sample.layout.padding_left = 12.0f;
    sample.layout.padding_right = 8.0f;

    IRNode response;
    response.type = "frame";
    response.layout.margin_top = 16.0f;
    response.layout.margin_left = 20.0f;
    response.style.max_width_dimension = "95%";
    response.layout.align_self = "center";

    IRNode composite;
    composite.type = "frame";
    composite.attributes["pulpCollectionTemplate"] = "assistant";
    IRNode reasoning;
    reasoning.type = "frame";
    reasoning.attributes["pulpCollectionTemplate"] = "reasoning";
    IRNode text;
    text.type = "text";
    text.attributes["pulpValueKey"] = "reasoning.text";
    reasoning.children.push_back(text);
    composite.children.push_back(reasoning);
    response.children.push_back(composite);
    sample.children.push_back(response);
    root.children.push_back(sample);

    const auto templates = extract_imported_collection_templates(root);
    REQUIRE(templates.contains("assistant"));
    REQUIRE(templates.contains("reasoning"));
    REQUIRE_FALSE(templates.at("assistant").layout.margin_top.has_value());
    const auto& extracted = templates.at("reasoning");
    REQUIRE(extracted.layout.margin_top == 16.0f);
    REQUIRE(extracted.layout.margin_left == 32.0f);
    REQUIRE(extracted.layout.margin_right == 8.0f);
    REQUIRE(extracted.style.max_width_dimension == "95%");
    REQUIRE(extracted.layout.align_self == "center");
}

TEST_CASE("direct sample-root templates do not inherit collection-container geometry") {
    IRNode root;
    root.layout.padding_left = 24.0f;
    root.layout.margin_top = 30.0f;
    IRNode row;
    row.attributes["pulpCollectionSampleRoot"] = "true";
    row.attributes["pulpCollectionTemplate"] = "row";
    row.layout.margin_top = 4.0f;
    IRNode value;
    value.type = "text";
    value.attributes["pulpValueKey"] = "row.label";
    row.children.push_back(value);
    root.children.push_back(row);

    const auto templates = extract_imported_collection_templates(root);
    REQUIRE(templates.at("row").layout.margin_top == 4.0f);
    REQUIRE_FALSE(templates.at("row").layout.margin_left.has_value());
}

TEST_CASE("parent collection templates exclude nested template-owned sample branches") {
    IRNode root;
    IRNode assistant;
    assistant.type = "frame";
    assistant.attributes["pulpCollectionTemplate"] = "assistant";
    IRNode markdown;
    markdown.type = "text";
    markdown.attributes["pulpValueKey"] = "message.markdown";
    markdown.attributes["pulpValueKind"] = "markdown";
    IRNode copy;
    copy.type = "button";
    copy.text_content = "Copy";
    copy.attributes["pulpHostAction"] = "message.copy";
    IRNode reasoning;
    reasoning.type = "frame";
    reasoning.attributes["pulpCollectionTemplate"] = "reasoning";
    IRNode reasoning_text;
    reasoning_text.type = "text";
    reasoning_text.text_content = "Thought";
    reasoning_text.attributes["pulpValueKey"] = "reasoning.text";
    reasoning.children.push_back(reasoning_text);
    IRNode wrapper;
    wrapper.type = "frame";
    IRNode tool;
    tool.type = "frame";
    tool.attributes["pulpCollectionTemplate"] = "tool";
    IRNode tool_text;
    tool_text.type = "text";
    tool_text.text_content = "Edit";
    tool_text.attributes["pulpValueKey"] = "tool.title";
    tool.children.push_back(tool_text);
    wrapper.children.push_back(tool);
    assistant.children = {markdown, copy, reasoning, wrapper};
    root.children.push_back(assistant);

    const auto templates = extract_imported_collection_templates(root);
    REQUIRE(templates.contains("assistant"));
    REQUIRE(templates.contains("reasoning"));
    REQUIRE(templates.contains("tool"));
    const auto& extracted = templates.at("assistant");
    REQUIRE(extracted.children.size() == 2);
    REQUIRE(extracted.children[0].attributes.contains("pulpValueKind"));
    REQUIRE(extracted.children[1].attributes.contains("pulpHostAction"));
}

TEST_CASE("parent collection templates exclude unbound peers of nested sample exemplars") {
    IRNode root;
    IRNode assistant;
    assistant.type = "frame";
    assistant.name = "transcript/div-message:0";
    assistant.attributes["pulpCollectionTemplate"] = "assistant";

    IRNode markdown;
    markdown.type = "text";
    markdown.attributes["pulpValueKey"] = "message.markdown";
    markdown.attributes["pulpValueKind"] = "markdown";

    IRNode exemplar;
    exemplar.type = "frame";
    exemplar.name = "transcript/div-tool-row:0";
    exemplar.attributes["pulpCollectionTemplate"] = "tool";
    IRNode exemplar_text;
    exemplar_text.type = "text";
    exemplar_text.attributes["pulpValueKey"] = "tool.title";
    exemplar.children.push_back(exemplar_text);

    IRNode unbound_peer;
    unbound_peer.type = "frame";
    unbound_peer.name = "transcript/div-tool-row:1";
    IRNode peer_action;
    peer_action.type = "button";
    peer_action.attributes["pulpHostAction"] = "tool.open";
    unbound_peer.children.push_back(peer_action);

    assistant.children = {markdown, exemplar, unbound_peer};
    root.children.push_back(assistant);

    const auto templates = extract_imported_collection_templates(root);
    REQUIRE(templates.contains("assistant"));
    REQUIRE(templates.contains("tool"));
    const auto& extracted = templates.at("assistant");
    REQUIRE(extracted.children.size() == 1);
    REQUIRE(extracted.children.front().attributes.at("pulpValueKind") == "markdown");
}

TEST_CASE("collection templates retain trailing static row context until the next template boundary") {
    IRNode root;
    IRNode group;
    group.type = "frame";
    IRNode wrapper;
    wrapper.type = "frame";
    IRNode assistant;
    assistant.type = "frame";
    assistant.attributes["pulpCollectionTemplate"] = "assistant";
    IRNode markdown;
    markdown.type = "text";
    markdown.attributes["pulpValueKey"] = "message.markdown";
    markdown.attributes["pulpValueKind"] = "markdown";
    assistant.children.push_back(markdown);
    wrapper.children.push_back(assistant);
    IRNode metadata;
    metadata.type = "text";
    metadata.text_content = "model · duration · cost";
    metadata.style.height = 16.5f;
    metadata.layout.height_mode = SizingMode::fixed;
    metadata.layout.margin_top = 16.0f;
    IRNode controls;
    controls.type = "frame";
    controls.style.height = 32.0f;
    controls.style.opacity = 0.0f;
    controls.layout.height_mode = SizingMode::fixed;
    controls.layout.margin_top = 16.0f;
    IRNode copy_action;
    copy_action.type = "button";
    copy_action.attributes["pulpHostAction"] = "message.copy";
    controls.children.push_back(copy_action);
    IRNode next;
    next.type = "frame";
    next.attributes["pulpCollectionTemplate"] = "next";
    IRNode next_value;
    next_value.type = "text";
    next_value.attributes["pulpValueKey"] = "next.text";
    next.children.push_back(next_value);
    group.children = {wrapper, metadata, controls, next};
    root.children.push_back(group);

    const auto templates = extract_imported_collection_templates(root);
    const auto& extracted = templates.at("assistant");
    REQUIRE(extracted.children.size() == 3);
    REQUIRE(extracted.children[1].text_content == "model · duration · cost");
    REQUIRE(extracted.children[1].layout.margin_top == 16.0f);
    REQUIRE(extracted.children[2].style.height == 32.0f);
    REQUIRE(templates.contains("next"));
}

TEST_CASE("nested collection templates retain enclosing action companions after item projection") {
    IRNode root;
    root.type = "frame";
    IRNode row;
    row.type = "frame";
    IRNode wrapper;
    wrapper.type = "frame";
    IRNode assistant;
    assistant.type = "frame";
    assistant.attributes["pulpCollectionTemplate"] = "assistant";
    IRNode markdown;
    markdown.type = "text";
    markdown.attributes["pulpValueKey"] = "message.markdown";
    markdown.attributes["pulpValueKind"] = "markdown";
    assistant.children.push_back(markdown);
    wrapper.children.push_back(assistant);

    IRNode wrapper_chrome;
    wrapper_chrome.type = "frame";
    wrapper_chrome.attributes["aria-hidden"] = "true";
    wrapper.children.push_back(wrapper_chrome);
    row.children.push_back(wrapper);

    IRNode metadata;
    metadata.type = "text";
    metadata.text_content = "model · duration · cost";
    row.children.push_back(metadata);

    IRNode footer;
    footer.type = "frame";
    IRNode action;
    action.type = "button";
    action.stable_anchor_id = "source-action";
    action.attributes["pulpRouteId"] = "item.open";
    action.attributes["pulpHostAction"] = "item.open";
    action.attributes["pulpPayloadSource"] = "collection-item-field";
    action.attributes["pulpPayloadField"] = "item.id";
    action.attributes["pulpPayloadSchema"] = "item-id";
    action.attributes["pulpPayloadProvenance"] = "source://collection/item-id";
    footer.children.push_back(action);
    row.children.push_back(footer);
    root.children.push_back(row);

    IRNode unrelated;
    unrelated.type = "text";
    unrelated.text_content = "outside the repeated row";
    root.children.push_back(unrelated);

    const auto templates = extract_imported_collection_templates(root);
    REQUIRE(templates.contains("assistant"));
    const auto& extracted = templates.at("assistant");
    REQUIRE(extracted.children.size() == 4);
    REQUIRE(extracted.children[1].attributes.contains("aria-hidden"));
    REQUIRE(extracted.children[2].text_content == "model · duration · cost");
    REQUIRE(extracted.children[3].children.front().attributes.at("pulpHostAction") == "item.open");

    PayloadBindingContext context;
    ImportedRepeatedList list(templates, {}, &context);
    list.set_bounds({0, 0, 500, 240});
    list.set_items({{"assistant-1", "assistant",
                     {{"message.markdown", "Projected response"}, {"item.id", "item-42"}}}});
    list.layout_children();
    REQUIRE(context.calls == 1);
    REQUIRE(context.action == "item.open");
    REQUIRE(context.payload == "item-42");
}

TEST_CASE("collection sample roots prevent rich rows from claiming external action sections") {
    IRNode root;
    root.type = "frame";
    IRNode sample;
    sample.type = "frame";
    sample.attributes["pulpCollectionSampleRoot"] = "true";
    IRNode wrapper;
    wrapper.type = "frame";
    IRNode assistant;
    assistant.type = "frame";
    assistant.attributes["pulpCollectionTemplate"] = "assistant";
    IRNode markdown;
    markdown.type = "text";
    markdown.attributes["pulpValueKey"] = "message.markdown";
    markdown.attributes["pulpValueKind"] = "markdown";
    assistant.children.push_back(markdown);
    wrapper.children.push_back(assistant);
    IRNode local_chrome;
    local_chrome.type = "frame";
    local_chrome.attributes["aria-hidden"] = "true";
    wrapper.children.push_back(local_chrome);
    sample.children.push_back(wrapper);
    root.children.push_back(sample);

    IRNode external_action;
    external_action.type = "button";
    external_action.attributes["pulpHostAction"] = "workspace.close";
    root.children.push_back(external_action);

    const auto templates = extract_imported_collection_templates(root);
    const auto& extracted = templates.at("assistant");
    REQUIRE(extracted.children.size() == 2);
    REQUIRE(extracted.children[1].attributes.contains("aria-hidden"));
    const auto has_action = [](const auto& self, const IRNode& node,
                               std::string_view action) -> bool {
        if (const auto found = node.attributes.find("pulpHostAction");
            found != node.attributes.end() && found->second == action) return true;
        return std::ranges::any_of(node.children, [&](const auto& child) {
            return self(self, child, action);
        });
    };
    REQUIRE_FALSE(has_action(has_action, extracted, "workspace.close"));
}

TEST_CASE("ordinary collection rows do not absorb following static sections") {
    IRNode root;
    IRNode row;
    row.type = "frame";
    row.attributes["pulpCollectionTemplate"] = "project";
    IRNode value;
    value.type = "text";
    value.attributes["pulpValueKey"] = "project.name";
    row.children.push_back(value);
    IRNode footer;
    footer.type = "frame";
    footer.style.height = 240.0f;
    IRNode footer_text;
    footer_text.type = "text";
    footer_text.text_content = "unrelated footer";
    footer.children.push_back(footer_text);
    root.children = {row, footer};

    const auto templates = extract_imported_collection_templates(root);
    REQUIRE(templates.at("project").children.size() == 1);
    REQUIRE(templates.at("project").children.front().attributes.contains("pulpValueKey"));
}

TEST_CASE("collection templates retain static content governed by application state") {
    IRNode root;
    IRNode row;
    row.type = "frame";
    row.stable_anchor_id = "disclosure-row";
    row.attributes["pulpCollectionTemplate"] = "disclosure";

    IRNode trigger;
    trigger.type = "button";
    trigger.attributes["pulpHostAction"] = "details.toggle";

    IRNode content;
    content.type = "frame";
    content.stable_anchor_id = "disclosure-content";
    content.style.height = 48.0f;
    content.layout.height_mode = SizingMode::fixed;
    IRNode::ResponsiveConstraints responsive;
    responsive.visibility = {{.visible = false, .structural = true}};
    responsive.application_state_key = "details.open";
    responsive.visibility_by_application_state = {
        {"closed", false}, {"open", true}};
    content.responsive = std::move(responsive);
    IRNode static_text;
    static_text.type = "text";
    static_text.text_content = "captured disclosure body";
    content.children.push_back(std::move(static_text));

    row.children = {std::move(trigger), std::move(content)};
    root.children.push_back(std::move(row));

    const auto templates = extract_imported_collection_templates(root);
    REQUIRE(templates.contains("disclosure"));
    const auto& extracted = templates.at("disclosure");
    REQUIRE(extracted.children.size() == 2);
    REQUIRE(extracted.children[1].responsive);
    REQUIRE(extracted.children[1].children.size() == 1);
    CHECK(extracted.children[1].children.front().text_content ==
          "captured disclosure body");

    ImportedRepeatedList list(templates, {});
    list.set_bounds({0, 0, 180, 96});
    list.set_items({{"disclosure-1", "disclosure", {}}});
    list.layout_children();
    auto* virtual_list = dynamic_cast<VirtualList*>(list.child_at(0));
    REQUIRE(virtual_list);
    auto* row_host = virtual_list->realized_row_at_slot(0);
    REQUIRE(row_host);
    REQUIRE(row_host->child_count() == 1);
    auto* materialized = row_host->child_at(0);
    REQUIRE(materialized->child_count() == 2);
    CHECK_FALSE(materialized->child_at(1)->visible());
    REQUIRE(apply_imported_application_state_transition(
        *materialized, "details.open", "set:open"));
    CHECK(materialized->child_at(1)->visible());
}

TEST_CASE("flattened dynamic rows hug after nested samples are removed even with trailing actions") {
    IRNode root;
    IRNode assistant;
    assistant.type = "frame";
    assistant.attributes["pulpCollectionTemplate"] = "assistant";
    assistant.style.height = 640.0f;
    assistant.layout.height_mode = SizingMode::fixed;

    IRNode markdown;
    markdown.type = "text";
    markdown.attributes["pulpValueKey"] = "message.markdown";
    markdown.attributes["pulpValueKind"] = "markdown";
    assistant.children.push_back(markdown);

    IRNode nested;
    nested.type = "frame";
    nested.attributes["pulpCollectionTemplate"] = "tool";
    nested.style.height = 400.0f;
    assistant.children.push_back(nested);

    IRNode action;
    action.type = "button";
    action.attributes["pulpHostAction"] = "message.copy";
    action.style.height = 24.0f;
    action.layout.height_mode = SizingMode::fixed;
    assistant.children.push_back(action);
    root.children.push_back(assistant);

    const auto templates = extract_imported_collection_templates(root);
    const auto& extracted = templates.at("assistant");
    REQUIRE(extracted.attributes.contains("pulpDynamicSampleHeightInvalidated"));
    REQUIRE(extracted.children.size() == 2);

    ImportedRepeatedList list({{"assistant", extracted}}, {});
    list.set_bounds({0, 0, 600, 800});
    list.set_items({{"assistant-1", "assistant", {{"message.markdown", "short response"}}}});
    list.layout_children();

    auto* template_root = list.child_at(0)->child_at(0)->child_at(0);
    REQUIRE(template_root->bounds().height < 640.0f);
    REQUIRE(template_root->bounds().height >= 24.0f);
}

TEST_CASE("direct sample-root templates retain their own stretch width below a percentage ceiling") {
    IRNode root;
    root.layout.padding_left = 24.0f;
    IRNode row;
    row.type = "frame";
    row.attributes["pulpCollectionSampleRoot"] = "true";
    row.attributes["pulpCollectionTemplate"] = "message";
    row.layout.align_self = "stretch";
    row.layout.margin_left = 43.75f;
    row.style.max_width_dimension = "95%";
    row.style.height = 40.0f;
    row.layout.height_mode = SizingMode::fixed;
    IRNode value;
    value.type = "text";
    value.attributes["pulpValueKey"] = "message.text";
    row.children.push_back(std::move(value));
    root.children.push_back(std::move(row));

    const auto templates = extract_imported_collection_templates(root);
    const auto& extracted = templates.at("message");
    REQUIRE(extracted.layout.width_mode == SizingMode::fill);
    REQUIRE(extracted.style.width_dimension == "100%");
    REQUIRE(extracted.layout.margin_left == 43.75f);

    ImportedRepeatedList list({{"message", extracted}}, {});
    list.set_bounds({0, 0, 875, 100});
    list.set_items({{"message-1", "message", {{"message.text", "response"}}}});
    list.layout_children();

    auto* template_root = list.child_at(0)->child_at(0)->child_at(0);
    REQUIRE(std::abs(template_root->bounds().x - 43.75f) <= 0.25f);
    REQUIRE(std::abs(template_root->bounds().width - 831.25f) <= 0.25f);
    REQUIRE(template_root->bounds().x + template_root->bounds().width == 875.0f);
}

TEST_CASE("nested percentage max width is not combined with an ancestor pixel max width") {
    IRNode root;
    IRNode sample;
    sample.attributes["pulpCollectionSampleRoot"] = "true";
    sample.style.max_width = 896.0f;
    IRNode wrapper;
    wrapper.style.max_width = 720.0f;
    IRNode row;
    row.attributes["pulpCollectionTemplate"] = "message";
    row.style.max_width_dimension = "95%";
    IRNode value;
    value.type = "text";
    value.attributes["pulpValueKey"] = "message.text";
    row.children.push_back(value);
    wrapper.children.push_back(row);
    sample.children.push_back(wrapper);
    root.children.push_back(sample);

    const auto templates = extract_imported_collection_templates(root);
    const auto& extracted = templates.at("message");
    REQUIRE(extracted.style.max_width_dimension == "95%");
    REQUIRE_FALSE(extracted.style.max_width.has_value());
}

TEST_CASE("flattened stretched templates retain fill width below a percentage ceiling") {
    IRNode root;
    IRNode sample;
    sample.attributes["pulpCollectionSampleRoot"] = "true";
    sample.style.width = 875.0f;
    IRNode wrapper;
    IRNode row;
    row.type = "frame";
    row.attributes["pulpCollectionTemplate"] = "message";
    row.layout.align_self = "stretch";
    row.layout.margin_left = 43.75f;
    row.style.max_width_dimension = "95%";
    row.style.height = 40.0f;
    row.layout.height_mode = SizingMode::fixed;
    IRNode child;
    child.type = "frame";
    child.style.height = 20.0f;
    child.layout.width_mode = SizingMode::fill;
    child.layout.height_mode = SizingMode::fixed;
    row.children.push_back(std::move(child));
    wrapper.children.push_back(std::move(row));
    sample.children.push_back(std::move(wrapper));
    root.children.push_back(std::move(sample));

    const auto templates = extract_imported_collection_templates(root);
    const auto& extracted = templates.at("message");
    REQUIRE(extracted.layout.width_mode == SizingMode::fill);
    REQUIRE_FALSE(extracted.style.width_dimension.has_value());

    ImportedRepeatedList list({{"message", extracted}}, {});
    list.set_bounds({0, 0, 875, 100});
    list.set_items({{"message-1", "message", {}}});
    list.layout_children();

    auto* template_root = list.child_at(0)->child_at(0)->child_at(0);
    INFO("template bounds x=" << template_root->bounds().x
                              << " width=" << template_root->bounds().width);
    REQUIRE(std::abs(template_root->bounds().x - 43.75f) <= 0.25f);
    REQUIRE(std::abs(template_root->bounds().width - 831.25f) <= 0.25f);
    REQUIRE(template_root->bounds().x + template_root->bounds().width == 875.0f);
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

TEST_CASE("imported repeated rows preserve constrained template-root geometry") {
    IRNode row;
    row.type = "frame";
    row.style.width_dimension = "95%";
    row.style.max_width_dimension = "95%";
    row.style.height = 40.0f;
    row.layout.margin_left = 25.0f;
    row.layout.width_mode = SizingMode::fill;
    row.layout.height_mode = SizingMode::fixed;

    IRNode child;
    child.type = "frame";
    child.style.height = 20.0f;
    child.layout.width_mode = SizingMode::fill;
    child.layout.height_mode = SizingMode::fixed;
    row.children.push_back(std::move(child));

    ImportedRepeatedList list({{"message", row}}, {});
    list.set_bounds({0, 0, 500, 100});
    list.set_items({{"message-1", "message", {}}});
    list.layout_children();

    auto* virtual_list = list.child_at(0);
    REQUIRE(virtual_list != nullptr);
    REQUIRE(virtual_list->child_count() == 1);
    auto* row_host = virtual_list->child_at(0);
    REQUIRE(row_host->child_count() == 1);
    auto* template_root = row_host->child_at(0);
    REQUIRE(std::abs(template_root->bounds().x - 25.0f) < 0.01f);
    REQUIRE(std::abs(template_root->bounds().width - 475.0f) < 0.01f);
    REQUIRE(std::abs(template_root->child_at(0)->bounds().width - 475.0f) < 0.01f);
}

TEST_CASE("imported repeated row measurement matches constrained wrapping and outer margins") {
    IRNode row;
    row.type = "frame";
    row.style.width_dimension = "50%";
    row.style.max_width_dimension = "50%";
    row.style.height = 12.0f;
    row.layout.align_self = "flex-end";
    row.layout.margin_top = 5.0f;
    row.layout.margin_right = 10.0f;
    row.layout.margin_bottom = 7.0f;
    row.layout.width_mode = SizingMode::fill;
    row.layout.height_mode = SizingMode::fixed;

    IRNode text;
    text.type = "text";
    text.text_content = "short";
    text.style.font_size = 10.0f;
    text.style.line_height = 12.0f;
    text.style.white_space = "normal";
    text.layout.width_mode = SizingMode::fill;
    text.layout.height_mode = SizingMode::hug;
    text.attributes["pulpValueKey"] = "message.text";
    row.children.push_back(std::move(text));

    ImportedRepeatedList list({{"message", row}}, {});
    list.set_bounds({0, 0, 100, 100});
    list.set_items({{"message-1", "message", {{"message.text",
        "one two three four five six seven eight nine ten eleven twelve"}}}});
    list.layout_children();

    auto* row_host = list.child_at(0)->child_at(0);
    auto* template_root = row_host->child_at(0);
    REQUIRE(std::abs(template_root->bounds().x - 40.0f) < 0.01f);
    REQUIRE(std::abs(template_root->bounds().y - 5.0f) < 0.01f);
    REQUIRE(std::abs(template_root->bounds().width - 50.0f) < 0.01f);
    REQUIRE(template_root->bounds().height > 12.0f);
    REQUIRE(std::abs(row_host->bounds().height -
        (5.0f + template_root->bounds().height + 7.0f)) < 0.01f);
    REQUIRE(std::abs(list.content_height() - row_host->bounds().height) < 0.01f);
}

TEST_CASE("nested repeated-row flex text shrinks and ellipsizes from its intrinsic width") {
    IRNode row;
    row.type = "frame";
    row.layout.width_mode = SizingMode::fill;
    row.layout.height_mode = SizingMode::hug;

    IRNode button;
    button.type = "button";
    button.layout.direction = LayoutDirection::row;
    button.layout.align = LayoutAlign::center;
    button.layout.gap = 8.0f;
    button.layout.padding_left = 8.0f;
    button.layout.padding_right = 8.0f;
    button.layout.width_mode = SizingMode::fill;
    button.layout.height_mode = SizingMode::hug;

    IRNode icon;
    icon.type = "svg_rect";
    icon.style.width = 14.0f;
    icon.style.height = 14.0f;
    icon.layout.flex_shrink = 0.0f;
    icon.stable_anchor_id = "tool-icon";
    button.children.push_back(std::move(icon));

    for (const auto& [anchor, key, sample] : {
             std::tuple{"tool-label", "tool.label", "E"},
             std::tuple{"tool-path", "tool.path", "lib/t.ts"},
         }) {
        IRNode text;
        text.type = "text";
        text.text_content = sample;
        text.style.font_size = 13.0f;
        text.style.line_height = 18.0f;
        text.style.min_width = 0.0f;
        text.style.white_space = "nowrap";
        text.style.text_overflow = "ellipsis";
        text.layout.flex_shrink = 1.0f;
        text.layout.width_mode = SizingMode::fixed;
        text.layout.height_mode = SizingMode::hug;
        text.attributes["pulpValueKey"] = key;
        text.stable_anchor_id = anchor;
        button.children.push_back(std::move(text));
    }
    IRNode tail;
    tail.type = "text";
    tail.text_content = "3s";
    tail.style.font_size = 13.0f;
    tail.style.width = 16.0f;
    tail.style.height = 18.0f;
    tail.layout.width_mode = SizingMode::fixed;
    tail.layout.height_mode = SizingMode::fixed;
    tail.layout.flex_shrink = 0.0f;
    tail.layout.margin_left_dimension = "auto";
    tail.stable_anchor_id = "tool-tail";
    button.children.push_back(std::move(tail));
    row.children.push_back(std::move(button));

    const auto find_anchor = [](View& root, const std::string& anchor) {
        auto visit = [&](auto&& self, View& view) -> View* {
            if (view.anchor_id() == anchor) return &view;
            for (std::size_t index = 0; index < view.child_count(); ++index)
                if (auto* found = self(self, *view.child_at(index))) return found;
            return nullptr;
        };
        return visit(visit, root);
    };

    ImportedRepeatedList list({{"tool", row}}, {});
    list.set_bounds({0, 0, 420, 80});
    list.set_items({{"tool-1", "tool", {{"tool.label", "Edit"},
        {"tool.path", "components/settings.tsx"}}}});
    list.layout_children();
    auto* label = find_anchor(list, "tool-label");
    auto* path = find_anchor(list, "tool-path");
    auto* tail_view = find_anchor(list, "tool-tail");
    REQUIRE(label != nullptr);
    REQUIRE(path != nullptr);
    REQUIRE(tail_view != nullptr);
    const float wide_label = label->bounds().width;
    const float wide_path = path->bounds().width;
    REQUIRE(wide_label > 0.0f);
    REQUIRE(wide_label > 20.0f);
    REQUIRE(wide_path > 140.0f);
    REQUIRE(tail_view->bounds().x + tail_view->bounds().width > 400.0f);
    REQUIRE(dynamic_cast<Label*>(label)->text_overflow_ellipsis());
    REQUIRE(dynamic_cast<Label*>(path)->text_overflow_ellipsis());

    list.set_bounds({0, 0, 120, 80});
    list.layout_children();
    REQUIRE(label->bounds().width > 0.0f);
    REQUIRE(path->bounds().width > 0.0f);
    REQUIRE(label->bounds().width < wide_label);
    REQUIRE(path->bounds().width < wide_path);

    list.set_bounds({0, 0, 420, 80});
    list.layout_children();
    REQUIRE(std::abs(label->bounds().width - wide_label) < 0.01f);
    REQUIRE(std::abs(path->bounds().width - wide_path) < 0.01f);
}

TEST_CASE("imported repeated list uses the nearest clipping ancestor as its viewport") {
    IRNode row;
    row.type = "frame";
    row.style.height = 100.0f;
    row.layout.height_mode = SizingMode::fixed;

    auto viewport = std::make_unique<View>();
    viewport->set_overflow_y(View::OverflowAxis::hidden);
    viewport->set_bounds({0, 0, 600, 302});
    auto shell = std::make_unique<View>();
    shell->set_bounds({0, 0, 600, 1001});
    auto list = std::make_unique<ImportedRepeatedList>(
        std::unordered_map<std::string, IRNode>{{"message", row}}, IRAssetManifest{});
    auto* retained = list.get();
    list->set_bounds({16, 0, 568, 1001});
    shell->add_child(std::move(list));
    viewport->add_child(std::move(shell));

    std::vector<ImportedListItem> items;
    for (int index = 0; index < 11; ++index)
        items.push_back({"message-" + std::to_string(index), "message", {}});
    retained->set_items(std::move(items));
    retained->layout_children();

    REQUIRE(retained->bounds().x == 16.0f);
    REQUIRE(retained->bounds().width == 568.0f);
    REQUIRE(retained->bounds().height == 1001.0f);
    REQUIRE(retained->child_at(0)->bounds().height == 302.0f);
    REQUIRE(retained->content_height() == 1100.0f);
    retained->set_scroll_y(10000.0f);
    REQUIRE(retained->scroll_y() == 798.0f);

    viewport->set_bounds({0, 0, 600, 500});
    retained->layout_children();
    REQUIRE(retained->bounds().height == 1001.0f);
    REQUIRE(retained->child_at(0)->bounds().height == 500.0f);
    REQUIRE(retained->scroll_y() == 600.0f);
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

TEST_CASE("flattened tool cards retain shared content gutters and captured visual hierarchy") {
    IRNode root;
    root.type = "frame";
    IRNode content;
    content.type = "frame";
    content.layout.padding_left = 16.0f;
    content.layout.padding_right = 16.0f;
    content.responsive.emplace();
    IRNode::ResponsiveConstraints::LayoutVariant narrow;
    narrow.computed_style_literals = {{"paddingLeft", "0px"}, {"paddingRight", "0px"}};
    narrow.transition_to_next = IRNode::ResponsiveBreakpoint{639.0f, 640.0f, "measured"};
    IRNode::ResponsiveConstraints::LayoutVariant wide;
    wide.computed_style_literals = {{"paddingLeft", "16px"}, {"paddingRight", "16px"}};
    content.responsive->layout_variants = {narrow, wide};

    IRNode card;
    card.type = "frame";
    card.attributes["pulpCollectionTemplate"] = "tool";
    card.layout.align_self = "stretch";
    card.style.max_width_dimension = "100%";
    card.style.background_color = "#181818ff";
    card.style.border_left_color = "#d09a00ff";
    card.style.border_left_width = 2.0f;
    card.style.border_top_left_radius = 10.5f;
    card.style.border_bottom_left_radius = 10.5f;

    IRNode trigger;
    trigger.type = "button";
    trigger.layout.width_mode = SizingMode::fill;
    trigger.style.background_color = "#2828284d";
    IRNode primary;
    primary.type = "text";
    primary.attributes["pulpValueKey"] = "tool.label";
    primary.style.color = "#ffffffcc";
    IRNode secondary;
    secondary.type = "text";
    secondary.attributes["pulpValueKey"] = "tool.subject";
    secondary.style.color = "#afafaf99";
    trigger.children = {primary, secondary};
    card.children.push_back(std::move(trigger));
    content.children.push_back(std::move(card));
    root.children.push_back(std::move(content));

    const auto templates = extract_imported_collection_templates(root);
    const auto& extracted = templates.at("tool");
    REQUIRE(extracted.layout.margin_left == 16.0f);
    REQUIRE(extracted.layout.margin_right == 16.0f);
    REQUIRE_FALSE(extracted.style.width_dimension.has_value());
    REQUIRE(extracted.style.background_color == "#181818ff");
    REQUIRE(extracted.style.border_left_color == "#d09a00ff");
    REQUIRE(extracted.children.front().style.background_color == "#2828284d");
    REQUIRE(extracted.children.front().children[0].style.color == "#ffffffcc");
    REQUIRE(extracted.children.front().children[1].style.color == "#afafaf99");
    REQUIRE(extracted.responsive.has_value());
    REQUIRE(extracted.responsive->layout_variants.size() == 2);
    REQUIRE(extracted.responsive->layout_variants[0].computed_style_literals.at("marginLeft") == "0px");
    REQUIRE(extracted.responsive->layout_variants[0].computed_style_literals.at("marginRight") == "0px");
    REQUIRE(extracted.responsive->layout_variants[1].computed_style_literals.at("marginLeft") == "16px");
    REQUIRE(extracted.responsive->layout_variants[1].computed_style_literals.at("marginRight") == "16px");

    ImportedRepeatedList list(templates, {});
    list.set_bounds({0, 0, 907, 120});
    list.set_items({{"tool-1", "tool", {{"tool.label", "Edit"},
                                           {"tool.subject", "src/lib/theme.ts"}}}});
    list.layout_children();
    auto* template_root = list.child_at(0)->child_at(0)->child_at(0);
    REQUIRE(template_root->bounds().x == 16.0f);
    REQUIRE(template_root->bounds().width == 875.0f);
    REQUIRE(template_root->background_color() == pulp::canvas::Color::rgba8(24, 24, 24));
    REQUIRE(template_root->border_left_width() == 2.0f);
    REQUIRE(template_root->border_left_color() == pulp::canvas::Color::rgba8(208, 154, 0));
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

TEST_CASE("imported collection action can use the stable item key as its payload") {
    IRNode row;
    row.type = "button";
    row.stable_anchor_id = "message-row";
    row.attributes["pulpRouteId"] = "message.scroll-to-turn";
    row.attributes["pulpHostAction"] = "message.scroll-to-turn";
    row.attributes["pulpPayloadSource"] = "collection-item-key";
    row.attributes["pulpPayloadSchema"] = "message-id";
    row.attributes["pulpPayloadProvenance"] = "source://turn/user-message-id";
    PayloadBindingContext context;
    ImportedRepeatedList list({{"message", row}}, {}, &context);
    list.set_bounds({0, 0, 300, 100});
    list.set_items({{"msg_01", "message", {}}});
    list.layout_children();
    REQUIRE(context.calls == 1);
    REQUIRE(context.payload == "msg_01");
}

TEST_CASE("imported collection action without its runtime payload fails closed") {
    IRNode row;
    row.type = "button";
    row.stable_anchor_id = "message-row";
    row.attributes["pulpRouteId"] = "session.undo-to-message";
    row.attributes["pulpHostAction"] = "session.undo-to-message";
    row.attributes["pulpPayloadSource"] = "collection-item-field";
    row.attributes["pulpPayloadField"] = "turn.user-message-id";
    row.attributes["pulpPayloadSchema"] = "message-id";
    row.attributes["pulpPayloadProvenance"] = "source://turn/user-message-id";
    PayloadBindingContext context;
    ImportedRepeatedList list({{"message", row}}, {}, &context);
    list.set_bounds({0, 0, 300, 100});
    REQUIRE_NOTHROW(list.set_items({{"row-01", "message", {}}}));
    list.layout_children();
    REQUIRE(context.calls == 0);
}

TEST_CASE("imported collection action with incomplete payload evidence fails closed") {
    IRNode row;
    row.type = "button";
    row.stable_anchor_id = "item-row";
    row.attributes["pulpRouteId"] = "item.open";
    row.attributes["pulpHostAction"] = "item.open";
    row.attributes["pulpPayloadSource"] = "collection-item-field";
    row.attributes["pulpPayloadField"] = "item.id";
    PayloadBindingContext context;
    ImportedRepeatedList list({{"item", row}}, {}, &context);
    list.set_bounds({0, 0, 300, 100});
    REQUIRE_NOTHROW(list.set_items({{"row-01", "item", {{"item.id", "item-42"}}}}));
    list.layout_children();
    REQUIRE(context.calls == 0);
}

TEST_CASE("turn action payloads bind exact identities and terminal fork fails closed") {
    IRNode row;
    row.type = "frame";
    const auto action = [](std::string id, std::string field) {
        IRNode button;
        button.type = "button";
        button.stable_anchor_id = id;
        button.attributes["pulpRouteId"] = id;
        button.attributes["pulpHostAction"] = id;
        button.attributes["pulpPayloadSource"] = "collection-item-field";
        button.attributes["pulpPayloadField"] = field;
        button.attributes["pulpPayloadSchema"] = "message-id";
        button.attributes["pulpPayloadProvenance"] = "source://turn/" + field;
        return button;
    };
    row.children.push_back(action("message.scroll-to-turn", "turn.id"));
    row.children.push_back(action("session.fork-from-message", "turn.next-user-message-id"));
    row.children.push_back(action("session.undo-to-message", "turn.user-message-id"));
    PayloadBindingContext context;
    ImportedRepeatedList list({{"assistant", row}}, {}, &context);
    list.set_bounds({0, 0, 300, 100});
    list.set_items({{"assistant-1", "assistant",
                     {{"turn.id", "user-message-1"},
                      {"turn.user-message-id", "user-message-1"},
                      {"turn.next-user-message-id", "user-message-2"}}}});
    list.layout_children();
    REQUIRE(context.calls == 3);
    list.set_items({{"assistant-2", "assistant",
                     {{"turn.id", "user-message-2"},
                      {"turn.user-message-id", "user-message-2"}}}});
    list.layout_children();
    REQUIRE(context.calls == 5);
    REQUIRE(context.unbind_calls == 3);
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

TEST_CASE("imported repeated list scrolls to a stable item key") {
    IRNode row;
    row.type = "frame";
    row.style.height = 80.0f;
    row.layout.height_mode = SizingMode::fixed;
    ImportedRepeatedList list({{"item", row}}, {});
    list.set_bounds({0, 0, 280, 80});
    list.set_items({{"turn-a", "item", {}}, {"turn-b", "item", {}},
                    {"turn-c", "item", {}}});
    list.layout_children();
    REQUIRE(list.scroll_to_item("turn-c"));
    list.layout_children();
    REQUIRE(list.scroll_y() > 0.0f);
    const auto scroll = list.scroll_y();
    REQUIRE_FALSE(list.scroll_to_item("missing-turn"));
    REQUIRE(list.scroll_y() == scroll);
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

TEST_CASE("dynamic rows evaluate responsive variants against the application viewport") {
    IRNode row;
    row.type = "button";
    row.style.height = 44.0f;
    row.layout.height_mode = SizingMode::fixed;
    row.attributes["pulpHostAction"] = "open";
    IRNode::ResponsiveConstraints responsive;
    responsive.vertical = IRNode::ResponsiveAxis{.kind = "fixed", .value = 66.0f};
    responsive.vertical_variants = {
        {IRNode::ResponsiveAxis{.kind = "fixed", .value = 66.0f},
         IRNode::ResponsiveBreakpoint{.lower_bound = 1023.0f, .upper_bound = 1024.0f,
                                      .confidence = "measured"}},
        {IRNode::ResponsiveAxis{.kind = "fixed", .value = 44.0f}, std::nullopt},
    };
    row.responsive = responsive;

    View application;
    application.set_bounds({0, 0, 1200, 800});
    auto list = std::make_unique<ImportedRepeatedList>(
        std::unordered_map<std::string, IRNode>{{"item", row}}, IRAssetManifest{});
    auto* retained = list.get();
    list->set_bounds({280, 46, 907, 581});
    application.add_child(std::move(list));
    retained->set_items({{"row", "item", {}}});
    retained->layout_children();
    REQUIRE(std::abs(retained->content_height() - 44.0f) < 0.01f);
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

TEST_CASE("state-expanded virtual rows refresh height scroll range clipping and pixels") {
    IRNode row;
    row.type = "view";
    row.stable_anchor_id = "expandable-row";
    row.layout.direction = LayoutDirection::column;
    row.layout.width_mode = SizingMode::fill;
    row.style.height = 24.0f;
    row.layout.height_mode = SizingMode::fixed;
    row.attributes["pulpHostAction"] = "details.toggle";

    IRNode header;
    header.type = "view";
    header.stable_anchor_id = "row-header";
    header.style.height = 24.0f;
    header.layout.height_mode = SizingMode::fixed;
    header.style.background_color = "#202020ff";

    IRNode details;
    details.type = "view";
    details.stable_anchor_id = "row-details";
    details.style.height = 72.0f;
    details.layout.height_mode = SizingMode::fixed;
    details.style.background_color = "#e05040ff";
    IRNode::ResponsiveConstraints details_responsive;
    details_responsive.visibility = {{.visible = false, .structural = true}};
    details_responsive.application_state_key = "details.open";
    details_responsive.visibility_by_application_state = {
        {"closed", false}, {"open", true}};
    details.responsive = details_responsive;
    row.children = {std::move(header), std::move(details)};

    ImportedRepeatedList list({{"item", row}}, {});
    list.set_bounds({0, 0, 160, 40});
    list.set_auto_follow(false);
    list.set_items({{"row", "item", {}}});
    list.layout_children();
    const float closed_height = list.content_height();
    REQUIRE(closed_height >= 24.0f);
    REQUIRE(closed_height < 96.0f);
    const auto before = render_to_png(list, 160, 40, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(before.empty());

    auto* virtual_list = dynamic_cast<VirtualList*>(list.child_at(0));
    REQUIRE(virtual_list);
    REQUIRE(virtual_list->realized_row_count() == 1);
    auto* row_host = virtual_list->realized_row_at_slot(0);
    REQUIRE(row_host);
    REQUIRE(row_host->child_count() == 1);
    auto* row_root = row_host->child_at(0);
    REQUIRE(apply_imported_application_state_transition(
        *row_root, "details.open", "set:open"));
    REQUIRE(row_root->child_count() == 2);
    REQUIRE(row_root->child_at(1)->visible());
    list.layout_children();

    CHECK(list.content_height() > closed_height + 60.0f);
    CHECK(list.content_height() > list.bounds().height);
    REQUIRE(virtual_list->row_height(0) > closed_height + 60.0f);
    CHECK(row_host->bounds().height == Catch::Approx(virtual_list->row_height(0)));
    const auto after = render_to_png(list, 160, 40, 1.0f, ScreenshotBackend::skia);
    const auto settled = render_to_png(list, 160, 40, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(after.empty());
    CHECK(after != before);
    CHECK(settled == after);
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

TEST_CASE("hug-width imported tool labels paint full text at their intrinsic boundary") {
    IRNode row;
    row.type = "frame";
    row.layout.direction = LayoutDirection::row;
    row.layout.align = LayoutAlign::center;
    row.layout.width_mode = SizingMode::fill;
    row.style.height = 40.0f;
    row.layout.height_mode = SizingMode::fixed;

    IRNode label;
    label.type = "text";
    label.text_content = "sample";
    label.style.font_family = "-apple-system, \"system-ui\", \"Segoe UI\", system-ui, sans-serif";
    label.style.font_size = 15.0f;
    label.style.font_weight = 500;
    label.style.white_space = "nowrap";
    label.style.text_overflow = "ellipsis";
    label.style.width = 35.421875f;
    label.layout.width_mode = SizingMode::fixed;
    label.attributes["pulpValueKey"] = "tool.label";
    label.stable_anchor_id = "tool-label";
    row.children.push_back(std::move(label));

    ImportedRepeatedList list({{"tool", row}}, {});
    list.set_bounds({0, 0, 887, 80});
    list.set_items({{"read", "tool", {{"tool.label", "Read"}}}});
    list.layout_children();

    auto* host = list.child_at(0)->child_at(0);
    REQUIRE(host != nullptr);
    auto* materialized = host->child_at(0);
    REQUIRE(materialized != nullptr);
    auto* imported_label = dynamic_cast<Label*>(materialized->child_at(0));
    REQUIRE(imported_label != nullptr);
    REQUIRE(imported_label->bounds().width > 0.0f);
    REQUIRE(imported_label->natural_text_width() - imported_label->bounds().width <= 1.0f);

    pulp::canvas::RecordingCanvas canvas;
    list.paint_all(canvas);
    REQUIRE(std::ranges::any_of(canvas.commands(), [](const auto& command) {
        return command.type == pulp::canvas::DrawCommand::Type::fill_text &&
               command.text == "Read";
    }));
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

TEST_CASE("virtual row paint reshapes bound text after its final resize") {
    IRNode row;
    row.type = "frame";
    row.style.max_width_dimension = "95%";
    row.layout.align_self = "stretch";
    row.layout.margin_left = 20.0f;
    row.layout.width_mode = SizingMode::fill;
    row.layout.height_mode = SizingMode::hug;

    IRNode paragraph;
    paragraph.type = "text";
    paragraph.text_content = "sample";
    paragraph.style.font_size = 15.0f;
    paragraph.style.line_height = 22.0f;
    paragraph.style.white_space = "normal";
    paragraph.style.width = 799.25f;
    paragraph.layout.width_mode = SizingMode::fixed;
    paragraph.layout.height_mode = SizingMode::fixed;
    IRNode::ResponsiveConstraints paragraph_responsive;
    paragraph_responsive.horizontal = IRNode::ResponsiveAxis{
        .kind = "fill", .offset = -32.0f, .residual = 0.0f,
    };
    paragraph.responsive = paragraph_responsive;
    paragraph.attributes["pulpValueKey"] = "message.text";
    row.children.push_back(std::move(paragraph));

    const std::string response =
        "The imported application must reshape this complete response using the final virtual row width.";
    ImportedRepeatedList list({{"assistant", row}}, {});
    list.set_bounds({0, 0, 120, 200});
    list.set_items({{"m1", "assistant", {{"message.text", response}}}});
    list.layout_children();
    list.set_bounds({0, 0, 500, 200});
    list.layout_children();

    auto* label = dynamic_cast<Label*>(
        list.child_at(0)->child_at(0)->child_at(0)->child_at(0));
    REQUIRE(label != nullptr);
    REQUIRE(label->bounds().width > 450.0f);

    pulp::canvas::RecordingCanvas canvas;
    list.paint_all(canvas);
    std::vector<std::string> painted_lines;
    for (const auto& command : canvas.commands())
        if (command.type == pulp::canvas::DrawCommand::Type::fill_text)
            painted_lines.push_back(command.text);
    REQUIRE(painted_lines.size() <= 2);
    REQUIRE(std::ranges::any_of(painted_lines, [](const auto& line) {
        return std::ranges::count(line, ' ') >= 4;
    }));
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

TEST_CASE("dynamic Markdown row derives inline role typography from semantic source nodes") {
    IRNode row;
    row.type = "frame";
    IRNode value;
    value.type = "text";
    value.name = "observed-dom/root/p-shape:0";
    value.attributes["pulpValueKey"] = "message.markdown";
    value.attributes["pulpValueKind"] = "markdown";
    value.style.font_size = 12.0f;
    IRNode captured_code;
    captured_code.type = "text";
    captured_code.name = "observed-dom/root/code-shape:0";
    captured_code.style.font_family = "Captured Mono";
    captured_code.style.font_size = 28.0f;
    captured_code.style.font_weight = 600;
    row.children = {value, captured_code};

    ImportedRepeatedList imported({{"assistant", row}}, {});
    imported.set_items({{"m1", "assistant", {{"message.markdown", "Use `captured_code` now."}}}});
    imported.set_bounds({0, 0, 180, 200});
    imported.layout_children();

    ImportedMarkdownRow body_only("Use `captured_code` now.",
                                  ImportedMarkdownSkin{.font_size = 12.0f});
    REQUIRE(imported.content_height() > body_only.measured_height(180.0f));
}

TEST_CASE("dynamic Markdown row consumes attached semantic role probe receipts") {
    IRNode row;
    row.type = "frame";
    IRNode value;
    value.type = "text";
    value.attributes["pulpValueKey"] = "message.markdown";
    value.attributes["pulpValueKind"] = "markdown";
    value.attributes["pulpMarkdownInlineCodeFontFamily"] = "Captured Mono";
    value.attributes["pulpMarkdownInlineCodeFontSize"] = "30px";
    value.attributes["pulpMarkdownInlineCodeFontWeight"] = "600";
    value.attributes["pulpMarkdownInlineCodeColor"] = "rgb(20, 210, 90)";
    value.attributes["pulpMarkdownInlineCodeBackground"] = "rgb(30, 40, 50)";
    value.attributes["pulpMarkdownInlineCodeBorderColor"] = "rgb(60, 70, 80)";
    value.attributes["pulpMarkdownInlineCodeBorderWidth"] = "1px";
    value.attributes["pulpMarkdownInlineCodeRadius"] = "5px";
    value.attributes["pulpMarkdownInlineCodePaddingX"] = "7px";
    value.attributes["pulpMarkdownInlineCodePaddingY"] = "2px";
    value.style.font_size = 12.0f;
    row.children.push_back(value);

    ImportedRepeatedList imported({{"assistant", row}}, {});
    imported.set_items({{"m1", "assistant", {{"message.markdown", "Use `captured_code` now."}}}});
    imported.set_bounds({0, 0, 180, 200});
    imported.layout_children();
    ImportedMarkdownRow body_only("Use `captured_code` now.",
                                  ImportedMarkdownSkin{.font_size = 12.0f});
    REQUIRE(imported.content_height() > body_only.measured_height(180.0f));

    MarkdownView* materialized_markdown = nullptr;
    const auto find_markdown = [&](const auto& self, View& view) -> void {
        if (auto* markdown = dynamic_cast<MarkdownView*>(&view)) materialized_markdown = markdown;
        for (std::size_t index = 0; index < view.child_count(); ++index)
            self(self, *view.child_at(index));
    };
    find_markdown(find_markdown, imported);
    REQUIRE(materialized_markdown != nullptr);
    const auto* expected_state = materialized_markdown->visual_skin()->state(WidgetState::rest);
    REQUIRE(expected_state != nullptr);
    REQUIRE(expected_state->inline_code_background == SkinColor{30, 40, 50, 255});
    REQUIRE(expected_state->inline_code_foreground == SkinColor{20, 210, 90, 255});
    REQUIRE(expected_state->inline_code_border == SkinColor{60, 70, 80, 255});
    REQUIRE(expected_state->border_width == 1.0f);
    REQUIRE(expected_state->corner_radius == 5.0f);
    REQUIRE(expected_state->inset_horizontal == 7.0f);
    REQUIRE(expected_state->inset_vertical == 2.0f);
}

TEST_CASE("dynamic Markdown materializes the full captured template and action chrome") {
    IRNode row;
    row.type = "frame";
    row.layout.direction = LayoutDirection::column;
    row.layout.width_mode = SizingMode::fill;
    row.layout.height_mode = SizingMode::hug;
    row.layout.padding_top = 10.0f;
    row.layout.padding_bottom = 12.0f;
    row.layout.gap = 6.0f;
    IRNode markdown;
    markdown.type = "text";
    markdown.attributes["pulpValueKey"] = "message.markdown";
    markdown.attributes["pulpValueKind"] = "markdown";
    markdown.layout.width_mode = SizingMode::fill;
    IRNode action;
    action.type = "button";
    action.text_content = "Copy";
    action.attributes["pulpHostAction"] = "message.copy";
    action.style.width = 48.0f;
    action.style.height = 20.0f;
    action.layout.width_mode = SizingMode::fixed;
    action.layout.height_mode = SizingMode::fixed;
    row.children = {markdown, action};

    ImportedRepeatedList list({{"assistant", row}}, {});
    list.set_bounds({0, 0, 420, 180});
    list.set_items({{"m1", "assistant", {{"message.markdown", "First paragraph.\n\nSecond paragraph."}}}});
    list.layout_children();

    auto* template_root = list.child_at(0)->child_at(0)->child_at(0);
    REQUIRE(template_root->child_count() == 2);
    REQUIRE(dynamic_cast<MarkdownView*>(template_root->child_at(0)) != nullptr);
    REQUIRE(dynamic_cast<TextButton*>(template_root->child_at(1)) != nullptr);
    REQUIRE(list.content_height() >= 10.0f + 12.0f + 6.0f + 20.0f);
}

TEST_CASE("dynamic Markdown imports captured semantic block spacing") {
    IRNode root;
    IRNode row;
    row.type = "frame";
    row.attributes["pulpCollectionTemplate"] = "assistant";
    IRNode markdown;
    markdown.type = "text";
    markdown.name = "observed-dom/root/p-shape:0";
    markdown.attributes["pulpValueKey"] = "message.markdown";
    markdown.attributes["pulpValueKind"] = "markdown";
    IRNode observed_following_block;
    observed_following_block.type = "text";
    observed_following_block.name = "observed-dom/root/ol-shape:0";
    observed_following_block.layout.margin_top = 16.0f;
    row.children = {markdown, observed_following_block};
    root.children.push_back(row);

    const auto templates = extract_imported_collection_templates(root);
    const auto& extracted_markdown = templates.at("assistant").children.front();
    REQUIRE(extracted_markdown.attributes.at("pulpMarkdownBlockGap") == "16.000000");
    ImportedRepeatedList list(templates, {});
    list.set_bounds({0, 0, 420, 180});
    list.set_items({{"m1", "assistant", {{"message.markdown", "First paragraph.\n\nSecond paragraph."}}}});
    list.layout_children();
    REQUIRE(list.content_height() >= 50.0f);
}

TEST_CASE("empty dynamic Markdown preserves row padding and scroll extent") {
    IRNode row;
    row.type = "frame";
    row.layout.direction = LayoutDirection::column;
    row.layout.width_mode = SizingMode::fill;
    row.layout.height_mode = SizingMode::hug;
    row.layout.padding_top = 10.0f;
    row.layout.padding_bottom = 12.0f;
    IRNode markdown;
    markdown.type = "text";
    markdown.attributes["pulpValueKey"] = "message.markdown";
    markdown.attributes["pulpValueKind"] = "markdown";
    row.children.push_back(markdown);

    ImportedRepeatedList list({{"assistant", row}}, {});
    list.set_bounds({0, 0, 420, 30});
    list.set_items({{"m1", "assistant", {{"message.markdown", ""}}},
                    {"m2", "assistant", {{"message.markdown", ""}}}});
    list.layout_children();
    REQUIRE(list.content_height() == Catch::Approx(44.0f).margin(0.1f));
    list.set_scroll_y(1000.0f);
    REQUIRE(list.scroll_y() == Catch::Approx(14.0f).margin(0.1f));
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

TEST_CASE("imported repeated list measures end-aligned wrapped rows without clipping") {
    IRNode row;
    row.type = "frame";
    row.layout.direction = LayoutDirection::column;
    row.layout.justify = LayoutAlign::flex_end;
    row.layout.width_mode = SizingMode::fill;
    row.layout.height_mode = SizingMode::hug;

    IRNode bubble;
    bubble.type = "frame";
    bubble.layout.direction = LayoutDirection::column;
    bubble.layout.width_mode = SizingMode::fill;
    bubble.layout.height_mode = SizingMode::hug;
    bubble.layout.padding_top = 12.0f;
    bubble.layout.padding_bottom = 12.0f;
    bubble.layout.padding_left = 16.0f;
    bubble.layout.padding_right = 16.0f;

    IRNode text;
    text.type = "text";
    text.style.font_size = 15.0f;
    text.style.line_height = 22.0f;
    text.style.white_space = "normal";
    text.layout.width_mode = SizingMode::fill;
    text.layout.height_mode = SizingMode::hug;
    text.attributes["pulpValueKey"] = "message.text";
    bubble.children.push_back(std::move(text));
    row.children.push_back(std::move(bubble));

    ImportedRepeatedList list({{"user", row}}, {});
    list.set_bounds({0, 0, 260, 180});
    list.set_items({{"m1", "user", {{"message.text",
        "A wrapped user message occupies three complete lines at this narrow width."}}}});
    list.layout_children();

    auto* row_host = list.child_at(0)->child_at(0);
    auto* bubble_view = row_host->child_at(0)->child_at(0);
    auto* label_view = dynamic_cast<Label*>(bubble_view->child_at(0));
    REQUIRE(label_view != nullptr);
    const auto shaped_height = label_view->measured_height(label_view->bounds().width);
    REQUIRE(label_view->bounds().height == Catch::Approx(shaped_height).margin(1.0f));
    const auto expected_height = shaped_height + 24.0f;
    REQUIRE(list.content_height() == Catch::Approx(expected_height).margin(1.0f));
    REQUIRE(row_host->bounds().height == Catch::Approx(expected_height).margin(1.0f));
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
