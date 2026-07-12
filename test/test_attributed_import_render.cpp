#include <pulp/view/screenshot.hpp>
#include <pulp/view/screenshot_compare.hpp>
#include <pulp/view/widgets.hpp>

#include <catch2/catch_test_macros.hpp>

#include <set>
#include <memory>

using namespace pulp::view;

namespace {

std::unique_ptr<Label> attributed_fixture() {
    auto label = std::make_unique<Label>("alpha λ beta gamma");
    label->set_bounds({0, 0, 92, 52});
    label->set_multi_line(true);

    pulp::canvas::AttributedString text;
    pulp::canvas::TextSpan normal;
    normal.text = "alpha λ ";
    normal.font_family = "Inter";
    normal.font_size = 14.0f;
    normal.color = pulp::canvas::Color::rgba8(218, 224, 232);
    text.append(normal);
    pulp::canvas::TextSpan code;
    code.text = "beta gamma";
    code.font_family = "JetBrains Mono";
    code.font_size = 14.0f;
    code.color = pulp::canvas::Color::rgba8(255, 0, 255);
    code.kind = pulp::canvas::TextSpanKind::inline_code;
    text.append(code);
    label->set_attributed_string(std::move(text));

    VisualSkin skin;
    auto& rest = skin.states[WidgetState::rest];
    rest.inline_code_background = SkinColor{18, 52, 86, 255};
    rest.inline_code_foreground = SkinColor{238, 242, 247, 255};
    rest.inline_code_border = SkinColor{70, 96, 122, 255};
    label->set_visual_skin(std::move(skin));

    Theme poison;
    poison.colors["text.primary"] = pulp::canvas::Color::rgba8(255, 0, 255);
    label->set_theme(poison);
    return label;
}

} // namespace

TEST_CASE("imported attributed runs share shaped line baselines and preserve UTF-8",
          "[view][import][attributed-render]") {
    auto label = attributed_fixture();
    pulp::canvas::RecordingCanvas canvas;
    label->paint(canvas);

    std::set<int> baselines;
    bool saw_lambda = false;
    bool saw_inline_background = false;
    std::size_t inline_backgrounds = 0;
    std::set<int> code_fragment_rows;
    for (const auto& command : canvas.commands()) {
        if (command.type == pulp::canvas::DrawCommand::Type::fill_text) {
            baselines.insert(static_cast<int>(command.f[1] * 100.0f));
            saw_lambda = saw_lambda || command.text.find("λ") != std::string::npos;
        }
        if (command.type == pulp::canvas::DrawCommand::Type::fill_rounded_rect) {
            saw_inline_background = true;
            ++inline_backgrounds;
            code_fragment_rows.insert(static_cast<int>(command.f[1] * 100.0f));
        }
    }
    REQUIRE(saw_lambda);
    REQUIRE(saw_inline_background);
    REQUIRE(baselines.size() >= 2);
    REQUIRE(inline_backgrounds == code_fragment_rows.size());
}

TEST_CASE("imported inline-code runs render skin pixels without poison-theme leakage",
          "[view][import][attributed-render]") {
    auto label = attributed_fixture();
    uint32_t width = 0;
    uint32_t height = 0;
    REQUIRE_FALSE(render_to_rgba(*label, 92, 52, 1.0f, &width, &height).empty());
    REQUIRE(width == 92);
    REQUIRE(height == 52);
    const auto png = render_to_png(*label, 92, 52, 1.0f, ScreenshotBackend::skia);
    REQUIRE_FALSE(png.empty());
    REQUIRE(analyze_screenshot_content(png).passes_content_floor());
    REQUIRE(count_png_pixels(png, 18, 52, 86) > 8);
    REQUIRE(count_png_pixels(png, 255, 0, 255) == 0);
}
