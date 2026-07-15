#include <pulp/platform/external_open.hpp>

#include <mutex>

namespace pulp::platform {

#if defined(PULP_EXTERNAL_OPEN_HAS_NATIVE)
namespace detail {
bool external_open_native(const std::string& path, bool reveal);
}
#endif

namespace {

std::mutex g_backend_mutex;
ExternalOpen::Backend g_backend;
bool g_backend_installed = false;

bool dispatch(const std::string& path, bool reveal) {
    if (path.empty()) return false;

    std::function<bool(const std::string&)> callback;
    bool backend_installed = false;
    {
        std::lock_guard lock(g_backend_mutex);
        backend_installed = g_backend_installed;
        if (backend_installed)
            callback = reveal ? g_backend.reveal : g_backend.open;
    }
    if (callback) return callback(path);
    if (backend_installed) return false;

#if defined(PULP_EXTERNAL_OPEN_HAS_NATIVE)
    return detail::external_open_native(path, reveal);
#else
    return false;
#endif
}

} // namespace

bool ExternalOpen::open(const std::string& path) { return dispatch(path, false); }
bool ExternalOpen::reveal(const std::string& path) { return dispatch(path, true); }

void ExternalOpen::set_backend(Backend backend) {
    std::lock_guard lock(g_backend_mutex);
    g_backend = std::move(backend);
    g_backend_installed = true;
}

void ExternalOpen::clear_backend() {
    std::lock_guard lock(g_backend_mutex);
    g_backend = {};
    g_backend_installed = false;
}

bool ExternalOpen::has_backend() {
#if defined(PULP_EXTERNAL_OPEN_HAS_NATIVE)
    return true;
#else
    std::lock_guard lock(g_backend_mutex);
    return g_backend_installed;
#endif
}

} // namespace pulp::platform
