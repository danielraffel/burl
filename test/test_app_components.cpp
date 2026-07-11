#include <catch2/catch_test_macros.hpp>

#include <pulp/view/app_components.hpp>

using namespace pulp::view;

TEST_CASE("FocusScope traps traversal and handles Escape", "[app-components][focus]") {
    AppOverlay overlay;
    auto first = std::make_unique<TextButton>("First");
    auto* first_ptr = first.get();
    auto second = std::make_unique<TextButton>("Second");
    auto* second_ptr = second.get();
    overlay.add_child(std::move(first));
    overlay.add_child(std::move(second));

    bool dismissed = false;
    overlay.on_dismiss = [&] { dismissed = true; };
    overlay.activate();
    REQUIRE(first_ptr->has_focus());

    KeyEvent tab{};
    tab.key = KeyCode::tab;
    tab.is_down = true;
    REQUIRE(overlay.on_key_event(tab));
    REQUIRE(second_ptr->has_focus());
    REQUIRE(overlay.on_key_event(tab));
    REQUIRE(first_ptr->has_focus());

    KeyEvent escape{};
    escape.key = KeyCode::escape;
    escape.is_down = true;
    REQUIRE(overlay.on_key_event(escape));
    REQUIRE(dismissed);
}

TEST_CASE("ComposerBar submits text and exposes accessibility semantics",
          "[app-components][composer][a11y]") {
    ComposerBar composer;
    composer.set_bounds({0, 0, 640, 72});
    composer.layout_children();

    REQUIRE(composer.access_role() == View::AccessRole::group);
    REQUIRE(composer.access_label() == "Message composer");
    REQUIRE(composer.editor().access_label() == "Message");
    REQUIRE(composer.submit_button().access_label() == "Send");
    REQUIRE(composer.editor().bounds().width > composer.submit_button().bounds().width);

    std::string submitted;
    composer.on_submit = [&](const std::string& value) { submitted = value; };
    composer.set_text("hello");
    composer.submit_button().on_click();
    REQUIRE(submitted == "hello");

    submitted.clear();
    composer.set_submit_enabled(false);
    composer.submit_button().on_click();
    REQUIRE(submitted.empty());
}

TEST_CASE("ComposerBar streaming mode swaps submit for cancellation",
          "[app-components][composer]") {
    ComposerBar composer;
    int cancellations = 0;
    composer.on_cancel = [&] { ++cancellations; };

    composer.set_streaming(true);
    REQUIRE(composer.streaming());
    REQUIRE_FALSE(composer.submit_button().visible());
    REQUIRE(composer.cancel_button().visible());
    REQUIRE(composer.access_value() == "Response streaming");
    composer.cancel_button().on_click();
    REQUIRE(cancellations == 1);

    composer.set_streaming(false);
    REQUIRE(composer.submit_button().visible());
    REQUIRE_FALSE(composer.cancel_button().visible());
    REQUIRE(composer.access_value() == "Ready");
}
