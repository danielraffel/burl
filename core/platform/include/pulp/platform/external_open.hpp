#pragma once

#include <functional>
#include <string>

namespace pulp::platform {

/// Opens filesystem content through platform-native services. Unsupported
/// platforms return false; they never report a synthetic success.
class ExternalOpen {
public:
    struct Backend {
        std::function<bool(const std::string& path)> open;
        std::function<bool(const std::string& path)> reveal;
    };

    /// Open a file or directory with the operating system's default handler.
    static bool open(const std::string& path);

    /// Reveal a file or directory in the operating system's file manager.
    static bool reveal(const std::string& path);

    /// A host backend takes precedence over a compiled-in platform adapter.
    static void set_backend(Backend backend);
    static void clear_backend();
    static bool has_backend();
};

} // namespace pulp::platform
