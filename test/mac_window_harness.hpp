#pragma once

/// @file mac_window_harness.hpp
/// Mac-only Catch2 test harness — headless NSWindow + CAMetalLayer fixture
/// (issue #2001).
///
/// The harness reuses the production `WindowHost` GPU path and exposes a
/// minimal API so tests can:
///
///   1. construct a hidden GPU window without orderFront / activation,
///   2. synthesize AppKit mouse events against its real content view,
///   3. read deterministic back-buffer PNG bytes.
///
/// The harness lives in `test/` only — never installed into the SDK. Its
/// primary production seam is `WindowHost::capture_back_buffer_png`.
///
/// Current consumers cover hidden GPU-window construction, back-buffer
/// PNG capture, and synthetic mouse/wheel/context-menu routing through
/// the real AppKit content view.
///
/// Planning context lives in
/// planning/2026-05-14-mac-platform-test-harness.md.

#include <pulp/view/input_events.hpp>
#include <pulp/view/window_host.hpp>

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <vector>

namespace pulp::view { class View; }

namespace pulp::test::mac {

/// One synthetic mouse event. Coordinates use Pulp logical pixels with
/// top-left origin (matching `View::on_mouse_event` semantics). The
/// harness handles the Cocoa bottom-left conversion internally.
struct SimulatedMouse {
    enum class Phase { down, up, move, drag, scroll };

    Phase phase = Phase::move;
    float x = 0.0f;
    float y = 0.0f;
    float mouse_delta_x = 0.0f;
    float mouse_delta_y = 0.0f;
    pulp::view::MouseButton button = pulp::view::MouseButton::left;
    uint16_t modifiers = 0;
    int click_count = 1;
    float scroll_delta_x = 0.0f;
    float scroll_delta_y = 0.0f;
};

/// One synthetic key edge dispatched through the production AppKit responder.
/// The harness maps the portable Pulp key code to the native macOS virtual key
/// code; unsupported keys fail closed instead of guessing character data.
struct SimulatedKey {
    enum class Phase { down, up };

    Phase phase = Phase::down;
    pulp::view::KeyCode key = pulp::view::KeyCode::unknown;
    uint16_t modifiers = 0;
    bool is_repeat = false;
};

struct BackBufferFrameCapture {
    uint32_t frame_index = 0;
    uint64_t elapsed_ms = 0;
    std::vector<uint8_t> png;
};

struct InteractionTrace {
    float x = 0.0f;
    float y = 0.0f;
    std::string press_target;
    std::string release_target;
    std::string actionable_ancestor;
    uint64_t outcome_before = 0;
    uint64_t outcome_after = 0;
    bool down_dispatched = false;
    bool up_dispatched = false;
    bool action_fired = false;
};

struct NativeContentGeometry {
    float window_width = 0.0f;
    float window_height = 0.0f;
    float hosted_width = 0.0f;
    float hosted_height = 0.0f;
};

struct NativeAppearanceSnapshot {
    std::uintptr_t window_identity = 0;
    std::uintptr_t effect_identity = 0;
    bool has_explicit_window_appearance = false;
    std::string window_best_match;
    std::string effect_best_match;
};

/// Native composition facts that are independent from the pixels painted by
/// the Burl View tree. A transparent AppKit/Metal stack can still be visually
/// opaque when the imported root paints a full-window opaque background, so
/// tests must inspect both this receipt and captured back-buffer alpha.
struct NativeBackdropSnapshot {
    bool window_opaque = true;
    bool has_glass_effect_view = false;
    bool glass_and_content_share_container = false;
    bool hosted_view_opaque = true;
    bool hosted_layer_opaque = true;
    double hosted_layer_background_alpha = 1.0;
    double hosted_inset_left = 0.0;
    double hosted_inset_top = 0.0;
    double hosted_inset_right = 0.0;
    double hosted_inset_bottom = 0.0;
};

/// A test-owned, visible AppKit window containing a distinctive checkerboard.
/// It is ordered immediately behind the supplied production WindowHost so a
/// system-composited capture can prove whether native glass samples pixels from
/// outside Burl's own Skia/Dawn surface. This fixture never ships in the SDK.
class LivePatternBackdrop final {
public:
    ~LivePatternBackdrop();
    LivePatternBackdrop(LivePatternBackdrop&&) noexcept;
    LivePatternBackdrop& operator=(LivePatternBackdrop&&) noexcept;
    LivePatternBackdrop(const LivePatternBackdrop&) = delete;
    LivePatternBackdrop& operator=(const LivePatternBackdrop&) = delete;

    /// Swap between two high-contrast palettes while retaining the same
    /// window geometry and z-order. Returns false if the native fixture is no
    /// longer valid.
    bool set_variant(std::uint32_t variant);

private:
    struct Impl;
    explicit LivePatternBackdrop(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> impl_;
    friend std::unique_ptr<LivePatternBackdrop>
    show_live_pattern_backdrop(pulp::view::WindowHost& host);
};

/// Show the otherwise-hidden production test window and place a patterned
/// AppKit window directly below it. Returns null on non-main-thread use or
/// missing native handles. Destroying the fixture orders both windows out.
std::unique_ptr<LivePatternBackdrop>
show_live_pattern_backdrop(pulp::view::WindowHost& host);

/// Construct a hidden GPU-backed NSWindow + CAMetalLayer host suitable for
/// unit tests. Must be called on the main thread. Forces
/// `options.use_gpu = true` and
/// `options.initially_hidden = true` so callers cannot accidentally pop a
/// real window during a test run.
///
/// Returns nullptr on any failure (host construction, native handles
/// missing, gpu_surface unavailable). Never throws.
///
/// Ownership: the caller owns the returned host. The `root` view must
/// outlive the host, matching `WindowHost::create()` semantics.
std::unique_ptr<pulp::view::WindowHost>
make_test_window(pulp::view::View& root,
                 pulp::view::WindowOptions options = {});

/// Synthesize a single AppKit mouse event against the host's content view and
/// drain the main run-loop once so deferred click handlers (which
/// `PulpView::mouseUp:` posts via `dispatch_async`) settle before the
/// caller asserts or captures. Must be called on the main thread.
///
/// Returns false on null handles, zero content size, or unsupported
/// phase. Never throws.
bool simulate_mouse(pulp::view::WindowHost& host, const SimulatedMouse& event);

/// Synthesize one AppKit keyDown:/keyUp: edge against the real production
/// content view and drain the main queue. Returns false when the portable key
/// has no reviewed macOS mapping.
bool simulate_key(pulp::view::WindowHost& host, const SimulatedKey& event);

/// Dispatch one production AppKit click while recording coordinate-level
/// routing evidence from the hosted View tree. `outcome_counter` should return
/// a monotonic application-observable count; omit it when target routing alone
/// is the assertion. Target identities prefer stable anchors and fall back to
/// View ids, so imported controls remain diagnosable across rematerialization.
InteractionTrace simulate_click_traced(
    pulp::view::WindowHost& host,
    pulp::view::View& root,
    float x,
    float y,
    std::function<uint64_t()> outcome_counter = {});

/// Wrapper over `WindowHost::capture_back_buffer_png` that drains the
/// main queue once first so any pending render / deferred state mutations
/// are ordered before the readback. Must be called on the main thread.
/// Returns the host's PNG bytes (may be
/// empty on capture failure — the harness does not raise).
std::vector<uint8_t> capture_back_buffer_png(pulp::view::WindowHost& host);

/// Capture the complete AppKit content hierarchy (synthetic backdrop plus
/// transparent CAMetalLayer) for deterministic window-compositing assertions.
std::vector<uint8_t> capture_composited_content_png(pulp::view::WindowHost& host);

/// Capture the composited surface together with its ownership and determinism
/// classification. Tests making glass/backdrop claims should assert this
/// receipt rather than accepting any non-empty PNG.
pulp::view::WindowCaptureReceipt capture_composited_content(
    pulp::view::WindowHost& host);

/// Capture several host-managed frames through the same production
/// `WindowHost::capture_back_buffer_png` path. Each frame drains the main queue
/// first and records elapsed milliseconds from the start of the settled capture
/// so tests can report how many frames were pumped before judging a screenshot.
/// Must be called on the main thread.
std::vector<BackBufferFrameCapture>
capture_settled_back_buffer_png(pulp::view::WindowHost& host,
                                uint32_t frame_count = 3);

/// Resize the native NSWindow content rect, clamped to its production
/// `contentMinSize`, and report both the outer AppKit content-view bounds and
/// the Pulp render view bounds after layout settles.
/// This catches wrapper views (visual effect / liquid glass) that resize while
/// leaving the CAMetalLayer-backed child at its original dimensions.
NativeContentGeometry resize_and_measure_native_content(
    pulp::view::WindowHost& host, float width, float height);

/// Read the NSWindow and backdrop appearance without exposing AppKit types to
/// C++ tests. Identity fields prove runtime changes retain the native objects.
NativeAppearanceSnapshot inspect_native_appearance(
    pulp::view::WindowHost& host);

/// Inspect the production NSWindow/NSGlassEffectView/CAMetalLayer hierarchy.
/// This does not infer whether Burl paint covers the backdrop; callers pair it
/// with `capture_back_buffer_png()` and alpha-content statistics for that.
NativeBackdropSnapshot inspect_native_backdrop(
    pulp::view::WindowHost& host);

/// Map a point from a view's local paint coordinates into the root coordinate
/// space consumed by View::hit_test and the AppKit input bridge. The walk
/// composes every nested bounds translation and CSS affine transform in paint
/// order. Returns nullopt when `root` is not an ancestor of `view`.
std::optional<pulp::view::Point> visual_point_in_root(
    const pulp::view::View& view,
    const pulp::view::View& root,
    pulp::view::Point local_point);

} // namespace pulp::test::mac
