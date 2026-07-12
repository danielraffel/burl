#include <catch2/catch_test_macros.hpp>

#include <pulp/platform/clipboard.hpp>
#include <pulp/view/accessibility_tree.hpp>
#include <pulp/view/bounded_accessibility_log.hpp>
#include <pulp/view/text_accessibility.hpp>
#include <pulp/view/text_editor.hpp>

#include <algorithm>
#include <memory>
#include <optional>
#include <string>
#include <vector>

using namespace pulp::view;

namespace {

struct ClipboardRestore {
    std::optional<std::string> text = pulp::platform::Clipboard::get_text();
    ~ClipboardRestore() {
        if (text) pulp::platform::Clipboard::set_text(*text);
    }
};

KeyEvent backspace() {
    KeyEvent event;
    event.key = KeyCode::backspace;
    event.is_down = true;
    return event;
}

} // namespace

TEST_CASE("native migration multiline composition replaces selection as one undo unit",
          "[native-migration][text][ime]") {
    TextEditor editor;
    editor.multi_line = true;
    editor.on_focus_changed(true);
    editor.set_text("alpha\nשלום");
    editor.set_selection(0, 5);
    editor.set_marked_text_utf16("日本", 2, 0);
    REQUIRE(editor.has_marked_text());
    REQUIRE(editor.text() == "日本\nשלום");

    TextInputEvent commit;
    commit.text = "日本語";
    editor.on_text_input(commit);
    REQUIRE_FALSE(editor.has_marked_text());
    REQUIRE(editor.text() == "日本語\nשלום");
    REQUIRE(editor.undo());
    REQUIRE(editor.text() == "alpha\nשלום");
}

TEST_CASE("native migration selection clipboard and undo preserve multiline text",
          "[native-migration][text][clipboard]") {
    ClipboardRestore restore;
    TextEditor editor;
    editor.multi_line = true;
    editor.on_focus_changed(true);
    editor.set_text("one\ntwo");
    editor.set_selection(4, 7);
    REQUIRE(editor.copy_to_clipboard());
    REQUIRE(pulp::platform::Clipboard::get_text() == std::optional<std::string>{"two"});
    REQUIRE(editor.cut_to_clipboard());
    REQUIRE(editor.text() == "one\n");
    REQUIRE(editor.undo());
    REQUIRE(editor.text() == "one\ntwo");

    editor.set_caret_pos(0);
    REQUIRE(editor.paste_from_clipboard());
    REQUIRE(editor.text() == "twoone\ntwo");
    REQUIRE(editor.undo());
    REQUIRE(editor.text() == "one\ntwo");
}

TEST_CASE("native migration deletion respects emoji and bidi grapheme boundaries",
          "[native-migration][text][unicode]") {
    TextEditor editor;
    editor.on_focus_changed(true);
    const std::string family = "👩‍👩‍👧‍👦";
    editor.set_text(std::string("אב") + family);
    editor.set_caret_pos(static_cast<int>(editor.text().size()));
    REQUIRE(editor.on_key_event(backspace()));
    REQUIRE(editor.text() == "אב");
    REQUIRE(editor.on_key_event(backspace()));
    REQUIRE(editor.text() == "א");
}

TEST_CASE("native migration focused editor teardown clears the global input slot",
          "[native-migration][text][lifecycle]") {
    View::focused_input_ = nullptr;
    auto editor = std::make_unique<TextEditor>();
    editor->on_focus_changed(true);
    editor->claim_input_focus();
    REQUIRE(View::focused_input_ == editor.get());
    editor.reset();
    REQUIRE(View::focused_input_ == nullptr);
}

TEST_CASE("native migration offline accessibility preserves semantics and stable IDs",
          "[native-migration][a11y]") {
    View root;
    auto editor = std::make_unique<TextEditor>();
    editor->set_access_role(View::AccessRole::group);
    editor->set_access_label("Message composer");
    editor->set_access_value("draft");
    editor->set_access_disabled("false");
    auto* identity = editor.get();
    root.add_child(std::move(editor));

    auto first = snapshot_accessibility_tree(root);
    REQUIRE(first.size() == 1);
    REQUIRE(first[0].view == identity);
    REQUIRE(first[0].role == View::AccessRole::group);
    REQUIRE(first[0].label == "Message composer");
    REQUIRE(first[0].value == "draft");
    REQUIRE(first[0].disabled == "false");

    TextAccessibilityNode node;
    node.id = "session-1/message-7";
    node.text = "first";
    node.role = TextAccessibilityRole::TextEditor;
    register_text_accessibility_node(node);
    node.text = "updated";
    register_text_accessibility_node(node);
    const auto registered = snapshot_accessibility_nodes();
    auto found = std::find_if(registered.begin(), registered.end(), [&](const auto& item) {
        return item.id == node.id;
    });
    REQUIRE(found != registered.end());
    REQUIRE(found->text == "updated");
    unregister_text_accessibility_node(node.id);
}

TEST_CASE("native migration accessibility log emits one bounded update per frame",
          "[native-migration][a11y][live-region]") {
    std::vector<std::string> announcements;
    set_announcement_sink([&](std::string_view text, AnnouncementPriority priority) {
        REQUIRE(priority == AnnouncementPriority::Polite);
        announcements.emplace_back(text);
    });
    BoundedAccessibilityLog log(16);
    log.update("message-1", "first delta");
    log.update("message-1", "latest delta that is longer than the bound");
    REQUIRE(log.pending_bytes() <= 16);
    REQUIRE(log.flush_frame());
    REQUIRE_FALSE(log.flush_frame());
    REQUIRE(announcements.size() == 1);
    REQUIRE(announcements.front().size() <= 16);
    REQUIRE(log.last_stable_id() == "message-1");
    set_announcement_sink(nullptr);
}
