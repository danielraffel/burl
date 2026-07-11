#pragma once

/// Product-neutral application components for chat and productivity surfaces.

#include <pulp/view/buttons.hpp>
#include <pulp/view/text_editor.hpp>
#include <pulp/view/view.hpp>

#include <functional>
#include <memory>
#include <string>

namespace pulp::view {

/// Keyboard focus boundary used by dialogs, popovers, and command surfaces.
/// Tab/Shift-Tab wrap within the supplied root; Escape requests dismissal.
class FocusScope {
public:
    explicit FocusScope(View& root) : root_(root) {}

    View* activate(View* previously_focused = nullptr);
    void deactivate();
    bool handle_key_event(const KeyEvent& event, View*& current);

    std::function<void()> on_escape;

private:
    View& root_;
    View* previous_ = nullptr;
    bool active_ = false;
};

/// Generic modal/popover content host with a focus scope and Escape behavior.
class AppOverlay : public View {
public:
    AppOverlay();

    void activate(View* previously_focused = nullptr);
    void deactivate();
    bool active() const { return active_; }
    bool on_key_event(const KeyEvent& event) override;

    std::function<void()> on_dismiss;

private:
    FocusScope focus_scope_;
    View* focused_ = nullptr;
    bool active_ = false;
};

/// Multi-line composer with submit/cancel actions. It owns no chat/session
/// policy: consumers receive text and decide what sending or cancellation mean.
class ComposerBar : public View {
public:
    ComposerBar();

    TextEditor& editor() { return *editor_; }
    const TextEditor& editor() const { return *editor_; }
    TextButton& submit_button() { return *submit_; }
    TextButton& cancel_button() { return *cancel_; }

    void set_text(std::string text);
    const std::string& text() const;
    void set_streaming(bool streaming);
    bool streaming() const { return streaming_; }
    void set_submit_enabled(bool enabled);

    void layout_children() override;

    std::function<void(const std::string&)> on_submit;
    std::function<void()> on_cancel;

private:
    void submit();

    TextEditor* editor_ = nullptr;
    TextButton* submit_ = nullptr;
    TextButton* cancel_ = nullptr;
    bool streaming_ = false;
    bool submit_enabled_ = true;
};

}  // namespace pulp::view
