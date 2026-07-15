#include <pulp/platform/external_open.hpp>

#import <Cocoa/Cocoa.h>

namespace pulp::platform::detail {

bool external_open_native(const std::string& path, bool reveal) {
    @autoreleasepool {
        NSString* native_path = [NSString stringWithUTF8String:path.c_str()];
        if (!native_path || ![[NSFileManager defaultManager] fileExistsAtPath:native_path])
            return false;

        NSURL* url = [NSURL fileURLWithPath:native_path];
        if (!url) return false;
        NSWorkspace* workspace = [NSWorkspace sharedWorkspace];
        if (!workspace) return false;
        if (!reveal) return [workspace openURL:url];

        [workspace activateFileViewerSelectingURLs:@[url]];
        return true;
    }
}

} // namespace pulp::platform::detail
