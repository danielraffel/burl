#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace pulp::view {

enum class ThemeResolutionValueKind : std::uint8_t { color, dimension, string, integer };
enum class ThemeResolutionSource : std::uint8_t { skin, explicit_value, theme, literal_fallback };

struct ThemeResolutionRecord {
    ThemeResolutionValueKind kind = ThemeResolutionValueKind::color;
    ThemeResolutionSource source = ThemeResolutionSource::literal_fallback;
    std::string property;
    std::string token;
};

class ThemeResolutionAudit {
public:
    static void set_enabled(bool enabled);
    static bool enabled();
    static void clear();
    static void record(ThemeResolutionValueKind kind, ThemeResolutionSource source,
                       std::string property, std::string token = {});
    static std::vector<ThemeResolutionRecord> snapshot();
};

class ScopedThemeResolutionAudit {
public:
    ScopedThemeResolutionAudit();
    ~ScopedThemeResolutionAudit();
    ScopedThemeResolutionAudit(const ScopedThemeResolutionAudit&) = delete;
    ScopedThemeResolutionAudit& operator=(const ScopedThemeResolutionAudit&) = delete;
private:
    bool previously_enabled_ = false;
};

} // namespace pulp::view
