#include <pulp/view/theme_resolution_audit.hpp>

#include <utility>

namespace pulp::view {
namespace {

thread_local bool audit_enabled = false;
thread_local std::vector<ThemeResolutionRecord> audit_records;

} // namespace

void ThemeResolutionAudit::set_enabled(bool enabled) { audit_enabled = enabled; }
bool ThemeResolutionAudit::enabled() { return audit_enabled; }
void ThemeResolutionAudit::clear() { audit_records.clear(); }

void ThemeResolutionAudit::record(ThemeResolutionValueKind kind,
                                  ThemeResolutionSource source,
                                  std::string property,
                                  std::string token) {
    if (!audit_enabled) return;
    audit_records.push_back({kind, source, std::move(property), std::move(token)});
}

std::vector<ThemeResolutionRecord> ThemeResolutionAudit::snapshot() {
    return audit_records;
}

ScopedThemeResolutionAudit::ScopedThemeResolutionAudit()
    : previously_enabled_(ThemeResolutionAudit::enabled()) {
    ThemeResolutionAudit::clear();
    ThemeResolutionAudit::set_enabled(true);
}

ScopedThemeResolutionAudit::~ScopedThemeResolutionAudit() {
    ThemeResolutionAudit::set_enabled(previously_enabled_);
}

} // namespace pulp::view
