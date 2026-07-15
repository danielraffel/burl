// Per-binary-unique ObjC class names (see header).
#include "pulp_mac_objc_names.h"
// window_host_mac_capture.mm — PNG / capture helpers for the macOS
// window host.
//
// Only free functions that don't touch PulpView ivars live here; PulpView's
// @implementation and ivars stay in window_host_mac.mm.

#include "window_host_mac_capture.h"

#include <TargetConditionals.h>
#if TARGET_OS_OSX

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#include <algorithm>
#include <cmath>
#include <cstring>

namespace pulp::view::mac_capture {

std::vector<uint8_t> nsdata_to_bytes(NSData* data) {
    if (!data || data.length == 0) return {};
    std::vector<uint8_t> bytes(static_cast<size_t>(data.length));
    memcpy(bytes.data(), data.bytes, static_cast<size_t>(data.length));
    return bytes;
}

std::vector<uint8_t> bitmap_rep_to_png(NSBitmapImageRep* rep) {
    if (!rep) return {};
    NSData* data = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    return nsdata_to_bytes(data);
}

std::vector<uint8_t> encode_rgba_to_png(const uint8_t* pixels,
                                        uint32_t pixel_w,
                                        uint32_t pixel_h,
                                        size_t row_bytes) {
    if (!pixels || pixel_w == 0 || pixel_h == 0) return {};

    CGColorSpaceRef color_space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    if (!color_space) return {};

    CGBitmapInfo bitmap_info =
        static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast) |
        static_cast<CGBitmapInfo>(kCGBitmapByteOrderDefault);

    CGDataProviderRef provider = CGDataProviderCreateWithData(
        nullptr, pixels, row_bytes * pixel_h, nullptr);
    if (!provider) {
        CGColorSpaceRelease(color_space);
        return {};
    }

    CGImageRef image = CGImageCreate(
        pixel_w, pixel_h,
        8, 32,
        row_bytes,
        color_space,
        bitmap_info,
        provider,
        nullptr,
        false,
        kCGRenderingIntentDefault);

    CGDataProviderRelease(provider);
    CGColorSpaceRelease(color_space);
    if (!image) return {};

    NSBitmapImageRep* rep = [[NSBitmapImageRep alloc] initWithCGImage:image];
    CGImageRelease(image);
    return bitmap_rep_to_png(rep);
}

std::vector<uint8_t> capture_view_cache_png(NSView* view) {
    if (!view) return {};
    NSRect bounds = [view bounds];
    if (bounds.size.width <= 0 || bounds.size.height <= 0) return {};
    NSBitmapImageRep* rep = [view bitmapImageRepForCachingDisplayInRect:bounds];
    if (!rep) return {};
    [view cacheDisplayInRect:bounds toBitmapImageRep:rep];
    return bitmap_rep_to_png(rep);
}

std::vector<uint8_t> capture_window_content_png(NSWindow* window, NSView* contentView) {
    if (!window || !contentView) return {};

    [window displayIfNeeded];
    [contentView displayIfNeeded];
    return capture_view_cache_png(contentView);
}

std::vector<uint8_t> capture_window_screencapture_png(NSWindow* window) {
    if (!window) return {};

    NSString* temp_name = [NSString stringWithFormat:@"pulp-window-capture-%@.png", NSUUID.UUID.UUIDString];
    NSString* temp_path = [NSTemporaryDirectory() stringByAppendingPathComponent:temp_name];
    // A window-id capture returns the window's isolated surface, preserving
    // alpha but omitting the desktop and windows beneath it. That is useful for
    // asset extraction, but cannot support a receipt claiming that native
    // behind-window material was observed. Capture the window's actual screen
    // rectangle instead so the PNG contains the WindowServer composition.
    NSScreen* screen = window.screen ?: NSScreen.mainScreen;
    if (!screen) return {};
    const NSRect frame = window.frame;
    const NSRect screen_frame = screen.frame;
    const NSInteger x = static_cast<NSInteger>(std::llround(NSMinX(frame)));
    const NSInteger y = static_cast<NSInteger>(std::llround(
        NSMaxY(screen_frame) - NSMaxY(frame) + NSMinY(screen_frame)));
    const NSInteger width = static_cast<NSInteger>(std::llround(NSWidth(frame)));
    const NSInteger height = static_cast<NSInteger>(std::llround(NSHeight(frame)));
    if (width <= 0 || height <= 0) return {};
    NSString* region_arg = [NSString stringWithFormat:@"-R%ld,%ld,%ld,%ld",
        static_cast<long>(x), static_cast<long>(y),
        static_cast<long>(width), static_cast<long>(height)];

    NSTask* task = [[NSTask alloc] init];
    task.launchPath = @"/usr/sbin/screencapture";
    task.arguments = @[ @"-x", region_arg, temp_path ];

    @try {
        [task launch];
        [task waitUntilExit];
    } @catch (NSException*) {
        [[NSFileManager defaultManager] removeItemAtPath:temp_path error:nil];
        return {};
    }

    if (task.terminationStatus != 0) {
        [[NSFileManager defaultManager] removeItemAtPath:temp_path error:nil];
        return {};
    }

    NSData* data = [NSData dataWithContentsOfFile:temp_path];
    [[NSFileManager defaultManager] removeItemAtPath:temp_path error:nil];
    return nsdata_to_bytes(data);
}

std::vector<uint8_t> composite_over_synthetic_backdrop_png(
    const std::vector<uint8_t>& foreground_png,
    double points_w,
    double points_h) {
    if (foreground_png.empty() || points_w <= 0 || points_h <= 0) return {};
    NSData* encoded = [NSData dataWithBytes:foreground_png.data()
                                    length:foreground_png.size()];
    NSBitmapImageRep* source = [[NSBitmapImageRep alloc] initWithData:encoded];
    if (!source || source.pixelsWide <= 0 || source.pixelsHigh <= 0) return {};

    const NSInteger width = source.pixelsWide;
    const NSInteger height = source.pixelsHigh;
    std::vector<uint8_t> source_rgba(static_cast<size_t>(width * height * 4));
    CGColorSpaceRef source_space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    if (!source_space) return {};
    CGContextRef source_context = CGBitmapContextCreate(
        source_rgba.data(), static_cast<size_t>(width), static_cast<size_t>(height),
        8, static_cast<size_t>(width * 4), source_space,
        static_cast<CGBitmapInfo>(kCGImageAlphaPremultipliedLast) |
            static_cast<CGBitmapInfo>(kCGBitmapByteOrderDefault));
    CGColorSpaceRelease(source_space);
    if (!source_context) return {};
    CGContextDrawImage(source_context, CGRectMake(0, 0, width, height), source.CGImage);
    CGContextRelease(source_context);

    NSBitmapImageRep* output = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:nil
                      pixelsWide:width
                      pixelsHigh:height
                   bitsPerSample:8
                 samplesPerPixel:4
                        hasAlpha:YES
                        isPlanar:NO
                  colorSpaceName:NSCalibratedRGBColorSpace
                     bitmapFormat:NSBitmapFormatAlphaNonpremultiplied
                      bytesPerRow:width * 4
                     bitsPerPixel:32];
    if (!output || !output.bitmapData) return {};

    const CGFloat scale_x = static_cast<CGFloat>(width) / points_w;
    const CGFloat scale_y = static_cast<CGFloat>(height) / points_h;
    const auto* src = source_rgba.data();
    auto* dst = output.bitmapData;
    const NSInteger src_stride = width * 4;
    const NSInteger dst_stride = output.bytesPerRow;
    for (NSInteger y = 0; y < height; ++y) {
        for (NSInteger x = 0; x < width; ++x) {
            const NSInteger cell_x = static_cast<NSInteger>(x / (24.0 * scale_x));
            const NSInteger cell_y = static_cast<NSInteger>(y / (24.0 * scale_y));
            const bool alternate = ((cell_x + cell_y) & 1) != 0;
            const uint8_t br = alternate ? 41 : 224;
            const uint8_t bg = alternate ? 97 : 87;
            const uint8_t bb = alternate ? 184 : 46;
            const auto* s = src + y * src_stride + x * 4;
            auto* d = dst + y * dst_stride + x * 4;
            const unsigned alpha = s[3];
            const unsigned inverse = 255u - alpha;
            // CGBitmapContext produced premultiplied source bytes, so source-over
            // adds the premultiplied foreground directly instead of applying
            // alpha a second time.
            d[0] = static_cast<uint8_t>(std::min(255u, s[0] + (br * inverse + 127u) / 255u));
            d[1] = static_cast<uint8_t>(std::min(255u, s[1] + (bg * inverse + 127u) / 255u));
            d[2] = static_cast<uint8_t>(std::min(255u, s[2] + (bb * inverse + 127u) / 255u));
            d[3] = 255;
        }
    }
    return bitmap_rep_to_png(output);
}

}  // namespace pulp::view::mac_capture

#endif  // TARGET_OS_OSX
