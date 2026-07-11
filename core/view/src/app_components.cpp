#include <pulp/view/app_components.hpp>

#include <algorithm>

namespace pulp::view {

View* FocusScope::activate(View* previously_focused) {
    previous_ = previously_focused;
    active_ = true;
    return View::focus_next(root_, nullptr);
}

void FocusScope::deactivate() {
    if (!active_) return;
    active_ = false;
    if (previous_) {
        previous_->on_focus_changed(true);
        if (previous_->accepts_text_input()) previous_->claim_input_focus();
    }
    previous_ = nullptr;
}

bool FocusScope::handle_key_event(const KeyEvent& event, View*& current) {
    if (!active_ || !event.is_down) return false;
    if (event.key == KeyCode::escape) {
        if (on_escape) on_escape();
        return true;
    }
    if (event.key != KeyCode::tab) return false;
    current = event.isShiftDown()
        ? View::focus_prev(root_, current)
        : View::focus_next(root_, current);
    return true;
}

AppOverlay::AppOverlay() : focus_scope_(*this) {
    set_access_role(AccessRole::group);
    set_access_label("Overlay");
    focus_scope_.on_escape = [this] {
        if (on_dismiss) on_dismiss();
    };
}

void AppOverlay::activate(View* previously_focused) {
    active_ = true;
    focused_ = focus_scope_.activate(previously_focused);
}

void AppOverlay::deactivate() {
    if (focused_) {
        focused_->on_focus_changed(false);
        focused_->release_input_focus();
    }
    focus_scope_.deactivate();
    focused_ = nullptr;
    active_ = false;
}

bool AppOverlay::on_key_event(const KeyEvent& event) {
    return focus_scope_.handle_key_event(event, focused_);
}

ComposerBar::ComposerBar() {
    set_access_role(AccessRole::group);
    set_access_label("Message composer");

    auto editor = std::make_unique<TextEditor>();
    editor_ = editor.get();
    editor_->multi_line = true;
    editor_->multi_line_return_behavior = TextEditor::MultiLineReturnBehavior::insert_newline;
    editor_->placeholder = "Write a message";
    editor_->set_access_label("Message");
    editor_->on_return = [this](const std::string&) { submit(); };
    add_child(std::move(editor));

    auto submit = std::make_unique<TextButton>("Send");
    submit_ = submit.get();
    submit_->set_style(TextButton::Style::primary);
    submit_->on_click = [this] { this->submit(); };
    add_child(std::move(submit));

    auto cancel = std::make_unique<TextButton>("Cancel");
    cancel_ = cancel.get();
    cancel_->set_style(TextButton::Style::ghost);
    cancel_->on_click = [this] { if (streaming_ && on_cancel) on_cancel(); };
    cancel_->set_visible(false);
    add_child(std::move(cancel));
}

void ComposerBar::set_text(std::string text) {
    editor_->set_text(std::move(text));
}

const std::string& ComposerBar::text() const {
    return editor_->text();
}

void ComposerBar::set_streaming(bool streaming) {
    streaming_ = streaming;
    cancel_->set_visible(streaming);
    submit_->set_visible(!streaming);
    set_access_value(streaming ? "Response streaming" : "Ready");
}

void ComposerBar::set_submit_enabled(bool enabled) {
    submit_enabled_ = enabled;
    submit_->set_enabled(enabled);
}

void ComposerBar::submit() {
    if (streaming_ || !submit_enabled_ || editor_->text().empty()) return;
    if (on_submit) on_submit(editor_->text());
}

void ComposerBar::layout_children() {
    const auto b = local_bounds();
    constexpr float button_width = 82.0f;
    constexpr float gap = 10.0f;
    const float button_height = std::min(36.0f, b.height);
    editor_->set_bounds({0.0f, 0.0f, std::max(0.0f, b.width - button_width - gap), b.height});
    submit_->set_bounds({std::max(0.0f, b.width - button_width), b.height - button_height,
                         button_width, button_height});
    cancel_->set_bounds(submit_->bounds());
}

}  // namespace pulp::view
