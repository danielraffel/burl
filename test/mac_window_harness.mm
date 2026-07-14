// Mac-only Catch2 test harness — implementation. See header for the contract.
//
// issue #2001 — provides a hidden NSWindow + CAMetalLayer fixture that
// reuses the production WindowHost path. The "trick" is twofold:
//
//   1. WindowOptions{ initially_hidden=true, use_gpu=true } gets the host
//      to construct a real NSWindow + CAMetalLayer + render::GpuSurface
//      without ever calling makeKeyAndOrderFront / activateIgnoringOtherApps
//      (those only fire from `run_event_loop()`, which the harness never
//      invokes — construction alone is sufficient).
//
//   2. PulpView::mouseUp: defers the click handler via dispatch_async to
//      the main queue, so the harness MUST drain the main run loop after
//      every synthetic event or click-driven state changes will appear
//      "missing" relative to a subsequent capture / assertion.

#import "mac_window_harness.hpp"

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <pulp/view/view.hpp>
#import <pulp/view/window_host.hpp>

#include <chrono>
#include <cmath>
#include <optional>

namespace {

// Drain the main run loop so any pending dispatch_async work (notably
// PulpView's deferred click handler) settles before the caller asserts.
// Spins the run loop briefly with a near-zero deadline rather than
// sleeping; this is the lightest-weight reliable settle on AppKit.
bool is_main_thread() {
    return [NSThread isMainThread];
}

void drain_main_queue_once() {
    @autoreleasepool {
        __block BOOL drained = NO;
        dispatch_async(dispatch_get_main_queue(), ^{ drained = YES; });
        NSDate* deadline = [NSDate dateWithTimeIntervalSinceNow:0.05];
        while (!drained && [deadline timeIntervalSinceNow] > 0.0) {
            [[NSRunLoop currentRunLoop]
                runMode:NSDefaultRunLoopMode
                beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.001]];
        }
    }
}

NSPoint cg_screen_point_for_window_location(NSWindow* window, NSPoint location) {
    NSPoint screen_pt = [window convertPointToScreen:location];
    NSScreen* screen = [window screen];
    if (!screen) screen = [[NSScreen screens] firstObject];
    if (!screen) return screen_pt;

    // Cocoa screen coordinates are bottom-left in the screen's frame; CGEvent
    // locations are top-left. Flip in the window's actual screen frame so
    // hidden-host tests do not depend on the primary display.
    const NSRect frame = [screen frame];
    screen_pt.y = NSMinY(frame) + NSHeight(frame) - (screen_pt.y - NSMinY(frame));
    return screen_pt;
}

// Build an NSEvent for the given simulated mouse event. Coordinates are
// converted from Pulp top-left logical coords to Cocoa bottom-left
// window coords using the host's content size.
NSEvent* build_event(NSWindow* window,
                     pulp::view::WindowHost::ContentSize content,
                     const pulp::test::mac::SimulatedMouse& ev) {
    if (!window || content.width == 0 || content.height == 0) return nil;

    NSPoint location = NSMakePoint(
        static_cast<CGFloat>(ev.x),
        // top-left → bottom-left flip
        static_cast<CGFloat>(static_cast<float>(content.height) - ev.y));

    NSEventType type;
    switch (ev.phase) {
        case pulp::test::mac::SimulatedMouse::Phase::down:    type = NSEventTypeLeftMouseDown;    break;
        case pulp::test::mac::SimulatedMouse::Phase::up:      type = NSEventTypeLeftMouseUp;      break;
        case pulp::test::mac::SimulatedMouse::Phase::move:    type = NSEventTypeMouseMoved;       break;
        case pulp::test::mac::SimulatedMouse::Phase::drag:    type = NSEventTypeLeftMouseDragged; break;
        case pulp::test::mac::SimulatedMouse::Phase::scroll:  type = NSEventTypeScrollWheel;      break;
    }

    if (ev.button == pulp::view::MouseButton::right) {
        if (type == NSEventTypeLeftMouseDown)    type = NSEventTypeRightMouseDown;
        if (type == NSEventTypeLeftMouseUp)      type = NSEventTypeRightMouseUp;
        if (type == NSEventTypeLeftMouseDragged) type = NSEventTypeRightMouseDragged;
    } else if (ev.button == pulp::view::MouseButton::middle) {
        if (type == NSEventTypeLeftMouseDown)    type = NSEventTypeOtherMouseDown;
        if (type == NSEventTypeLeftMouseUp)      type = NSEventTypeOtherMouseUp;
        if (type == NSEventTypeLeftMouseDragged) type = NSEventTypeOtherMouseDragged;
    }

    if (type == NSEventTypeScrollWheel) {
        // Regression coverage: `+[NSEvent mouseEventWithType:]` does NOT carry
        // scrolling deltas — the produced event reports `scrollingDeltaX/Y == 0`,
        // so the synthetic scroll falls through `PulpView::scrollWheel:` as a
        // no-op and tests pass while exercising nothing. Build the event via a
        // CGEvent source so `event.scrollingDeltaX/Y` reflect the requested
        // deltas. Axis order: CGEventCreateScrollWheelEvent2's
        // variadic wheel args are (wheel1, wheel2) ≡ (Y, X).
        CGEventRef cge = CGEventCreateScrollWheelEvent2(
            /* source */ NULL,
            kCGScrollEventUnitPixel,
            /* wheelCount */ 2,
            static_cast<int32_t>(ev.scroll_delta_y),
            static_cast<int32_t>(ev.scroll_delta_x),
            0);
        if (!cge) return nil;
        // Regression coverage: set the CGEvent location so
        // `event.locationInWindow` lands at the harness-requested coordinates
        // instead of the current OS cursor position. PulpView::scrollWheel:
        // hit-tests from locationInWindow, so without this, scroll tests
        // targeted at a specific subview are dropped or routed wherever the
        // cursor happened to be.
        // CGEvent uses screen-space; convert via the window's screen frame.
        NSPoint screen_pt = cg_screen_point_for_window_location(window, location);
        CGEventSetLocation(cge, CGPointMake(screen_pt.x, screen_pt.y));
        NSEvent* event = [NSEvent eventWithCGEvent:cge];
        CFRelease(cge);
        return event;
    }

    if (ev.mouse_delta_x != 0.0f || ev.mouse_delta_y != 0.0f) {
        CGEventType cg_type = kCGEventMouseMoved;
        CGMouseButton cg_button = kCGMouseButtonLeft;
        switch (type) {
            case NSEventTypeLeftMouseDown:    cg_type = kCGEventLeftMouseDown;    break;
            case NSEventTypeLeftMouseUp:      cg_type = kCGEventLeftMouseUp;      break;
            case NSEventTypeLeftMouseDragged: cg_type = kCGEventLeftMouseDragged; break;
            case NSEventTypeRightMouseDown:   cg_type = kCGEventRightMouseDown;   cg_button = kCGMouseButtonRight; break;
            case NSEventTypeRightMouseUp:     cg_type = kCGEventRightMouseUp;     cg_button = kCGMouseButtonRight; break;
            case NSEventTypeRightMouseDragged: cg_type = kCGEventRightMouseDragged; cg_button = kCGMouseButtonRight; break;
            case NSEventTypeOtherMouseDown:   cg_type = kCGEventOtherMouseDown;   cg_button = kCGMouseButtonCenter; break;
            case NSEventTypeOtherMouseUp:     cg_type = kCGEventOtherMouseUp;     cg_button = kCGMouseButtonCenter; break;
            case NSEventTypeOtherMouseDragged: cg_type = kCGEventOtherMouseDragged; cg_button = kCGMouseButtonCenter; break;
            case NSEventTypeMouseMoved:       cg_type = kCGEventMouseMoved;       break;
            default: break;
        }

        NSPoint screen_pt = cg_screen_point_for_window_location(window, location);

        CGEventRef cge = CGEventCreateMouseEvent(
            /* source */ NULL,
            cg_type,
            CGPointMake(screen_pt.x, screen_pt.y),
            cg_button);
        if (!cge) return nil;
        CGEventSetIntegerValueField(cge,
                                    kCGMouseEventDeltaX,
                                    static_cast<int64_t>(ev.mouse_delta_x));
        CGEventSetIntegerValueField(cge,
                                    kCGMouseEventDeltaY,
                                    static_cast<int64_t>(ev.mouse_delta_y));
        NSEvent* event = [NSEvent eventWithCGEvent:cge];
        CFRelease(cge);
        if (event) return event;
    }

    return [NSEvent
        mouseEventWithType:type
                  location:location
             modifierFlags:0
                 timestamp:[[NSProcessInfo processInfo] systemUptime]
              windowNumber:[window windowNumber]
                   context:nil
               eventNumber:0
                clickCount:ev.click_count
                  pressure:(ev.phase == pulp::test::mac::SimulatedMouse::Phase::down ? 1.0f : 0.0f)];
}

std::optional<unsigned short> native_key_code(pulp::view::KeyCode key) {
    using pulp::view::KeyCode;
    switch (key) {
        case KeyCode::escape: return 53;
        case KeyCode::tab: return 48;
        case KeyCode::enter: return 36;
        case KeyCode::space: return 49;
        case KeyCode::left: return 123;
        case KeyCode::right: return 124;
        case KeyCode::down: return 125;
        case KeyCode::up: return 126;
        default: return std::nullopt;
    }
}

NSString* native_key_characters(pulp::view::KeyCode key) {
    using pulp::view::KeyCode;
    switch (key) {
        case KeyCode::escape: return @"\x1b";
        case KeyCode::tab: return @"\t";
        case KeyCode::enter: return @"\r";
        case KeyCode::space: return @" ";
        case KeyCode::left: return [NSString stringWithFormat:@"%C", static_cast<unichar>(NSLeftArrowFunctionKey)];
        case KeyCode::right: return [NSString stringWithFormat:@"%C", static_cast<unichar>(NSRightArrowFunctionKey)];
        case KeyCode::down: return [NSString stringWithFormat:@"%C", static_cast<unichar>(NSDownArrowFunctionKey)];
        case KeyCode::up: return [NSString stringWithFormat:@"%C", static_cast<unichar>(NSUpArrowFunctionKey)];
        default: return @"";
    }
}

NSEventModifierFlags native_modifier_flags(uint16_t modifiers) {
    NSEventModifierFlags flags = 0;
    if (modifiers & pulp::view::kModShift) flags |= NSEventModifierFlagShift;
    if (modifiers & pulp::view::kModCtrl) flags |= NSEventModifierFlagControl;
    if (modifiers & pulp::view::kModAlt) flags |= NSEventModifierFlagOption;
    if (modifiers & (pulp::view::kModMeta | pulp::view::kModCmd))
        flags |= NSEventModifierFlagCommand;
    return flags;
}

} // namespace

namespace pulp::test::mac {

std::optional<pulp::view::Point> visual_point_in_root(
    const pulp::view::View& view,
    const pulp::view::View& root,
    pulp::view::Point point) {
    const auto apply_affine = [](pulp::view::Point value,
                                 float a, float b, float c,
                                 float d, float e, float f) {
        return pulp::view::Point{
            a * value.x + c * value.y + e,
            b * value.x + d * value.y + f,
        };
    };

    for (auto* current = &view; current; current = current->parent()) {
        if (current->has_transform_matrix()) {
            float a = 1.0f, b = 0.0f, c = 0.0f;
            float d = 1.0f, e = 0.0f, f = 0.0f;
            current->get_transform_matrix(a, b, c, d, e, f);
            const float ox = current->transform_origin_explicit()
                ? current->transform_origin_local_x() : 0.0f;
            const float oy = current->transform_origin_explicit()
                ? current->transform_origin_local_y() : 0.0f;
            point.x -= ox;
            point.y -= oy;
            point = apply_affine(point, a, b, c, d, e, f);
            point.x += ox;
            point.y += oy;
        }

        if (current->scale() != 1.0f || current->rotation() != 0.0f ||
            current->translate_x() != 0.0f || current->translate_y() != 0.0f) {
            const float ox = current->transform_origin_local_x();
            const float oy = current->transform_origin_local_y();
            point.x -= ox;
            point.y -= oy;
            point.x *= current->scale();
            point.y *= current->scale();
            const float radians = current->rotation() * 3.14159265358979323846f / 180.0f;
            const float cosine = std::cos(radians);
            const float sine = std::sin(radians);
            point = {cosine * point.x - sine * point.y,
                     sine * point.x + cosine * point.y};
            point.x += ox + current->translate_x();
            point.y += oy + current->translate_y();
        }

        if (current == &root) return point;
        point.x += current->bounds().x;
        point.y += current->bounds().y;
    }
    return std::nullopt;
}

std::unique_ptr<pulp::view::WindowHost>
make_test_window(pulp::view::View& root, pulp::view::WindowOptions options) {
    if (!is_main_thread()) return nullptr;

    @autoreleasepool {
        // Ensure NSApplication exists so NSWindow construction has a
        // running app to attach to. Safe to call repeatedly.
        (void)[NSApplication sharedApplication];

        // Force the harness contract: GPU host, never visible.
        options.use_gpu = true;
        options.initially_hidden = true;
        if (options.width <= 0)  options.width  = 320;
        if (options.height <= 0) options.height = 240;

        auto host = pulp::view::WindowHost::create(root, options);
        if (!host)                                return nullptr;
        if (!host->native_window_handle())        return nullptr;
        if (!host->native_content_view_handle())  return nullptr;
        if (!host->gpu_surface())                 return nullptr;

        // Make the content view first responder so synthetic input
        // routes correctly without depending on the window having been
        // shown / made key.
        NSWindow* window = (__bridge NSWindow*)host->native_window_handle();
        NSView*   view   = (__bridge NSView*)host->native_content_view_handle();
        if (window && view) {
            [window setInitialFirstResponder:view];
            (void)[window makeFirstResponder:view];
        }

        return host;
    }
}

bool simulate_mouse(pulp::view::WindowHost& host, const SimulatedMouse& event) {
    if (!is_main_thread()) return false;

    @autoreleasepool {
        NSWindow* window = (__bridge NSWindow*)host.native_window_handle();
        NSView*   view   = (__bridge NSView*)host.native_content_view_handle();
        if (!window || !view) return false;

        const auto content = host.get_content_size();
        if (content.width == 0 || content.height == 0) return false;

        NSEvent* nsevent = build_event(window, content, event);
        if (!nsevent) return false;

        // Regression coverage: `build_event` correctly stamped
        // NSEventType{Right,Other}Mouse* based on `event.button`, but the
        // dispatch below previously routed every phase through
        // `mouseDown:`/`mouseUp:`/`mouseDragged:`. That meant a right-click test
        // exercised `mouseDown:` (single-click path) instead of
        // `rightMouseDown:` (context-menu path), and middle-clicks never reached
        // `otherMouseDown:`. Route by button so synthetic right/middle clicks hit
        // the matching selectors on PulpView.
        switch (event.phase) {
            case SimulatedMouse::Phase::down:
                if (event.button == pulp::view::MouseButton::right)
                    [view rightMouseDown:nsevent];
                else if (event.button == pulp::view::MouseButton::middle)
                    [view otherMouseDown:nsevent];
                else
                    [view mouseDown:nsevent];
                break;
            case SimulatedMouse::Phase::up:
                if (event.button == pulp::view::MouseButton::right)
                    [view rightMouseUp:nsevent];
                else if (event.button == pulp::view::MouseButton::middle)
                    [view otherMouseUp:nsevent];
                else
                    [view mouseUp:nsevent];
                break;
            case SimulatedMouse::Phase::move:
                [view mouseMoved:nsevent];
                break;
            case SimulatedMouse::Phase::drag:
                if (event.button == pulp::view::MouseButton::right)
                    [view rightMouseDragged:nsevent];
                else if (event.button == pulp::view::MouseButton::middle)
                    [view otherMouseDragged:nsevent];
                else
                    [view mouseDragged:nsevent];
                break;
            case SimulatedMouse::Phase::scroll:
                [view scrollWheel:nsevent];
                break;
            default:
                return false;
        }

        // Settle the deferred click handler from PulpView::mouseUp:.
        drain_main_queue_once();
        return true;
    }
}

bool simulate_key(pulp::view::WindowHost& host, const SimulatedKey& event) {
    if (!is_main_thread()) return false;

    @autoreleasepool {
        NSWindow* window = (__bridge NSWindow*)host.native_window_handle();
        NSView* view = (__bridge NSView*)host.native_content_view_handle();
        if (!window || !view) return false;
        const auto key_code = native_key_code(event.key);
        if (!key_code) return false;
        const auto type = event.phase == SimulatedKey::Phase::down
            ? NSEventTypeKeyDown : NSEventTypeKeyUp;
        NSString* characters = native_key_characters(event.key);
        NSEvent* nsevent = [NSEvent keyEventWithType:type
                                              location:NSZeroPoint
                                         modifierFlags:native_modifier_flags(event.modifiers)
                                             timestamp:[[NSProcessInfo processInfo] systemUptime]
                                          windowNumber:[window windowNumber]
                                               context:nil
                                            characters:characters
                           charactersIgnoringModifiers:characters
                                              isARepeat:event.is_repeat
                                                keyCode:*key_code];
        if (!nsevent) return false;
        if (event.phase == SimulatedKey::Phase::down)
            [view keyDown:nsevent];
        else
            [view keyUp:nsevent];
        drain_main_queue_once();
        return true;
    }
}

InteractionTrace simulate_click_traced(
    pulp::view::WindowHost& host,
    pulp::view::View& root,
    float x,
    float y,
    std::function<uint64_t()> outcome_counter) {
    InteractionTrace trace;
    trace.x = x;
    trace.y = y;
    const auto identity = [](const pulp::view::View* view) {
        if (!view) return std::string{"<none>"};
        if (!view->anchor_id().empty()) return view->anchor_id();
        if (!view->id().empty()) return view->id();
        return std::string{"<anonymous>"};
    };
    auto* press = root.hit_test({x, y});
    trace.press_target = identity(press);
    auto* actionable = press;
    while (actionable && !actionable->on_click && !actionable->wants_mouse_input() &&
           !actionable->focusable())
        actionable = actionable->parent();
    trace.actionable_ancestor = identity(actionable);
    trace.outcome_before = outcome_counter ? outcome_counter() : 0;

    SimulatedMouse down{.phase = SimulatedMouse::Phase::down, .x = x, .y = y};
    trace.down_dispatched = simulate_mouse(host, down);
    trace.release_target = identity(root.hit_test({x, y}));
    SimulatedMouse up = down;
    up.phase = SimulatedMouse::Phase::up;
    trace.up_dispatched = simulate_mouse(host, up);
    trace.outcome_after = outcome_counter ? outcome_counter() : trace.outcome_before;
    trace.action_fired = outcome_counter && trace.outcome_after > trace.outcome_before;
    return trace;
}

std::vector<uint8_t> capture_composited_content_png(pulp::view::WindowHost& host) {
    return capture_composited_content(host).png;
}

pulp::view::WindowCaptureReceipt capture_composited_content(
    pulp::view::WindowHost& host) {
    if (!is_main_thread()) return {};
    drain_main_queue_once();
    return host.capture_composited_png();
}

std::vector<uint8_t> capture_back_buffer_png(pulp::view::WindowHost& host) {
    if (!is_main_thread()) return {};

    drain_main_queue_once();
    return host.capture_back_buffer_png();
}

std::vector<BackBufferFrameCapture>
capture_settled_back_buffer_png(pulp::view::WindowHost& host,
                                uint32_t frame_count) {
    if (!is_main_thread()) return {};

    std::vector<BackBufferFrameCapture> frames;
    frames.reserve(frame_count);

    const auto start = std::chrono::steady_clock::now();
    for (uint32_t i = 0; i < frame_count; ++i) {
        drain_main_queue_once();
        BackBufferFrameCapture frame;
        frame.frame_index = i;
        frame.png = host.capture_back_buffer_png();
        frame.elapsed_ms = static_cast<uint64_t>(
            std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - start).count());
        frames.push_back(std::move(frame));
    }
    return frames;
}

NativeContentGeometry resize_and_measure_native_content(
    pulp::view::WindowHost& host, float width, float height) {
    @autoreleasepool {
        NSWindow* window = (__bridge NSWindow*)host.native_window_handle();
        NSView* hosted = (__bridge NSView*)host.native_content_view_handle();
        if (!window || !hosted) return {};
        const NSSize minimum = window.contentMinSize;
        [window setContentSize:NSMakeSize(std::max(width, static_cast<float>(minimum.width)),
                                         std::max(height, static_cast<float>(minimum.height)))];
        [window.contentView layoutSubtreeIfNeeded];
        drain_main_queue_once();
        [window.contentView layoutSubtreeIfNeeded];
        const NSSize windowSize = window.contentView.bounds.size;
        const NSSize hostedSize = hosted.bounds.size;
        return {
            static_cast<float>(windowSize.width),
            static_cast<float>(windowSize.height),
            static_cast<float>(hostedSize.width),
            static_cast<float>(hostedSize.height),
        };
    }
}

NativeAppearanceSnapshot inspect_native_appearance(
    pulp::view::WindowHost& host) {
    @autoreleasepool {
        NSWindow* window = (__bridge NSWindow*)host.native_window_handle();
        if (!window) return {};
        drain_main_queue_once();

        NSView* hosted = (__bridge NSView*)host.native_content_view_handle();
        NSView* effect = nil;
        for (NSView* sibling in window.contentView.subviews) {
            if (sibling != hosted) {
                effect = sibling;
                break;
            }
        }
#if __MAC_OS_X_VERSION_MAX_ALLOWED >= 260000
        if (@available(macOS 26.0, *)) {
            if ([window.contentView isKindOfClass:[NSGlassEffectView class]])
                effect = window.contentView;
        }
#endif

        NSArray<NSAppearanceName>* matches = @[
            NSAppearanceNameAqua,
            NSAppearanceNameDarkAqua,
        ];
        NSAppearanceName window_match = [window.effectiveAppearance
            bestMatchFromAppearancesWithNames:matches];
        NSAppearanceName effect_match = effect ? [effect.effectiveAppearance
            bestMatchFromAppearancesWithNames:matches] : nil;
        const auto to_string = [](NSString* value) {
            return value ? std::string(value.UTF8String) : std::string{};
        };
        return {
            reinterpret_cast<std::uintptr_t>((__bridge void*)window),
            reinterpret_cast<std::uintptr_t>((__bridge void*)effect),
            window.appearance != nil,
            to_string(window_match),
            to_string(effect_match),
        };
    }
}

} // namespace pulp::test::mac
