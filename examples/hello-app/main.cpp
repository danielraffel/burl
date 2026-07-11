#include <pulp/canvas/canvas.hpp>
#include <pulp/view/view.hpp>
#include <pulp/view/widgets.hpp>
#include <pulp/view/window_host.hpp>

#include <cstdint>
#include <fstream>
#include <iostream>
#include <memory>
#include <string>
#include <string_view>

namespace {

constexpr float kWidth = 720.0f;
constexpr float kHeight = 440.0f;

class HelloView final : public pulp::view::View {
public:
    HelloView() {
        auto title = std::make_unique<pulp::view::Label>("Hello from Burl");
        title->set_font_size(34.0f);
        title->set_bounds({48.0f, 158.0f, kWidth - 96.0f, 48.0f});
        title->set_position(Position::absolute);
        add_child(std::move(title));

        auto detail = std::make_unique<pulp::view::Label>(
            "Native C++ + Yoga + Skia + Dawn — no WebView");
        detail->set_font_size(17.0f);
        detail->set_bounds({48.0f, 220.0f, kWidth - 96.0f, 30.0f});
        detail->set_position(Position::absolute);
        add_child(std::move(detail));
    }

    void paint(pulp::canvas::Canvas& canvas) override {
        canvas.set_fill_color(pulp::canvas::Color::rgba8(15, 23, 42));
        canvas.fill_rect(0.0f, 0.0f, bounds().width, bounds().height);
        canvas.set_fill_color(pulp::canvas::Color::rgba8(30, 41, 59));
        canvas.fill_rounded_rect(28.0f, 28.0f, bounds().width - 56.0f,
                                 bounds().height - 56.0f, 22.0f);
    }
};

bool write_file(const std::string& path, const std::vector<std::uint8_t>& bytes) {
    std::ofstream stream(path, std::ios::binary | std::ios::trunc);
    stream.write(reinterpret_cast<const char*>(bytes.data()),
                 static_cast<std::streamsize>(bytes.size()));
    return stream.good();
}

}  // namespace

int main(int argc, char** argv) {
    std::string capture_path;
    for (int index = 1; index < argc; ++index) {
        const std::string_view argument(argv[index]);
        constexpr std::string_view prefix = "--capture=";
        if (argument.starts_with(prefix)) {
            capture_path = std::string(argument.substr(prefix.size()));
        } else if (argument == "--capture" && index + 1 < argc) {
            capture_path = argv[++index];
        } else {
            std::cerr << "usage: " << argv[0] << " [--capture <output.png>]\n";
            return 2;
        }
    }

    HelloView root;
    root.set_bounds({0.0f, 0.0f, kWidth, kHeight});

    pulp::view::WindowOptions options;
    options.title = BURL_APP_NAME;
    options.width = kWidth;
    options.height = kHeight;
    options.min_width = 480.0f;
    options.min_height = 300.0f;
    options.resizable = true;
    options.use_gpu = true;
    options.initially_hidden = !capture_path.empty();

    auto window = pulp::view::WindowHost::create(root, options);
    if (!window) {
        std::cerr << "BurlHello: native WindowHost is unavailable\n";
        return 1;
    }
    window->set_close_callback([] {});

    if (!capture_path.empty()) {
        const auto png = window->capture_back_buffer_png();
        if (png.empty() || !write_file(capture_path, png)) {
            std::cerr << "BurlHello: GPU back-buffer capture failed\n";
            return 1;
        }
        std::cout << "wrote " << capture_path << " (" << png.size() << " bytes)\n";
        return 0;
    }

    window->run_event_loop();
    return 0;
}
