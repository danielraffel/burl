#include <pulp/view/css_gradient.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/view.hpp>

#include <catch2/catch_test_macros.hpp>

#include <cstddef>
#include <cstdint>
#include <vector>

using namespace pulp::view;

namespace {

struct Pixel {
    uint8_t r;
    uint8_t g;
    uint8_t b;
    uint8_t a;
};

Pixel sample(const std::vector<uint8_t>& rgba, uint32_t width, uint32_t x, uint32_t y) {
    const auto offset = (static_cast<std::size_t>(y) * width + x) * 4;
    return {rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]};
}

}  // namespace

TEST_CASE("canonical imported gradient angles reach the native view", "[view][import][gradient]") {
    View view;
    REQUIRE(apply_css_background_gradient(
        view, "linear-gradient(90deg, #ff0000ff 0%, #0000ffff 100%)"));
    REQUIRE_FALSE(apply_css_background_gradient(view, "linear-gradient(90deg"));
}

TEST_CASE("imported linear and radial gradients produce directional Skia pixels",
          "[view][import][gradient][skia]") {
    View view;
    view.set_bounds({0, 0, 96, 48});
    REQUIRE(apply_css_background_gradient(
        view, "linear-gradient(90deg, #ff0000ff 0%, #0000ffff 100%)"));

    uint32_t width = 0;
    uint32_t height = 0;
    auto rgba = render_to_rgba(view, 96, 48, 1.0f, &width, &height);
    if (rgba.empty()) {
        SUCCEED("Skia raster capture is unavailable in this build");
        return;
    }
    REQUIRE(width == 96);
    REQUIRE(height == 48);
    const auto left = sample(rgba, width, 4, 24);
    const auto right = sample(rgba, width, 91, 24);
    REQUIRE(left.r > left.b * 3);
    REQUIRE(right.b > right.r * 3);

    REQUIRE(apply_css_background_gradient(
        view, "radial-gradient(circle at 50% 50%, #ffffffff 0%, #000000ff 100%)"));
    rgba = render_to_rgba(view, 96, 48, 1.0f, &width, &height);
    REQUIRE_FALSE(rgba.empty());
    const auto center = sample(rgba, width, 48, 24);
    const auto edge = sample(rgba, width, 1, 1);
    REQUIRE(center.r > edge.r + 100);
    REQUIRE(center.g > edge.g + 100);
    REQUIRE(center.b > edge.b + 100);
}
