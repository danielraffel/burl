#include <pulp/view/text_editor.hpp>
#include <pulp/view/window_host.hpp>

#include <iostream>
#include <memory>

int main() {
    pulp::view::View root;
    root.set_bounds({0.0f, 0.0f, 720.0f, 420.0f});

    auto editor = std::make_unique<pulp::view::TextEditor>();
    editor->multi_line = true;
    editor->placeholder = "Type with a system input method";
    editor->set_bounds({32.0f, 32.0f, 656.0f, 340.0f});
    editor->set_access_role(pulp::view::View::AccessRole::group);
    editor->set_access_label("Native migration multiline editor");
    editor->set_access_value("");
    auto* editor_ptr = editor.get();
    editor->on_change = [editor_ptr](const std::string& text) {
        editor_ptr->set_access_value(text);
    };
    root.add_child(std::move(editor));

    pulp::view::WindowOptions options;
    options.title = "Burl Text and Accessibility Probe";
    options.width = 720.0f;
    options.height = 420.0f;
    options.use_gpu = false;
    auto window = pulp::view::WindowHost::create(root, options);
    if (!window) return 2;
    std::cout << "native-migration-text-ax-live ready\n";
    window->run_event_loop();
}
