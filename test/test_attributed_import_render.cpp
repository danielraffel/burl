#include <pulp/view/screenshot.hpp>
#include <pulp/view/screenshot_compare.hpp>
#include <pulp/view/widgets.hpp>

#include <catch2/catch_test_macros.hpp>

#include <algorithm>
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

TEST_CASE("one full-range neutral span is raster-identical to plain multiline text",
          "[view][import][attributed-render][single-span-parity]") {
    constexpr float width = 360.0f;
    constexpr float height = 132.0f;
    const std::string content =
        "A full-range neutral text run must preserve identical word spacing and wrapping "
        "across the native renderer.";
    const std::string family =
        "-apple-system, \"system-ui\", \"Segoe UI\", system-ui, sans-serif";
    const auto color = pulp::canvas::Color::rgba8(231, 233, 237);

    const auto configure = [&](Label& label) {
        label.set_bounds({0, 0, width, height});
        label.set_multi_line(true);
        label.set_font_family(family);
        label.set_font_size(15.0f);
        label.set_font_weight(400);
        label.set_letter_spacing(0.1f);
        label.set_line_height(22.0f);
        label.set_text_color(color);
    };

    Label plain(content);
    configure(plain);

    Label attributed(content);
    configure(attributed);
    pulp::canvas::AttributedString runs;
    pulp::canvas::TextSpan span;
    span.text = content;
    span.font_family = family;
    span.font_size = 15.0f;
    span.font_weight = 400;
    span.letter_spacing = 0.1f;
    span.color = color;
    runs.append(std::move(span));
    attributed.set_attributed_string(std::move(runs));

    CHECK(attributed.measured_height(width) == plain.measured_height(width));
    uint32_t plain_width = 0;
    uint32_t plain_height = 0;
    const auto plain_pixels = render_to_rgba(
        plain, static_cast<uint32_t>(width), static_cast<uint32_t>(height),
        1.0f, &plain_width, &plain_height);
    uint32_t attributed_width = 0;
    uint32_t attributed_height = 0;
    const auto attributed_pixels = render_to_rgba(
        attributed, static_cast<uint32_t>(width), static_cast<uint32_t>(height),
        1.0f, &attributed_width, &attributed_height);
    REQUIRE_FALSE(plain_pixels.empty());
    REQUIRE(plain_width == attributed_width);
    REQUIRE(plain_height == attributed_height);
    REQUIRE(std::equal(attributed_pixels.begin(), attributed_pixels.end(),
                       plain_pixels.begin(), plain_pixels.end()));

    Label source_split(content);
    configure(source_split);
    pulp::canvas::AttributedString split_runs;
    for (const std::string_view fragment : {
             std::string_view{"A full-range neutral text run must preserve "},
             std::string_view{"identical word spacing and wrapping "},
             std::string_view{"across the native renderer."}}) {
        pulp::canvas::TextSpan split_span;
        split_span.text = fragment;
        split_span.font_family = family;
        split_span.font_size = 15.0f;
        split_span.font_weight = 400;
        split_span.letter_spacing = 0.1f;
        split_span.color = color;
        split_runs.append(std::move(split_span));
    }
    source_split.set_attributed_string(std::move(split_runs));
    REQUIRE_FALSE(source_split.has_attributed_string());
    uint32_t split_width = 0;
    uint32_t split_height = 0;
    const auto split_pixels = render_to_rgba(
        source_split, static_cast<uint32_t>(width), static_cast<uint32_t>(height),
        1.0f, &split_width, &split_height);
    REQUIRE(split_width == plain_width);
    REQUIRE(split_height == plain_height);
    REQUIRE(std::equal(split_pixels.begin(), split_pixels.end(),
                       plain_pixels.begin(), plain_pixels.end()));
}
