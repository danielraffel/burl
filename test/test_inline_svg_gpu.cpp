#include <catch2/catch_test_macros.hpp>

#include <pulp/view/design_frame_view.hpp>
#include <pulp/view/screenshot.hpp>
#include <pulp/view/screenshot_compare.hpp>
#include <pulp/view/widgets.hpp>


using namespace pulp::view;

namespace {
std::unique_ptr<DesignFrameView> icon() {
    return std::make_unique<DesignFrameView>(
        R"(<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00c950" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>)",
        std::vector<DesignFrameElement>{});
}

std::unique_ptr<ImageView> imported_image(const std::string& path) {
    auto image = std::make_unique<ImageView>();
    image->set_image_path(path);
    return image;
}
}

TEST_CASE("faithful inline SVG paints on live Dawn Graphite",
          "[view][import][svg][gpu]") {
    auto raster_view = icon();
    const auto raster = render_to_png(*raster_view, 24, 24, 2.0f,
                                      ScreenshotBackend::skia);
    REQUIRE_FALSE(raster.empty());
    REQUIRE(analyze_screenshot_content(raster).passes_content_floor());

    auto gpu_view = icon();
    gpu_view->set_requires_gpu_host(true);
    const auto gpu = capture_view(*gpu_view, 24, 24, 2.0f);
    if (gpu.png.empty()) SKIP("offscreen Dawn Graphite unavailable");
    REQUIRE(gpu.used == ScreenshotBackend::gpu);
    const auto comparison = compare_screenshots(raster, gpu.png, 32);
    REQUIRE(comparison.valid);
    CHECK(comparison.similarity > 0.50f);
}

TEST_CASE("imported image paints on live Dawn Graphite",
          "[view][import][image][gpu]") {
    const std::string path =
        PULP_SOURCE_DIR "/test/fixtures/import-fidelity/render_good.png";
    auto raster_view = imported_image(path);
    const auto raster = render_to_png(*raster_view, 160, 100, 1.0f,
                                      ScreenshotBackend::skia);
    REQUIRE(analyze_screenshot_content(raster).passes_content_floor());

    auto gpu_view = imported_image(path);
    gpu_view->set_requires_gpu_host(true);
    const auto gpu = capture_view(*gpu_view, 160, 100, 1.0f);
    if (gpu.png.empty()) SKIP("offscreen Dawn Graphite unavailable");
    REQUIRE(gpu.used == ScreenshotBackend::gpu);
    REQUIRE(gpu.ok);

    const auto comparison = compare_screenshots(raster, gpu.png, 24);
    REQUIRE(comparison.valid);
    CHECK(comparison.similarity > 0.90f);
}
